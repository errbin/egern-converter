"""Optional static JavaScript readability pass; never executes upstream code."""
import argparse
from pathlib import Path
import subprocess


def deobfuscate(source):
    tool = Path(__file__).resolve().parents[2] / 'tools/js-readability/index.mjs'
    try:
        result = subprocess.run(['node', str(tool)], input=source, text=True, capture_output=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ValueError('静态解混淆需要 Node.js；请先 npm ci --prefix tools/js-readability --ignore-scripts') from exc
    if result.returncode:
        raise ValueError('静态解混淆失败，保留原文件：' + result.stderr[-2500:])
    return result.stdout


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    if args.input.resolve() == args.output.resolve():
        parser.error('请使用独立输出路径，保留上游原文')
    code = deobfuscate(args.input.read_text(encoding='utf-8'))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(code, encoding='utf-8')
