import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:anime_flutter/data/bangumi_catalog.dart';

void main() {
  test(
    'calendar caches requests, removes duplicates and refreshes explicitly',
    () async {
      var requests = 0;
      final catalog = BangumiCatalog(
        client: MockClient((request) async {
          requests++;
          return http.Response(
            jsonEncode([
              {
                'weekday': {'id': 1},
                'items': [
                  {'id': 42, 'name': 'test'},
                  {'id': 42, 'name': 'test'},
                ],
              },
            ]),
            200,
          );
        }),
      );
      expect(await catalog.calendar(), hasLength(1));
      await catalog.calendar();
      expect(requests, 1);
      await catalog.calendar(refresh: true);
      expect(requests, 2);
      catalog.close();
    },
  );
  test('search uses anime filter and correctly decodes UTF-8', () async {
    final catalog = BangumiCatalog(
      client: MockClient((request) async {
        expect(request.method, 'POST');
        expect(request.url.path, '/v0/search/subjects');
        expect(jsonDecode(request.body)['filter']['type'], [2]);
        return http.Response.bytes(
          utf8.encode(
            jsonEncode({
              'data': [
                {'id': 42, 'name_cn': '测试番剧'},
              ],
            }),
          ),
          200,
        );
      }),
    );
    expect((await catalog.search('测试')).single.title, '测试番剧');
    catalog.close();
  });
}
