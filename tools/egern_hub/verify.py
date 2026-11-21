"""Differential validation using maintained fixtures and automatic input probes."""
import argparse
import copy
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import hashlib
import gzip
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from urllib.parse import urlsplit
import zlib

import yaml

from .layout import read_source
from .js_analysis import analyze_many, emit_progress
from .verification_probes import generated_cases
from .device_parameters import device_cases

ROOT = Path(__file__).resolve().parents[2]
HEADER_METHOD_ERROR = re.compile(r'(?:entries|getAll|keys|values|forEach|has)[^\n]{0,120}?is not a function')
_HEADER_METHOD_CACHE = {}
COMPRESSION_MEMBERS = ('gzip', 'gunzip', 'ungzip', 'deflate', 'inflate', 'brotli', 'unbrotli')
COMPRESSION_SOURCE = re.compile(r'\$utils\.(?:' + '|'.join(COMPRESSION_MEMBERS) + r')\b')


def calls_unverified_header_method(source):
    """复用编译器的 Headers 污点检查，避免把普通集合方法误判为宿主缺失。"""
    digest = hashlib.sha256(source.encode()).hexdigest()
    if digest in _HEADER_METHOD_CACHE:
        return _HEADER_METHOD_CACHE[digest]
    runner = ROOT / 'tools/js-analysis/check.mjs'
    try:
        result = subprocess.run(['node', str(runner), '--header-calls'], input=source, capture_output=True, text=True, timeout=5)
        verdict = result.returncode != 0
    except (OSError, subprocess.TimeoutExpired):
        # 检查本身不可用时保持原有保守判定，不能把可能存在的宿主调用当成安全。
        verdict = True
    if len(_HEADER_METHOD_CACHE) >= 64:
        _HEADER_METHOD_CACHE.clear()
    _HEADER_METHOD_CACHE[digest] = verdict
    return verdict


def brotli_samples(payloads):
    """Return brotli round-trip vectors without trusting or executing source code."""
    script = r"""
const fs=require('node:fs'),z=require('node:zlib');
const rows=JSON.parse(fs.readFileSync(0,'utf8'));
const output=rows.map(input=>{
  const data=Buffer.from(input);
  const compressed=z.brotliCompressSync(data);
  let decompressed=null;
  try{decompressed=[...z.brotliDecompressSync(data)];}catch{}
  return {input:[...data],compressed:[...compressed],decompressed};
});
process.stdout.write(JSON.stringify(output));
"""
    try:
        result = subprocess.run(['node', '-e', script], input=json.dumps([list(data) for data in payloads]),
                                capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return []
    if result.returncode:
        return []
    try:
        rows = json.loads(result.stdout)
        return [(bytes(row['input']), bytes(row['compressed']),
                 None if row['decompressed'] is None else bytes(row['decompressed'])) for row in rows]
    except (KeyError, TypeError, ValueError):
        return []


def compression_vectors(fixture):
    """Compute bounded binary API samples without executing the input script."""
    vectors = list(fixture.get('compression', []))
    seen = {(v['method'], tuple(v['input'])) for v in vectors}
    payloads = []
    for message in (fixture.get('request', {}), fixture.get('response', {})):
        data = bytes(message['bytes']) if 'bytes' in message else str(message.get('body') or '').encode('utf-8')
        if len(data) <= 1024 * 1024:
            payloads.append(data)
    # One round of derived streams covers gzip/deflate/brotli round trips. No
    # upstream expressions, live network, or callable host objects enter the VM.
    for raw in list(payloads):
        payloads.extend((gzip.compress(raw, mtime=0), zlib.compress(raw)))
    payloads = list(dict.fromkeys(payloads))
    brotli_compressed, brotli_decompressed = {}, {}
    for source, compressed, decompressed in brotli_samples(payloads):
        brotli_compressed[source] = compressed
        brotli_decompressed[source] = decompressed
        if compressed not in payloads:
            payloads.append(compressed)
        brotli_decompressed.setdefault(compressed, source)
    for data in payloads:
        operations = {'gzip': lambda data=data: gzip.compress(data, mtime=0),
                      'deflate': lambda data=data: zlib.compress(data)}
        if data in brotli_compressed:
            operations['brotli'] = lambda data=data: brotli_compressed[data]
        if data in brotli_decompressed:
            operations['unbrotli'] = lambda data=data: brotli_decompressed[data]
        for method, window in [('gunzip', 31), ('inflate', 15)]:
            try:
                decoder = zlib.decompressobj(window)
                output = decoder.decompress(data, 1024 * 1024 + 1)
                if decoder.eof and not decoder.unconsumed_tail and len(output) <= 1024 * 1024:
                    operations[method] = lambda output=output: output
            except zlib.error:
                operations[method] = lambda: None
        for method, operation in operations.items():
            identity = method, tuple(data)
            if identity not in seen:
                output = operation()
                vectors.append({'method': method, 'input': list(data), 'output': None if output is None else list(output)})
                seen.add(identity)
    return vectors


def execute(source, platform, url, fixture, side):
    runner = ROOT/'tools/js-analysis/verify.mjs'
    if side == 'original' and 'original_timers' in fixture:
        fixture = {**fixture, 'timers': fixture['original_timers']}
    if COMPRESSION_SOURCE.search(source) or '.compress' in source:
        fixture = {**fixture, 'compression': compression_vectors(fixture)}
    payload = {'source':source, 'platform':platform, 'url':url, 'fixture':fixture, 'side':side}
    # Fresh process and VM realm per side/case; no host env, imports or live HTTP.
    # Node VM is not an OS security boundary. See docs/verification.md.
    with tempfile.TemporaryDirectory(prefix='egern-verify-') as temp:
        try:
            result = subprocess.run(['node', '--experimental-vm-modules', '--max-old-space-size=128', str(runner)],
                input=json.dumps(payload), capture_output=True, text=True, timeout=5, cwd=temp,
                env={key:os.environ[key] for key in ('PATH','SystemRoot') if key in os.environ})
        except (OSError, subprocess.TimeoutExpired) as exc:
            return {'error':type(exc).__name__}
    if result.returncode:
        return {'error':'验证子进程退出，退出码 '+str(result.returncode)}
    try:
        return json.loads(result.stdout)
    except ValueError:
        return {'error':'验证子进程未返回有效 JSON'}


def differences(left, right, path='$', *, partial=False):
    """Return field paths only, never copy credentials or response bodies to reports."""
    if isinstance(left,dict) and isinstance(right,dict):
        keys = set(left) if partial else set(left)|set(right)
        result = []
        for key in sorted(keys):
            p = path+'.'+key
            if key not in left or key not in right:
                result.append(p)
            else:
                result += differences(left[key],right[key],p,partial=partial)
        return result[:40]
    if isinstance(left,list) and isinstance(right,list):
        if len(left)!=len(right):
            return [path+'.length']
        return [p for i,(a,b) in enumerate(zip(left,right)) for p in differences(a,b,f'{path}[{i}]',partial=partial)][:40]
    return [] if type(left)==type(right) and left==right else [path]


def compare(source, converted, platform, url, fixture, *, native_evaluation=()):
    original = execute(source,platform,url,fixture,'original')
    native = execute(converted,platform,url,fixture,'converted')
    result = {'name':fixture['name'], 'status':'passed', 'differences':[], 'expected_checked':'expected' in fixture,
              'origin':fixture.get('origin','curated')}
    if fixture.get('generation'):
        result['generation']=fixture['generation']
    for label, value in [('original',original),('converted',native)]:
        if value.get('error'):
            result[label+'_error'] = value['error'][:240]
    preserved_evaluation = any(isinstance(item,dict) and item.get('preserved') is True
                               for item in (native_evaluation or []))
    blocked_evaluation = any('Code generation from strings disallowed for this context' in str(value.get('error',''))
                             for value in (original,native))
    if fixture.get('native_evaluation') is not True and preserved_evaluation and blocked_evaluation:
        result.update(status='inconclusive', reason='原生 eval/Function 已静态确认为保留调用，但该样例未启用字符串代码执行')
        return result
    if original.get('fixture_error'):
        result.update(status='inconclusive', reason='API 样例缺失或输入不匹配')
    elif original.get('error'):
        result['status'] = 'original_error'
    elif native.get('error'):
        result['status'] = 'converted_error'
    elif original.get('fixture_error') or original.get('unused_http'):
        result.update(status='inconclusive', reason='HTTP 样例缺失、URL 不匹配或未全部消费')
    elif native.get('fixture_error') or native.get('unused_http'):
        result.update(status='mismatch',differences=['$.events.requests'],reason='原侧已完整消费 HTTP 样例，转换侧的请求不一致')
    else:
        result['differences'] = differences(original['observation'],native['observation'])
        if result['differences']:
            result['status'] = 'mismatch'
        if 'expected' in fixture:
            expected_differences = differences(fixture['expected'], original['observation'], partial=True)
            if expected_differences:
                result.update(status='expectation_failed', expected_differences=expected_differences)
        observed=original['observation']
        eventful=any(observed.get('events',{}).get(k) for k in ('requests','storageWrites','notifications'))
        message=fixture.get('response',fixture['request'])
        changed=observed.get('mode')!='modify' or eventful
        for key,value in observed.get('result',{}).items():
            previous=message.get(key)
            if key=='body' and isinstance(value,str) and isinstance(previous,str):
                try:value,previous=json.loads(value),json.loads(previous)
                except ValueError:pass
            if value!=previous:changed=True
        result['observable_change']=changed
    # 两边以同一 TypeError 失败并不等于等价：真机 Headers 缺失这些方法时，
    # 原始脚本与产物会同步报错，反而会掩盖不兼容实现。必须显式判为失败。
    if (original.get('error') and native.get('error') and original.get('error')==native.get('error')
            and HEADER_METHOD_ERROR.search(original['error'])
            and calls_unverified_header_method(converted)):
        result.update(status='header_method_error', reason='原脚本和转换产物都调用了真机 Headers 不存在的方法')
    return result


def validate_fixtures(folder):
    fixtures = {}
    for path in sorted(Path(folder).rglob('*.json')):
        data = json.loads(path.read_text(encoding='utf-8'))
        if data.get('version')!=1 or not isinstance(data.get('script_url'),str) or not isinstance(data.get('cases'),list) or not data['cases']:
            raise ValueError(str(path)+': 需要 version:1、script_url 和非空 cases')
        if data['script_url'] in fixtures:
            raise ValueError('脚本存在重复样例文件：'+data['script_url'])
        names = set()
        for case in data['cases']:
            if not isinstance(case,dict) or not isinstance(case.get('name'),str) or not case['name'] or case['name'] in names:
                raise ValueError(str(path)+': 每个 case 需要唯一 name')
            names.add(case['name'])
            if 'native_evaluation' in case and not isinstance(case['native_evaluation'],bool):
                raise ValueError(str(path)+': native_evaluation 必须为布尔值')
            if 'entry_type' in case and case['entry_type'] not in ('http_request','http_response','schedule','generic','network'):
                raise ValueError(str(path)+': entry_type 必须为有效的 Egern 脚本阶段')
            if not isinstance(case.get('request'),dict) or not isinstance(case['request'].get('url'),str):
                raise ValueError(str(path)+': 每个 case 需要 request.url')
            if 'response' in case and not isinstance(case['response'],dict):
                raise ValueError(str(path)+': response 必须为对象；请求脚本请省略 response')
            if 'expected' in case and not isinstance(case['expected'],dict):
                raise ValueError(str(path)+': expected 必须是观测对象的子集')
            for field in ('timers','original_timers'):
                if field in case and (not isinstance(case[field],list) or len(case[field])>100 or
                        any(type(delay) is not int or not 0<=delay<=600000 for delay in case[field])):
                    raise ValueError(str(path)+': '+field+' 必须为最多 100 个 0..600000 毫秒的整数延时')
        fixtures[data['script_url']] = data['cases']
    return fixtures


def replay_case(source, platform, url, case):
    """Discover at most four HTTP calls locally, then freeze synthetic responses.

    No requests leave the VM. Discovery uses only the original; final comparison
    re-runs both sides from scratch with identical, URL-checked fixed responses.
    """
    fixture=copy.deepcopy(case)
    fixture['name']+='-http-replay'
    fixture['generation']['payload']='synthetic-http-replay'
    fixture['http']=[]
    body=fixture.get('response',fixture['request']).get('body','{}')
    for _ in range(5):
        observed=execute(source,platform,url,fixture,'original')
        if observed.get('error') and not observed.get('fixture_error'):return None
        if not observed.get('fixture_error'):
            return fixture if fixture['http'] and not observed.get('unused_http') else None
        requests=observed.get('observation',{}).get('events',{}).get('requests',[])
        if len(requests)<=len(fixture['http']) or len(requests)>4:return None
        for request in requests[len(fixture['http']):]:
            # Generated inputs may not initialize the account's endpoint. A
            # missing/dynamic URL cannot establish a fixed replay contract.
            endpoint=request.get('url') if isinstance(request,dict) else None
            if not isinstance(endpoint,str) or not endpoint.strip():return None
            fixture['http'].append({'url':endpoint,'status':200,
                                   'headers':{'Content-Type':'application/json'},'body':body})
    return None

OFFICIAL_REJECTS = frozenset({
    'http://reject/', 'http://reject-200/', 'http://reject-dict/',
    'http://reject-array/', 'http://reject-img/', 'http://reject-video/',
})
REDIRECT_CODES = frozenset({301, 302, 307, 308})
MISSING = object()
_INLINE_FLAGS = re.compile(r'\(\?[aiLmsuxU-]+([:)])')


def is_anchored(match):
    """`^`、`\\A` 或行内模式组内的开头锚点都视为已锚定。"""
    if not isinstance(match, str):
        return False
    text = match
    while True:
        if text.startswith('^') or text.startswith('\\A'):
            return True
        group = _INLINE_FLAGS.match(text)
        if not group:
            return False
        if group.group(1):
            return text[group.end():].startswith('^')
        text = text[group.end():]


def _module_loader():
    class Loader(yaml.SafeLoader):
        pass
    Loader.add_constructor('tag:yaml.org,2002:value',
                           lambda loader, node: loader.construct_scalar(node))
    return Loader


_SENTINEL = re.compile(
    r'(?m)^([ \t]*[^#\s][^:\n]*:[ \t]*)\{\{\{[^{}\n]+\}\}\}([ \t]*(?:#.*)?)$')


def parse_module_yaml(text):
    if not isinstance(text, str):
        return text
    return yaml.load(_SENTINEL.sub(
        lambda row: row.group(1) + '"__egern_template_value__"' + row.group(2), text),
        Loader=_module_loader())


def iter_matches(obj):
    """枚举所有声明式 match，保持输出顺序便于定位。"""
    for index, row in enumerate(obj.get('url_rewrites') or []):
        if isinstance(row, dict):
            yield 'url_rewrites', index, row.get('match'), row
    for index, row in enumerate(obj.get('rewrites') or []):
        if isinstance(row, dict):
            yield 'rewrites', index, row.get('match'), row
    for index, row in enumerate(obj.get('header_rewrites') or []):
        if not isinstance(row, dict):
            continue
        for action in ('add', 'delete', 'replace'):
            entry = row.get(action)
            if isinstance(entry, dict):
                yield 'header_rewrites.' + action, index, entry.get('match'), entry
    for index, row in enumerate(obj.get('body_rewrites') or []):
        if not isinstance(row, dict):
            continue
        for phase, entry in row.items():
            if phase in {'request_jq', 'response_jq', 'request_regex', 'response_regex'} \
                    and isinstance(entry, dict):
                yield 'body_rewrites.' + phase, index, entry.get('match'), entry
    for index, row in enumerate(obj.get('map_locals') or []):
        if isinstance(row, dict):
            yield 'map_locals', index, row.get('match'), row
    for index, row in enumerate(obj.get('scriptings') or []):
        if not isinstance(row, dict):
            continue
        for phase, entry in row.items():
            if phase in {'http_request', 'http_response'} and isinstance(entry, dict):
                yield 'scriptings.' + str(phase), index, entry.get('match'), entry


def iter_jq_filters(obj):
    """返回所有 request_jq/response_jq 的 filter，包括原生 rewrites 动作。"""
    for index, row in enumerate(obj.get('body_rewrites') or []):
        if not isinstance(row, dict):
            continue
        for phase in ('request_jq', 'response_jq'):
            entry = row.get(phase)
            if isinstance(entry, dict) and isinstance(entry.get('filter'), str):
                yield f'body_rewrites.{phase}[{index}]', entry['filter']
    for index, row in enumerate(obj.get('rewrites') or []):
        if not isinstance(row, dict):
            continue
        for action_index, action in enumerate(row.get('actions') or []):
            if not isinstance(action, dict):
                continue
            for phase in ('request_body', 'response_body'):
                value = action.get(phase)
                if isinstance(value, dict) and isinstance(value.get('jq'), str):
                    yield f'rewrites[{index}].actions[{action_index}].{phase}.jq', value['jq']


def jq_parses(filter_text, executable='jq'):
    """用 jq 编译过滤器；返回 (ok, returncode, stderr)。jq 缺失时 ok=None。"""
    if not shutil.which(executable):
        return None, None, f'{executable} 不可用'
    result = subprocess.run([executable, '-n', '-c', filter_text],
                            text=True, capture_output=True, timeout=20)
    # jq 退出码 3 是编译错误；5 等运行错误不影响语法合法性。
    return result.returncode != 3, result.returncode, result.stderr.strip()


def location_is_valid(location):
    """校验重定向目标；`$n` 捕获引用和模块参数模板属于合法写法。"""
    if not isinstance(location, str) or not location:
        return False
    if location in OFFICIAL_REJECTS:
        return True
    if re.match(r'https?://reject', location):
        # token 合法性由 reject 检查单独报告，避免同一问题重复计数。
        return True
    captures = bool(re.search(r'\$\d+', location))
    expanded = re.sub(r'\{\{\{[^{}]+\}\}\}', 'placeholder', location)
    expanded = re.sub(r'\$\d+', 'capture', expanded)
    # 捕获组可以位于 URL 开头，也可能自身拼出完整 URL。
    if captures and '://' not in expanded:
        return not re.search(r'\s', location)
    try:
        parsed = urlsplit(expanded)
    except ValueError:
        return False
    return parsed.scheme in {'http', 'https'} and bool(parsed.netloc)


def validate_declarative_module(obj, *, jq_executable='jq', check_anchors=True):
    """静态校验单个模块；返回发现列表，不修改输入。"""
    findings = []
    if not isinstance(obj, dict):
        return findings
    for section, index, match, entry in iter_matches(obj):
        if not isinstance(match, str) or not match:
            findings.append({'kind': 'match', 'section': section, 'index': index,
                             'value': match, 'message': 'match 必须是非空字符串'})
            continue
        if check_anchors and not is_anchored(match):
            findings.append({'kind': 'unanchored', 'section': section, 'index': index,
                             'value': match, 'message': 'match 未以 ^ 锚定'})
        if section == 'url_rewrites':
            location = entry.get('location')
            if not location_is_valid(location):
                findings.append({'kind': 'location', 'section': section, 'index': index,
                                 'value': location, 'message': 'location 不是合法 URL、官方 reject 或捕获模板'})
            if re.match(r'https?://reject', location or '') \
                    and location not in OFFICIAL_REJECTS:
                findings.append({'kind': 'reject', 'section': section, 'index': index,
                                 'value': location, 'message': '非官方 reject token'})
            status = entry.get('status_code', MISSING)
            if status is not MISSING and status not in REDIRECT_CODES:
                findings.append({'kind': 'status', 'section': section, 'index': index,
                                 'value': status, 'message': 'redirect status_code 非法'})
    for path, filter_text in iter_jq_filters(obj):
        ok, returncode, error = jq_parses(filter_text, jq_executable)
        if ok is False:
            findings.append({'kind': 'jq', 'section': path, 'index': None,
                             'value': filter_text, 'message': f'jq 编译失败（{returncode}）：{error[:160]}'})
        elif ok is None:
            findings.append({'kind': 'jq-missing', 'section': path, 'index': None,
                             'value': '', 'message': error})
    for index, row in enumerate(obj.get('header_rewrites') or []):
        if not isinstance(row, dict):
            findings.append({'kind': 'header', 'section': 'header_rewrites', 'index': index,
                             'value': row, 'message': 'header_rewrites 条目必须是对象'})
            continue
        actions = [name for name in ('add', 'delete', 'replace') if name in row]
        if len(actions) != 1:
            findings.append({'kind': 'header', 'section': 'header_rewrites', 'index': index,
                             'value': row, 'message': 'header_rewrites 条目必须恰好包含一个动作'})
            continue
        action = actions[0]
        data = row[action]
        if not isinstance(data, dict) or not isinstance(data.get('match'), str) \
                or not isinstance(data.get('name'), str) or not data.get('name'):
            findings.append({'kind': 'header', 'section': 'header_rewrites', 'index': index,
                             'value': row, 'message': 'header action 缺少 match/name'})
            continue
        if data.get('type', 'request') not in {'request', 'response'}:
            findings.append({'kind': 'header', 'section': 'header_rewrites', 'index': index,
                             'value': row, 'message': 'header type 必须是 request 或 response'})
        if action in {'add', 'replace'} and not isinstance(data.get('value'), str):
            findings.append({'kind': 'header', 'section': 'header_rewrites', 'index': index,
                             'value': row, 'message': 'header add/replace 缺少字符串 value'})
    return findings


def validate_product_quality(resources, *, jq_executable='jq'):
    """审计整个模块产物；调用方决定锚点问题是否阻断。"""
    report = {'modules': 0, 'parsed': 0, 'matches': {}, 'unanchored': {},
              'jq_total': 0, 'findings': []}
    for resource in resources:
        if not isinstance(resource, dict) or resource.get('kind') != 'modules':
            continue
        report['modules'] += 1
        try:
            obj = resource.get('_module') or parse_module_yaml(resource.get('yaml', ''))
        except yaml.YAMLError as exc:
            report['findings'].append({'kind': 'yaml', 'section': 'module',
                                       'index': None, 'value': resource.get('id', ''),
                                       'message': str(exc)[:200]})
            continue
        if not isinstance(obj, dict):
            report['findings'].append({'kind': 'yaml', 'section': 'module',
                                       'index': None, 'value': resource.get('id', ''),
                                       'message': '模块不是对象'})
            continue
        report['parsed'] += 1
        for section, index, match, entry in iter_matches(obj):
            report['matches'][section] = report['matches'].get(section, 0) + 1
            if not is_anchored(match):
                report['unanchored'][section] = report['unanchored'].get(section, 0) + 1
        report['jq_total'] += sum(1 for _ in iter_jq_filters(obj))
        for finding in validate_declarative_module(obj, jq_executable=jq_executable,
                                                   check_anchors=False):
            report['findings'].append(dict(finding, module=resource.get('id', '')))
    report['jq_bad'] = sum(1 for row in report['findings'] if row['kind'] == 'jq')
    report['jq_missing'] = sum(1 for row in report['findings'] if row['kind'] == 'jq-missing')
    report['yaml_bad'] = sum(1 for row in report['findings'] if row['kind'] == 'yaml')
    report['match_bad'] = sum(1 for row in report['findings'] if row['kind'] == 'match')
    report['reject_bad'] = sum(1 for row in report['findings'] if row['kind'] == 'reject')
    report['location_bad'] = sum(1 for row in report['findings'] if row['kind'] == 'location')
    report['status_bad'] = sum(1 for row in report['findings'] if row['kind'] == 'status')
    report['header_bad'] = sum(1 for row in report['findings'] if row['kind'] == 'header')
    report['unanchored_total'] = sum(report['unanchored'].values())
    report['declarative_unanchored'] = sum(
        count for section, count in report['unanchored'].items()
        if not section.startswith('scriptings.'))
    return report


def verify_scripts(scripts, fetched, generated, fixture_dir=None, *, auto=True):
    fixtures = validate_fixtures(fixture_dir) if fixture_dir else {}
    progress_items=([{'kind':'script','stage':'verification_probes','id':script['id'],'url':script['url'],
                      'index':index,'total':len(scripts)} for index,script in enumerate(scripts,1)]
                    if auto and os.environ.get('EGERN_PROGRESS_EVENTS')=='1' else None)
    hints=analyze_many([(s.get('_verification_source',fetched[s['id']]),'any') for s in scripts],mode='probes',progress_items=progress_items) if auto else [{} for _ in scripts]
    def stages(script):
        return set(script.get('entry_types') or [context['stage'] for context in script.get('verification_contexts',[]) if context.get('stage')])
    def applicable(case, script):
        declared=stages(script)
        return not declared or not case.get('entry_type') or case['entry_type'] in declared
    def verify_one(job):
        script,hint=job
        identity,url = script['id'],script['url']
        emit_progress({'kind':'verification','stage':'started','id':identity,'url':url})
        source = script.get('_verification_source',fetched[identity])
        platform = script.get('_verification_format',script.get('source_format','surge'))
        if script.get('native_options',{}).get('enabled_env'):
            source = 'if ($environment.variables._hub_enabled === "false") $done({});\n' + source
        curated=[case for case in fixtures.get(url,[]) if applicable(case,script)]
        excluded=[{'name':case['name'],'entry_type':case['entry_type'],'reason':'不属于该转换版本的脚本入口'} for case in fixtures.get(url,[]) if not applicable(case,script)]
        probe_cases=(generated_cases(hint,script.get('verification_contexts',[]))
                     if auto and not hint.get('probe_skipped') else [])
        cases = copy.deepcopy(curated) + probe_cases
        if script.get('device_type_parameter'):
            cases = device_cases(cases)
        if platform == 'surge':
            for case in cases:
                if isinstance(case.get('argument'),dict):
                    case['argument']=json.dumps(case['argument'],separators=(',',':'))
        elif script.get('native_options',{}).get('argument_object'):
            for case in cases:
                if isinstance(case.get('argument'),str):
                    try: case['argument']=json.loads(case['argument'])
                    except ValueError: pass
        def compare_case(case):
            emit_progress({'kind':'verification','stage':'case_started','id':identity,'url':url,'name':case['name']})
            result=compare(source,generated[identity],platform,url,
                           dict(case,binary=script.get('binary',False)),
                           native_evaluation=script.get('native_evaluation',[]))
            emit_progress({'kind':'verification','stage':'case_completed','id':identity,'url':url,'result':result})
            return result
        results = [compare_case(case) for case in cases]
        pending=[case for case,result in zip(cases,results) if case.get('origin')=='generated' and result['status']=='inconclusive']
        for case in pending[:2]:
            replay=replay_case(source,platform,url,
                               dict(case,binary=script.get('binary',False)))
            if replay:
                results.append(compare_case(replay))
                break
        successful=[r for r in results if r['status']=='passed']
        effective=[r for r in successful if r.get('observable_change') and (r['origin']=='curated' or
                   r.get('generation',{}).get('url_matched') or r.get('generation',{}).get('entry_matched'))]
        failed=any(r['status'] in {'mismatch','converted_error','expectation_failed','header_method_error'} or (r['origin']=='curated' and r['status']!='passed') for r in results)
        if failed:status='failed'
        elif not results:status='not_covered'
        elif curated and all(r['status']=='passed' for r in results):status='passed'
        elif effective:status='partial' if len(successful)<len(results) else 'probe_passed'
        elif successful:status='baseline_only'
        else:status='inconclusive'
        row = {'url':url, 'status':status,
            'source_sha256':hashlib.sha256(fetched[identity].encode()).hexdigest(),
            'artifact_sha256':hashlib.sha256(generated[identity].encode()).hexdigest(), 'cases':results,
            'coverage':{'attempted':len(results),'completed':len(successful),'effective':len(effective),
                        'curated':len(curated), 'complete_branch_coverage':False},
            'excluded_fixtures':excluded,
            'generation_limits':hint.get('limits',[])}
        emit_progress({'kind':'verification','stage':'completed','id':identity,'url':url,'status':status})
        return identity,row
    with ThreadPoolExecutor(max_workers=4) as pool:
        rows=dict(pool.map(verify_one,zip(scripts,hints)))
    return {'version':1, 'scope':'generated-probe and optional synthetic-input equivalence only; not proof of all inputs or device behavior',
        'summary':dict(Counter(row['status'] for row in rows.values())), 'scripts':rows,
        'unused_fixture_urls':sorted(set(fixtures)-{s['url'] for s in scripts}),
        'unused_fixture_cases':[{'url':url,'name':case['name'],'entry_type':case['entry_type']}
            for url,cases in fixtures.items() for case in cases if case.get('entry_type')
            and not any(script['url']==url and applicable(case,script) for script in scripts)]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site',type=Path,default=ROOT/'dist')
    parser.add_argument('--fixtures',type=Path,help='Optional external samples for supplemental differential checks')
    parser.add_argument('--output',type=Path,help='默认写入站点目录 verification.json')
    parser.add_argument('--require-covered',action='store_true',help='存在未触发行为、部分验证或未确认的脚本时返回非零退出码')
    parser.add_argument('--strict-anchors',action='store_true',help='存在未以 ^ 锚定的 match 时返回非零退出码')
    args = parser.parse_args()
    manifest = json.loads((args.site/'conversion.json').read_text())
    scripts,fetched,generated = [],{},{}
    for identity,row in manifest['scripts'].items():
        item = {'id':identity,'url':row['source'],'source_format':row['source_format'],'binary':row['binary'],
                'verification_contexts':row.get('verification_contexts',[]),'entry_types':row.get('entry_types',[]),'native_options':row.get('native_options',{}),
                'device_type_parameter':row.get('device_type_parameter',False),
                **({'_verification_source':row['verification_source'],'_verification_format':row['verification_format']} if 'verification_source' in row else {})}
        original = row['generated_source'] if 'generated_source' in row else read_source(ROOT,item)
        artifact = (args.site/row['file']).read_text(encoding='utf-8')
        for body,key in [(original,'source_sha256'),(artifact,'artifact_sha256')]:
            if hashlib.sha256(body.encode()).hexdigest()!=row[key]:
                parser.error(identity+': 原文或产物摘要已变更，请重新构建后验证')
        scripts.append(item);fetched[identity]=original;generated[identity]=artifact
    report = verify_scripts(scripts,fetched,generated,args.fixtures)
    quality = None
    modules_path = args.site/'modules.json'
    if modules_path.is_file():
        snapshot = json.loads(modules_path.read_text(encoding='utf-8'))
        quality = validate_product_quality(snapshot.get('resources', []))
        report['quality'] = quality
        print(json.dumps({key: quality[key] for key in
                          ('modules','parsed','jq_total','jq_bad','jq_missing',
                           'yaml_bad','match_bad','reject_bad','location_bad',
                           'status_bad','header_bad',
                           'declarative_unanchored','unanchored_total')},
                         ensure_ascii=False))
    output = args.output or args.site/'verification.json'
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report['summary'],ensure_ascii=False)+' → '+str(output))
    quality_failed = bool(quality and any(quality[key] for key in (
        'jq_bad', 'jq_missing', 'yaml_bad', 'match_bad', 'reject_bad',
        'location_bad', 'status_bad', 'header_bad')))
    anchor_failed = bool(quality and args.strict_anchors and quality['unanchored_total'])
    if report['summary'].get('failed') or report['unused_fixture_urls'] or report.get('unused_fixture_cases') or (args.require_covered and any(row['status'] not in {'passed','probe_passed'} for row in report['scripts'].values())) or quality_failed or anchor_failed:
        raise SystemExit(1)


if __name__=='__main__':
    main()
