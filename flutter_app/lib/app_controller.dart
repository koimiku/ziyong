import 'dart:async';

import 'package:flutter/foundation.dart';

import 'data/bangumi_sync.dart';
import 'data/secrets.dart';
import 'data/phone_server.dart';

import 'data/library_store.dart';
import 'domain/library_backup.dart';

class AppController extends ChangeNotifier {
  AppController(this.store, this.library);
  final LibraryStore store;
  LibraryBackup library;
  final settingsChanges = ChangeNotifier();
  final historyChanges = ChangeNotifier();
  final secrets = SecretStore();
  late final bangumi = BangumiSync(this, secrets);
  late final phone = PhoneServer(this);
  Future<void> initializeServices() => bangumi.initialize();
  Future<void> mergeRemoteHistory(List<JsonMap> rows) async {
    await store.mergeRemoteHistory(rows);
    await _reload();
    historyChanges.notifyListeners();
  }

  Future<void> mergeRemoteCollections(List<JsonMap> rows) async {
    await store.mergeRemoteCollections(rows);
    await _reload();
  }

  Future<void> acknowledgeCollection(JsonMap row) async {
    await store.acknowledgeCollection(row);
    library = LibraryBackup(
      collection: library.collection
          .map(
            (current) =>
                '${current['id']}' == '${row['id']}' &&
                    current['collectionUpdatedAt'] ==
                        row['collectionUpdatedAt'] &&
                    current['collectionStatus'] == row['collectionStatus']
                ? {...current, 'collectionPending': false}
                : current,
          )
          .toList(),
      history: library.history,
      rules: library.rules,
      settings: library.settings,
    );
  }

  Future<void> removeRecord(String section, String id) async {
    await store.removeRecord(section, id);
    await _reload();
    historyChanges.notifyListeners();
  }

  String setting(String key, String fallback) {
    final value = library.settings[key] ?? fallback;
    if (key == 'anime-theme' && !{'system', 'light', 'dark'}.contains(value)) {
      return fallback;
    }
    if (key.startsWith('anime-palette-') &&
        !{
          'blue',
          'pink',
          'purple',
          'green',
          'orange',
          'teal',
        }.contains(value)) {
      return fallback;
    }
    return value;
  }

  String status(String id) =>
      library.collection
          .where((row) => '${row['id']}' == id)
          .map((row) => '${row['collectionStatus'] ?? ''}')
          .firstOrNull ??
      '';
  Future<void> _reload() async {
    final settings = library.settings;
    library = await store.read();
    if (!mapEquals(settings, library.settings)) {
      settingsChanges.notifyListeners();
    }
    notifyListeners();
  }

  Future<void> setStatus(Subject subject, String value) async {
    final row = await store.setStatus(subject, value);
    library = LibraryBackup(
      collection: [
        row,
        ...library.collection.where((item) => '${item['id']}' != subject.id),
      ],
      history: library.history,
      rules: library.rules,
      settings: library.settings,
    );
    notifyListeners();
    bangumi.schedule();
  }

  Future<void> setSetting(String key, String value) async {
    await store.setSetting(key, value);
    library = LibraryBackup(
      collection: library.collection,
      history: library.history,
      rules: library.rules,
      settings: {...library.settings, key: value},
    );
    settingsChanges.notifyListeners();
  }

  Future<void> restore(LibraryBackup value) async {
    await store.restore(value);
    await _reload();
    if (value.collection.isNotEmpty || value.history.isNotEmpty) {
      bangumi.schedule();
    }
  }

  Future<void> recordProgress(Subject subject, JsonMap progress) async {
    final previous = library.history
        .where((row) => '${row['id']}' == subject.id)
        .firstOrNull?['progress'];
    final row = {
      ...subject.toCollection(),
      'watchedAt': DateTime.now().millisecondsSinceEpoch,
      'progress': {
        ...progress,
        'updatedAt': DateTime.now().millisecondsSinceEpoch,
      },
    };
    await store.putHistory(row);
    final isNew = !library.history.any((item) => '${item['id']}' == subject.id);
    library = LibraryBackup(
      collection: library.collection,
      history: [
        row,
        ...library.history.where((item) => '${item['id']}' != subject.id),
      ],
      rules: library.rules,
      settings: library.settings,
    );
    if (isNew) notifyListeners();
    historyChanges.notifyListeners();
    if (previous is! Map ||
        episodeNumber(previous) != episodeNumber(progress)) {
      bangumi.schedule();
    }
  }

  @override
  void dispose() {
    bangumi.dispose();
    unawaited(phone.dispose());
    historyChanges.dispose();
    settingsChanges.dispose();
    super.dispose();
  }
}
