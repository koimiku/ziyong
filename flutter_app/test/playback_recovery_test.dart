import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:anime_flutter/domain/playback_recovery.dart';

void main() {
  late PlaybackRecovery recovery;
  late int attempts;
  late List<String> failures;
  late List<String?> notices;
  late bool wants;
  setUp(() {
    attempts = 0;
    failures = [];
    notices = [];
    wants = true;
    recovery = PlaybackRecovery(
      recover: () async {
        attempts++;
      },
      onFailure: failures.add,
      onNotice: notices.add,
      wantsPlayback: () => wants,
    );
    recovery.begin();
  });
  tearDown(() => recovery.cancel());
  testWidgets('recoverable frame errors do not interrupt advancing media', (
    tester,
  ) async {
    recovery.error('Error decoding video');
    recovery.progress(const Duration(seconds: 1));
    recovery.progress(const Duration(seconds: 2));
    await tester.pump(const Duration(seconds: 4));
    expect(attempts, 0);
    expect(failures, isEmpty);
    expect(recovery.pending, false);
  });
  testWidgets(
    'stalled decode retries once and progress clears recovery notice',
    (tester) async {
      recovery.error('Error decoding audio');
      recovery.error('Error decoding video');
      await tester.pump(const Duration(seconds: 3));
      expect(attempts, 1);
      expect(notices.last, isNotNull);
      recovery.progress(const Duration(seconds: 1));
      recovery.progress(const Duration(seconds: 2));
      await tester.pump(const Duration(seconds: 11));
      expect(failures, isEmpty);
      expect(notices.last, isNull);
      recovery.error('Error decoding video');
      await tester.pump(const Duration(seconds: 3));
      expect(attempts, 1);
      expect(failures, hasLength(1));
    },
  );
  testWidgets('unrecoverable media times out without a retry loop', (
    tester,
  ) async {
    recovery.error('codec failed');
    await tester.pump(const Duration(seconds: 3));
    await tester.pump(const Duration(seconds: 11));
    expect(attempts, 1);
    expect(failures, hasLength(1));
  });
  testWidgets('network failure does not change decoder', (tester) async {
    recovery.error('HTTP 403');
    await tester.pump(const Duration(seconds: 3));
    expect(attempts, 0);
    expect(failures, hasLength(1));
  });
  testWidgets('software mode does not attempt another decoder fallback', (
    tester,
  ) async {
    recovery.begin(software: true);
    recovery.error('decoder failed');
    await tester.pump(const Duration(seconds: 3));
    expect(attempts, 0);
    expect(failures, hasLength(1));
  });
  testWidgets('pause and navigation invalidate scheduled recovery', (
    tester,
  ) async {
    recovery.error('decoder failed');
    wants = false;
    await tester.pump(const Duration(seconds: 3));
    expect(attempts, 0);
    wants = true;
    recovery.error('decoder failed');
    recovery.cancel();
    await tester.pump(const Duration(seconds: 3));
    expect(attempts, 0);
    expect(failures, isEmpty);
  });
  testWidgets('old async recovery cannot fail a newly opened episode', (
    tester,
  ) async {
    recovery.cancel();
    final gate = Completer<void>();
    recovery = PlaybackRecovery(
      recover: () => gate.future,
      onFailure: failures.add,
      onNotice: notices.add,
      wantsPlayback: () => true,
    );
    recovery.begin();
    recovery.error('decoder failed');
    await tester.pump(const Duration(seconds: 3));
    recovery.begin();
    gate.complete();
    await tester.pump();
    await tester.pump(const Duration(seconds: 20));
    expect(failures, isEmpty);
    expect(recovery.pending, false);
  });
}
