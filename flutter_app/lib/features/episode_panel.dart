import 'package:flutter/material.dart';

import '../rules/rule_engine.dart';

class EpisodePanel extends StatefulWidget {
  const EpisodePanel({
    super.key,
    required this.lines,
    required this.line,
    required this.episode,
    required this.onSelect,
    required this.onClose,
  });
  final List<EpisodeLine> lines;
  final int line, episode;
  final void Function(int, int) onSelect;
  final VoidCallback onClose;
  @override
  State<EpisodePanel> createState() => _EpisodePanelState();
}

class _EpisodePanelState extends State<EpisodePanel> {
  late int selectedLine = widget.line;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.all(20),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text('选集', style: Theme.of(context).textTheme.titleLarge),
            ),
            IconButton(
              tooltip: '关闭选集',
              onPressed: widget.onClose,
              icon: const Icon(Icons.close_rounded),
            ),
          ],
        ),
        const SizedBox(height: 12),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              for (var i = 0; i < widget.lines.length; i++)
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: Text(widget.lines[i].name),
                    selected: i == selectedLine,
                    onSelected: (_) => setState(() => selectedLine = i),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        Expanded(
          child: GridView.builder(
            key: ValueKey(selectedLine),
            gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
              maxCrossAxisExtent: 100,
              mainAxisExtent: 48,
              mainAxisSpacing: 10,
              crossAxisSpacing: 10,
            ),
            itemCount: widget.lines[selectedLine].episodes.length,
            itemBuilder: (context, index) => FilledButton.tonal(
              style: selectedLine == widget.line && index == widget.episode
                  ? FilledButton.styleFrom(
                      backgroundColor: Theme.of(context)
                          .colorScheme
                          .primaryContainer,
                    )
                  : FilledButton.styleFrom(
                      backgroundColor: Theme.of(context)
                          .colorScheme
                          .surfaceContainerHighest,
                    ),
              onPressed: () => widget.onSelect(selectedLine, index),
              child: Text(
                widget.lines[selectedLine].episodes[index].name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ),
        ),
      ],
    ),
  );
}
