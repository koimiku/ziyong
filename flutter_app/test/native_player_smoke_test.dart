import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:media_kit/media_kit.dart';

// Optional local FFI smoke test; ordinary CI does not require an audio device.
// flutter test --dart-define=MPV_SMOKE_LIBRARY=<absolute libmpv DLL path> test/native_player_smoke_test.dart
void main() {
  const library = String.fromEnvironment('MPV_SMOKE_LIBRARY');
  test('native player opens, seeks and releases a local media file', () async {
    MediaKit.ensureInitialized(libmpv: library);
    final directory = await Directory.systemTemp.createTemp('anime-player-');
    final player = Player();
    try {
      const samples = 16000, rate = 8000;
      final bytes = Uint8List(44 + samples * 2);
      final header = ByteData.sublistView(bytes);
      void text(int offset, String value) =>
          bytes.setRange(offset, offset + value.length, value.codeUnits);
      text(0, 'RIFF');
      header.setUint32(4, bytes.length - 8, Endian.little);
      text(8, 'WAVEfmt ');
      header.setUint32(16, 16, Endian.little);
      header.setUint16(20, 1, Endian.little);
      header.setUint16(22, 1, Endian.little);
      header.setUint32(24, rate, Endian.little);
      header.setUint32(28, rate * 2, Endian.little);
      header.setUint16(32, 2, Endian.little);
      header.setUint16(34, 16, Endian.little);
      text(36, 'data');
      header.setUint32(40, samples * 2, Endian.little);
      final file = await File('${directory.path}/silent.wav')
          .writeAsBytes(bytes);
      await player.setVolume(0);
      final native = player.platform as NativePlayer;
      await native.setProperty('hwdec', 'auto-safe');
      expect(await native.getProperty('hwdec'), 'auto-safe');
      await native.setProperty('hwdec', 'no');
      expect(await native.getProperty('hwdec'), 'no');
      final duration = player.stream.duration
          .firstWhere((value) => value.inSeconds >= 2)
          .timeout(const Duration(seconds: 10));
      await player.open(Media(file.uri.toString()), play: false);
      expect((await duration).inSeconds, 2);
      await player.seek(const Duration(seconds: 1));
      await player.pause();
      expect(player.state.playing, false);
      await player.stop();
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      var receivedHeader = false;
      final listener = server.listen((request) async {
        receivedHeader = request.headers.value('x-anime-smoke') == 'verified';
        request.response.headers.contentType = ContentType('audio', 'wav');
        request.response.contentLength = bytes.length;
        request.response.add(bytes);
        await request.response.close();
      });
      try {
        await player.open(
          Media(
            'http://127.0.0.1:${server.port}/silent.wav',
            httpHeaders: {'X-Anime-Smoke': 'verified'},
          ),
          play: false,
        );
        final deadline = DateTime.now().add(const Duration(seconds: 10));
        while ((!receivedHeader || player.state.duration.inSeconds < 2) &&
            DateTime.now().isBefore(deadline)) {
          await Future<void>.delayed(const Duration(milliseconds: 50));
        }
        expect(player.state.duration.inSeconds, 2);
        expect(receivedHeader, true);
        await player.stop();
      } finally {
        await listener.cancel();
        await server.close(force: true);
      }
    } finally {
      await player.dispose();
      await directory.delete(recursive: true);
    }
  }, skip: !Platform.isWindows || library.isEmpty);
}
