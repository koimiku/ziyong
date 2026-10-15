import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter/services.dart';

import '../app_controller.dart';
import '../domain/library_backup.dart';
import '../rules/rule_engine.dart';
import '../rules/site_client.dart';
import '../rules/site_browser.dart';
import 'bangumi_catalog.dart';
import 'tokusatsu.dart';

bool privateAddress(String ip) =>
    ip == '127.0.0.1' ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    (ip.startsWith('172.') &&
        (int.tryParse(ip.split('.')[1]) ?? 0) >= 16 &&
        (int.tryParse(ip.split('.')[1]) ?? 99) <= 31);

class PhoneServer {
  PhoneServer(this.controller);
  final AppController controller;
  HttpServer? server;
  SiteClient transport = SiteClient();
  final catalog = BangumiCatalog();
  HttpClient? mediaClient;
  MediaProbe? probe;
  final streams = <String, ResolvedMedia>{};
  String key = '';
  List<String> addresses = [];
  bool get running => server != null;
  String randomKey() =>
      base64UrlEncode(List.generate(24, (_) => Random.secure().nextInt(256)))
          .replaceAll('=', '');
  Future<void> start() async {
    if (running) return;
    key = randomKey();
    transport = SiteClient();
    mediaClient = HttpClient()..connectionTimeout = const Duration(seconds: 15);
    final interfaces = await NetworkInterface.list(
      type: InternetAddressType.IPv4,
    );
    final ips = interfaces
        .expand((entry) => entry.addresses)
        .where(
          (address) => privateAddress(address.address) && !address.isLoopback,
        )
        .toList();
    if (ips.isEmpty) throw const FormatException('未找到局域网地址，请连接 Wi-Fi 或网线');
    server = await HttpServer.bind(InternetAddress.anyIPv4, 47890);
    addresses = ips
        .map((ip) => 'http://${ip.address}:${server!.port}/?key=$key')
        .toList();
    server!.listen((request) {
      unawaited(handle(request));
    });
  }

  String register(ResolvedMedia media) {
    final id = randomKey();
    streams[id] = media;
    if (streams.length > 5000) streams.remove(streams.keys.first);
    return '/api/media?key=${Uri.encodeQueryComponent(key)}&id=$id';
  }

  SourceRule rule(HttpRequest request) =>
      request.uri.queryParameters['rule'] == 'Tokuzilla'
      ? SourceRule(tokusatsuRule)
      : SourceRule(
          controller.library.rules.firstWhere(
            (rule) => rule['name'] == request.uri.queryParameters['rule'],
            orElse: () => throw const FormatException('规则已移除'),
          ),
        );
  JsonMap subjectRow(JsonMap row) => {
    'id': row['id'],
    'title': Subject(row).title,
    'images': {'large': Subject(row).cover},
    'collectionStatus': row['collectionStatus'],
    'progress': row['progress'],
  };
  Future<void> handle(HttpRequest request) async {
    final response = request.response;
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    try {
      if (!privateAddress(
            request.connectionInfo?.remoteAddress.address ?? '',
          ) ||
          request.uri.queryParameters['key'] != key ||
          key.isEmpty) {
        response.statusCode = 403;
        await response.close();
        return;
      }
      final origin = request.headers.value('origin');
      if (origin != null &&
          Uri.tryParse(origin)?.authority != request.headers.value('host')) {
        response.statusCode = 403;
        await response.close();
        return;
      }
      final path = request.uri.path;
      if (path == '/' && request.method == 'GET') {
        response.headers.contentType = ContentType.html;
        response.write(
          (await rootBundle.loadString('assets/phone.html'))
              .replaceAll('__ACCESS_KEY__', Uri.encodeQueryComponent(key)),
        );
        await response.close();
        return;
      }
      if (path == '/hls.js') {
        response.headers.contentType = ContentType('application', 'javascript');
        response.add(
          (await rootBundle.load('assets/hls.min.js')).buffer.asUint8List(),
        );
        await response.close();
        return;
      }
      if (path == '/phone.js' && request.method == 'GET') {
        response.headers.contentType = ContentType('application', 'javascript');
        response.write(await rootBundle.loadString('assets/phone.js'));
        await response.close();
        return;
      }
      if (path == '/api/media' && {'GET', 'HEAD'}.contains(request.method)) {
        await proxy(request);
        return;
      }
      dynamic data;
      if (path == '/api/catalog' && request.method == 'GET') {
        final keyword = request.uri.queryParameters['q']?.trim() ?? '';
        data =
            (keyword.isEmpty
                    ? await catalog.calendar()
                    : await catalog.search(keyword))
                .map((subject) => subjectRow(subject.toCollection()))
                .toList();
      } else if (path == '/api/library' && request.method == 'GET') {
        data = {
          'collection': controller.library.collection
              .where(
                (row) => collectionLabels.containsKey(row['collectionStatus']),
              )
              .map(subjectRow)
              .toList(),
          'history': controller.library.history.map(subjectRow).toList(),
        };
      } else if (path == '/api/sources' && request.method == 'GET') {
        final rules = request.uri.queryParameters['partition'] == 'tokusatsu'
            ? [SourceRule(tokusatsuRule)]
            : controller.library.rules
                  .where((rule) => rule['disabled'] != true)
                  .map(SourceRule.new)
                  .toList();
        final results = <JsonMap>[];
        var cursor = 0;
        Future<void> worker() async {
          while (cursor < rules.length && running) {
            final source = rules[cursor++];
            try {
              final hits = await RuleEngine(transport.request).search(
                source,
                (request.uri.queryParameters['q'] ?? '').substring(
                  0,
                  min(200, (request.uri.queryParameters['q'] ?? '').length),
                ),
              );
              results.addAll(
                hits
                    .take(40)
                    .map(
                      (hit) => {
                        'rule': source.name,
                        'name': hit.name,
                        'source': hit.source,
                      },
                    ),
              );
            } catch (_) {}
          }
        }

        await Future.wait(List.generate(min(3, rules.length), (_) => worker()));
        data = results;
      } else if (path == '/api/chapters' && request.method == 'GET') {
        final lines = await RuleEngine(
          transport.request,
        ).chapters(rule(request), request.uri.queryParameters['source'] ?? '');
        data = lines
            .map(
              (line) => {
                'name': line.name,
                'episodes': line.episodes
                    .map((ep) => {'name': ep.name, 'url': ep.url})
                    .toList(),
              },
            )
            .toList();
      } else if (path == '/api/play' && request.method == 'GET') {
        final source = rule(request);
        final page = request.uri.queryParameters['page'] ?? '';
        var media = await RuleEngine(transport.request).resolve(source, page);
        if (media == null) {
          probe?.cancel();
          final detector = probe = MediaProbe();
          final url = await detector.resolve(source, page);
          if (url != null) {
            media = ResolvedMedia(url, {
              ...await transport.playbackHeaders(source, url, page),
              ...detector.resolvedHeaders,
            });
          }
        }
        if (media == null) {
          throw const FormatException('没有找到视频，请尝试其他片源；网站验证需先在电脑端完成');
        }
        data = {
          'url': register(media),
          'hls': Uri.parse(media.url).path.toLowerCase().endsWith('.m3u8'),
        };
      } else if (path == '/api/progress' && request.method == 'POST') {
        final body = await readBody(request);
        if (body['subject'] is! Map ||
            body['progress'] is! Map ||
            !RegExp(r'^(\d+|tz:[A-Za-z0-9._-]+)$')
                .hasMatch('${body['subject']['id']}')) {
          throw const FormatException('播放记录无效');
        }
        final input = body['progress'] as Map;
        final position = input['position'], duration = input['duration'];
        if (position is! num ||
            duration is! num ||
            !position.isFinite ||
            !duration.isFinite ||
            position < 0 ||
            duration <= 0 ||
            duration > 172800) {
          throw const FormatException('播放进度无效');
        }
        final progress = <String, dynamic>{
          for (final field in [
            'sourceName',
            'sourceUrl',
            'lineIndex',
            'episodeIndex',
            'episodeNumber',
          ])
            if (input[field] is String || input[field] is num)
              field: input[field],
          'position': position.clamp(0, duration),
          'duration': duration,
          'percent': (position / duration * 100).clamp(0, 100),
        };
        await controller.recordProgress(
          Subject(Map<String, dynamic>.from(body['subject'])),
          progress,
        );
        data = {'ok': true};
      } else if (path == '/api/status' && request.method == 'POST') {
        final body = await readBody(request);
        if (body['subject'] is! Map ||
            !RegExp(r'^(\d+|tz:[A-Za-z0-9._-]+)$')
                .hasMatch('${body['subject']['id']}')) {
          throw const FormatException('条目编号无效');
        }
        final status = '${body['status'] ?? ''}';
        if (status.isNotEmpty && !collectionLabels.containsKey(status)) {
          throw const FormatException('状态无效');
        }
        await controller.setStatus(
          Subject(Map<String, dynamic>.from(body['subject'])),
          status,
        );
        data = {'ok': true};
      } else {
        response.statusCode = 404;
        data = {'error': '没有这个页面'};
      }
      response.headers.contentType = ContentType.json;
      response.write(jsonEncode(data));
      await response.close();
    } catch (error) {
      try {
        response.statusCode = 400;
        response.headers.contentType = ContentType.json;
        response.write(
          jsonEncode({
            'error': error is FormatException ? error.message : '请求未完成，请重试',
          }),
        );
        await response.close();
      } catch (_) {}
    }
  }

  Future<JsonMap> readBody(HttpRequest request) async {
    final bytes = <int>[];
    await for (final chunk in request.timeout(const Duration(seconds: 10))) {
      if (bytes.length + chunk.length > 256000) {
        throw const FormatException('数据过大');
      }
      bytes.addAll(chunk);
    }
    return jsonDecode(utf8.decode(bytes)) as JsonMap;
  }

  Future<void> proxy(HttpRequest request) async {
    final media = streams[request.uri.queryParameters['id']];
    if (media == null) throw const FormatException('播放链接已过期，请重新选集');
    final uri = Uri.parse(media.url);
    if (!{'http', 'https'}.contains(uri.scheme)) {
      throw const FormatException('媒体地址无效');
    }
    final upstream = await mediaClient!.openUrl(request.method, uri);
    upstream.followRedirects = false;
    media.headers.forEach(upstream.headers.set);
    final range = request.headers.value('range');
    if (range != null) upstream.headers.set('Range', range);
    final incoming = await upstream.close().timeout(
      const Duration(seconds: 25),
    );
    final response = request.response;
    Map<String, String> headersFor(String url) {
      final result = {...media.headers};
      if (Uri.parse(url).origin != uri.origin) {
        result.removeWhere(
          (name, _) => {'cookie', 'authorization'}.contains(name.toLowerCase()),
        );
      }
      return result;
    }

    final location = incoming.headers.value('location');
    if ({301, 302, 303, 307, 308}.contains(incoming.statusCode) &&
        location != null) {
      final next = absoluteUrl(media.url, location);
      await incoming.drain<void>().timeout(const Duration(seconds: 20));
      await response.redirect(
        Uri.parse(register(ResolvedMedia(next, headersFor(next)))),
      );
      return;
    }
    response.statusCode = incoming.statusCode;
    final playlist =
        uri.path.toLowerCase().endsWith('.m3u8') ||
        '${incoming.headers.contentType}'.contains('mpegurl');
    if (playlist && request.method != 'HEAD' && incoming.statusCode == 200) {
      final bytes = <int>[];
      await for (final chunk in incoming.timeout(const Duration(seconds: 20))) {
        if (bytes.length + chunk.length > 2 * 1024 * 1024) {
          throw const FormatException('播放列表过大');
        }
        bytes.addAll(chunk);
      }
      String link(String value) {
        final next = absoluteUrl(media.url, value);
        return register(ResolvedMedia(next, headersFor(next)));
      }

      final text = utf8
          .decode(bytes)
          .split('\n')
          .map(
            (line) => line.startsWith('#')
                ? line.replaceAllMapped(
                    RegExp('URI="([^"]+)"'),
                    (match) => 'URI="${link(match[1]!)}"',
                  )
                : line.trim().isEmpty
                ? line
                : link(line.trim()),
          )
          .join('\n');
      response.headers.contentType = ContentType(
        'application',
        'vnd.apple.mpegurl',
      );
      response.write(text);
      await response.close();
    } else {
      for (final header in [
        'content-type',
        'content-length',
        'content-range',
        'accept-ranges',
      ]) {
        final value = incoming.headers.value(header);
        if (header == 'content-length' &&
            incoming.compressionState ==
                HttpClientResponseCompressionState.decompressed) {
          continue;
        }
        if (value != null) response.headers.set(header, value);
      }
      try {
        await response.addStream(incoming.timeout(const Duration(seconds: 25)));
        await response.close();
      } catch (_) {
        upstream.abort();
      }
    }
  }

  Future<void> stop() async {
    final current = server;
    server = null;
    key = '';
    addresses = [];
    probe?.cancel();
    transport.close();
    mediaClient?.close(force: true);
    streams.clear();
    await current?.close(force: true);
  }

  Future<void> dispose() async {
    await stop();
    catalog.close();
  }
}
