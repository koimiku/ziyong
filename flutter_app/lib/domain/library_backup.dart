import 'dart:convert';

typedef JsonMap = Map<String, dynamic>;

const backupSettings = {
  'anime-theme',
  'anime-palette-light',
  'anime-palette-dark',
  'anime-startup',
  'anime-auto-health',
  'anime-player-auto-hide-fullscreen',
  'anime-search-recent',
};
const collectionLabels = {'planned': '想看', 'watching': '在看', 'completed': '看过'};

class LibraryBackup {
  const LibraryBackup({
    this.collection = const [],
    this.history = const [],
    this.rules = const [],
    this.settings = const {},
  });

  final List<JsonMap> collection;
  final List<JsonMap> history;
  final List<JsonMap> rules;
  final Map<String, String> settings;

  factory LibraryBackup.decode(String text) {
    if (utf8.encode(text).length > 8 * 1024 * 1024) {
      throw const FormatException('备份文件不能超过 8 MB');
    }
    final value = jsonDecode(text);
    if (value is! Map ||
        value['format'] != 'anime-backup' ||
        value['schema'] != 1) {
      throw const FormatException('请选择 anime 导出的备份文件');
    }
    List<JsonMap> rows(String key, int limit) {
      final list = value[key];
      if (list is! List || list.length > limit) {
        throw FormatException('$key 数据不完整或条目过多');
      }
      return list.map((row) {
        if (row is! Map<String, dynamic>) {
          throw const FormatException('备份条目格式无效');
        }
        final id = row['id'];
        if (key != 'rules' &&
            !(id is String && id.isNotEmpty || id is num && id.isFinite)) {
          throw const FormatException('备份条目缺少有效编号');
        }
        return Map<String, dynamic>.from(row);
      }).toList();
    }

    final rules = rows('rules', 1000);
    final names = <String>{};
    for (final rule in rules) {
      final name = rule['name'];
      if (name is! String ||
          !RegExp(r'^[A-Za-z0-9._-]{1,80}$').hasMatch(name) ||
          !names.add(name)) {
        throw const FormatException('规则名称无效或重复');
      }
      final apiSearch = rule['searchMode'] == 'api';
      final apiChapter = rule['chapterMode'] == 'api';
      bool hasText(dynamic value) => value is String && value.trim().isNotEmpty;
      dynamic requestUrl(dynamic config) =>
          config is Map && config['request'] is Map
          ? config['request']['url']
          : null;
      if (apiSearch
          ? !hasText(requestUrl(rule['searchApiConfig']))
          : [
              'searchURL',
              'searchList',
              'searchName',
              'searchResult',
            ].any((key) => !hasText(rule[key]))) {
        throw const FormatException('搜索规则不完整');
      }
      if (apiChapter
          ? !hasText(requestUrl(rule['chapterApiConfig']))
          : [
              'chapterRoads',
              'chapterResult',
            ].any((key) => !hasText(rule[key]))) {
        throw const FormatException('选集规则不完整');
      }
    }
    final rawSettings = value['settings'] ?? <String, dynamic>{};
    if (rawSettings is! Map) throw const FormatException('设置格式无效');
    final settings = <String, String>{};
    for (final entry in rawSettings.entries) {
      if (!backupSettings.contains(entry.key) || entry.value is! String) {
        throw const FormatException('备份含不支持的设置');
      }
      settings[entry.key as String] = entry.value as String;
    }
    return LibraryBackup(
      collection: rows('collection', 5000),
      history: rows('history', 5000),
      rules: rules,
      settings: settings,
    );
  }

  LibraryBackup merge(LibraryBackup incoming) => LibraryBackup(
    collection: mergeRows(
      collection,
      incoming.collection,
      'collectionUpdatedAt',
    ),
    history: mergeRows(history, incoming.history, 'watchedAt'),
    rules: {
      ...{for (final row in rules) row['name']: row},
      ...{for (final row in incoming.rules) row['name']: row},
    }.values.toList(),
    settings: {...settings, ...incoming.settings},
  );

  String encode() => const JsonEncoder.withIndent('  ').convert({
    'format': 'anime-backup',
    'schema': 1,
    'appVersion': '1.6.4',
    'createdAt': DateTime.now().toUtc().toIso8601String(),
    'collection': collection,
    'history': history,
    'rules': rules,
    'settings': settings,
  });
}

List<JsonMap> mergeRows(
  List<JsonMap> local,
  List<JsonMap> incoming,
  String timeKey,
) {
  num time(JsonMap row) => row[timeKey] is num
      ? row[timeKey] as num
      : num.tryParse('${row[timeKey]}') ?? 0;
  final byId = <String, JsonMap>{};
  for (final row in [...local, ...incoming]) {
    final id = '${row['id']}';
    final previous = byId[id];
    if (previous == null || time(row) >= time(previous)) byId[id] = row;
  }
  return byId.values.toList()..sort((a, b) => time(b).compareTo(time(a)));
}

class Subject {
  const Subject(this.data);
  final JsonMap data;
  String get id => '${data['id']}';
  String get title =>
      '${data['title_cn'] ?? data['name_cn'] ?? ''}'.trim().isNotEmpty
      ? '${data['title_cn'] ?? data['name_cn']}'
      : '${data['title'] ?? data['name'] ?? '未命名'}';
  String get cover {
    final images = data['images'];
    return images is Map
        ? '${images['large'] ?? images['common'] ?? images['medium'] ?? ''}'
        : '';
  }

  String get synopsis => '${data['synopsis'] ?? data['summary'] ?? ''}';
  String get score {
    final rating = data['rating'];
    final value = data['score'] ?? (rating is Map ? rating['score'] : null);
    return value is num && value > 0 ? value.toStringAsFixed(1) : '';
  }

  JsonMap toCollection() => {
    ...data,
    'title': data['title'] ?? data['name'],
    'title_cn': data['title_cn'] ?? data['name_cn'],
    'synopsis': synopsis,
    'partition': data['partition'] ?? 'anime',
  };
}
