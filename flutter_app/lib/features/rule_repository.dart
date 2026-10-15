import 'dart:convert';

import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../domain/library_backup.dart';
import '../rules/rule_engine.dart';
import '../rules/site_client.dart';

const rulesRepository =
    'https://raw.githubusercontent.com/Predidit/KazumiRules/main';

class RuleRepositoryPage extends StatefulWidget {
  const RuleRepositoryPage({super.key, required this.controller});
  final AppController controller;
  @override
  State<RuleRepositoryPage> createState() => _RuleRepositoryPageState();
}

class _RuleRepositoryPageState extends State<RuleRepositoryPage> {
  final client = SiteClient();
  late Future<List<JsonMap>> index = load();
  String installing = '';
  Future<List<JsonMap>> load() async {
    final raw = await client.request(
      const PreparedRequest('$rulesRepository/index.json'),
    );
    final rows = (jsonDecode(raw) as List).cast<JsonMap>();
    return rows
        .where(
          (row) => RegExp(r'^[A-Za-z0-9._-]{1,80}$').hasMatch('${row['name']}'),
        )
        .take(1000)
        .toList();
  }

  @override
  void dispose() {
    client.close();
    super.dispose();
  }

  Future<void> install(JsonMap entry) async {
    setState(() => installing = '${entry['name']}');
    try {
      final raw = await client.request(
        PreparedRequest(
          '$rulesRepository/${Uri.encodeComponent(entry['name'])}.json',
        ),
      );
      final rule = SourceRule(jsonDecode(raw) as JsonMap);
      if (rule.name != entry['name']) throw const FormatException('规则名称不匹配');
      await widget.controller.restore(LibraryBackup(rules: [rule.data]));
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('已安装 ${rule.name}')));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('安装未完成，请稍后重试')));
      }
    } finally {
      if (mounted) setState(() => installing = '');
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('规则仓库'),
      actions: [
        IconButton(
          tooltip: '刷新',
          onPressed: () => setState(() => index = load()),
          icon: const Icon(Icons.refresh),
        ),
      ],
    ),
    body: FutureBuilder<List<JsonMap>>(
      future: index,
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return Center(
            child: TextButton(
              onPressed: () => setState(() => index = load()),
              child: const Text('加载失败，点击重试'),
            ),
          );
        }
        if (!snapshot.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        return ListView(
          children: [
            for (final entry in snapshot.data!)
              ListTile(
                title: Text('${entry['name']}'),
                subtitle: Text('版本 ${entry['version']}'),
                trailing: installing == entry['name']
                    ? const CircularProgressIndicator()
                    : TextButton(
                        onPressed: installing.isEmpty
                            ? () => install(entry)
                            : null,
                        child: Text(
                          widget.controller.library.rules.any(
                                (rule) => rule['name'] == entry['name'],
                              )
                              ? '更新'
                              : '安装',
                        ),
                      ),
              ),
          ],
        );
      },
    ),
  );
}
