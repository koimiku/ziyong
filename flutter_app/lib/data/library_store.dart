import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import '../domain/library_backup.dart';

class LibraryStore {
  LibraryStore(this.database);
  final Database database;

  static Future<LibraryStore> open({
    DatabaseFactory? factory,
    String? path,
  }) async {
    if (factory == null && Platform.isWindows) {
      sqfliteFfiInit();
      factory = databaseFactoryFfi;
    }
    factory ??= databaseFactory;
    path ??= p.join(
      (await getApplicationSupportDirectory()).path,
      'library.sqlite',
    );
    final db = await factory.openDatabase(
      path,
      options: OpenDatabaseOptions(
        version: 1,
        onOpen: (db) => db.execute(
          'CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
        ),
        onCreate: (db, version) async {
          await db.execute(
            'CREATE TABLE records (section TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(section, id))',
          );
          await db.execute(
            'CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
          );
          await db.execute(
            'CREATE TABLE recovery (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)',
          );
        },
      ),
    );
    return LibraryStore(db);
  }

  Future<LibraryBackup> read([DatabaseExecutor? executor]) async {
    final db = executor ?? database;
    final records = await db.query('records');
    List<JsonMap> section(String name) => records
        .where((row) => row['section'] == name)
        .map((row) => jsonDecode(row['payload'] as String) as JsonMap)
        .toList();
    return LibraryBackup(
      collection: section('collection'),
      history: section('history'),
      rules: section('rules'),
      settings: {
        for (final row in await db.query('settings'))
          row['key'] as String: row['value'] as String,
      },
    );
  }

  Future<JsonMap> setStatus(Subject subject, String status) async {
    if (status.isNotEmpty && !collectionLabels.containsKey(status)) {
      throw ArgumentError('收藏状态无效');
    }
    return database.transaction((txn) async {
      final existing = await txn.query(
        'records',
        where: 'section = ? AND id = ?',
        whereArgs: ['collection', subject.id],
      );
      final previous = existing.isEmpty
          ? <String, dynamic>{}
          : jsonDecode(existing.first['payload'] as String) as JsonMap;
      final now = DateTime.now().millisecondsSinceEpoch;
      final previousTime =
          (num.tryParse('${previous['collectionUpdatedAt']}') ?? 0).toInt();
      final row = {
        ...previous,
        ...subject.toCollection(),
        'collectionStatus': status,
        'collectionUpdatedAt': now > previousTime ? now : previousTime + 1,
        'collectionPending': status.isNotEmpty,
        'collectionExcluded': status.isEmpty,
      };
      await txn.insert('records', {
        'section': 'collection',
        'id': subject.id,
        'payload': jsonEncode(row),
      }, conflictAlgorithm: ConflictAlgorithm.replace);
      return row;
    });
  }

  Future<void> seedRules(List<JsonMap> rules) =>
      database.transaction((txn) async {
        if ((await txn.query(
          'metadata',
          where: 'key = ?',
          whereArgs: ['rules-seeded'],
        )).isNotEmpty) {
          return;
        }
        if ((await txn.query(
          'records',
          where: 'section = ?',
          whereArgs: ['rules'],
          limit: 1,
        )).isEmpty) {
          for (final rule in rules) {
            await txn.insert('records', {
              'section': 'rules',
              'id': rule['name'],
              'payload': jsonEncode(rule),
            });
          }
        }
        await txn.insert('metadata', {'key': 'rules-seeded', 'value': '1'});
      });

  Future<void> putHistory(JsonMap row) => database.transaction((txn) async {
    await txn.insert('records', {
      'section': 'history',
      'id': '${row['id']}',
      'payload': jsonEncode(row),
    }, conflictAlgorithm: ConflictAlgorithm.replace);
    await txn.delete(
      'metadata',
      where: 'key = ?',
      whereArgs: ['history-excluded:${row['id']}'],
    );
  });

  Future<void> mergeRemoteCollections(List<JsonMap> incoming) =>
      database.transaction((txn) async {
        final current = (await read(txn)).collection;
        final result = {for (final row in current) '${row['id']}': row};
        for (final row in incoming) {
          final previous = result['${row['id']}'];
          if (previous?['collectionPending'] == true ||
              previous?['collectionExcluded'] == true) {
            continue;
          }
          if (previous != null &&
              (num.tryParse('${previous['collectionUpdatedAt']}') ?? 0) >
                  (num.tryParse('${row['collectionUpdatedAt']}') ?? 0)) {
            continue;
          }
          result['${row['id']}'] = {...?previous, ...row};
        }
        for (final row in result.values) {
          await txn.insert('records', {
            'section': 'collection',
            'id': '${row['id']}',
            'payload': jsonEncode(row),
          }, conflictAlgorithm: ConflictAlgorithm.replace);
        }
      });
  Future<void> acknowledgeCollection(JsonMap snapshot) =>
      database.transaction((txn) async {
        final rows = await txn.query(
          'records',
          where: 'section = ? AND id = ?',
          whereArgs: ['collection', '${snapshot['id']}'],
        );
        if (rows.isEmpty) return;
        final row = jsonDecode(rows.single['payload'] as String) as JsonMap;
        if (row['collectionUpdatedAt'] != snapshot['collectionUpdatedAt'] ||
            row['collectionStatus'] != snapshot['collectionStatus']) {
          return;
        }
        row['collectionPending'] = false;
        await txn.update(
          'records',
          {'payload': jsonEncode(row)},
          where: 'section = ? AND id = ?',
          whereArgs: ['collection', '${snapshot['id']}'],
        );
      });
  Future<void> removeRecord(String section, String id) =>
      database.transaction((txn) async {
        await txn.delete(
          'records',
          where: 'section = ? AND id = ?',
          whereArgs: [section, id],
        );
        if (section == 'history') {
          await txn.insert('metadata', {
            'key': 'history-excluded:$id',
            'value': '1',
          }, conflictAlgorithm: ConflictAlgorithm.replace);
        }
      });

  Future<void> mergeRemoteHistory(
    List<JsonMap> incoming,
  ) => database.transaction((txn) async {
    final local = {
      for (final row in (await read(txn)).history) '${row['id']}': row,
    };
    final excluded =
        (await txn.query(
              'metadata',
              where: 'key LIKE ?',
              whereArgs: ['history-excluded:%'],
            ))
            .map((row) => '${row['key']}'.substring('history-excluded:'.length))
            .toSet();
    int number(dynamic progress) => progress is Map
        ? int.tryParse(
                RegExp(r'\d+').firstMatch(
                      '${progress['episodeNumber'] ?? progress['episodeLabel'] ?? ''}',
                    )?[0] ??
                    '',
              ) ??
              0
        : 0;
    for (final remote in incoming) {
      if (excluded.contains('${remote['id']}')) continue;
      final previous = local['${remote['id']}'];
      if (previous != null &&
          (number(previous['progress']) >= number(remote['progress']) ||
              (num.tryParse('${previous['watchedAt']}') ?? 0) >=
                  (num.tryParse('${remote['watchedAt']}') ?? 0))) {
        continue;
      }
      final row = {...?previous, ...remote};
      await txn.insert('records', {
        'section': 'history',
        'id': '${row['id']}',
        'payload': jsonEncode(row),
      }, conflictAlgorithm: ConflictAlgorithm.replace);
    }
  });
  Future<String?> metadata(String key) async =>
      (await database.query(
            'metadata',
            where: 'key = ?',
            whereArgs: [key],
          )).firstOrNull?['value']
          as String?;
  Future<void> setMetadata(String key, String value) => database
      .insert('metadata', {
        'key': key,
        'value': value,
      }, conflictAlgorithm: ConflictAlgorithm.replace)
      .then((_) {});

  Future<void> setSetting(String key, String value) async {
    if (!backupSettings.contains(key)) throw ArgumentError('设置无效');
    await database.insert('settings', {
      'key': key,
      'value': value,
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<void> restore(LibraryBackup incoming) async {
    await database.transaction((txn) async {
      final before = await read(txn);
      final merged = before.merge(incoming);
      await txn.insert('recovery', {
        'id': 1,
        'payload': before.encode(),
      }, conflictAlgorithm: ConflictAlgorithm.replace);
      await _write(txn, merged);
    });
  }

  Future<LibraryBackup?> recovery() async {
    final rows = await database.query('recovery', where: 'id = 1');
    return rows.isEmpty
        ? null
        : LibraryBackup.decode(rows.first['payload'] as String);
  }

  Future<void> _write(DatabaseExecutor txn, LibraryBackup value) async {
    await txn.delete('records');
    for (final entry in {
      'collection': value.collection,
      'history': value.history,
      'rules': value.rules,
    }.entries) {
      for (final row in entry.value) {
        if (entry.key == 'history') {
          await txn.delete(
            'metadata',
            where: 'key = ?',
            whereArgs: ['history-excluded:${row['id']}'],
          );
        }
        await txn.insert('records', {
          'section': entry.key,
          'id': '${row[entry.key == 'rules' ? 'name' : 'id']}',
          'payload': jsonEncode(row),
        });
      }
    }
    await txn.delete('settings');
    for (final entry in value.settings.entries) {
      await txn.insert('settings', {'key': entry.key, 'value': entry.value});
    }
  }

  Future<void> close() => database.close();
}
