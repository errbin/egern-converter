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
import subprocess
import tempfile
import zlib

from .layout import read_source
from .js_analysis import analyze_many
from .verification_probes import generated_cases
from .device_parameters import device_cases

ROOT = Path(__file__).resolve().parents[2]


def compression_vectors(fixture):
    """Compute bounded binary API samples without executing the input script."""
    vectors = list(fixture.get('compression', []))
    seen = {(v['method'], tuple(v['input'])) for v in vectors}
    payloads = []
    for message in (fixture.get('request', {}), fixture.get('response', {})):
        data = bytes(message['bytes']) if 'bytes' in message else str(message.get('body') or '').encode('utf-8')
        if len(data) <= 1024 * 1024:
            payloads.append(data)
    # One round of derived streams covers gzip/deflate round trips. No upstream
    # expressions, live network, or callable host objects enter the VM.
    for raw in list(payloads):
        payloads.extend((gzip.compress(raw, mtime=0), zlib.compress(raw)))
    for data in set(payloads):
        operations = {'gzip': lambda: gzip.compress(data, mtime=0), 'deflate': lambda: zlib.compress(data)}
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
    if 'ungzip' in source or '.compress' in source:
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


def verify_scripts(scripts, fetched, generated, fixture_dir=None, *, auto=True):
    fixtures = validate_fixtures(fixture_dir) if fixture_dir else {}
    hints=analyze_many([(s.get('_verification_source',fetched[s['id']]),'any') for s in scripts],mode='probes') if auto else [{} for _ in scripts]
    def stages(script):
        return set(script.get('entry_types') or [context['stage'] for context in script.get('verification_contexts',[]) if context.get('stage')])
    def applicable(case, script):
        declared=stages(script)
        return not declared or not case.get('entry_type') or case['entry_type'] in declared
    def verify_one(job):
        script,hint=job
        identity,url = script['id'],script['url']
        source = script.get('_verification_source',fetched[identity])
        platform = script.get('_verification_format',script.get('source_format','surge'))
        if script.get('native_options',{}).get('enabled_env'):
            source = 'if ($environment.variables._hub_enabled === "false") $done({});\n' + source
        curated=[case for case in fixtures.get(url,[]) if applicable(case,script)]
        excluded=[{'name':case['name'],'entry_type':case['entry_type'],'reason':'不属于该转换版本的脚本入口'} for case in fixtures.get(url,[]) if not applicable(case,script)]
        cases = copy.deepcopy(curated) + (generated_cases(hint,script.get('verification_contexts',[])) if auto else [])
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
        results = [compare(source,generated[identity],platform,url,
                           dict(case,binary=script.get('binary',False)),
                           native_evaluation=script.get('native_evaluation',[])) for case in cases]
        pending=[case for case,result in zip(cases,results) if case.get('origin')=='generated' and result['status']=='inconclusive']
        for case in pending[:2]:
            replay=replay_case(source,platform,url,
                               dict(case,binary=script.get('binary',False)))
            if replay:
                results.append(compare(source,generated[identity],platform,url,replay))
                break
        successful=[r for r in results if r['status']=='passed']
        effective=[r for r in successful if r.get('observable_change') and (r['origin']=='curated' or
                   r.get('generation',{}).get('url_matched') or r.get('generation',{}).get('entry_matched'))]
        failed=any(r['status'] in {'mismatch','converted_error','expectation_failed'} or (r['origin']=='curated' and r['status']!='passed') for r in results)
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
    output = args.output or args.site/'verification.json'
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report['summary'],ensure_ascii=False)+' → '+str(output))
    if report['summary'].get('failed') or report['unused_fixture_urls'] or report.get('unused_fixture_cases') or (args.require_covered and any(row['status'] not in {'passed','probe_passed'} for row in report['scripts'].values())):
        raise SystemExit(1)


if __name__=='__main__':
    main()
