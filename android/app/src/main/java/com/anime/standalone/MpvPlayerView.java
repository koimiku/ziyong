package com.anime.standalone;

import android.app.Activity;
import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.SurfaceTexture;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioManager;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.GestureDetector;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.Surface;
import android.view.TextureView;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.SeekBar;
import android.widget.TextView;
import android.widget.ListView;
import android.widget.ArrayAdapter;
import android.view.ViewGroup;
import org.json.JSONArray;
import dev.jdtech.mpv.MPVLib;
import java.util.Locale;

// libmpv video surface plus Kazumi-style controls: tap toggles the bars, double tap
// pauses, long press plays at 2x, horizontal drag seeks, and in fullscreen the left
// and right halves adjust brightness and volume.
public class MpvPlayerView extends FrameLayout implements TextureView.SurfaceTextureListener, MPVLib.EventObserver {

    public interface Listener {
        void onLoaded(double duration);
        void onLoadFailed(String message);
        void onProgress(double position, double duration, boolean paused);
        void onEnded();
        void onNextRequested();
        void onEpisodeRequested(int index);
        void onLockChanged(boolean locked);
        void onFullscreenRequested(boolean value);
        void onBackRequested();
    }

    private int accent = Color.parseColor("#8AB8F8");
    private static final long HIDE_DELAY_MS = 3500;
    private static final long PROGRESS_POST_MS = 250;
    private static final float[] SPEEDS = {0.75f, 1f, 1.25f, 1.5f, 2f};
    private static final int SEEK_MAX = 1000;

    private static final int GESTURE_NONE = 0;
    private static final int GESTURE_SEEK = 1;
    private static final int GESTURE_BRIGHTNESS = 2;
    private static final int GESTURE_VOLUME = 3;
    private static final int GESTURE_IGNORED = 4;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Listener listener;
    private final TextureView texture;
    private final LinearLayout topBar;
    private final LinearLayout bottomBar;
    private final ImageButton backButton;
    private final ImageButton playButton;
    private final ImageButton nextButton;
    private final ImageButton fullscreenButton;
    private final TextView titleView;
    private final TextView positionView;
    private final TextView durationView;
    private final TextView speedView;
    private final TextView episodesButton;
    private final ImageButton lockButton;
    private final ImageButton unlockButton;
    private final ImageButton skipButton;
    private boolean controlsLocked;
    private FrameLayout episodeOverlay;
    private String[] episodeLabels = new String[0];
    private int episodeIndex;
    private final TextView hintView;
    private final SeekBar seekBar;
    private final ProgressBar spinner;
    private final GestureDetector gestures;
    private final int touchSlop;
    private final Runnable hideControlsTask = this::hideControls;
    private final Runnable hideHintTask;

    private boolean ready;
    private Surface surface;
    private String pendingUrl;
    private boolean loading;
    private boolean awaitingStart;
    private boolean fullscreen;
    private boolean hasNext;
    private boolean controlsVisible = true;
    private boolean userSeeking;
    private boolean paused = true;
    private boolean buffering;
    private boolean ended;
    private double position;
    private double duration;
    private float speed = 1f;
    private boolean speedBoost;
    private volatile long lastTimePost;

    private int gestureMode = GESTURE_NONE;
    private double gestureStartPosition;
    private double seekTarget;
    private float gestureStartBrightness;
    private int gestureStartVolume;

    public MpvPlayerView(Activity activity, Listener listener) {
        super(activity);
        this.listener = listener;
        touchSlop = ViewConfiguration.get(activity).getScaledTouchSlop();
        setBackgroundColor(Color.BLACK);
        setClickable(true);

        texture = new TextureView(activity);
        texture.setSurfaceTextureListener(this);
        addView(texture, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));

        spinner = new ProgressBar(activity);
        spinner.setIndeterminateTintList(ColorStateList.valueOf(Color.WHITE));
        spinner.setVisibility(View.GONE);
        addView(spinner, new LayoutParams(dp(42), dp(42), Gravity.CENTER));

        hintView = new TextView(activity);
        hideHintTask = () -> hintView.setVisibility(View.GONE);
        hintView.setTextColor(Color.WHITE);
        hintView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        hintView.setPadding(dp(14), dp(7), dp(14), dp(7));
        hintView.setBackground(pill(0x99000000, dp(18)));
        hintView.setVisibility(View.GONE);
        LayoutParams hintParams = new LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, Gravity.CENTER_HORIZONTAL | Gravity.TOP);
        hintParams.topMargin = dp(40);
        addView(hintView, hintParams);

        topBar = new LinearLayout(activity);
        topBar.setOrientation(LinearLayout.HORIZONTAL);
        topBar.setGravity(Gravity.CENTER_VERTICAL);
        topBar.setClickable(true);
        topBar.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[] {0x99000000, 0x00000000}));
        backButton = iconButton(R.drawable.mpv_ic_back, "返回");
        backButton.setOnClickListener((v) -> {
            if (fullscreen) listener.onFullscreenRequested(false);
            else listener.onBackRequested();
        });
        topBar.addView(backButton, new LinearLayout.LayoutParams(dp(44), dp(44)));
        titleView = label(15);
        titleView.setSingleLine(true);
        titleView.setEllipsize(TextUtils.TruncateAt.END);
        titleView.setVisibility(View.GONE);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f);
        titleParams.leftMargin = dp(4);
        topBar.addView(titleView, titleParams);
        skipButton = iconButton(R.drawable.mpv_ic_fullscreen, "快进85秒");
        skipButton.setImageDrawable(new Skip85Drawable());
        skipButton.setOnClickListener(v -> {
            if (loading || duration <= 0) return;
            seekTo(position + 85);
            showHint("快进 85 秒", 900);
            scheduleHide();
        });
        topBar.addView(skipButton, new LinearLayout.LayoutParams(dp(48), dp(48)));
        lockButton = iconButton(R.drawable.mpv_ic_lock, "锁定播放器");
        lockButton.setBackground(pill(0x88000000, dp(24)));
        lockButton.setOnClickListener(v -> setControlsLocked(true));
        LayoutParams lockParams = new LayoutParams(dp(48), dp(48), Gravity.CENTER_VERTICAL | Gravity.START);
        lockParams.leftMargin = dp(20);
        addView(lockButton, lockParams);
        unlockButton = iconButton(R.drawable.mpv_ic_unlock, "解锁播放器");
        unlockButton.setBackground(pill(0xAA000000, dp(24)));
        unlockButton.setVisibility(View.GONE);
        unlockButton.setOnClickListener(v -> setControlsLocked(false));
        LayoutParams unlockParams = new LayoutParams(dp(48), dp(48), Gravity.CENTER_VERTICAL | Gravity.START);
        unlockParams.leftMargin = dp(20);
        addView(unlockButton, unlockParams);
        addView(topBar, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT, Gravity.TOP));

        bottomBar = new LinearLayout(activity);
        bottomBar.setOrientation(LinearLayout.HORIZONTAL);
        bottomBar.setGravity(Gravity.CENTER_VERTICAL);
        bottomBar.setClickable(true);
        bottomBar.setBackground(new GradientDrawable(GradientDrawable.Orientation.BOTTOM_TOP, new int[] {0xAA000000, 0x00000000}));

        playButton = iconButton(R.drawable.mpv_ic_play, "播放");
        playButton.setOnClickListener((v) -> togglePause());
        bottomBar.addView(playButton, new LinearLayout.LayoutParams(dp(40), dp(40)));

        nextButton = iconButton(R.drawable.mpv_ic_next, "下一集");
        nextButton.setOnClickListener((v) -> listener.onNextRequested());
        nextButton.setVisibility(View.GONE);
        bottomBar.addView(nextButton, new LinearLayout.LayoutParams(dp(40), dp(40)));

        positionView = label(12);
        positionView.setText(formatTime(0));
        LinearLayout.LayoutParams positionParams = new LinearLayout.LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT);
        positionParams.leftMargin = dp(4);
        bottomBar.addView(positionView, positionParams);

        seekBar = new SeekBar(activity);
        seekBar.setMax(SEEK_MAX);
        seekBar.setProgressTintList(ColorStateList.valueOf(accent));
        seekBar.setThumbTintList(ColorStateList.valueOf(accent));
        seekBar.setProgressBackgroundTintList(ColorStateList.valueOf(0x66FFFFFF));
        seekBar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar bar, int progress, boolean fromUser) {
                if (fromUser && duration > 0) positionView.setText(formatTime(duration * progress / SEEK_MAX));
            }

            @Override
            public void onStartTrackingTouch(SeekBar bar) {
                userSeeking = true;
                main.removeCallbacks(hideControlsTask);
            }

            @Override
            public void onStopTrackingTouch(SeekBar bar) {
                userSeeking = false;
                if (duration > 0) seekTo(duration * bar.getProgress() / SEEK_MAX);
                scheduleHide();
            }
        });
        bottomBar.addView(seekBar, new LinearLayout.LayoutParams(0, dp(36), 1f));

        durationView = label(12);
        durationView.setText(formatTime(0));
        bottomBar.addView(durationView, new LinearLayout.LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT));

        speedView = label(13);
        speedView.setGravity(Gravity.CENTER);
        speedView.setText("倍速");
        speedView.setPadding(dp(10), dp(8), dp(6), dp(8));
        speedView.setOnClickListener((v) -> cycleSpeed());
        bottomBar.addView(speedView, new LinearLayout.LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT));

        episodesButton = label(14);
        episodesButton.setText("选集");
        episodesButton.setGravity(Gravity.CENTER);
        episodesButton.setContentDescription("选择集数");
        episodesButton.setOnClickListener(v -> showEpisodes());
        bottomBar.addView(episodesButton, new LinearLayout.LayoutParams(dp(56), dp(44)));

        fullscreenButton = iconButton(R.drawable.mpv_ic_fullscreen, "全屏");
        fullscreenButton.setOnClickListener((v) -> listener.onFullscreenRequested(!fullscreen));
        bottomBar.addView(fullscreenButton, new LinearLayout.LayoutParams(dp(40), dp(40)));

        addView(bottomBar, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT, Gravity.BOTTOM));

        gestures = new GestureDetector(activity, new GestureDetector.SimpleOnGestureListener() {
            @Override
            public boolean onDown(MotionEvent event) {
                return true;
            }

            @Override
            public boolean onSingleTapConfirmed(MotionEvent event) {
                if (controlsVisible) hideControls();
                else showControls();
                return true;
            }

            @Override
            public boolean onDoubleTap(MotionEvent event) {
                togglePause();
                showControls();
                return true;
            }

            @Override
            public void onLongPress(MotionEvent event) {
                if (paused || loading || gestureMode != GESTURE_NONE) return;
                speedBoost = true;
                setMpvSpeed(2f);
                showHint("2 倍速播放中", 0);
            }

            @Override
            public boolean onScroll(MotionEvent start, MotionEvent event, float dx, float dy) {
                if (start == null || speedBoost) return false;
                handleDrag(start, event);
                return true;
            }
        });
        applyChrome();
    }

    public boolean start() {
        try {
            MPVLib.create(getContext().getApplicationContext());
            MPVLib.setOptionString("vo", "gpu");
            MPVLib.setOptionString("gpu-context", "android");
            MPVLib.setOptionString("opengl-es", "yes");
            MPVLib.setOptionString("hwdec", "mediacodec-copy");
            MPVLib.setOptionString("hwdec-codecs", "h264,hevc,mpeg4,mpeg2video,vp8,vp9,av1");
            MPVLib.setOptionString("ao", "audiotrack,opensles");
            MPVLib.setOptionString("tls-verify", "no");
            MPVLib.setOptionString("cache", "yes");
            MPVLib.setOptionString("demuxer-max-bytes", "64MiB");
            MPVLib.setOptionString("demuxer-max-back-bytes", "32MiB");
            MPVLib.setOptionString("network-timeout", "20");
            MPVLib.setOptionString("keep-open", "yes");
            MPVLib.setOptionString("input-default-bindings", "no");
            MPVLib.setOptionString("ytdl", "no");
            MPVLib.init();
            MPVLib.setOptionString("force-window", "no");
            MPVLib.setOptionString("idle", "yes");
            MPVLib.addObserver(this);
            MPVLib.observeProperty("time-pos", MPVLib.MPV_FORMAT_DOUBLE);
            MPVLib.observeProperty("duration", MPVLib.MPV_FORMAT_DOUBLE);
            MPVLib.observeProperty("pause", MPVLib.MPV_FORMAT_FLAG);
            MPVLib.observeProperty("paused-for-cache", MPVLib.MPV_FORMAT_FLAG);
            MPVLib.observeProperty("eof-reached", MPVLib.MPV_FORMAT_FLAG);
            ready = true;
            return true;
        } catch (Throwable error) {
            ready = false;
            return false;
        }
    }

    public void release() {
        main.removeCallbacksAndMessages(null);
        if (!ready) return;
        ready = false;
        try {
            MPVLib.removeObserver(this);
            if (surface != null) {
                MPVLib.setPropertyString("vo", "null");
                MPVLib.detachSurface();
            }
            MPVLib.destroy();
        } catch (Throwable ignored) {
            // already gone
        }
        if (surface != null) {
            surface.release();
            surface = null;
        }
    }

    public void load(String url, String userAgent, String referer, String headerFields, double startAt) {
        if (!ready) return;
        loading = true;
        awaitingStart = true;
        ended = false;
        buffering = false;
        position = Math.max(0, startAt);
        duration = 0;
        setProperty("user-agent", userAgent == null ? "" : userAgent);
        setProperty("referrer", referer == null ? "" : referer);
        setProperty("http-header-fields", headerFields == null ? "" : headerFields);
        setProperty("start", startAt > 1 ? String.format(Locale.US, "%.2f", startAt) : "none");
        try {
            MPVLib.setPropertyBoolean("pause", false);
        } catch (Throwable ignored) {
            // set on the next file
        }
        if (surface == null) pendingUrl = url;
        else command("loadfile", url);
        updateProgressViews();
        updateSpinner();
        showControls();
    }

    public void stop() {
        loading = false;
        pendingUrl = null;
        ended = false;
        position = 0;
        duration = 0;
        restoreSpeed();
        if (ready) command("stop");
        updateSpinner();
    }

    public void play() {
        if (!ready) return;
        if (ended) {
            ended = false;
            command("seek", "0", "absolute");
        }
        setPause(false);
    }

    public void pause() {
        setPause(true);
    }

    public void seekTo(double seconds) {
        if (!ready) return;
        double target = duration > 0 ? Math.min(Math.max(0, seconds), Math.max(0, duration - 1)) : Math.max(0, seconds);
        ended = false;
        position = target;
        command("seek", String.format(Locale.US, "%.2f", target), "absolute");
        updateProgressViews();
    }

    public boolean isPaused() {
        return paused;
    }

    public double getPosition() {
        return position;
    }

    public double getDuration() {
        return duration;
    }

    public void setTitle(String title) {
        titleView.setText(title == null ? "" : title);
    }

    public void setHasNext(boolean value) {
        hasNext = value;
        applyChrome();
    }

    public void setFullscreen(boolean value) {
        fullscreen = value;
        if (!value) {
            setControlsLocked(false);
            closeEpisodes();
        }
        applyChrome();
        showControls();
    }

    public void setTheme(boolean dark, String color) {
        accent = Color.parseColor(color != null && color.matches("#[0-9a-fA-F]{6}") ? color : dark ? "#EFAFCB" : "#8AB8F8");
        seekBar.setProgressTintList(ColorStateList.valueOf(accent));
        seekBar.setThumbTintList(ColorStateList.valueOf(accent));
        closeEpisodes();
    }

    public void setEpisodes(JSONArray episodes, int selected) {
        episodeLabels = new String[episodes == null ? 0 : episodes.length()];
        for (int i = 0; i < episodeLabels.length; i++) {
            episodeLabels[i] = episodes.optString(i, "第 " + (i + 1) + " 集");
        }
        episodeIndex = selected;
        closeEpisodes();
        applyChrome();
    }

    public void prepareEpisode() {
        pause();
        loading = true;
        updateSpinner();
        showControls();
    }

    private void closeEpisodes() {
        if (episodeOverlay == null) return;
        removeView(episodeOverlay);
        episodeOverlay = null;
        scheduleHide();
    }

    private void showEpisodes() {
        if (!fullscreen || episodeLabels.length == 0) return;
        closeEpisodes();
        main.removeCallbacks(hideControlsTask);
        episodeOverlay = new FrameLayout(getContext());
        episodeOverlay.setBackgroundColor(0x55000000);
        episodeOverlay.setOnClickListener(v -> closeEpisodes());
        LinearLayout panel = new LinearLayout(getContext());
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(12), dp(12), dp(12), dp(12));
        panel.setBackgroundColor(0xF51E1C22);
        panel.setClickable(true);
        TextView heading = label(16);
        heading.setText("选集 · 关闭");
        heading.setGravity(Gravity.CENTER_VERTICAL);
        heading.setOnClickListener(v -> closeEpisodes());
        panel.addView(heading, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, dp(44)));
        ListView list = new ListView(getContext());
        list.setDividerHeight(dp(4));
        list.setAdapter(new ArrayAdapter<String>(getContext(), android.R.layout.simple_list_item_1, episodeLabels) {
            @Override
            public View getView(int position, View convertView, ViewGroup parent) {
                TextView row = (TextView) super.getView(position, convertView, parent);
                row.setTextColor(position == episodeIndex ? accent : Color.WHITE);
                row.setBackground(pill(position == episodeIndex ? ((accent & 0x00FFFFFF) | 0x33000000) : 0x00000000, dp(10)));
                row.setTextSize(14);
                row.setMinHeight(dp(48));
                row.setSelected(position == episodeIndex);
                return row;
            }
        });
        list.setOnItemClickListener((parent, view, index, id) -> {
            closeEpisodes();
            if (index != episodeIndex) listener.onEpisodeRequested(index);
        });
        panel.addView(list, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, 0, 1f));
        int width = Math.min(dp(340), Math.max(dp(220), getWidth() / 2));
        episodeOverlay.addView(panel, new LayoutParams(width, LayoutParams.MATCH_PARENT, Gravity.END));
        addView(episodeOverlay, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
        list.setSelection(Math.max(0, episodeIndex));
    }
    public boolean isControlsLocked() { return controlsLocked; }

    private void setControlsLocked(boolean locked) {
        controlsLocked = locked && fullscreen;
        restoreSpeed();
        gestureMode = GESTURE_NONE;
        userSeeking = false;
        closeEpisodes();
        main.removeCallbacks(hideControlsTask);
        topBar.animate().cancel();
        bottomBar.animate().cancel();
        lockButton.animate().cancel();
        lockButton.setVisibility(controlsLocked ? View.GONE : fullscreen ? View.VISIBLE : View.GONE);
        unlockButton.setVisibility(controlsLocked ? View.VISIBLE : View.GONE);
        unlockButton.bringToFront();
        if (controlsLocked) {
            topBar.setVisibility(View.GONE);
            bottomBar.setVisibility(View.GONE);
            hintView.setVisibility(View.GONE);
            controlsVisible = false;
        } else showControls();
        listener.onLockChanged(controlsLocked);
    }

    public void resetBrightness() {
        if (!(getContext() instanceof Activity)) return;
        android.view.Window window = ((Activity) getContext()).getWindow();
        WindowManager.LayoutParams attrs = window.getAttributes();
        attrs.screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE;
        window.setAttributes(attrs);
    }

    // --- mpv surface ---

    @Override
    public void onSurfaceTextureAvailable(SurfaceTexture texture, int width, int height) {
        if (!ready) return;
        surface = new Surface(texture);
        try {
            MPVLib.attachSurface(surface);
            MPVLib.setOptionString("force-window", "yes");
            setProperty("android-surface-size", width + "x" + height);
            if (pendingUrl != null) {
                command("loadfile", pendingUrl);
                pendingUrl = null;
            } else {
                setProperty("vo", "gpu");
            }
        } catch (Throwable ignored) {
            // surface will be retried on the next attach
        }
    }

    @Override
    public void onSurfaceTextureSizeChanged(SurfaceTexture texture, int width, int height) {
        setProperty("android-surface-size", width + "x" + height);
    }

    @Override
    public boolean onSurfaceTextureDestroyed(SurfaceTexture texture) {
        if (ready) {
            try {
                setProperty("vo", "null");
                MPVLib.setOptionString("force-window", "no");
                MPVLib.detachSurface();
            } catch (Throwable ignored) {
                // instance is shutting down
            }
        }
        if (surface != null) {
            surface.release();
            surface = null;
        }
        return true;
    }

    @Override
    public void onSurfaceTextureUpdated(SurfaceTexture texture) {}

    // --- mpv events (called on mpv's event thread) ---

    @Override
    public void eventProperty(String name) {}

    @Override
    public void eventProperty(String name, long value) {}

    @Override
    public void eventProperty(String name, String value) {}

    @Override
    public void eventProperty(String name, double value) {
        if ("time-pos".equals(name)) {
            long now = SystemClock.uptimeMillis();
            if (now - lastTimePost < PROGRESS_POST_MS) return;
            lastTimePost = now;
        }
        main.post(() -> {
            if (!ready) return;
            if ("time-pos".equals(name)) {
                if (gestureMode != GESTURE_SEEK) position = value;
            } else if ("duration".equals(name)) {
                duration = value;
            }
            updateProgressViews();
            listener.onProgress(position, duration, paused);
        });
    }

    @Override
    public void eventProperty(String name, boolean value) {
        main.post(() -> {
            if (!ready) return;
            switch (name) {
                case "pause":
                    paused = value;
                    setKeepScreenOn(!value);
                    playButton.setImageResource(value ? R.drawable.mpv_ic_play : R.drawable.mpv_ic_pause);
                    playButton.setContentDescription(value ? "播放" : "暂停");
                    if (value) {
                        restoreSpeed();
                        showControls();
                    } else {
                        scheduleHide();
                    }
                    listener.onProgress(position, duration, paused);
                    break;
                case "paused-for-cache":
                    buffering = value;
                    updateSpinner();
                    break;
                case "eof-reached":
                    if (value && !loading && !ended) {
                        ended = true;
                        showControls();
                        listener.onEnded();
                    }
                    break;
                default:
                    break;
            }
        });
    }

    @Override
    public void event(int id) {
        main.post(() -> {
            if (!ready) return;
            if (id == MPVLib.MPV_EVENT_START_FILE) {
                awaitingStart = false;
            } else if (id == MPVLib.MPV_EVENT_FILE_LOADED) {
                if (!loading) return;
                loading = false;
                Double length = null;
                try {
                    length = MPVLib.getPropertyDouble("duration");
                } catch (Throwable ignored) {
                    // live or unknown length
                }
                if (length != null) duration = length;
                updateProgressViews();
                updateSpinner();
                listener.onLoaded(duration);
            } else if (id == MPVLib.MPV_EVENT_END_FILE) {
                if (!loading || awaitingStart) return;
                loading = false;
                updateSpinner();
                listener.onLoadFailed("视频加载失败，请换片源");
            } else if (id == MPVLib.MPV_EVENT_PLAYBACK_RESTART) {
                buffering = false;
                updateSpinner();
            }
        });
    }

    // --- gestures ---

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        if (controlsLocked) return true;
        gestures.onTouchEvent(event);
        int action = event.getActionMasked();
        if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) finishGesture();
        return true;
    }

    private void handleDrag(MotionEvent start, MotionEvent event) {
        float dx = event.getX() - start.getX();
        float dy = event.getY() - start.getY();
        if (gestureMode == GESTURE_NONE) {
            if (Math.abs(dx) < touchSlop && Math.abs(dy) < touchSlop) return;
            if (Math.abs(dx) > Math.abs(dy)) {
                gestureMode = duration > 0 && !loading ? GESTURE_SEEK : GESTURE_IGNORED;
                gestureStartPosition = position;
                seekTarget = position;
            } else if (fullscreen) {
                gestureMode = start.getX() < getWidth() / 2f ? GESTURE_BRIGHTNESS : GESTURE_VOLUME;
                gestureStartBrightness = currentBrightness();
                gestureStartVolume = audio().getStreamVolume(AudioManager.STREAM_MUSIC);
            } else {
                gestureMode = GESTURE_IGNORED;
            }
        }
        float width = Math.max(1, getWidth());
        float height = Math.max(1, getHeight());
        switch (gestureMode) {
            case GESTURE_SEEK: {
                double span = Math.min(duration, 180);
                seekTarget = Math.min(Math.max(0, gestureStartPosition + dx / width * span), duration);
                position = seekTarget;
                updateProgressViews();
                showHint(formatTime(seekTarget) + " / " + formatTime(duration), 0);
                break;
            }
            case GESTURE_BRIGHTNESS: {
                float value = Math.min(1f, Math.max(0.01f, gestureStartBrightness - dy / height));
                Activity activity = (Activity) getContext();
                WindowManager.LayoutParams attrs = activity.getWindow().getAttributes();
                attrs.screenBrightness = value;
                activity.getWindow().setAttributes(attrs);
                showHint("亮度 " + Math.round(value * 100) + "%", 0);
                break;
            }
            case GESTURE_VOLUME: {
                AudioManager audio = audio();
                int max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
                int value = Math.min(max, Math.max(0, Math.round(gestureStartVolume - dy / height * max * 1.2f)));
                audio.setStreamVolume(AudioManager.STREAM_MUSIC, value, 0);
                showHint("音量 " + Math.round(value * 100f / Math.max(1, max)) + "%", 0);
                break;
            }
            default:
                break;
        }
    }

    private void finishGesture() {
        if (speedBoost) {
            restoreSpeed();
            showHint(null, 0);
        }
        if (gestureMode == GESTURE_SEEK) seekTo(seekTarget);
        if (gestureMode != GESTURE_NONE) showHint(null, 500);
        gestureMode = GESTURE_NONE;
    }

    private float currentBrightness() {
        Activity activity = (Activity) getContext();
        float value = activity.getWindow().getAttributes().screenBrightness;
        if (value >= 0) return value;
        try {
            return Settings.System.getInt(activity.getContentResolver(), Settings.System.SCREEN_BRIGHTNESS) / 255f;
        } catch (Settings.SettingNotFoundException error) {
            return 0.5f;
        }
    }

    private AudioManager audio() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    // --- controls ---

    private void togglePause() {
        if (paused) play();
        else pause();
    }

    private void setPause(boolean value) {
        if (!ready) return;
        try {
            MPVLib.setPropertyBoolean("pause", value);
        } catch (Throwable ignored) {
            // no file loaded
        }
    }

    private void cycleSpeed() {
        int index = 0;
        for (int i = 0; i < SPEEDS.length; i++) {
            if (Math.abs(SPEEDS[i] - speed) < 0.01f) index = i;
        }
        speed = SPEEDS[(index + 1) % SPEEDS.length];
        setMpvSpeed(speed);
        speedView.setText(Math.abs(speed - 1f) < 0.01f ? "倍速" : trimSpeed(speed) + "x");
        showHint(trimSpeed(speed) + "x 倍速", 900);
        scheduleHide();
    }

    private void restoreSpeed() {
        if (!speedBoost) return;
        speedBoost = false;
        setMpvSpeed(speed);
    }

    private void setMpvSpeed(float value) {
        if (!ready) return;
        try {
            MPVLib.setPropertyDouble("speed", (double) value);
        } catch (Throwable ignored) {
            // no file loaded
        }
    }

    private void showControls() {
        if (controlsLocked) return;
        controlsVisible = true;
        if (fullscreen) fade(lockButton, true);
        else lockButton.setVisibility(View.GONE);
        fade(topBar, true);
        fade(bottomBar, true);
        scheduleHide();
    }

    private void hideControls() {
        if (paused || userSeeking || loading || episodeOverlay != null) return;
        controlsVisible = false;
        fade(lockButton, false);
        fade(topBar, false);
        fade(bottomBar, false);
    }

    private void scheduleHide() {
        main.removeCallbacks(hideControlsTask);
        if (!paused) main.postDelayed(hideControlsTask, HIDE_DELAY_MS);
    }

    private void fade(View view, boolean visible) {
        view.animate().cancel();
        if (visible) {
            view.setVisibility(View.VISIBLE);
            view.animate().alpha(1f).setDuration(160).start();
        } else {
            view.animate().alpha(0f).setDuration(200).withEndAction(() -> view.setVisibility(View.INVISIBLE)).start();
        }
    }

    private void showHint(String text, long hideAfterMs) {
        main.removeCallbacks(hideHintTask);
        if (text != null) {
            hintView.setText(text);
            hintView.setVisibility(View.VISIBLE);
        }
        if (text == null || hideAfterMs > 0) main.postDelayed(hideHintTask, Math.max(0, hideAfterMs));
    }

    private void updateSpinner() {
        spinner.setVisibility(loading || buffering ? View.VISIBLE : View.GONE);
    }

    private void updateProgressViews() {
        durationView.setText(formatTime(duration));
        if (!userSeeking) {
            positionView.setText(formatTime(position));
            seekBar.setProgress(duration > 0 ? (int) Math.round(position / duration * SEEK_MAX) : 0);
        }
    }

    private void applyChrome() {
        lockButton.setVisibility(fullscreen && !controlsLocked ? View.VISIBLE : View.GONE);
        skipButton.setVisibility(fullscreen ? View.VISIBLE : View.GONE);
        nextButton.setVisibility(hasNext ? View.VISIBLE : View.GONE);
        titleView.setVisibility(fullscreen ? View.VISIBLE : View.GONE);
        episodesButton.setVisibility(fullscreen && episodeLabels.length > 0 ? View.VISIBLE : View.GONE);
        fullscreenButton.setImageResource(fullscreen ? R.drawable.mpv_ic_fullscreen_exit : R.drawable.mpv_ic_fullscreen);
        fullscreenButton.setContentDescription(fullscreen ? "退出全屏" : "全屏");
        int side = fullscreen ? dp(28) : dp(4);
        topBar.setPadding(side, fullscreen ? dp(10) : dp(4), side, dp(10));
        bottomBar.setPadding(side, dp(14), side, fullscreen ? dp(10) : dp(2));
    }

    private ImageButton iconButton(int icon, String description) {
        ImageButton button = new ImageButton(getContext());
        button.setImageResource(icon);
        button.setContentDescription(description);
        button.setScaleType(ImageButton.ScaleType.CENTER);
        TypedValue ripple = new TypedValue();
        getContext().getTheme().resolveAttribute(android.R.attr.selectableItemBackgroundBorderless, ripple, true);
        if (ripple.resourceId != 0) button.setBackgroundResource(ripple.resourceId);
        else button.setBackgroundColor(Color.TRANSPARENT);
        return button;
    }

    private TextView label(int sizeSp) {
        TextView view = new TextView(getContext());
        view.setTextColor(Color.WHITE);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp);
        return view;
    }

    private static GradientDrawable pill(int color, int radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(radius);
        return drawable;
    }

    private void setProperty(String name, String value) {
        if (!ready) return;
        try {
            MPVLib.setPropertyString(name, value);
        } catch (Throwable ignored) {
            // unsupported in this build
        }
    }

    private void command(String... args) {
        if (!ready) return;
        try {
            MPVLib.command(args);
        } catch (Throwable ignored) {
            // rejected by mpv
        }
    }

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private static String trimSpeed(float value) {
        return value == Math.floor(value) ? String.format(Locale.US, "%.1f", value) : String.valueOf(value);
    }

    static String formatTime(double seconds) {
        long total = seconds > 0 && !Double.isInfinite(seconds) ? (long) seconds : 0;
        long hours = total / 3600;
        long minutes = (total % 3600) / 60;
        long secs = total % 60;
        return hours > 0
            ? String.format(Locale.US, "%d:%02d:%02d", hours, minutes, secs)
            : String.format(Locale.US, "%02d:%02d", minutes, secs);
    }
}
