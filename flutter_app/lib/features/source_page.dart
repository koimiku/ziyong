import 'dart:async';
import 'dart:convert';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../domain/library_backup.dart';
import '../rules/rule_engine.dart';
import '../rules/site_browser.dart';
import '../rules/site_client.dart';
import 'watch_page.dart';
import 'service_pages.dart';
import '../data/tokusatsu.dart';
import 'rule_repository.dart';

class SourcePage extends StatefulWidget {
  const SourcePage({
    super.key,
    required this.subject,
    required this.controller,
    this.initialRule = '',
  });
  final Subject subject;
  final AppController controller;
  final String initialRule;
  @override
  State<SourcePage> createState() => _SourcePageState();
}

class _SourcePageState extends State<SourcePage> {
  late final query = TextEditingController(text: widget.subject.title);
  SiteClient? client;
  final hits = <String, List<SourceHit>>{};
  final errors = <String, Object>{};
  int generation = 0, pending = 0, openingGeneration = 0;
  String selected = '', opening = '';
  List<JsonMap>? cachedInput;
  List<SourceRule> cachedRules = [];
  List<SourceRule> get rules {
    final input = widget.controller.library.rules;
    if (!identical(cachedInput, input)) {
      cachedInput = input;
      cachedRules = widget.subject.id.startsWith('tz:')
          ? [SourceRule(tokusatsuRule)]
          : input
                .where(
                  (rule) =>
                      rule['disabled'] != true && rule['type'] != 'tokusatsu',
                )
                .map(SourceRule.new)
                .toList();
    }
    return cachedRules;
  }

  @override
  void initState() {
    super.initState();
    if (rules.any((rule) => rule.name == widget.initialRule)) {
      selected = widget.initialRule;
    }
    if (widget.subject.id.startsWith('tz:')) {
      client = SiteClient();
      hits['Tokuzilla'] = [
        SourceHit(
          SourceRule(tokusatsuRule),
          widget.subject.title,
          '${widget.subject.data['sourceUrl'] ?? 'https://tokuzilla.net/watch/${widget.subject.id.substring(3)}.html'}',
        ),
      ];
    } else {
      unawaited(search());
    }
  }

  @override
  void dispose() {
    generation++;
    openingGeneration++;
    client?.close();
    query.dispose();
    super.dispose();
  }

  Future<void> search() async {
    final keyword = query.text.trim();
    if (keyword.isEmpty) return;
    openingGeneration++;
    opening = '';
    client?.close();
    final transport = client = SiteClient();
    final engine = RuleEngine(transport.request);
    final current = ++generation;
    final sources = rules
        .where((rule) => selected.isEmpty || rule.name == selected)
        .toList();
    setState(() {
      hits.clear();
      errors.clear();
      pending = sources.length;
    });
    var cursor = 0;
    Future<void> worker() async {
      while (cursor < sources.length && mounted && current == generation) {
        final rule = sources[cursor++];
        try {
          final result = await engine.search(rule, keyword);
          if (mounted && current == generation) {
            setState(() => hits[rule.name] = result.take(60).toList());
          }
        } catch (error) {
          if (mounted && current == generation) {
            setState(() => errors[rule.name] = error);
          }
        } finally {
          if (mounted && current == generation) setState(() => pending--);
        }
      }
    }

    await Future.wait(
      List.generate(sources.length.clamp(0, 3), (_) => worker()),
    );
  }

  Future<void> verify(SiteVerification challenge) async {
    final done = await Navigator.push<bool>(
      context,
      MaterialPageRoute(builder: (_) => SiteBrowserPage(challenge: challenge)),
    );
    if (done == true && mounted) unawaited(search());
  }

  Future<void> open(SourceHit hit) async {
    final current = ++openingGeneration;
    setState(() => opening = hit.source);
    try {
      final transport = client;
      if (transport == null) return;
      final lines = await RuleEngine(transport.request)
          .chapters(hit.rule, hit.source);
      if (!mounted || current != openingGeneration) return;
      await Navigator.push<void>(
        context,
        MaterialPageRoute(
          builder: (_) => WatchPage(
            subject: widget.subject,
            source: hit,
            lines: lines,
            controller: widget.controller,
          ),
        ),
      );
    } on SiteVerification catch (challenge) {
      if (mounted && current == openingGeneration) await verify(challenge);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$error')));
      }
    } finally {
      if (mounted && current == openingGeneration) setState(() => opening = '');
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('选择片源'),
      actions: [
        IconButton(
          tooltip: '管理片源',
          icon: const Icon(Icons.tune_rounded),
          onPressed: () async {
            await Navigator.push<void>(
              context,
              MaterialPageRoute(
                builder: (_) => RuleLibraryPage(controller: widget.controller),
              ),
            );
            if (mounted) {
              selected = '';
              unawaited(search());
            }
          },
        ),
      ],
    ),
    body: Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
          child: TextField(
            controller: query,
            onSubmitted: (_) => search(),
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              hintText: '用其他名称查找片源',
              suffixIcon: IconButton(
                tooltip: '搜索',
                onPressed: search,
                icon: const Icon(Icons.search_rounded),
              ),
            ),
          ),
        ),
        if (rules.isNotEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: DropdownButtonFormField<String>(
              initialValue: selected,
              decoration: const InputDecoration(labelText: '搜索范围'),
              items: [
                const DropdownMenuItem(value: '', child: Text('所有片源')),
                ...rules.map(
                  (rule) => DropdownMenuItem(
                    value: rule.name,
                    child: Text(rule.label),
                  ),
                ),
              ],
              onChanged: (value) {
                selected = value ?? '';
                unawaited(search());
              },
            ),
          ),
        const SizedBox(height: 12),
        if (pending > 0) const LinearProgressIndicator(),
        Expanded(
          child: rules.isEmpty
              ? Center(
                  child: FilledButton.tonal(
                    onPressed: () async {
                      await Navigator.push<void>(
                        context,
                        MaterialPageRoute(
                          builder: (_) =>
                              RuleLibraryPage(controller: widget.controller),
                        ),
                      );
                      if (mounted) unawaited(search());
                    },
                    child: const Text('导入片源规则'),
                  ),
                )
              : ListView(
                  children: [
                    for (final rule in rules.where(
                      (rule) => selected.isEmpty || selected == rule.name,
                    )) ...[
                      ListTile(
                        title: Text(
                          rule.name,
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                        subtitle: Text(
                          errors.containsKey(rule.name)
                              ? '${errors[rule.name]}'
                              : hits.containsKey(rule.name)
                              ? '${hits[rule.name]!.length} 个结果'
                              : '正在搜索…',
                        ),
                        trailing: errors[rule.name] is SiteVerification
                            ? TextButton(
                                onPressed: () => verify(
                                  errors[rule.name] as SiteVerification,
                                ),
                                child: const Text('验证'),
                              )
                            : null,
                      ),
                      for (final hit in hits[rule.name] ?? <SourceHit>[])
                        ListTile(
                          contentPadding: const EdgeInsets.only(
                            left: 32,
                            right: 20,
                          ),
                          title: Text(hit.name),
                          trailing: opening == hit.source
                              ? const SizedBox(
                                  width: 20,
                                  height: 20,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : const Icon(Icons.chevron_right_rounded),
                          onTap: opening.isEmpty ? () => open(hit) : null,
                        ),
                    ],
                    const SizedBox(height: 24),
                  ],
                ),
        ),
      ],
    ),
  );
}

class RuleLibraryPage extends StatefulWidget {
  const RuleLibraryPage({super.key, required this.controller});
  final AppController controller;
  @override
  State<RuleLibraryPage> createState() => _RuleLibraryPageState();
}

class _RuleLibraryPageState extends State<RuleLibraryPage> {
  bool busy = false;
  Future<void> importRules() async {
    setState(() => busy = true);
    try {
      final file = await FilePicker.pickFile(
        type: FileType.custom,
        allowedExtensions: ['json'],
      );
      if (file == null) return;
      if ((await file.length() ?? 0) > 1024 * 1024) {
        throw const FormatException('规则文件不能超过 1 MB');
      }
      final bytes = <int>[];
      await for (final chunk in file.readAsByteStream()) {
        if (bytes.length + chunk.length > 1024 * 1024) {
          throw const FormatException('规则文件不能超过 1 MB');
        }
        bytes.addAll(chunk);
      }
      final decoded = jsonDecode(utf8.decode(bytes));
      final list = decoded is List ? decoded : [decoded];
      final validated = LibraryBackup.decode(
        LibraryBackup(
          rules: list
              .map((row) => Map<String, dynamic>.from(row as Map))
              .toList(),
        ).encode(),
      );
      await widget.controller.restore(validated);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('已导入 ${validated.rules.length} 条规则')),
        );
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$error')));
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('片源规则'),
      actions: [
        IconButton(
          tooltip: '规则仓库',
          onPressed: () => Navigator.push<void>(
            context,
            MaterialPageRoute(
              builder: (_) => RuleRepositoryPage(controller: widget.controller),
            ),
          ),
          icon: const Icon(Icons.extension_outlined),
        ),
        PopupMenuButton<String>(
          tooltip: '添加规则',
          icon: const Icon(Icons.add),
          onSelected: (value) {
            if (value == 'new') {
              Navigator.push<void>(
                context,
                MaterialPageRoute(
                  builder: (_) => RuleEditorPage(controller: widget.controller),
                ),
              );
            }
            if (value == 'paste') importRuleText(context, widget.controller);
            if (value == 'file') importRules();
          },
          itemBuilder: (_) => const [
            PopupMenuItem(value: 'new', child: Text('新建规则')),
            PopupMenuItem(value: 'paste', child: Text('粘贴规则或链接')),
            PopupMenuItem(value: 'file', child: Text('导入规则文件')),
          ],
        ),
      ],
    ),
    body: ListenableBuilder(
      listenable: widget.controller,
      builder: (context, _) => ListView(
        children: [
          if (busy) const LinearProgressIndicator(),
          for (final rule in widget.controller.library.rules)
            ListTile(
              title: Text('${rule['name']}'),
              subtitle: Text('${rule['baseUrl'] ?? rule['baseURL'] ?? ''}'),
              onTap: () => Navigator.push<void>(
                context,
                MaterialPageRoute(
                  builder: (_) =>
                      RuleEditorPage(controller: widget.controller, rule: rule),
                ),
              ),
              trailing: PopupMenuButton<String>(
                onSelected: (value) async {
                  if (value == 'toggle') {
                    await widget.controller.restore(
                      LibraryBackup(
                        rules: [
                          {...rule, 'disabled': rule['disabled'] != true},
                        ],
                      ),
                    );
                  }
                  if (value == 'share') {
                    await shareJson('${rule['name']}.json', rule);
                  }
                  if (value == 'remove' && context.mounted) {
                    final remove = await showDialog<bool>(
                      context: context,
                      builder: (context) => AlertDialog(
                        title: Text('移除 ${rule['name']}？'),
                        actions: [
                          TextButton(
                            onPressed: () => Navigator.pop(context, false),
                            child: const Text('取消'),
                          ),
                          FilledButton(
                            onPressed: () => Navigator.pop(context, true),
                            child: const Text('移除'),
                          ),
                        ],
                      ),
                    );
                    if (remove == true) {
                      await widget.controller.removeRecord(
                        'rules',
                        '${rule['name']}',
                      );
                    }
                  }
                },
                itemBuilder: (_) => [
                  PopupMenuItem(
                    value: 'toggle',
                    child: Text(rule['disabled'] == true ? '启用' : '停用'),
                  ),
                  PopupMenuItem(value: 'share', child: Text('分享文件')),
                  PopupMenuItem(value: 'remove', child: Text('移除')),
                ],
              ),
            ),
          if (widget.controller.library.rules.isEmpty)
            const Padding(
              padding: EdgeInsets.all(32),
              child: Text('导入规则文件后即可搜索片源'),
            ),
        ],
      ),
    ),
  );
}
