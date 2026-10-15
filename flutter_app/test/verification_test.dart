import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:anime_flutter/rules/captcha.dart';
import 'package:anime_flutter/rules/rule_engine.dart';
import 'package:anime_flutter/rules/verification_dialog.dart';
import 'package:anime_flutter/features/player_controls.dart';

const image =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
void main() {
  test(
    'fullscreen controls stay visible unless auto-hide is explicitly enabled',
    () {
      expect(controlsTimeout(fullscreen: true), isNull);
      expect(
        controlsTimeout(fullscreen: true, autoHideFullscreen: true),
        const Duration(seconds: 15),
      );
      expect(controlsTimeout(fullscreen: false), const Duration(seconds: 8));
    },
  );
  test('verification only completes after observing a captcha followed by two complete pages', () {
    final state = CaptchaState();
    const absent = {'ready': true, 'present': false};
    expect(state.update(absent), isFalse);
    expect(state.update(absent), isFalse);
    state.message = '等待页面';
    expect(
      state.update(
        jsonEncode({
          'ready': true,
          'present': true,
          'canSubmit': true,
          'image': 'data:image/png;base64,$image',
        }),
      ),
      isFalse,
    );
    expect(state.image, isNotEmpty);
    expect(state.message, isEmpty);
    state.submitted = true;
    expect(
      state.update({'present': true, 'canSubmit': true, 'alert': '验证码错误'}),
      isFalse,
    );
    expect(state.submitted, isFalse);
    expect(state.message, '验证码错误');
    expect(state.update(absent), isFalse);
    expect(state.update({'ready': false, 'present': false}), isFalse);
    expect(state.update(absent), isFalse);
    expect(
      state.update({'ready': true, 'present': false, 'challenge': true}),
      isFalse,
    );
    expect(state.update(absent), isFalse);
    expect(state.update(absent), isTrue);
    state.reset();
    expect(state.image, isNull);
    expect(state.update(absent), isFalse);
  });
  test(
    'captcha scripts encode user answers and selectors as JSON literals',
    () {
      const answer = '"; window.evil(); //';
      final script = captchaSubmit({
        'captchaInput': '//input[@name="verify"]',
      }, answer);
      expect(script, contains(jsonEncode(answer)));
      expect(script, contains(jsonEncode('//input[@name="verify"]')));
      expect(captchaProbe({}), contains('mac_verify_img'));
    },
  );
  test(
    'verification blocks application links and allows web challenge URLs',
    () {
      expect(isVerificationWebUrl('https://example.com/verify'), isTrue);
      expect(isVerificationWebUrl('intent://launch'), isFalse);
      expect(isVerificationWebUrl('javascript:alert(1)'), isFalse);
      expect(isVerificationWebUrl(null), isFalse);
    },
  );
  for (final size in [const Size(320, 852), const Size(740, 360)]) {
    testWidgets(
      'verification overlays the current page and returns its result at $size',
      (tester) async {
        tester.view.physicalSize = size;
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final answer = TextEditingController();
        var retries = 0, openings = 0, closed = 0;
        final challenge = SiteVerification(
          SourceRule({
            'name': 'test',
            'baseUrl': 'https://example.com/',
            'searchURL': '/s?q=@keyword',
            'searchList': '//li',
            'searchName': '//a',
            'searchResult': '//a',
            'chapterRoads': '//ul',
            'chapterResult': '//li/a',
          }),
          'https://example.com/verify',
        );
        await tester.pumpWidget(
          MaterialApp(
            home: Builder(
              builder: (context) => Scaffold(
                body: Column(
                  children: [
                    const Text('保留当前播放页'),
                    FilledButton(
                      onPressed: () async {
                        openings++;
                        final done = await showSiteVerification(
                          context,
                          challenge,
                          contentBuilder: (context) => VerificationDismissGuard(
                            onClosed: () => closed++,
                            child: Column(
                              children: [
                                TextButton(
                                  onPressed: () =>
                                      Navigator.pop(context, false),
                                  child: const Text('关闭验证'),
                                ),
                                Expanded(
                                  child: CaptchaPrompt(
                                    image: base64Decode(image),
                                    answer: answer,
                                    message: '',
                                    submitting: false,
                                    onSubmit: () {
                                      final before = closed;
                                      Navigator.pop(context, true);
                                      expect(closed, before + 1);
                                    },
                                    onRefresh: () {},
                                    onWebsite: () {},
                                  ),
                                ),
                              ],
                            ),
                          ),
                        );
                        if (done) retries++;
                      },
                      child: const Text('打开验证'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.text('打开验证'));
        await tester.pumpAndSettle();
        expect(find.byType(Dialog), findsOneWidget);
        expect(find.text('保留当前播放页'), findsOneWidget);
        expect(tester.takeException(), isNull);
        await tester.tap(find.text('关闭验证'));
        await tester.pumpAndSettle();
        expect(retries, 0);
        expect(closed, 1);
        await tester.tap(find.text('打开验证'));
        await tester.pumpAndSettle();
        await tester.scrollUntilVisible(
          find.text('验证并继续'),
          100,
          scrollable: find
              .descendant(
                of: find.byType(Dialog),
                matching: find.byWidgetPredicate(
                  (widget) =>
                      widget is Scrollable &&
                      widget.axisDirection == AxisDirection.down,
                ),
              )
              .last,
        );
        await tester.tap(find.text('验证并继续'));
        await tester.pumpAndSettle();
        expect(retries, 1);
        expect(openings, 2);
        expect(closed, 2);
        expect(find.text('保留当前播放页'), findsOneWidget);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
        answer.dispose();
      },
    );
  }
}
