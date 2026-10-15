import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../data/rule_tools.dart';

class RuleHealthPage extends StatefulWidget {
  const RuleHealthPage({super.key, required this.controller});
  final AppController controller;
  @override
  State<RuleHealthPage> createState() => _RuleHealthPageState();
}

class _RuleHealthPageState extends State<RuleHealthPage> {
  final monitor = RuleHealthMonitor();
  final keyword = TextEditingController(text: '海贼王');
  void start() {
    FocusManager.instance.primaryFocus?.unfocus();
    if (keyword.text.trim().isEmpty) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('请输入检测关键词')));
      return;
    }
    monitor.check(widget.controller.library.rules, keyword: keyword.text);
  }

  @override
  void dispose() {
    monitor.dispose();
    keyword.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('片源检测')),
    body: ListenableBuilder(
      listenable: Listenable.merge([monitor, widget.controller]),
      builder: (context, _) {
        final rules = widget.controller.library.rules;
        return Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  TextField(
                    controller: keyword,
                    enabled: !monitor.running,
                    decoration: const InputDecoration(
                      labelText: '检测关键词',
                      prefixIcon: Icon(Icons.search_rounded),
                    ),
                  ),
                  const SizedBox(height: 12),
                  const Text('检测搜索接口的可用性，不代表每一集都能播放。仅检测已启用片源，不在后台持续运行。'),
                  const SizedBox(height: 12),
                  FilledButton.icon(
                    onPressed: monitor.running
                        ? monitor.stop
                        : rules.any((rule) => rule['disabled'] != true)
                        ? start
                        : null,
                    icon: Icon(
                      monitor.running
                          ? Icons.stop_rounded
                          : Icons.network_check_rounded,
                    ),
                    label: Text(monitor.running ? '停止检测' : '检测全部片源'),
                  ),
                  if (monitor.running) ...[
                    const SizedBox(height: 12),
                    const LinearProgressIndicator(),
                  ],
                  if (monitor.results.isNotEmpty)
                    Text(
                      '已检测 ${monitor.results.length} 项 · ${monitor.results.values.where((result) => result.ok).length} 项可连接',
                    ),
                ],
              ),
            ),
            Expanded(
              child: ListView.builder(
                itemCount: rules.length,
                itemBuilder: (context, i) {
                  final rule = rules[i],
                      result = monitor.results['${rules[i]['name']}'];
                  final checking = monitor.pending.contains('${rule['name']}');
                  return ListTile(
                    title: Text('${rule['displayName'] ?? rule['name']}'),
                    leading: Icon(
                      checking
                          ? Icons.hourglass_top_rounded
                          : result?.ok == true
                          ? Icons.check_circle_outline_rounded
                          : Icons.public_rounded,
                      color: result?.ok == true
                          ? Theme.of(context).colorScheme.primary
                          : null,
                    ),
                    subtitle: Text(
                      rule['disabled'] == true
                          ? '已停用 · 不参与检测'
                          : checking
                          ? '等待 / 检测中…'
                          : result == null
                          ? '尚未检测'
                          : '${result.label}${result.ok ? ' · ${result.milliseconds} ms' : ''}',
                    ),
                  );
                },
              ),
            ),
          ],
        );
      },
    ),
  );
}
