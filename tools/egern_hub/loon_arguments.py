"""Parse plugin parameters and bind them to documented Egern module parameters."""
import csv
import json
import re


def declaration(line, defaults, schema=None):
    key, sep, value = line.partition('='); key = key.strip()
    if not sep or not re.fullmatch(r'[\w-]+',key) or key in defaults:
        raise ValueError('无效或重复的 Loon 参数')
    fields = next(csv.reader([value.strip()],skipinitialspace=True))
    control = fields.pop(0).strip(); choices=[]; metadata={}
    for field in fields:
        name, sep, value = field.partition('=')
        if sep:
            if name.strip() not in {'tag','desc','type'} or name.strip() in metadata:
                raise ValueError('未知或重复的 Loon 参数属性')
            metadata[name.strip()] = value.strip()
        elif metadata and field.strip():
            # Old tag text may itself include commas.
            if 'tag' not in metadata:
                raise ValueError('参数选项顺序错误')
            metadata['tag'] += ','+field.strip()
        else:
            choices.append(field.strip())
    kind = metadata.get('type','boolean' if control=='switch' else 'string').lower()
    if control not in {'input','select','switch'} or kind not in ({'boolean'} if control=='switch' else {'string','number'}):
        raise ValueError('无效参数控件或类型')
    def typed(value):
        if kind=='boolean':
            if value not in {'true','false'}:raise ValueError('开关必须是 true/false')
            return value=='true'
        if kind=='number':
            number=json.loads(value)
            if isinstance(number,bool) or not isinstance(number,(int,float)):raise ValueError('无效数值参数')
            return number
        return value
    values=[typed(v) for v in choices]
    defaults[key]=values[0] if values else ''
    if schema is not None:
        scalar=lambda value: str(value).lower() if isinstance(value,bool) else str(value)
        entry={'name':metadata.get('tag',key),'default_value':scalar(defaults[key])}
        if metadata.get('desc'):entry['description']=metadata['desc']
        if control=='switch':entry['options']=['true','false']
        elif control=='select':entry['options']=[scalar(v) for v in values]
        schema[key]=entry
    return metadata.get('tag',key)+('：'+metadata['desc'] if metadata.get('desc') else '')


def bind(options, defaults):
    native={}
    enable=options.pop('enable',options.pop('enabled','true'))
    if enable not in {'true','false'}:
        match=re.fullmatch(r'\{([\w-]+)\}',enable)
        if not match or not isinstance(defaults.get(match[1]),bool):raise ValueError('启停开关必须引用已声明布尔参数'+('：'+match[1]+'（无法推断未声明开关的默认值）' if match else ''))
        options.setdefault('_env',{})['_hub_enabled']='{{{'+match[1]+'}}}'
        native['enabled_env']=True
    elif enable=='false':
        options['_disabled']=True
    argument=options.get('argument')
    keys = object_keys(argument)
    if keys is not None:
        if len(keys)!=len(set(keys)) or any(k not in defaults for k in keys):raise ValueError('对象参数引用未声明或重复的参数')
        chunks=[]
        for k in keys:
            value='{{{'+k+'}}}'
            if isinstance(defaults[k],str):value=json.dumps(value)
            chunks.append(json.dumps(k)+':'+value)
        options['argument']='{'+','.join(chunks)+'}'
        native['argument_object']=True
    elif argument:
        options['argument']=re.sub(r'\{([\w-]+)\}',lambda m:'{{{'+m[1]+'}}}' if m[1] in defaults else m[0],argument)
    return native


def object_keys(argument):
    """Both published Loon object-argument spellings preserve scalar types."""
    if argument and re.fullmatch(r'\{[\w,\s-]+\}', argument):
        return [k.strip() for k in argument[1:-1].split(',')]
    if argument and re.fullmatch(r'\[\s*\{[\w-]+\}(?:\s*,\s*\{[\w-]+\})*\s*\]', argument):
        return re.findall(r'\{([\w-]+)\}', argument)
    return None


def referenced_keys(options):
    return set(re.findall(r'(?<!\{)\{([\w-]+)\}(?!\})',
                          options.get('argument', '')+' '+options.get('enable', options.get('enabled', ''))))


def harmonize(scriptings, canonicalize):
    """Share a compiled dependency across optional typed arguments / enable flags.

    Rule-specific env stays on each rule. Raw string arguments cannot share the
    object decoder; unknown contracts remain errors instead of being combined.
    """
    groups = {}
    for entry in scriptings:
        for options in entry.values():
            groups.setdefault(canonicalize(options['script_url']), []).append(options)
    for entries in groups.values():
        contracts = [entry.get('_native_options', {}) for entry in entries]
        allowed = {'argument_object', 'enabled_env'}
        if any(set(contract)-allowed or any(value is not True for value in contract.values()) for contract in contracts):
            raise ValueError('未知脚本参数契约，不能合并')
        shared = {key:True for contract in contracts for key in contract}
        if shared.get('argument_object') and any(not contract.get('argument_object') and 'argument' in entry.get('env', {})
                                                for entry, contract in zip(entries, contracts)):
            raise ValueError('同一模块同脚本同时使用原始字符串与对象参数，无法共用参数解码契约')
        if shared:
            for entry in entries:
                entry['_native_options'] = dict(shared)
