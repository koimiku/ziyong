import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:anime_flutter/features/player_controls.dart';
import 'package:anime_flutter/features/episode_panel.dart';
import 'package:anime_flutter/rules/rule_engine.dart';

void main() {
  testWidgets(
    'toolbar gaps block video taps while buttons and hold events work',
    (tester) async {
      var background = 0, clicks = 0, starts = 0, ends = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Stack(
              children: [
                Positioned.fill(
                  child: GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onTap: () => background++,
                  ),
                ),
                Positioned(
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 80,
                  child: ControlHitRegion(
                    onStart: () => starts++,
                    onEnd: () => ends++,
                    child: Row(
                      children: [
                        const Expanded(child: SizedBox()),
                        IconButton(
                          onPressed: () => clicks++,
                          icon: const Icon(Icons.settings),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
      await tester.tapAt(const Offset(40, 40));
      expect(background, 0);
      expect(starts, 1);
      expect(ends, 1);
      await tester.tap(find.byType(IconButton));
      expect(clicks, 1);
      expect(background, 0);
      final held = await tester.startGesture(const Offset(40, 40));
      await tester.pump(const Duration(seconds: 7));
      expect(starts, 3);
      expect(ends, 2);
      await held.cancel();
      expect(ends, 3);
      expect(background, 0);
      await tester.tapAt(const Offset(40, 200));
      expect(background, 1);
    },
  );
  testWidgets('episode panel builds lazily and selects the displayed line', (
    tester,
  ) async {
    (int, int)? chosen;
    final lines = [
      EpisodeLine(
        '线路一',
        List.generate(1000, (i) => Episode('第${i + 1}集', '$i')),
      ),
      const EpisodeLine('线路二', [Episode('特别篇', 'special')]),
    ];
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SizedBox(
            width: 400,
            height: 320,
            child: EpisodePanel(
              lines: lines,
              line: 0,
              episode: 0,
              onSelect: (l, e) => chosen = (l, e),
              onClose: () {},
            ),
          ),
        ),
      ),
    );
    expect(find.text('第1000集'), findsNothing);
    await tester.tap(find.text('线路二'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('特别篇'));
    expect(chosen, (1, 0));
    expect(tester.takeException(), isNull);
  });
}
