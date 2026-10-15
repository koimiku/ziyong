import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../app_controller.dart';

({bool enabled, String image}) startupConfig(AppController controller) {
  try {
    final config = jsonDecode(controller.setting('anime-startup', '{}'));
    final image = '${config['image'] ?? ''}';
    if (image.isNotEmpty) base64Decode(image.split(',').last);
    return (
      enabled: config['enabled'] == true,
      image:
          image.length < 1500000 &&
              RegExp(r'^data:image/(png|jpeg|webp);base64,').hasMatch(image)
          ? image
          : '',
    );
  } catch (_) {
    return (enabled: false, image: '');
  }
}

class StartupGate extends StatefulWidget {
  const StartupGate({super.key, required this.controller, required this.child});
  final AppController controller;
  final Widget child;
  @override
  State<StartupGate> createState() => _StartupGateState();
}

class _StartupGateState extends State<StartupGate> {
  late final config = startupConfig(widget.controller);
  late bool show = config.enabled;
  Timer? timer;
  @override
  void initState() {
    super.initState();
    if (show) {
      timer = Timer(const Duration(milliseconds: 1200), () {
        if (mounted) setState(() => show = false);
      });
    }
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!show) return widget.child;
    return Scaffold(
      body: SafeArea(
        child: Stack(
          fit: StackFit.expand,
          children: [
            Center(
              child: config.image.isEmpty
                  ? Text(
                      'anime',
                      style: Theme.of(context).textTheme.displaySmall,
                    )
                  : Image.memory(
                      base64Decode(config.image.split(',').last),
                      fit: BoxFit.contain,
                      errorBuilder: (_, _, _) => const SizedBox.shrink(),
                    ),
            ),
            Positioned(
              right: 20,
              top: 12,
              child: TextButton(
                onPressed: () {
                  timer?.cancel();
                  setState(() => show = false);
                },
                child: const Text('跳过'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class StartupPage extends StatefulWidget {
  const StartupPage({super.key, required this.controller});
  final AppController controller;
  @override
  State<StartupPage> createState() => _StartupPageState();
}

class _StartupPageState extends State<StartupPage> {
  bool busy = false;
  String error = '';
  Future<void> pick() async {
    setState(() {
      busy = true;
      error = '';
    });
    try {
      final file = await FilePicker.pickFile(
        type: FileType.custom,
        allowedExtensions: ['png', 'jpg', 'jpeg', 'webp'],
      );
      if (file == null) return;
      final bytes = <int>[];
      await for (final chunk in file.readAsByteStream()) {
        if (bytes.length + chunk.length > 10 * 1024 * 1024) {
          throw const FormatException('图片不能超过 10 MB');
        }
        bytes.addAll(chunk);
      }
      final buffer = await ui.ImmutableBuffer.fromUint8List(
        Uint8List.fromList(bytes),
      );
      final descriptor = await ui.ImageDescriptor.encoded(buffer);
      try {
        if (descriptor.width * descriptor.height > 50000000) {
          throw const FormatException('图片分辨率过大');
        }
        final scale = math.min(
          1.0,
          1080 / math.max(descriptor.width, descriptor.height),
        );
        final codec = await descriptor.instantiateCodec(
          targetWidth: (descriptor.width * scale).round(),
          targetHeight: (descriptor.height * scale).round(),
        );
        try {
          final frame = await codec.getNextFrame();
          try {
            final result = await frame.image.toByteData(
              format: ui.ImageByteFormat.png,
            );
            final encoded =
                'data:image/png;base64,${base64Encode(result!.buffer.asUint8List())}';
            if (encoded.length >= 1500000) {
              throw const FormatException('图片细节过多，请选择更小的图片');
            }
            await widget.controller.setSetting(
              'anime-startup',
              jsonEncode({'enabled': true, 'image': encoded}),
            );
          } finally {
            frame.image.dispose();
          }
        } finally {
          codec.dispose();
        }
      } finally {
        descriptor.dispose();
        buffer.dispose();
      }
    } catch (failure) {
      if (mounted) {
        setState(
          () =>
              error = failure is FormatException ? failure.message : '无法读取这张图片',
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('启动外观')),
    body: ListenableBuilder(
      listenable: widget.controller.settingsChanges,
      builder: (context, _) {
        final config = startupConfig(widget.controller);
        return ListView(
          padding: const EdgeInsets.all(24),
          children: [
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('显示开屏'),
              subtitle: const Text('关闭后直接进入首页'),
              value: config.enabled,
              onChanged: busy
                  ? null
                  : (value) => widget.controller.setSetting(
                      'anime-startup',
                      jsonEncode({'enabled': value, 'image': config.image}),
                    ),
            ),
            const SizedBox(height: 20),
            if (config.image.isNotEmpty)
              SizedBox(
                height: 280,
                child: Image.memory(
                  base64Decode(config.image.split(',').last),
                  fit: BoxFit.contain,
                  errorBuilder: (_, _, _) => const Text('图片不可用'),
                ),
              ),
            const SizedBox(height: 20),
            FilledButton.tonalIcon(
              onPressed: busy ? null : pick,
              icon: const Icon(Icons.image_outlined),
              label: const Text('选择自定义启动图'),
            ),
            if (config.image.isNotEmpty)
              TextButton(
                onPressed: () => widget.controller.setSetting(
                  'anime-startup',
                  jsonEncode({'enabled': config.enabled, 'image': ''}),
                ),
                child: const Text('移除图片'),
              ),
            if (busy) const LinearProgressIndicator(),
            Text(error),
          ],
        );
      },
    ),
  );
}
