"""Parse classic Loon headers; Egern's Loon importer maps add to set."""
import re


def loon_headers(line):
    match = re.fullmatch(r'(\S+)\s+(?:(request|response)-)?header-(add|del)\s+(.+)', line)
    if not match:
        return None
    pattern, direction, action, tail = match.groups()
    values = [value.replace(r'\x20', ' ') for value in tail.split()]
    width = 1 if action == 'del' else 2
    if len(values) % width:
        raise ValueError('Header 添加需要成对的名称和值')
    rows = []
    for i in range(0, len(values), width):
        name = values[i]
        if not re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+", name):
            raise ValueError('无效 HTTP Header 名称')
        if name.casefold() in {'content-length', 'transfer-encoding'}:
            raise ValueError('不改写消息分帧头 Content-Length / Transfer-Encoding')
        value = None if action == 'del' else values[i+1]
        if value is not None and any(char in value for char in '\r\n\0'):
            raise ValueError('HTTP Header 值不得包含换行或 NUL')
        rows.append({'match': pattern, 'type': direction or 'request',
                     'action': action, 'name': name, 'value': value})
    return rows
