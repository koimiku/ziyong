import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:anime_flutter/app_controller.dart';
import 'package:anime_flutter/data/library_store.dart';
import 'package:anime_flutter/data/rule_tools.dart';
import 'package:anime_flutter/domain/library_backup.dart';
import 'package:anime_flutter/features/rule_repository.dart';

JsonMap fixture(String name, [String version = '1.0']) => {
  'name': name,
  'version': version,
  'baseUrl': 'https://example.com/',
  'searchURL': '/search?q=@keyword',
  'searchList': '//li',
  'searchName': '//a',
  'searchResult': '//a',
  'chapterRoads': '//ul',
  'chapterResult': '//li/a',
};
void main() {
  test('rule versions compare numerically rather than lexically', () {
    expect(compareRuleVersions('1.10', '1.9'), greaterThan(0));
    expect(compareRuleVersions('1.0', '1.0.0'), 0);
    expect(compareRuleVersions(null, '1.0'), lessThan(0));
  });
  test(
    'repository rejects mismatched names and stale downloaded versions',
    () async {
      final repository = RuleRepository(
        request: (_) async => jsonEncode(fixture('other')),
      );
      await expectLater(
        repository.fetch({'name': 'test', 'version': '1.0'}),
        throwsFormatException,
      );
      repository.close();
      final stale = RuleRepository(
        request: (_) async => jsonEncode(fixture('test', '1.9')),
      );
      await expectLater(
        stale.fetch({'name': 'test', 'version': '1.10'}),
        throwsFormatException,
      );
      stale.close();
    },
  );
  test('health checks bound concurrency, skip disabled rules and report results honestly', () async {
    var active = 0, maximum = 0, requests = 0;
    final monitor = RuleHealthMonitor(
      request: (_) async {
        requests++;
        active++;
        if (active > maximum) maximum = active;
        await Future<void>.delayed(const Duration(milliseconds: 10));
        active--;
        return '<li><a href="/show/1">海贼王</a></li>';
      },
    );
    await monitor.check([
      fixture('a'),
      fixture('b'),
      fixture('c'),
      {...fixture('off'), 'disabled': true},
    ]);
    expect(maximum, 2);
    expect(requests, 3);
    expect(monitor.results.length, 3);
    expect(
      monitor.results.values.every(
        (result) => result.ok && result.label.contains('搜索正常'),
      ),
      isTrue,
    );
    monitor.dispose();
    final empty = RuleHealthMonitor(
      request: (_) async => '<html><body>no matches</body></html>',
    );
    await empty.check([fixture('a')]);
    expect(empty.results['a']!.label, contains('暂无搜索结果'));
    empty.dispose();
  });
  test(
    'stopping checks prevents late results and supports immediate restart',
    () async {
      final pending = Completer<String>();
      var calls = 0;
      final monitor = RuleHealthMonitor(
        request: (_) =>
            ++calls == 1 ? pending.future : Future.value('<html></html>'),
      );
      final old = monitor.check([fixture('old')]);
      monitor.stop();
      await monitor.check([fixture('new')]);
      pending.complete('<li><a href="/old">old</a></li>');
      await old;
      expect(monitor.results.keys, ['new']);
      monitor.dispose();
    },
  );
  test('timeouts do not leave the monitor running', () async {
    final monitor = RuleHealthMonitor(
      request: (_) => Completer<String>().future,
      timeout: const Duration(milliseconds: 10),
    );
    await monitor.check([fixture('a')]);
    expect(monitor.results['a']!.label, '连接超时');
    expect(monitor.running, isFalse);
    monitor.dispose();
  });
  sqfliteFfiInit();
  testWidgets(
    'batch installation updates status, preserves disabled rules and retries failed downloads',
    (tester) async {
      final store = await LibraryStore.open(
        factory: databaseFactoryFfiNoIsolate,
        path: inMemoryDatabasePath,
      );
      final controller = AppController(store, await store.read());
      await controller.restore(
        LibraryBackup(
          rules: [
            {...fixture('old'), 'disabled': true},
          ],
        ),
      );
      var fail = true;
      final repository = RuleRepository(
        request: (request) async {
          if (request.url.endsWith('index.json')) {
            return jsonEncode([
              {'name': 'old', 'version': '1.10'},
              {'name': 'new', 'version': '1.0'},
              {'name': 'retry', 'version': '1.0'},
            ]);
          }
          if (request.url.endsWith('/retry.json') && fail) {
            throw const FormatException('network');
          }
          final name = Uri.parse(request.url).pathSegments.last
              .split('.')
              .first;
          return jsonEncode(fixture(name, name == 'old' ? '1.10' : '1.0'));
        },
      );
      await tester.pumpWidget(
        MaterialApp(
          home: RuleRepositoryPage(
            controller: controller,
            repository: repository,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('一键安装 (2)'), findsOneWidget);
      expect(find.textContaining('已安装 · 可更新'), findsOneWidget);
      await tester.tap(find.text('一键安装 (2)'));
      await tester.pumpAndSettle();
      expect(controller.library.rules.length, 2);
      expect(find.text('一键安装 (1)'), findsOneWidget);
      fail = false;
      await tester.tap(find.text('一键安装 (1)'));
      await tester.pumpAndSettle();
      expect(find.text('全部已安装'), findsOneWidget);
      await tester.tap(find.text('更新全部 (1)'));
      await tester.pumpAndSettle();
      expect(
        controller.library.rules.firstWhere(
          (rule) => rule['name'] == 'old',
        )['disabled'],
        isTrue,
      );
      expect(find.text('更新全部 (1)'), findsNothing);
      await tester.pumpWidget(const SizedBox());
      controller.dispose();
      await store.close();
    },
  );
}
