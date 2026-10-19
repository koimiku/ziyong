import 'dart:async';
import 'dart:io';
import 'dart:convert';

import 'package:file_picker/file_picker.dart';
import 'package:screen_brightness/screen_brightness.dart';
import 'package:volume_controller/volume_controller.dart';
import 'package:audio_session/audio_session.dart';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:media_kit/media_kit.dart';
import 'package:media_kit_video/media_kit_video.dart';
import 'package:wakelock_plus/wakelock_plus.dart';
import 'package:window_manager/window_manager.dart';

import '../domain/playback_policy.dart';
import '../domain/playback_recovery.dart';
import '../data/app_update.dart';
import 'player_controls.dart';
import 'episode_panel.dart';

import '../app_controller.dart';
import '../domain/library_backup.dart';
import '../rules/rule_engine.dart';
import '../rules/site_browser.dart';
import '../rules/verification_dialog.dart';
import '../rules/site_client.dart';

class WatchPage extends StatefulWidget {
  const WatchPage({
    super.key,
    required this.subject,
    required this.source,
    required this.lines,
    required this.controller,
  });
  final Subject subject;
  final SourceHit source;
  final List<EpisodeLine> lines;
  final AppController controller;
  @override
  State<WatchPage> createState() => _WatchPageState();
}

class _WatchPageState extends State<WatchPage> with WidgetsBindingObserver {
  late final Player player;
  late final VideoController video;
  late final PlaybackRecovery recovery;
  bool wantsPlayback = true, softwareDecoder = false, playbackError = false;
  String? currentMediaUri, playbackNotice;
  String lastPlayerMessage = "";
  Map<String, String> currentMediaHeaders = {};
  Duration buffered = Duration.zero;
  final subscriptions = <StreamSubscription<dynamic>>[];
  Timer? hideTimer, saveTimer;
  int controlPanels = 0;
  bool touchingControls = false;
  SiteClient? client;
  MediaProbe? probe;
  int line = 0, episode = 0, generation = 0;
  bool loading = true,
      visible = true,
      locked = false,
      full = false,
      rotating = false,
      active = true;
  Object? error;
  SiteVerification? verification;
  Duration position = Duration.zero, duration = Duration.zero;
  Duration? dragPosition;
  bool playing = false, buffering = false;
  double rate = 1, level = .5;
  bool? adjustingVolume;
  String gestureLabel = '';
  BoxFit fit = BoxFit.contain;
  AudioSession? audioSession;
  Episode get current => widget.lines[line].episodes[episode];

  @override
  void initState() {
    super.initState();
    VolumeController.instance.showSystemUI = false;
    WidgetsBinding.instance.addObserver(this);
    MediaKit.ensureInitialized();
    player = Player();
    softwareDecoder =
        widget.controller.library.settings['anime-player-decoder'] ==
        'software';
    recovery = PlaybackRecovery(
      recover: () => reopenMedia(software: true, fromRecovery: true),
      wantsPlayback: () => wantsPlayback && active,
      onNotice: (message) {
        if (!mounted) return;
        setState(() {
          playbackNotice = message;
          if (message == null && playbackError) {
            error = null;
            playbackError = false;
          }
        });
        if (message != null) showControls();
      },
      onFailure: (message) {
        if (!mounted) return;
        setState(() {
          error = message;
          playbackError = true;
          playbackNotice = null;
          loading = false;
        });
        showControls();
      },
    );
    if (Platform.isAndroid) unawaited(prepareAudioSession());
    video = VideoController(
      player,
      configuration: VideoControllerConfiguration(
        hwdec: softwareDecoder ? 'no' : null,
      ),
    );
    subscriptions.add(
      player.stream.position.listen((value) {
        final changed = value.inSeconds != position.inSeconds;
        recovery.progress(value);
        position = value;
        if (mounted && visible && changed) setState(() {});
      }),
    );
    subscriptions.add(
      player.stream.buffer.listen((value) {
        final changed = value.inSeconds != buffered.inSeconds;
        buffered = value;
        if (mounted && visible && changed) setState(() {});
      }),
    );
    subscriptions.add(
      player.stream.duration.listen((value) {
        duration = value;
        if (mounted && visible) setState(() {});
      }),
    );
    subscriptions.add(
      player.stream.playing.listen((value) {
        playing = value;
        if (audioSession case final session?) {
          unawaited(
            session.setActive(value && active).then((allowed) {
              if (value && !allowed && mounted) unawaited(pausePlayback());
            }),
          );
        }
        unawaited(WakelockPlus.toggle(enable: value && active));
        if (!value) unawaited(save());
        if (mounted) {
          setState(() {});
          showControls();
        }
      }),
    );
    subscriptions.add(
      player.stream.buffering.listen((value) {
        if (mounted) setState(() => buffering = value);
      }),
    );
    subscriptions.add(
      player.stream.error.listen((value) {
        lastPlayerMessage = value.replaceAll(RegExp(r'https?://\S+'), '[媒体地址]');
        recovery.error(value);
      }),
    );
    subscriptions.add(
      player.stream.completed.listen((value) {
        if (value &&
            !recovery.pending &&
            error == null &&
            active &&
            episode + 1 < widget.lines[line].episodes.length) {
          unawaited(load(line, episode + 1));
        }
      }),
    );
    final saved = widget.controller.library.history
        .where((row) => '${row['id']}' == widget.subject.id)
        .firstOrNull?['progress'];
    final resume = resumePlayback(saved, widget.source, widget.lines);
    line = resume.line;
    episode = resume.episode;
    unawaited(load(line, episode, resume: resume.position));
    saveTimer = Timer.periodic(const Duration(seconds: 15), (_) {
      if (playing && active) unawaited(save());
    });
  }

  Future<void> configureDecoder(bool software) async {
    await video.platform.future.timeout(const Duration(seconds: 15));
    final native = player.platform;
    if (native is NativePlayer) {
      await native.setProperty(
        'hwdec',
        software
            ? 'no'
            : Platform.isAndroid
            ? 'auto-safe'
            : 'auto',
      );
    }
  }

  Future<void> pausePlayback() async {
    wantsPlayback = false;
    recovery.cancel();
    await player.pause();
  }

  Future<void> togglePlayback() async {
    if (playing) {
      await pausePlayback();
    } else {
      wantsPlayback = true;
      recovery.begin(software: softwareDecoder);
      await player.play();
    }
    showControls();
  }

  Future<void> reopenMedia({
    required bool software,
    bool fromRecovery = false,
  }) async {
    final uri = currentMediaUri;
    if (uri == null || !mounted) return;
    final token = generation;
    final resume = position;
    final headers = Map<String, String>.from(currentMediaHeaders);
    if (!fromRecovery) recovery.cancel();
    setState(() {
      softwareDecoder = software;
      error = null;
      playbackError = false;
      loading = true;
    });
    try {
      await configureDecoder(software);
      if (!mounted || token != generation) return;
      if (!fromRecovery) recovery.begin(software: software);
      await player.open(
        Media(uri, httpHeaders: headers, start: resume),
        play: active && wantsPlayback,
      );
      if (!mounted || token != generation) return;
      await player.setRate(rate);
      if (!mounted || token != generation) return;
      setState(() => loading = false);
      showControls();
    } catch (_) {
      if (!mounted || token != generation) return;
      if (fromRecovery) rethrow;
      setState(() {
        loading = false;
        error = '无法切换当前媒体的解码方式，请换一条线路';
      });
      showControls();
    }
  }

  Future<void> save() async {
    if (loading || duration.inSeconds <= 0) return;
    await widget.controller.recordProgress(widget.subject, {
      'sourceName': widget.source.rule.name,
      'sourceUrl': widget.source.source,
      'lineIndex': line,
      'episodeIndex': episode,
      'episodeNumber': current.name,
      'position': position.inSeconds,
      'duration': duration.inSeconds,
      'percent': (position.inMilliseconds / duration.inMilliseconds * 100)
          .clamp(0, 100),
    });
  }

  Future<void> prepareAudioSession() async {
    try {
      final session = await AudioSession.instance;
      await session.configure(
        const AudioSessionConfiguration(
          androidAudioAttributes: AndroidAudioAttributes(
            contentType: AndroidAudioContentType.movie,
            usage: AndroidAudioUsage.media,
          ),
          androidAudioFocusGainType: AndroidAudioFocusGainType.gain,
          androidWillPauseWhenDucked: true,
        ),
      );
      if (!mounted) return;
      audioSession = session;
      subscriptions.add(
        session.interruptionEventStream.listen((event) {
          if (event.begin) unawaited(pausePlayback());
        }),
      );
      subscriptions.add(
        session.becomingNoisyEventStream.listen(
          (_) => unawaited(pausePlayback()),
        ),
      );
      if (playing && active) await session.setActive(true);
    } catch (_) {}
  }

  Future<void> load(
    int newLine,
    int newEpisode, {
    Duration resume = Duration.zero,
    bool forceBrowser = false,
  }) async {
    recovery.cancel();
    currentMediaUri = null;
    final token = ++generation;
    await save();
    if (!mounted || token != generation) return;
    probe?.cancel();
    client?.close();
    final transport = client = SiteClient();
    setState(() {
      line = newLine;
      episode = newEpisode;
      loading = true;
      error = null;
      verification = null;
      playbackError = false;
      playbackNotice = null;
      buffered = Duration.zero;
      softwareDecoder =
          widget.controller.library.settings['anime-player-decoder'] ==
          'software';
      wantsPlayback = active;
      position = Duration.zero;
      duration = Duration.zero;
      visible = true;
    });
    await player.stop();
    if (!mounted || token != generation) return;
    try {
      final resolved = forceBrowser
          ? null
          : await RuleEngine(transport.request)
                .resolve(widget.source.rule, current.url);
      if (!mounted || token != generation) return;
      var url = resolved?.url;
      var capturedHeaders = <String, String>{};
      if (url == null) {
        final detector = probe = MediaProbe();
        final cookie = await transport.cookies(Uri.parse(current.url));
        url = await detector.resolve(
          widget.source.rule,
          current.url,
          headers: {if (cookie.isNotEmpty) 'Cookie': cookie},
        );
        capturedHeaders = detector.resolvedHeaders;
      }
      if (!mounted || token != generation) return;
      if (url == null) throw const FormatException('未找到可播放的视频，请尝试其他线路或片源');
      final headers = await transport.playbackHeaders(
        widget.source.rule,
        url,
        current.url,
      );
      if (!mounted || token != generation) return;
      currentMediaUri = url;
      currentMediaHeaders = {
        ...?resolved?.headers,
        ...headers,
        ...capturedHeaders,
      };
      await configureDecoder(softwareDecoder);
      if (!mounted || token != generation) return;
      recovery.begin(software: softwareDecoder);
      await player.open(
        Media(url, httpHeaders: currentMediaHeaders, start: resume),
        play: active,
      );
      if (mounted && token == generation) {
        setState(() => loading = false);
        showControls();
      }
    } catch (failure) {
      if (mounted &&
          token == generation &&
          currentMediaUri != null &&
          isDecodeError('$failure')) {
        setState(() => loading = false);
        recovery.error('$failure');
        return;
      }
      if (mounted && token == generation) {
        setState(() {
          loading = false;
          error = failure;
          verification = failure is SiteVerification ? failure : null;
        });
      }
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    active =
        state != AppLifecycleState.paused &&
        state != AppLifecycleState.hidden &&
        state != AppLifecycleState.detached;
    if (!active) {
      wantsPlayback = false;
      recovery.cancel();
      unawaited(save());
      unawaited(player.pause());
      probe?.cancel();
      if (loading) {
        generation++;
        client?.close();
        if (mounted) {
          setState(() {
            loading = false;
            error = '加载已暂停，返回后可点击重试';
          });
        }
      }
      unawaited(WakelockPlus.disable());
      unawaited(
        ScreenBrightness.instance.resetApplicationScreenBrightness().catchError(
          (Object _) {},
        ),
      );
    }
  }

  void showControls() {
    if (!mounted) return;
    hideTimer?.cancel();
    if (mounted && !visible) setState(() => visible = true);
    if ((!full && !playing) ||
        loading ||
        error != null ||
        controlPanels > 0 ||
        touchingControls) {
      return;
    }
    hideTimer = Timer(controlsTimeout(fullscreen: full), () {
      if (mounted &&
          (full || playing) &&
          !loading &&
          error == null &&
          controlPanels == 0 &&
          !touchingControls) {
        setState(() => visible = false);
      }
    });
  }

  void holdControls() {
    touchingControls = true;
    hideTimer?.cancel();
  }

  void releaseControls() {
    touchingControls = false;
    showControls();
  }

  Future<void> withControlsHeld(Future<void> Function() action) async {
    controlPanels++;
    hideTimer?.cancel();
    try {
      await action();
    } finally {
      controlPanels--;
      showControls();
    }
  }

  Future<void> fullscreen(bool value) async {
    if (rotating) return;
    rotating = true;
    try {
      if (Platform.isWindows) {
        await windowManager.ensureInitialized();
        if (!mounted) return;
        await windowManager.setFullScreen(value);
        if (!mounted) {
          await windowManager.setFullScreen(false);
          return;
        }
      }
      if (Platform.isAndroid) {
        await SystemChrome.setPreferredOrientations(
          value
              ? [
                  DeviceOrientation.landscapeLeft,
                  DeviceOrientation.landscapeRight,
                ]
              : [DeviceOrientation.portraitUp],
        );
        await SystemChrome.setEnabledSystemUIMode(
          value ? SystemUiMode.immersiveSticky : SystemUiMode.edgeToEdge,
        );
        final deadline = DateTime.now().add(const Duration(milliseconds: 700));
        while (mounted &&
            DateTime.now().isBefore(deadline) &&
            (MediaQuery.orientationOf(context) == Orientation.landscape) !=
                value) {
          await Future<void>.delayed(const Duration(milliseconds: 16));
        }
      }
      if (mounted) {
        setState(() {
          full = value;
          locked = false;
          visible = true;
        });
      }
      showControls();
    } finally {
      rotating = false;
    }
  }

  Future<void> playerSheet(WidgetBuilder builder) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      backgroundColor: full ? const Color(0xff181c24) : null,
      builder: (_) => Theme(
        data: full
            ? ThemeData(
                colorScheme: ColorScheme.fromSeed(
                  seedColor: Theme.of(context).colorScheme.primary,
                  brightness: Brightness.dark,
                ),
                useMaterial3: true,
                scaffoldBackgroundColor: const Color(0xff181c24),
              )
            : Theme.of(context),
        child: Builder(builder: builder),
      ),
    );
  }

  Future<void> chooseEpisode() => withControlsHeld(chooseEpisodePanel);

  Future<void> chooseEpisodePanel() async {
    hideTimer?.cancel();
    (int, int)? selection;
    Widget panel(BuildContext context) => EpisodePanel(
      lines: widget.lines,
      line: line,
      episode: episode,
      onSelect: (l, e) {
        selection = (l, e);
        Navigator.pop(context);
      },
      onClose: () => Navigator.pop(context),
    );
    if (full) {
      await showGeneralDialog<void>(
        context: context,
        barrierDismissible: true,
        barrierLabel: '关闭选集',
        transitionDuration: const Duration(milliseconds: 180),
        transitionBuilder: (context, animation, secondary, child) =>
            SlideTransition(
              position: Tween(begin: const Offset(1, 0), end: Offset.zero)
                  .animate(
                    CurvedAnimation(
                      parent: animation,
                      curve: Curves.easeOutCubic,
                    ),
                  ),
              child: child,
            ),
        pageBuilder: (context, animation, secondary) => Align(
          alignment: Alignment.centerRight,
          child: SizedBox(
            width: MediaQuery.sizeOf(context).width.clamp(0, 400).toDouble(),
            child: Theme(
              data: ThemeData(
                colorScheme: ColorScheme.fromSeed(
                  seedColor: Theme.of(this.context).colorScheme.primary,
                  brightness: Brightness.dark,
                ),
              ),
              child: Material(
                color: const Color(0xff181c24),
                child: SafeArea(child: panel(context)),
              ),
            ),
          ),
        ),
      );
    } else {
      await playerSheet(
        (context) => SizedBox(
          height: MediaQuery.sizeOf(context).height * .75,
          child: panel(context),
        ),
      );
    }
    if (mounted && selection != null) await load(selection!.$1, selection!.$2);
    showControls();
  }

  Future<void> playbackSettings() => withControlsHeld(playbackSettingsPanel);

  Future<void> playbackSettingsPanel() async {
    hideTimer?.cancel();
    await playerSheet(
      (sheetContext) => StatefulBuilder(
        builder: (sheetContext, update) => SafeArea(
          child: SizedBox(
            height: MediaQuery.sizeOf(sheetContext).height * .8,
            child: ListView(
              padding: const EdgeInsets.all(24),
              children: [
                Text(
                  '播放设置',
                  style: Theme.of(sheetContext).textTheme.titleLarge,
                ),
                const Text('解码方式'),
                Wrap(
                  spacing: 8,
                  children: [
                    for (final mode in ['auto', 'software'])
                      ChoiceChip(
                        label: Text(mode == 'auto' ? '自动 · 优先硬解' : '兼容 · 软解'),
                        selected: softwareDecoder == (mode == 'software'),
                        onSelected: (_) async {
                          await widget.controller.setSetting(
                            'anime-player-decoder',
                            mode,
                          );
                          if (!mounted || !sheetContext.mounted) return;
                          await reopenMedia(software: mode == 'software');
                          if (sheetContext.mounted) update(() {});
                        },
                      ),
                  ],
                ),
                const SizedBox(height: 16),
                const Text('倍速'),
                Wrap(
                  spacing: 8,
                  children: [
                    for (final value in [.5, .75, 1.0, 1.25, 1.5, 2.0, 3.0])
                      ChoiceChip(
                        label: Text('$value×'),
                        selected: rate == value,
                        onSelected: (_) {
                          unawaited(player.setRate(value));
                          setState(() => rate = value);
                          update(() {});
                        },
                      ),
                  ],
                ),
                const SizedBox(height: 20),
                const Text('画面比例'),
                Wrap(
                  spacing: 8,
                  children: [
                    for (final item in [
                      (BoxFit.contain, '适应'),
                      (BoxFit.cover, '填满'),
                      (BoxFit.fill, '拉伸'),
                    ])
                      ChoiceChip(
                        label: Text(item.$2),
                        selected: fit == item.$1,
                        onSelected: (_) {
                          setState(() => fit = item.$1);
                          update(() {});
                        },
                      ),
                  ],
                ),
                const SizedBox(height: 20),
                const Text('音轨'),
                for (final track in player.state.tracks.audio)
                  ListTile(
                    title: Text(
                      track.title ??
                          track.language ??
                          (track.id == 'auto'
                              ? '自动'
                              : track.id == 'no'
                              ? '关闭'
                              : '音轨 ${track.id}'),
                    ),
                    selected: player.state.track.audio.id == track.id,
                    trailing: player.state.track.audio.id == track.id
                        ? const Icon(Icons.check)
                        : null,
                    onTap: () async {
                      await player.setAudioTrack(track);
                      if (sheetContext.mounted) update(() {});
                    },
                  ),
                const SizedBox(height: 16),
                const Text('字幕'),
                for (final track in player.state.tracks.subtitle)
                  ListTile(
                    title: Text(
                      track.title ??
                          track.language ??
                          (track.id == 'auto'
                              ? '自动'
                              : track.id == 'no'
                              ? '关闭'
                              : '字幕 ${track.id}'),
                    ),
                    selected: player.state.track.subtitle.id == track.id,
                    trailing: player.state.track.subtitle.id == track.id
                        ? const Icon(Icons.check)
                        : null,
                    onTap: () async {
                      await player.setSubtitleTrack(track);
                      if (sheetContext.mounted) update(() {});
                    },
                  ),
                TextButton.icon(
                  onPressed: () async {
                    final file = await FilePicker.pickFile(
                      type: FileType.custom,
                      allowedExtensions: ['srt', 'ass', 'ssa', 'vtt'],
                    );
                    if (file == null) return;
                    try {
                      final bytes = <int>[];
                      await for (final chunk in file.readAsByteStream()) {
                        if (bytes.length + chunk.length > 2 * 1024 * 1024) {
                          throw const FormatException('字幕不能超过 2 MB');
                        }
                        bytes.addAll(chunk);
                      }
                      await player.setSubtitleTrack(
                        SubtitleTrack.data(
                          utf8.decode(bytes),
                          title: file.name,
                        ),
                      );
                      if (sheetContext.mounted) update(() {});
                    } catch (_) {
                      if (sheetContext.mounted) {
                        ScaffoldMessenger.of(sheetContext).showSnackBar(
                          const SnackBar(
                            content: Text('无法读取这份字幕，请使用 UTF-8 编码的字幕'),
                          ),
                        );
                      }
                    }
                  },
                  icon: const Icon(Icons.subtitles_outlined),
                  label: const Text('导入外部字幕'),
                ),
                const SizedBox(height: 12),
                Text('当前解码：${softwareDecoder ? '兼容软解' : '自动'}'),
                if (lastPlayerMessage.isNotEmpty)
                  Text(
                    lastPlayerMessage,
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                  ),
                TextButton.icon(
                  onPressed: () => Clipboard.setData(
                    ClipboardData(
                      text:
                          'anime $appVersion · ${Platform.operatingSystem}\n片源 ${widget.source.rule.name}\n解码 ${softwareDecoder ? 'software' : 'auto'}\n位置 ${position.inSeconds} / ${duration.inSeconds}\n$lastPlayerMessage',
                    ),
                  ),
                  icon: const Icon(Icons.copy_rounded),
                  label: const Text('复制播放诊断'),
                ),
                const SizedBox(height: 16),
                const Text(
                  '横向滑动定位，左侧调亮度、右侧调音量。长按临时 2 倍速。全屏点击画面显示或隐藏控制栏，6 秒无操作自动收起。',
                ),
              ],
            ),
          ),
        ),
      ),
    );
    showControls();
  }

  Future<void> startLevel(bool volume) async {
    adjustingVolume = volume;
    try {
      final value = volume
          ? await VolumeController.instance.getVolume()
          : await ScreenBrightness.instance.application;
      if (mounted && adjustingVolume == volume) level = value;
    } catch (_) {}
  }

  void updateLevel(double delta) {
    if (adjustingVolume == null) return;
    level = (level - delta / 240).clamp(0, 1);
    setState(
      () => gestureLabel =
          '${adjustingVolume! ? '音量' : '亮度'} ${(level * 100).round()}%',
    );
    if (adjustingVolume!) {
      unawaited(
        VolumeController.instance.setVolume(level).catchError((Object _) {}),
      );
    } else {
      unawaited(
        ScreenBrightness.instance
            .setApplicationScreenBrightness(level.clamp(.02, 1))
            .catchError((Object _) {}),
      );
    }
  }

  @override
  void dispose() {
    unawaited(save());
    generation++;
    recovery.cancel();
    client?.close();
    probe?.cancel();
    hideTimer?.cancel();
    saveTimer?.cancel();
    for (final subscription in subscriptions) {
      unawaited(subscription.cancel());
    }
    unawaited(player.dispose());
    unawaited(audioSession?.setActive(false));
    unawaited(WakelockPlus.disable());
    VolumeController.instance.showSystemUI = true;
    unawaited(
      ScreenBrightness.instance.resetApplicationScreenBrightness().catchError(
        (Object _) {},
      ),
    );
    if (Platform.isWindows && full) {
      unawaited(windowManager.setFullScreen(false));
    }
    WidgetsBinding.instance.removeObserver(this);
    if (Platform.isAndroid) {
      unawaited(
        SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]),
      );
      unawaited(SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge));
    }
    super.dispose();
  }

  String clock(Duration value) =>
      '${value.inMinutes.toString().padLeft(2, '0')}:${(value.inSeconds % 60).toString().padLeft(2, '0')}';
  Widget action(IconData icon, String tooltip, VoidCallback callback) =>
      IconButton(
        color: Colors.white,
        style: IconButton.styleFrom(
          backgroundColor: Colors.black45,
          minimumSize: const Size(52, 52),
        ),
        tooltip: tooltip,
        onPressed: callback,
        icon: Icon(icon),
      );

  @override
  Widget build(BuildContext context) {
    // Wait for Android's landscape metrics before expanding the existing surface.
    final expanded = full;
    return PopScope(
      canPop: !full && !locked,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && !locked) unawaited(fullscreen(false));
      },
      child: CallbackShortcuts(
        bindings: {
          const SingleActivator(LogicalKeyboardKey.space): () {
            if (!locked) {
              unawaited(togglePlayback());
              showControls();
            }
          },
          const SingleActivator(LogicalKeyboardKey.arrowRight): () {
            if (!locked) {
              unawaited(
                player.seek(
                  seekPosition(
                    position + const Duration(seconds: 10),
                    duration,
                  ),
                ),
              );
              showControls();
            }
          },
          const SingleActivator(LogicalKeyboardKey.arrowLeft): () {
            if (!locked) {
              unawaited(
                player.seek(
                  seekPosition(
                    position - const Duration(seconds: 10),
                    duration,
                  ),
                ),
              );
              showControls();
            }
          },
          const SingleActivator(LogicalKeyboardKey.keyF): () {
            if (!locked) unawaited(fullscreen(!full));
          },
          const SingleActivator(LogicalKeyboardKey.escape): () {
            if (!locked && full) unawaited(fullscreen(false));
          },
        },
        child: Focus(
          autofocus: true,
          child: Scaffold(
            backgroundColor: expanded ? Colors.black : null,
            appBar: full ? null : AppBar(title: Text(widget.subject.title)),
            body: LayoutBuilder(
              builder: (context, constraints) {
                final height = expanded
                    ? constraints.maxHeight
                    : (constraints.maxWidth * 9 / 16).clamp(
                        180.0,
                        constraints.maxHeight,
                      );
                return Stack(
                  children: [
                    if (!expanded)
                      Positioned(
                        top: height,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        child: ListView(
                          padding: const EdgeInsets.all(20),
                          children: [
                            Text(
                              widget.subject.title,
                              style: Theme.of(context).textTheme.titleLarge,
                            ),
                            const SizedBox(height: 12),
                            Text(
                              '${widget.source.rule.label} · ${widget.lines[line].name} · ${current.name}',
                            ),
                            const SizedBox(height: 20),
                            FilledButton.tonalIcon(
                              onPressed: chooseEpisode,
                              icon: const Icon(Icons.video_library_outlined),
                              label: const Text('选集与线路'),
                            ),
                          ],
                        ),
                      ),
                    Positioned(
                      top: 0,
                      left: 0,
                      right: 0,
                      height: height,
                      child: ColoredBox(
                        color: Colors.black,
                        child: Stack(
                          fit: StackFit.expand,
                          children: [
                            Video(
                              controller: video,
                              controls: NoVideoControls,
                              fit: fit,
                              wakelock: false,
                              pauseUponEnteringBackgroundMode: false,
                              resumeUponEnteringForegroundMode: false,
                            ),
                            Positioned.fill(
                              top: expanded ? 48 : 0,
                              child: GestureDetector(
                                behavior: HitTestBehavior.opaque,
                                onTap: () {
                                  if (locked) {
                                    showControls();
                                  } else {
                                    setState(() => visible = !visible);
                                    hideTimer?.cancel();
                                    if (visible) showControls();
                                  }
                                },
                                onDoubleTap: locked
                                    ? null
                                    : () {
                                        unawaited(togglePlayback());
                                        showControls();
                                      },
                                onHorizontalDragStart: locked || loading
                                    ? null
                                    : (_) {
                                        dragPosition = position;
                                        holdControls();
                                      },
                                onHorizontalDragUpdate: locked || loading
                                    ? null
                                    : (details) {
                                        setState(
                                          () => dragPosition = seekPosition(
                                            (dragPosition ?? position) +
                                                Duration(
                                                  milliseconds:
                                                      (details.delta.dx /
                                                              constraints
                                                                  .maxWidth *
                                                              120000)
                                                          .round(),
                                                ),
                                            duration,
                                          ),
                                        );
                                      },
                                onHorizontalDragEnd: locked || loading
                                    ? null
                                    : (_) {
                                        if (dragPosition case final target?) {
                                          unawaited(player.seek(target));
                                        }
                                        setState(() => dragPosition = null);
                                        releaseControls();
                                      },
                                onHorizontalDragCancel: () {
                                  if (dragPosition == null) return;
                                  setState(() => dragPosition = null);
                                  releaseControls();
                                },
                                onVerticalDragStart: locked || loading
                                    ? null
                                    : (details) {
                                        holdControls();
                                        unawaited(
                                          startLevel(
                                            details.localPosition.dx >
                                                constraints.maxWidth / 2,
                                          ),
                                        );
                                      },
                                onVerticalDragUpdate: locked || loading
                                    ? null
                                    : (details) =>
                                          updateLevel(details.delta.dy),
                                onVerticalDragEnd: locked
                                    ? null
                                    : (_) {
                                        setState(() {
                                          adjustingVolume = null;
                                          gestureLabel = '';
                                        });
                                        releaseControls();
                                      },
                                onVerticalDragCancel: () {
                                  if (adjustingVolume == null) return;
                                  setState(() {
                                    adjustingVolume = null;
                                    gestureLabel = '';
                                  });
                                  releaseControls();
                                },
                                onLongPressStart: locked || loading
                                    ? null
                                    : (_) {
                                        unawaited(player.setRate(2));
                                        setState(() => gestureLabel = '2×');
                                      },
                                onLongPressEnd: locked
                                    ? null
                                    : (_) {
                                        unawaited(player.setRate(rate));
                                        setState(() => gestureLabel = '');
                                      },
                              ),
                            ),
                            if ((loading || buffering) && error == null)
                              const Center(child: CircularProgressIndicator()),
                            if (gestureLabel.isNotEmpty)
                              Center(
                                child: Card(
                                  color: Colors.black87,
                                  child: Padding(
                                    padding: const EdgeInsets.all(16),
                                    child: Text(
                                      gestureLabel,
                                      style: const TextStyle(
                                        color: Colors.white,
                                        fontSize: 22,
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            if (dragPosition case final target?)
                              Center(
                                child: DecoratedBox(
                                  decoration: BoxDecoration(
                                    color: Colors.black87,
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: Padding(
                                    padding: const EdgeInsets.all(16),
                                    child: Text(
                                      clock(target),
                                      style: const TextStyle(
                                        color: Colors.white,
                                        fontSize: 22,
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            if (error != null && !locked)
                              Align(
                                alignment: Alignment.topLeft,
                                child: action(
                                  Icons.arrow_back,
                                  full ? '退出全屏' : '返回',
                                  () {
                                    if (full) {
                                      unawaited(fullscreen(false));
                                    } else {
                                      Navigator.pop(context);
                                    }
                                  },
                                ),
                              ),
                            if (playbackNotice != null && error == null)
                              Center(
                                child: Card(
                                  color: Colors.black87,
                                  child: Padding(
                                    padding: const EdgeInsets.all(16),
                                    child: Text(
                                      playbackNotice!,
                                      style: const TextStyle(
                                        color: Colors.white,
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            if (error != null)
                              Center(
                                child: Padding(
                                  padding: const EdgeInsets.all(24),
                                  child: Column(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Text(
                                        '$error',
                                        style: const TextStyle(
                                          color: Colors.white,
                                        ),
                                        textAlign: TextAlign.center,
                                      ),
                                      const SizedBox(height: 12),
                                      FilledButton(
                                        onPressed: () async {
                                          if (verification
                                              case final challenge?) {
                                            final ok =
                                                await showSiteVerification(
                                                  context,
                                                  challenge,
                                                );
                                            if (ok != true || !mounted) return;
                                          }
                                          unawaited(
                                            load(
                                              line,
                                              episode,
                                              resume: position,
                                            ),
                                          );
                                        },
                                        child: Text(
                                          verification != null
                                              ? '完成网站验证'
                                              : '重试',
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            if (!locked)
                              PlayerControls(
                                full: full,
                                buffer: buffered,
                                failed: error != null,
                                onNext:
                                    episode + 1 <
                                        widget.lines[line].episodes.length
                                    ? () => unawaited(load(line, episode + 1))
                                    : null,
                                visible: visible,
                                playing: playing,
                                loading: loading,
                                position: position,
                                duration: duration,
                                rate: rate,
                                title: widget.subject.title,
                                subtitle:
                                    '${widget.lines[line].name} · ${current.name}',
                                onPlay: () {
                                  unawaited(togglePlayback());
                                  showControls();
                                },
                                onFullscreen: () =>
                                    unawaited(fullscreen(!full)),
                                onEpisodes: chooseEpisode,
                                onSettings: playbackSettings,
                                onSkip: () => unawaited(
                                  player.seek(
                                    seekPosition(
                                      position + const Duration(seconds: 85),
                                      duration,
                                    ),
                                  ),
                                ),
                                onSeek: (value) => unawaited(
                                  player.seek(seekPosition(value, duration)),
                                ),
                                onSeekStart: holdControls,
                                onActivity: releaseControls,
                              ),
                            if (expanded && visible)
                              Align(
                                alignment: Alignment.centerLeft,
                                child: action(
                                  locked ? Icons.lock : Icons.lock_open,
                                  locked ? '解锁' : '锁定',
                                  () {
                                    setState(() => locked = !locked);
                                    showControls();
                                  },
                                ),
                              ),
                          ],
                        ),
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
  }
}
