import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';

import 'rule_engine.dart';
import 'site_client.dart';

class MediaProbe {
  HeadlessInAppWebView? _browser;
  Completer<String?>? _result;
  bool _cancelled = false;
  Map<String, String> resolvedHeaders = {};
  Future<String?> resolve(
    SourceRule rule,
    String page, {
    Map<String, String> headers = const {},
  }) async {
    await prepareSiteBrowser();
    if (_cancelled) return null;
    final result = _result = Completer<String?>();
    void found(String url, [Map<String, String>? headers]) {
      final uri = Uri.tryParse(url);
      if (uri != null &&
          {'http', 'https'}.contains(uri.scheme) &&
          isMediaUrl(url) &&
          !RegExp(
            r'/(?:ads?|banner|logo|thumb)[/_.-]',
            caseSensitive: false,
          ).hasMatch(uri.path) &&
          !result.isCompleted &&
          !_cancelled) {
        const names = {
          'referer': 'Referer',
          'user-agent': 'User-Agent',
          'origin': 'Origin',
        };
        resolvedHeaders = {
          for (final entry in (headers ?? <String, String>{}).entries)
            if (names.containsKey(entry.key.toLowerCase()))
              names[entry.key.toLowerCase()]!: entry.value,
        };
        result.complete(url);
      }
    }

    final browser = _browser = HeadlessInAppWebView(
      webViewEnvironment: siteWebEnvironment,
      initialUrlRequest: URLRequest(
        url: WebUri(page),
        headers: {...rule.headers(page), ...headers},
      ),
      initialSettings: InAppWebViewSettings(
        userAgent: rule.headers(page)['User-Agent'],
        javaScriptEnabled: true,
        mediaPlaybackRequiresUserGesture: false,
        useOnLoadResource: true,
        useShouldInterceptRequest: true,
        supportMultipleWindows: false,
      ),
      onLoadResource: (_, resource) {
        if (resource.url != null) found(resource.url.toString());
      },
      shouldInterceptRequest: (_, request) async {
        found(request.url.toString(), request.headers);
        return null;
      },
      onWebViewCreated: (controller) {
        controller.addJavaScriptHandler(
          handlerName: 'animeMedia',
          callback: (arguments) {
            if (arguments.isNotEmpty) found('${arguments.first}');
            return null;
          },
        );
      },
      onLoadStop: (controller, _) async {
        await controller.evaluateJavascript(
          source: r'''
          (() => {
            const report = u => { if (u) window.flutter_inappwebview.callHandler('animeMedia', String(u)); };
            document.querySelectorAll('video,source').forEach(v => { report(v.currentSrc || v.src); });
            performance.getEntriesByType('resource').forEach(e => report(e.name));
            document.querySelectorAll('video').forEach(v => { v.muted = true; v.play().catch(() => {}); });
            if (!window.__animeResourceObserver) {
              window.__animeResourceObserver = new PerformanceObserver(list => list.getEntries().forEach(e => report(e.name)));
              window.__animeResourceObserver.observe({entryTypes: ['resource']});
            }
          })();
        ''',
        );
      },
    );
    try {
      await browser.run().timeout(const Duration(seconds: 10));
      return await result.future.timeout(
        const Duration(seconds: 18),
        onTimeout: () => null,
      );
    } finally {
      await browser.dispose();
      if (identical(_browser, browser)) _browser = null;
    }
  }

  void cancel() {
    _cancelled = true;
    if (_result case final result? when !result.isCompleted) {
      result.complete(null);
    }
    // resolve owns disposal, including cancellation while run is pending.
  }
}

class SiteBrowserPage extends StatefulWidget {
  const SiteBrowserPage({super.key, required this.challenge});
  final SiteVerification challenge;
  @override
  State<SiteBrowserPage> createState() => _SiteBrowserPageState();
}

class _SiteBrowserPageState extends State<SiteBrowserPage> {
  late final Future<WebViewEnvironment?> environment = prepareSiteBrowser();
  double progress = 0;
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text('网站验证 · ${widget.challenge.rule.name}'),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, true),
          child: const Text('完成并重试'),
        ),
      ],
    ),
    body: FutureBuilder<WebViewEnvironment?>(
      future: environment,
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return const Center(child: Text('无法打开网站，请确认已安装系统 WebView 组件'));
        }
        if (snapshot.connectionState != ConnectionState.done) {
          return const Center(child: CircularProgressIndicator());
        }
        return Column(
          children: [
            if (progress < 1) LinearProgressIndicator(value: progress),
            Expanded(
              child: InAppWebView(
                webViewEnvironment: snapshot.data,
                initialUrlRequest: URLRequest(
                  url: WebUri(widget.challenge.url),
                  headers: widget.challenge.rule.headers(widget.challenge.url),
                ),
                initialSettings: InAppWebViewSettings(
                  userAgent: widget.challenge.rule.headers(
                    widget.challenge.url,
                  )['User-Agent'],
                  supportMultipleWindows: false,
                ),
                onProgressChanged: (_, value) {
                  if (mounted) setState(() => progress = value / 100);
                },
              ),
            ),
          ],
        );
      },
    ),
  );
}
