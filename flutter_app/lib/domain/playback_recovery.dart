import 'dart:async';

bool isDecodeError(String message) =>
    RegExp(r'decod|codec', caseSensitive: false).hasMatch(message);

/// mpv emits recoverable frame errors on its error stream too. Playback progress,
/// rather than a single log line, decides whether recovery is necessary.
class PlaybackRecovery {
  PlaybackRecovery({
    required this.recover,
    required this.onFailure,
    required this.onNotice,
    required this.wantsPlayback,
    this.grace = const Duration(seconds: 3),
    this.recoveryGrace = const Duration(seconds: 10),
  });
  final Future<void> Function() recover;
  final void Function(String) onFailure;
  final void Function(String?) onNotice;
  final bool Function() wantsPlayback;
  final Duration grace, recoveryGrace;
  Timer? _timer;
  int _epoch = 0, _advances = 0, _baseline = 0;
  Duration _position = Duration.zero;
  bool _enabled = false,
      _usedFallback = false,
      _recovering = false,
      _failed = false;
  bool get pending => _timer != null || _recovering;
  void _fail(String message) {
    _failed = true;
    _baseline = _advances;
    onFailure(message);
  }

  void begin({bool software = false}) {
    cancel();
    _enabled = true;
    _usedFallback = software;
    _failed = false;
    _advances = 0;
    _position = Duration.zero;
  }

  void progress(Duration value) {
    if (!_enabled) return;
    if (value > _position + const Duration(milliseconds: 80)) _advances++;
    _position = value;
    if ((_timer != null || _failed) && _advances - _baseline >= 2) {
      _timer?.cancel();
      _timer = null;
      _failed = false;
      onNotice(null);
    }
  }

  void error(String message) {
    if (!_enabled || _recovering || _timer != null) return;
    final decode = isDecodeError(message);
    if (decode && !wantsPlayback()) return;
    _baseline = _advances;
    final epoch = _epoch;
    _timer = Timer(grace, () async {
      _timer = null;
      if (!_enabled || epoch != _epoch || (decode && !wantsPlayback())) return;
      if (_advances - _baseline >= 2) return;
      if (!decode || _usedFallback) {
        _fail(decode ? '当前媒体仍无法解码，可重试或切换线路' : '媒体加载失败，可重试或切换片源');
        return;
      }
      _usedFallback = true;
      _recovering = true;
      onNotice('正在切换兼容解码…');
      try {
        await recover();
        if (!_enabled || epoch != _epoch) return;
        _recovering = false;
        if (_advances - _baseline >= 2) {
          onNotice(null);
          return;
        }
        _baseline = _advances;
        _timer = Timer(recoveryGrace, () {
          _timer = null;
          if (!_enabled || epoch != _epoch || !wantsPlayback()) return;
          if (_advances - _baseline < 2) _fail('兼容解码未能恢复播放，请尝试其他线路或片源');
        });
      } catch (_) {
        if (_enabled && epoch == _epoch) {
          _recovering = false;
          _fail('无法恢复当前媒体，请重试或切换线路');
        }
      }
    });
  }

  void cancel() {
    _epoch++;
    _enabled = false;
    _recovering = false;
    _timer?.cancel();
    _timer = null;
  }
}
