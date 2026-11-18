"""One canonical location for source files and author-grouped build artifacts."""
import hashlib
import re
import unicodedata
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlparse


def ascii_slug(value, fallback='resource'):
    from pypinyin import lazy_pinyin
    value = ''.join(lazy_pinyin(value))
    value = unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode()
    value = re.sub(r'[^A-Za-z0-9]+', '-', value).strip('-').lower()[:100].rstrip('-')
    return value or fallback


def rule_identity(value):
    """将规则集 basename 归一为跨来源合并身份，保留 ``!`` 的排除语义。"""
    name = re.sub(r'(?i)\.(?:list|yaml|yml)$', '', PurePosixPath(str(value)).name)
    text = unicodedata.normalize('NFKC', name).casefold()
    tokens, current = [], []
    for char in text:
        if char.isalnum():
            current.append(char)
            continue
        if current:
            tokens.append(''.join(current))
            current = []
        if char == '!':
            # ``geolocation-!cn`` 表示排除中国，不能与 ``geolocation-cn`` 合并。
            tokens.append('not')
    if current:
        tokens.append(''.join(current))
    return '-'.join(tokens)


def assign_inline_outputs(items, names=None):
    """Name message modules together so aliases and collisions are deterministic."""
    groups = {}
    for item in items:
        identity = item['url'].rsplit('/',1)[1]
        title = names[item['id']] if names is not None else item['_module'].get('name','')
        stem = ascii_slug(title, 'post-'+identity)
        groups.setdefault((repository_parts(item),stem), []).append(item)
    occupied = set(groups)
    for (repository,stem), entries in sorted(groups.items()):
        for item in sorted(entries,key=lambda value:value['id']):
            identity = item['url'].rsplit('/',1)[1]
            name = stem if len(entries)==1 else stem+'-'+identity
            if len(entries)>1:
                while (repository,name) in occupied:
                    name += '-post-'+identity
                occupied.add((repository,name))
            item['output'] = name+'.yaml'


def _relative(value):
    path = PurePosixPath(value)
    if path.is_absolute() or not path.parts or any(x in {'.', '..'} for x in path.parts) or '\\' in value:
        raise ValueError('路径必须是安全的相对路径：' + value)
    return path


def repository_parts(item):
    repository = item.get('repository', '')
    channel = re.fullmatch(r'https://t\.me/([A-Za-z][A-Za-z0-9_]{3,63})/?', repository)
    if channel:
        return ('telegram', channel[1])
    gist = re.fullmatch(r'https://gist\.github\.com/([A-Za-z0-9-]+)/([a-fA-F0-9]+)', repository)
    if gist:
        return (gist[1], 'gist-'+gist[2])
    if repository == 'local' or ('path' in item and not repository):
        return ('ErrBin', 'egern-hub')
    value = repository.removeprefix('https://github.com/').rstrip('/')
    parts = value.split('/') if value else []
    if len(parts) != 2:
        parsed = urlparse(item.get('url', ''))
        raw_parts = unquote(parsed.path).strip('/').split('/')
        if parsed.hostname == 'gist.githubusercontent.com' and len(raw_parts) in {4, 5} and raw_parts[2] == 'raw':
            parts = [raw_parts[0], 'gist-' + raw_parts[1]]
        else:
            parts = raw_parts[:2] if parsed.hostname in {'github.com', 'raw.githubusercontent.com'} else ['external', 'sources']
    for part in parts:
        if len(_relative(part).parts) != 1:
            raise ValueError('无效作者或仓库名')
    return tuple(parts)


def source_path(root, item):
    if 'path' in item:
        return Path(root).joinpath(*_relative(item['path']).parts)
    parsed = urlparse(item['url'])
    parts = unquote(parsed.path).strip('/').split('/')
    if parsed.hostname == 'raw.githubusercontent.com' and len(parts) >= 4:
        # Keep refs as well as original paths: branches may contain different files.
        relative = '/'.join(parts[2:]).removeprefix('refs/heads/').removeprefix('refs/tags/')
    elif parsed.hostname == 'gist.githubusercontent.com' and len(parts) in {4,5} and parts[2] == 'raw':
        relative = '/'.join(parts[2:])
    elif parsed.hostname == 'github.com' and len(parts) >= 6 and parts[2:5] == ['releases', 'latest', 'download']:
        # Preserve the established cache location for latest assets.
        relative = 'releases/' + '/'.join(parts[5:])
    elif parsed.hostname == 'github.com' and len(parts) >= 6 and parts[2:4] == ['releases', 'download']:
        relative = 'releases/' + '/'.join(parts[3:])
    else:
        relative = 'external/' + hashlib.sha256(item['url'].encode()).hexdigest()[:16] + '-' + (parts[-1] or 'source.txt')
    return Path(root, 'sources', *repository_parts(item), *_relative(relative).parts)


def write_source(root, item, text):
    path = source_path(root, item)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text.encode('utf-8'))


def read_source(root, item):
    if '_inline_body' in item:
        return item['_inline_body']
    # Native files must retain their original line endings as well as comments.
    with source_path(root, item).open(encoding='utf-8', newline='') as source:
        return source.read()


def _artifact_filename(item, kind):
    """返回不含作者层级的上游文件名，供模块、脚本和规则集共用。"""
    identity = _relative(item['id'])
    if len(identity.parts) != 1:
        raise ValueError('无效产物 ID')
    suffix = '.js' if kind == 'scripts' else '.yaml'
    if 'output' in item:
        filename = _relative(item['output'])
        if filename.suffix != suffix:
            raise ValueError(f"{item['id']}: output 必须以 {suffix} 结尾")
    else:
        parsed = urlparse(item.get('url', ''))
        parts = unquote(parsed.path).strip('/').split('/')
        if parsed.hostname == 'raw.githubusercontent.com' and len(parts) >= 4:
            tail = '/'.join(parts[2:]).removeprefix('refs/heads/').removeprefix('refs/tags/')
            ref = item.get('git_ref', tail.split('/')[0])
            filename = _relative(tail.removeprefix(ref + '/'))
        elif 'path' in item:
            prefix = str(PurePosixPath('sources', *repository_parts(item))) + '/'
            filename = _relative(item['path'].removeprefix(prefix).removeprefix(kind + '/'))
        else:
            filename = _relative(parts[-1] or item['id'])
        filename = filename.with_suffix(suffix)
    # Retain upstream ASCII paths; transliterate non-ASCII generated path components.
    filename = PurePosixPath(*(part if part.isascii() else
        (ascii_slug(PurePosixPath(part).stem, item['id']) + suffix if index==len(filename.parts)-1
         else ascii_slug(part, item['id']))
        for index,part in enumerate(filename.parts)))
    return filename


def artifact_path(item, kind=None):
    kind = kind or item['kind']
    if kind not in {'modules', 'rules', 'scripts'}:
        raise ValueError('无效产物类型')
    filename = _artifact_filename(item, kind)
    if kind == 'rules':
        # 规则集需要跨来源聚合，公开路径只保留文件名，来源信息由 YAML 头部承载。
        return str(PurePosixPath('rules', filename.name))
    return str(PurePosixPath(kind, *repository_parts(item), filename))


def assign_rule_outputs(items):
    """为整批规则集分配确定性文件名，并消解大小写不敏感的路径冲突。

    单个来源保留 ``<basename>.yaml``；同名来源按 owner、repo 逐级派生。
    同一输入集合的分配结果固定，新增同名来源只会影响进入冲突组的条目。
    """
    entries = []
    for item in items:
        if item.get('kind') != 'rules':
            continue
        # 首次分配时记录上游 basename；后续重跑不能把派生出的 output 当成新的基准名。
        base_name = item.get('_rule_base')
        if not base_name:
            base_name = _artifact_filename(item, 'rules').name
            item['_rule_base'] = base_name
        base = PurePosixPath(base_name)
        owner, repo = repository_parts(item)
        entries.append({
            'item': item,
            'base': base,
            'stem': base.stem,
            'suffix': base.suffix,
            'owner': ascii_slug(owner, 'owner'),
            'repo': ascii_slug(repo, 'repo'),
            'level': 0,
        })
    groups = {}
    for entry in entries:
        groups[entry['base'].name.casefold()] = groups.get(entry['base'].name.casefold(), 0) + 1
    for entry in entries:
        if groups[entry['base'].name.casefold()] > 1:
            entry['level'] = 1
        entry['candidate'] = _rule_candidate(entry)

    # 先保护无冲突的单来源文件名，再逐级把冲突条目提升到 owner、repo 后缀。
    while True:
        conflicts = {}
        for entry in entries:
            conflicts.setdefault(str(entry['candidate']).casefold(), []).append(entry)
        conflicts = {path: rows for path, rows in conflicts.items() if len(rows) > 1}
        if not conflicts:
            break
        escalated = False
        blocked = []
        for path, rows in sorted(conflicts.items()):
            levels = {entry['level'] for entry in rows}
            if 0 in levels:
                targets = [entry for entry in rows if 0 < entry['level'] < 2]
            else:
                lowest = min(levels)
                targets = [entry for entry in rows if entry['level'] == lowest and entry['level'] < 2]
            if not targets:
                blocked.append((path, rows))
                continue
            for entry in targets:
                entry['level'] += 1
                entry['candidate'] = _rule_candidate(entry)
            escalated = True
        if not escalated:
            details = []
            for path, rows in sorted(blocked):
                details.append(path + ' ← ' + '、'.join(
                    f"{entry['item']['id']} ({entry['item'].get('repository', '')})" for entry in rows))
            raise ValueError('规则集产物路径无法消解：' + '；'.join(details))

    for entry in entries:
        entry['item']['output'] = entry['candidate'].name


def _rule_candidate(entry):
    if entry['level'] == 0:
        return entry['base']
    if entry['level'] == 1:
        return PurePosixPath(f"{entry['stem']}-{entry['owner']}{entry['suffix']}")
    return PurePosixPath(f"{entry['stem']}-{entry['owner']}-{entry['repo']}{entry['suffix']}")
