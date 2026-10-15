import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:anime_flutter/app.dart';
import 'package:anime_flutter/app_controller.dart';
import 'package:anime_flutter/data/bangumi_catalog.dart';
import 'package:anime_flutter/data/library_store.dart';

const title = '这是一部名称比较长的测试番剧';
const subject = {'id': 42, 'name_cn': title, 'summary': '一段故事的开始。'};
http.Response response(Object value) =>
    http.Response.bytes(utf8.encode(jsonEncode(value)), 200);

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

  for (final width in [320.0, 393.0, 1280.0]) {
    testWidgets('catalog and settings adapt without overflow at width $width', (
      tester,
    ) async {
      tester.view.physicalSize = Size(width, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final catalog = BangumiCatalog(
        client: MockClient(
          (request) async => response([
            {
              'weekday': {'id': 1},
              'items': [subject],
            },
          ]),
        ),
      );
      addTearDown(catalog.close);
      await tester.pumpWidget(
        AnimeApp(controller: controller, catalog: catalog),
      );
      await tester.pumpAndSettle();
      expect(find.text(title), findsOneWidget);
      expect(find.text('特摄'), findsNothing);
      expect(tester.takeException(), isNull);
      expect(
        find.byType(NavigationRail),
        width >= 760 ? findsOneWidget : findsNothing,
      );
      await tester.tap(find.text('设置'));
      await tester.pumpAndSettle();
      expect(find.text('外观'), findsOneWidget);
      expect(find.text('晴蓝'), findsNWidgets(2));
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    });
  }

  testWidgets('a stale search cannot replace a newer search', (tester) async {
    final first = Completer<http.Response>();
    final catalog = BangumiCatalog(
      client: MockClient((request) async {
        if (request.method == 'POST') {
          if (jsonDecode(request.body)['keyword'] == 'first') {
            return first.future;
          }
          return response({
            'data': [
              {'id': 99, 'name_cn': '最新结果'},
            ],
          });
        }
        return response([
          {
            'weekday': {'id': 1},
            'items': [subject],
          },
        ]);
      }),
    );
    addTearDown(catalog.close);
    await tester.pumpWidget(AnimeApp(controller: controller, catalog: catalog));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'first');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pump();
    await tester.enterText(find.byType(TextField), 'second');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();
    expect(find.text('最新结果'), findsOneWidget);
    first.complete(
      response({
        'data': [
          {'id': 1, 'name_cn': '过时结果'},
        ],
      }),
    );
    await tester.pumpAndSettle();
    expect(find.text('过时结果'), findsNothing);
    expect(find.text('最新结果'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('detail starts uncollected and selecting a status persists it', (
    tester,
  ) async {
    final catalog = BangumiCatalog(
      client: MockClient(
        (request) async => response(
          request.url.path == '/calendar'
              ? [
                  {
                    'weekday': {'id': 1},
                    'items': [subject],
                  },
                ]
              : subject,
        ),
      ),
    );
    addTearDown(catalog.close);
    await tester.pumpWidget(AnimeApp(controller: controller, catalog: catalog));
    await tester.pumpAndSettle();
    await tester.tap(find.text(title));
    await tester.pumpAndSettle();
    expect(find.text('未收藏'), findsOneWidget);
    await tester.tap(find.text('未收藏'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('在看'));
    await tester.pumpAndSettle();
    expect(controller.status('42'), 'watching');
    expect(find.text('在看'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });
}
