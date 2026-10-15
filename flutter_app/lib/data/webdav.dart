import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../domain/library_backup.dart';

class WebdavConnection {
  WebdavConnection(String url, this.username, this.password)
    : uri = Uri.parse(url.trim()) {
    if (!{'http', 'https'}.contains(uri.scheme) ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty ||
        uri.hasQuery ||
        uri.hasFragment ||
        username.contains(':')) {
      throw const FormatException('请输入有效的 WebDAV 目录地址和用户名');
    }
  }
  final Uri uri;
  final String username, password;
  Uri target(String file) => uri.replace(
    path: '${uri.path.endsWith('/') ? uri.path : '${uri.path}/'}$file',
  );
}

class WebdavClient {
  WebdavClient({http.Client? client}) : client = client ?? http.Client();
  final http.Client client;
  Future<String> request(
    WebdavConnection connection,
    String method, {
    String file = '',
    String? body,
  }) async {
    final request = http.Request(method, connection.target(file))
      ..followRedirects = false;
    request.headers.addAll({
      'Content-Type': method == 'PROPFIND'
          ? 'application/xml; charset=utf-8'
          : 'application/json; charset=utf-8',
      if (method == 'PROPFIND') 'Depth': '0',
      if (connection.username.isNotEmpty)
        'Authorization':
            'Basic ${base64Encode(utf8.encode('${connection.username}:${connection.password}'))}',
    });
    if (body != null) request.body = body;
    final response = await client
        .send(request)
        .timeout(const Duration(seconds: 25));
    final bytes = <int>[];
    await for (final chunk in response.stream.timeout(
      const Duration(seconds: 25),
    )) {
      if (bytes.length + chunk.length > 8 * 1024 * 1024) {
        throw const FormatException('备份超过 8 MB');
      }
      bytes.addAll(chunk);
    }
    if (response.statusCode >= 300 && response.statusCode < 400) {
      throw const FormatException('请使用实际 WebDAV 地址，备份请求不跟随重定向');
    }
    if (response.statusCode == 401) {
      throw const FormatException('WebDAV 账号或密码错误');
    }
    if (response.statusCode == 404) {
      throw FormatException(method == 'PROPFIND' ? 'WebDAV 目录不存在' : '没有找到备份文件');
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw FormatException('WebDAV 请求失败（${response.statusCode}）');
    }
    return utf8.decode(bytes);
  }

  Future<void> test(WebdavConnection connection) => request(
    connection,
    'PROPFIND',
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
  ).then((_) {});
  Future<void> upload(WebdavConnection connection, LibraryBackup backup) async {
    final body = backup.encode();
    if (utf8.encode(body).length > 8 * 1024 * 1024) {
      throw const FormatException('备份超过 8 MB');
    }
    final stamp = DateTime.now().toUtc().toIso8601String().replaceAll(
      RegExp(r'[:.]'),
      '-',
    );
    await request(
      connection,
      'PUT',
      file: 'anime-backup-$stamp.json',
      body: body,
    );
    await request(connection, 'PUT', file: 'anime-backup.json', body: body);
  }

  Future<LibraryBackup> download(WebdavConnection connection) async =>
      LibraryBackup.decode(
        await request(connection, 'GET', file: 'anime-backup.json'),
      );
  void close() => client.close();
}
