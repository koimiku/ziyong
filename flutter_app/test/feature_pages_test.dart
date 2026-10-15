import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:anime_flutter/app_controller.dart';
import 'package:anime_flutter/data/library_store.dart';
import 'package:anime_flutter/domain/library_backup.dart';
import 'package:anime_flutter/features/startup.dart';
import 'package:anime_flutter/features/source_page.dart';
import 'package:anime_flutter/features/history_page.dart';
import 'package:anime_flutter/data/tokusatsu.dart';

void main() {
  sqfliteFfiInit();
  late LibraryStore store;
  late AppController controller;
  setUp(() async {
    store = await LibraryStore.open(
      factory: databaseFactoryFfiNoIsolate,
      path: inMemoryDatabasePath,
    );
    controller = AppController(store, await store.read());
  });
  tearDown(() async {
    controller.dispose();
    await store.close();
  });
  testWidgets(
    'disabled startup opens immediately and malformed images cannot block launch',
    (tester) async {
      await controller.setSetting(
        'anime-startup',
        jsonEncode({'enabled': true, 'image': 'data:image/png;base64,????'}),
      );
      await tester.pumpWidget(
        MaterialApp(
          home: StartupGate(
            controller: controller,
            child: const Scaffold(body: Text('首页内容')),
          ),
        ),
      );
      expect(find.text('首页内容'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets('enabled startup can be skipped without waiting for its timer', (
    tester,
  ) async {
    await controller.setSetting(
      'anime-startup',
      jsonEncode({'enabled': true, 'image': ''}),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: StartupGate(
          controller: controller,
          child: const Scaffold(body: Text('首页内容')),
        ),
      ),
    );
    expect(find.text('首页内容'), findsNothing);
    await tester.tap(find.text('跳过'));
    await tester.pump();
    expect(find.text('首页内容'), findsOneWidget);
  });
  for (final width in [320.0, 393.0, 1280.0]) {
    testWidgets('rule management and editor remain usable at width $width', (
      tester,
    ) async {
      tester.view.physicalSize = Size(width, 852);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        MaterialApp(home: RuleLibraryPage(controller: controller)),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.tap(find.byTooltip('添加规则'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('新建规则'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('校验与格式化'));
      await tester.pumpAndSettle();
      expect(find.text('校验通过'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.tap(find.text('保存'));
      await tester.pumpAndSettle();
      expect(controller.library.rules.single['name'], 'my-rule');
    });
  }
  testWidgets('history deletion persists and refreshes its list', (
    tester,
  ) async {
    await controller.recordProgress(const Subject({'id': 42, 'name': '测试番剧'}), {
      'episodeNumber': '第1集',
      'position': 85,
    });
    await tester.pumpWidget(
      MaterialApp(home: HistoryPage(controller: controller)),
    );
    expect(find.text('测试番剧'), findsOneWidget);
    await tester.tap(find.byTooltip('删除记录'));
    await tester.pumpAndSettle();
    expect(find.text('看过的番剧会出现在这里'), findsOneWidget);
    expect((await store.read()).history, isEmpty);
  });
  test('Tokusatsu cards preserve their partition and deduplicate cover/title links', () {
    final rows = parseTokusatsu(
      '<div class="item"><a href="/watch/example.html" title="Example"><img src="/poster.jpg"></a><a href="/watch/example.html">Example</a></div>',
    );
    expect(rows, hasLength(1));
    expect(rows.single.id, 'tz:example');
    expect(rows.single.cover, 'https://tokuzilla.net/poster.jpg');
    expect(rows.single.data['partition'], 'tokusatsu');
  });
}
