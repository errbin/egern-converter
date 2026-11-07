"""Normalize only mechanically identifiable copied declaration fragments.

Original files are never edited. Every accepted repair is emitted as a build
normalization, with the original line and its replacement. Unknown defaults,
arbitrary invalid regexes and ambiguous arguments remain errors.
"""
import re
import csv


def blocking_profile(text):
    """An explicitly blocking-only module can supply its uniform reject default.

    Mixed routing, non-reject rewrites and unknown declarations disqualify it.
    Only naked HTTP URL patterns are eligible; no domains/actions are invented.
    """
    section='';policies=[];rewrites=[]
    for raw in text.splitlines():
        line=raw.strip()
        if not line or line.startswith(('#',';','//')):continue
        if re.fullmatch(r'\[.+\]',line):section=line[1:-1].lower();continue
        if section in {'rule','rules'}:
            if re.fullmatch(r'\^https?\??:\S+',line):continue
            fields=[v.strip() for v in next(csv.reader([line],skipinitialspace=True))]
            policy=fields[-2] if fields[-1]=='no-resolve' and len(fields)>2 else fields[-1].split(' //',1)[0].strip()
            policies.append(policy)
        elif section in {'rewrite','url rewrite'}:
            if re.fullmatch(r'\^https?\??:\S+',line):continue
            rewrites.append(bool(re.fullmatch(r'\S+\s+reject(?:-200|-dict|-array|-img|-video)?',line,re.I)))
    return len(policies)>1 and set(policies)=={'REJECT'} and bool(rewrites) and all(rewrites)


def missing_block_action(line,section):
    if not re.fullmatch(r'\^https?\??:\S+',line):return None
    if section in {'rule','rules'}:
        return 'URL-REGEX, '+line+', REJECT'
    if section in {'rewrite','url rewrite'}:
        return line+' reject'
    return None


def v2_url_regex(line):
    """Repair a unique URL-only delimiter; preserve the regex's match language.

    Unlike a JavaScript literal, the destination uses a plain regex string.
    Escaping an interior '/' changes its delimiter spelling, not its meaning.
    Compound conditions and ambiguous boundaries remain errors.
    """
    prefix = re.match(r'(?:request|response)\s+if\s+\$\{url\}\s*~=\s*/',line)
    if not prefix:
        return line,None
    tail = line[prefix.end():]
    ends = list(re.finditer(r'/([ims]*)\s+then\s+',tail))
    if len(ends)!=1:
        return line,None
    end = ends[0]
    pattern = tail[:end.start()]
    if not re.match(r'\^?https?\??:',pattern) or re.search(r'\s|\$\{|&&|\|\|',pattern):
        return line,None
    escaped, inside_class, result = False,False,[]
    for char in pattern:
        if escaped:
            result.append(char);escaped=False
        elif char=='\\':
            result.append(char);escaped=True
        else:
            if char=='[':inside_class=True
            elif char==']':inside_class=False
            result.append('\\/' if char=='/' and not inside_class else char)
    corrected = ''.join(result)
    if corrected == pattern:
        return line,None
    return line[:prefix.end()]+corrected+tail[end.start():], '规范唯一 URL 条件中的未转义斜杠，保留正则匹配语义'


def normalize(line, section, parse_options):
    if section in {'rewrite', 'url rewrite'}:
        quoted = r'''(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')'''
        match = re.fullmatch(r'(\S+\s+(request|response)-body-replace-regex\s+)('+quoted+r')\s+\2-body\s+('+quoted+r')', line)
        if match:
            return match[1]+match[3]+' '+match[4], '移除同一正文替换声明中重复粘贴的阶段标记'
    if section == 'script':
        task = re.fullmatch(r'(cron\s+"[^"\n]+"\s+)(https://[^\s,]+)(,\s*.+)?',line)
        if task:
            return task[1]+'script-path='+task[2]+(task[3] or ''), '按 Cron 表达式后的唯一 HTTPS 脚本地址补全 script-path 字段名'
        match = re.fullmatch(r'(http-request|http-response)\s+(\S+?),\s*(script-path\s*=.+)', line)
        if match:
            try:
                parse_options(match[3], loon_tags=True)
            except ValueError:
                pass
            else:
                return match[1]+' '+match[2]+' '+match[3], '将 HTTP 匹配式与 script-path 之间的逗号分隔符规范为空格'
        match = re.fullmatch(r'(http-request|http-response)\s+(.+?)\s+(script-path\s*=.+)', line)
        if match and re.search(r'\s', match[2]):
            try:
                options = parse_options(match[3], loon_tags=True)
            except ValueError:
                return line, None
            tag, enable = options.get('tag'), options.get('enable')
            if tag and enable:
                fragment = tag+', enable='+enable
                pattern = match[2]
                if pattern.count(fragment) == 1:
                    corrected = pattern.replace(fragment, '', 1)
                    if corrected and not re.search(r'\s', corrected):
                        return match[1]+' '+corrected+' '+match[3], '移除误粘贴进匹配式且在脚本选项中完整重复的 tag / enable 文本'
    return line, None
