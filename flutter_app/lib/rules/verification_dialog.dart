import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';

import 'captcha.dart';
import 'rule_engine.dart';
import 'site_client.dart';

bool isVerificationWebUrl(String? value) {
  final uri = Uri.tryParse(value ?? '');
  return uri != null &&
      uri.host.isNotEmpty &&
      {'http', 'https'}.contains(uri.scheme);
}

Future<bool> showSiteVerification(
  BuildContext context,
  SiteVerification challenge, {
  WidgetBuilder? contentBuilder,
}) async {
  if (!isVerificationWebUrl(challenge.url)) {
    ScaffoldMessenger.of(context)
        .showSnackBar(const SnackBar(content: Text('验证地址无效')));
    return false;
  }
  return await showDialog<bool>(
        context: context,
        useRootNavigator: false,
        barrierDismissible: false,
        builder: (context) => Dialog(
          insetPadding: const EdgeInsets.all(16),
          clipBehavior: Clip.antiAlias,
          child: ConstrainedBox(
            constraints: BoxConstraints(
              maxWidth: 720,
              maxHeight: MediaQuery.sizeOf(context).height * .84,
            ),
            child:
                contentBuilder?.call(context) ??
                _VerificationDialog(challenge: challenge),
          ),
        ),
      ) ??
      false;
}

class CaptchaPrompt extends StatelessWidget {
  const CaptchaPrompt({
    super.key,
    required this.image,
    required this.answer,
    required this.message,
    required this.submitting,
    required this.onSubmit,
    required this.onRefresh,
    required this.onWebsite,
  });
  final Uint8List? image;
  final TextEditingController answer;
  final String message;
  final bool submitting;
  final VoidCallback onSubmit, onRefresh, onWebsite;
  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(24),
    children: [
      Text('输入验证码', style: Theme.of(context).textTheme.titleLarge),
      const SizedBox(height: 8),
      const Text('输入下图中的字符，完成后自动继续当前操作。'),
      const SizedBox(height: 20),
      Container(
        height: 96,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surfaceContainerHigh,
          borderRadius: BorderRadius.circular(16),
        ),
        child: image == null
            ? const Text('正在获取验证码…')
            : Image.memory(
                image!,
                height: 80,
                fit: BoxFit.contain,
                errorBuilder: (_, error, stack) => const Text('图片加载失败，请换一张'),
              ),
      ),
      Align(
        alignment: Alignment.centerRight,
        child: TextButton.icon(
          onPressed: submitting ? null : onRefresh,
          icon: const Icon(Icons.refresh_rounded),
          label: const Text('换一张'),
        ),
      ),
      TextField(
        controller: answer,
        enabled: image != null && !submitting,
        autocorrect: false,
        enableSuggestions: false,
        textInputAction: TextInputAction.done,
        maxLength: 64,
        decoration: const InputDecoration(labelText: '验证码', counterText: ''),
        onSubmitted: (_) => onSubmit(),
      ),
      if (message.isNotEmpty)
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Text(
            message,
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        ),
      const SizedBox(height: 16),
      FilledButton(
        onPressed: image == null || submitting ? null : onSubmit,
        child: Text(submitting ? '正在验证…' : '验证并继续'),
      ),
      TextButton(onPressed: onWebsite, child: const Text('图片无法加载？在此弹窗内验证')),
    ],
  );
}

class _VerificationDialog extends StatefulWidget {
  const _VerificationDialog({required this.challenge});
  final SiteVerification challenge;
  @override
  State<_VerificationDialog> createState() => _VerificationDialogState();
}

class _VerificationDialogState extends State<_VerificationDialog> {
  late final environment = prepareSiteBrowser();
  final answer = TextEditingController();
  final captcha = CaptchaState();
  InAppWebViewController? browser;
  Timer? timer;
  DateTime started = DateTime.now(), submittedAt = DateTime.now();
  bool website = false,
      loading = true,
      polling = false,
      finished = false,
      failed = false;
  int generation = 0;
  @override
  void initState() {
    super.initState();
    final type = widget.challenge.rule.config(
      'antiCrawlerConfig',
    )['captchaType'];
    website = type == 2 || type == 3;
  }

  double progress = 0;
  @override
  void dispose() {
    finished = true;
    timer?.cancel();
    answer.dispose();
    super.dispose();
  }

  void begin() {
    timer?.cancel();
    started = DateTime.now();
    timer = Timer.periodic(
      const Duration(milliseconds: 600),
      (_) => unawaited(tick()),
    );
    unawaited(tick());
  }

  Future<void> tick() async {
    if (!mounted ||
        finished ||
        polling ||
        loading ||
        failed ||
        browser == null) {
      return;
    }
    if (DateTime.now().difference(started) > const Duration(minutes: 2)) {
      timer?.cancel();
      setState(() => captcha.message = '验证等待超时，请换一张重试');
      return;
    }
    polling = true;
    final token = generation;
    try {
      final oldImage = captcha.imageUrl;
      final raw = await browser!
          .evaluateJavascript(
            source: captchaProbe(
              widget.challenge.rule.config('antiCrawlerConfig'),
            ),
          )
          .timeout(const Duration(seconds: 5));
      if (!mounted || finished || token != generation) return;
      if (captcha.update(raw)) {
        finished = true;
        timer?.cancel();
        Navigator.pop(context, true);
        return;
      }
      if (oldImage != captcha.imageUrl) answer.clear();
      if (captcha.submitted &&
          DateTime.now().difference(submittedAt) >
              const Duration(seconds: 10)) {
        captcha.submitted = false;
        captcha.message = '验证未通过，请检查验证码或换一张重试';
      }
      if (captcha.image == null &&
          DateTime.now().difference(started) > const Duration(seconds: 12)) {
        captcha.message = '此网站可能需要滑块等操作，可在此弹窗内打开原站验证';
      }
      setState(() {});
    } catch (_) {
      if (mounted && !finished) {
        setState(() => captcha.message = '暂时无法读取验证码，可在此弹窗内打开原站验证');
      }
    } finally {
      polling = false;
    }
  }

  Future<void> submit() async {
    if (browser == null || captcha.submitted) return;
    if (!captcha.canSubmit) {
      setState(() => captcha.message = '未找到网站的提交按钮，请在此弹窗内打开原站验证');
      return;
    }
    final code = answer.text.trim();
    if (code.isEmpty) {
      setState(() => captcha.message = '请输入验证码');
      return;
    }
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {
      captcha.submitted = true;
      captcha.message = '';
      submittedAt = DateTime.now();
    });
    begin();
    try {
      final sent = await browser!
          .evaluateJavascript(
            source: captchaSubmit(
              widget.challenge.rule.config('antiCrawlerConfig'),
              code,
            ),
          )
          .timeout(const Duration(seconds: 5));
      if (sent != true && sent != 'true') {
        throw const FormatException('验证码输入位置已变化');
      }
    } catch (_) {
      if (mounted && !finished) {
        setState(() {
          captcha.submitted = false;
          captcha.message = '未能提交，请换一张或在弹窗内打开原站验证';
        });
      }
    }
  }

  Future<void> refresh() async {
    generation++;
    captcha.reset();
    answer.clear();
    setState(() {
      loading = true;
      failed = false;
    });
    try {
      await browser?.reload();
    } catch (_) {
      if (mounted) {
        setState(() {
          loading = false;
          captcha.message = '刷新失败，请重试';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) => Column(
    children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(20, 8, 8, 8),
        child: Row(
          children: [
            const Icon(Icons.verified_user_outlined),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('网站验证', style: Theme.of(context).textTheme.titleMedium),
                  Text(
                    widget.challenge.rule.label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            IconButton(
              tooltip: '关闭验证',
              onPressed: () => Navigator.pop(context, false),
              icon: const Icon(Icons.close_rounded),
            ),
          ],
        ),
      ),
      if (loading)
        LinearProgressIndicator(value: progress > 0 ? progress : null),
      Expanded(
        child: FutureBuilder<WebViewEnvironment?>(
          future: environment,
          builder: (context, snapshot) {
            if (snapshot.hasError) {
              return const Center(
                child: Padding(
                  padding: EdgeInsets.all(24),
                  child: Text('无法打开验证组件，请检查系统 WebView 是否可用'),
                ),
              );
            }
            if (snapshot.connectionState != ConnectionState.done) {
              return const Center(child: CircularProgressIndicator());
            }
            return Stack(
              children: [
                Positioned.fill(
                  child: IgnorePointer(
                    ignoring: !website,
                    child: Opacity(
                      opacity: website ? 1 : 0,
                      child: InAppWebView(
                        webViewEnvironment: snapshot.data,
                        initialUrlRequest: URLRequest(
                          url: WebUri(widget.challenge.url),
                          headers: widget.challenge.rule.headers(
                            widget.challenge.url,
                          ),
                        ),
                        initialSettings: InAppWebViewSettings(
                          userAgent: widget.challenge.rule.headers(
                            widget.challenge.url,
                          )['User-Agent'],
                          javaScriptEnabled: true,
                          mediaPlaybackRequiresUserGesture: true,
                          supportMultipleWindows: true,
                          javaScriptCanOpenWindowsAutomatically: false,
                          useShouldOverrideUrlLoading: true,
                        ),
                        onWebViewCreated: (controller) => browser = controller,
                        onLoadStart: (_, url) {
                          generation++;
                          if (mounted) {
                            setState(() {
                              loading = true;
                              failed = false;
                            });
                          }
                        },
                        onReceivedError: (_, request, error) {
                          if (request.isForMainFrame == true && mounted) {
                            generation++;
                            timer?.cancel();
                            setState(() {
                              loading = false;
                              failed = true;
                              captcha.message = '验证页面加载失败，请刷新后重试';
                            });
                          }
                        },
                        onLoadStop: (_, url) {
                          if (mounted) {
                            setState(() => loading = false);
                            begin();
                          }
                        },
                        onProgressChanged: (_, value) {
                          if (mounted) setState(() => progress = value / 100);
                        },
                        shouldOverrideUrlLoading: (_, action) async =>
                            isVerificationWebUrl(action.request.url?.toString())
                            ? NavigationActionPolicy.ALLOW
                            : NavigationActionPolicy.CANCEL,
                        onCreateWindow: (controller, action) async {
                          if (isVerificationWebUrl(
                            action.request.url?.toString(),
                          )) {
                            await controller.loadUrl(
                              urlRequest: action.request,
                            );
                          }
                          return false;
                        },
                      ),
                    ),
                  ),
                ),
                if (!website)
                  Positioned.fill(
                    child: ColoredBox(
                      color: Theme.of(context).colorScheme.surface,
                      child: CaptchaPrompt(
                        image: captcha.image,
                        answer: answer,
                        message: captcha.message,
                        submitting: captcha.submitted,
                        onSubmit: submit,
                        onRefresh: refresh,
                        onWebsite: () {
                          FocusManager.instance.primaryFocus?.unfocus();
                          setState(() => website = true);
                        },
                      ),
                    ),
                  ),
              ],
            );
          },
        ),
      ),
      if (website)
        Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (captcha.message.isNotEmpty)
                Text(
                  captcha.message,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              Row(
                children: [
                  TextButton(
                    onPressed: () => setState(() => website = false),
                    child: const Text('返回验证码'),
                  ),
                  const Spacer(),
                  FilledButton(
                    onPressed: () => Navigator.pop(context, true),
                    child: const Text('完成后重试'),
                  ),
                ],
              ),
            ],
          ),
        ),
    ],
  );
}
