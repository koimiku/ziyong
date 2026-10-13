package com.anime.standalone;

import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.os.Build;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.FrameLayout;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;

// Capacitor's chrome client cancels HTML fullscreen right away, so video fullscreen
// only stretched inside the page. Like Kazumi, fullscreen here hides the system bars,
// turns the screen to landscape and fades the video layer in and out.
public class FullscreenChromeClient extends BridgeWebChromeClient {
    private static final long ENTER_MS = 220;
    private static final long EXIT_MS = 160;

    private final Activity activity;
    private View customView;
    private CustomViewCallback customCallback;
    private int savedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT;

    public FullscreenChromeClient(Bridge bridge) {
        super(bridge);
        this.activity = bridge.getActivity();
    }

    @Override
    public void onShowCustomView(View view, CustomViewCallback callback) {
        if (customView != null) {
            callback.onCustomViewHidden();
            return;
        }
        customView = view;
        customCallback = callback;
        savedOrientation = activity.getRequestedOrientation();

        Window window = activity.getWindow();
        FrameLayout decor = (FrameLayout) window.getDecorView();
        view.setBackgroundColor(Color.BLACK);
        view.setAlpha(0f);
        decor.addView(
            view,
            new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        );
        view.animate().alpha(1f).setDuration(ENTER_MS).start();

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        WindowCompat.setDecorFitsSystemWindows(window, false);
        setCutoutMode(window, true);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, decor);
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());
        activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
    }

    @Override
    public void onHideCustomView() {
        View view = customView;
        if (view == null) return;
        customView = null;
        CustomViewCallback callback = customCallback;
        customCallback = null;

        Window window = activity.getWindow();
        FrameLayout decor = (FrameLayout) window.getDecorView();
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        WindowCompat.setDecorFitsSystemWindows(window, true);
        setCutoutMode(window, false);
        WindowCompat.getInsetsController(window, decor).show(WindowInsetsCompat.Type.systemBars());
        activity.setRequestedOrientation(savedOrientation);

        view.animate().alpha(0f).setDuration(EXIT_MS).withEndAction(() -> decor.removeView(view)).start();
        if (callback != null) callback.onCustomViewHidden();
    }

    private void setCutoutMode(Window window, boolean edgeToEdge) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return;
        WindowManager.LayoutParams params = window.getAttributes();
        params.layoutInDisplayCutoutMode = edgeToEdge
            ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT;
        window.setAttributes(params);
    }
}
