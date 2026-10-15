import 'dart:convert';
import 'dart:typed_data';

import '../domain/library_backup.dart';

// Values are JSON encoded before entering JavaScript; user input is never code.
String captchaProbe(JsonMap config) =>
    '''
(() => {
 const x = path => { try { return path ? document.evaluate(path, document, null, 9, null).singleNodeValue : null; } catch (_) { return null; } };
 if (!window.__animeCaptchaHook) {
   window.__animeCaptchaHook = true;
   window.alert = message => { window.__animeCaptchaAlert = String(message || ''); };
 }
 const image = x(${jsonEncode(config['captchaImage'] ?? '')}) || document.querySelector('img.mac_verify_img,img.ds-verify-img,img[src*="/verify"],img[src*="captcha"]');
 const input = x(${jsonEncode(config['captchaInput'] ?? '')}) || document.querySelector('input[name="verify"],input[name="verify_code"],input[name="captcha"],input.ds-verify');
 if (input && !window.__animeCaptchaFocused) {
   window.__animeCaptchaFocused = true;
   try { if (window.jQuery) window.jQuery(input).trigger('focus'); else input.focus({preventScroll: true}); } catch (_) {}
 }
 const box = input?.closest('form,.mac_msg_jump,.ds-verify-box,.verify-box') || input?.parentElement;
 const button = x(${jsonEncode(config['captchaButton'] ?? '')}) || document.querySelector('.verify_submit,#verify_submit,#verify-submit,.verify-submit') || box?.querySelector('button[type="submit"],input[type="submit"],input[type="button"],button');
 const out = {ready: document.readyState === 'complete', present: !!(image && input), canSubmit: !!(image && input && button), image: '', alert: window.__animeCaptchaAlert || '', challenge: /Just a moment|安全检查中|人机验证/.test(document.title)};
 window.__animeCaptchaAlert = '';
 if (image && input && image.complete && image.naturalWidth > 0 && image.naturalWidth <= 2048 && image.naturalHeight <= 2048 && image.naturalWidth * image.naturalHeight <= 1048576) {
   try {
     const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
     canvas.getContext('2d').drawImage(image, 0, 0); out.image = canvas.toDataURL('image/png');
   } catch (_) {}
 }
 return JSON.stringify(out);
})()
''';

String captchaSubmit(JsonMap config, String answer) =>
    '''
(() => {
 const x = path => { try { return path ? document.evaluate(path, document, null, 9, null).singleNodeValue : null; } catch (_) { return null; } };
 const field = x(${jsonEncode(config['captchaInput'] ?? '')}) || document.querySelector('input[name="verify"],input[name="verify_code"],input[name="captcha"],input.ds-verify');
 const box = field?.closest('form,.mac_msg_jump,.ds-verify-box,.verify-box') || field?.parentElement;
 const button = x(${jsonEncode(config['captchaButton'] ?? '')}) || document.querySelector('.verify_submit,#verify_submit,#verify-submit,.verify-submit') || box?.querySelector('button[type="submit"],input[type="submit"],input[type="button"],button');
 if (!field || !button) return false;
 Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, ${jsonEncode(answer)});
 field.dispatchEvent(new Event('input', {bubbles: true})); field.dispatchEvent(new Event('change', {bubbles: true}));
 button.click(); return true;
})()
''';

class CaptchaState {
  Uint8List? image;
  String imageUrl = '', message = '';
  bool seen = false, submitted = false, canSubmit = false;
  int missing = 0;
  bool update(Object? raw) {
    var value = raw;
    for (var i = 0; i < 2 && value is String; i++) {
      value = jsonDecode(value);
    }
    if (value is! Map) return false;
    canSubmit = value['canSubmit'] == true;
    if (value['present'] == true) {
      seen = true;
      missing = 0;
      final data = '${value['image'] ?? ''}';
      if (data.startsWith('data:image/png;base64,') &&
          data.length <= 1400000 &&
          data != imageUrl) {
        try {
          final bytes = base64Decode(
            data.substring('data:image/png;base64,'.length),
          );
          if (bytes.isNotEmpty) {
            message = submitted ? '验证码已更新，请重新输入' : '';
            image = bytes;
            imageUrl = data;
            submitted = false;
          }
        } on FormatException {
          /* Wait for a valid image or offer the embedded site. */
        }
      }
      if ('${value['alert'] ?? ''}'.isNotEmpty) {
        message = '${value['alert']}'.substring(
          0,
          '${value['alert']}'.length.clamp(0, 180),
        );
        submitted = false;
      }
      return false;
    }
    // Two complete-page observations prevent a loading frame from counting as success.
    if (seen && value['ready'] == true && value['challenge'] != true) {
      return ++missing >= 2;
    }
    missing = 0;
    return false;
  }

  void reset() {
    image = null;
    imageUrl = '';
    message = '';
    seen = false;
    submitted = false;
    canSubmit = false;
    missing = 0;
  }
}
