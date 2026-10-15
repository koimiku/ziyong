import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../app_controller.dart';

class PhonePage extends StatefulWidget {
  const PhonePage({super.key, required this.controller});
  final AppController controller;
  @override
  State<PhonePage> createState() => _PhonePageState();
}

class _PhonePageState extends State<PhonePage> {
  bool busy = false;
  String error = '';
  Future<void> toggle(bool enable) async {
    setState(() {
      busy = true;
      error = '';
    });
    try {
      if (enable) {
        await widget.controller.phone.start();
      } else {
        await widget.controller.phone.stop();
      }
    } catch (_) {
      if (mounted) {
        setState(() => error = '无法启动，请确认电脑已连接局域网，且端口 47890 未被其他程序占用');
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final server = widget.controller.phone;
    return Scaffold(
      appBar: AppBar(title: const Text('手机观看')),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          const Text(
            '电脑与手机连接同一 Wi-Fi，电脑插网线也可以。开启后用手机相机扫描二维码，在浏览器中搜索、选集和播放。保持电脑应用运行；首次使用可允许系统防火墙在专用网络访问。',
          ),
          const SizedBox(height: 20),
          if (Platform.isWindows)
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: server.running,
              onChanged: busy ? null : toggle,
              title: const Text('开启局域网访问'),
              subtitle: const Text('每次开启生成新的连接码，关闭后立即失效'),
            )
          else
            const Text('当前设备可直接使用原生播放器。局域网分享服务在 Windows 版设置中开启，Android 可扫码访问。'),
          if (server.running && server.addresses.isNotEmpty) ...[
            Center(
              child: ColoredBox(
                color: Colors.white,
                child: QrImageView(data: server.addresses.first, size: 240),
              ),
            ),
            const SizedBox(height: 12),
            SelectableText(server.addresses.first),
            TextButton.icon(
              onPressed: () => Clipboard.setData(
                ClipboardData(text: server.addresses.first),
              ),
              icon: const Icon(Icons.copy),
              label: const Text('复制地址'),
            ),
            const Text('连接码包含访问权限，请只分享给你信任的同一局域网设备。'),
          ],
          if (busy) const LinearProgressIndicator(),
          Text(error),
        ],
      ),
    );
  }
}
