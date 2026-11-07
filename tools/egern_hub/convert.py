"""Conservative, offline Egern converters. Never execute upstream JavaScript."""
import argparse
import csv
import ipaddress
import json
import re
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urljoin, urlsplit

import yaml

from .rule_syntax import logical_rule, strip_comment, ip_flags
from .body_syntax import body_rewrite, mock_response
from .loon_arguments import declaration as loon_declaration, bind as loon_bind, referenced_keys
from .header_syntax import loon_headers
from .loon_normalize import normalize as normalize_loon, v2_url_regex
from .module_comments import AnnotatedModule, note, render_annotations
from .loon_v2 import parse as parse_loon_v2, script_entry as loon_v2_script, rewrite_entries as loon_v2_rewrites


class ConversionError(ValueError):
    def __init__(self, message, *, diagnostics=()):
        super().__init__(message)
        self.diagnostics = list(diagnostics)


TYPES = {
    'DOMAIN': 'domain', 'HOST': 'domain',
    'DOMAIN-SUFFIX': 'domain_suffix', 'HOST-SUFFIX': 'domain_suffix',
    'DOMAIN-KEYWORD': 'domain_keyword', 'HOST-KEYWORD': 'domain_keyword',
    'DOMAIN-REGEX': 'domain_regex', 'DOMAIN-WILDCARD': 'domain_wildcard',
    'IP-CIDR': 'ip_cidr', 'IP-CIDR6': 'ip_cidr6', 'IP6-CIDR': 'ip_cidr6',
    'IP-ASN': 'asn', 'ASN': 'asn', 'GEOIP': 'geoip',
    'URL-REGEX': 'url_regex', 'USER-AGENT': 'user_agent',
    'DEST-PORT': 'dest_port', 'DST-PORT': 'dest_port',
    'PROTOCOL': 'protocol', 'SSID': 'ssid', 'BSSID': 'bssid', 'CELLULAR': 'cellular',
}
IP_TYPES = {'ip_cidr', 'ip_cidr6', 'asn', 'geoip'}


def active_lines(text):
    for number, line in enumerate(text.lstrip('\ufeff').splitlines(), 1):
        line = line.strip()
        if line and not line.startswith(('#', '//', ';')):
            yield number, line


def rule(line, policy=None):
    line = strip_comment(line)
    if line.split(',', 1)[0].strip().upper() in {'AND','OR','NOT'}:
        try:
            return logical_rule(line, policy, rule)
        except ValueError as exc:
            raise ConversionError(str(exc)) from exc
    fields = next(csv.reader([line], skipinitialspace=True))
    fields = [x.strip() for x in fields]
    kind = TYPES.get(fields[0].upper())
    if not kind or len(fields) < 2 or not fields[1]:
        raise ConversionError(f'不支持的规则：{line}')
    value = fields[1]
    if kind in {'ip_cidr', 'ip_cidr6'}:
        try:
            network = ipaddress.ip_network(value, strict=False)
            if network.version != (4 if kind == 'ip_cidr' else 6):
                raise ValueError('IP family mismatch')
        except ValueError as exc:
            raise ConversionError(f'无效 CIDR：{value}') from exc
    if kind == 'geoip' and not re.fullmatch(r'[A-Za-z]{2}', value):
        raise ConversionError(f'无效 GEOIP：{value}')
    if kind == 'protocol':
        value = value.lower()
        if value not in {'tcp', 'udp', 'http', 'https', 'quic', 'stun'}:
            raise ConversionError(f'不支持协议：{value}')
    tail = fields[2:]
    no_resolve = bool(tail and tail[-1].lower() == 'no-resolve')
    if no_resolve:
        tail.pop()
        if kind not in IP_TYPES:
            raise ConversionError('no-resolve 只能用于 IP 规则')
    if len(tail) > 1 or any(x.lower() in {'extended-matching', 'pre-matching'} for x in tail):
        raise ConversionError(f'不支持的规则选项：{line}')
    data = {'match': value}
    if policy is not None:
        if not tail or not tail[0]:
            raise ConversionError('规则缺少策略')
        data['policy'] = tail[0]
    if no_resolve:
        data['no_resolve'] = True
    return kind, data


def convert_rules(text, source_format='surge'):
    """Policies are deliberately removed; the importing rule supplies its policy."""
    if source_format in {'clash-classical','clash-classic','clash','mihomo','stash'}:
        obj = yaml.safe_load(text)
        if not isinstance(obj, dict) or not isinstance(obj.get('payload'), list):
            raise ConversionError('Clash classical 必须包含 payload 数组')
        lines = list(enumerate(obj['payload'], 1))
    else:
        lines = list(active_lines(text))
    result, seen, flags = {}, {}, set()
    for number, line in lines:
        try:
            if source_format == 'domain-set':
                if not isinstance(line, str) or not re.fullmatch(r'\.?[\w*-]+(?:\.[\w*-]+)*', line):
                    raise ConversionError('无效 domain-set 域名')
                kind, item = ('domain_suffix' if line.startswith('.') else 'domain'), {'match': line.lstrip('.')}
            else:
                kind, item = rule(line)
            flags.update(ip_flags(kind, item))
            key = kind + '_set'
            value = item['match']
            # Regex, URL, keyword and User-Agent values may be case-sensitive.
            identity = value.lower() if kind in {'domain', 'domain_suffix', 'geoip'} else (json.dumps(value, sort_keys=True) if isinstance(value, (dict,list)) else value)
            if identity not in seen.setdefault(key, set()):
                result.setdefault(key, []).append(value)
                seen[key].add(identity)
        except (ValueError, TypeError, csv.Error) as exc:
            raise ConversionError(f'第 {number} 行：{exc}') from exc
    if len(flags) > 1:
        raise ConversionError('混合 no-resolve 语义无法无损转换为规则集全局 no_resolve')
    if flags == {True}:
        result['no_resolve'] = True
    if not seen:
        raise ConversionError('规则集为空')
    return result


def script_options(text, *, loon_tags=False):
    """Split actual options, preserving regex quantifiers/classes and quoted values."""
    # Surge permits a final JSON argument wrapped in unescaped double quotes.
    # Validate the JSON structure without evaluating module placeholders.
    argument = re.search(r'(?:^|,)\s*argument\s*=\s*"(\{.*\})"\s*$', text)
    if argument:
        raw = argument[1]
        try:
            value = json.loads(re.sub(r'\{\{\{[^{}]+\}\}\}', '0', raw))
        except ValueError as exc:
            raise ConversionError('JSON argument 结构无效') from exc
        if not isinstance(value, dict):
            raise ConversionError('JSON argument 必须为对象')
        result = script_options(text[:argument.start()]) if argument.start() else {}
        if 'argument' in result:
            raise ConversionError('重复脚本参数')
        return {**result, 'argument': raw}
    chunks, current, stack = [], [], []
    quote, escaped, key, started, closed = '', False, '', False, False
    pairs = {'(': ')', '[': ']', '{': '}'}
    for char in text:
        if escaped:
            current.append(char); escaped = False; continue
        if char == chr(92):
            current.append(char); escaped = True; continue
        if quote:
            current.append(char)
            if char == quote: quote, closed = '', True
            continue
        if char == ',' and not stack:
            chunks.append(''.join(current)); current = []
            key, started, closed = '', False, False
            continue
        if closed and not char.isspace():
            raise ConversionError('引号值后包含多余字符')
        if not key and char == '=':
            key = ''.join(current).strip(); current.append(char); continue
        if key and not started and not char.isspace():
            started = True
            if char in {'"', "'"}:
                quote = char; current.append(char); continue
        if key in {'pattern','argument'}:
            if stack and stack[-1] == ']':
                if char == ']': stack.pop()
            elif char in pairs: stack.append(pairs[char])
            elif char in {')', ']', '}'}:
                if not stack or stack.pop() != char:
                    raise ConversionError('pattern 括号不匹配')
        current.append(char)
    if quote or stack or escaped:
        raise ConversionError('脚本参数引号、括号或转义不完整')
    chunks.append(''.join(current))
    result = {}
    for index, chunk in enumerate(chunks):
        name, sep, value = chunk.strip().partition('=')
        name, value = name.strip(), value.strip()
        if not sep and result and next(reversed(result)) in {'cronexp','cron'} and re.fullmatch(r'[\d*/?LW#A-Za-z ,\-]+', name):
            result[next(reversed(result))] += ',' + name
            continue
        if loon_tags and not sep and result and next(reversed(result)) == 'tag':
            if not name and index == len(chunks)-1:
                continue
            if name and name not in {'type','pattern','script-path','requires-body','binary-body-mode','timeout','max-size','argument','enable','enabled'}:
                result['tag'] += ',' + name
                continue
        if not sep or not name or not value:
            raise ConversionError('脚本参数必须为逗号分隔的 key=value')
        if name in result:
            raise ConversionError('重复脚本参数')
        if value.startswith(('"', "'")):
            if value[-1] != value[0]: raise ConversionError('脚本参数引号不完整')
            value = value[1:-1]
        result[name] = value
    return result


def assign_script_names(obj):
    """Replace unnamed/generated labels using source filenames, before URL rewriting."""
    options = [options for entry in obj.get('scriptings', []) for options in entry.values()]
    def placeholder(value):
        return not value or bool(re.fullmatch(r'script\d*',value.strip(),re.I))
    # Reserve explicit author labels first, including those declared later.
    used = {entry['name'].strip().casefold() for entry in options if not placeholder(entry.get('name',''))}
    for entry in options:
        if not placeholder(entry.get('name','')):
            continue
        path = unquote(urlsplit(entry['script_url']).path)
        base = ' '.join(PurePosixPath(path).stem.split()) or 'script'
        name, count = base, 2
        while name.casefold() in used:
            name = f'{base}-{count}'
            count += 1
        entry['name'] = name
        used.add(name.casefold())


def convert_module(text, source_format='surge', scripts_native=False, *, generated_headers=False, rule_set_loader=None, native_rewrites=False, normalizations=None, parameter_loader=None, replacement_loader=None, script_contract_loader=None):
    source_format = {'shadowrocket':'surge','quantumult-x':'qx','quantumultx':'qx'}.get(source_format,source_format)
    if source_format == 'egern':
        # Egern exports bare '=' as a string (YAML 1.2); PyYAML 1.1 tags it
        # as an undefined value. Keep SafeLoader isolation and scalar content.
        class NativeLoader(yaml.SafeLoader):
            pass
        NativeLoader.add_constructor('tag:yaml.org,2002:value', lambda loader,node:loader.construct_scalar(node))
        # Official Egern modules may contain unquoted {{{argument}}} values
        # that Egern expands before YAML parsing (for example `disabled`).
        # Replace only a complete bare scalar for inspection. The caller keeps
        # and publishes the original source bytes for native modules.
        inspect_text = re.sub(
            r'(?m)^([ \t]*[^#\s][^:\n]*:[ \t]*)\{\{\{[^{}\n]+\}\}\}([ \t]*(?:#.*)?)$',
            lambda match: match.group(1) + '"__egern_template_value__"' + match.group(2),
            text,
        )
        result = yaml.load(inspect_text, Loader=NativeLoader)
        validate_module(result)
        return result
    if source_format not in {'surge', 'loon', 'qx'}:
        raise ConversionError(f'未知模块格式：{source_format}')
    result, section, header_actions, force_http_hosts = AnnotatedModule(), '', [], []
    pending_comments = []
    diagnostics = []
    from .loon_normalize import blocking_profile,missing_block_action
    uniform_reject=source_format=='loon' and blocking_profile(text)
    def recover_parameters(script_url, missing, number):
        if not missing or not parameter_loader:
            return
        for entry in parameter_loader(canonical_script_url(script_url),missing):
            key=entry['key']
            if key not in missing or key in result.get('compat_arguments',{}):
                raise ConversionError('配套模块参数解析器返回了无关或重复参数')
            result.setdefault('compat_arguments',{})[key]=entry['default']
            result.setdefault('compat_arguments_schema',{})[key]=entry['schema']
            if normalizations is not None:
                normalizations.append({'line':number,'parameter':key,'source':entry['source'],
                    'source_line':entry['line'],'sha256':entry['sha256'],
                    'reason':'从同一原作者脚本的配套模块补全功能参数声明'})
    for number, line in enumerate(text.lstrip('\ufeff').splitlines(), 1):
        line = line.strip()
        meta = re.match(r'#!(name|desc|author|homepage|icon)\s*=\s*(.*)', line)
        arguments = re.fullmatch(r'#!arguments\s*=\s*(.*)', line)
        if arguments:
            defaults = {}
            # Explicit scalar defaults only; do not guess at quoted commas or expressions.
            for entry in arguments[1].split(','):
                key, sep, value = entry.partition(':')
                key, value = key.strip(), value.strip()
                if not key or key in defaults:
                    raise ConversionError('无效或重复的模块参数默认值')
                if value.startswith('"'):
                    try:
                        value = json.loads(value)
                    except ValueError as exc:
                        raise ConversionError('参数引号或逗号语义需要独立适配') from exc
                    if not isinstance(value, str):
                        raise ConversionError('模块参数默认值必须为标量')
                defaults[key] = value
            result['compat_arguments'] = defaults
            continue
        arguments_desc = re.fullmatch(r'#!arguments-desc\s*=\s*(.*)', line)
        if arguments_desc:
            result['compat_arguments_desc'] = arguments_desc[1]
            continue
        if meta:
            result[{'desc': 'description'}.get(meta[1], meta[1])] = meta[2]
            continue
        if not line or line.startswith(('#', ';', '//')):
            if (section or source_format == 'loon') and line and (value := note(line)):
                pending_comments.append(value)
            continue
        if re.fullmatch(r'\[.+\]', line):
            pending_comments = []
            section = line[1:-1].lower()
            continue
        declared_section = section
        previous_sizes = {field:len(values) for field,values in result.items() if isinstance(values, list)}
        previous_mitm = result.get('mitm')
        if source_format=='loon':
            if not section and re.match(r'hostname\s*=',line):
                section='mitm'
            elif not section and (re.match(r'(?:http-request|http-response|cron|generic|network-changed)\s+.*\bscript-path\s*=',line)
                                 or re.match(r'cron\s+"[^"\n]+"\s+https://',line)
                                 or (re.match(r'(?:request|response)\s+if\s|cron\s|(?:generic|network-changed)\s+then\s',line) and ' then script(' in line)):
                section='script'
            elif section in {'rewrite','url rewrite'} and re.match(r'http-(?:request|response)\s+\S+\s+script-path\s*=',line):
                section='script'
            elif section=='script' and re.fullmatch(r'\S+\s+reject(?:-200|-dict|-array|-img|-video)?',line):
                section='rewrite'
            if section!=declared_section and normalizations is not None:
                normalizations.append({'line':number,'from_section':declared_section,'to_section':section,'reason':'按明确的经典声明语法识别配置段'})
        try:
            if source_format == 'loon':
                recovered=missing_block_action(line,section) if uniform_reject else None
                if recovered:
                    if normalizations is not None:
                        normalizations.append({'line':number,'before':line,'after':recovered,
                            'reason':'按模块全部显式分流规则的统一 REJECT 策略及纯拦截重写补全裸 HTTP 匹配式；混合策略不推断'})
                    line=recovered
                previous = line
                line, reason = normalize_loon(line, section, script_options)
                if reason and normalizations is not None:
                    normalizations.append({'line':number,'before':previous,'after':line,'reason':reason})
            if source_format == 'loon' and section in {'script','rewrite','url rewrite'} and re.match(r'(?:request|response)\s+if\s|(?:cron\s|generic\s+then\s|network-changed\s+then\s)',line) and ' then ' in line:
                repairs = []
                defaults=result.setdefault('compat_arguments',{})
                parse_parameters=lambda script,keys:recover_parameters(script,keys,number)
                try:
                    parsed = parse_loon_v2(line, defaults=defaults, repairs=repairs,parameter_loader=parse_parameters)
                except ValueError:
                    corrected,reason = v2_url_regex(line)
                    repairs = [{'before':line,'after':corrected,'reason':reason}] if reason else []
                    try:
                        parsed = parse_loon_v2(corrected, defaults=defaults, repairs=repairs,parameter_loader=parse_parameters)
                    except ValueError:
                        recovered=replacement_loader(corrected) if replacement_loader else None
                        if not recovered:
                            raise
                        repaired,origin=recovered
                        repairs.append({'before':corrected,'after':repaired,**origin})
                        parsed=parse_loon_v2(repaired,defaults=defaults,repairs=repairs,parameter_loader=parse_parameters)
                if normalizations is not None:
                    normalizations.extend(dict(repair,line=number) for repair in repairs)
                if section == 'script':
                    if not scripts_native:
                        raise ConversionError('脚本需先适配 Egern ctx API，再使用 --scripts-native')
                    recovered=script_contract_loader(parsed) if script_contract_loader else None
                    if recovered:
                        parsed,origin=recovered
                        keys=set(origin.get('restored',{}).get('argument_parameters',[]))
                        recover_parameters(parsed[2][0][1][0].value,keys-set(result.get('compat_arguments',{})),number)
                        if normalizations is not None:normalizations.append(dict(origin,line=number))
                    result.setdefault('scriptings',[]).append(loon_v2_script(parsed,result.get('compat_arguments',{})))
                else:
                    for field,entry in loon_v2_rewrites(parsed,result.get('compat_arguments',{}),rule_set_loader):
                        if field == '_header_actions':header_actions.append(entry)
                        else:result.setdefault(field,[]).append(entry)
            elif section == 'argument' and source_format == 'loon':
                description = loon_declaration(line, result.setdefault('compat_arguments', {}), result.setdefault('compat_arguments_schema', {}))
                result['compat_arguments_desc'] = (result.get('compat_arguments_desc','')+'\n'+description).strip()
            elif section in {'rule', 'rules', 'filter_local'}:
                if line.split(',', 1)[0].strip().upper() == 'RULE-SET':
                    fields = [value.strip() for value in next(csv.reader([line], skipinitialspace=True))]
                    if len(fields) not in {3, 4} or not all(fields[:3]) or (len(fields) == 4 and fields[3] != 'no-resolve'):
                        raise ConversionError('无效的 RULE-SET 引用或选项')
                    if rule_set_loader is None:
                        raise ConversionError('RULE-SET 需要原作者仓库解析器读取并转换，不能直接引用其他平台规则集')
                    body = rule_set_loader(fields[1])
                    children = []
                    for child_number, child in active_lines(body):
                        try:
                            kind, data = rule(child)
                        except ConversionError as exc:
                            raise ConversionError(f'规则集 {fields[1]} 第 {child_number} 行：{exc}') from exc
                        data['policy'] = fields[2]
                        if len(fields) == 4 and kind in IP_TYPES:
                            data['no_resolve'] = True
                        children.append({kind: data})
                    if not children:
                        raise ConversionError('引用的规则集为空')
                    result.setdefault('rules', []).extend(children)
                    continue
                kind, data = rule(line, 'DIRECT')
                result.setdefault('rules', []).append({kind: data})
            elif section in {'url rewrite', 'rewrite', 'rewrite_local'} or (source_format == 'qx' and not section):
                headers = loon_headers(line) if source_format == 'loon' else None
                if headers is not None:
                    for header in headers:
                        action = 'delete' if header['action']=='del' else 'add'
                        data = {k:v for k,v in header.items() if k!='action' and v is not None}
                        if native_rewrites and action!='delete':
                            operation = {'set':{header['name']:header['value']}}
                            result.setdefault('rewrites',[]).append({'match':header['match'],'actions':[{header['type']+'_headers':operation}]})
                        else:
                            result.setdefault('header_rewrites',[]).append({action:data})
                    continue
                mock = mock_response(line, rule_set_loader)
                if mock is not None:
                    if native_rewrites:
                        import base64
                        response={key:mock[key] for key in ('status','headers','body')}
                        if isinstance(response['body'],list):
                            response['body']={'base64':base64.b64encode(bytes(response['body'])).decode()}
                        result.setdefault('rewrites',[]).append({'match':mock['match'],'actions':[{'respond':response}]})
                    elif not generated_headers:
                        raise ConversionError('Mock 需要构建器生成原生依赖脚本')
                    else:
                        result.setdefault('_mock_actions', []).append(mock)
                    continue
                body = body_rewrite(line, rule_set_loader, allow_unquoted_jq=source_format == 'loon')
                if body is not None:
                    if native_rewrites:
                        for row in body:
                            kind, data = next(iter(row.items()))
                            direction, operation = kind.split('_',1)
                            value = {'jq':data['filter']} if operation=='jq' else {'regex':data['find'],'replacement':data['replace']}
                            result.setdefault('rewrites',[]).append({'match':data['match'],'actions':[{direction+'_body':value}]})
                    else:
                        result.setdefault('body_rewrites', []).extend(body)
                    continue
                parts = line.split()
                if len(parts) == 3 and parts[1] == 'url':
                    parts.pop(1)
                elif len(parts) == 4 and parts[1] == 'url':
                    parts.pop(1)
                if len(parts) == 3 and parts[1] in {'-', '_'} and parts[2].startswith('reject'):
                    parts.pop(1)
                rejects = {'reject', 'reject-200', 'reject-dict', 'reject-array', 'reject-img', 'reject-video'}
                # Action keywords are case-insensitive; never lowercase the
                # matching expression or a redirect's case-sensitive URL.
                if len(parts) == 2 and parts[1].lower() in rejects:
                    parts[1] = parts[1].lower()
                if len(parts) == 2 and parts[1] in rejects:
                    data = {'match': parts[0], 'location': f'http://{parts[1]}/'}
                elif source_format == 'loon' and len(parts) == 3 and parts[1] in {'301','302','307','308','header'}:
                    data = {'match':parts[0], 'location':parts[2]}
                    if parts[1] != 'header':
                        data['status_code'] = int(parts[1])
                elif len(parts) == 3 and parts[2] in {'301', '302', '307', '308', 'header'}:
                    data = {'match': parts[0], 'location': parts[1]}
                    if parts[2] != 'header':
                        data['status_code'] = int(parts[2])
                else:
                    raise ConversionError('不支持的重写动作（包括 Loon v2 表达式和 QX script 动作）')
                if native_rewrites and (len(parts)==3 or parts[-1] in {'reject','reject-200','reject-dict','reject-array'}):
                    if len(parts)==2:
                        reject=parts[-1]
                        value={'status':404 if reject=='reject' else 200}
                        if reject in {'reject-dict','reject-array'}:
                            value.update(headers={'Content-Type':'application/json'},body='{}' if reject=='reject-dict' else '[]')
                        action={'respond':value}
                    else:
                        action={'redirect':{'status':data['status_code'],'location':data['location']}} if 'status_code' in data else {'replace_url':data['location']}
                    result.setdefault('rewrites',[]).append({'match':data['match'],'actions':[action]})
                else:
                    result.setdefault('url_rewrites', []).append(data)
            elif section == 'mitm':
                key, value = [x.strip() for x in line.split('=', 1)]
                if key.lower() != 'hostname':
                    raise ConversionError('只支持 MITM hostname；证书等设置不转换')
                hosts = [x.strip() for x in re.sub(r'%(?:APPEND|INSERT)%', '', value).split(',') if x.strip()]
                result['mitm'] = {'hostnames': {'includes': [x for x in hosts if not x.startswith('-')],
                                                'excludes': [x[1:] for x in hosts if x.startswith('-')]}}
            elif section == 'header rewrite' and source_format == 'surge':
                header = re.fullmatch(r'(?:(http-request|http-response)\s+)?(\S+)\s+header-(del|add|replace|replace-regex)\s+(\S+)(?:\s+(.+))?', line)
                if not header:
                    raise ConversionError('无效的 Surge Header Rewrite')
                direction, pattern, action, name, value = header.groups()
                data = {'match':pattern, 'name':name, 'type':'response' if direction=='http-response' else 'request'}
                if generated_headers and action != 'replace-regex':
                    if (action == 'del') != (value is None):
                        raise ConversionError('头部动作的值数量不正确')
                    if name.casefold() in {'content-length','transfer-encoding'}:
                        raise ConversionError('不改写消息分帧头 Content-Length / Transfer-Encoding')
                    header_actions.append(dict(data, action=action, value=value))
                    continue
                rewrites = result.setdefault('header_rewrites', [])
                if action == 'del' and value is None:
                    rewrites.append({'delete':data})
                elif action == 'add' and value is not None and rewrites and rewrites[-1].get('delete') == data:
                    # After deletion no existing field can be appended to.
                    rewrites.append({'add':dict(data, value=value)})
                elif action == 'add':
                    raise ConversionError('Surge header-add 为追加多值头；仅支持紧随同匹配、同字段的 header-del，不能直接映射 Egern 覆盖操作')
                elif action in {'replace','replace-regex'}:
                    raise ConversionError('Surge header-replace 仅修改已有头；Egern replace 会新增缺失头，尚不能等价映射')
                else:
                    raise ConversionError('header-del 不接受值')
            elif section == 'host':
                host, sep, value = line.partition('=')
                host, value = host.strip(), value.strip()
                if source_format != 'surge' or not sep or not host or not re.fullmatch(r'script:[^\s,=]+',value):
                    raise ConversionError('Host 当前仅支持 Surge 域名到 script:名称 的映射')
                hosts = result.setdefault('dns', {}).setdefault('hosts', {})
                if host in hosts:
                    raise ConversionError('重复的 DNS Host 映射')
                hosts[host] = [value]
            elif section == 'general' and line.partition('=')[0].strip().lower() == 'force-http-engine-hosts':
                _, value = line.split('=', 1)
                hosts = [host.strip() for host in re.sub(r'%(?:APPEND|INSERT)%', '', value).split(',')]
                if not hosts or any(not re.fullmatch(r'[A-Za-z0-9*?.-]+',host) for host in hosts):
                    raise ConversionError('force-http-engine-hosts 仅支持无端口的域名列表')
                force_http_hosts.extend(hosts)
            elif section == 'script' and source_format in {'surge', 'loon'}:
                if not scripts_native:
                    raise ConversionError('脚本需先适配 Egern ctx API，再使用 --scripts-native')
                if source_format == 'loon':
                    declaration = re.fullmatch(r'(http-request|http-response)\s+(\S+)\s+(.+)', line)
                    task = re.fullmatch(r'(cron|generic|network-changed)\s+(.*?)\bscript-path\s*=\s*(.+)', line)
                    if declaration:
                        options = script_options(declaration[3], loon_tags=True)
                        options['type'], options['pattern'] = declaration[1], declaration[2]
                    elif task:
                        options = script_options('script-path='+task[3], loon_tags=True)
                        options['type'] = task[1]
                        trigger = task[2].strip()
                        if task[1] == 'cron':
                            if not trigger:
                                raise ConversionError('Loon 定时脚本缺少 Cron 表达式')
                            if trigger.startswith('"'):
                                trigger = json.loads(trigger)
                            options['cron'] = trigger
                        elif trigger:
                            raise ConversionError('Loon 手动或网络变化脚本不接受匹配表达式')
                    else:
                        raise ConversionError('无效的经典 Loon 脚本声明')
                    name = options.pop('tag', '')
                    missing = referenced_keys(options) - set(result.get('compat_arguments', {}))
                    recover_parameters(options['script-path'],missing,number)
                    native_options = loon_bind(options, result.get('compat_arguments', {}))
                    if 'img-url' in options:
                        image = options.pop('img-url')
                        pending_comments.append('Loon script icon: '+image)
                        if normalizations is not None:
                            normalizations.append({'line':number,'parameter':'img-url','value':image,
                                'reason':'脚本列表展示图标保留为注释，不影响原生脚本调用'})
                    if 'cron' in options:
                        defaults = result.get('compat_arguments', {})
                        def cron_parameter(match):
                            key = match[1]
                            if not isinstance(defaults.get(key), str):
                                raise ConversionError('Cron 必须引用已声明字符串参数：'+key)
                            return '{{{'+key+'}}}'
                        options['cron'] = re.sub(r'\{([\w-]+)\}', cron_parameter, options['cron'])
                else:
                    name, options = line.split('=', 1)
                    options = script_options(options)
                dns_script = source_format == 'surge' and options.get('type','').strip() == 'dns'
                task_script = options.get('type','').strip() in {'cron','generic','network-changed'}
                if source_format == 'surge' and options.get('type','').strip() == 'cron':
                    options['cron'] = options.pop('cronexp', '')
                    if not options['cron'].strip():
                        raise ConversionError('Surge 定时脚本缺少 cronexp')
                allowed = {'type', 'script-path', 'timeout', 'argument', 'engine'} if dns_script else ({'type', 'script-path', 'timeout', 'argument', 'cron'} if task_script else {'type', 'pattern', 'script-path', 'requires-body', 'binary-body-mode', 'timeout', 'max-size', 'argument'})
                allowed.update({'_env','_disabled'})
                if source_format == 'surge':
                    allowed.add('script-update-interval')
                if set(options) - allowed:
                    raise ConversionError('存在未支持的脚本参数')
                if dns_script and options.get('engine','jsc').strip() != 'jsc':
                    raise ConversionError('DNS 脚本仅支持 jsc 引擎')
                kind = 'generic' if dns_script else {'http-request': 'http_request', 'http-response': 'http_response', 'cron':'schedule', 'generic':'generic', 'network-changed':'network'}[options['type'].strip()]
                data = {'name': name.strip(), 'script_url': options['script-path'].strip()}
                if kind in {'http_request','http_response'}:
                    data['match'] = options['pattern'].strip()
                if task_script:
                    data['timeout'] = 300
                    if kind == 'schedule':
                        data['cron'] = options['cron']
                if source_format == 'loon':
                    data.update({'_native_options':native_options} if native_options else {})
                    if options.get('_disabled'):
                        data['disabled'] = True
                    if options.get('_env'):
                        data['env'] = options['_env']
                if options.get('_disabled') in (True, 'true'):
                    data['disabled'] = True
                if 'argument' in options:
                    data.setdefault('env', {})['argument'] = options['argument']
                if 'script-update-interval' in options:
                    interval = int(options['script-update-interval'])
                    if interval < 0:
                        raise ConversionError('脚本更新间隔不能为负数')
                    data['update_interval'] = interval
                for old, new in [('requires-body', 'body_required'), ('binary-body-mode', 'binary_body')]:
                    if old in options:
                        if options[old].strip() not in {'true', 'false', '1', '0'}:
                            raise ConversionError(f'无效布尔参数：{old}')
                        data[new] = options[old].strip() in {'true', '1'}
                for old, new in [('timeout', 'timeout'), ('max-size', 'max_size')]:
                    if old in options:
                        value = int(options[old].strip())
                        # Egern has a finite body buffer; document the cap in converted entries.
                        data[new] = 16 * 1024 * 1024 if old == 'max-size' and value <= 0 else value
                result.setdefault('scriptings', []).append({kind: data})
            else:
                raise ConversionError(f'不支持的配置段 [{section}]')
        except (ValueError, KeyError, IndexError) as exc:
            diagnostics.append({'line':number, 'section':declared_section, 'text':line, 'reason':str(exc)})
        finally:
            additions = [entry for field,values in result.items() if isinstance(values, list) for entry in values[previous_sizes.get(field,0):]]
            if result.get('mitm') is not previous_mitm:
                additions.append(result['mitm'])
            if pending_comments and additions:
                result.annotations.append((additions[0], pending_comments[:]))
            pending_comments = []
            section=declared_section
    if diagnostics:
        # Reject the complete module, but report every broken declaration in one run.
        # Continuing the scan is diagnostic only; no partial configuration is returned.
        error=ConversionError('\n'.join(f'第 {row["line"]} 行：{row["reason"]} — {row["text"]}' for row in diagnostics), diagnostics=diagnostics)
        error.normalizations=list(normalizations or [])
        raise error
    undeclared = set(re.findall(r'\{\{\{([^{}]+)\}\}\}', text)) - set(result.get('compat_arguments', {}))
    if undeclared:
        raise ConversionError('未声明的模块参数：' + ', '.join(sorted(undeclared)))
    assign_script_names(result)
    dns_names = [entry['generic']['name'] for entry in result.get('scriptings',[]) if 'generic' in entry]
    if len(dns_names) != len(set(dns_names)):
        raise ConversionError('重复的 DNS 脚本名称')
    for values in result.get('dns',{}).get('hosts',{}).values():
        if any(value.removeprefix('script:') not in dns_names for value in values):
            raise ConversionError('DNS Host 引用了未声明的 DNS 脚本')
    if force_http_hosts and not (result.get('url_rewrites') or result.get('rewrites') or result.get('header_rewrites') or header_actions or result.get('scriptings')):
        raise ConversionError('HTTP 引擎指令没有关联 HTTP 处理规则，无法转换为独立功能')
    mocks = result.pop('_mock_actions', [])
    assign_script_names(result)
    validate_module(dict(result, scriptings=result.get('scriptings', [])) if header_actions or mocks else result)
    if mocks:
        result['_mock_actions'] = mocks
    if header_actions:
        result['_header_actions'] = header_actions
    return result


MODULE_FIELDS = {'name', 'description', 'author', 'homepage', 'manual', 'icon', 'open_url',
                 'compat_arguments', 'compat_arguments_desc', 'compat_arguments_schema', 'env_schema', 'dns', 'rules',
                 'url_rewrites', 'header_rewrites', 'body_rewrites', 'rewrites', 'map_locals', 'scriptings',
                 'mitm', 'http_captures', 'widgets', 'bypass_tunnel_proxy', 'real_ip_domains'}


def validate_module(obj):
    if not isinstance(obj, dict) or set(obj) - MODULE_FIELDS:
        raise ConversionError('模块必须是 Egern 配置对象，且不能包含未知顶层字段')
    if not set(obj) & (MODULE_FIELDS - {'name', 'description', 'author', 'homepage', 'manual', 'icon',
                                      'open_url', 'compat_arguments', 'compat_arguments_desc', 'compat_arguments_schema', 'env_schema'}):
        raise ConversionError('模块无有效配置内容')
    for field in {'rules', 'url_rewrites', 'rewrites', 'scriptings', 'map_locals', 'header_rewrites', 'body_rewrites', 'widgets'} & set(obj):
        if not isinstance(obj[field], list):
            raise ConversionError(f'{field} 必须是数组')
    for row in obj.get('rewrites',[]):
        if not isinstance(row,dict) or not isinstance(row.get('match'),str) or not isinstance(row.get('actions'),list) or not row['actions']:
            raise ConversionError('rewrites 条目必须包含 match 和非空 actions 数组')
        if any(not isinstance(action,dict) or len(action)!=1 for action in row['actions']):
            raise ConversionError('rewrites 每个 action 必须是单动作对象')
    for widget in obj.get('widgets', []):
        if not isinstance(widget, dict) or not isinstance(widget.get('name'), str) or not widget['name'].strip():
            raise ConversionError('小组件必须声明非空 name')


def dump(obj):
    text = yaml.safe_dump(dict(obj), allow_unicode=True, sort_keys=False, width=110)
    return render_annotations(obj, text)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('kind', choices=['rules', 'module'])
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--format', default='surge')
    parser.add_argument('--scripts-native', action='store_true')
    args = parser.parse_args()
    text = args.input.read_text(encoding='utf-8')
    obj = convert_rules(text, args.format) if args.kind == 'rules' else convert_module(text, args.format, args.scripts_native)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(dump(obj), encoding='utf-8')


if __name__ == '__main__':
    main()


def canonical_script_url(url):
    """Normalize equivalent original GitHub raw endpoints, never different paths."""
    url = re.sub(r'^https://github\.com/([^/]+/[^/]+)/raw/', r'https://raw.githubusercontent.com/\1/', url)
    return re.sub(r'^(https://raw.githubusercontent.com/[^/]+/[^/]+)/refs/heads/', r'\1/', url)


def module_from_script(text, item, *, configuration=False):
    """Extract reviewed QX rewrite declarations from a script's leading comment."""
    rest = text.lstrip('\ufeff \t\r\n')
    comments = []
    while rest.startswith(('/*', '//')):
        if rest.startswith('/*'):
            end = rest.find('*/', 2)
            if end < 0:
                break
            comments.append(rest[2:end]); rest = rest[end+2:].lstrip()
        else:
            group = []
            while rest.startswith('//'):
                line, _, rest = rest.partition('\n')
                group.append(line[2:]); rest = rest.lstrip()
            comments.append('\n'.join(group))
    if configuration:
        if not re.search(r'(?m)^\s*\[rewrite_local\]\s*$', text):
            configured = ['[rewrite_local]']
            for raw in text.splitlines():
                if raw.strip().startswith('hostname'):
                    configured.append('[mitm]')
                elif re.match(r'\s*\S+\s+url\s+', raw):
                    configured.append('[rewrite_local]')
                configured.append('# '+raw if raw.strip().startswith('来源http') else raw)
            text = '\n'.join(configured)
        comments = [text]
    if not comments:
        raise ConversionError('脚本缺少开头的配置注释')
    lines = [f"#!name={item['name']}", f"#!author={item['author']}"]
    section, count = '', 0
    previous = None
    for block, raw in ((index, line) for index, comment in enumerate(comments) for line in comment.splitlines()):
        if block != previous:
            section, previous = '', block
        line = raw.strip().removeprefix('*').strip()
        if line.startswith('[') and line.endswith(']'):
            section = line[1:-1].lower()
            if section not in {'rewrite_local', 'task_local', 'mitm', 'filter_local', 'script', 'url rewrite', 'rule'}:
                raise ConversionError(f'脚本注释包含未支持的配置段 {section}')
            continue
        if not line or (line.startswith(('#', '//', '*')) and not line.startswith('#!')):
            continue
        if line.startswith('#!'):
            lines.append(line)
        elif section in {'script', 'url rewrite', 'rule'}:
            lines.extend(['[' + section + ']', line])
            if section == 'script':
                count += 1
        elif section == 'mitm':
            lines.extend(['[MITM]', line])
        elif section == 'filter_local':
            parts = [part.strip() for part in line.split(',')]
            if len(parts) != 3 or parts[0].lower() != 'host' or parts[2].lower() != 'reject':
                raise ConversionError('filter_local 只支持明确的 host,reject 规则')
            kind = 'DOMAIN-WILDCARD' if '*' in parts[1] or '?' in parts[1] else 'DOMAIN'
            lines.extend(['[Rule]', f'{kind},{parts[1]},REJECT'])
        elif section == 'task_local':
            task = re.fullmatch(r'(.+?)\s+(https?://[^\s,]+)\s*(?:,\s*(.*))?', line)
            if not task:
                raise ConversionError('无效的 Quantumult X 定时任务声明')
            options = script_options(task[3], loon_tags=True) if task[3] else {}
            unknown = set(options) - {'tag','enabled','timeout','img-url','argument'}
            if unknown:
                raise ConversionError('未支持的 Quantumult X 定时参数：'+','.join(sorted(unknown)))
            settings = {'type':'cron','cronexp':task[1], 'script-path':urljoin(item.get('url',''),task[2])}
            if 'enabled' in options:
                if options['enabled'].lower() not in {'true','false'}:
                    raise ConversionError('无效定时任务 enabled')
                settings['_disabled'] = options['enabled'].lower() == 'false'
            for key in ('timeout','argument'):
                if key in options:settings[key]=options[key]
            # Convert through the same native schedule path as Surge tasks.
            encoded = ','.join(key+'='+json.dumps(value,ensure_ascii=False) for key,value in settings.items())
            lines.extend(['[Script]',f'{options.get("tag", "script"+str(count))} = '+encoded])
            count += 1
        elif section == 'rewrite_local':
            parts = line.split()
            if len(parts) == 4 and parts[1] == 'url' and parts[2] in {'script-response-body', 'script-request-body', 'script-request-header', 'script-response-header'}:
                declared_url = urljoin(item.get('url', ''), parts[3])
                registered = next((url for url in item.get('script_map', {}) if canonical_script_url(url) == canonical_script_url(declared_url)), None)
                if registered is None:
                    raise ConversionError('注释引用不同路径的关联脚本，不能替换为当前文件：' + parts[3])
                phase = 'http-response' if 'response' in parts[2] else 'http-request'
                body = int(parts[2].endswith('-body'))
                lines.extend(['[Script]', f'script{count} = type={phase}, pattern={parts[0]}, requires-body={body}, max-size=16777216, script-path={registered}'])
                count += 1
            else:
                lines.extend(['[URL Rewrite]', line])
    if not count and not configuration:
        raise ConversionError('脚本注释没有可转换的脚本声明')
    result = convert_module('\n'.join(lines), 'surge', scripts_native=True)
    for declaration in result.get('scriptings', []):
        options = next(iter(declaration.values()))
        declared = canonical_script_url(urljoin(item.get('url', ''), options['script_url']))
        registered = next((url for url in item.get('script_map', {}) if canonical_script_url(url) == declared), None)
        if registered is None:
            raise ConversionError('配置引用不同路径的关联脚本，需独立适配：' + options['script_url'])
        options['script_url'] = registered
    return result
