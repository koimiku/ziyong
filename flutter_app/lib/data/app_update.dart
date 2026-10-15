import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

const appVersion = '1.6.0';
const releasesUrl = 'https://github.com/koimiku/ziyong/releases';
bool newerVersion(String next, String current) {
  List<int> parts(String value) => value
      .replaceFirst(RegExp('^[vV]'), '')
      .split(RegExp('[.+-]'))
      .take(3)
      .map((part) => int.tryParse(part) ?? 0)
      .toList();
  final a = parts(next), b = parts(current);
  for (var i = 0; i < 3; i++) {
    final diff = (i < a.length ? a[i] : 0) - (i < b.length ? b[i] : 0);
    if (diff != 0) return diff > 0;
  }
  return false;
}

class AppRelease {
  const AppRelease(this.version, this.notes, this.url);
  final String version, notes, url;
}

Future<AppRelease> checkUpdate({http.Client? client, bool? android}) async {
  final ownClient = client == null;
  client ??= http.Client();
  try {
    final request = http.Request(
      'GET',
      Uri.parse('https://api.github.com/repos/koimiku/ziyong/releases/latest'),
    )..followRedirects = false;
    request.headers.addAll({
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'anime/$appVersion',
    });
    final response = await client
        .send(request)
        .timeout(const Duration(seconds: 20));
    final bytes = <int>[];
    await for (final chunk in response.stream.timeout(
      const Duration(seconds: 20),
    )) {
      if (bytes.length + chunk.length > 1024 * 1024) {
        throw const FormatException('更新信息过大');
      }
      bytes.addAll(chunk);
    }
    if (response.statusCode != 200) {
      throw const FormatException('暂时无法检查更新，可打开发布页查看');
    }
    final data = jsonDecode(utf8.decode(bytes)) as Map;
    final assets = (data['assets'] as List? ?? []).whereType<Map>();
    final asset = assets
        .where(
          (asset) => (android ?? Platform.isAndroid)
              ? asset['name'] == 'app-release.apk'
              : '${asset['name']}'.endsWith('windows-x64.zip'),
        )
        .firstOrNull;
    final rawUrl =
        '${asset?['browser_download_url'] ?? data['html_url'] ?? releasesUrl}';
    final uri = Uri.tryParse(rawUrl);
    final url =
        uri != null &&
            uri.scheme == 'https' &&
            uri.host == 'github.com' &&
            uri.path.startsWith('/koimiku/ziyong/releases')
        ? rawUrl
        : releasesUrl;
    return AppRelease(
      '${data['tag_name'] ?? ''}',
      '${data['body'] ?? ''}',
      url,
    );
  } finally {
    if (ownClient) client.close();
  }
}
