package com.anime.standalone;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ValueAnimator;
import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.graphics.Rect;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewTreeObserver;
import android.view.Window;
import android.view.WindowManager;
import android.view.animation.PathInterpolator;
import android.webkit.CookieManager;
import android.widget.FrameLayout;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Iterator;

// Plays streams with libmpv in a native view laid over the WebView's player box, so
// formats and codecs the WebView can't decode still play, like Kazumi's mpv player.
@CapacitorPlugin(name = "NativePlayer")
public class NativePlayerPlugin extends Plugin implements MpvPlayerView.Listener {
    private static final long LOAD_TIMEOUT_MS = 25000;
    private static final long ANIM_MS = 260;
    private static final long ROTATE_WAIT_MS = 900;
    private static final long PROGRESS_EVENT_MS = 1000;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Rect inlineRect = new Rect();
    private final Runnable loadTimeout = () -> failLoad("视频加载超时，请换一条片源");

    private MpvPlayerView player;
    private boolean unavailable;
    private PluginCall pendingLoad;
    private boolean active;
    private boolean visible = true;
    private boolean fullscreen;
    private ValueAnimator animator;
    private Runnable cancelFullscreenLayout;
    private int savedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT;
    private long lastProgressAt;
    private boolean lastPaused = true;

    @PluginMethod
    public void isAvailable(PluginCall call) {
        main.post(() -> {
            JSObject result = new JSObject();
            result.put("available", ensurePlayer());
            call.resolve(result);
        });
    }

    @PluginMethod
    public void load(PluginCall call) {
        String url = call.getString("url", "");
        if (url == null || url.isEmpty()) {
            call.reject("缺少播放地址");
            return;
        }
        JSObject headers = call.getObject("headers", new JSObject());
        JSObject rect = call.getObject("rect", null);
        double startAt = call.getDouble("position", 0.0);
        String title = call.getString("title", "");
        boolean hasNext = Boolean.TRUE.equals(call.getBoolean("hasNext", false));

        main.post(() -> {
            if (!ensurePlayer()) {
                call.reject("原生播放器不可用");
                return;
            }
            if (pendingLoad != null) pendingLoad.reject("已切换到其他视频");
            pendingLoad = call;
            main.removeCallbacks(loadTimeout);
            main.postDelayed(loadTimeout, LOAD_TIMEOUT_MS);

            if (rect != null) readRect(rect, inlineRect);
            if (!fullscreen) applyBounds(inlineRect);
            player.setTitle(title);
            player.setHasNext(hasNext);
            player.setEpisodes(call.getArray("episodes"), call.getInt("episodeIndex", 0));

            String userAgent = header(headers, "User-Agent");
            String referer = header(headers, "Referer");
            StringBuilder fields = new StringBuilder();
            Iterator<String> keys = headers.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                if (key.equalsIgnoreCase("User-Agent") || key.equalsIgnoreCase("Referer")
                    || key.equalsIgnoreCase("Range") || key.equalsIgnoreCase("Accept")) continue;
                String value = headers.optString(key, "");
                if (value.isEmpty() || value.contains(",")) continue;
                if (fields.length() > 0) fields.append(',');
                fields.append(key).append(": ").append(value);
            }
            if (header(headers, "Cookie").isEmpty()) {
                String cookie = CookieManager.getInstance().getCookie(url);
                if (cookie != null && !cookie.isEmpty() && !cookie.contains(",")) {
                    if (fields.length() > 0) fields.append(',');
                    fields.append("Cookie: ").append(cookie);
                }
            }

            active = true;
            player.load(url, userAgent, referer, fields.toString(), startAt);
            updateVisibility();
        });
    }

    @PluginMethod
    public void setRect(PluginCall call) {
        Rect next = new Rect();
        readRect(call.getData(), next);
        main.post(() -> {
            inlineRect.set(next);
            if (player != null && !fullscreen && animator == null) applyBounds(inlineRect);
            call.resolve();
        });
    }

    @PluginMethod
    public void setVisible(PluginCall call) {
        boolean value = Boolean.TRUE.equals(call.getBoolean("visible", true));
        main.post(() -> {
            visible = value;
            updateVisibility();
            call.resolve();
        });
    }

    @PluginMethod
    public void play(PluginCall call) {
        main.post(() -> {
            if (player != null) player.play();
            call.resolve();
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        main.post(() -> {
            if (player != null) player.pause();
            call.resolve();
        });
    }

    @PluginMethod
    public void seek(PluginCall call) {
        double target = call.getDouble("position", 0.0);
        main.post(() -> {
            if (player != null) player.seekTo(target);
            call.resolve();
        });
    }

    @PluginMethod
    public void setInfo(PluginCall call) {
        String title = call.getString("title", null);
        Boolean hasNext = call.getBoolean("hasNext", null);
        main.post(() -> {
            if (player != null) {
                if (title != null) player.setTitle(title);
                if (hasNext != null) player.setHasNext(hasNext);
                if (call.getArray("episodes") != null) player.setEpisodes(call.getArray("episodes"), call.getInt("episodeIndex", 0));
                if (Boolean.TRUE.equals(call.getBoolean("loading", false))) player.prepareEpisode();
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void setFullscreen(PluginCall call) {
        boolean value = Boolean.TRUE.equals(call.getBoolean("value", true));
        main.post(() -> {
            if (value) enterFullscreen();
            else exitFullscreen(true);
            call.resolve();
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        main.post(() -> {
            stopPlayback();
            call.resolve();
        });
    }

    @Override
    protected void handleOnPause() {
        main.post(() -> {
            if (player != null) player.pause();
        });
    }

    @Override
    protected void handleOnDestroy() {
        if (cancelFullscreenLayout != null) cancelFullscreenLayout.run();
        main.removeCallbacksAndMessages(null);
        if (player != null) {
            player.release();
            player = null;
        }
    }

    // --- MpvPlayerView.Listener ---

    @Override
    public void onLoaded(double duration) {
        main.removeCallbacks(loadTimeout);
        if (pendingLoad == null) return;
        JSObject result = new JSObject();
        result.put("duration", duration);
        pendingLoad.resolve(result);
        pendingLoad = null;
    }

    @Override
    public void onLoadFailed(String message) {
        failLoad(message);
    }

    @Override
    public void onProgress(double position, double duration, boolean paused) {
        long now = SystemClock.uptimeMillis();
        if (paused == lastPaused && now - lastProgressAt < PROGRESS_EVENT_MS) return;
        lastProgressAt = now;
        lastPaused = paused;
        JSObject data = new JSObject();
        data.put("position", position);
        data.put("duration", duration);
        data.put("paused", paused);
        notifyListeners("progress", data);
    }

    @Override
    public void onEnded() {
        notifyListeners("ended", new JSObject());
    }

    @Override
    public void onNextRequested() {
        notifyListeners("next", new JSObject());
    }

    @Override
    public void onEpisodeRequested(int index) {
        JSObject data = new JSObject();
        data.put("index", index);
        notifyListeners("episode", data);
    }

    @Override
    public void onFullscreenRequested(boolean value) {
        if (value) enterFullscreen();
        else exitFullscreen(true);
    }

    @Override
    public void onBackRequested() {
        notifyListeners("back", new JSObject());
    }

    // --- internals (main thread) ---

    private boolean ensurePlayer() {
        if (player != null) return true;
        if (unavailable || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false;
        Activity activity = getActivity();
        if (activity == null) return false;
        MpvPlayerView view = new MpvPlayerView(activity, this);
        if (!view.start()) {
            unavailable = true;
            return false;
        }
        view.setVisibility(View.INVISIBLE);
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(1, 1);
        params.gravity = Gravity.TOP | Gravity.START;
        content().addView(view, params);
        player = view;
        return true;
    }

    private FrameLayout content() {
        return getActivity().findViewById(android.R.id.content);
    }

    private void failLoad(String message) {
        main.removeCallbacks(loadTimeout);
        if (pendingLoad != null) {
            pendingLoad.reject(message);
            pendingLoad = null;
        }
        stopPlayback();
    }

    private void stopPlayback() {
        main.removeCallbacks(loadTimeout);
        if (pendingLoad != null) {
            pendingLoad.reject("已停止播放");
            pendingLoad = null;
        }
        active = false;
        if (player == null) return;
        player.stop();
        exitFullscreen(false);
        updateVisibility();
    }

    private void updateVisibility() {
        if (player == null) return;
        boolean show = active && (visible || fullscreen);
        int next = show ? View.VISIBLE : View.INVISIBLE;
        if (player.getVisibility() == next) return;
        if (show) {
            player.setAlpha(0f);
            player.setVisibility(View.VISIBLE);
            player.animate().alpha(1f).setDuration(160).start();
        } else {
            player.animate().cancel();
            player.setVisibility(View.INVISIBLE);
        }
    }

    private void enterFullscreen() {
        if (fullscreen || player == null || !active) return;
        Activity activity = getActivity();
        Window window = activity.getWindow();
        FrameLayout root = content();
        if (animator != null) animator.cancel();
        fullscreen = true;
        savedOrientation = activity.getRequestedOrientation();
        notifyFullscreen(true);
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // Keep the inline video intact until the first landscape layout. Commit
        // fullscreen before that layout is drawn, without a portrait expansion.
        ViewTreeObserver.OnPreDrawListener[] listener = new ViewTreeObserver.OnPreDrawListener[1];
        Runnable timeout = () -> {
            if (fullscreen && cancelFullscreenLayout != null) exitFullscreen(false);
        };
        cancelFullscreenLayout = () -> {
            if (root.getViewTreeObserver().isAlive()) {
                root.getViewTreeObserver().removeOnPreDrawListener(listener[0]);
            }
            main.removeCallbacks(timeout);
            cancelFullscreenLayout = null;
        };
        listener[0] = () -> {
            if (!fullscreen || player == null) return true;
            if (root.getWidth() <= root.getHeight()) return true;
            cancelFullscreenLayout.run();
            WindowCompat.setDecorFitsSystemWindows(window, false);
            setCutoutMode(window, true);
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
            controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            controller.hide(WindowInsetsCompat.Type.systemBars());
            player.setFullscreen(true);
            player.bringToFront();
            fillContent();
            updateVisibility();
            return false; // Draw once the fullscreen bounds have been measured.
        };
        root.getViewTreeObserver().addOnPreDrawListener(listener[0]);
        main.postDelayed(timeout, 2000);
        activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        root.requestLayout();
    }
    private void exitFullscreen(boolean animate) {
        if (!fullscreen) return;
        if (cancelFullscreenLayout != null) cancelFullscreenLayout.run();
        fullscreen = false;
        Activity activity = getActivity();
        Window window = activity.getWindow();
        if (player != null) {
            player.setFullscreen(false);
            player.resetBrightness();
        }
        notifyFullscreen(false);

        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        WindowCompat.setDecorFitsSystemWindows(window, true);
        setCutoutMode(window, false);
        WindowCompat.getInsetsController(window, window.getDecorView()).show(WindowInsetsCompat.Type.systemBars());
        activity.setRequestedOrientation(savedOrientation);

        if (animator != null) animator.cancel();
        if (player == null) return;
        if (!animate || !active) {
            applyBounds(inlineRect);
            updateVisibility();
            return;
        }
        FrameLayout content = content();
        fillContent();
        waitForPortrait(content, SystemClock.uptimeMillis() + ROTATE_WAIT_MS, () -> {
            if (fullscreen || player == null) return;
            Rect from = new Rect(0, 0, content.getWidth(), content.getHeight());
            animateBounds(from, inlineRect, () -> {
                if (fullscreen) return;
                applyBounds(inlineRect);
                updateVisibility();
            });
        });
    }

    // Rotation and the system bars returning each trigger a relayout; wait until the
    // window is portrait again (or give up) and then a beat more for the page to settle.
    private void waitForPortrait(View content, long deadline, Runnable done) {
        boolean portrait = content.getHeight() >= content.getWidth();
        if (portrait || SystemClock.uptimeMillis() >= deadline) {
            main.postDelayed(done, 120);
            return;
        }
        afterLayout(content, Math.max(16, deadline - SystemClock.uptimeMillis()), () -> waitForPortrait(content, deadline, done));
    }

    private void afterLayout(View view, long timeoutMs, Runnable action) {
        final boolean[] ran = {false};
        ViewTreeObserver.OnGlobalLayoutListener[] holder = new ViewTreeObserver.OnGlobalLayoutListener[1];
        Runnable once = () -> {
            if (ran[0]) return;
            ran[0] = true;
            view.getViewTreeObserver().removeOnGlobalLayoutListener(holder[0]);
            action.run();
        };
        holder[0] = () -> main.post(once);
        view.getViewTreeObserver().addOnGlobalLayoutListener(holder[0]);
        main.postDelayed(once, timeoutMs);
    }

    private void animateBounds(Rect from, Rect to, Runnable done) {
        if (animator != null) animator.cancel();
        Rect start = new Rect(from);
        Rect end = new Rect(to);
        Rect frame = new Rect();
        ValueAnimator next = ValueAnimator.ofFloat(0f, 1f);
        next.setDuration(ANIM_MS);
        next.setInterpolator(new PathInterpolator(0.2f, 0f, 0f, 1f));
        next.addUpdateListener((animation) -> {
            float t = (float) animation.getAnimatedValue();
            frame.set(
                lerp(start.left, end.left, t),
                lerp(start.top, end.top, t),
                lerp(start.right, end.right, t),
                lerp(start.bottom, end.bottom, t)
            );
            applyBounds(frame);
        });
        next.addListener(new AnimatorListenerAdapter() {
            private boolean cancelled;

            @Override
            public void onAnimationCancel(Animator animation) {
                cancelled = true;
            }

            @Override
            public void onAnimationEnd(Animator animation) {
                if (animator == animation) animator = null;
                if (!cancelled && done != null) done.run();
            }
        });
        animator = next;
        next.start();
    }

    private Rect currentBounds() {
        int left = Math.round(player.getTranslationX());
        int top = Math.round(player.getTranslationY());
        return new Rect(left, top, left + player.getWidth(), top + player.getHeight());
    }

    private void applyBounds(Rect rect) {
        if (player == null) return;
        FrameLayout.LayoutParams params = (FrameLayout.LayoutParams) player.getLayoutParams();
        int width = Math.max(1, rect.width());
        int height = Math.max(1, rect.height());
        if (params.width != width || params.height != height) {
            params.width = width;
            params.height = height;
            player.setLayoutParams(params);
        }
        player.setTranslationX(rect.left);
        player.setTranslationY(rect.top);
    }

    private void fillContent() {
        FrameLayout.LayoutParams params = (FrameLayout.LayoutParams) player.getLayoutParams();
        params.width = ViewGroup.LayoutParams.MATCH_PARENT;
        params.height = ViewGroup.LayoutParams.MATCH_PARENT;
        player.setLayoutParams(params);
        player.setTranslationX(0);
        player.setTranslationY(0);
    }

    private void notifyFullscreen(boolean value) {
        JSObject data = new JSObject();
        data.put("value", value);
        notifyListeners("fullscreen", data);
    }

    private static void readRect(JSObject source, Rect target) {
        int x = source.optInt("x", 0);
        int y = source.optInt("y", 0);
        int width = source.optInt("width", 0);
        int height = source.optInt("height", 0);
        target.set(x, y, x + width, y + height);
    }

    private static String header(JSObject headers, String name) {
        Iterator<String> keys = headers.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            if (key.equalsIgnoreCase(name)) return headers.optString(key, "");
        }
        return "";
    }

    private static int lerp(int from, int to, float t) {
        return Math.round(from + (to - from) * t);
    }

    private static void setCutoutMode(Window window, boolean edgeToEdge) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return;
        WindowManager.LayoutParams params = window.getAttributes();
        params.layoutInDisplayCutoutMode = edgeToEdge
            ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT;
        window.setAttributes(params);
    }
}
