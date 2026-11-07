"""Static JavaScript analysis using the vendored MIT-licensed Acorn parser."""
from functools import lru_cache
import json
from pathlib import Path
import subprocess


ANALYSIS_CATEGORIES = frozenset({
    'core', 'analysis', 'transforms', 'platform', 'http', 'compiler', 'output', 'verification',
})
ANALYSIS_ENTRYPOINTS = frozenset({'batch.mjs', 'check.mjs', 'verify.mjs', 'widget.mjs'})
ANALYSIS_MODULE_LIMIT = 24


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


def _run_batch(jobs):
    validate_analysis_layout()
    tool = Path(__file__).resolve().parents[2] / 'tools/js-analysis/batch.mjs'
    try:
        result = subprocess.run(['node', str(tool)], input=json.dumps(jobs, ensure_ascii=False), text=True, capture_output=True, timeout=60)
    except subprocess.TimeoutExpired as exc:
        if len(jobs) > 1:
            middle = len(jobs) // 2
            return _run_batch(jobs[:middle]) + _run_batch(jobs[middle:])
        identity = jobs[0].get('options', {}).get('storage_key', '').removeprefix('egern-hub:') if jobs else ''
        message = f'JavaScript 静态分析超时（{len(jobs)} 个输入，60 秒）；请检查对应脚本的分析复杂度'+('：'+identity if identity else '')
        if jobs and jobs[0].get('mode') == 'native':
            # Keep unrelated modules buildable, while rejecting this dependency
            # explicitly. A timeout is never a successful conversion.
            return [{'errors':[message], 'code':None, 'analysis_timeout':True}]
        raise ValueError(message) from exc
    except OSError as exc:
        raise ValueError('语法分析需要 Node.js（Pages 构建环境自带），无需 npm 安装') from exc
    if result.returncode:
        raise ValueError('语法分析工具失败：' + result.stderr[-800:])
    reports = json.loads(result.stdout)
    if not isinstance(reports, list) or len(reports) != len(jobs):
        raise ValueError('语法分析返回结果不完整')
    return reports


def analyze_many(jobs, *, mode='convert'):
    """Analyze this build's entire input set; share only identical jobs within it."""
    jobs = list(jobs)
    unique = list(dict.fromkeys(jobs))
    reports, batch, size = {}, [], 0

    def flush():
        if batch:
            result = _run_batch([{'source':job[0], 'source_format':job[1], 'mode':mode,
                                 'options':json.loads(job[2]) if len(job) > 2 else {}} for job in batch])
            reports.update(zip(batch, result))
            batch.clear()

    for job in unique:
        length = len(job[0].encode('utf-8'))
        # Native compilation runs several scope/provenance passes. Keep a batch
        # small enough that unrelated dependencies cannot exhaust its timeout.
        if batch and (len(batch) >= (8 if mode == 'native' else 32) or
                      size + length > (512 if mode == 'native' else 1024) * 1024):
            flush()
            size = 0
        batch.append(job)
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
