import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../data/rule_tools.dart';
import '../domain/library_backup.dart';

class RuleRepositoryPage extends StatefulWidget {
  const RuleRepositoryPage({
    super.key,
    required this.controller,
    this.repository,
  });
  final AppController controller;
  final RuleRepository? repository;
  @override
  State<RuleRepositoryPage> createState() => _RuleRepositoryPageState();
}

class _RuleRepositoryPageState extends State<RuleRepositoryPage> {
  late final repository = widget.repository ?? RuleRepository();
  late Future<List<JsonMap>> index = repository.index();
  String installing = '';
  int completed = 0, total = 0;
  JsonMap? installed(JsonMap entry) => widget.controller.library.rules
      .where((rule) => rule['name'] == entry['name'])
      .firstOrNull;
  bool updateAvailable(JsonMap entry) =>
      installed(entry) != null &&
      compareRuleVersions(entry['version'], installed(entry)!['version']) > 0;
  Future<void> install(List<JsonMap> entries) async {
    if (installing.isNotEmpty || entries.isEmpty) return;
    setState(() {
      installing = '${entries.first['name']}';
      completed = 0;
      total = entries.length;
    });
    var failed = 0;
    for (final entry in entries) {
      if (!mounted) return;
      setState(() => installing = '${entry['name']}');
      try {
        final raw = await repository.fetch(entry);
        if (!mounted) return;
        final old = installed(entry);
        if (old != null &&
            compareRuleVersions(raw['version'], old['version']) < 0) {
          throw const FormatException('本地版本较新');
        }
        await widget.controller.restore(
          LibraryBackup(
            rules: [
              {...raw, if (old?['disabled'] == true) 'disabled': true},
            ],
          ),
        );
        completed++;
      } catch (_) {
        failed++;
      }
    }
    if (!mounted) return;
    setState(() => installing = '');
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          '已完成 $completed 项${failed == 0 ? '' : ' · $failed 项失败，可重试'}',
        ),
      ),
    );
  }

  @override
  void dispose() {
    repository.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('规则仓库'),
      actions: [
        IconButton(
          tooltip: '刷新',
          onPressed: installing.isNotEmpty
              ? null
              : () => setState(() => index = repository.index()),
          icon: const Icon(Icons.refresh_rounded),
        ),
      ],
    ),
    body: FutureBuilder<List<JsonMap>>(
      future: index,
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return Center(
            child: TextButton(
              onPressed: () => setState(() => index = repository.index()),
              child: const Text('加载失败，点击重试'),
            ),
          );
        }
        if (!snapshot.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        return ListenableBuilder(
          listenable: widget.controller,
          builder: (context, _) {
            final entries = snapshot.data!;
            final missing = entries
                .where((entry) => installed(entry) == null)
                .toList();
            final updates = entries.where(updateAvailable).toList();
            return Column(
              children: [
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '已安装 ${entries.length - missing.length} / ${entries.length}',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: 12),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          FilledButton.icon(
                            onPressed: installing.isEmpty && missing.isNotEmpty
                                ? () => install(missing)
                                : null,
                            icon: const Icon(Icons.download_rounded),
                            label: Text(
                              missing.isEmpty
                                  ? '全部已安装'
                                  : '一键安装 (${missing.length})',
                            ),
                          ),
                          if (updates.isNotEmpty)
                            OutlinedButton(
                              onPressed: installing.isEmpty
                                  ? () => install(updates)
                                  : null,
                              child: Text('更新全部 (${updates.length})'),
                            ),
                        ],
                      ),
                      if (installing.isNotEmpty) ...[
                        const SizedBox(height: 12),
                        LinearProgressIndicator(
                          value: total > 0 ? completed / total : null,
                        ),
                        Text('正在安装 $installing · $completed / $total'),
                      ],
                    ],
                  ),
                ),
                Expanded(
                  child: ListView.builder(
                    itemCount: entries.length,
                    itemBuilder: (context, i) {
                      final entry = entries[i], local = installed(entry);
                      final update = updateAvailable(entry);
                      final status = local == null
                          ? '未安装'
                          : update
                          ? '已安装 · 可更新'
                          : '已安装${local['disabled'] == true ? ' · 已停用' : ' · 已启用'}';
                      return ListTile(
                        leading: Icon(
                          local == null
                              ? Icons.add_circle_outline_rounded
                              : update
                              ? Icons.update_rounded
                              : Icons.check_circle_rounded,
                          color: local == null
                              ? Theme.of(context).colorScheme.outline
                              : Theme.of(context).colorScheme.primary,
                        ),
                        title: Text('${entry['name']}'),
                        subtitle: Text(
                          '$status\n${local == null ? '仓库版本 ${entry['version']}' : '本地 ${local['version']} · 仓库 ${entry['version']}'}',
                        ),
                        isThreeLine: true,
                        trailing: TextButton(
                          onPressed:
                              installing.isEmpty && (local == null || update)
                              ? () => install([entry])
                              : null,
                          child: Text(
                            local == null
                                ? '安装'
                                : update
                                ? '更新'
                                : '已安装',
                          ),
                        ),
                      );
                    },
                  ),
                ),
              ],
            );
          },
        );
      },
    ),
  );
}
