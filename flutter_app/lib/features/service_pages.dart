import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../app_controller.dart';
import '../domain/library_backup.dart';
import '../data/webdav.dart';
import '../rules/rule_engine.dart';
import '../rules/site_client.dart';

Future<void> shareJson(String name, Object value) => SharePlus.instance
    .share(
      ShareParams(
        files: [
          XFile.fromData(
            utf8.encode(const JsonEncoder.withIndent('  ').convert(value)),
            mimeType: 'application/json',
            name: name,
          ),
        ],
        fileNameOverrides: [name],
      ),
    )
    .then((_) {});

class BangumiPage extends StatefulWidget {
  const BangumiPage({super.key, required this.controller});
  final AppController controller;
  @override
  State<BangumiPage> createState() => _BangumiPageState();
}

class _BangumiPageState extends State<BangumiPage> {
  final token = TextEditingController();
  bool working = false;
  String message = '';
  @override
  void dispose() {
    token.dispose();
    super.dispose();
  }

  Future<void> run(Future<void> Function() action) async {
    setState(() {
      working = true;
      message = '';
    });
    try {
      await action();
      if (mounted) setState(() => message = '操作完成');
    } catch (error) {
      if (mounted) {
        setState(
          () => message = error is FormatException
              ? error.message
              : '暂时无法连接，请检查网络',
        );
      }
    } finally {
      if (mounted) setState(() => working = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final sync = widget.controller.bangumi;
    return Scaffold(
      appBar: AppBar(title: const Text('Bangumi 同步')),
      body: ListenableBuilder(
        listenable: sync,
        builder: (context, _) => ListView(
          padding: const EdgeInsets.all(24),
          children: [
            Text(
              sync.loggedIn
                  ? '${sync.user!['nickname'] ?? sync.user!['username']}'
                  : '登录 Bangumi',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 12),
            const Text('同步收藏状态与观看集数。集内播放位置保存在本机，Token 使用设备安全存储，不进入备份。'),
            const SizedBox(height: 24),
            if (!sync.loggedIn) ...[
              TextField(
                controller: token,
                obscureText: true,
                autocorrect: false,
                enableSuggestions: false,
                decoration: const InputDecoration(labelText: 'Access Token'),
              ),
              TextButton.icon(
                onPressed: () => launchUrl(
                  Uri.parse('https://next.bgm.tv/demo/access-token'),
                  mode: LaunchMode.externalApplication,
                ),
                icon: const Icon(Icons.open_in_new),
                label: const Text('获取 Access Token'),
              ),
              FilledButton(
                onPressed: working
                    ? null
                    : () => run(() async {
                        await sync.login(token.text);
                        token.clear();
                      }),
                child: const Text('登录并同步'),
              ),
            ] else ...[
              Text(
                sync.lastSync == null
                    ? '尚未完成同步'
                    : '最近同步：${sync.lastSync!.toLocal().toString().split('.').first}',
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: working || sync.busy ? null : () => run(sync.sync),
                icon: const Icon(Icons.sync),
                label: const Text('立即同步'),
              ),
              TextButton(
                onPressed: working ? null : () => run(sync.logout),
                child: const Text('退出登录'),
              ),
            ],
            if (working || sync.busy) const LinearProgressIndicator(),
            const SizedBox(height: 16),
            Text(message.isNotEmpty ? message : sync.lastError),
          ],
        ),
      ),
    );
  }
}

class WebdavPage extends StatefulWidget {
  const WebdavPage({super.key, required this.controller});
  final AppController controller;
  @override
  State<WebdavPage> createState() => _WebdavPageState();
}

class _WebdavPageState extends State<WebdavPage> {
  final url = TextEditingController(),
      username = TextEditingController(),
      password = TextEditingController();
  final client = WebdavClient();
  bool busy = true;
  String message = '';
  LibraryBackup? staged;
  @override
  void initState() {
    super.initState();
    unawaited(load());
  }

  Future<void> load() async {
    try {
      final value = await widget.controller.secrets.read('webdav');
      if (value != null && mounted) {
        final config = jsonDecode(value);
        url.text = config['url'] ?? '';
        username.text = config['username'] ?? '';
        password.text = config['password'] ?? '';
      }
    } catch (_) {
      if (mounted) setState(() => message = '无法读取本机连接配置，请重新填写');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> run(Future<void> Function(WebdavConnection) action) async {
    setState(() {
      busy = true;
      message = '';
    });
    try {
      final connection = WebdavConnection(
        url.text,
        username.text,
        password.text,
      );
      await widget.controller.secrets.write(
        'webdav',
        jsonEncode({
          'url': url.text.trim(),
          'username': username.text,
          'password': password.text,
        }),
      );
      await action(connection);
    } catch (error) {
      if (mounted) {
        setState(
          () => message = error is FormatException
              ? error.message
              : '连接未完成，请检查地址与网络',
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  void dispose() {
    client.close();
    url.dispose();
    username.dispose();
    password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('WebDAV 备份')),
    body: ListView(
      padding: const EdgeInsets.all(24),
      children: [
        const Text('备份收藏、记录、规则和外观。恢复前保留本机副本；账户 Token 与密码不进入备份。'),
        const SizedBox(height: 24),
        TextField(
          controller: url,
          keyboardType: TextInputType.url,
          decoration: const InputDecoration(
            labelText: 'WebDAV 目录地址',
            hintText: 'https://example.com/dav/anime/',
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: username,
          decoration: const InputDecoration(labelText: '用户名'),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: password,
          obscureText: true,
          enableSuggestions: false,
          autocorrect: false,
          decoration: const InputDecoration(labelText: '密码 / 应用密码'),
        ),
        const SizedBox(height: 24),
        Wrap(
          spacing: 12,
          runSpacing: 12,
          children: [
            OutlinedButton(
              onPressed: busy
                  ? null
                  : () => run((connection) async {
                      await client.test(connection);
                      if (mounted) setState(() => message = '连接成功');
                    }),
              child: const Text('测试连接'),
            ),
            FilledButton(
              onPressed: busy
                  ? null
                  : () => run((connection) async {
                      await client.upload(
                        connection,
                        await widget.controller.store.read(),
                      );
                      if (mounted) {
                        setState(() => message = '备份完成，服务器已保留本次独立副本');
                      }
                    }),
              child: const Text('上传备份'),
            ),
            FilledButton.tonal(
              onPressed: busy
                  ? null
                  : () => run((connection) async {
                      final backup = await client.download(connection);
                      if (mounted) {
                        setState(() {
                          staged = backup;
                          message = '请核对内容后恢复';
                        });
                      }
                    }),
              child: const Text('读取云端备份'),
            ),
          ],
        ),
        if (busy) const LinearProgressIndicator(),
        const SizedBox(height: 16),
        Text(message),
        if (staged case final backup?)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${backup.collection.length} 项收藏 · ${backup.history.length} 条记录 · ${backup.rules.length} 条规则',
                  ),
                  const SizedBox(height: 12),
                  FilledButton(
                    onPressed: busy
                        ? null
                        : () async {
                            final confirm = await showDialog<bool>(
                              context: context,
                              builder: (context) => AlertDialog(
                                title: const Text('恢复云端备份？'),
                                content: const Text('较新的记录会保留。同名规则与备份中的设置会更新。'),
                                actions: [
                                  TextButton(
                                    onPressed: () =>
                                        Navigator.pop(context, false),
                                    child: const Text('取消'),
                                  ),
                                  FilledButton(
                                    onPressed: () =>
                                        Navigator.pop(context, true),
                                    child: const Text('恢复'),
                                  ),
                                ],
                              ),
                            );
                            if (confirm == true && mounted) {
                              await run((_) async {
                                await widget.controller.restore(backup);
                                if (mounted) {
                                  setState(() {
                                    staged = null;
                                    message = '恢复完成';
                                  });
                                }
                              });
                            }
                          },
                    child: const Text('确认恢复'),
                  ),
                ],
              ),
            ),
          ),
      ],
    ),
  );
}

class RuleEditorPage extends StatefulWidget {
  const RuleEditorPage({super.key, required this.controller, this.rule});
  final AppController controller;
  final JsonMap? rule;
  @override
  State<RuleEditorPage> createState() => _RuleEditorPageState();
}

class _RuleEditorPageState extends State<RuleEditorPage> {
  late final text = TextEditingController(
    text: const JsonEncoder.withIndent('  ').convert(
      widget.rule ??
          {
            'name': 'my-rule',
            'version': '1.0',
            'type': 'anime',
            'baseUrl': 'https://example.com/',
            'searchURL': '/search?q=@keyword',
            'searchList': '//li',
            'searchName': '//a',
            'searchResult': '//a',
            'chapterRoads': '//ul',
            'chapterResult': '//li/a',
          },
    ),
  );
  String message = '';
  bool busy = false;
  JsonMap validate() {
    final value = jsonDecode(text.text) as JsonMap;
    SourceRule(value);
    return value;
  }

  Future<void> run(Future<void> Function(JsonMap) action) async {
    setState(() => busy = true);
    try {
      final value = validate();
      await action(value);
    } catch (error) {
      if (mounted) {
        setState(
          () => message = error is FormatException
              ? error.message
              : 'JSON 格式或规则字段不完整',
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  void dispose() {
    text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(widget.rule == null ? '新建规则' : '编辑规则'),
      actions: [
        TextButton(
          onPressed: busy
              ? null
              : () => run((value) async {
                  if (widget.rule?['name'] != value['name'] &&
                      widget.controller.library.rules.any(
                        (rule) => rule['name'] == value['name'],
                      )) {
                    throw const FormatException('这个规则名称已存在，请使用其他名称');
                  }
                  await widget.controller.restore(
                    LibraryBackup(rules: [value]),
                  );
                  if (widget.rule != null &&
                      value['name'] != widget.rule!['name']) {
                    await widget.controller.removeRecord(
                      'rules',
                      '${widget.rule!['name']}',
                    );
                  }
                  if (context.mounted) Navigator.pop(context);
                }),
          child: const Text('保存'),
        ),
      ],
    ),
    body: Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Wrap(
            spacing: 8,
            children: [
              TextButton(
                onPressed: () => run((value) async {
                  text.text = const JsonEncoder.withIndent('  ').convert(value);
                  setState(() => message = '校验通过');
                }),
                child: const Text('校验与格式化'),
              ),
              TextButton(
                onPressed: () => run(
                  (_) => Clipboard.setData(ClipboardData(text: text.text)),
                ),
                child: const Text('复制'),
              ),
              TextButton(
                onPressed: () =>
                    run((value) => shareJson('${value['name']}.json', value)),
                child: const Text('分享文件'),
              ),
            ],
          ),
        ),
        if (message.isNotEmpty)
          Padding(padding: const EdgeInsets.all(12), child: Text(message)),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: TextField(
              controller: text,
              expands: true,
              minLines: null,
              maxLines: null,
              autocorrect: false,
              style: const TextStyle(
                fontFamily: 'monospace',
                fontSize: 13,
                height: 1.5,
              ),
              decoration: const InputDecoration(
                labelText: '规则 JSON',
                alignLabelWithHint: true,
              ),
            ),
          ),
        ),
      ],
    ),
  );
}

Future<void> importRuleText(
  BuildContext context,
  AppController controller,
) async {
  final text = TextEditingController();
  final value = await showDialog<String>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('导入规则'),
      content: TextField(
        controller: text,
        minLines: 2,
        maxLines: 6,
        decoration: const InputDecoration(hintText: '粘贴规则 JSON 或 HTTPS 链接'),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('取消'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(context, text.text),
          child: const Text('导入'),
        ),
      ],
    ),
  );
  text.dispose();
  if (value == null || value.trim().isEmpty) return;
  final client = SiteClient();
  try {
    final input = RegExp(r'^[A-Za-z0-9._-]{1,80}$').hasMatch(value.trim())
        ? 'https://raw.githubusercontent.com/Predidit/KazumiRules/main/${value.trim()}.json'
        : value.trim();
    final raw = input.startsWith('https://')
        ? await client.request(PreparedRequest(input))
        : value;
    if (utf8.encode(raw).length > 1024 * 1024) {
      throw const FormatException('规则文件不能超过 1 MB');
    }
    final decoded = jsonDecode(raw);
    final list = decoded is List ? decoded : [decoded];
    final backup = LibraryBackup.decode(
      LibraryBackup(rules: list.cast<JsonMap>()).encode(),
    );
    await controller.restore(backup);
    if (context.mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('已导入 ${backup.rules.length} 条规则')));
    }
  } catch (error) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            error is FormatException ? error.message : '导入失败，请检查链接或 JSON',
          ),
        ),
      );
    }
  } finally {
    client.close();
  }
}
