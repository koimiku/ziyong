import 'package:flutter_test/flutter_test.dart';
import 'package:anime_flutter/domain/playback_policy.dart';
import 'package:anime_flutter/rules/rule_engine.dart';

void main() {
  final source = SourceHit(
    SourceRule({
      'name': 'test',
      'baseUrl': 'https://example.com',
      'searchURL': '/?q=@keyword',
      'searchList': '//li',
      'searchName': '//a',
      'searchResult': '//a',
      'chapterRoads': '//ul',
      'chapterResult': '//a',
    }),
    '番剧',
    '/show/1',
  );
  const lines = [
    EpisodeLine('线路1', [Episode('1', '/1'), Episode('2', '/2')]),
  ];
  final saved = {
    'sourceName': 'test',
    'sourceUrl': '/show/1',
    'lineIndex': 0,
    'episodeIndex': 1,
    'position': 120,
    'duration': 1200,
    'percent': 10,
  };
  test('resume requires an exact source and valid episode', () {
    expect(resumePlayback(saved, source, lines), (
      line: 0,
      episode: 1,
      position: const Duration(seconds: 120),
    ));
    expect(
      resumePlayback({...saved, 'episodeIndex': 999}, source, lines).episode,
      0,
    );
    expect(
      resumePlayback({...saved, 'sourceUrl': '/other'}, source, lines).position,
      Duration.zero,
    );
    expect(
      resumePlayback({...saved, 'position': '-1'}, source, lines).position,
      Duration.zero,
    );
  });
  test('legacy source IDs resume their one-based episode and cloud progress opens the next episode', () {
    final legacy = {
      'sourceId': 'kazumi:test',
      'sourceName': 'test · 规则',
      'lineIndex': 0,
      'episodeNumber': 2,
      'position': 85,
      'duration': 1200,
    };
    expect(resumePlayback(legacy, source, lines), (
      line: 0,
      episode: 1,
      position: const Duration(seconds: 85),
    ));
    expect(
      resumePlayback(
        {'fromBangumi': true, 'episodeNumber': 1},
        source,
        lines,
      ).episode,
      1,
    );
  });
  test('completed episodes restart and seeking stays within media bounds', () {
    expect(
      resumePlayback({...saved, 'percent': '99'}, source, lines).position,
      Duration.zero,
    );
    expect(
      resumePlayback({...saved, 'position': 1190}, source, lines).position,
      Duration.zero,
    );
    expect(
      seekPosition(const Duration(seconds: 185), const Duration(seconds: 150)),
      const Duration(seconds: 150),
    );
    expect(
      seekPosition(const Duration(seconds: -5), const Duration(seconds: 150)),
      Duration.zero,
    );
  });
}
