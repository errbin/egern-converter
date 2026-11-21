"""把可证明等价的固定脚本折叠为 Egern 声明式规则。

判定只接受没有函数、分支、正则和宿主调用的脚本；任何不确定形态都保留
scriptings。转换不推导 MITM，也不改动原有 match。
"""
from __future__ import annotations

SAFE_KINDS = frozenset({'response_jq', 'request_jq', 'map_local', 'reject', 'redirect', 'header'})
BODY_KINDS = frozenset({'response_jq', 'request_jq', 'map_local'})
REJECT_LOCATIONS = {200: 'http://reject-200/', 404: 'http://reject/'}


def _entries(obj):
    """按声明顺序返回 (索引, 阶段, 条目)。只处理请求/响应脚本。"""
    for index, scripting in enumerate(obj.get('scriptings') or []):
        if not isinstance(scripting, dict) or len(scripting) != 1:
            continue
        phase, entry = next(iter(scripting.items()))
        if phase not in {'http_request', 'http_response'} or not isinstance(entry, dict):
            continue
        yield index, phase, entry


def _existing_match(obj, kind, match):
    """同 match 的声明式规则已存在时不再追加，避免改变执行顺序或重复执行。"""
    if kind in {'response_jq', 'request_jq'}:
        for row in obj.get('body_rewrites') or []:
            if not isinstance(row, dict):
                continue
            for phase in ('request_jq', 'response_jq'):
                entry = row.get(phase)
                if isinstance(entry, dict) and entry.get('match') == match:
                    return True
        return False
    if kind == 'map_local':
        return any(isinstance(row, dict) and row.get('match') == match
                   for row in obj.get('map_locals') or [])
    if kind in {'reject', 'redirect'}:
        return any(isinstance(row, dict) and row.get('match') == match
                   for row in obj.get('url_rewrites') or [])
    if kind == 'header':
        for row in obj.get('header_rewrites') or []:
            if isinstance(row, dict):
                for action in ('add', 'delete', 'replace'):
                    entry = row.get(action)
                    if isinstance(entry, dict) and entry.get('match') == match:
                        return True
        return False
    return True


def _can_downgrade(kind, phase, entry):
    if entry.get('disabled'):
        return False
    if entry.get('binary_body'):
        return False
    if kind in BODY_KINDS and not entry.get('body_required'):
        return False
    if kind in {'response_jq', 'map_local'} and phase != 'http_response':
        return False
    if kind == 'request_jq' and phase != 'http_request':
        return False
    # url_rewrites 在请求阶段拦截；响应阶段脚本不改变下游请求，保留脚本。
    if kind in {'reject', 'redirect'} and phase != 'http_request':
        return False
    return True


def _append_header_rows(obj, match, result):
    rows = obj.setdefault('header_rewrites', [])
    for operation in result.get('operations') or []:
        name = operation.get('name')
        if not isinstance(name, str) or not name:
            return False
        if operation.get('op') == 'set':
            value = operation.get('value')
            if not isinstance(value, str):
                return False
            rows.append({'add': {'match': match, 'name': name,
                                 'type': result['headers_type'], 'value': value}})
        elif operation.get('op') == 'delete':
            rows.append({'delete': {'match': match, 'name': name,
                                    'type': result['headers_type']}})
        else:
            return False
    return True


def plan_module_downgrades(obj, script_map, analysis):
    """返回 (安全降级列表, 是否整体跳过)。不修改 obj 或 script_map。"""
    if not isinstance(obj, dict) or not script_map or not analysis:
        return [], False
    scriptings = obj.get('scriptings') or []
    if not scriptings:
        return [], False
    # 合并来源可能来自不同上游；保持原样，避免跨来源顺序变化。
    if obj.get('_merge_members'):
        return [], True

    planned = []
    for index, phase, entry in _entries(obj):
        script_url = entry.get('script_url')
        if not isinstance(script_url, str) or script_url not in script_map:
            continue
        script_id = script_map[script_url]
        result = analysis.get(script_id) or {}
        kind = result.get('kind')
        if kind not in SAFE_KINDS:
            continue
        if not _can_downgrade(kind, phase, entry):
            continue
        match = entry.get('match')
        if not isinstance(match, str) or not match.startswith('^'):
            continue
        if _existing_match(obj, kind, match):
            continue
        data = {'kind': kind, 'phase': phase, 'index': index, 'match': match,
                'script_url': script_url, 'script_id': script_id}
        if kind in {'response_jq', 'request_jq'}:
            data['filter'] = result['filter']
        elif kind == 'map_local':
            data['body'] = result['body']
        elif kind == 'reject':
            location = REJECT_LOCATIONS.get(result.get('status'))
            if not location:
                continue
            data['location'] = location
        elif kind == 'redirect':
            if result.get('status') not in {301, 302, 307, 308} or not result.get('location'):
                continue
            data['location'] = result['location']
            data['status_code'] = result['status']
        elif kind == 'header':
            expected = 'request' if phase == 'http_request' else 'response'
            if result.get('headers_type') != expected:
                continue
            operations = result.get('operations') or []
            if not operations or any(
                    not isinstance(operation.get('name'), str) or not operation['name']
                    or operation.get('op') not in {'set', 'delete'}
                    for operation in operations):
                continue
            data['headers_type'] = result.get('headers_type')
            data['operations'] = operations
        planned.append(data)
    return planned, False


def apply_module_downgrades(obj, script_map, planned):
    """把计划写入模块对象，并只在该 URL 不再被引用时清理 script_map。"""
    if not planned:
        return
    removed = {row['index'] for row in planned}
    scriptings = obj.get('scriptings') or []
    obj['scriptings'] = [row for index, row in enumerate(scriptings) if index not in removed]
    if not obj['scriptings']:
        obj.pop('scriptings', None)
    for row in planned:
        match = row['match']
        kind = row['kind']
        if kind in {'response_jq', 'request_jq'}:
            key = 'response_jq' if kind == 'response_jq' else 'request_jq'
            obj.setdefault('body_rewrites', []).append({key: {'match': match, 'filter': row['filter']}})
        elif kind == 'map_local':
            obj.setdefault('map_locals', []).append({'match': match, 'body': row['body']})
        elif kind in {'reject', 'redirect'}:
            rule = {'match': match, 'location': row['location']}
            if kind == 'redirect':
                rule['status_code'] = row['status_code']
            obj.setdefault('url_rewrites', []).append(rule)
        elif kind == 'header':
            if not _append_header_rows(obj, match, {'operations': row['operations'],
                                                    'headers_type': row['headers_type']}):
                raise ValueError('声明式 header 降级缺少合法字段')
    remaining = {entry.get('script_url') for _, _, entry in _entries(obj)}
    for row in planned:
        if row['script_url'] not in remaining:
            script_map.pop(row['script_url'], None)


def downgrade_module(obj, script_map, analysis):
    """按保守判定降级单个模块；返回降级记录。"""
    planned, skip = plan_module_downgrades(obj, script_map, analysis)
    if skip or not planned:
        return []
    apply_module_downgrades(obj, script_map, planned)
    return [{key: row[key] for key in ('kind', 'phase', 'match', 'script_url', 'script_id')}
            for row in planned]


def provenance_lines(downgrades, targets=None):
    """每个被降级的上游脚本只写一行，避免给所有规则无条件加注释。"""
    lines = []
    seen = set()
    for row in downgrades:
        url = row.get('script_url')
        if not url or url in seen:
            continue
        seen.add(url)
        target = (targets or {}).get(url)
        lines.append(f'# Declarative: {url}' + (f' -> {target}' if target else '') + '\n')
    return lines
