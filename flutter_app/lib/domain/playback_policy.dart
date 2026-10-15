import '../rules/rule_engine.dart';

double numeric(dynamic value) {
  final number = value is num
      ? value.toDouble()
      : double.tryParse('$value') ?? 0;
  return number.isFinite ? number : 0;
}

bool matchesPlaybackSource(Map value, SourceRule rule) {
  final id = '${value['sourceId'] ?? ''}'.replaceFirst(RegExp('^kazumi:'), '');
  final name = '${value['sourceName'] ?? ''}'.split(' · ').first;
  return id == rule.name || name == rule.name || name == rule.label;
}

({int line, int episode, Duration position}) resumePlayback(
  dynamic value,
  SourceHit source,
  List<EpisodeLine> lines,
) {
  const initial = (line: 0, episode: 0, position: Duration.zero);
  if (value is Map && value['fromBangumi'] == true && lines.isNotEmpty) {
    return (
      line: 0,
      episode: numeric(value['episodeNumber'])
          .toInt()
          .clamp(0, lines.first.episodes.length - 1),
      position: Duration.zero,
    );
  }
  if (value is! Map) return initial;
  final legacy =
      value['sourceUrl'] == null && matchesPlaybackSource(value, source.rule);
  if (!legacy &&
      (value['sourceName'] != source.rule.name ||
          value['sourceUrl'] != source.source)) {
    return initial;
  }
  final line = numeric(value['lineIndex']).toInt();
  final number =
      int.tryParse(
        RegExp(r'\d+').firstMatch(
              '${value['episodeNumber'] ?? value['episodeLabel'] ?? value['episodeNid'] ?? 1}',
            )?[0] ??
            '',
      ) ??
      1;
  final episode = legacy ? number - 1 : numeric(value['episodeIndex']).toInt();
  if (line < 0 ||
      line >= lines.length ||
      episode < 0 ||
      episode >= lines[line].episodes.length) {
    return initial;
  }
  final seconds = numeric(value['position']);
  final duration = numeric(value['duration']);
  final completed =
      numeric(value['percent']) >= 98 ||
      duration > 0 && seconds / duration >= .98;
  return (
    line: line,
    episode: episode,
    position: completed
        ? Duration.zero
        : Duration(
            seconds: seconds.clamp(0, duration > 0 ? duration : 86400).toInt(),
          ),
  );
}

Duration seekPosition(Duration value, Duration duration) => Duration(
  milliseconds: value.inMilliseconds.clamp(
    0,
    duration.inMilliseconds > 0 ? duration.inMilliseconds : 0,
  ),
);
