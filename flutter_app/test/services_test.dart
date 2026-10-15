import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:anime_flutter/app_controller.dart';
import 'package:anime_flutter/data/library_store.dart';
import 'package:anime_flutter/data/bangumi_sync.dart';
import 'package:anime_flutter/data/webdav.dart';
import 'package:anime_flutter/data/secrets.dart';
import 'package:anime_flutter/data/app_update.dart';
import 'package:anime_flutter/data/phone_server.dart';
import 'package:anime_flutter/domain/library_backup.dart';
import 'package:anime_flutter/rules/rule_engine.dart';

http.Response jsonResponse(Object value) =>
    http.Response.bytes(utf8.encode(jsonEncode(value)), 200);
void main() {
  sqfliteFfiInit();
  late LibraryStore store;
  late AppController controller;
  setUp(() async {
    store = await LibraryStore.open(
      factory: databaseFactoryFfiNoIsolate,
      path: inMemoryDatabasePath,
    );
    controller = AppController(store, await store.read());
  });
  tearDown(() async {
    controller.dispose();
    await store.close();
  });
  test('older cloud state cannot undo acknowledged edits or resurrect deleted history', () async {
    await controller.setStatus(const Subject({'id': 9}), 'watching');
    final snapshot = controller.library.collection.single;
    await controller.acknowledgeCollection(snapshot);
    await controller.mergeRemoteCollections([
      {'id': 9, 'collectionStatus': 'completed', 'collectionUpdatedAt': 1},
    ]);
    expect(controller.status('9'), 'watching');
    await controller.recordProgress(const Subject({'id': 9}), {
      'episodeNumber': 1,
    });
    await controller.removeRecord('history', '9');
    await controller.mergeRemoteHistory([
      {
        'id': 9,
        'progress': {'episodeNumber': 10},
        'watchedAt': 9999999999999,
      },
    ]);
    expect(controller.library.history, isEmpty);
    await controller.restore(
      const LibraryBackup(
        history: [
          {
            'id': 9,
            'progress': {'episodeNumber': 1},
            'watchedAt': 1,
          },
        ],
      ),
    );
    await controller.mergeRemoteHistory([
      {
        'id': 9,
        'progress': {'episodeNumber': 2},
        'watchedAt': 2,
      },
    ]);
    expect(controller.library.history.single['progress']['episodeNumber'], 2);
  });
  test('Bangumi merge retains exclusions and upload acknowledgement cannot erase a new edit', () async {
    await controller.setStatus(const Subject({'id': 1}), 'planned');
    await controller.setStatus(const Subject({'id': 2}), '');
    var posts = 0;
    final client = MockClient((request) async {
      expect(request.headers['authorization'], 'Bearer token');
      expect(request.followRedirects, false);
      if (request.url.path == '/v0/me') return jsonResponse({'username': 'me'});
      if (request.method == 'POST') {
        posts++;
        expect(jsonDecode(request.body)['type'], 1);
        await controller.setStatus(const Subject({'id': 1}), 'watching');
        return http.Response('', 204);
      }
      return jsonResponse({
        'data': [
          for (var id = 1; id <= 3; id++)
            {
              'subject': {'id': id, 'name': '番剧$id'},
              'type': 2,
              'ep_status': 0,
            },
        ],
      });
    });
    final sync = BangumiSync(
      controller,
      SecretStore.memory({}),
      client: client,
    );
    try {
      await sync.login('token');
      expect(posts, 1);
      expect(controller.status('1'), 'watching');
      expect(controller.status('2'), '');
      expect(controller.status('3'), 'completed');
      expect(
        controller.library.collection.firstWhere(
          (row) => '${row['id']}' == '1',
        )['collectionPending'],
        true,
      );
      expect(sync.busy, false);
    } finally {
      sync.dispose();
    }
  });
  test('Bangumi progress uploads episode IDs once and keeps a completed collection', () async {
    await controller.recordProgress(const Subject({'id': 10}), {
      'episodeNumber': '第2集',
      'position': 85,
    });
    var patches = 0, reads = 0, posts = 0;
    final client = MockClient((request) async {
      if (request.url.path == '/v0/me') return jsonResponse({'username': 'me'});
      if (request.url.path == '/v0/episodes') {
        reads++;
        return jsonResponse({
          'data': [
            {'id': 101, 'ep': 1},
            {'id': 102, 'ep': 2},
            {'id': 103, 'ep': 3},
          ],
        });
      }
      if (request.method == 'PATCH') {
        patches++;
        expect(jsonDecode(request.body), {
          'episode_id': [101, 102],
          'type': 2,
        });
        return http.Response('', 204);
      }
      if (request.method == 'POST') {
        posts++;
        return http.Response('', 204);
      }
      return jsonResponse({
        'data': [
          {
            'subject': {'id': 10},
            'type': 2,
            'ep_status': 0,
          },
        ],
      });
    });
    final sync = BangumiSync(
      controller,
      SecretStore.memory({}),
      client: client,
    );
    try {
      await sync.login('token');
      await sync.sync();
      expect(patches, 1);
      expect(reads, 1);
      expect(posts, 0);
      expect(controller.status('10'), 'completed');
    } finally {
      sync.dispose();
    }
  });
  test(
    'WebDAV uses UTF-8 authentication, unique snapshots and refuses redirects',
    () async {
      final requests = <http.Request>[];
      final dav = WebdavClient(
        client: MockClient((request) async {
          requests.add(request);
          return http.Response('', request.method == 'PROPFIND' ? 207 : 201);
        }),
      );
      final connection = WebdavConnection(
        'https://example.com/dav',
        '用户',
        '密码',
      );
      try {
        await dav.test(connection);
        await dav.upload(connection, const LibraryBackup());
        expect(
          requests.first.headers['authorization'],
          'Basic ${base64Encode(utf8.encode('用户:密码'))}',
        );
        expect(requests.first.followRedirects, false);
        expect(requests.first.headers['Depth'], '0');
        expect(requests[1].url.path, startsWith('/dav/anime-backup-'));
        expect(requests.last.url.path, '/dav/anime-backup.json');
        expect(
          jsonDecode(requests.last.body).keys,
          isNot(contains('password')),
        );
      } finally {
        dav.close();
      }
      final redirect = WebdavClient(
        client: MockClient(
          (_) async => http.Response(
            '',
            302,
            headers: {'location': 'https://other.com/'},
          ),
        ),
      );
      try {
        await expectLater(redirect.test(connection), throwsFormatException);
      } finally {
        redirect.close();
      }
      expect(
        () => WebdavConnection('https://name:secret@example.com/', '', ''),
        throwsFormatException,
      );
    },
  );
  test('cloud episode advancement does not erase matching local intra-episode position', () async {
    await store.putHistory({
      'id': 1,
      'progress': {'episodeNumber': 3, 'position': 85},
      'watchedAt': 10,
    });
    await store.mergeRemoteHistory([
      {
        'id': 1,
        'progress': {'episodeNumber': 3, 'fromBangumi': true},
        'watchedAt': 20,
      },
    ]);
    expect((await store.read()).history.single['progress']['position'], 85);
    await store.mergeRemoteHistory([
      {
        'id': 1,
        'progress': {'episodeNumber': 4, 'fromBangumi': true},
        'watchedAt': 30,
      },
    ]);
    expect((await store.read()).history.single['progress']['episodeNumber'], 4);
  });
  test(
    'update checker rejects off-site asset URLs and never offers a downgrade',
    () async {
      expect(newerVersion('v1.6.0', '1.5.10'), true);
      expect(newerVersion('1.5.10', appVersion), false);
      final release = await checkUpdate(
        android: true,
        client: MockClient(
          (_) async => jsonResponse({
            'tag_name': 'v1.7.0',
            'assets': [
              {
                'name': 'app-release.apk',
                'browser_download_url': 'https://evil.example/app.apk',
              },
            ],
          }),
        ),
      );
      expect(release.url, releasesUrl);
    },
  );
  test('LAN rejects missing access keys and foreign origins; HLS preserves local token URLs', () async {
    final phone = PhoneServer(controller);
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    phone.server = server;
    phone.key = 'test-access';
    phone.mediaClient = HttpClient();
    server.listen((request) {
      phone.handle(request);
    });
    final client = http.Client();
    final origin = 'http://127.0.0.1:${server.port}';
    try {
      expect(
        (await client.get(Uri.parse('$origin/api/library'))).statusCode,
        403,
      );
      expect(
        (await client.get(
          Uri.parse('$origin/api/library?key=test-access'),
          headers: {'Origin': 'http://foreign.example'},
        )).statusCode,
        403,
      );
      expect(
        (await client.get(Uri.parse('$origin/api/library?key=test-access')))
            .statusCode,
        200,
      );
      final upstream = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      final stream = upstream.listen((request) async {
        request.response.headers.contentType = ContentType(
          'application',
          'vnd.apple.mpegurl',
        );
        request.response.write(
          '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\nsegment.ts\n',
        );
        await request.response.close();
      });
      try {
        final path = phone.register(
          ResolvedMedia('http://127.0.0.1:${upstream.port}/video.m3u8', {}),
        );
        final response = await client.get(Uri.parse('$origin$path'));
        expect(response.statusCode, 200);
        expect(response.body, contains('#EXTM3U'));
        expect(response.body, contains('/api/media?key=test-access&id='));
        expect(response.body, isNot(contains('segment.ts')));
      } finally {
        await stream.cancel();
        await upstream.close(force: true);
      }
    } finally {
      client.close();
      await phone.dispose();
    }
  });
}
