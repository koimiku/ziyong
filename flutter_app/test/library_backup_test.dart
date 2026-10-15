import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:anime_flutter/domain/library_backup.dart';

void main() {
  test('legacy backup preserves local exclusions, sync state and arbitrary rule data', () {
    final source = LibraryBackup(
      collection: [
        {
          'id': 42,
          'title': '测试番剧',
          'collectionStatus': 'watching',
          'collectionPending': true,
        },
        {'id': '99', 'collectionStatus': '', 'collectionExcluded': true},
      ],
      history: [
        {
          'id': 42,
          'progress': {'position': 85, 'episodeLabel': '第1集'},
        },
      ],
      rules: [
        {
          'name': 'example',
          'baseURL': 'https://example.com',
          'searchURL': '/?q={keyword}',
          'searchList': '//li',
          'searchName': './/a',
          'searchResult': './/a/@href',
          'chapterRoads': '//ul',
          'chapterResult': './/a',
          'customField': 'keep',
        },
      ],
      settings: {
        'anime-theme': 'dark',
        'anime-palette-light': 'blue',
        'anime-palette-dark': 'pink',
      },
    );
    final imported = LibraryBackup.decode(source.encode());
    expect(imported.collection, source.collection);
    expect(imported.history, source.history);
    expect(imported.rules, source.rules);
    expect(imported.settings, source.settings);
  });
  test('merge deduplicates numeric/string IDs and keeps newer removals', () {
    final local = LibraryBackup(
      collection: [
        {
          'id': 1,
          'collectionStatus': '',
          'collectionExcluded': true,
          'collectionUpdatedAt': 200,
        },
      ],
    );
    final remote = LibraryBackup(
      collection: [
        {'id': '1', 'collectionStatus': 'planned', 'collectionUpdatedAt': 100},
      ],
    );
    final merged = local.merge(remote);
    expect(merged.collection, hasLength(1));
    expect(merged.collection.single['collectionExcluded'], true);
  });
  test('rejects account secrets, incomplete rules and unsupported schemas', () {
    final source =
        jsonDecode(const LibraryBackup().encode()) as Map<String, dynamic>;
    expect(
      () => LibraryBackup.decode(jsonEncode({...source, 'schema': 2})),
      throwsFormatException,
    );
    expect(
      () => LibraryBackup.decode(
        jsonEncode({
          ...source,
          'settings': {'anime-bangumi-token': 'private'},
        }),
      ),
      throwsFormatException,
    );
    expect(
      () => LibraryBackup.decode(
        jsonEncode({
          ...source,
          'rules': [
            {'name': 'incomplete'},
          ],
        }),
      ),
      throwsFormatException,
    );
    expect(
      () => LibraryBackup.decode(
        jsonEncode({
          ...source,
          'history': [
            {'id': null},
          ],
        }),
      ),
      throwsFormatException,
    );
  });
}
