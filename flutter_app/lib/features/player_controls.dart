import 'dart:math' as math;

import 'package:flutter/material.dart';

const playerControlsTimeout = Duration(seconds: 8);
Duration controlsTimeout({required bool fullscreen}) =>
    fullscreen ? const Duration(seconds: 6) : playerControlsTimeout;

class PlayerControls extends StatefulWidget {
  const PlayerControls({
    super.key,
    required this.full,
    required this.visible,
    required this.playing,
    required this.loading,
    required this.position,
    required this.duration,
    required this.title,
    required this.subtitle,
    required this.rate,
    required this.onPlay,
    required this.onFullscreen,
    required this.onEpisodes,
    required this.onSettings,
    required this.onSkip,
    required this.onSeek,
    required this.onSeekStart,
    required this.onActivity,
    this.onNext,
    this.failed = false,
    this.buffer = Duration.zero,
  });
  final bool full, visible, playing, loading;
  final bool failed;
  final Duration buffer;
  final VoidCallback? onNext;
  final Duration position, duration;
  final String title, subtitle;
  final double rate;
  final VoidCallback onPlay,
      onFullscreen,
      onEpisodes,
      onSettings,
      onSkip,
      onSeekStart,
      onActivity;
  final ValueChanged<Duration> onSeek;
  @override
  State<PlayerControls> createState() => _PlayerControlsState();
}

class _PlayerControlsState extends State<PlayerControls> {
  double? scrub;
  String clock(Duration value) =>
      '${value.inMinutes.toString().padLeft(2, '0')}:${(value.inSeconds % 60).toString().padLeft(2, '0')}';
  Widget region(Widget child) => ControlHitRegion(
    onStart: widget.onSeekStart,
    onEnd: widget.onActivity,
    child: child,
  );
  Widget icon(IconData icon, String label, VoidCallback? callback) =>
      IconButton(
        tooltip: label,
        constraints: const BoxConstraints(minWidth: 52, minHeight: 52),
        color: Colors.white,
        iconSize: 26,
        onPressed: callback == null
            ? null
            : () {
                widget.onActivity();
                callback();
              },
        icon: Icon(icon),
      );
  Widget fullButton() => TextButton.icon(
    style: TextButton.styleFrom(
      foregroundColor: Colors.white,
      minimumSize: const Size(96, 52),
      backgroundColor: widget.visible
          ? Colors.transparent
          : const Color(0xb3212530),
      shape: const StadiumBorder(),
    ),
    onPressed: () {
      widget.onActivity();
      widget.onFullscreen();
    },
    icon: Icon(
      widget.full ? Icons.fullscreen_exit_rounded : Icons.fullscreen_rounded,
      size: 28,
    ),
    label: Text(widget.full ? '退出全屏' : '全屏'),
  );
  @override
  Widget build(BuildContext context) {
    final end = widget.duration.inMilliseconds.toDouble();
    final value = (scrub ?? widget.position.inMilliseconds.toDouble()).clamp(
      0.0,
      end > 0 ? end : 1.0,
    );
    final accent = Theme.of(context).brightness == Brightness.dark
        ? Theme.of(context).colorScheme.primary
        : const Color(0xffaacbff);
    return SafeArea(
      top: false,
      bottom: widget.full,
      child: Stack(
        fit: StackFit.expand,
        children: [
          IgnorePointer(
            ignoring: !widget.visible,
            child: AnimatedOpacity(
              opacity: widget.visible ? 1 : 0,
              duration: const Duration(milliseconds: 180),
              child: Stack(
                children: [
                  Positioned(
                    top: 0,
                    left: 0,
                    right: 0,
                    height: widget.full ? 100 : 64,
                    child: const IgnorePointer(
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.topCenter,
                            end: Alignment.bottomCenter,
                            colors: [Color(0xc9000000), Colors.transparent],
                          ),
                        ),
                      ),
                    ),
                  ),
                  Positioned(
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: widget.full ? 150 : 100,
                    child: const IgnorePointer(
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.topCenter,
                            end: Alignment.bottomCenter,
                            colors: [Colors.transparent, Color(0xe6000000)],
                          ),
                        ),
                      ),
                    ),
                  ),
                  Positioned(
                    top: widget.full ? 10 : 0,
                    left: widget.full ? 12 : 12,
                    right: 12,
                    child: region(
                      Row(
                        children: [
                          if (widget.full)
                            icon(
                              Icons.arrow_back_rounded,
                              '退出全屏',
                              widget.onFullscreen,
                            ),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(
                                  widget.full ? widget.title : widget.subtitle,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    color: Colors.white,
                                    fontSize: widget.full ? 16 : 13,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                if (widget.full)
                                  Text(
                                    widget.subtitle,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      color: Colors.white70,
                                      fontSize: 12,
                                      height: 1.7,
                                    ),
                                  ),
                              ],
                            ),
                          ),
                          if (widget.full)
                            IconButton(
                              tooltip: '快进85秒',
                              constraints: const BoxConstraints(
                                minWidth: 52,
                                minHeight: 52,
                              ),
                              onPressed: widget.failed || widget.loading
                                  ? null
                                  : () {
                                      widget.onActivity();
                                      widget.onSkip();
                                    },
                              icon: const Stack(
                                alignment: Alignment.center,
                                children: [
                                  CustomPaint(
                                    size: Size(36, 36),
                                    painter: _SkipArrowPainter(),
                                  ),
                                  Text(
                                    '+85',
                                    style: TextStyle(
                                      color: Colors.white,
                                      fontSize: 10,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          icon(Icons.tune_rounded, '播放设置', widget.onSettings),
                        ],
                      ),
                    ),
                  ),
                  Positioned(
                    bottom: widget.full ? 10 : 0,
                    left: widget.full ? 24 : 8,
                    right: widget.full ? 24 : 8,
                    child: region(
                      Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          SliderTheme(
                            data: SliderTheme.of(context).copyWith(
                              trackHeight: 3,
                              activeTrackColor: accent,
                              inactiveTrackColor: Colors.white24,
                              thumbColor: accent,
                              overlayColor: accent.withValues(alpha: .16),
                              thumbShape: const RoundSliderThumbShape(
                                enabledThumbRadius: 6,
                              ),
                              trackShape: const RoundedRectSliderTrackShape(),
                            ),
                            child: Slider(
                              value: value,
                              max: end > 0 ? end : 1,
                              secondaryTrackValue: widget.buffer.inMilliseconds
                                  .toDouble()
                                  .clamp(value, end > 0 ? end : 1),
                              onChangeStart:
                                  widget.loading || widget.failed || end <= 0
                                  ? null
                                  : (value) {
                                      widget.onSeekStart();
                                      setState(() => scrub = value);
                                    },
                              onChanged:
                                  widget.loading || widget.failed || end <= 0
                                  ? null
                                  : (value) => setState(() => scrub = value),
                              onChangeEnd:
                                  widget.loading || widget.failed || end <= 0
                                  ? null
                                  : (value) {
                                      widget.onSeek(
                                        Duration(milliseconds: value.toInt()),
                                      );
                                      setState(() => scrub = null);
                                      widget.onActivity();
                                    },
                            ),
                          ),
                          Row(
                            children: [
                              icon(
                                widget.playing
                                    ? Icons.pause_rounded
                                    : Icons.play_arrow_rounded,
                                widget.playing ? '暂停' : '播放',
                                widget.failed || widget.loading
                                    ? null
                                    : widget.onPlay,
                              ),
                              if (widget.full)
                                icon(
                                  Icons.skip_next_rounded,
                                  '下一集',
                                  widget.onNext,
                                ),
                              Expanded(
                                child: FittedBox(
                                  fit: BoxFit.scaleDown,
                                  alignment: Alignment.centerLeft,
                                  child: Text(
                                    '${clock(Duration(milliseconds: value.toInt()))} / ${clock(widget.duration)}',
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 12,
                                      fontFeatures: [
                                        FontFeature.tabularFigures(),
                                      ],
                                    ),
                                  ),
                                ),
                              ),
                              if (widget.full) ...[
                                TextButton(
                                  onPressed: () {
                                    widget.onActivity();
                                    widget.onSettings();
                                  },
                                  style: TextButton.styleFrom(
                                    foregroundColor: Colors.white,
                                    minimumSize: const Size(56, 52),
                                  ),
                                  child: Text('${widget.rate}×'),
                                ),
                                TextButton.icon(
                                  onPressed: () {
                                    widget.onActivity();
                                    widget.onEpisodes();
                                  },
                                  style: TextButton.styleFrom(
                                    foregroundColor: Colors.white,
                                    minimumSize: const Size(84, 52),
                                  ),
                                  icon: const Icon(Icons.playlist_play_rounded),
                                  label: const Text('选集'),
                                ),
                              ],
                              fullButton(),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (!widget.full && !widget.visible)
            Positioned(right: 12, bottom: 8, child: fullButton()),
        ],
      ),
    );
  }
}

class _SkipArrowPainter extends CustomPainter {
  const _SkipArrowPainter();
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.white
      ..strokeWidth = 2
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;
    final rect = Rect.fromLTWH(4, 4, size.width - 8, size.height - 8);
    canvas.drawArc(rect, -math.pi / 2, math.pi * 1.75, false, paint);
    final end = Offset(rect.center.dx, rect.top);
    canvas.drawPath(
      Path()
        ..moveTo(end.dx - 4, end.dy - 3)
        ..lineTo(end.dx + 1, end.dy)
        ..lineTo(end.dx - 4, end.dy + 4),
      paint,
    );
  }

  @override
  bool shouldRepaint(_SkipArrowPainter oldDelegate) => false;
}

class ControlHitRegion extends StatelessWidget {
  const ControlHitRegion({
    super.key,
    required this.onStart,
    required this.onEnd,
    required this.child,
  });
  final VoidCallback onStart, onEnd;
  final Widget child;
  @override
  Widget build(BuildContext context) => Listener(
    behavior: HitTestBehavior.opaque,
    onPointerDown: (_) => onStart(),
    onPointerUp: (_) => onEnd(),
    onPointerCancel: (_) => onEnd(),
    child: child,
  );
}
