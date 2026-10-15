import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../app_controller.dart';
import '../domain/library_backup.dart';
import 'secrets.dart';

const bangumiTypes = {'planned': 1, 'completed': 2, 'watching': 3};
const bangumiStatuses = {1: 'planned', 2: 'completed', 3: 'watching'};

class BangumiSync extends ChangeNotifier {
  BangumiSync(this.controller, this.secrets, {http.Client? client})
    : client = client ?? http.Client();
  final AppController controller;
  final SecretStore secrets;
  final http.Client client;
  String _token = '', lastError = '';
  JsonMap? user;
  DateTime? lastSync;
  Timer? timer;
  int epoch = 0;
  Future<void>? _running;
  bool disposed = false;
  bool get busy => _running != null;
  bool get loggedIn => _token.isNotEmpty && user != null;
  final uploaded = <String, int>{};

  Future<void> initialize() async {
    _token = await secrets.read('bangumi-token') ?? '';
    final raw = await secrets.read('bangumi-user');
    if (raw != null) {
      try {
        user = Map<String, dynamic>.from(jsonDecode(raw));
      } catch (_) {
        user = null;
      }
    }
    if (loggedIn) schedule();
    if (!disposed) notifyListeners();
  }

  Future<dynamic> request(
    String path,
    String token, {
    String method = 'GET',
    Object? body,
    bool missingOkay = false,
  }) async {
    final req = http.Request(method, Uri.parse('https://api.bgm.tv$path'))
      ..followRedirects = false;
    req.headers.addAll({
      'User-Agent': 'koimiku/ziyong/1.6.0 (https://github.com/koimiku/ziyong)',
      'Authorization': 'Bearer $token',
      'Content-Type': 'application/json',
    });
    if (body != null) req.body = jsonEncode(body);
    final response = await client
        .send(req)
        .timeout(const Duration(seconds: 20));
    final bytes = <int>[];
    await for (final chunk in response.stream.timeout(
      const Duration(seconds: 20),
    )) {
      if (bytes.length + chunk.length > 4 * 1024 * 1024) {
        throw const FormatException('Bangumi 响应过大');
      }
      bytes.addAll(chunk);
    }
    if (response.statusCode == 404 && missingOkay) return null;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw FormatException(
        response.statusCode == 401
            ? 'Bangumi 登录已失效，请重新登录'
            : 'Bangumi 请求失败（${response.statusCode}）',
      );
    }
    return bytes.isEmpty ? null : jsonDecode(utf8.decode(bytes));
  }

  Future<void> login(String input) async {
    final token = input.trim();
    if (token.isEmpty) throw const FormatException('请输入 Access Token');
    final me = await request('/v0/me', token);
    if (me is! Map || me['username'] == null) {
      throw const FormatException('无法读取 Bangumi 账户');
    }
    epoch++;
    timer?.cancel();
    uploaded.clear();
    _token = token;
    user = Map<String, dynamic>.from(me);
    await secrets.write('bangumi-token', token);
    await secrets.write('bangumi-user', jsonEncode(user));
    _running = null;
    notifyListeners();
    await sync();
  }

  Future<void> logout() async {
    epoch++;
    timer?.cancel();
    _token = '';
    user = null;
    lastError = '';
    uploaded.clear();
    lastSync = null;
    await secrets.write('bangumi-token', null);
    await secrets.write('bangumi-user', null);
    notifyListeners();
  }

  void schedule() {
    if (!loggedIn) return;
    timer?.cancel();
    timer = Timer(const Duration(seconds: 2), () {
      unawaited(sync().catchError((Object _) {}));
    });
  }

  Future<void> sync() {
    if (!loggedIn) return Future.value();
    if (_running != null) return _running!;
    late final Future<void> task;
    task = run(epoch, _token, '${user!['username']}').whenComplete(() {
      if (identical(_running, task)) {
        _running = null;
        if (!disposed) notifyListeners();
      }
    });
    _running = task;
    notifyListeners();
    return task;
  }

  Future<void> run(int session, String token, String username) async {
    bool valid() => session == epoch && token == _token;
    try {
      final remote = <JsonMap>[];
      for (var offset = 0; offset < 10000; offset += 100) {
        final payload = await request(
          '/v0/users/${Uri.encodeComponent(username)}/collections?subject_type=2&limit=100&offset=$offset',
          token,
        );
        if (!valid()) return;
        final rows = (payload['data'] as List).cast<JsonMap>();
        remote.addAll(rows);
        if (rows.length < 100) break;
      }
      final mapped = <JsonMap>[];
      final history = <JsonMap>[];
      final remoteEpisodes = <String, int>{};
      for (final row in remote) {
        final subject = row['subject'] as Map?;
        final id = '${subject?['id'] ?? row['subject_id']}';
        if (!RegExp(r'^\d+$').hasMatch(id)) continue;
        remoteEpisodes[id] = (row['ep_status'] as num?)?.toInt() ?? 0;
        if (remoteEpisodes[id]! > 0) {
          history.add({
            ...?subject,
            'id': id,
            'watchedAt':
                DateTime.tryParse('${row['updated_at']}')
                    ?.millisecondsSinceEpoch ??
                0,
            'progress': {
              'episodeNumber': remoteEpisodes[id],
              'fromBangumi': true,
              'position': 0,
              'duration': 0,
            },
          });
        }
        final status = bangumiStatuses[row['type']];
        if (status == null) continue;
        mapped.add({
          ...?subject,
          'id': id,
          'collectionStatus': status,
          'collectionPending': false,
          'collectionRemote': true,
          'collectionUpdatedAt':
              DateTime.tryParse('${row['updated_at']}')
                  ?.millisecondsSinceEpoch ??
              0,
        });
      }
      if (!valid()) return;
      if (mapped.isNotEmpty) await controller.mergeRemoteCollections(mapped);
      if (!valid()) return;
      if (history.isNotEmpty) await controller.mergeRemoteHistory(history);
      for (final snapshot in [...controller.library.collection]) {
        if (!valid()) return;
        final id = '${snapshot['id']}';
        final type = bangumiTypes[snapshot['collectionStatus']];
        if (snapshot['collectionPending'] != true ||
            type == null ||
            !RegExp(r'^\d+$').hasMatch(id)) {
          continue;
        }
        await request(
          '/v0/users/-/collections/$id',
          token,
          method: 'POST',
          body: {'type': type},
        );
        if (!valid()) return;
        await controller.acknowledgeCollection(snapshot);
      }
      for (final snapshot in [...controller.library.history]) {
        if (!valid()) return;
        final id = '${snapshot['id']}';
        final progress = snapshot['progress'];
        if (!RegExp(r'^\d+$').hasMatch(id) || progress is! Map) continue;
        final number = episodeNumber(progress);
        final remoteEp = remoteEpisodes[id] ?? 0;
        if (number <= remoteEp || number <= (uploaded[id] ?? 0) || number < 1) {
          continue;
        }
        // Preserve an existing remote status; only create a missing collection.
        if (!remoteEpisodes.containsKey(id)) {
          await request(
            '/v0/users/-/collections/$id',
            token,
            method: 'POST',
            body: {'type': bangumiTypes[controller.status(id)] ?? 3},
          );
        }
        final ids = <int>[];
        for (var offset = 0; offset < 5000; offset += 100) {
          final payload = await request(
            '/v0/episodes?subject_id=$id&type=0&limit=100&offset=$offset',
            token,
          );
          if (!valid()) return;
          final episodes = (payload['data'] as List).cast<Map>();
          for (final ep in episodes) {
            final n = (ep['ep'] ?? ep['sort']) as num?;
            if (n != null && n >= 1 && n <= number && ep['id'] is num) {
              ids.add((ep['id'] as num).toInt());
            }
          }
          if (episodes.length < 100) break;
        }
        for (var i = 0; i < ids.length; i += 80) {
          if (!valid()) return;
          await request(
            '/v0/users/-/collections/$id/episodes',
            token,
            method: 'PATCH',
            body: {'episode_id': ids.skip(i).take(80).toList(), 'type': 2},
          );
        }
        if (ids.isNotEmpty) uploaded[id] = number;
      }
      if (valid()) {
        lastSync = DateTime.now();
        lastError = '';
      }
    } catch (error) {
      if (valid()) {
        lastError = error is FormatException ? error.message : '同步未完成，联网后可重试';
      }
      rethrow;
    }
  }

  @override
  void dispose() {
    disposed = true;
    epoch++;
    timer?.cancel();
    client.close();
    super.dispose();
  }
}

int episodeNumber(Map progress) {
  final label =
      '${progress['episodeNumber'] ?? progress['episodeLabel'] ?? ''}';
  return int.tryParse(RegExp(r'\d+').firstMatch(label)?[0] ?? '') ??
      ((progress['episodeIndex'] as num?)?.toInt() ?? -1) + 1;
}
