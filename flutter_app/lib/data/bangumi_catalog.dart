import 'dart:convert';

import 'package:http/http.dart' as http;

import '../domain/library_backup.dart';
import 'tokusatsu.dart';

class BangumiCatalog {
  BangumiCatalog({http.Client? client}) : _client = client ?? http.Client();
  final http.Client _client;
  Future<List<JsonMap>>? _calendar;
  DateTime? _calendarLoadedAt;
  static const _headers = {
    'User-Agent': 'ziyong/1.6.1 (https://github.com/koimiku/ziyong)',
    'Accept': 'application/json',
  };

  Future<dynamic> _request(String path, {JsonMap? body}) async {
    final url = Uri.https(
      'api.bgm.tv',
      path.split('?').first,
      path.contains('?') ? Uri.splitQueryString(path.split('?').last) : null,
    );
    final response =
        await (body == null
                ? _client.get(url, headers: _headers)
                : _client.post(
                    url,
                    headers: {..._headers, 'Content-Type': 'application/json'},
                    body: jsonEncode(body),
                  ))
            .timeout(const Duration(seconds: 20));
    if (response.statusCode != 200) {
      throw Exception('暂时无法获取番剧（${response.statusCode}）');
    }
    return jsonDecode(utf8.decode(response.bodyBytes));
  }

  Future<List<Subject>> calendar({bool refresh = false, int? weekday}) async {
    if (weekday != null && (weekday < 1 || weekday > 7)) {
      throw const FormatException('星期必须为 1 至 7');
    }
    if (refresh ||
        (_calendarLoadedAt != null &&
            DateTime.now().difference(_calendarLoadedAt!) >
                const Duration(hours: 6))) {
      _calendar = null;
    }
    final request = _calendar ??= _loadCalendar();
    late final List<JsonMap> payload;
    try {
      payload = await request;
    } catch (_) {
      if (identical(request, _calendar)) _calendar = null;
      rethrow;
    }
    final days = payload
        .where(
          (day) =>
              weekday == null || (day['weekday'] as Map?)?['id'] == weekday,
        )
        .toList();
    final today = DateTime.now().weekday;
    days.sort(
      (a, b) => (((a['weekday'] as Map?)?['id'] as int? ?? 1) - today + 7)
          .remainder(7)
          .compareTo(
            (((b['weekday'] as Map?)?['id'] as int? ?? 1) - today + 7)
                .remainder(7),
          ),
    );
    final subjects = <String, Subject>{};
    for (final day in days) {
      for (final row in (day['items'] as List? ?? []).whereType<JsonMap>()) {
        if (row['id'] != null && (row['type'] == null || row['type'] == 2)) {
          final subject = Subject(row);
          subjects[subject.id] = subject;
        }
      }
    }
    return subjects.values.toList();
  }

  Future<List<JsonMap>> _loadCalendar() async {
    final payload = await _request('/calendar');
    if (payload is! List) throw const FormatException('放送数据格式无效');
    _calendarLoadedAt = DateTime.now();
    return payload.whereType<JsonMap>().toList();
  }

  Future<List<Subject>> search(String keyword) async {
    final payload = await _request(
      '/v0/search/subjects?limit=40',
      body: {
        'keyword': keyword.trim(),
        'sort': 'match',
        'filter': {
          'type': [2],
          'nsfw': false,
        },
      },
    );
    return ((payload as Map)['data'] as List? ?? [])
        .whereType<JsonMap>()
        .map(Subject.new)
        .toList();
  }

  Future<Subject> detail(String id) async =>
      Subject(await _request('/v0/subjects/$id') as JsonMap);
  Future<List<Subject>> tokusatsu({String keyword = ''}) async {
    final response = await _client
        .get(
          Uri.https(
            'tokuzilla.net',
            '/',
            keyword.isEmpty ? null : {'s': keyword},
          ),
          headers: {
            'User-Agent': 'Mozilla/5.0',
            'Referer': 'https://tokuzilla.net/',
          },
        )
        .timeout(const Duration(seconds: 20));
    if (response.statusCode != 200) {
      throw const FormatException('特摄目录暂不可用，可稍后重试');
    }
    return parseTokusatsu(utf8.decode(response.bodyBytes));
  }

  void close() => _client.close();
}
