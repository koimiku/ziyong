import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../domain/library_backup.dart';
import '../domain/playback_policy.dart';
import '../rules/rule_engine.dart';
import '../rules/site_client.dart';
import 'source_page.dart';
import 'watch_page.dart';

class HistoryPage extends StatefulWidget {
  const HistoryPage({super.key, required this.controller});
  final AppController controller;
  @override
  State<HistoryPage> createState() => _HistoryPageState();
}

class _HistoryPageState extends State<HistoryPage> {
  SiteClient? client;
  String opening = '';
  @override
  void dispose() {
    client?.close();
    super.dispose();
  }

  Future<void> resume(JsonMap row) async {
    final subject = Subject(row);
    setState(() => opening = subject.id);
    try {
      final progress = row['progress'];
      final rules = widget.controller.library.rules;
      final rule = progress is Map
          ? rules
                .where(
                  (rule) => matchesPlaybackSource(progress, SourceRule(rule)),
                )
                .firstOrNull
          : null;
      if (rule == null || progress['sourceUrl'] == null) {
        await Navigator.push<void>(
          context,
          MaterialPageRoute(
            builder: (_) => SourcePage(
              subject: subject,
              controller: widget.controller,
              initialRule: '${rule?['name'] ?? ''}',
            ),
          ),
        );
        return;
      }
      client?.close();
      final transport = client = SiteClient();
      final source = SourceHit(
        SourceRule(rule),
        subject.title,
        '${progress['sourceUrl']}',
      );
      final lines = await RuleEngine(transport.request)
          .chapters(source.rule, source.source);
      if (mounted) {
        await Navigator.push<void>(
          context,
          MaterialPageRoute(
            builder: (_) => WatchPage(
              subject: subject,
              source: source,
              lines: lines,
              controller: widget.controller,
            ),
          ),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('原片源暂不可用，可重新选择')));
        await Navigator.push<void>(
          context,
          MaterialPageRoute(
            builder: (_) =>
                SourcePage(subject: subject, controller: widget.controller),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => opening = '');
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('观看记录')),
    body: ListenableBuilder(
      listenable: widget.controller.historyChanges,
      builder: (context, _) => ListView(
        padding: const EdgeInsets.symmetric(vertical: 12),
        children: [
          if (widget.controller.library.history.isEmpty)
            const Padding(
              padding: EdgeInsets.all(32),
              child: Text('看过的番剧会出现在这里'),
            ),
          for (final row in widget.controller.library.history)
            ListTile(
              title: Text(
                Subject(row).title,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              subtitle: Text(
                row['progress'] is Map
                    ? '${row['progress']['episodeNumber'] ?? row['progress']['episodeLabel'] ?? ''} · ${(row['progress']['position'] is num ? (row['progress']['position'] as num).toInt() ~/ 60 : 0)} 分钟'
                    : '继续观看',
              ),
              leading: const Icon(Icons.history),
              onTap: opening.isEmpty ? () => resume(row) : null,
              trailing: opening == '${row['id']}'
                  ? const SizedBox(
                      width: 24,
                      height: 24,
                      child: CircularProgressIndicator(),
                    )
                  : IconButton(
                      tooltip: '删除记录',
                      icon: const Icon(Icons.close),
                      onPressed: () => widget.controller.removeRecord(
                        'history',
                        '${row['id']}',
                      ),
                    ),
            ),
        ],
      ),
    ),
  );
}
