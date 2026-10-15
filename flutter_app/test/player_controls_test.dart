import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:anime_flutter/features/player_controls.dart';

void main() {
  Future<void> mount(
    WidgetTester tester, {
    required Size size,
    required bool full,
    bool visible = true,
    VoidCallback? onFullscreen,
    ValueChanged<Duration>? onSeek,
  }) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final capture = Platform.environment['ANIME_CAPTURE_DIR'];
    if (capture != null && Platform.isWindows) {
      await tester.runAsync(() async {
        final loader = FontLoader('QA')
          ..addFont(
            File('C:/Windows/Fonts/msyh.ttc')
                .readAsBytes()
                .then((bytes) => ByteData.sublistView(bytes)),
          );
        await loader.load();
        final icons = FontLoader('MaterialIcons')
          ..addFont(
            File(
              '../.tools/flutter/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
            ).readAsBytes().then((bytes) => ByteData.sublistView(bytes)),
          );
        await icons.load();
      });
    }
    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData(
          fontFamily: capture == null ? null : 'QA',
          colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(0xffa64272),
            brightness: Brightness.dark,
          ),
        ),
        home: Scaffold(
          body: RepaintBoundary(
            key: const ValueKey('capture'),
            child: ColoredBox(
              color: const Color(0xff161b23),
              child: PlayerControls(
                full: full,
                visible: visible,
                playing: true,
                loading: false,
                position: const Duration(minutes: 4, seconds: 32),
                duration: const Duration(minutes: 24),
                title: '属于今天的故事',
                subtitle: '播放线路 1 · 第 03 集',
                rate: 1,
                onPlay: () {},
                onFullscreen: onFullscreen ?? () {},
                onEpisodes: () {},
                onSettings: () {},
                onSkip: () {},
                onSeek: onSeek ?? (_) {},
                onSeekStart: () {},
                onActivity: () {},
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets(
    'compact fullscreen remains a large reachable target when controls are hidden',
    (tester) async {
      var taps = 0;
      await mount(
        tester,
        size: const Size(320, 180),
        full: false,
        visible: false,
        onFullscreen: () => taps++,
      );
      final button = find.widgetWithText(TextButton, '全屏').hitTestable();
      expect(tester.getSize(button).height, greaterThanOrEqualTo(48));
      await tester.tap(button);
      expect(taps, 1);
      expect(tester.takeException(), isNull);
      expect(playerControlsTimeout.inSeconds, greaterThanOrEqualTo(8));
    },
  );
  for (final size in [
    const Size(320, 180),
    const Size(568, 320),
    const Size(812, 375),
  ]) {
    testWidgets(
      'player controls fit $size and seeking is committed only on release',
      (tester) async {
        final seeks = <Duration>[];
        await mount(
          tester,
          size: size,
          full: size.width > 400,
          onSeek: seeks.add,
        );
        expect(tester.takeException(), isNull);
        final slider = find.byType(Slider);
        final gesture = await tester.startGesture(tester.getCenter(slider));
        await gesture.moveBy(const Offset(20, 0));
        await tester.pump();
        await gesture.moveBy(const Offset(20, 0));
        await tester.pump();
        expect(seeks, isEmpty);
        await gesture.up();
        await tester.pump();
        expect(seeks, hasLength(1));
        final capture = Platform.environment['ANIME_CAPTURE_DIR'];
        if (capture != null && size.width == 812) {
          await tester.pumpAndSettle();
          await tester.runAsync(() async {
            final boundary = tester.renderObject<RenderRepaintBoundary>(
              find.byKey(const ValueKey('capture')),
            );
            final image = await boundary.toImage(pixelRatio: 1.5);
            final bytes = await image.toByteData(
              format: ui.ImageByteFormat.png,
            );
            await Directory(capture).create(recursive: true);
            await File('$capture/player-fullscreen.png')
                .writeAsBytes(bytes!.buffer.asUint8List());
            image.dispose();
          });
        }
      },
    );
  }
}
