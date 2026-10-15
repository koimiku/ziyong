import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:html/parser.dart';
import 'package:anime_flutter/rules/rule_engine.dart';
import 'package:anime_flutter/rules/selectors.dart';
import 'package:anime_flutter/rules/site_client.dart';
import 'package:anime_flutter/data/tokusatsu.dart';

Map<String, dynamic> fixture() => {
  'name': 'test',
  'baseUrl': 'https://example.com/',
  'searchURL': '/search?q=@keyword',
  'searchList': '//li',
  'searchName': '//a',
  'searchResult': '//a',
  'chapterRoads': '//ul',
  'chapterResult': '//li/a',
};

void main() {
  test('Tokusatsu episode links are sorted, deduplicated and restricted to the selected show', () async {
    final engine = RuleEngine(
      (_) async => '<a href="/watch/show.html?ep=2#watch">2</a><a href="/watch/show.html?ep=1#watch">1</a><a href="/watch/show.html?ep=2#watch">Next</a><a href="/watch/other.html?ep=9#watch">9</a>',
    );
    final lines = await engine.chapters(
      SourceRule(tokusatsuRule),
      'https://tokuzilla.net/watch/show.html',
    );
    expect(lines.single.episodes.map((ep) => ep.name), ['第1集', '第2集']);
  });
  test(
    'repository search sourceTemplate maps API IDs into chapter URLs',
    () async {
      final rule = SourceRule({
        ...fixture(),
        'searchMode': 'api',
        'searchApiConfig': {
          'request': {'url': '/api'},
          'listPath': r'$.list[*]',
          'namePath': r'$.name',
          'sourcePath': r'$.id',
          'sourceTemplate': '/GV@source/',
        },
      });
      final hit = (await RuleEngine(
        (_) async => '{"list":[{"id":123,"name":"测试"}]}',
      ).search(rule, '测试')).single;
      expect(hit.source, 'https://example.com/GV123/');
    },
  );
  test('bundled API sources preserve detail routes, line order and episode IDs', () async {
    final rules = (jsonDecode(
      await File('assets/rules.json').readAsString(),
    ) as List).cast<Map<String, dynamic>>();
    for (final raw in rules) {
      SourceRule(raw);
    }
    final source = SourceRule(
      rules.firstWhere((rule) => rule['name'] == 'xfdm'),
    );
    var calls = 0;
    final engine = RuleEngine((request) async {
      calls++;
      if (calls == 1) return '{"list":[{"id":12,"name":"测试"}]}';
      expect(request.url, 'https://dm1.xfdm.pro/bangumi/12.html');
      return '<a href="/watch/12/2/2.html">第2集</a><a href="/watch/12/1/1.html">第1集</a><a href="/watch/13/1/1.html">其他番剧</a>';
    });
    final hit = (await engine.search(source, '测试')).single;
    final lines = await engine.chapters(source, hit.source);
    expect(lines, hasLength(2));
    expect(
      lines.first.episodes.single.url,
      'https://dm1.xfdm.pro/watch/12/1/1.html',
    );
    expect(lines.last.episodes.single.name, '第2集');
  });
  test(
    'parser pages containing a media query are not mistaken for media files',
    () {
      expect(
        isMediaUrl(
          'https://parser.example/?url=https://cdn.example/video.m3u8',
        ),
        false,
      );
      expect(isMediaUrl('https://cdn.example/video.m3u8?key=123'), true);
      expect(isMediaUrl('file:///private/video.mp4'), false);
      expect(
        extractMedia(
          'var player_aaaa={"url":"https://parser.example/?url=https://cdn.example/video.m3u8"};',
        ),
        '',
      );
    },
  );
  test(
    'API nested and delimited chapters retain lines and episode page variables',
    () {
      final rule = SourceRule(fixture());
      final nested = apiChapters(
        rule,
        {
          'roads': [
            {
              'name': '线路A',
              'episodes': [
                {'name': '第一集', 'url': '/v1'},
              ],
            },
          ],
        },
        {'roadsPath': r'$.roads[*]', 'roadNamePath': r'$.name'},
        '/show/1',
      );
      expect(nested.single['name'], '线路A');
      expect(nested.single['episodes'][0]['url'], 'https://example.com/v1');
      final delimited = apiChapters(
        rule,
        {'id': 7, 'names': r'A$$$B', 'items': r'1$one#2$two$$$1$three'},
        {
          'format': 'delimited',
          'roadNamesPath': r'$.names',
          'roadEpisodesPath': r'$.items',
          'variables': {'id': r'$.id'},
          'episodePage': {
            'url': '/play/@id',
            'query': {
              'road': '@roadNumber',
              'episode': '@episodeNumber',
              'url': '@episodeUrl',
            },
          },
        },
        '/show/1',
      );
      expect(delimited, hasLength(2));
      final url = Uri.parse(delimited[0]['episodes'][1]['url']);
      expect(url.path, '/play/7');
      expect(url.queryParameters, {'road': '1', 'episode': '2', 'url': 'two'});
    },
  );
  test(
    'context-relative XPath preserves child positions, attributes and text',
    () {
      final root = parse(
        '<section><div class="card"><a href="/a">A</a><a href="/b">B</a></div><div class="card"><a href="/c">C</a></div></section>',
      );
      final cards = selectXPath(root, '//div[contains(@class,"card")]');
      expect(selectXPath(root, '//div/a[1]').map(nodeText), ['A', 'C']);
      expect(selectXPath(cards.first as dynamic, '//a[2]/@href'), ['/b']);
      expect(selectXPath(root, '//a[@href="/a"]/text()').map(nodeText), ['A']);
      expect(() => selectXPath(root, '//a[invalid()]'), throwsFormatException);
    },
  );
  test('XPath source search and chapter parsing retain names, URL resolution and headers', () async {
    final requests = <PreparedRequest>[];
    final rule = SourceRule(fixture());
    final engine = RuleEngine((request) async {
      requests.add(request);
      return requests.length == 1
          ? '<li><a href="/show/1">番剧</a></li>'
          : '<ul><li><a href="/play/1">第 1 集</a></li></ul>';
    });
    final hits = await engine.search(rule, '测试 & A');
    expect(Uri.parse(requests.first.url).queryParameters['q'], '测试 & A');
    expect(hits.single.source, 'https://example.com/show/1');
    expect(requests.first.headers['Referer'], 'https://example.com/');
    final lines = await engine.chapters(rule, hits.single.source);
    expect(lines.single.episodes.single.name, '第1集');
    expect(lines.single.episodes.single.url, 'https://example.com/play/1');
  });
  test(
    'JSONPath and API request retain scalar types and encode values once',
    () {
      expect(
        readJsonPath({
          'data': [
            {'id': 1},
            {'id': 2},
          ],
        }, r'$.data[*].id'),
        [1, 2],
      );
      final request = apiRequest(
        SourceRule(fixture()),
        {
          'request': {
            'url': '/api/@source',
            'method': 'POST',
            'bodyType': 'json',
            'body': {'id': '@id', 'query': '@keyword'},
            'query': {'q': '@keyword'},
          },
        },
        {'source': 'a/b', 'id': 7, 'keyword': '番 & 剧'},
      );
      expect(Uri.parse(request.url).queryParameters['q'], '番 & 剧');
      expect(Uri.parse(request.url).pathSegments.last, 'a/b');
      expect(jsonDecode(request.body!)['id'], 7);
    },
  );
  test('direct and encrypted player URLs resolve without a persistent browser', () async {
    final rule = SourceRule(fixture());
    var calls = 0;
    final url = 'https://cdn.example.com/video.m3u8?key=1';
    final engine = RuleEngine((_) async {
      calls++;
      return 'var player_aaaa = ${jsonEncode({'encrypt': 2, 'url': base64Encode(utf8.encode(Uri.encodeComponent(url)))})};';
    });
    expect((await engine.resolve(rule, url))!.url, url);
    expect(calls, 0);
    expect((await engine.resolve(rule, '/play/1'))!.url, url);
    expect(calls, 1);
  });
  test('challenge is explicit rather than an empty success', () async {
    final engine = RuleEngine(
      (_) async => '<html>Just a moment... cf-chl-platform</html>',
    );
    await expectLater(
      engine.search(SourceRule(fixture()), '番剧'),
      throwsA(isA<SiteVerification>()),
    );
  });
  test('HTTP redirects carry scoped cookies and fail after close', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final origin = 'http://${server.address.address}:${server.port}';
    final listener = server.listen((request) async {
      if (request.uri.path == '/start') {
        request.response.statusCode = 302;
        request.response.cookies.add(Cookie('session', 'ok')..path = '/');
        request.response.headers.set('location', '/end');
      } else {
        request.response.write(
          request.cookies
              .map((cookie) => '${cookie.name}=${cookie.value}')
              .join(';'),
        );
      }
      await request.response.close();
    });
    final client = SiteClient();
    try {
      expect(
        await client.request(PreparedRequest('$origin/start')),
        'session=ok',
      );
      client.close();
      await expectLater(
        client.request(PreparedRequest('$origin/end')),
        throwsA(isA<HttpException>()),
      );
    } finally {
      client.close();
      await listener.cancel();
      await server.close(force: true);
    }
  });
}
