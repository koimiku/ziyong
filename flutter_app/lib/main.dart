import 'dart:convert';
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/foundation.dart';

import 'app.dart';
import 'app_controller.dart';
import 'data/bangumi_catalog.dart';
import 'data/library_store.dart';
import 'domain/library_backup.dart';
import 'data/legacy_migration.dart';
import 'data/secrets.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  LicenseRegistry.addLicense(() async* {
    yield LicenseEntryWithLineBreaks([
      'hls.js 1.7.3',
    ], await rootBundle.loadString('assets/HLS-LICENSE.txt'));
  });
  runApp(const Bootstrap());
}

class Bootstrap extends StatefulWidget {
  const Bootstrap({super.key});
  @override
  State<Bootstrap> createState() => _BootstrapState();
}

class _BootstrapState extends State<Bootstrap> {
  final catalog = BangumiCatalog();
  late Future<AppController> initialization = initialize();
  Future<AppController> initialize() async {
    final store = await LibraryStore.open();
    try {
      final rules = (jsonDecode(
        await rootBundle.loadString('assets/rules.json'),
      ) as List).cast<JsonMap>();
      try {
        await LegacyMigration.run(
          store,
          SecretStore(),
          builtins: rules.where((rule) => rule['builtin'] == true).toList(),
        );
      } catch (_) {
        await store.setMetadata('migration-error', '旧数据未能自动迁移，可在设置重试或导入旧版备份');
      }
      await store.seedRules(rules);
      final controller = AppController(store, await store.read());
      unawaited(controller.initializeServices().catchError((Object _) {}));
      return controller;
    } catch (_) {
      await store.close();
      rethrow;
    }
  }

  @override
  void dispose() {
    catalog.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<AppController>(
    future: initialization,
    builder: (context, snapshot) {
      if (snapshot.hasData) {
        return AnimeApp(controller: snapshot.data!, catalog: catalog);
      }
      return MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: ThemeData(useMaterial3: true),
        home: Scaffold(
          body: Center(
            child: snapshot.hasError
                ? Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text('无法打开本地数据'),
                      TextButton(
                        onPressed: () =>
                            setState(() => initialization = initialize()),
                        child: const Text('重试'),
                      ),
                    ],
                  )
                : const CircularProgressIndicator(),
          ),
        ),
      );
    },
  );
}
