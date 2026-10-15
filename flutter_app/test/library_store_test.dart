import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:anime_flutter/data/library_store.dart';
import 'package:anime_flutter/domain/library_backup.dart';

void main() {
  sqfliteFfiInit();
  late LibraryStore store;
  setUp(() async {
    store = await LibraryStore.open(
      factory: databaseFactoryFfi,
      path: inMemoryDatabasePath,
    );
  });
  tearDown(() => store.close());
  test(
    'default rules seed only once and never replace imported rules',
    () async {
      const rule = {'name': 'default'};
      await store.seedRules([rule]);
      expect((await store.read()).rules.single['name'], 'default');
      await store.database.delete(
        'records',
        where: 'section = ?',
        whereArgs: ['rules'],
      );
      await store.seedRules([rule]);
      expect((await store.read()).rules, isEmpty);
    },
  );
  test(
    'progress replaces one subject record and survives a new read',
    () async {
      await store.putHistory({
        'id': 42,
        'progress': {'position': 15},
      });
      await store.putHistory({
        'id': 42,
        'progress': {'position': 85},
      });
      final history = (await store.read()).history;
      expect(history, hasLength(1));
      expect(history.single['progress']['position'], 85);
    },
  );
  test(
    'collection changes preserve an excluded tombstone and survive a new read',
    () async {
      const subject = Subject({'id': 42, 'name': '测试番剧'});
      await store.setStatus(subject, 'watching');
      expect((await store.read()).collection.single['collectionPending'], true);
      await store.setStatus(subject, '');
      final row = (await store.read()).collection.single;
      expect(row['collectionExcluded'], true);
      expect(row['collectionStatus'], '');
      expect(row['title'], '测试番剧');
    },
  );
  test(
    'restore merges in one transaction and retains the before-import snapshot',
    () async {
      await store.setStatus(const Subject({'id': 42}), 'planned');
      final before = await store.read();
      await store.restore(
        const LibraryBackup(
          collection: [
            {
              'id': 99,
              'collectionStatus': 'completed',
              'collectionUpdatedAt': 100,
            },
          ],
        ),
      );
      expect((await store.read()).collection, hasLength(2));
      expect((await store.recovery())!.collection, before.collection);
      expect((await store.recovery())!.rules, before.rules);
    },
  );
  test(
    'a failed write rolls back both library and recovery snapshot',
    () async {
      await store.setStatus(const Subject({'id': 42}), 'watching');
      final before = await store.read();
      await store.database.execute(
        "CREATE TRIGGER reject_restore BEFORE INSERT ON settings BEGIN SELECT RAISE(ABORT, 'simulated disk write failure'); END;",
      );
      await expectLater(
        store.restore(const LibraryBackup(settings: {'anime-theme': 'dark'})),
        throwsA(isA<DatabaseException>()),
      );
      expect((await store.read()).collection, before.collection);
      expect(await store.recovery(), isNull);
    },
  );
}
