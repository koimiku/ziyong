import 'package:html/parser.dart' as html;

import '../domain/library_backup.dart';

const tokusatsuRule = <String, dynamic>{
  'name': 'Tokuzilla',
  'type': 'tokusatsu',
  'baseUrl': 'https://tokuzilla.net/',
  'searchURL': '/?s=@keyword',
  'searchList': '//div[contains(@class,"item")]',
  'searchName': '//a[contains(@href,"/watch/")]',
  'searchResult': '//a[contains(@href,"/watch/")]',
  'chapterRoads': '//',
  'chapterResult': '//a[contains(@href,"?ep=")]',
  'singleEpisodeFallback': true,
  'episodeQueryKey': 'ep',
  'restrictEpisodePath': true,
};
List<Subject> parseTokusatsu(String raw) {
  final document = html.parse(raw);
  final seen = <String>{};
  final results = <Subject>[];
  for (final link in document.querySelectorAll('a[href*="/watch/"]')) {
    final uri = Uri.tryParse('${link.attributes['href']}');
    final slug = RegExp(r'/watch/([^/?#]+)\.html')
        .firstMatch(uri?.path ?? '')?[1];
    if (slug == null || !seen.add(slug)) continue;
    final image =
        link.querySelector('img') ?? link.parent?.querySelector('img');
    final name =
        (link.attributes['title'] ?? image?.attributes['alt'] ?? link.text)
            .trim();
    if (name.isEmpty) {
      seen.remove(slug);
      continue;
    }
    final cover =
        image?.attributes['data-src'] ?? image?.attributes['src'] ?? '';
    results.add(
      Subject({
        'id': 'tz:$slug',
        'name': name,
        'partition': 'tokusatsu',
        'images': {
          'large': cover.isEmpty
              ? ''
              : Uri.parse('https://tokuzilla.net/').resolve(cover).toString(),
        },
        'sourceUrl': 'https://tokuzilla.net/watch/$slug.html',
      }),
    );
    if (results.length >= 40) break;
  }
  return results;
}
