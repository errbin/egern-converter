"""v2fly domain-list 格式解析、include 展开与 Egern 规则集映射。"""
from dataclasses import dataclass
import re
from typing import Callable, Iterable


class DomainListError(ValueError):
    """保留文件与行号的格式错误。"""


_DOMAIN = re.compile(r'[a-z0-9.-]+\Z')
_DOMAIN_CHARS = re.compile(r'[a-z0-9.-]+\Z')
_ATTRIBUTE = re.compile(r'[a-z0-9!]+\Z')
_AFFILIATION = re.compile(r'[A-Z0-9!-]+\Z')
_LIST_NAME = re.compile(r'[A-Z0-9!-]+\Z')
_TYPED = re.compile(r'(?i)(?:include|full|domain|keyword|regexp):')
_BARE = re.compile(r'[A-Za-z0-9.-]+(?:\s+@[A-Za-z0-9!-]+|\s+&[A-Za-z0-9!-]+)*\Z')


@dataclass(frozen=True)
class Entry:
    kind: str
    value: str
    attrs: frozenset[str]
    affiliations: tuple[str, ...]
    line: int


@dataclass(frozen=True)
class Inclusion:
    target: str
    must: frozenset[str]
    ban: frozenset[str]
    line: int


@dataclass(frozen=True)
class ParsedList:
    source: str
    entries: tuple[Entry, ...]
    inclusions: tuple[Inclusion, ...]


IncludeLoader = Callable[[str, str], tuple[str, str] | None]


def _location(source, line):
    return f'{source or "<memory>"}:{line}'


def _error(source, line, message):
    raise DomainListError(f'{_location(source, line)}：{message}')


def _validate_domain(value):
    if not value or len(value) > 253 or not _DOMAIN.fullmatch(value):
        return False
    return all(label and len(label) <= 63 and label[0] != '-' and label[-1] != '-'
               for label in value.split('.'))


def _fields(parts, *, source, line, inclusion):
    attrs, must, ban, affiliations = set(), set(), set(), []
    for part in parts:
        if part.startswith('@'):
            raw = part[1:].lower()
            if inclusion:
                if raw.startswith('-'):
                    name = raw[1:]
                    if not _ATTRIBUTE.fullmatch(name):
                        _error(source, line, f'无效的 ban 属性：{part}')
                    ban.add(name)
                else:
                    if not _ATTRIBUTE.fullmatch(raw):
                        _error(source, line, f'无效的 must 属性：{part}')
                    must.add(raw)
            else:
                if not _ATTRIBUTE.fullmatch(raw):
                    _error(source, line, f'无效的属性：{part}')
                attrs.add(raw)
        elif part.startswith('&'):
            if inclusion:
                _error(source, line, 'include 不允许归属标注')
            name = part[1:].upper()
            if not _AFFILIATION.fullmatch(name):
                _error(source, line, f'无效的归属标注：{part}')
            affiliations.append(name)
        else:
            _error(source, line, f'未知字段：{part}')
    return frozenset(attrs), frozenset(must), frozenset(ban), tuple(affiliations)


def parse(text, source=''):
    entries, inclusions = [], []
    for line_no, raw in enumerate(text.lstrip('\ufeff').splitlines(), 1):
        line = raw.split('#', 1)[0].strip()
        if not line:
            continue
        if ':' in line:
            kind, rule = line.split(':', 1)
            kind = kind.lower()
            if not kind:
                _error(source, line_no, '规则类型为空')
        else:
            kind, rule = 'domain', line
        parts = rule.split()
        if not parts:
            _error(source, line_no, '规则值为空')
        value = parts[0]
        if kind == 'include':
            target = value.upper()
            if not _LIST_NAME.fullmatch(target):
                _error(source, line_no, f'无效的 include 目标：{value}')
            attrs, must, ban, affiliations = _fields(parts[1:], source=source, line=line_no, inclusion=True)
            if affiliations:
                _error(source, line_no, 'include 不允许归属标注')
            inclusions.append(Inclusion(target, must, ban, line_no))
            continue
        if kind in {'domain', 'full', 'keyword'}:
            value = value.lower()
            if kind == 'keyword':
                valid = bool(value) and bool(_DOMAIN_CHARS.fullmatch(value))
            else:
                valid = _validate_domain(value)
            if not valid:
                _error(source, line_no, f'无效域名：{value}')
        elif kind == 'regexp':
            # Python re 仅用于语法校验；模式原样保留。若 Python 与 Go RE2
            # 结论不同，属于工具差异，应在全量报告中单独列出，不能静默归为上游错误。
            try:
                re.compile(value)
            except re.error as exc:
                _error(source, line_no, f'无效 regexp（Python re；若 Go RE2 可编译则属工具差异）：{value}（{exc}）')
        else:
            _error(source, line_no, f'未知规则类型：{kind}')
        attrs, must, ban, affiliations = _fields(parts[1:], source=source, line=line_no, inclusion=False)
        if must or ban:
            _error(source, line_no, '规则条目不允许 must/ban 属性')
        entries.append(Entry(kind, value, attrs, affiliations, line_no))
    return ParsedList(source, tuple(entries), tuple(inclusions))


def looks_like(text):
    """按内容特征识别 domain-list，不依赖文件名或来源仓库。"""
    meaningful = [line for line in (raw.split('#', 1)[0].strip() for raw in text.lstrip('\ufeff').splitlines()) if line]
    if not meaningful:
        return False
    if any(_TYPED.match(line) for line in meaningful):
        return True
    return all(_BARE.fullmatch(line) for line in meaningful)


def _allows(entry, inclusion):
    if not entry.attrs:
        return not inclusion.must
    return inclusion.must <= entry.attrs and not (inclusion.ban & entry.attrs)


class Resolver:
    def __init__(self, text, *, source='', include_loader: IncludeLoader | None = None):
        self.source = source
        self.include_loader = include_loader
        self.parsed = {}
        self.resolved = {}
        self.root = self._parse(source, text)

    def _parse(self, source, text):
        key = source or '<memory>'
        if key not in self.parsed:
            self.parsed[key] = parse(text, source=source)
        return self.parsed[key]

    def _load(self, name, current, line):
        if self.include_loader is None:
            _error(current, line, f'include 需要跨文件 loader：{name}')
        try:
            loaded = self.include_loader(name, current)
        except LookupError as exc:
            _error(current, line, f'include 目标不存在：{name}')
        except ValueError as exc:
            _error(current, line, f'include 目标无效：{name}（{exc}）')
        if not loaded:
            _error(current, line, f'include 目标不存在：{name}')
        path, text = loaded
        return path, self._parse(path, text)

    def _resolve(self, parsed, stack):
        key = parsed.source or '<memory>'
        if key in self.resolved:
            return self.resolved[key]
        rough = {self._identity(entry): entry for entry in parsed.entries}
        for inclusion in parsed.inclusions:
            path, child = self._load(inclusion.target, parsed.source, inclusion.line)
            if path in stack:
                chain = ' -> '.join((*stack, path))
                _error(parsed.source, inclusion.line, f'include 循环：{chain}')
            for entry in self._resolve(child, (*stack, path)):
                if _allows(entry, inclusion):
                    rough.setdefault(self._identity(entry), entry)
        result = tuple(rough.values())
        self.resolved[key] = result
        return result

    @staticmethod
    def _identity(entry):
        return entry.kind, entry.value, tuple(sorted(entry.attrs))

    def entries(self):
        return self._resolve(self.root, (self.source or '<memory>',))


_OUTPUT_KIND = {
    'domain': 'domain_suffix',
    'full': 'domain',
    'keyword': 'domain_keyword',
    'regexp': 'domain_regex',
}


def convert(text, *, source='', include_loader: IncludeLoader | None = None):
    resolver = Resolver(text, source=source, include_loader=include_loader)
    result, seen = {}, {}
    for entry in resolver.entries():
        kind = _OUTPUT_KIND[entry.kind]
        key = kind + '_set'
        value = entry.value
        identity = value.lower() if kind in {'domain', 'domain_suffix'} else value
        if identity not in seen.setdefault(key, set()):
            result.setdefault(key, []).append(value)
            seen[key].add(identity)
    if not seen:
        raise DomainListError(f'{source or "<memory>"}：规则集为空')
    return result
