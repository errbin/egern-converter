"""Compile declarative body operations to Egern regex/jq, without helper scripts."""
import json
import re


def key_path(value):
    value = value.replace(r'\x20', ' ')
    tokens = re.findall(r'[^.\[\]]+|\[\d+\]', value)
    if not tokens or '.'.join(tokens).replace('.[', '[') != value:
        raise ValueError('不支持的 JSON Key Path：'+value)
    return [int(t[1:-1]) if t.startswith('[') else t for t in tokens]


def body_rewrite(line, loader=None, *, allow_unquoted_jq=False):
    line = re.sub(r'^(\S+)\s+url\s+jsonjq-(request|response)-body\s+', r'\1 \2-body-json-jq ', line)
    match = re.fullmatch(r'(\S+)\s+(request|response)-body-(replace-regex|json-(?:jq|del|add|replace))\s+(.+)', line)
    if not match:
        return None
    pattern, direction, action, tail = match.groups()
    if action == 'json-jq':
        path = re.fullmatch(r'jq-path="([^"]+)"', tail)
        if path:
            if loader is None:
                raise ValueError('jq-path 需要原作者仓库解析器')
            expression = loader(path[1])
        elif len(tail) >= 2 and tail[0] == tail[-1] and tail[0] in {'"', "'"}:
            expression = tail[1:-1]
        elif allow_unquoted_jq and not tail.startswith(('"', "'", 'jq-path=')):
            # The rest of a classic Loon jq line is one complete filter, not
            # whitespace-separated arguments. Preserve it verbatim.
            expression = tail
        else:
            raise ValueError('jq 表达式必须完整引用')
        if not expression.strip():
            raise ValueError('jq 表达式为空')
        return [{direction+'_jq':{'match':pattern, 'filter':expression}}]
    values = tail.split()
    if action == 'replace-regex':
        if len(values) % 2:
            raise ValueError('正则替换需要成对的查找与替换值')
        return [{direction+'_regex':{'match':pattern, 'find':values[i].replace(r'\x20',' '),
                    'replace':values[i+1].replace(r'\x20',' ')}} for i in range(0,len(values),2)]
    if action == 'json-del':
        expression = 'delpaths('+json.dumps([key_path(v) for v in values],ensure_ascii=False)+')'
    else:
        if len(values) % 2:
            raise ValueError('JSON 改写需要成对的路径和值')
        operations = []
        for i in range(0,len(values),2):
            path = key_path(values[i]); raw = values[i+1].replace(r'\x20',' ')
            try:
                value = json.loads(raw)
            except ValueError:
                value = raw
            p = json.dumps(path,ensure_ascii=False); v = json.dumps(value,ensure_ascii=False)
            operation = f'setpath({p}; {v})'
            if action == 'json-replace':
                parent = json.dumps(path[:-1],ensure_ascii=False); leaf = json.dumps(path[-1],ensure_ascii=False)
                operation = f'if (getpath({parent}) | has({leaf})) then {operation} else . end'
            operations.append('('+operation+')')
        expression = ' | '.join(operations)
    return [{direction+'_jq':{'match':pattern, 'filter':expression}}]


def mock_response(line, loader=None):
    import base64
    match=re.fullmatch(r'(\S+)\s+mock-response-body\s+(.+)',line)
    if not match:return None
    # Values may contain unescaped JSON quotes. Boundaries are named options.
    chunks=re.split(r'\s+(?=(?:data-type|status-code|data|data-path|mock-data-is-base64)=)',match[2])
    opts={}
    for chunk in chunks:
        k,sep,v=chunk.partition('=')
        if not sep or k in opts:raise ValueError('Mock 参数无效或重复')
        opts[k]=v[1:-1] if len(v)>=2 and v[0]==v[-1]=='"' else v
    allowed={'data-type','status-code','data','data-path','mock-data-is-base64'}
    if set(opts)-allowed or ('data' in opts)==('data-path' in opts):raise ValueError('Mock 必须且只能声明 data 或 data-path')
    value=opts.get('data')
    if value is None:
        if loader is None:raise ValueError('Mock data-path 需要原作者仓库解析器')
        value=loader(opts['data-path'])
    mime={'json':'application/json','text':'text/plain','plain':'text/plain','html':'text/html','css':'text/css','javascript':'application/javascript','png':'image/png','gif':'image/gif','jpeg':'image/jpeg','svg':'image/svg+xml','mp4':'video/mp4','text/event-stream':'text/event-stream'}
    if opts.get('data-type','text') not in mime:raise ValueError('未适配 Mock 数据类型')
    encoded=opts.get('mock-data-is-base64','false')
    if encoded not in {'true','false'}:raise ValueError('Mock Base64 标记必须是布尔值')
    body=list(base64.b64decode(value,validate=True)) if encoded=='true' else value
    status=int(opts.get('status-code','200'))
    if status<200 or status>599:raise ValueError('无效 Mock HTTP 状态码')
    return {'match':match[1],'status':status,'headers':{'Content-Type':mime[opts.get('data-type','text')]},'body':body}
