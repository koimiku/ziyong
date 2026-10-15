import 'dart:convert';

import 'features/source_page.dart';
import 'features/service_pages.dart';
import 'features/startup.dart';
import 'features/history_page.dart';
import 'features/phone_page.dart';
import 'features/update_page.dart';
import 'data/legacy_migration.dart';
import 'data/app_update.dart';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'app_controller.dart';
import 'data/bangumi_catalog.dart';
import 'data/backup_reader.dart';
import 'domain/library_backup.dart';

const palettes = <String, (String, Color)>{
  'blue': ('晴蓝', Color(0xff3866a6)),
  'pink': ('樱粉', Color(0xffa64272)),
  'purple': ('鸢紫', Color(0xff7553a5)),
  'green': ('苔绿', Color(0xff426b3b)),
  'orange': ('暖橙', Color(0xff965422)),
  'teal': ('青碧', Color(0xff246e70)),
};

class AnimeApp extends StatelessWidget {
  const AnimeApp({super.key, required this.controller, required this.catalog});
  final AppController controller;
  final BangumiCatalog catalog;

  ThemeData _theme(Brightness brightness) {
    final dark = brightness == Brightness.dark;
    final key = controller.setting(
      'anime-palette-${dark ? 'dark' : 'light'}',
      dark ? 'pink' : 'blue',
    );
    final scheme = ColorScheme.fromSeed(
      seedColor: (palettes[key] ?? palettes['blue']!).$2,
      brightness: brightness,
    );
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: scheme.surface,
      appBarTheme: AppBarTheme(
        backgroundColor: scheme.surface,
        scrolledUnderElevation: 0,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: scheme.surfaceContainer,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(24),
          borderSide: BorderSide.none,
        ),
      ),
      snackBarTheme: const SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: controller.settingsChanges,
    builder: (context, _) {
      final mode = controller.setting('anime-theme', 'system');
      return MaterialApp(
        title: 'anime',
        debugShowCheckedModeBanner: false,
        locale: const Locale('zh', 'CN'),
        supportedLocales: const [Locale('zh', 'CN'), Locale('en')],
        localizationsDelegates: GlobalMaterialLocalizations.delegates,
        theme: _theme(Brightness.light),
        darkTheme: _theme(Brightness.dark),
        themeMode: mode == 'dark'
            ? ThemeMode.dark
            : mode == 'light'
            ? ThemeMode.light
            : ThemeMode.system,
        home: StartupGate(
          controller: controller,
          child: AppShell(controller: controller, catalog: catalog),
        ),
      );
    },
  );
}

class AppShell extends StatefulWidget {
  const AppShell({super.key, required this.controller, required this.catalog});
  final AppController controller;
  final BangumiCatalog catalog;
  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  int selected = 0;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      try {
        final warning = await widget.controller.store.metadata(
          'migration-error',
        );
        if (mounted && warning != null && warning.isNotEmpty) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              duration: const Duration(seconds: 12),
              content: Text(warning),
              action: SnackBarAction(
                label: '设置',
                onPressed: () => setState(() => selected = 2),
              ),
            ),
          );
        }
      } catch (_) {}
    });
  }

  static const destinations = [
    (Icons.explore_outlined, Icons.explore, '发现'),
    (Icons.bookmark_border_rounded, Icons.bookmark_rounded, '收藏'),
    (Icons.tune_rounded, Icons.tune_rounded, '设置'),
  ];
  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final wide = constraints.maxWidth >= 760;
      final pages = IndexedStack(
        index: selected,
        children: [
          DiscoverPage(catalog: widget.catalog, controller: widget.controller),
          CollectionPage(
            controller: widget.controller,
            catalog: widget.catalog,
          ),
          SettingsPage(controller: widget.controller),
        ],
      );
      return Scaffold(
        body: SafeArea(
          child: wide
              ? Row(
                  children: [
                    NavigationRail(
                      selectedIndex: selected,
                      labelType: NavigationRailLabelType.all,
                      leading: const Padding(
                        padding: EdgeInsets.symmetric(vertical: 24),
                        child: Text(
                          'anime',
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 20,
                          ),
                        ),
                      ),
                      onDestinationSelected: (index) =>
                          setState(() => selected = index),
                      destinations: destinations
                          .map(
                            (item) => NavigationRailDestination(
                              icon: Icon(item.$1),
                              selectedIcon: Icon(item.$2),
                              label: Text(item.$3),
                            ),
                          )
                          .toList(),
                    ),
                    const VerticalDivider(width: 1),
                    Expanded(child: pages),
                  ],
                )
              : pages,
        ),
        bottomNavigationBar: wide
            ? null
            : NavigationBar(
                selectedIndex: selected,
                onDestinationSelected: (index) =>
                    setState(() => selected = index),
                destinations: destinations
                    .map(
                      (item) => NavigationDestination(
                        icon: Icon(item.$1),
                        selectedIcon: Icon(item.$2),
                        label: item.$3,
                      ),
                    )
                    .toList(),
              ),
      );
    },
  );
}

class DiscoverPage extends StatefulWidget {
  const DiscoverPage({
    super.key,
    required this.catalog,
    required this.controller,
  });
  final BangumiCatalog catalog;
  final AppController controller;
  @override
  State<DiscoverPage> createState() => _DiscoverPageState();
}

class _DiscoverPageState extends State<DiscoverPage> {
  final query = TextEditingController();
  late Future<List<Subject>> results;
  String keyword = '';
  @override
  void initState() {
    super.initState();
    results = widget.catalog.calendar();
  }

  @override
  void dispose() {
    query.dispose();
    super.dispose();
  }

  void search() {
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {
      keyword = query.text.trim();
      results = keyword.isEmpty
          ? widget.catalog.calendar()
          : widget.catalog.search(keyword);
    });
  }

  void reload() => setState(() {
    results = keyword.isEmpty
        ? widget.catalog.calendar(refresh: true)
        : widget.catalog.search(keyword);
  });
  @override
  Widget build(BuildContext context) => CustomScrollView(
    key: const PageStorageKey('discover'),
    slivers: [
      SliverToBoxAdapter(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 28, 24, 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '发现好故事',
                style: Theme.of(context).textTheme.headlineMedium
                    ?.copyWith(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 6),
              Text(
                '从今天的放送开始',
                style: TextStyle(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 24),
              TextField(
                controller: query,
                textInputAction: TextInputAction.search,
                onSubmitted: (_) => search(),
                decoration: InputDecoration(
                  hintText: '搜索番剧',
                  prefixIcon: const Icon(Icons.search_rounded),
                  suffixIcon: IconButton(
                    tooltip: '搜索',
                    onPressed: search,
                    icon: const Icon(Icons.arrow_forward_rounded),
                  ),
                ),
              ),
              const SizedBox(height: 26),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      keyword.isEmpty ? '本周放送' : '“$keyword”的搜索结果',
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                  ),
                  IconButton(
                    tooltip: '刷新',
                    onPressed: reload,
                    icon: const Icon(Icons.refresh_rounded),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
      FutureBuilder<List<Subject>>(
        future: results,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const SliverToBoxAdapter(
              child: Padding(
                padding: EdgeInsets.all(64),
                child: Center(child: CircularProgressIndicator()),
              ),
            );
          }
          if (snapshot.hasError) {
            return SliverToBoxAdapter(
              child: EmptyState(
                icon: Icons.cloud_off_rounded,
                title: '暂时没有连接上',
                message: '检查网络后再试一次',
                action: FilledButton.tonal(
                  onPressed: reload,
                  child: const Text('重新加载'),
                ),
              ),
            );
          }
          final items = snapshot.data ?? [];
          if (items.isEmpty) {
            return const SliverToBoxAdapter(
              child: EmptyState(
                icon: Icons.search_off_rounded,
                title: '没有找到相关番剧',
                message: '试试简称或其他名称',
              ),
            );
          }
          return subjectGrid(items, widget.controller, widget.catalog);
        },
      ),
      const SliverPadding(padding: EdgeInsets.only(bottom: 24)),
    ],
  );
}

class CollectionPage extends StatefulWidget {
  const CollectionPage({
    super.key,
    required this.controller,
    required this.catalog,
  });
  final AppController controller;
  final BangumiCatalog catalog;
  @override
  State<CollectionPage> createState() => _CollectionPageState();
}

class _CollectionPageState extends State<CollectionPage> {
  String filter = 'watching';
  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.controller,
    builder: (context, _) {
      final rows =
          widget.controller.library.collection
              .where((row) => row['collectionStatus'] == filter)
              .toList()
            ..sort(
              (a, b) => (num.tryParse('${b['collectionUpdatedAt']}') ?? 0)
                  .compareTo(num.tryParse('${a['collectionUpdatedAt']}') ?? 0),
            );
      return CustomScrollView(
        key: const PageStorageKey('collection'),
        slivers: [
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(24, 28, 24, 24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '我的收藏',
                    style: Theme.of(context).textTheme.headlineMedium
                        ?.copyWith(fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 24),
                  SegmentedButton<String>(
                    segments: collectionLabels.entries
                        .map(
                          (entry) => ButtonSegment(
                            value: entry.key,
                            label: Text(entry.value),
                          ),
                        )
                        .toList(),
                    selected: {filter},
                    onSelectionChanged: (value) =>
                        setState(() => filter = value.single),
                  ),
                ],
              ),
            ),
          ),
          if (rows.isEmpty)
            const SliverToBoxAdapter(
              child: EmptyState(
                icon: Icons.bookmarks_outlined,
                title: '故事，慢慢收藏',
                message: '在番剧详情中选择想看、在看或看过',
              ),
            )
          else
            subjectGrid(
              rows.map(Subject.new).toList(),
              widget.controller,
              widget.catalog,
            ),
          const SliverPadding(padding: EdgeInsets.only(bottom: 24)),
        ],
      );
    },
  );
}

Widget subjectGrid(
  List<Subject> items,
  AppController controller,
  BangumiCatalog catalog,
) => SliverPadding(
  padding: const EdgeInsets.symmetric(horizontal: 24),
  sliver: SliverLayoutBuilder(
    builder: (context, constraints) {
      final columns = (constraints.crossAxisExtent / 160).floor().clamp(2, 7);
      return SliverGrid(
        delegate: SliverChildBuilderDelegate((context, index) {
          final subject = items[index];
          return SubjectCard(
            subject: subject,
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => SubjectPage(
                  subject: subject,
                  controller: controller,
                  catalog: catalog,
                ),
              ),
            ),
          );
        }, childCount: items.length),
        gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: columns,
          crossAxisSpacing: 16,
          mainAxisSpacing: 20,
          childAspectRatio: .57,
        ),
      );
    },
  ),
);

class SubjectCard extends StatelessWidget {
  const SubjectCard({super.key, required this.subject, required this.onTap});
  final Subject subject;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => InkWell(
    borderRadius: BorderRadius.circular(16),
    onTap: onTap,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Stack(
            fit: StackFit.expand,
            children: [
              Cover(url: subject.cover),
              if (subject.score.isNotEmpty)
                Positioned(
                  right: 8,
                  bottom: 8,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: const Color(0xdd171419),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 7,
                        vertical: 3,
                      ),
                      child: Text(
                        subject.score,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 9),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 2),
          child: Text(
            subject.title,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontWeight: FontWeight.w600, height: 1.4),
          ),
        ),
      ],
    ),
  );
}

class Cover extends StatelessWidget {
  const Cover({super.key, required this.url});
  final String url;
  @override
  Widget build(BuildContext context) {
    final placeholder = ColoredBox(
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: Center(
        child: Icon(
          Icons.movie_outlined,
          color: Theme.of(context).colorScheme.onSurfaceVariant,
        ),
      ),
    );
    return ClipRRect(
      borderRadius: BorderRadius.circular(14),
      child: url.isEmpty
          ? placeholder
          : Image.network(
              url,
              fit: BoxFit.cover,
              cacheWidth: 420,
              errorBuilder: (_, error, stack) => placeholder,
            ),
    );
  }
}

class SubjectPage extends StatefulWidget {
  const SubjectPage({
    super.key,
    required this.subject,
    required this.controller,
    required this.catalog,
  });
  final Subject subject;
  final AppController controller;
  final BangumiCatalog catalog;
  @override
  State<SubjectPage> createState() => _SubjectPageState();
}

class _SubjectPageState extends State<SubjectPage> {
  late final Future<Subject> detail;
  @override
  void initState() {
    super.initState();
    detail = RegExp(r'^\d+$').hasMatch(widget.subject.id)
        ? widget.catalog.detail(widget.subject.id)
        : Future.value(widget.subject);
  }

  Future<void> chooseStatus(Subject subject) async {
    final current = widget.controller.status(subject.id);
    final status = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: SingleChildScrollView(
          child: Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(
                    '收藏状态',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                ),
                for (final entry in {'': '未收藏', ...collectionLabels}.entries)
                  ListTile(
                    title: Text(entry.value),
                    trailing: current == entry.key
                        ? const Icon(Icons.check_rounded)
                        : null,
                    onTap: () => Navigator.pop(context, entry.key),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
    if (status == null || status == current) return;
    try {
      await widget.controller.setStatus(subject, status);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('保存失败，请重试')));
      }
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(),
    body: FutureBuilder<Subject>(
      future: detail,
      builder: (context, snapshot) {
        final subject = snapshot.data ?? widget.subject;
        return ListView(
          padding: const EdgeInsets.fromLTRB(24, 8, 24, 48),
          children: [
            Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 760),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        SizedBox(
                          width: 112,
                          height: 160,
                          child: Cover(url: subject.cover),
                        ),
                        const SizedBox(width: 20),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                subject.title,
                                style: Theme.of(context).textTheme.titleLarge
                                    ?.copyWith(fontWeight: FontWeight.w700),
                              ),
                              const SizedBox(height: 16),
                              if (subject.score.isNotEmpty)
                                Text('评分 ${subject.score}'),
                              const SizedBox(height: 12),
                              ListenableBuilder(
                                listenable: widget.controller,
                                builder: (context, _) => FilledButton.tonalIcon(
                                  onPressed: () => chooseStatus(subject),
                                  icon: const Icon(
                                    Icons.bookmark_outline_rounded,
                                  ),
                                  label: Text(
                                    collectionLabels[widget.controller.status(
                                          subject.id,
                                        )] ??
                                        '未收藏',
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 32),
                    FilledButton.icon(
                      onPressed: () => Navigator.push(
                        context,
                        MaterialPageRoute<void>(
                          builder: (_) => SourcePage(
                            subject: subject,
                            controller: widget.controller,
                          ),
                        ),
                      ),
                      icon: const Icon(Icons.play_arrow_rounded),
                      label: const Text('选择片源并播放'),
                    ),
                    const SizedBox(height: 24),
                    Text('简介', style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 12),
                    if (snapshot.connectionState != ConnectionState.done)
                      const LinearProgressIndicator()
                    else
                      Text(
                        subject.synopsis.isEmpty ? '暂无简介' : subject.synopsis,
                        style: const TextStyle(height: 1.8),
                      ),
                    if (snapshot.hasError)
                      TextButton(
                        onPressed: () => Navigator.pushReplacement(
                          context,
                          MaterialPageRoute<void>(
                            builder: (_) => SubjectPage(
                              subject: subject,
                              controller: widget.controller,
                              catalog: widget.catalog,
                            ),
                          ),
                        ),
                        child: const Text('重新加载详情'),
                      ),
                  ],
                ),
              ),
            ),
          ],
        );
      },
    ),
  );
}

class SettingsPage extends StatefulWidget {
  const SettingsPage({super.key, required this.controller});
  final AppController controller;
  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  bool busy = false;
  Future<void> run(Future<void> Function() action) async {
    if (busy) return;
    setState(() => busy = true);
    try {
      await action();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              error is FormatException ? error.message : '操作未完成，请重试',
            ),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> importBackup() async {
    final picked = await FilePicker.pickFile(
      type: FileType.custom,
      allowedExtensions: ['json'],
    );
    if (picked == null) return;
    if ((await picked.length() ?? 0) > 8 * 1024 * 1024) {
      throw const FormatException('备份文件不能超过 8 MB');
    }
    final backup = await readBackupStream(picked.readAsByteStream());
    if (!mounted) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('导入备份？'),
        content: Text(
          '${backup.collection.length} 项收藏 · ${backup.history.length} 条观看记录\n${backup.rules.length} 条片源规则\n\n较新的记录会保留。同名规则和备份中的设置会更新，导入前的数据会另存为恢复副本。',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('导入'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await widget.controller.restore(backup);
    if (mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('备份已导入')));
    }
  }

  Future<void> exportBackup({bool recovery = false}) async {
    final backup = recovery
        ? await widget.controller.store.recovery()
        : await widget.controller.store.read();
    if (backup == null) throw const FormatException('暂无导入前的恢复副本');
    final bytes = utf8.encode(backup.encode());
    final path = await FilePicker.saveFile(
      dialogTitle: '保存备份',
      fileName: recovery ? 'anime-recovery.json' : 'anime-backup.json',
      bytes: bytes,
      mimeType: 'application/json',
    );
    if (path != null && mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('备份已保存')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    return Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 840),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(24, 28, 24, 32),
          children: [
            Text(
              '设置',
              style: Theme.of(context).textTheme.headlineMedium
                  ?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 28),
            Text('外观', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: controller.setting('anime-theme', 'system'),
              key: ValueKey(controller.setting('anime-theme', 'system')),
              decoration: const InputDecoration(labelText: '显示模式'),
              items: const [
                DropdownMenuItem(value: 'system', child: Text('跟随系统')),
                DropdownMenuItem(value: 'light', child: Text('浅色')),
                DropdownMenuItem(value: 'dark', child: Text('深色')),
              ],
              onChanged: busy
                  ? null
                  : (value) =>
                        run(() => controller.setSetting('anime-theme', value!)),
            ),
            for (final mode in ['light', 'dark']) ...[
              const SizedBox(height: 20),
              Text(mode == 'light' ? '浅色配色' : '深色配色'),
              const SizedBox(height: 10),
              Wrap(
                spacing: 10,
                runSpacing: 8,
                children: palettes.entries
                    .map(
                      (entry) => ChoiceChip(
                        label: Text(entry.value.$1),
                        avatar: CircleAvatar(
                          backgroundColor: entry.value.$2,
                          radius: 7,
                        ),
                        selected:
                            controller.setting(
                              'anime-palette-$mode',
                              mode == 'light' ? 'blue' : 'pink',
                            ) ==
                            entry.key,
                        onSelected: busy
                            ? null
                            : (_) => run(
                                () => controller.setSetting(
                                  'anime-palette-$mode',
                                  entry.key,
                                ),
                              ),
                      ),
                    )
                    .toList(),
              ),
            ],
            const SizedBox(height: 32),
            Text('数据与备份', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 12),
            if (busy) const LinearProgressIndicator(),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.file_open_outlined),
              title: const Text('导入备份'),
              subtitle: const Text('支持旧版导出的 anime 备份文件'),
              onTap: busy ? null : () => run(importBackup),
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.save_alt_rounded),
              title: const Text('导出备份'),
              subtitle: const Text('保存收藏、观看记录、规则与设置'),
              onTap: busy ? null : () => run(() => exportBackup()),
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.history_rounded),
              title: const Text('导出恢复副本'),
              subtitle: const Text('保留最近一次导入前的数据'),
              onTap: busy
                  ? null
                  : () => run(() => exportBackup(recovery: true)),
            ),
            const Divider(height: 32),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.system_update_alt),
              title: const Text('应用更新'),
              subtitle: const Text('anime $appVersion'),
              onTap: () => Navigator.push<void>(
                context,
                MaterialPageRoute(builder: (_) => const UpdatePage()),
              ),
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.import_export),
              title: const Text('迁移旧版数据'),
              subtitle: const Text('Android 可重新读取旧版本机记录；Windows 可导入旧版导出的备份'),
              onTap: busy
                  ? null
                  : () => run(() async {
                      await LegacyMigration.run(
                        controller.store,
                        controller.secrets,
                        force: true,
                      );
                      await controller.restore(const LibraryBackup());
                    }),
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.description_outlined),
              title: const Text('开源许可'),
              onTap: () => showLicensePage(
                context: context,
                applicationName: 'anime',
                applicationVersion: appVersion,
              ),
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.phone_android),
              title: const Text('手机观看'),
              onTap: () => Navigator.push<void>(
                context,
                MaterialPageRoute(
                  builder: (_) => PhonePage(controller: controller),
                ),
              ),
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.cloud_sync_outlined),
              title: const Text('Bangumi 同步'),
              onTap: () => Navigator.push<void>(
                context,
                MaterialPageRoute(
                  builder: (_) => BangumiPage(controller: controller),
                ),
              ),
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.cloud_outlined),
              title: const Text('WebDAV 备份'),
              onTap: () => Navigator.push<void>(
                context,
                MaterialPageRoute(
                  builder: (_) => WebdavPage(controller: controller),
                ),
              ),
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.image_outlined),
              title: const Text('启动外观'),
              onTap: () => Navigator.push<void>(
                context,
                MaterialPageRoute(
                  builder: (_) => StartupPage(controller: controller),
                ),
              ),
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.history),
              title: const Text('观看记录'),
              onTap: () => Navigator.push<void>(
                context,
                MaterialPageRoute(
                  builder: (_) => HistoryPage(controller: controller),
                ),
              ),
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.video_library_outlined),
              title: const Text('已保存的片源规则'),
              subtitle: Text(
                '${controller.library.rules.length} 条规则 · ${controller.library.history.length} 条观看记录',
              ),
              onTap: () => Navigator.push<void>(
                context,
                MaterialPageRoute(
                  builder: (_) => RuleLibraryPage(controller: controller),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    required this.icon,
    required this.title,
    required this.message,
    this.action,
  });
  final IconData icon;
  final String title;
  final String message;
  final Widget? action;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 56, horizontal: 24),
    child: Column(
      children: [
        Icon(icon, size: 44, color: Theme.of(context).colorScheme.primary),
        const SizedBox(height: 20),
        Text(title, style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        Text(
          message,
          textAlign: TextAlign.center,
          style: TextStyle(
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
        ),
        if (action != null)
          Padding(padding: const EdgeInsets.only(top: 20), child: action),
      ],
    ),
  );
}
