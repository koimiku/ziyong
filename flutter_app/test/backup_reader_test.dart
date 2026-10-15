import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:anime_flutter/data/backup_reader.dart';
import 'package:anime_flutter/domain/library_backup.dart';

void main() {
  test('imports streamed content without a filesystem path', () async {
    final bytes = utf8.encode(
      const LibraryBackup(
        collection: [
          {'id': 42, 'title': '测试'},
        ],
      ).encode(),
    );
    final value = await readBackupStream(
      Stream.fromIterable([bytes.sublist(0, 30), bytes.sublist(30)]),
    );
    expect(value.collection.single['title'], '测试');
  });
  test(
    'stops reading an oversized stream before decoding or committing data',
    () async {
      await expectLater(
        readBackupStream(
          Stream.fromIterable(
            List.generate(9, (_) => List.filled(1024 * 1024, 32)),
          ),
        ),
        throwsFormatException,
      );
    },
  );
}
