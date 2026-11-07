"""Bounded deterministic synthetic cases, based on module matches and AST reads."""
import itertools
import json
import re
from urllib.parse import urlsplit,urlunsplit
from re import _parser, _constants as op


def sample_text(pattern, limit=4):
    """Construct candidates for common JavaScript regex syntax; confirm the match."""
    if len(pattern)>2000:return []
    def expand(tokens,depth=0):
        if depth>12:return []
        values=['']
        for kind,value in tokens:
            if kind==op.LITERAL: choices=[chr(value)]
            elif kind==op.NOT_LITERAL: choices=['x' if value!=120 else 'a']
            elif kind==op.ANY: choices=['x']
            elif kind==op.AT or kind in {op.ASSERT,op.ASSERT_NOT}: choices=['']
            elif kind==op.SUBPATTERN: choices=expand(value[-1],depth+1)
            elif kind==op.BRANCH: choices=list(itertools.islice((s for branch in value[1] for s in expand(branch,depth+1)),limit))
            elif kind in {op.MAX_REPEAT,op.MIN_REPEAT}:
                low,high,body=value
                unit=expand(body,depth+1)
                choices=list(itertools.islice((''.join(parts) for parts in itertools.product(unit,repeat=min(max(low,1),8)) if sum(map(len,parts))<4000),limit))
                if low==0:choices+=['']
            elif kind==op.IN:
                choices=[]
                if value and value[0][0]==op.NEGATE:
                    choices=[next((c for c in 'x1a' if all(k!=op.LITERAL or ord(c)!=v for k,v in value[1:])),'x')]
                for k,v in value:
                    if value and value[0][0]==op.NEGATE:break
                    if k==op.LITERAL:choices.append(chr(v))
                    elif k==op.RANGE:choices.append(chr(v[0]))
                    elif k==op.CATEGORY:choices.append('1' if v==op.CATEGORY_DIGIT else ' ' if v==op.CATEGORY_SPACE else 'a')
                choices=choices[:limit] or ['x']
            elif kind==op.CATEGORY:choices=['1' if value==op.CATEGORY_DIGIT else ' ' if value==op.CATEGORY_SPACE else 'a']
            else:choices=['x']
            values=[a+b for a in values for b in choices if len(a)+len(b)<4000][:limit]
        return values
    try:
        compiled=re.compile(pattern)
        return [s for s in expand(_parser.parse(pattern,0)) if len(s)<4000 and compiled.search(s)]
    except (re.error,ValueError,OverflowError,RecursionError):
        return []


def sample_urls(pattern, limit=4):
    return [s for s in sample_text(pattern,limit) if s.startswith(('https://','http://'))]


def skeleton(paths, variant=0, containers=(), json_fields=()):
    root={}
    def leaf(name):
        if re.search(r'(?i)^(is|has|show|can)|vip|premium|enabled|active|paid|purchased',name):return bool(variant)
        if re.search(r'(?i)id$|count|num|status|code|type|level|price|balance|expire|time',name):return variant
        return 'fixture' if variant==0 else 'ad'
    for path in sorted(paths,key=lambda p:(len(p),p)):
        if not path or any(p in {'__proto__','prototype','constructor'} for p in path):continue
        current=root
        for i,key in enumerate(path):
            last=i==len(path)-1
            next_array=not last and path[i+1].isdigit()
            if isinstance(current,list):
                if not key.isdigit():break
                index=min(int(key),2)
                while len(current)<=index:current.append({})
                if last:break
                if not isinstance(current[index],(dict,list)):current[index]=[] if next_array else {}
                current=current[index]
            elif isinstance(current,dict):
                if last:current.setdefault(key,leaf(key));break
                if key not in current or not isinstance(current[key],(dict,list)):current[key]=[] if next_array else {}
                current=current[key]
            else:break
    for path in containers:
        current=root
        for key in path:
            if not isinstance(current,dict) or key in {'__proto__','constructor','prototype'}:break
            if not isinstance(current.get(key),dict):current[key]={}
            current=current[key]
    for path in json_fields[:8]:
        current=root
        for key in path[:-1]:
            if not isinstance(current,dict):break
            current=current.get(key)
        if path and isinstance(current,dict):
            encoded=json.dumps(root,separators=(',',':'))
            if len(encoded)>40000:break
            current[path[-1]]=encoded
    return root


def generated_cases(hints, contexts):
    context_known=bool(contexts)
    contexts=contexts or [{'stage':'http_response','match':'^https://example.test/'}]
    cases=[]
    for context in contexts[:8]:
        pattern=context.get('match','')
        try:compiled=re.compile(pattern) if pattern else None
        except re.error:compiled=None
        urls=sample_urls(pattern)
        if not urls:urls=['https://example.test/']
        # Exercise path/query guards using literal fragments, never credential values.
        try:
            candidates=[]
            fragments=[s for s in hints.get('strings',[]) if re.fullmatch(r'/?[A-Za-z0-9_./-]{3,90}|[A-Za-z_]{2,30}=',s)]
            literals=[s for s in hints.get('strings',[]) if s.startswith(('https://','http://')) and not urlsplit(s).query]
            domains=[s for s in hints.get('object_keys',[])+hints.get('strings',[]) if re.fullmatch(r'(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,20}',s)]
            for base in urls[:4]:
                parsed=urlsplit(base)
                literals.extend(urlunsplit((parsed.scheme,host,parsed.path,parsed.query,'')) for host in domains[:30])
            # Literal URL guards resolve wildcard characters in broad module matches.
            urls=list(dict.fromkeys([u for u in literals if compiled and compiled.search(u)]+urls))[:4]
            for base in urls:
                parsed=urlsplit(base)
                for fragment in fragments[:40]:
                    if fragment.endswith('='):
                        candidate=base+('&' if '?' in base else '?')+fragment+'fixture'
                    else:
                        candidate=urlunsplit((parsed.scheme,parsed.netloc,'/'+fragment.lstrip('/'),'',''))
                    if compiled and compiled.search(candidate) and candidate not in urls:candidates.append(candidate)
            urls=list(dict.fromkeys(urls+candidates))[:8]
        except (re.error,ValueError):pass
        for url in urls:
            for variant in range(2):
                paths=hints.get('paths',[])+[[k] for k in hints.get('object_keys',[]) if re.fullmatch(r'[A-Za-z_]\w{0,50}',k)]
                value=skeleton(paths,variant,hints.get('containers',[]),hints.get('json_fields',[]))
                if variant:
                    guards=skeleton([[key] for key in hints.get('guard_keys',[])],variant)
                    for obj in [value]+[v for v in value.values() if isinstance(v,dict)]:
                        for key,seed in guards.items():obj.setdefault(key,seed)
                specimens=[]
                for regex in hints.get('regexes',[]):
                    for specimen in sample_text(regex,1):
                        specimens.append(specimen)
                        try:value.update(json.loads('{'+specimen+'}'))
                        except (ValueError,TypeError):pass
                body=json.dumps(value,ensure_ascii=False,separators=(',',':'))
                stage=context.get('stage','http_response')
                case={'name':f'generated-{len(cases)+1}', 'origin':'generated', 'entry_type':stage,
                      'request':{'url':url,'method':'POST' if variant else 'GET','headers':{'User-Agent':'Fixture','Content-Type':'application/json'},'body':body},
                      'argument':context.get('env',{}).get('argument',''), 'env':context.get('env',{}),
                      'generation':{'match':pattern,'url_matched':context_known and bool(compiled and compiled.search(url)),
                                    'entry_matched':context_known and stage in {'schedule','generic','network'},
                                    'variant':variant,'stage':stage}}
                if stage=='http_response':case['response']={'status':200 if variant==0 else 302,'headers':{'Content-Type':'application/json','Location':'https://example.test/target'},'body':body}
                cases.append(case)
                if variant==0 and specimens:
                    raw='\n'.join(specimens)[:16000]
                    prefixes=[s for s in hints.get('strings',[]) if re.fullmatch(r'<(?:!DOCTYPE|html)[\w\s>]*',s,re.I)]
                    if prefixes:raw=prefixes[0]+'\n'+raw
                    extra=json.loads(json.dumps(case))
                    extra['name']=f'generated-text-{len(cases)+1}'
                    extra['generation']['payload']='regex-matching-text'
                    extra['request']['body']=raw
                    if 'response' in extra:extra['response']['body']=raw
                    cases.append(extra)
    return cases[:48]


def contexts_for(sources):
    contexts={}
    for source in sources:
        mapping=source.get('script_map',{})
        for entry in source.get('_render_obj',{}).get('scriptings',[]):
            for stage,options in entry.items():
                identity=mapping.get(options.get('script_url'))
                if identity:
                    record={k:options[k] for k in ('match','env','body_required') if k in options}
                    defaults=source.get('_render_obj',{}).get('compat_arguments',{})
                    if 'env' in record:
                        record['env']={k:re.sub(r'\{\{\{([^{}]+)\}\}\}',lambda m:str(defaults.get(m[1],m[0])).lower() if isinstance(defaults.get(m[1]),bool) else str(defaults.get(m[1],m[0])),str(v)) for k,v in record['env'].items()}
                    record['stage']=stage
                    if record not in contexts.setdefault(identity,[]):contexts[identity].append(record)
    return contexts
