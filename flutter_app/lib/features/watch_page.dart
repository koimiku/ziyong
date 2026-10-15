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
import 'player_controls.dart';

import '../app_controller.dart';
import '../domain/library_backup.dart';
import '../rules/rule_engine.dart';
import '../rules/site_browser.dart';
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
  final subscriptions = <StreamSubscription<dynamic>>[];
  Timer? hideTimer, saveTimer;
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
    if (Platform.isAndroid) unawaited(prepareAudioSession());
    video = VideoController(
      player,
      configuration: VideoControllerConfiguration(
        hwdec: Platform.isAndroid ? 'mediacodec,mediacodec-copy' : 'auto',
      ),
    );
    subscriptions.add(
      player.stream.position.listen((value) {
        final changed = value.inSeconds != position.inSeconds;
        position = value;
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
              if (value && !allowed && mounted) unawaited(player.pause());
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
        if (mounted) setState(() => error = value);
      }),
    );
    subscriptions.add(
      player.stream.completed.listen((value) {
        if (value &&
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
          if (event.begin) unawaited(player.pause());
        }),
      );
      subscriptions.add(
        session.becomingNoisyEventStream.listen(
          (_) => unawaited(player.pause()),
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
      await player.open(
        Media(
          url,
          httpHeaders: {...?resolved?.headers, ...headers, ...capturedHeaders},
          start: resume,
        ),
        play: active,
      );
      if (mounted && token == generation) {
        setState(() => loading = false);
        showControls();
      }
    } catch (failure) {
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
    if (!playing || loading) return;
    hideTimer = Timer(playerControlsTimeout, () {
      if (mounted && playing && !loading) setState(() => visible = false);
    });
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

  Future<void> chooseEpisode() async {
    hideTimer?.cancel();
    await playerSheet(
      (sheetContext) => SafeArea(
        child: SizedBox(
          height: MediaQuery.sizeOf(sheetContext).height * .75,
          child: ListView(
            padding: const EdgeInsets.all(20),
            children: [
              Text('选集', style: Theme.of(sheetContext).textTheme.titleLarge),
              for (var l = 0; l < widget.lines.length; l++) ...[
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Text(widget.lines[l].name),
                ),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (var e = 0; e < widget.lines[l].episodes.length; e++)
                      ChoiceChip(
                        label: Text(widget.lines[l].episodes[e].name),
                        selected: l == line && e == episode,
                        onSelected: (_) {
                          Navigator.pop(sheetContext);
                          unawaited(load(l, e));
                        },
                      ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
    showControls();
  }

  Future<void> playbackSettings() async {
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
                const SizedBox(height: 20),
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
                const SizedBox(height: 16),
                const Text(
                  '横向滑动定位，左侧上下滑动调节亮度，右侧调节音量。长按临时 2 倍速，松开恢复。全屏顶部保留系统下拉手势。',
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
              unawaited(player.playOrPause());
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
                                    if (visible) showControls();
                                  }
                                },
                                onDoubleTap: locked
                                    ? null
                                    : () {
                                        unawaited(player.playOrPause());
                                        showControls();
                                      },
                                onHorizontalDragStart: locked || loading
                                    ? null
                                    : (_) {
                                        dragPosition = position;
                                        hideTimer?.cancel();
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
                                        showControls();
                                      },
                                onHorizontalDragCancel: () {
                                  setState(() => dragPosition = null);
                                  showControls();
                                },
                                onVerticalDragStart: locked || loading
                                    ? null
                                    : (details) {
                                        hideTimer?.cancel();
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
                                        showControls();
                                      },
                                onVerticalDragCancel: () {
                                  setState(() {
                                    adjustingVolume = null;
                                    gestureLabel = '';
                                  });
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
                                                await Navigator.push<bool>(
                                                  context,
                                                  MaterialPageRoute(
                                                    builder: (_) =>
                                                        SiteBrowserPage(
                                                          challenge: challenge,
                                                        ),
                                                  ),
                                                );
                                            if (ok != true || !mounted) return;
                                          }
                                          unawaited(
                                            load(
                                              line,
                                              episode,
                                              forceBrowser:
                                                  verification == null,
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
                            if (!locked && error == null)
                              PlayerControls(
                                full: full,
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
                                  unawaited(player.playOrPause());
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
                                onSeekStart: () => hideTimer?.cancel(),
                                onActivity: showControls,
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
