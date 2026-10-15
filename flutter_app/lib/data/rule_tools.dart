import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../domain/library_backup.dart';
import '../rules/rule_engine.dart';
import '../rules/site_client.dart';

const rulesRepository =
    'https://raw.githubusercontent.com/Predidit/KazumiRules/main';
int compareRuleVersions(Object? left, Object? right) {
  final a = '${left ?? 0}'.split(RegExp(r'[.\-+]')),
      b = '${right ?? 0}'.split(RegExp(r'[.\-+]'));
  for (var i = 0; i < (a.length > b.length ? a.length : b.length); i++) {
    final x = i < a.length ? a[i] : '0', y = i < b.length ? b[i] : '0';
    final nx = int.tryParse(x), ny = int.tryParse(y);
    final result = nx != null && ny != null ? nx.compareTo(ny) : x.compareTo(y);
    if (result != 0) return result;
  }
  return 0;
}

class RuleRepository {
  RuleRepository({this.request});
  final RuleRequest? request;
  final SiteClient _client = SiteClient();
  Future<String> _get(String url) =>
      (request ?? _client.request)(PreparedRequest(url));
  Future<List<JsonMap>> index() async {
    final rows = jsonDecode(await _get('$rulesRepository/index.json'));
    if (rows is! List) throw const FormatException('规则目录无效');
    final unique = <String, JsonMap>{};
    for (final row in rows.whereType<JsonMap>().take(1000)) {
      final name = '${row['name']}';
      if (RegExp(r'^[A-Za-z0-9._-]{1,80}$').hasMatch(name)) unique[name] = row;
    }
    return unique.values.toList();
  }

  Future<JsonMap> fetch(JsonMap entry) async {
    final name = '${entry['name']}';
    if (!RegExp(r'^[A-Za-z0-9._-]{1,80}$').hasMatch(name)) {
      throw const FormatException('规则名称无效');
    }
    final rule = SourceRule(
      jsonDecode(await _get('$rulesRepository/$name.json')) as JsonMap,
    );
    if (rule.name != name ||
        compareRuleVersions(rule.data['version'], entry['version']) < 0) {
      throw const FormatException('规则内容与目录不一致，请刷新后重试');
    }
    return rule.data;
  }

  void close() => _client.close();
}

class RuleHealthResult {
  const RuleHealthResult(this.label, {this.ok = false, this.milliseconds = 0});
  final String label;
  final bool ok;
  final int milliseconds;
}

class RuleHealthMonitor extends ChangeNotifier {
  RuleHealthMonitor({this.request, this.timeout = const Duration(seconds: 18)});
  final RuleRequest? request;
  final Duration timeout;
  final results = <String, RuleHealthResult>{};
  final pending = <String>{};
  final _clients = <SiteClient>{};
  bool running = false;
  int _generation = 0;
  Future<void> check(List<JsonMap> rules, {String keyword = '海贼王'}) async {
    if (running || keyword.trim().isEmpty) return;
    final generation = ++_generation;
    final queue = rules
        .where((rule) => rule['disabled'] != true)
        .take(500)
        .toList();
    running = true;
    results.clear();
    pending.addAll(queue.map((rule) => '${rule['name']}'));
    notifyListeners();
    var index = 0;
    Future<void> worker() async {
      while (generation == _generation && index < queue.length) {
        final raw = queue[index++], client = SiteClient();
        final name = '${raw['name']}';
        _clients.add(client);
        final watch = Stopwatch()..start();
        late final RuleHealthResult result;
        try {
          final hits = await RuleEngine(request ?? client.request)
              .search(SourceRule(raw), keyword.trim())
              .timeout(timeout);
          result = RuleHealthResult(
            hits.isEmpty ? '可连接 · 暂无搜索结果' : '搜索正常 · ${hits.length} 个结果',
            ok: true,
            milliseconds: watch.elapsedMilliseconds,
          );
        } on SiteVerification {
          result = const RuleHealthResult('需要网站验证');
        } on TimeoutException {
          result = const RuleHealthResult('连接超时');
        } catch (_) {
          result = const RuleHealthResult('暂不可用 · 网络或规则异常');
        } finally {
          client.close();
          _clients.remove(client);
        }
        if (generation != _generation) return;
        results[name] = result;
        pending.remove(name);
        notifyListeners();
      }
    }

    await Future.wait([worker(), worker()]);
    if (generation != _generation) return;
    running = false;
    notifyListeners();
  }

  void stop() {
    _generation++;
    for (final client in _clients) {
      client.close();
    }
    _clients.clear();
    pending.clear();
    running = false;
    notifyListeners();
  }

  @override
  void dispose() {
    _generation++;
    for (final client in _clients) {
      client.close();
    }
    _clients.clear();
    super.dispose();
  }
}
