package com.anime.standalone;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;
import java.util.Locale;

@CapacitorPlugin(name = "ApkUpdater")
public class ApkUpdaterPlugin extends Plugin {
    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url", "");
        if (url == null || url.trim().isEmpty()) {
            call.reject("缺少安装包地址");
            return;
        }

        Activity activity = getActivity();
        if (activity == null) {
            call.reject("应用界面不可用");
            return;
        }

        if (needsInstallPermission()) {
            activity.runOnUiThread(() -> openInstallPermissionSettings(activity));
            call.reject("请允许本应用安装未知应用，然后回来再点一次");
            return;
        }

        new Thread(() -> {
            try {
                File apk = download(url);
                activity.runOnUiThread(() -> {
                    try {
                        launchInstaller(activity, apk);
                        call.resolve();
                    } catch (Exception error) {
                        call.reject(error.getMessage() == null ? "无法打开安装界面" : error.getMessage());
                    }
                });
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? "下载失败" : error.getMessage());
            }
        }, "apk-updater").start();
    }

    private boolean needsInstallPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false;
        return !getContext().getPackageManager().canRequestPackageInstalls();
    }

    private void openInstallPermissionSettings(Activity activity) {
        Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
        intent.setData(Uri.parse("package:" + activity.getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        activity.startActivity(intent);
    }

    private File download(String urlString) throws IOException {
        HttpURLConnection connection = open(urlString);
        File dir = new File(getContext().getCacheDir(), "updates");
        if (!dir.isDirectory() && !dir.mkdirs()) {
            connection.disconnect();
            throw new IOException("无法创建下载目录");
        }
        File partial = new File(dir, "app-update.apk.part");
        File target = new File(dir, "app-update.apk");
        if (partial.exists() && !partial.delete()) {
            connection.disconnect();
            throw new IOException("无法清理旧的下载文件");
        }

        long total = connection.getContentLengthLong();
        long received = 0;
        long lastNotify = 0;
        byte[] buffer = new byte[65536];
        boolean checkedHeader = false;

        try (InputStream input = connection.getInputStream();
             FileOutputStream output = new FileOutputStream(partial)) {
            int read;
            while ((read = input.read(buffer)) != -1) {
                if (!checkedHeader) {
                    if (read < 2 || buffer[0] != 'P' || buffer[1] != 'K') {
                        throw new IOException("下载到的不是安装包");
                    }
                    checkedHeader = true;
                }
                output.write(buffer, 0, read);
                received += read;
                long now = System.currentTimeMillis();
                if (now - lastNotify >= 200 || (total > 0 && received >= total)) {
                    notifyProgress(received, total);
                    lastNotify = now;
                }
            }
        } finally {
            connection.disconnect();
        }

        if (target.exists() && !target.delete()) {
            partial.delete();
            throw new IOException("无法替换旧安装包");
        }
        if (!partial.renameTo(target)) {
            partial.delete();
            throw new IOException("无法保存安装包");
        }
        notifyProgress(target.length(), target.length());
        return target;
    }

    private void notifyProgress(long received, long total) {
        JSObject payload = new JSObject();
        payload.put("received", received);
        payload.put("total", total);
        int percent = total > 0 ? (int) Math.min(100, (received * 100) / total) : -1;
        payload.put("percent", percent);
        notifyListeners("progress", payload);
    }

    private HttpURLConnection open(String urlString) throws IOException {
        String current = urlString;
        for (int hop = 0; hop < 5; hop += 1) {
            URL url = new URL(current);
            assertAllowed(url);
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(20000);
            connection.setReadTimeout(60000);
            connection.setRequestProperty("User-Agent", "ziyong-android-updater");
            connection.setRequestProperty("Accept", "*/*");
            int code = connection.getResponseCode();
            if (code >= 300 && code < 400) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null || location.trim().isEmpty()) {
                    throw new IOException("下载重定向失败");
                }
                current = new URL(url, location).toString();
                continue;
            }
            if (code < 200 || code >= 300) {
                connection.disconnect();
                throw new IOException("下载失败 HTTP " + code);
            }
            return connection;
        }
        throw new IOException("下载重定向次数过多");
    }

    private void assertAllowed(URL url) throws IOException {
        if (!"https".equalsIgnoreCase(url.getProtocol())) {
            throw new IOException("只允许通过 HTTPS 下载安装包");
        }
        String host = url.getHost() == null ? "" : url.getHost().toLowerCase(Locale.ROOT);
        boolean allowed = host.equals("github.com")
            || host.endsWith(".github.com")
            || host.endsWith(".githubusercontent.com");
        if (!allowed) {
            throw new IOException("安装包地址不在 GitHub");
        }
    }

    private void launchInstaller(Activity activity, File apk) {
        String authority = activity.getPackageName() + ".fileprovider";
        Uri uri = FileProvider.getUriForFile(activity, authority, apk);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);

        List<ResolveInfo> handlers = activity.getPackageManager().queryIntentActivities(
            intent,
            PackageManager.MATCH_DEFAULT_ONLY
        );
        for (ResolveInfo handler : handlers) {
            activity.grantUriPermission(
                handler.activityInfo.packageName,
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION
            );
        }
        activity.startActivity(intent);
    }
}
