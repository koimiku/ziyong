package com.anime.standalone

import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import android.webkit.WebViewClient
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "anime/native").setMethodCallHandler { call, result ->
            if (call.method == "legacySnapshot") legacySnapshot(result) else result.notImplemented()
        }
    }
    private fun legacySnapshot(result: MethodChannel.Result) {
        val view = WebView(this)
        var finished = false
        fun finish(value: String?) {
            if (finished) return
            finished = true
            view.stopLoading()
            view.destroy()
            result.success(value)
        }
        view.settings.javaScriptEnabled = true
        view.settings.domStorageEnabled = true
        view.settings.blockNetworkLoads = true
        view.webViewClient = object : WebViewClient() {
            override fun onPageFinished(webView: WebView, url: String) {
                webView.evaluateJavascript("""
                    (() => {
                      const keys = ['anime-collection','anime-watch-history','anime-kazumi-rules-v1','anime-theme','anime-palette-light','anime-palette-dark','anime-startup','anime-auto-health','anime-search-recent','anime-bangumi-token','anime-bangumi-user','anime-webdav-config'];
                      return JSON.stringify(Object.fromEntries(keys.map(k => [k, localStorage.getItem(k)])));
                    })()
                """.trimIndent()) { value -> finish(value) }
            }
        }
        view.loadDataWithBaseURL("https://localhost/", "<!doctype html><title>anime migration</title>", "text/html", "UTF-8", null)
        Handler(Looper.getMainLooper()).postDelayed({ finish(null) }, 7000)
    }
}
