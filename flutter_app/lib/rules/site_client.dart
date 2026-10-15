import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:cookie_jar/cookie_jar.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import 'rule_engine.dart';

WebViewEnvironment? siteWebEnvironment;
Future<WebViewEnvironment?>? _webEnvironment;
Future<WebViewEnvironment?> prepareSiteBrowser() =>
    _webEnvironment ??= () async {
      if (Platform.isWindows) {
        siteWebEnvironment = await WebViewEnvironment.create(
          settings: WebViewEnvironmentSettings(
            userDataFolder: p.join(
              (await getApplicationSupportDirectory()).path,
              'site-browser',
            ),
          ),
        );
      }
      return siteWebEnvironment;
    }();

class SiteClient {
  SiteClient() {
    _client.connectionTimeout = const Duration(seconds: 12);
  }
  final _client = HttpClient();
  // CookieJar scopes each cookie to its domain/path across search and playback.
  static final _cookies = CookieJar();
  bool _closed = false;
  Future<Map<String, String>> playbackHeaders(
    SourceRule rule,
    String media,
    String page,
  ) async => {
    ...rule.headers(page, playback: true),
    'Referer': rule.text('referer').isNotEmpty ? rule.text('referer') : page,
    if ((await cookies(Uri.parse(media))).isNotEmpty)
      'Cookie': await cookies(Uri.parse(media)),
  };
  Future<String> cookies(Uri uri) async {
    final jar = {
      for (final cookie in await _cookies.loadForRequest(uri))
        cookie.name: cookie.value,
    };
    try {
      if (!Platform.isWindows || siteWebEnvironment != null) {
        for (final cookie in await CookieManager.instance(
          webViewEnvironment: siteWebEnvironment,
        ).getCookies(url: WebUri.uri(uri))) {
          jar[cookie.name] = cookie.value;
        }
      }
    } catch (_) {
      /* An HTTP-only source does not require a browser runtime. */
    }
    return jar.entries.map((entry) => '${entry.key}=${entry.value}').join('; ');
  }

  Future<String> request(PreparedRequest prepared) async {
    var uri = Uri.parse(prepared.url);
    var method = prepared.method;
    var body = prepared.body;
    var headers = {...prepared.headers};
    for (var redirect = 0; redirect < 6; redirect++) {
      if (_closed) throw const HttpException('请求已取消');
      if (!{'http', 'https'}.contains(uri.scheme)) {
        throw const FormatException('不支持的片源地址');
      }
      final request = await _client
          .openUrl(method, uri)
          .timeout(const Duration(seconds: 20));
      request.followRedirects = false;
      headers.forEach(request.headers.set);
      final cookie = await cookies(uri);
      if (cookie.isNotEmpty) request.headers.set('Cookie', cookie);
      if (body != null) request.add(utf8.encode(body));
      final response = await request.close().timeout(
        const Duration(seconds: 20),
      );
      await _cookies.saveFromResponse(uri, response.cookies);
      if ({301, 302, 303, 307, 308}.contains(response.statusCode) &&
          response.headers.value('location') != null) {
        final next = uri.resolve(response.headers.value('location')!);
        if (next.origin != uri.origin) {
          headers.removeWhere(
            (key, _) => {'authorization', 'cookie'}.contains(key.toLowerCase()),
          );
        }
        if (response.statusCode == 303 ||
            (method == 'POST' && {301, 302}.contains(response.statusCode))) {
          method = 'GET';
          body = null;
          headers.removeWhere((key, _) => key.toLowerCase() == 'content-type');
        }
        await response.drain<void>();
        uri = next;
        continue;
      }
      final bytes = <int>[];
      await for (final chunk in response.timeout(const Duration(seconds: 20))) {
        if (bytes.length + chunk.length > 8 * 1024 * 1024) {
          throw const FormatException('片源响应过大');
        }
        bytes.addAll(chunk);
      }
      final text = utf8.decode(bytes, allowMalformed: true);
      if (response.statusCode >= 400 &&
          !RegExp(
            r'cf-chl-|challenge-platform|Just a moment|验证码|人机验证',
            caseSensitive: false,
          ).hasMatch(text)) {
        throw HttpException('片源请求失败（${response.statusCode}）');
      }
      return text;
    }
    throw const HttpException('片源重定向过多');
  }

  void close() {
    _closed = true;
    _client.close(force: true);
  }
}
