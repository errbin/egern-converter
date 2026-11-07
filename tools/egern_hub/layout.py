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


def artifact_path(item, kind=None):
    kind = kind or item['kind']
    if kind not in {'modules', 'rules', 'scripts'}:
        raise ValueError('无效产物类型')
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
    return str(PurePosixPath(kind, *repository_parts(item), filename))
