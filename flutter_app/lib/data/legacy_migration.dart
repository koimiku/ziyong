import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';

import '../domain/library_backup.dart';
import 'library_store.dart';
import 'secrets.dart';

class LegacyMigration {
  static const channel = MethodChannel('anime/native');
  static Future<void> run(
    LibraryStore store,
    SecretStore secrets, {
    bool force = false,
    List<JsonMap> builtins = const [],
  }) async {
    if (!Platform.isAndroid ||
        !force && await store.metadata('legacy-migration') != null) {
      return;
    }
    final raw = await channel.invokeMethod<String>('legacySnapshot');
    if (raw == null || raw == 'null') {
      throw const FormatException('旧数据读取超时，可在设置中重试');
    }
    dynamic snapshot = jsonDecode(raw);
    if (snapshot is String) snapshot = jsonDecode(snapshot);
    if (snapshot is! Map) throw const FormatException('无法读取旧数据');
    dynamic read(String key, dynamic fallback) {
      try {
        return snapshot[key] == null ? fallback : jsonDecode(snapshot[key]);
      } catch (_) {
        return fallback;
      }
    }

    final oldRules = (read('anime-kazumi-rules-v1', {}) as Map).values
        .cast<JsonMap>()
        .toList();
    final hadLegacy = snapshot.values.any((value) => value != null);
    final backup = LibraryBackup.decode(
      LibraryBackup(
        collection: (read('anime-collection', []) as List).cast<JsonMap>(),
        history: (read('anime-watch-history', []) as List).cast<JsonMap>(),
        rules: [
          ...oldRules,
          if (hadLegacy)
            ...builtins.where(
              (rule) => !oldRules.any((old) => old['name'] == rule['name']),
            ),
        ],
        settings: {
          for (final key in backupSettings)
            if (snapshot[key] is String) key: snapshot[key],
        },
      ).encode(),
    );
    if (backup.collection.isNotEmpty ||
        backup.history.isNotEmpty ||
        backup.rules.isNotEmpty ||
        backup.settings.isNotEmpty) {
      await store.restore(backup);
    }
    if ('${snapshot['anime-bangumi-token'] ?? ''}'.isNotEmpty &&
        await secrets.read('bangumi-token') == null) {
      await secrets.write('bangumi-token', snapshot['anime-bangumi-token']);
      await secrets.write('bangumi-user', snapshot['anime-bangumi-user']);
    }
    final webdav = read('anime-webdav-config', null);
    if (webdav is Map && await secrets.read('webdav') == null) {
      await secrets.write('webdav', jsonEncode(webdav));
    }
    await store.setMetadata('legacy-migration', 'complete');
    await store.setMetadata('migration-error', '');
  }
}
