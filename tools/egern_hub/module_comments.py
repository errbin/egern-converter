"""Keep source notes beside converted entries without changing YAML values."""
import re

from .editorial import is_editorial


class AnnotatedModule(dict):
    def __init__(self):
        super().__init__()
        self.annotations = []


def note(line):
    text = re.sub(r'^(?:#+|//|;)\s?', '', line.strip())
    text = re.sub(r'[#＃]主机名\s*(?:[A-Za-z0-9_*?-]+\.)+[A-Za-z]{2,}', '', text).rstrip()
    if re.fullmatch(r'转载自\s*\S+', text):
        return None
    if not text or re.fullmatch(r'[#=*_-]{3,}', text) or is_editorial(text):
        return None
    return text


def introduction(text):
    """Only the leading prose belongs in the header, never section comments."""
    lines = []
    skip_answer = False
    for raw in text.lstrip('\ufeff').splitlines():
        line = raw.strip()
        if re.fullmatch(r'\[.+\]', line) or (line and not line.startswith(('#', '//', ';'))):
            break
        if line.startswith('#!'):
            extra = re.fullmatch(r'#!(?:remark|note)\s*=\s*(.*)', line, re.I)
            if extra and (value := note(extra[1])):
                lines.append('# ' + value + '\n')
            continue  # Other metadata is represented as native YAML fields.
        value = note(line) if line else None
        if not value:
            continue
        if re.match(r'\d+[^\w\s]*[：:]', value):
            skip_answer = bool(re.search(r'(?i)(?<![A-Za-z])(?:loon|surge|quantumult\s*x|qx)(?![A-Za-z])', value))
        if skip_answer:
            continue
        lines.append('# ' + value + '\n')
    return ''.join(lines)


def render_annotations(obj, text):
    annotations = getattr(obj, 'annotations', ())
    if not annotations:
        return text
    import yaml
    tree = yaml.compose(text)
    positions = {}
    for key, value in tree.value:
        original = obj[key.value]
        positions[id(original)] = key.start_mark.line
        if isinstance(value, yaml.SequenceNode) and isinstance(original, list):
            for entry, node in zip(original, value.value):
                positions[id(entry)] = node.start_mark.line
    insertions = {}
    for entry, lines in annotations:
        if id(entry) in positions:
            insertions.setdefault(positions[id(entry)], []).extend(lines)
    result = []
    for number, line in enumerate(text.splitlines(keepends=True)):
        if number in insertions:
            indent = line[:len(line)-len(line.lstrip())]
            result.extend(indent + '# ' + value + '\n' for value in insertions[number])
        result.append(line)
    return ''.join(result)
