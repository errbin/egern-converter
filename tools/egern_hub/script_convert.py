"""Convert reviewed Surge/Loon/QX HTTP scripts to Egern's native ctx entry point."""
import argparse
import hashlib
import json
from pathlib import Path
import re

from .convert import ConversionError
from .deobfuscate import deobfuscate
from .js_analysis import analyze_many
from .script_usage import DEFAULT_USAGE


def converter_revision():
    """Fingerprint the complete conversion toolchain, never generated artifacts."""
    root = Path(__file__).resolve().parents[2]
    files = [root / name for name in ['.node-version', '.python-version',
        'requirements.txt', 'tools/js-readability/index.mjs',
        'tools/js-readability/package-lock.json']]
    files += list((root / 'tools/egern_hub').rglob('*.py'))
    files += list((root / 'tools/js-analysis').rglob('*.mjs'))
    files += list((root / 'tools/js-analysis').rglob('*.cjs'))
    manifest = root / 'converter-files.json'
    if manifest.is_file():
        files = [root / name for name in json.loads(manifest.read_text())]
    digest = hashlib.sha256()
    for file in sorted(files):
        digest.update(file.relative_to(root).as_posix().encode() + b'\0' + file.read_bytes() + b'\0')
    return digest.hexdigest()


def convert_script(source, author, url, license_text, binary=False, readable=False, source_format="surge", ast=True, *, license_name=None, egern_usage=None, _analysis=None):
    source_format = {"quantumult-x":"qx", "quantumultx":"qx"}.get(source_format,source_format)
    if source_format not in {"surge", "loon", "qx", "egern", "stash", "shadowrocket"}:
        raise ConversionError("未知脚本格式")
    if source_format == "egern":
        if not re.search(r"\bexport\s+default\b", source):
            raise ConversionError("原生 Egern 脚本缺少 export default 入口")
        return source
    original_source = source
    if readable:
        source = deobfuscate(source)
    # The old --no-ast switch cannot bypass native compilation or emit a bridge.
    options = {'binary':binary, 'storage_key':'egern-hub:' + url}
    if readable:
        options['layout_source'] = original_source
    job = (source, source_format, json.dumps(options))
    report = _analysis if _analysis is not None else analyze_many([job], mode='native')[0]
    if report['errors']:
        raise ConversionError('；'.join(report['errors']))
    for label in (author, url, license_name or ''):
        if '\n' in label or '\r' in label:
            raise ConversionError('署名和来源必须是单行文本')
    lines = [f'Original author: {author}', f'Source: {url}', 'Egern adaptation: ErrBin']
    if license_name:
        lines.append('License: ' + license_name)
    # Explicit CLI license text is retained when supplied; website builds use upstream URLs only.
    if license_text.strip() and license_name not in {'未声明许可证', '待核验'}:
        lines.extend(['', license_text.strip()])
    if report.get('documentation'):
        lines.extend(['', report['documentation']])
    lines.extend(['', egern_usage or DEFAULT_USAGE])
    header = '/*\n' + '\n'.join(lines).replace('*/', '* /') + '\n*/\n\n\n'
    return header + report['code']


def convert_scripts(items, *, errors=None, metadata=None):
    """Reconvert every registered script while batching static analysis."""
    items = list(items)
    prepared, jobs = [], []
    entry_types = {}
    unknown_entries = set()
    def contract(item):
        # Different host APIs, binary modes and argument contracts can produce
        # separate artifacts. Only jobs sharing that runtime contract may
        # share entry specialization; a URL alone is not the entire contract.
        return (item['url'], item.get('source_format', 'surge'), item.get('binary', False),
                json.dumps(item.get('native_options', {}), sort_keys=True))
    for item in items:
        key = contract(item)
        if item.get('entry_types'):
            entry_types.setdefault(key, set()).update(item['entry_types'])
        else:
            unknown_entries.add(key)
    for item in items:
        fmt = item.get('source_format', 'surge')
        source = deobfuscate(item['source']) if fmt != 'egern' and item.get('readable', False) else item['source']
        needs_analysis = fmt != 'egern'
        prepared.append((item, source, needs_analysis))
        if needs_analysis:
            options = {'binary':item.get('binary', False), 'storage_key':'egern-hub:' + item['url'], **item.get('native_options',{})}
            key = contract(item)
            if key not in unknown_entries and key in entry_types:
                options['entry_types'] = sorted(entry_types[key])
            if item.get('readable', False):
                options['layout_source'] = item['source']
            jobs.append((source, fmt, json.dumps(options)))
    reports = iter(analyze_many(jobs, mode='native'))
    generated = {}
    for item, source, needs_analysis in prepared:
        report = next(reports) if needs_analysis else None
        if metadata is not None:
            metadata[item['id']] = {'preserved_libraries':report.get('libraries',[]) if report else [],
                                   'static_transformations':report.get('static_transformations',[]) if report else [],
                                   'native_evaluation':report.get('native_evaluation',[]) if report else [],
                                   'device_type_parameter':bool(report and report.get('device_type_parameter')),
                                   'verification_format':report.get('verification_format') if report else None}
        try:
            generated[item['id']] = convert_script(source, item['author'], item['url'], item['license_text'],
                binary=item.get('binary', False), source_format=item.get('source_format', 'surge'),
                ast=item.get('ast', True), license_name=item.get('license'), egern_usage=item.get('egern_usage'), _analysis=report)
        except ValueError as exc:
            if errors is None:
                raise
            errors[item['id']] = str(exc)
    return generated


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--author', required=True)
    parser.add_argument('--source', required=True)
    parser.add_argument('--license-file', type=Path, required=True)
    parser.add_argument('--license-name', help='License label from the catalog; provenance notes for undeclared/pending licenses are not embedded')
    parser.add_argument('--binary', action='store_true')
    parser.add_argument('--ast', action=argparse.BooleanOptionalAction, default=True, help='Deprecated: native conversion always requires static syntax and scope analysis')
    parser.add_argument('--format', choices=['surge', 'loon', 'qx', 'egern', 'stash', 'shadowrocket'], default='surge')
    parser.add_argument('--readable', action='store_true', help='Run optional static readability pass before conversion')
    args = parser.parse_args()
    content = convert_script(args.input.read_text(encoding='utf-8'), args.author, args.source,
                             args.license_file.read_text(encoding='utf-8'), args.binary, args.readable, args.format, args.ast,
                             license_name=args.license_name)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(content, encoding='utf-8')
