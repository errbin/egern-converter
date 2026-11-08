"""Static JavaScript analysis using the vendored MIT-licensed Acorn parser."""
from functools import lru_cache
import json
import os
from pathlib import Path
import queue
import subprocess
import tempfile
from threading import Thread
import time


ANALYSIS_CATEGORIES = frozenset({
    'core', 'analysis', 'transforms', 'platform', 'http', 'compiler', 'output', 'verification',
})
ANALYSIS_ENTRYPOINTS = frozenset({'batch.mjs', 'check.mjs', 'verify.mjs', 'widget.mjs'})
ANALYSIS_MODULE_LIMIT = 24
PROGRESS_PREFIX = '@@EGERN_PROGRESS '


def emit_progress(event):
    if os.environ.get('EGERN_PROGRESS_EVENTS') == '1':
        print(PROGRESS_PREFIX + json.dumps(event, ensure_ascii=False), flush=True)


def validate_analysis_layout(tool_dir=None):
    """Reject undeclared modules before running the fixed analysis toolchain."""
    tool_dir = Path(tool_dir) if tool_dir is not None else Path(__file__).resolve().parents[1] / 'js-analysis'
    prefix = 'JavaScript 分析器目录违反固定分类：'
    try:
        layout = json.loads((tool_dir / 'architecture.json').read_text())
    except (OSError, ValueError) as exc:
        raise ValueError(prefix + '无法读取 architecture.json') from exc
    if not isinstance(layout, dict) or set(layout) != {'entrypoints', 'categories', 'vendor'}:
        raise ValueError(prefix + '清单必须声明 entrypoints、categories 和 vendor')
    categories = layout['categories']
    if not isinstance(categories, dict) or set(categories) != ANALYSIS_CATEGORIES:
        raise ValueError(prefix + '只允许既定的 8 个功能分类')

    def filenames(items):
        return (isinstance(items, list) and bool(items) and
                all(isinstance(name, str) and Path(name).name == name and name.endswith(('.mjs', '.cjs'))
                    for name in items) and len(items) == len(set(items)))

    entries, vendor = layout['entrypoints'], layout['vendor']
    if not filenames(entries) or set(entries) != ANALYSIS_ENTRYPOINTS:
        raise ValueError(prefix + '根目录只允许既定的 4 个命令入口')
    if not filenames(vendor) or not all(filenames(items) for items in categories.values()):
        raise ValueError(prefix + '各分类只能登记不重复的模块文件名')
    owned = set(entries) | {f'{category}/{name}' for category, names in categories.items() for name in names}
    if len(owned) > ANALYSIS_MODULE_LIMIT:
        raise ValueError(prefix + f'自有模块不得超过 {ANALYSIS_MODULE_LIMIT} 个，请先按功能合并')
    expected = owned | {f'vendor/{name}' for name in vendor}
    actual = {str(path.relative_to(tool_dir)) for path in tool_dir.rglob('*')
              if path.is_file() and path.suffix in {'.mjs', '.cjs', '.js'}}
    unknown = sorted(actual - expected)
    missing = sorted(expected - actual)
    folders = {str(path.relative_to(tool_dir)) for path in tool_dir.rglob('*') if path.is_dir()}
    extra_folders = sorted(folders - ANALYSIS_CATEGORIES - {'vendor'})
    if unknown or missing or extra_folders:
        raise ValueError(prefix + f'未登记文件={unknown}；缺失文件={missing}；未登记目录={extra_folders}')


def _run_batch(jobs, progress_items=None):
    validate_analysis_layout()
    tool = Path(__file__).resolve().parents[2] / 'tools/js-analysis/batch.mjs'
    payload=[]
    for index,job in enumerate(jobs):
        item=dict(job)
        if progress_items and progress_items[index]:
            item['progress']=progress_items[index]
        payload.append(item)
    command=['node', str(tool)]
    try:
        if not any(progress_items or []):
            result=subprocess.run(command,input=json.dumps(payload,ensure_ascii=False),text=True,
                                  capture_output=True,timeout=60)
            stdout,diagnostics,returncode=result.stdout,result.stderr,result.returncode
        else:
            started=time.monotonic()
            with tempfile.TemporaryFile() as stdout_file:
                process=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=stdout_file,stderr=subprocess.PIPE)
                messages=queue.Queue()
                def read_stderr():
                    for line in process.stderr:
                        messages.put(line)
                    messages.put(None)
                reader=Thread(target=read_stderr,daemon=True)
                reader.start()
                diagnostic_lines=[]
                try:
                    process.stdin.write(json.dumps(payload,ensure_ascii=False).encode('utf-8'))
                    process.stdin.close()
                    while True:
                        remaining=60-(time.monotonic()-started)
                        if remaining<=0:
                            raise subprocess.TimeoutExpired(command,60)
                        try:
                            line=messages.get(timeout=min(remaining,1.0))
                        except queue.Empty:
                            continue
                        if line is None:
                            break
                        decoded=line.decode('utf-8','replace')
                        if decoded.startswith(PROGRESS_PREFIX):
                            try:
                                emit_progress(json.loads(decoded[len(PROGRESS_PREFIX):]))
                                continue
                            except ValueError:
                                pass
                        diagnostic_lines.append(decoded)
                        print(decoded,end='',flush=True)
                    process.wait(timeout=max(0.01,60-(time.monotonic()-started)))
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
                    raise
                finally:
                    if process.stdin and not process.stdin.closed:
                        process.stdin.close()
                    if process.stderr:
                        process.stderr.close()
                    reader.join(timeout=1)
                stdout_file.seek(0)
                stdout=stdout_file.read().decode('utf-8','replace')
                diagnostics=''.join(diagnostic_lines)
                returncode=process.returncode
    except subprocess.TimeoutExpired as exc:
        if len(jobs) > 1:
            middle = len(jobs) // 2
            left=progress_items[:middle] if any(progress_items or []) else None
            right=progress_items[middle:] if any(progress_items or []) else None
            return _run_batch(jobs[:middle],left) + _run_batch(jobs[middle:],right)
        identity = jobs[0].get('options', {}).get('storage_key', '').removeprefix('egern-hub:') if jobs else ''
        message = f'JavaScript 静态分析超时（{len(jobs)} 个输入，60 秒）；请检查对应脚本的分析复杂度'+('：'+identity if identity else '')
        if jobs and jobs[0].get('mode') == 'probes':
            skipped='自动探针分析超时（60 秒）；跳过自动生成输入并将该脚本记为未覆盖'
            progress=progress_items[0] if progress_items else None
            if progress:
                emit_progress({**progress,'stage':'probe_generation_skipped','reason':skipped})
            return [{'paths':[],'containers':[],'json_fields':[],'regexes':[],
                     'guard_keys':[],'object_keys':[],'strings':[],
                     'limits':[skipped], 'probe_skipped':True}]
        if jobs and jobs[0].get('mode') == 'native':
            # Keep unrelated modules buildable, while rejecting this dependency
            # explicitly. A timeout is never a successful conversion.
            return [{'errors':[message], 'code':None, 'analysis_timeout':True}]
        raise ValueError(message) from exc
    except OSError as exc:
        raise ValueError('语法分析需要 Node.js（Pages 构建环境自带），无需 npm 安装') from exc
    if returncode:
        raise ValueError('语法分析工具失败：' + diagnostics[-800:])
    reports = json.loads(stdout)
    if not isinstance(reports, list) or len(reports) != len(jobs):
        raise ValueError('语法分析返回结果不完整')
    if progress_items:
        for report,progress in zip(reports,progress_items):
            if progress and report.get('probe_skipped'):
                reason='；'.join(report.get('limits',[])) or '自动探针分析跳过'
                emit_progress({**progress,'stage':'probe_generation_skipped','reason':reason})
    return reports


def analyze_many(jobs, *, mode='convert', progress_items=None):
    """Analyze this build's entire input set; share only identical jobs within it."""
    jobs = list(jobs)
    if progress_items is not None and len(progress_items)!=len(jobs):
        raise ValueError('Progress metadata must match the analysis input count')
    progress_items=list(progress_items) if progress_items is not None else [None]*len(jobs)
    unique = list(dict.fromkeys(jobs))
    progress_by_job={}
    for job,item in zip(jobs,progress_items):
        progress_by_job.setdefault(job,item)
    reports, batch, size = {}, [], 0
    batch_progress=[]

    def flush():
        if batch:
            payload=[{'source':job[0], 'source_format':job[1], 'mode':mode,
                      'options':json.loads(job[2]) if len(job) > 2 else {}} for job in batch]
            result = (_run_batch(payload,batch_progress) if any(batch_progress)
                      else _run_batch(payload))
            reports.update(zip(batch, result))
            batch.clear()
            batch_progress.clear()

    for job in unique:
        length = len(job[0].encode('utf-8'))
        # Native compilation runs several scope/provenance passes. Keep a batch
        # small enough that unrelated dependencies cannot exhaust its timeout.
        max_batch = 8 if mode == 'native' else 32
        max_bytes = 512 if mode == 'native' else 1024
        if batch and (len(batch) >= max_batch or size + length > max_bytes * 1024):
            flush()
            size = 0
        batch.append(job)
        batch_progress.append(progress_by_job.get(job))
        size += length
    flush()
    return [reports[job] for job in jobs]


@lru_cache(maxsize=128)
def analyze(source, source_format='surge'):
    # Maintenance commands may ask for the same dependency repeatedly.
    # Full builds use analyze_many directly and never reuse this process cache.
    return analyze_many([(source, source_format)])[0]


def validate_generated(scripts):
    validate_analysis_layout()
    tool = Path(__file__).resolve().parents[2] / 'tools/js-analysis/check.mjs'
    try:
        result = subprocess.run(['node', str(tool)], input=json.dumps(scripts), text=True, capture_output=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ValueError('生成脚本语法校验需要 Node.js') from exc
    if result.returncode:
        raise ValueError('生成脚本语法校验失败：' + result.stderr[-800:])
    errors = json.loads(result.stdout)
    if errors:
        raise ValueError('生成脚本语法错误：' + '；'.join(errors))
