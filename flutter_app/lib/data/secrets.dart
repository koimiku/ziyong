import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class SecretStore {
  SecretStore() : memory = null;
  SecretStore.memory(this.memory);
  final Map<String, String>? memory;
  final storage = const FlutterSecureStorage();
  Future<String?> read(String key) async =>
      memory != null ? memory![key] : storage.read(key: key);
  Future<void> write(String key, String? value) async {
    if (memory != null) {
      if (value == null) {
        memory!.remove(key);
      } else {
        memory![key] = value;
      }
      return;
    }
    if (value == null) {
      await storage.delete(key: key);
    } else {
      await storage.write(key: key, value: value);
    }
  }
}
