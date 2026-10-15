import 'package:html/dom.dart';

// Preserve the legacy engine's context-relative // paths and positional rules.
List<Object> selectXPath(Node root, String expression) {
  final path = expression.trim().replaceFirst(RegExp(r'^\.(?=/)'), '');
  if (path == '/' || path == '//') return [root];
  if (!path.startsWith('/')) {
    throw FormatException('XPath 必须以 / 开头：$expression');
  }
  var current = <Object>[root];
  var index = 0;
  while (index < path.length) {
    if (path[index] != '/') throw FormatException('XPath 无效：$expression');
    final deep = index + 1 < path.length && path[index + 1] == '/';
    index += deep ? 2 : 1;
    final start = index;
    while (index < path.length && path[index] != '/' && path[index] != '[') {
      index++;
    }
    final tag = path.substring(start, index).toLowerCase();
    if (tag.isEmpty) throw FormatException('XPath 无效：$expression');
    final predicates = <String>[];
    while (index < path.length && path[index] == '[') {
      final end = bracketEnd(path, index);
      predicates.add(path.substring(index + 1, end).trim());
      index = end + 1;
    }
    final output = <Object>{};
    for (final node in current.whereType<Node>()) {
      final parents = deep ? [node, ...descendants(node)] : [node];
      for (final parent in parents) {
        if (tag.startsWith('@')) {
          if (parent is Element &&
              parent.attributes.containsKey(tag.substring(1))) {
            output.add(parent.attributes[tag.substring(1)]!);
          }
          continue;
        }
        if (tag == 'text()') {
          output.addAll(parent.nodes.whereType<Text>());
          continue;
        }
        var children = parent.nodes
            .whereType<Element>()
            .where((child) => tag == '*' || child.localName == tag)
            .toList();
        for (final predicate in predicates) {
          final position = int.tryParse(predicate);
          if (position != null) {
            children = position > 0 && position <= children.length
                ? [children[position - 1]]
                : [];
            continue;
          }
          final contains = RegExp(
            r'''^contains\(\s*@([\w:-]+)\s*,\s*(['"])(.*?)\2\s*\)$''',
          ).firstMatch(predicate);
          final attr = RegExp(r'''^@([\w:-]+)(?:\s*=\s*(['"])(.*?)\2)?$''')
              .firstMatch(predicate);
          if (contains != null) {
            children = children
                .where(
                  (child) => (child.attributes[contains[1]] ?? '').contains(
                    contains[3]!,
                  ),
                )
                .toList();
          } else if (attr != null) {
            children = children
                .where(
                  (child) => attr[2] == null
                      ? child.attributes.containsKey(attr[1])
                      : child.attributes[attr[1]] == attr[3],
                )
                .toList();
          } else {
            throw FormatException('不支持的 XPath 条件：$predicate');
          }
        }
        output.addAll(children);
      }
    }
    current = output.toList();
  }
  return current;
}

Iterable<Node> descendants(Node root) sync* {
  for (final child in root.nodes) {
    yield child;
    yield* descendants(child);
  }
}

String nodeText(Object? value) =>
    value is Node ? value.text ?? '' : value?.toString() ?? '';
String nodeHref(Object? value) => value is Element
    ? value.attributes['href'] ?? ''
    : value is String
    ? value
    : '';

int bracketEnd(String source, int start) {
  var quote = '';
  for (var i = start + 1; i < source.length; i++) {
    final char = source[i];
    if (quote.isNotEmpty) {
      if (char == quote) quote = '';
      continue;
    }
    if (char == '"' || char == "'") {
      quote = char;
      continue;
    }
    if (char == ']') return i;
  }
  throw FormatException('表达式缺少 ]：$source');
}

List<dynamic> readJsonPath(dynamic document, String expression) {
  if (!expression.startsWith(r'$')) {
    throw FormatException('JSONPath 必须以美元符号开头：$expression');
  }
  var values = <dynamic>[document];
  var index = 1;
  while (index < expression.length) {
    String? property;
    int? position;
    var wildcard = false;
    if (expression[index] == '.') {
      final start = ++index;
      while (index < expression.length &&
          RegExp(r'[A-Za-z0-9_$-]').hasMatch(expression[index])) {
        index++;
      }
      if (start == index) throw FormatException('不支持的 JSONPath：$expression');
      property = expression.substring(start, index);
    } else if (expression[index] == '[') {
      final end = bracketEnd(expression, index);
      final token = expression.substring(index + 1, end).trim();
      index = end + 1;
      if (token == '*') {
        wildcard = true;
      } else if (int.tryParse(token) case final int number when number >= 0) {
        position = number;
      } else if (token.length >= 2 &&
          (token.startsWith('"') && token.endsWith('"') ||
              token.startsWith("'") && token.endsWith("'"))) {
        property = token.substring(1, token.length - 1);
      } else {
        throw FormatException('不支持的 JSONPath：$expression');
      }
    } else {
      throw FormatException('不支持的 JSONPath：$expression');
    }
    values = [
      for (final value in values)
        if (property != null && value is Map && value.containsKey(property))
          value[property]
        else if (position != null && value is List && position < value.length)
          value[position]
        else if (wildcard && value is List)
          ...value
        else if (wildcard && value is Map)
          ...value.values,
    ];
  }
  return values;
}
