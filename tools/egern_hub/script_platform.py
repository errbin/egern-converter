"""Select a documented completion contract, never infer it from repository names."""
import re

from .convert import canonical_script_url
from .documentation import documentation
from .js_analysis import analyze


def script_platform(source, url, fallback, *, binary=False):
    """Honor self-referencing QX usage for portable scalar-body rewrites only.

    A module's platform remains authoritative for environment, HTTP, binary and
    argument APIs. This narrow exception covers QX's official $done(string)
    contract; treating it as an object would discard the rewritten body.
    """
    if fallback == 'qx' or binary:
        return fallback
    comment = documentation(source, '')['comment']
    # Mixed-platform declarations are ambiguous; do not override the caller.
    if re.search(r'(?mi)^\s*\*?\s*(?:http-(?:request|response)\s|\S+\s*=\s*type\s*=|\[script\])', comment):
        return fallback
    declarations = re.findall(r'(?m)^\s*\*?\s*\S+\s+url\s+script-(?:request|response)-body\s+(https?://\S+)\s*$', comment)
    if canonical_script_url(url) not in {canonical_script_url(link) for link in declarations}:
        return fallback
    report = analyze(source, fallback)
    if not report.get('errors') and report.get('text_body_only') and report.get('scalar_completion'):
        return 'qx'
    return fallback
