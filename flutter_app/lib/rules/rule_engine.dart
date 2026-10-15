import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:html/parser.dart' as html;
import 'package:html/dom.dart' show Node;

import '../domain/library_backup.dart';
import 'selectors.dart';

const ruleUserAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
typedef RuleRequest = Future<String> Function(PreparedRequest request);

class PreparedRequest {
  const PreparedRequest(
    this.url, {
    this.method = 'GET',
    this.headers = const {},
    this.body,
  });
  final String url, method;
  final Map<String, String> headers;
  final String? body;
}

class SiteVerification implements Exception {
  const SiteVerification(this.rule, this.url);
  final SourceRule rule;
  final String url;
  @override
  String toString() => '该片源需要先完成网站验证';
}

class SourceRule {
  SourceRule(JsonMap raw) : data = Map.unmodifiable(raw) {
    // Reuse the strict backup boundary so rules imported alone obey the same contract.
    LibraryBackup.decode(LibraryBackup(rules: [raw]).encode());
  }
  final JsonMap data;
  String get name => text('name');
  String get label => text('displayName').isEmpty ? name : text('displayName');
  String get baseUrl =>
      text('baseUrl').isNotEmpty ? text('baseUrl') : text('baseURL');
  String text(String key) => '${data[key] ?? ''}';
  JsonMap config(String key) =>
      data[key] is Map ? Map<String, dynamic>.from(data[key]) : {};
  Map<String, String> headers(String url, {bool playback = false}) => {
    if (!playback)
      'Accept':
          'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
    'User-Agent': text('userAgent').isEmpty ? ruleUserAgent : text('userAgent'),
    'Referer': text('referer').isNotEmpty
        ? text('referer')
        : playback
        ? '${Uri.parse(url).origin}/'
        : baseUrl.isNotEmpty
        ? baseUrl
        : '${Uri.parse(url).origin}/',
  };
}

class SourceHit {
  const SourceHit(this.rule, this.name, this.source);
  final SourceRule rule;
  final String name, source;
}

class Episode {
  const Episode(this.name, this.url);
  final String name, url;
}

class EpisodeLine {
  const EpisodeLine(this.name, this.episodes);
  final String name;
  final List<Episode> episodes;
}

class ResolvedMedia {
  const ResolvedMedia(this.url, this.headers);
  final String url;
  final Map<String, String> headers;
}

String absoluteUrl(String base, String value) {
  if (value.trim().isEmpty) return '';
  final url = Uri.parse(base).resolve(value.trim());
  if (!{'http', 'https'}.contains(url.scheme)) {
    throw const FormatException('片源地址必须使用 HTTP 或 HTTPS');
  }
  return url.toString();
}

String template(String input, JsonMap variables, {bool encode = false}) =>
    input.replaceAllMapped(RegExp(r'@([A-Za-z_][A-Za-z0-9_]*)'), (match) {
      final key = match[1]!;
      if (!variables.containsKey(key)) {
        if (match.start > 0 &&
            RegExp(r'[A-Za-z0-9_]').hasMatch(input[match.start - 1])) {
          return match[0]!;
        }
        throw FormatException('缺少模板变量 @$key');
      }
      final value = '${variables[key] ?? ''}';
      return encode ? Uri.encodeComponent(value) : value;
    });
dynamic render(dynamic input, JsonMap variables) {
  if (input is String) {
    final exact = RegExp(r'^@([A-Za-z_][A-Za-z0-9_]*)$').firstMatch(input);
    if (exact != null) {
      if (!variables.containsKey(exact[1])) {
        throw FormatException('缺少模板变量 ${exact[1]}');
      }
      return variables[exact[1]];
    }
    return template(input, variables);
  }
  if (input is List) {
    return input.map((value) => render(value, variables)).toList();
  }
  if (input is Map) {
    return {
      for (final entry in input.entries)
        template('${entry.key}', variables): render(entry.value, variables),
    };
  }
  return input;
}

PreparedRequest apiRequest(SourceRule rule, JsonMap config, JsonMap variables) {
  final request = config['request'] as Map? ?? {};
  final uri = Uri.parse(
    absoluteUrl(
      rule.baseUrl,
      template('${request['url'] ?? ''}', variables, encode: true),
    ),
  );
  final query = render(request['query'] ?? {}, variables) as Map;
  final url = uri
      .replace(
        queryParameters: {
          ...uri.queryParameters,
          for (final entry in query.entries)
            if (entry.value != null) '${entry.key}': '${entry.value}',
        },
      )
      .toString();
  final customHeaders = render(request['headers'] ?? {}, variables) as Map;
  final headers = {
    ...rule.headers(url),
    for (final entry in customHeaders.entries) '${entry.key}': '${entry.value}',
  };
  final method = '${request['method'] ?? 'GET'}'.toUpperCase() == 'POST'
      ? 'POST'
      : 'GET';
  String? body;
  if (method == 'POST' && request['bodyType'] == 'json') {
    headers.putIfAbsent('Content-Type', () => 'application/json');
    body = jsonEncode(render(request['body'] ?? {}, variables));
  } else if (method == 'POST' && request['bodyType'] == 'form') {
    headers.putIfAbsent(
      'Content-Type',
      () => 'application/x-www-form-urlencoded',
    );
    final fields = render(request['body'] ?? {}, variables) as Map;
    body = Uri(
      queryParameters: {
        for (final entry in fields.entries)
          '${entry.key}': '${entry.value ?? ''}',
      },
    ).query;
  }
  return PreparedRequest(url, method: method, headers: headers, body: body);
}

class RuleEngine {
  const RuleEngine(this.request);
  final RuleRequest request;
  Future<String> fetch(SourceRule rule, PreparedRequest prepared) async {
    final raw = await request(prepared);
    return raw;
  }

  Future<List<SourceHit>> search(SourceRule rule, String keyword) async {
    PreparedRequest prepared;
    if (rule.text('searchMode') == 'api') {
      prepared = apiRequest(rule, rule.config('searchApiConfig'), {
        'keyword': keyword,
      });
    } else {
      final uri = Uri.parse(
        absoluteUrl(
          rule.baseUrl,
          rule
              .text('searchURL')
              .replaceAll('@keyword', Uri.encodeComponent(keyword)),
        ),
      );
      prepared = rule.data['usePost'] == true
          ? PreparedRequest(
              uri.replace(query: '').toString(),
              method: 'POST',
              headers: {
                ...rule.headers(uri.toString()),
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: uri.query,
            )
          : PreparedRequest(
              uri.toString(),
              headers: rule.headers(uri.toString()),
            );
    }
    final raw = await fetch(rule, prepared);
    final message = {
      'rule': rule.data,
      'raw': raw,
      'url': prepared.url,
      'kind': 'search',
    };
    final parsed = raw.length > 8000
        ? await compute(parseRuleDocument, message)
        : parseRuleDocument(message);
    if (parsed['verify'] == true) throw SiteVerification(rule, prepared.url);
    return (parsed['rows'] as List)
        .cast<JsonMap>()
        .map((row) => SourceHit(rule, row['name'], row['url']))
        .toList();
  }

  Future<List<EpisodeLine>> chapters(SourceRule rule, String source) async {
    final prepared = rule.text('chapterMode') == 'api'
        ? apiRequest(rule, rule.config('chapterApiConfig'), {'source': source})
        : PreparedRequest(
            absoluteUrl(
              rule.baseUrl,
              rule.text('detailURL').isEmpty
                  ? source
                  : template(rule.text('detailURL'), {
                      'source': source,
                    }, encode: true),
            ),
            headers: rule.headers(absoluteUrl(rule.baseUrl, source)),
          );
    final raw = await fetch(rule, prepared);
    final message = {
      'rule': rule.data,
      'raw': raw,
      'url': prepared.url,
      'kind': 'chapters',
      'source': source,
    };
    final parsed = raw.length > 8000
        ? await compute(parseRuleDocument, message)
        : parseRuleDocument(message);
    if (parsed['verify'] == true) throw SiteVerification(rule, prepared.url);
    final lines = (parsed['rows'] as List)
        .cast<JsonMap>()
        .map(
          (row) => EpisodeLine(
            row['name'],
            (row['episodes'] as List)
                .cast<JsonMap>()
                .map((ep) => Episode(ep['name'], ep['url']))
                .toList(),
          ),
        )
        .toList();
    if (lines.isEmpty && rule.data['singleEpisodeFallback'] == true) {
      return [
        EpisodeLine(rule.name, [
          Episode('播放', absoluteUrl(rule.baseUrl, source)),
        ]),
      ];
    }
    if (lines.isEmpty) throw const FormatException('没有解析到集数，请尝试其他片源');
    return lines;
  }

  Future<ResolvedMedia?> resolve(SourceRule rule, String page) async {
    final url = absoluteUrl(rule.baseUrl, page);
    if (isMediaUrl(url)) {
      return ResolvedMedia(url, rule.headers(url, playback: true));
    }
    final raw = await fetch(
      rule,
      PreparedRequest(url, headers: rule.headers(url)),
    );
    final found = extractMedia(raw);
    if (rule.name == 'xgcartoon') {
      final id = RegExp(r'pframe\.xgcartoon\.com/player\.htm\?vid=([a-f0-9-]+)')
          .firstMatch(raw)?[1];
      if (id != null) {
        return ResolvedMedia(
          'https://xgct-video.bzcdn.net/$id/playlist.m3u8',
          rule.headers(url, playback: true),
        );
      }
    }
    if (found.isNotEmpty) {
      return ResolvedMedia(
        absoluteUrl(url, found),
        rule.headers(url, playback: true),
      );
    }
    if (needsVerification(rule, raw)) throw SiteVerification(rule, url);
    return null;
  }
}

JsonMap parseRuleDocument(JsonMap message) {
  final rule = SourceRule(message['rule']);
  final raw = message['raw'] as String;
  final isSearch = message['kind'] == 'search';
  List<JsonMap> rows;
  try {
    if (rule.text(isSearch ? 'searchMode' : 'chapterMode') == 'api') {
      final document = jsonDecode(raw);
      final config = rule.config(
        isSearch ? 'searchApiConfig' : 'chapterApiConfig',
      );
      rows = isSearch
          ? [
              for (final node in readJsonPath(
                document,
                '${config['listPath'] ?? r'$.data[*]'}',
              ))
                if (jsonValue(
                      node,
                      '${config['namePath'] ?? r'$.name'}',
                    ).isNotEmpty &&
                    jsonValue(
                      node,
                      '${config['sourcePath'] ?? r'$.url'}',
                    ).isNotEmpty)
                  {
                    'name': jsonValue(
                      node,
                      '${config['namePath'] ?? r'$.name'}',
                    ),
                    'url': apiSearchSource(rule, config, node),
                  },
            ]
          : apiChapters(rule, document, config, '${message['source']}');
    } else {
      final root = html.parse(raw);
      if (isSearch) {
        rows = [];
        for (final node in selectXPath(
          root,
          rule.text('searchList'),
        ).whereType<Node>()) {
          final name = nodeText(
            selectXPath(node, rule.text('searchName')).firstOrNull,
          ).trim();
          final source = nodeHref(
            selectXPath(node, rule.text('searchResult')).firstOrNull,
          );
          if (name.isNotEmpty && source.isNotEmpty) {
            rows.add({'name': name, 'url': absoluteUrl(rule.baseUrl, source)});
          }
        }
      } else if (rule.text('chapterPattern').isNotEmpty) {
        final pattern = RegExp(rule.text('chapterPattern'));
        final groups = <int, Map<int, JsonMap>>{};
        for (final link in root.querySelectorAll('a[href]')) {
          final href = link.attributes['href']!;
          final match = pattern.firstMatch(href);
          if (match == null || match[1] != '${message['source']}') continue;
          final sid = int.tryParse(match[2] ?? '') ?? 0,
              nid = int.tryParse(match[3] ?? '') ?? 0;
          if (sid < 1 ||
              nid < 1 ||
              RegExp('立即播放|播放正片|在线播放').hasMatch(link.text)) {
            continue;
          }
          (groups[sid] ??= {})[nid] = {
            'name': link.text.trim().isEmpty ? '第$nid集' : link.text.trim(),
            'url': absoluteUrl(rule.baseUrl, href),
          };
        }
        rows = [
          for (final sid in groups.keys.toList()..sort())
            {
              'name': '播放线路$sid',
              'episodes': [
                for (final nid in groups[sid]!.keys.toList()..sort())
                  groups[sid]![nid],
              ],
            },
        ];
      } else {
        rows = [];
        for (final node in selectXPath(
          root,
          rule.text('chapterRoads'),
        ).whereType<Node>()) {
          final episodes = <JsonMap>[];
          for (final link in selectXPath(node, rule.text('chapterResult'))) {
            final href = nodeHref(link);
            if (href.isEmpty) continue;
            final label = nodeText(link).replaceAll(RegExp(r'\s+'), '');
            episodes.add({
              'name': label.isEmpty ? '第${episodes.length + 1}集' : label,
              'url': absoluteUrl(rule.baseUrl, href),
            });
          }
          if (rule.text('episodeQueryKey').isNotEmpty) {
            final sorted = <int, JsonMap>{};
            final sourcePath = Uri.parse('${message['source']}').path;
            for (final episode in episodes) {
              final uri = Uri.parse(episode['url']);
              if (rule.data['restrictEpisodePath'] == true &&
                  uri.path != sourcePath) {
                continue;
              }
              final number = int.tryParse(
                uri.queryParameters[rule.text('episodeQueryKey')] ?? '',
              );
              if (number != null && number > 0) {
                sorted[number] = {...episode, 'name': '第$number集'};
              }
            }
            episodes
              ..clear()
              ..addAll([
                for (final number in sorted.keys.toList()..sort())
                  sorted[number]!,
              ]);
          }
          if (episodes.isNotEmpty) {
            rows.add({'name': '播放线路${rows.length + 1}', 'episodes': episodes});
          }
        }
      }
    }
  } catch (_) {
    if (needsVerification(rule, raw)) {
      return {'rows': <JsonMap>[], 'verify': true};
    }
    rethrow;
  }
  return {'rows': rows, 'verify': rows.isEmpty && needsVerification(rule, raw)};
}

String jsonValue(dynamic document, String path) =>
    readJsonPath(document, path).firstOrNull?.toString().trim() ?? '';
String apiSearchSource(SourceRule rule, JsonMap config, dynamic node) {
  final source = jsonValue(node, '${config['sourcePath'] ?? r'$.url'}');
  final format = '${config['sourceTemplate'] ?? ''}';
  return format.isEmpty
      ? source
      : absoluteUrl(
          rule.baseUrl,
          template(format, {'source': source}, encode: true),
        );
}

List<JsonMap> apiChapters(
  SourceRule rule,
  dynamic document,
  JsonMap config,
  String source,
) {
  final variables = <String, dynamic>{'source': source};
  for (final entry in (config['variables'] as Map? ?? {}).entries) {
    final value = readJsonPath(document, '${entry.value}').firstOrNull;
    if (value == null) throw FormatException('章节变量 ${entry.key} 没有匹配到值');
    variables['${entry.key}'] = value;
  }
  String episodeUrl(String raw, int road, int index) {
    final page = config['episodePage'];
    if (page is! Map || '${page['url'] ?? ''}'.isEmpty) {
      return raw.isEmpty ? '' : absoluteUrl(rule.baseUrl, raw);
    }
    final scope = {
      ...variables,
      'episodeUrl': raw,
      'roadIndex': road,
      'roadNumber': road + 1,
      'episodeIndex': index,
      'episodeNumber': index + 1,
    };
    final url = Uri.parse(
      absoluteUrl(
        rule.baseUrl,
        template('${page['url']}', scope, encode: true),
      ),
    );
    final query = render(page['query'] ?? {}, scope) as Map;
    return url
        .replace(
          queryParameters: {
            ...url.queryParameters,
            for (final entry in query.entries) '${entry.key}': '${entry.value}',
          },
        )
        .toString();
  }

  final result = <JsonMap>[];
  if (config['format'] == 'delimited') {
    final separator = '${config['roadSeparator'] ?? r'$$$'}';
    final names = jsonValue(
      document,
      '${config['roadNamesPath'] ?? r'$'}',
    ).split(separator);
    final groups = jsonValue(
      document,
      '${config['roadEpisodesPath'] ?? r'$'}',
    ).split(separator);
    for (var road = 0; road < groups.length; road++) {
      final episodes = <JsonMap>[];
      final entries = groups[road].split(
        '${config['episodeSeparator'] ?? '#'}',
      );
      for (var i = 0; i < entries.length; i++) {
        final delimiter = '${config['fieldSeparator'] ?? r'$'}';
        final offset = entries[i].indexOf(delimiter);
        if (offset < 0) continue;
        final url = episodeUrl(
          entries[i].substring(offset + delimiter.length).trim(),
          road,
          i,
        );
        if (url.isNotEmpty) {
          episodes.add({
            'name': entries[i].substring(0, offset).trim(),
            'url': url,
          });
        }
      }
      if (episodes.isNotEmpty) {
        result.add({
          'name': road < names.length && names[road].isNotEmpty
              ? names[road]
              : '播放线路${road + 1}',
          'episodes': episodes,
        });
      }
    }
  } else {
    final roads = '${config['roadsPath'] ?? ''}'.isEmpty
        ? [document]
        : readJsonPath(document, '${config['roadsPath']}');
    for (var road = 0; road < roads.length; road++) {
      final nodes = readJsonPath(
        roads[road],
        '${config['episodesPath'] ?? r'$.episodes[*]'}',
      );
      final episodes = <JsonMap>[];
      for (var i = 0; i < nodes.length; i++) {
        final raw = jsonValue(
          nodes[i],
          '${config['episodeUrlPath'] ?? r'$.url'}',
        );
        final url = episodeUrl(raw, road, i);
        if (url.isEmpty) continue;
        final name = jsonValue(
          nodes[i],
          '${config['episodeNamePath'] ?? r'$.name'}',
        );
        episodes.add({'name': name.isEmpty ? '第${i + 1}集' : name, 'url': url});
      }
      final path = '${config['roadNamePath'] ?? ''}';
      final name = path.isEmpty ? '' : jsonValue(roads[road], path);
      if (episodes.isNotEmpty) {
        result.add({
          'name': name.isEmpty ? '播放线路${road + 1}' : name,
          'episodes': episodes,
        });
      }
    }
  }
  return result;
}

bool isMediaUrl(String value) {
  final uri = Uri.tryParse(value);
  return uri != null &&
      {'http', 'https'}.contains(uri.scheme) &&
      RegExp(
        r'\.(m3u8|mp4|mkv|webm|m4v|mpd)$',
        caseSensitive: false,
      ).hasMatch(uri.path);
}

String extractMedia(String raw) {
  final decoded = raw.replaceAll(r'\/', '/');
  final player = RegExp(
    r'player_aaaa\s*=\s*(\{.*?\})\s*(?:;|</script>)',
    dotAll: true,
  ).firstMatch(decoded);
  if (player != null) {
    try {
      final data = jsonDecode(player[1]!);
      var url = '${data['url'] ?? ''}';
      final mode = int.tryParse('${data['encrypt']}') ?? 0;
      if (mode == 1 || mode == 2) {
        url = utf8.decode(base64.decode(base64.normalize(url)));
      }
      if (mode == 2) url = Uri.decodeComponent(url);
      if (isMediaUrl(url)) return url;
    } catch (_) {
      /* Continue scanning ordinary media tags. */
    }
  }
  final matches = RegExp(
    r'''https?://[^"'\s<>\\]+?\.(?:m3u8|mp4|mkv|webm|mpd)(?:\?[^"'\s<>\\]*)?''',
    caseSensitive: false,
  ).allMatches(decoded).map((match) => match[0]!);
  return matches
          .where(
            (url) =>
                isMediaUrl(url) &&
                !RegExp(
                  r'/(?:ads?|banner|logo|thumb)[/_.-]',
                  caseSensitive: false,
                ).hasMatch(url),
          )
          .firstOrNull ??
      '';
}

bool needsVerification(SourceRule rule, String raw) {
  if (RegExp(
    r'cf-chl-|challenge-platform|cf_chl_opt|<title>\s*Just a moment|mac_verify_img|ds-verify-img|verify_submit|verify-submit|请输入验证码|人机验证|安全检查中',
    caseSensitive: false,
  ).hasMatch(raw)) {
    return true;
  }
  final config = rule.config('antiCrawlerConfig');
  if (config['enabled'] != true) return false;
  final detect = '${config['captchaDetectValue'] ?? ''}';
  if (detect.isEmpty) return false;
  try {
    if (config['captchaDetectType'] == 3) return RegExp(detect).hasMatch(raw);
    if (detect.startsWith('/')) {
      return selectXPath(html.parse(raw), detect).isNotEmpty;
    }
    return raw.contains(detect);
  } catch (_) {
    return false;
  }
}
