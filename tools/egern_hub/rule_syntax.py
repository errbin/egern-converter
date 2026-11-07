"""Balanced rule expressions shared by Surge, Loon, QX and Clash families."""
import re


def split_fields(text):
    fields, start, depth, quote, escaped = [], 0, 0, '', False
    for i, char in enumerate(text):
        if escaped:
            escaped = False
            continue
        if char == '\\':
            escaped = True
            continue
        if quote:
            if char == quote:
                quote = ''
            continue
        if char in {'"', "'"}:
            quote = char
        elif char == '(':
            depth += 1
        elif char == ')':
            depth -= 1
            if depth < 0:
                raise ValueError('规则括号不匹配')
        elif char == ',' and depth == 0:
            fields.append(text[start:i].strip()); start = i + 1
    if depth or quote:
        raise ValueError('规则括号或引号不完整')
    fields.append(text[start:].strip())
    return fields


def strip_comment(text):
    quote, escaped = '', False
    for i, char in enumerate(text):
        if escaped:
            escaped = False
            continue
        if char == chr(92):
            escaped = True
            continue
        if quote:
            if char == quote: quote = ''
        elif char in {'"', "'"}:
            quote = char
        elif i and text[i-1].isspace() and (char == '#' or text[i:i+2] == '//'):
            return text[:i].rstrip()
    return text


def logical_rule(line, policy, parse):
    fields = split_fields(line)
    kind = fields[0].lower()
    if len(fields) not in {2, 3} or not fields[1].startswith('(') or not fields[1].endswith(')'):
        raise ValueError('无效逻辑规则')
    if policy is not None and (len(fields) != 3 or not fields[2]):
        raise ValueError('逻辑规则缺少策略')
    children = []
    for child in split_fields(fields[1][1:-1]):
        if not child.startswith('(') or not child.endswith(')'):
            raise ValueError('逻辑子规则需要括号')
        inner = child[1:-1]
        parts = split_fields(inner)
        # Child rules have conditions only, never their own policy.
        if len(parts) > 2 and not (len(parts) == 3 and parts[2].lower() == 'no-resolve'):
            raise ValueError('逻辑子规则不能含策略或未知选项')
        k, value = parse(inner)
        children.append({k:value})
    if not children or (kind == 'not' and len(children) != 1):
        raise ValueError('NOT 必须有一个子条件；AND/OR 不能为空')
    value = {'match':children[0] if kind == 'not' else children}
    if policy is not None:
        value['policy'] = fields[2]
    return kind, value


def ip_flags(kind, item):
    if kind in {'ip_cidr', 'ip_cidr6', 'asn', 'geoip'}:
        return {item.get('no_resolve', False)}
    if kind in {'and', 'or', 'not'}:
        rows = [item['match']] if kind == 'not' else item['match']
        return set().union(*(ip_flags(k, v) for row in rows for k, v in row.items()))
    return set()
