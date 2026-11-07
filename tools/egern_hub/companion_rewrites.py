"""Recover malformed V2 replacement quoting only from its classic companion."""
import json
from .body_syntax import body_rewrite
from .loon_normalize import normalize
from .loon_v2 import Parser, Regex, Variable


def recover_script_contract(parsed, documents):
    """Restore omitted binary/object argument declarations from exact peers."""
    import re
    from .convert import canonical_script_url,script_options
    from .loon_arguments import object_keys
    from .loon_v2 import String,PluginObject
    phase,condition,actions,attributes=parsed
    if phase not in {'request','response'} or len(actions)!=1 or actions[0][0]!='script':return None
    args=actions[0][1]
    if not args or not isinstance(args[0],String):return None
    if not (len(condition)==4 and condition[0]=='~=' and condition[1]==Variable('url') and isinstance(condition[2],Regex)):
        return None
    candidates=[]
    for document in documents:
        for number,line in enumerate(document['text'].splitlines(),1):
            match=re.fullmatch(r'\s*http-'+phase+r'\s+(\S+)\s+(.+)',line)
            if not match or match[1]!=condition[2].pattern:continue
            try:options=script_options(match[2],loon_tags=True)
            except ValueError:continue
            if canonical_script_url(options.get('script-path',''))!=canonical_script_url(args[0].value):continue
            restored={}
            if 'binary_body_mode' not in attributes and options.get('binary-body-mode') in {'true','false'}:
                restored['binary_body_mode']=options['binary-body-mode']=='true'
            keys=object_keys(options.get('argument'))
            if len(args)==1 and keys:restored['argument_parameters']=keys
            candidates.append((restored,document['source'],number))
    if not candidates:return None
    if len({json.dumps(row[0],sort_keys=True) for row in candidates})!=1:
        raise ValueError('经典配套声明存在冲突，不能恢复 V2 脚本参数契约')
    restored,source,number=candidates[0]
    if not restored:return None
    attributes=dict(attributes);args=list(args)
    if 'binary_body_mode' in restored:attributes['binary_body_mode']=restored['binary_body_mode']
    if 'argument_parameters' in restored:args.append(PluginObject(tuple(restored['argument_parameters'])))
    return (phase,condition,[(actions[0][0],args)],attributes),{
        'source':source,'source_line':number,'restored':restored,
        'reason':'按同目录经典配套模块的相同阶段 / URL 正则 / 脚本地址补全 V2 遗漏的二进制或对象参数契约；已有值不覆盖'}


def recover_replacement(line, documents):
    parser=Parser(line)
    try:
        phase=parser.word();parser.expect('if');condition=parser.condition();parser.expect('then')
        action=parser.word();parser.expect('(');find=parser.value();parser.expect(',');parser.space()
    except ValueError:
        return None
    if phase not in {'request','response'} or action!=phase+'.body.replace' or not isinstance(find,Regex) or find.flags:
        return None
    if not (isinstance(condition,tuple) and len(condition)==4 and condition[0]=='~='
            and condition[1]==Variable('url') and isinstance(condition[2],Regex) and not condition[2].flags):
        return None
    if not line.endswith(')'):
        return None
    malformed=line[parser.pos:-1].strip()
    matches=[]
    for document in documents:
        for number,original in enumerate(document['text'].splitlines(),1):
            original=original.strip()
            fixed,_=normalize(original,'rewrite',lambda *args,**kwargs:None)
            try:
                rows=body_rewrite(fixed)
            except ValueError:
                continue
            for row in rows or []:
                data=row.get(phase+'_regex',{})
                if data.get('match')!=condition[2].pattern or data.get('find')!=find.pattern:
                    continue
                replacement=data['replace']
                variants={replacement,'"'+replacement+'"'}
                if fixed!=original:
                    variants.add('"'+phase+'-body '+replacement+'"')
                if malformed in variants:
                    matches.append((replacement,document['source'],number))
    if not matches or len({row[0] for row in matches})!=1:
        return None
    replacement,source,number=matches[0]
    return line[:parser.pos]+json.dumps(replacement,ensure_ascii=False)+')', {
        'source':source,'source_line':number,
        'reason':'按同仓库经典配套规则的相同 URL / 查找式恢复 V2 替换字符串，拒绝猜测引号边界'}
