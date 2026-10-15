import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../data/app_update.dart';

class UpdatePage extends StatefulWidget {
  const UpdatePage({super.key});
  @override
  State<UpdatePage> createState() => _UpdatePageState();
}

class _UpdatePageState extends State<UpdatePage> {
  bool busy = false;
  String message = '';
  AppRelease? release;
  Future<void> check() async {
    setState(() {
      busy = true;
      message = '';
    });
    try {
      final value = await checkUpdate();
      if (mounted) {
        setState(() {
          release = value;
          message = newerVersion(value.version, appVersion)
              ? '发现新版本 ${value.version}'
              : '当前已是最新版';
        });
      }
    } catch (_) {
      if (mounted) setState(() => message = '暂时无法检查更新，可打开发布页查看');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('应用更新')),
    body: ListView(
      padding: const EdgeInsets.all(24),
      children: [
        Text(
          'anime $appVersion',
          style: Theme.of(context).textTheme.headlineSmall,
        ),
        const SizedBox(height: 16),
        const Text(
          '更新时下载正式安装包并覆盖安装，保留收藏、记录和设置。Android 安装由系统确认；Windows 解压新版后运行 anime.exe。',
        ),
        const SizedBox(height: 24),
        FilledButton.icon(
          onPressed: busy ? null : check,
          icon: const Icon(Icons.system_update_alt),
          label: const Text('检查更新'),
        ),
        TextButton(
          onPressed: () => launchUrl(
            Uri.parse(releasesUrl),
            mode: LaunchMode.externalApplication,
          ),
          child: const Text('打开发布页'),
        ),
        if (busy) const LinearProgressIndicator(),
        Text(message),
        if (release case final value?
            when newerVersion(value.version, appVersion)) ...[
          const SizedBox(height: 12),
          Text(value.notes),
          const SizedBox(height: 16),
          FilledButton.tonal(
            onPressed: () => launchUrl(
              Uri.parse(value.url),
              mode: LaunchMode.externalApplication,
            ),
            child: const Text('下载新版本'),
          ),
        ],
      ],
    ),
  );
}
