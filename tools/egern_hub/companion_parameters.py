"""Recover omitted declarations from the same script's original companion modules."""
import hashlib
import json
import re

from .loon_arguments import declaration


def recover(script_url, keys, documents):
    from .convert import canonical_script_url
    candidates = {key: [] for key in keys}
    for url, body in documents:
        lines = body.splitlines()
        # Require both the exact script and the parameter on its declaration.
        linked = set()
        for line in lines:
            if line.lstrip().startswith(('#', ';', '//')):
                continue
            urls = re.findall(r'https://raw\.githubusercontent\.com/[^\s,"\'()]+', line)
            if script_url in {canonical_script_url(value) for value in urls}:
                linked.update(re.findall(r'\$?\{([\w-]+)\}', line))
        if not linked & keys:
            continue
        defaults, schema, section = {}, {}, ''
        for number, line in enumerate(lines, 1):
            line = line.strip()
            if re.fullmatch(r'\[.+\]', line):
                section = line[1:-1].casefold()
            elif section == 'argument' and line and not line.startswith(('#', ';', '//')):
                key = line.partition('=')[0].strip()
                if key not in keys & linked:
                    continue
                declaration(line, defaults, schema)
                candidates[key].append({'key':key, 'default':defaults[key], 'schema':schema[key],
                    'source':url, 'line':number, 'sha256':hashlib.sha256(body.encode()).hexdigest()})
    result = []
    for key, rows in sorted(candidates.items()):
        signatures = {json.dumps([row['default'], row['schema']], sort_keys=True) for row in rows}
        if len(signatures) > 1:
            raise ValueError('原作者配套模块的参数声明不一致：'+key+' — '+', '.join(row['source'] for row in rows))
        if rows:
            result.append(sorted(rows, key=lambda row:row['source'])[0])
    return result
