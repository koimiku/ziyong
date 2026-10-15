import 'dart:convert';
import 'dart:typed_data';

import '../domain/library_backup.dart';

// Works with Android content URIs as well as Windows files, without requiring
// broad storage permissions or loading an arbitrarily large file into memory.
Future<LibraryBackup> readBackupStream(Stream<List<int>> stream) async {
  final bytes = BytesBuilder(copy: false);
  await for (final chunk in stream) {
    if (bytes.length + chunk.length > 8 * 1024 * 1024) {
      throw const FormatException('备份文件不能超过 8 MB');
    }
    bytes.add(chunk);
  }
  return LibraryBackup.decode(utf8.decode(bytes.takeBytes()));
}
