"""Deterministic behavioral fallback; facts come from original AST/config only."""
import re

from .convert import dump
from .js_analysis import analyze_many
from .layout import read_source, source_path


def field_groups(fields):
    """Describe field categories, never promise that entitlement changes succeed."""
    keys = {re.sub(r'[^a-z0-9]', '', value.lower()) for value in fields}
    patterns = [
        ('会员状态', r'^(?:is)?(?:vip|premium|pro|member|membership)(?:status|state|type|level|label|enabled)?$'),
        ('订阅权益', r'subscription|subscribed|entitlement|productid'),
        ('订阅回执', r'^(?:receipt|receiptdata|inapp|transactionid|originaltransactionid|receipttype)$'),
        ('到期时间', r'expir(?:e|ation|y)'),
        ('内购信息', r'inapppurchase|youown|purchase'),
        ('广告相关', r'^(?:ads?|advert|advertisement|adverts|advertising|isad|showad|showads|isenabledads|adsenabled|isadsenabled)$'),
        ('计数或额度', r'^(?:quota|credits?|coins?|balance|imgnum|usagelimit|remainingcount)$'),
    ]
    return [label for label, pattern in patterns if any(re.search(pattern, key) for key in keys)]


def script_summary(reports, stages):
    effects = {effect for report in reports for effect in report.get('effects', [])}
    fields = sorted({key for report in reports for key in report.get('fields', [])})
    phase = '请求与响应' if stages == {'http_request', 'http_response'} else '请求' if stages == {'http_request'} else '响应' if stages == {'http_response'} else '返回'
    parts = []
    groups = field_groups(fields)
    if 'body_fields' in effects or 'body_delete' in effects:
        detail = '、'.join(groups[:4])
        if not detail:
            readable = [key for key in fields if re.fullmatch(r'[\w.-]{1,36}', key)]
            detail = '、'.join(readable[:3]) + ('等' if len(readable)>3 else '')
        parts.append(f'改写{phase}数据中的{detail}字段' if detail else f'改写{phase}数据字段')
    elif 'body_replace' in effects:
        parts.append(f'替换{phase}正文中的匹配文本')
    elif 'body_construct' in effects or 'body_constant' in effects:
        parts.append(f'构造并返回{phase}正文')
    elif 'json_stringify' in effects:
        parts.append(f'重新序列化{phase} JSON 正文')
    if 'array_filter' in effects:
        parts.append('过滤返回数组中的条目')
    if 'array_map' in effects or 'array_edit' in effects:
        parts.append('调整返回数组的内容')
    for effect, phrase in [('headers_write', f'改写{phase}头字段'), ('url_write', '设置请求地址'),
                           ('status_write', '设置返回状态码'), ('html_output', '生成 HTML 页面'),
                           ('network', '发送网络请求'), ('storage_write', '写入本地持久化数据'), ('notification', '发送通知')]:
        if effect in effects:
            parts.append(phrase)
    if not parts and 'output_body' in effects and any(effect in effects for effect in ('read_response.body', 'read_request.body')):
        parts.append(f'返回原有{phase}正文')
    return parts


def configuration_summary(obj, kind):
    parts, facts = [], {}
    native = {}
    for row in obj.get('rewrites',[]):
        for action in row.get('actions',[]):
            for name in action:
                native[name]=native.get(name,0)+1
    if native:
        facts['rewrites']=native
        for names,phrase in [(('respond',),'返回预设响应'), (('redirect','replace_url'),'重写或重定向请求地址'),
                             (('request_headers','response_headers'),'重写请求或响应头'),
                             (('request_body','response_body'),'修改匹配的正文内容')]:
            count=sum(native.get(name,0) for name in names)
            if count:parts.append(f'{phrase}（{count} 条）')
    rewrites = obj.get('url_rewrites', [])
    if rewrites:
        rejected = sum(str(row.get('location', '')).startswith('http://reject') for row in rewrites)
        redirected = len(rewrites)-rejected
        facts['url_rewrites'] = {'reject':rejected, 'rewrite':redirected}
        if rejected:
            parts.append(f'拦截 {rejected} 条规则匹配的请求')
        if redirected:
            parts.append(f'按 {redirected} 条规则重写或重定向请求地址')
    for field, phrase in [('header_rewrites','重写请求或响应头'), ('body_rewrites','替换匹配的正文内容'),
                          ('map_locals','返回预设的本地响应'), ('rules','按规则分配网络策略')]:
        if obj.get(field):
            facts[field] = len(obj[field])
            parts.append(f'{phrase}（{len(obj[field])} 条）')
    for field, phrase in [('dns','配置 DNS 解析'), ('http_captures','按配置抓取 HTTP 流量'),
                          ('widgets','配置小组件'), ('bypass_tunnel_proxy','配置绕过隧道的流量'),
                          ('real_ip_domains','配置使用真实 IP 的域名')]:
        if obj.get(field):
            facts[field] = True
            parts.append(f'配置 {len(obj[field])} 个小组件'+('，通过通用脚本生成界面' if any('generic' in entry for entry in obj.get('scriptings',[])) else '') if field=='widgets' else phrase)
    if kind == 'rules' and not parts:
        parts.append('按所列网络规则匹配连接')
    return parts, facts


def apply_behavior_descriptions(root, resources, sources, scripts, fetched):
    """Batch only scripts whose modules have no upstream explanatory text."""
    registered = {item['id']:item for item in scripts}
    pending, jobs = [], []
    for resource, source in zip(resources, sources):
        if resource['description']:
            continue
        inputs = dict(source.get('_behavior_inputs', []))
        for identity in source.get('script_map', {}).values():
            if identity in registered:
                inputs[registered[identity]['url']] = fetched[identity]
        obj = source.get('_render_obj', {})
        # Analyze local original dependencies only, never converted runtime wrappers.
        for entry in obj.get('scriptings', []):
            for options in entry.values():
                url = options.get('script_url', '')
                if url and url not in inputs and source_path(root, {'url':url}).is_file():
                    inputs[url] = read_source(root, {'url':url})
        selected = [(url, body) for url,body in sorted(inputs.items())]
        start = len(jobs)
        jobs.extend((body, 'any') for _, body in selected)
        pending.append((resource, source, selected, start))
    reports = analyze_many(jobs, mode='behavior') if jobs else []
    for resource, source, inputs, start in pending:
        obj = source.get('_render_obj', {})
        selected = reports[start:start+len(inputs)]
        stages = {stage for entry in obj.get('scriptings', []) for stage in entry if stage in {'http_request','http_response'}}
        parts = script_summary(selected, stages)
        config_parts, config_facts = configuration_summary(obj, source['kind'])
        parts += config_parts
        limited = not parts
        if limited:
            if stages:
                phase = '请求与响应' if len(stages)>1 else '请求' if 'http_request' in stages else '响应'
                parts = [f'在{phase}阶段执行匹配的脚本，静态分析未确定具体的数据修改']
            else:
                parts = ['加载原作者配置，静态分析未确定更具体的行为']
        description = '；'.join(dict.fromkeys(parts)) + '。'
        upstream = source['_description_result']
        source['_description_result'] = {'description':description, 'source':'behavior',
            'url':source.get('url', source.get('path', '')), 'upstream':upstream,
            'analysis':'static-output-flow-v1', 'scope':'可能执行的代码路径，非运行效果保证',
            'limited':limited, 'configuration':config_facts,
            'scripts':[dict(report, url=url) for (url,_),report in zip(inputs, selected)]}
        resource['description'] = description
        if source['kind']=='modules' and source['format']!='egern':
            obj['description'] = description
            resource['yaml'] = source['_render_header'] + dump(obj)
