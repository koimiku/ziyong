package com.anime.standalone;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

// Loads a play page in an invisible WebView and captures the first real video request,
// the way Kazumi's WebView parser does, so signed or script-generated URLs work.
@CapacitorPlugin(name = "MediaSniffer")
public class MediaSnifferPlugin extends Plugin {
    private static final Pattern MEDIA_PATH = Pattern.compile("\\.(m3u8|mp4|m4v|flv)$", Pattern.CASE_INSENSITIVE);
    private static final Pattern AD_URL = Pattern.compile("/(ads?|adv|advert|guanggao|gg)/|[?&](ad|ads)=", Pattern.CASE_INSENSITIVE);
    private static final int MAX_CONCURRENT = 2;
    private static final long MP4_GRACE_MS = 1500;
    private static final long KICK_INTERVAL_MS = 1200;
    private static final String NO_REFERER = "none";

    private static final String AUTOPLAY_SCRIPT = "(() => {"
        + "document.querySelectorAll('video').forEach((video) => {"
        + "video.muted = true; try { video.play().catch(() => {}); } catch (e) {}"
        + "});"
        + "const button = document.querySelector('.dplayer-mobile-play, .dplayer-play-icon, .art-control-play, "
        + ".vjs-big-play-button, .prism-big-play-btn, .yzmplayer-play, .xgplayer-start, .plyr__control--overlaid, "
        + "[class*=play-btn], [class*=playbtn]');"
        + "if (button) button.click();"
        + "})();";

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ArrayDeque<PluginCall> queue = new ArrayDeque<>();
    private int active = 0;

    @PluginMethod
    public void sniff(PluginCall call) {
        String url = call.getString("url", "");
        if (url == null || !url.matches("(?i)^https?://.+")) {
            call.reject("缺少播放页地址");
            return;
        }
        main.post(() -> {
            queue.add(call);
            pump();
        });
    }

    private void pump() {
        while (active < MAX_CONCURRENT && !queue.isEmpty()) {
            PluginCall call = queue.poll();
            active += 1;
            new Session(call).start();
        }
    }

    private void release() {
        active = Math.max(0, active - 1);
        pump();
    }

    private final class Session {
        private final PluginCall call;
        private final String pageUrl;
        private final String referer;
        private final long timeoutMs;
        private WebView webView;
        private boolean settled = false;
        private String pendingMp4 = null;
        private final Map<String, Map<String, String>> requestHeaders = new HashMap<>();

        private final Runnable timeout = () -> {
            if (pendingMp4 != null) capture(pendingMp4);
            else fail("网页解析超时，没有截获到视频地址");
        };
        private final Runnable mp4Grace = () -> {
            if (pendingMp4 != null) capture(pendingMp4);
        };
        private final Runnable kick = new Runnable() {
            @Override
            public void run() {
                if (settled || webView == null) return;
                webView.evaluateJavascript(AUTOPLAY_SCRIPT, null);
                main.postDelayed(this, KICK_INTERVAL_MS);
            }
        };

        Session(PluginCall call) {
            this.call = call;
            this.pageUrl = call.getString("url", "");
            this.referer = call.getString("referer", "");
            this.timeoutMs = Math.max(3000, call.getInt("timeoutMs", 12000));
        }

        @SuppressLint("SetJavaScriptEnabled")
        void start() {
            Activity activity = getActivity();
            if (activity == null) {
                fail("应用界面不可用");
                return;
            }
            try {
                webView = new WebView(activity);
            } catch (Exception error) {
                fail("无法创建网页解析器");
                return;
            }
            WebSettings settings = webView.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setBlockNetworkImage(true);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            settings.setUserAgentString(settings.getUserAgentString().replace("; wv", ""));
            webView.setWebViewClient(new SnifferClient());
            webView.setAlpha(0f);
            webView.setVisibility(View.VISIBLE);

            ViewGroup root = activity.findViewById(android.R.id.content);
            if (root != null) root.addView(webView, new FrameLayout.LayoutParams(1, 1));

            Map<String, String> headers = new HashMap<>();
            if (referer != null && !referer.isEmpty()) headers.put("Referer", referer);
            webView.loadUrl(pageUrl, headers);
            main.postDelayed(timeout, timeoutMs);
            main.postDelayed(kick, KICK_INTERVAL_MS);
        }

        void hit(String url) {
            if (settled) return;
            String path = Uri.parse(url).getPath();
            if (path != null && path.toLowerCase(Locale.ROOT).endsWith(".m3u8")) {
                capture(url);
                return;
            }
            // Pre-roll ads are usually mp4; give the real HLS stream a moment to show up.
            if (pendingMp4 == null) {
                pendingMp4 = url;
                main.postDelayed(mp4Grace, MP4_GRACE_MS);
            }
        }

        void capture(String url) {
            if (settled) return;
            Map<String, String> sent = requestHeaders.get(url);
            JSObject headers = new JSObject();
            String sentReferer = header(sent, "referer");
            headers.put("Referer", sentReferer.isEmpty() ? NO_REFERER : sentReferer);
            String origin = header(sent, "origin");
            if (!origin.isEmpty()) headers.put("Origin", origin);
            String cookie = android.webkit.CookieManager.getInstance().getCookie(url);
            if (cookie != null && !cookie.isEmpty()) headers.put("Cookie", cookie);

            JSObject result = new JSObject();
            result.put("mediaUrl", url);
            result.put("pageUrl", pageUrl);
            result.put("headers", headers);
            finish();
            call.resolve(result);
        }

        void fail(String message) {
            if (settled) return;
            finish();
            call.reject(message);
        }

        private void finish() {
            settled = true;
            main.removeCallbacks(timeout);
            main.removeCallbacks(mp4Grace);
            main.removeCallbacks(kick);
            if (webView != null) {
                WebView view = webView;
                webView = null;
                view.stopLoading();
                ViewGroup parent = (ViewGroup) view.getParent();
                if (parent != null) parent.removeView(view);
                view.destroy();
            }
            release();
        }

        private String header(Map<String, String> headers, String name) {
            if (headers == null) return "";
            for (Map.Entry<String, String> entry : headers.entrySet()) {
                if (entry.getKey() != null && entry.getKey().equalsIgnoreCase(name)) {
                    return entry.getValue() == null ? "" : entry.getValue();
                }
            }
            return "";
        }

        private final class SnifferClient extends WebViewClient {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                String path = request.getUrl().getPath();
                if (!request.isForMainFrame()
                    && path != null
                    && MEDIA_PATH.matcher(path).find()
                    && !AD_URL.matcher(url).find()) {
                    Map<String, String> headers = request.getRequestHeaders();
                    main.post(() -> {
                        requestHeaders.put(url, headers);
                        hit(url);
                    });
                }
                return null;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String scheme = request.getUrl().getScheme();
                return scheme == null || !(scheme.equals("http") || scheme.equals("https"));
            }
        }
    }
}
