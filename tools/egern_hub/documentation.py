"""Extract original-author descriptions from leading comments only."""
from pathlib import Path
import re


def documentation(text, path):
    # Only actual leading comments are documentation; never treat code as prose.
    rest = text.lstrip('\ufeff \t\r\n')
    comments = []
    while rest.startswith(('/*', '//')):
        if rest.startswith('/*'):
            end = rest.find('*/', 2)
            if end < 0:
                break
            comments.append(rest[2:end]); rest = rest[end+2:].lstrip()
        else:
            line, _, rest = rest.partition('\n')
            comments.append(line[2:]); rest = rest.lstrip()
    note = '\n'.join(comments).strip()
    prose = []
    for line in note.splitlines():
        line = line.strip().lstrip('*').strip().removeprefix('//').strip()
        if not line or re.search(r'https?://|\\/|hostname\s*=|^\[|^#!|^\^|url\s+(script|reject)|^host,', line):
            continue
        if re.search(r'^(const|let|var|function|if|return)\b|[{};]|^[-=*]{3}', line):
            continue
        prose.append(line)
    title = next((re.sub(r'^(?:脚本名称|软件名称|项目名称|脚本功能|App|app)\s*[:：]\s*', '', line) for line in prose
                  if re.match(r'^(?:脚本名称|软件名称|项目名称|脚本功能|App|app)\s*[:：]', line)), '')
    if not title:
        for line in prose:
            if re.search(r'作者|日期|原作者|来自|感谢|\$|by[:：]|构建时间|Build \d|^\d{4}[-./年]|^\d+点|^@', line, re.I):
                continue
            title = line
            break
    title = re.sub(r'^@name\s+', '', title)
    if re.search(r'构建时间|\.js - Build|^#|^实际不用|^入口$|^请求阶段', title):
        title = Path(path).stem
    title = title[:70] if title else Path(path).stem
    description = '；'.join(prose[:8])[:700]
    return {'name': title, 'description': description, 'comment': note[:24000]}
