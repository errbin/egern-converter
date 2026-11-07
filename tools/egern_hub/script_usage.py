"""Generate script instructions from the same module objects used for publication."""
from copy import deepcopy
from collections import defaultdict
from urllib.parse import quote

from .convert import dump
from .layout import artifact_path


DEFAULT_USAGE = ('用法\n'
    '在 Egern 模块的 scriptings 中配置此脚本，script_url 指向转换后文件。\n'
    '匹配规则、脚本阶段、正文读取和 MITM 域名以配套 Egern 模块为准。')


def usages_for(sources, scripts, base_url):
    """Select one standalone companion per physical script, never a collection.

    A standalone companion references only this output file (possibly through
    several equivalent compilation IDs). Prefer the smallest matching native
    configuration, with the published URL as a deterministic tie breaker.
    """
    paths = {script['id']: artifact_path(script, 'scripts') for script in scripts}
    candidates = defaultdict(list)
    for source in sources:
        if source['kind'] != 'modules' or source['format'] == 'egern':
            continue
        mapping = source.get('script_map', {})
        obj = source['_render_obj']
        for path in dict.fromkeys(paths[key] for key in mapping.values() if key in paths):
            entries = []
            unrelated = False
            for entry in obj.get('scriptings', []):
                for stage, options in entry.items():
                    identity = mapping.get(options.get('script_url'))
                    if paths.get(identity) != path:
                        unrelated = True
                        continue
                    options = deepcopy(options)
                    options['script_url'] = base_url.rstrip('/')+'/'+quote(path,safe='/')
                    entries.append({stage: options})
            if not entries or unrelated:
                continue
            subset = {key:deepcopy(obj[key]) for key in ('compat_arguments','compat_arguments_desc','env_schema','env') if key in obj}
            subset['scriptings'] = entries
            if obj.get('dns'):
                subset['dns'] = deepcopy(obj['dns'])
            if obj.get('mitm'):
                subset['mitm'] = deepcopy(obj['mitm'])
            module_url = base_url.rstrip('/')+'/'+quote(artifact_path(source),safe='/')
            config = dump(subset).rstrip()
            note = ('配套模块：'+module_url+'\n'
                '将此地址添加到 Egern 模块并启用。以下为该模块中本脚本的配置，无需重复添加：\n\n'
                +config)
            candidates[path].append((len(config), module_url, note))
    return {identity:'用法\n'+min(candidates[path])[2]
            for identity,path in paths.items() if candidates[path]}
