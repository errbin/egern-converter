"""Parse Loon's public V2 DSL as data, without executing configuration text.

References: nsloon.app/docs/{Script/script_v2,Rewrite/rewrite_v2}/.
Token boundaries follow strings, raw strings, regexes and balanced containers;
commas and pipes inside those values are never statement separators.
"""
from dataclasses import dataclass
import json
import re

from .body_syntax import key_path


@dataclass(frozen=True)
class Regex:
    pattern: str
    flags: str = ''

    def native(self):
        return ('(?'+self.flags+':'+self.pattern+')') if self.flags else self.pattern


@dataclass(frozen=True)
class Variable:
    name: str


@dataclass(frozen=True)
class String:
    value: str
    raw: bool = False


@dataclass(frozen=True)
class PluginObject:
    keys: tuple


class Parser:
    def __init__(self, source):
        self.source, self.pos = source, 0

    def space(self):
        while self.pos < len(self.source) and self.source[self.pos].isspace():
            self.pos += 1

    def take(self, value):
        self.space()
        if self.source.startswith(value, self.pos):
            self.pos += len(value)
            return True
        return False

    def expect(self, value):
        if not self.take(value):
            raise ValueError(f'Loon V2 第 {self.pos+1} 列：需要 {value}')

    def word(self):
        self.space()
        match = re.match(r'[\w.-]+', self.source[self.pos:])
        if not match:
            raise ValueError(f'Loon V2 第 {self.pos+1} 列：需要名称')
        self.pos += len(match[0])
        return match[0]

    def value(self):
        self.space()
        start = self.pos
        if self.take('${'):
            end = self.source.find('}', self.pos)
            if end < 0:
                raise ValueError('Loon V2 变量未闭合')
            name = self.source[self.pos:end]
            self.pos = end+1
            return Variable(name)
        if self.take('`'):
            chunks = []
            while self.pos < len(self.source):
                c = self.source[self.pos]
                self.pos += 1
                if c == '`':
                    if self.pos < len(self.source) and self.source[self.pos] == '`':
                        chunks.append('`'); self.pos += 1
                    else:
                        return String(''.join(chunks), True)
                else:
                    chunks.append(c)
            raise ValueError('Loon V2 原始字符串未闭合')
        if self.take('"'):
            chunks = []
            while self.pos < len(self.source):
                c = self.source[self.pos]; self.pos += 1
                if c == '"':
                    return String(''.join(chunks))
                if c == '\\':
                    if self.pos == len(self.source):
                        break
                    c = self.source[self.pos]; self.pos += 1
                    if c == '$' and self.source.startswith('{', self.pos):
                        chunks.append('\\$'); continue
                    if c not in {'"', '\\', 'n', 'r', 't'}:
                        raise ValueError('Loon V2 字符串包含未知转义：\\'+c)
                    c = {'n':'\n', 'r':'\r', 't':'\t'}.get(c, c)
                chunks.append(c)
            raise ValueError('Loon V2 字符串未闭合')
        if self.take('/'):
            chunks, inside_class = [], False
            while self.pos < len(self.source):
                c = self.source[self.pos]; self.pos += 1
                if c == '\\':
                    if self.pos == len(self.source): break
                    chunks.extend((c,self.source[self.pos])); self.pos += 1
                elif c == '/' and not inside_class:
                    match = re.match(r'[A-Za-z]*',self.source[self.pos:])
                    flags = match[0]; self.pos += len(flags)
                    if set(flags)-set('ims') or len(set(flags))!=len(flags):
                        raise ValueError('Loon V2 正则仅支持不重复的 i/m/s 标记；请检查未转义的 /')
                    return Regex(''.join(chunks), flags)
                else:
                    if c == '[': inside_class = True
                    elif c == ']': inside_class = False
                    chunks.append(c)
            raise ValueError('Loon V2 正则未闭合')
        if self.take('['):
            return self.values(']')
        if self.take('{'):
            self.space()
            if self.source.startswith('${', self.pos):
                keys = []
                while True:
                    variable = self.value()
                    if not isinstance(variable, Variable) or not re.fullmatch(r'[\w-]+', variable.name):
                        raise ValueError('Loon V2 对象参数只能引用插件参数')
                    keys.append(variable.name)
                    if self.take('}'): break
                    self.expect(',')
                if len(set(keys)) != len(keys):
                    raise ValueError('Loon V2 对象参数重复')
                return PluginObject(tuple(keys))
            result = {}
            if self.take('}'): return result
            while True:
                key = self.value()
                if not isinstance(key, String) or key.value in result:
                    raise ValueError('Loon V2 JSON 对象需要不重复的字符串键')
                self.expect(':'); result[key.value] = self.value()
                if self.take('}'): return result
                self.expect(',')
        for name, value in [('true',True),('false',False),('null',None)]:
            if self.source.startswith(name,self.pos) and not re.match(r'[\w.-]',self.source[self.pos+len(name):self.pos+len(name)+1]):
                self.pos += len(name); return value
        match = re.match(r'-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?',self.source[self.pos:])
        if match:
            self.pos += len(match[0]); return json.loads(match[0])
        raise ValueError(f'Loon V2 第 {start+1} 列：无效值或缺少字符串引号')

    def values(self, end):
        values = []
        if self.take(end): return values
        while True:
            values.append(self.value())
            if self.take(end): return values
            self.expect(',')

    def condition(self, level=0):
        if level < 2:
            left = self.condition(level+1)
            op = ('||','&&')[level]
            while self.take(op):
                left = (op, left, self.condition(level+1))
            return left
        if self.take('('):
            expression = self.condition(); self.expect(')'); return expression
        left = self.value()
        if self.take('~='): op = '~='
        elif self.take('=='): op = '=='
        else: raise ValueError('Loon V2 条件需要 == 或 ~=')
        right = self.value()
        capture = None
        self.space()
        if re.match(r'as\s',self.source[self.pos:]):
            self.expect('as'); capture = self.word()
        return (op, left, right, capture)

    def finish(self):
        self.space()
        if self.pos != len(self.source):
            raise ValueError(f'Loon V2 第 {self.pos+1} 列：未识别的剩余内容 {self.source[self.pos:self.pos+45]}')


def parse(line, *, defaults=None, repairs=None, parameter_loader=None):
    parser = Parser(line)
    phase = parser.word()
    if phase in {'request','response'}:
        parser.expect('if'); condition = parser.condition()
    elif phase == 'cron':
        condition = parser.value()
    elif phase in {'generic','network-changed'}:
        condition = None
    else:
        raise ValueError('Loon V2 未知触发类型：'+phase)
    parser.expect('then')
    actions = []
    while True:
        name = parser.word(); parser.expect('(')
        actions.append((name,parser.values(')')))
        if not parser.take('|'): break
    options = {}
    if parser.take('with'):
        while True:
            name = parser.word(); parser.expect('=')
            if name in options: raise ValueError('Loon V2 重复属性：'+name)
            parser.space()
            # Some published migrations retain a bare legacy enable key. Only
            # a complete token declared as a boolean can establish its meaning.
            bare = re.match(r'([\w-]+)(?=\s*(?:,|$))',parser.source[parser.pos:])
            if (name=='enable' and bare and bare[1] not in {'true','false'}
                    and bare[1] not in (defaults or {}) and parameter_loader
                    and len(actions)==1 and actions[0][0]=='script' and actions[0][1]
                    and isinstance(actions[0][1][0],String)):
                parameter_loader(actions[0][1][0].value,{bare[1]})
            if name=='enable' and bare and bare[1] not in {'true','false'} and type((defaults or {}).get(bare[1])) is bool:
                parser.pos += len(bare[0])
                options[name] = Variable(bare[1])
                if repairs is not None:
                    repairs.append({'parameter':bare[1], 'reason':'将已声明布尔参数的旧式裸 enable 引用规范为 V2 变量引用'})
            else:
                options[name] = parser.value()
            if not parser.take(','): break
    parser.finish()
    return phase, condition, actions, options


def literal(value, defaults):
    if isinstance(value, Variable):
        if value.name not in defaults: raise ValueError('Loon V2 未声明参数：'+value.name)
        # Preserve runtime parameter substitution, never bake in a user's default.
        return '{{{'+value.name+'}}}'
    if isinstance(value, String):
        if value.raw: return value.value
        def replace(match):
            if match[1] not in defaults: raise ValueError('Loon V2 未声明参数或捕获：'+match[1])
            return '{{{'+match[1]+'}}}'
        return re.sub(r'(?<!\\)\$\{([^{}]+)\}',replace,value.value).replace('\\${','${')
    if isinstance(value, list): return [literal(v,defaults) for v in value]
    if isinstance(value, dict): return {k:literal(v,defaults) for k,v in value.items()}
    if value is None or type(value) in (bool,int,float): return value
    raise ValueError('Loon V2 该位置需要静态标量或已声明的插件参数')


def url_condition(condition):
    """Native URL match only; never discard method/header/status predicates."""
    if condition[0] == '||':
        return '(?:'+url_condition(condition[1])+')|(?:'+url_condition(condition[2])+')'
    if condition[0] == '&&':
        return '(?=[\\s\\S]*(?:'+url_condition(condition[1])+'))(?=[\\s\\S]*(?:'+url_condition(condition[2])+'))'
    op,left,right,capture = condition
    if left != Variable('url'):
        raise ValueError('Loon V2 此条件需要原生脚本条件编译，不能丢弃方法、状态或 Header 条件')
    if op == '~=' and isinstance(right, Regex): return right.native()
    if op == '==' and isinstance(right,String) and (right.raw or '${' not in right.value):
        return '^(?:'+re.escape(right.value)+')$'
    raise ValueError('Loon V2 URL 条件需要正则或固定字符串')


def json_expression(value, defaults):
    if isinstance(value, Variable):
        text=literal(value,defaults)
        return json.dumps(text,ensure_ascii=False) if isinstance(defaults[value.name],str) else text
    if isinstance(value,list):return '['+','.join(json_expression(v,defaults) for v in value)+']'
    if isinstance(value,dict):return '{'+','.join(json.dumps(k)+':'+json_expression(v,defaults) for k,v in value.items())+'}'
    return json.dumps(literal(value,defaults),ensure_ascii=False)


def script_entry(parsed, defaults):
    from .loon_arguments import bind
    phase, condition, actions, attributes = parsed
    if len(actions)!=1 or actions[0][0]!='script': raise ValueError('Loon V2 Script 必须只有一个 script() 动作')
    args = actions[0][1]
    if not 1 <= len(args) <= 2 or not isinstance(args[0],String) or '${' in args[0].value or not args[0].value:
        raise ValueError('Loon V2 script() 需要固定路径和可选参数')
    allowed = {'enable','tag','img_url','timeout','debug','requires_body','binary_body_mode'}
    if set(attributes)-allowed: raise ValueError('Loon V2 未知 Script 属性：'+','.join(sorted(set(attributes)-allowed)))
    options = {}
    enable = attributes.get('enable',True)
    options['enable'] = '{'+enable.name+'}' if isinstance(enable,Variable) else str(enable).lower()
    string_argument = None
    if len(args)==2:
        arg=args[1]
        if isinstance(arg,PluginObject): options['argument']='{'+','.join(arg.keys)+'}'
        elif isinstance(arg,String): string_argument=literal(arg,defaults)
        else: raise ValueError('Loon V2 Script 参数必须为字符串或插件对象')
    native = bind(options,defaults)
    if string_argument is not None: options['argument']=string_argument
    kind={'request':'http_request','response':'http_response','cron':'schedule','generic':'generic','network-changed':'network'}[phase]
    if 'tag' in attributes and not isinstance(attributes['tag'],String):raise ValueError('Loon V2 tag 需要固定字符串')
    entry={'name':literal(attributes.get('tag',String('')),defaults),'script_url':args[0].value,
           'timeout':20 if phase in {'request','response'} else 300}
    if kind.startswith('http_'): entry['match']=url_condition(condition)
    elif phase=='cron':
        entry['cron']=literal(condition,defaults)
        if not isinstance(condition,(Variable,String)):raise ValueError('Loon V2 Cron 需要字符串或插件参数')
    if phase not in {'request','response'} and set(attributes)&{'requires_body','binary_body_mode'}:
        raise ValueError('Loon V2 非 HTTP Script 不接受 Body 属性')
    for old,new in [('requires_body','body_required'),('binary_body_mode','binary_body')]:
        if old in attributes:
            if type(attributes[old]) is not bool: raise ValueError('Loon V2 '+old+' 必须为布尔值')
            entry[new]=attributes[old]
    if 'timeout' in attributes:
        timeout=attributes['timeout']
        if type(timeout) is not int or not 1<=timeout<=600: raise ValueError('Loon V2 timeout 需要 1–600 的整数；动态超时暂不转换')
        entry['timeout']=timeout
    if attributes.get('debug',False) is not False:
        raise ValueError('Loon V2 debug 尚无等价的原生脚本日志开关映射')
    if 'img_url' in attributes:
        # Icon metadata belongs to the module; it is not an Egern scripting key.
        if not isinstance(attributes['img_url'],String):raise ValueError('Loon V2 img_url 需要字符串')
    if options.get('_disabled'):entry['disabled']=True
    if options.get('_env'):entry['env']=options['_env']
    if 'argument' in options:entry.setdefault('env',{})['argument']=options['argument']
    if native:entry['_native_options']=native
    return {kind:entry}


def rewrite_entries(parsed, defaults, loader=None):
    phase,condition,actions,options=parsed
    if phase not in {'request','response'} or options:raise ValueError('Loon V2 Rewrite 不接受此触发类型或 with 属性')
    pattern=url_condition(condition)
    output=[]
    if len(actions)>1 and any(name.startswith('reject') for name,_ in actions):
        raise ValueError('Loon V2 终止响应管道尚未合并为单个原生响应，不能拆分执行')
    mock_actions=[name for name,_ in actions if name in {'response.body.mock','response.body.mock_file'}]
    if mock_actions and (len(mock_actions)!=1 or len(actions)!=1):
        raise ValueError('Loon V2 Mock 与 Header 管道需要合并为同一原生响应，当前不拆分执行')
    if any(name in {'url.replace','redirect'} for name,_ in actions) and len(actions)!=1:
        raise ValueError('Loon V2 URL 修改管道需要保留修改后的条件与动作顺序，当前不拆分执行')
    for name,args in actions:
        # Batch arrays are zipped, never flattened or split inside JSON values.
        batch = '.header.' in name or '.body.replace' in name or name.endswith(('.json.add','.json.delete','.json.replace'))
        rows=[args]
        if batch and args and isinstance(args[0],list):
            if not args or not all(isinstance(a,list) and a for a in args) or len({len(a) for a in args})!=1:
                raise ValueError('Loon V2 批量参数需要等长非空数组，不能与单值混用')
            rows=list(zip(*args))
        for values in rows:
            values=list(values)
            if name in {'url.replace','redirect'} and values and isinstance(values[-1],String):
                # Loon condition captures are scoped to their declaration;
                # Egern URL replacements use the same pattern's $n references.
                source=values[-1]
                if re.search(r'(?<!\\)\$\d',source.value):raise ValueError('Loon V2 URL 替换必须使用命名捕获，不能直接填写 $n')
                if not source.raw and condition[0]=='~=' and condition[1]==Variable('url') and condition[3]:
                    capture=condition[3]
                    def replace_capture(match):
                        if match[1]!=capture:raise ValueError('Loon V2 URL 替换引用了其他捕获或插件参数')
                        if match[2]=='0':raise ValueError('Loon V2 URL 完整匹配捕获尚未映射')
                        return '$'+match[2]
                    value=re.sub(r'(?<!\\)\$\{([\w-]+)\.(\d+)\}',replace_capture,source.value)
                    values[-1]=String(value)
            compiled=rewrite_action(phase,pattern,name,values,defaults,loader)
            for field,entry in compiled:
                if field=='_header_actions':
                    if condition[0]=='~=' and condition[1]==Variable('url') and isinstance(condition[2],Regex):
                        entry['match']=condition[2].pattern
                        if condition[2].flags:entry['flags']=condition[2].flags
                    elif '(?' in pattern and re.search(r'\(\?[ims]',pattern):
                        raise ValueError('Loon V2 复合条件内的独立正则标记需要原生条件脚本编译')
            output.extend(compiled)
    # Keep a pipeline's native actions together, in source order.
    if output and all(field=='rewrites' for field,_ in output):
        return [('rewrites',{'match':pattern,'actions':[action for _,row in output for action in row['actions']]})]
    if len(output)>1 and len({field for field,_ in output})>1:
        raise ValueError('Loon V2 此管道需要跨原生阶段保持顺序，不能拆成无序配置字段')
    return output


def rewrite_action(phase,pattern,name,args,defaults,loader):
    def count(low,high=None):
        if not low<=len(args)<=(low if high is None else high):raise ValueError('Loon V2 '+name+' 参数数量不正确')
    def string(value):
        if not isinstance(value,String):raise ValueError('Loon V2 '+name+' 需要字符串')
        return literal(value,defaults)
    def response(status,headers=None,body=''):
        if type(status) is not int or not 100<=status<=599:raise ValueError('Loon V2 响应状态码无效')
        return [('rewrites',{'match':pattern,'actions':[{'respond':{'status':status,'headers':headers or {},'body':body}}]})]
    if name.startswith('reject'):
        if phase!='request':raise ValueError('Loon V2 Reject 必须在 request 阶段')
        if name=='reject':
            count(1,2);return response(args[0],{'Content-Type':'text/plain; charset=utf-8'} if len(args)==2 else {},string(args[1]) if len(args)==2 else '')
        count(1)
        if name in {'reject_dict','reject_array'}:
            return response(args[0],{'Content-Type':'application/json'},'{}' if name=='reject_dict' else '[]')
        if name in {'reject_img','reject_video'} and args==[200]:
            return [('url_rewrites',{'match':pattern,'location':'http://'+name.replace('_','-')+'/'})]
        raise ValueError('Loon V2 '+name+' 此状态码尚无等价原生预置响应')
    if name in {'url.replace','redirect'}:
        if phase!='request':raise ValueError('Loon V2 URL 修改必须在 request 阶段')
        count(1 if name=='url.replace' else 2)
        location=string(args[-1])
        if '${' in location:raise ValueError('Loon V2 URL 捕获需要独立的捕获绑定，不能直接复用 Action 捕获')
        data={'match':pattern,'location':location}
        if name=='redirect':
            if type(args[0]) is not int or args[0] not in {302,307}:raise ValueError('Loon V2 redirect 仅支持 302/307')
            data['status_code']=args[0]
        return [('url_rewrites',data)]
    match=re.fullmatch(r'(request|response)\.(header|body|json)\.(\w+)',name)
    if not match or match[1]!=phase:raise ValueError('Loon V2 未知或阶段不匹配的 Action：'+name)
    _,kind,action=match.groups()
    if kind=='header':
        if action not in {'add','set','del','replace'}:raise ValueError('Loon V2 未知 Header Action：'+action)
        count(1 if action=='del' else 3 if action=='replace' else 2)
        key=string(args[0])
        if not re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+",key) or key.lower() in {'content-length','transfer-encoding'}:raise ValueError('Loon V2 无效或消息分帧 Header')
        if action=='del':return [('header_rewrites',{'delete':{'match':pattern,'name':key,'type':phase}})]
        if action in {'set','add'}:
            value=string(args[1])
            if any(c in value for c in '\r\n\0'):raise ValueError('Loon V2 Header 值不得包含换行或 NUL')
            if action=='set':return [('rewrites',{'match':pattern,'actions':[{phase+'_headers':{'set':{key:value}}}]})]
            return [('_header_actions',{'match':pattern,'type':phase,'action':'add','name':key,'value':value})]
        raise ValueError('Loon V2 Header 正则替换需要保留多值及缺失头语义，暂未原生编译')
    if kind=='body' and action=='replace':
        count(2)
        if not isinstance(args[0],Regex):raise ValueError('Loon V2 Body Replace 需要正则')
        return [('rewrites',{'match':pattern,'actions':[{phase+'_body':{'regex':args[0].native(),'replacement':string(args[1])}}]})]
    if kind=='json':
        if action in {'jq','jq_file'}:
            count(1); expression=string(args[0])
            if action=='jq_file':
                if loader is None:raise ValueError('Loon V2 jq_file 需要原作者仓库解析器')
                expression=loader(expression)
        elif action in {'add','replace','delete'}:
            count(1 if action=='delete' else 2)
            path=key_path(string(args[0])); p=json.dumps(path,ensure_ascii=False)
            if action=='delete':expression='delpaths(['+p+'])'
            else:
                value=json_expression(args[1],defaults)
                expression='setpath('+p+'; '+value+')'
                if action=='replace':
                    parent=json.dumps(path[:-1],ensure_ascii=False);leaf=json.dumps(path[-1],ensure_ascii=False)
                    expression='if (getpath('+parent+') | has('+leaf+')) then '+expression+' else . end'
        else:raise ValueError('Loon V2 未知 JSON Action：'+action)
        return [('rewrites',{'match':pattern,'actions':[{phase+'_body':{'jq':expression}}]})]
    if kind=='body' and action in {'mock','mock_file'}:
        count(2,4 if phase=='response' else 3)
        mime=string(args[0]);body=string(args[1])
        if action=='mock_file':
            if loader is None:raise ValueError('Loon V2 mock_file 需要原作者仓库解析器')
            body=loader(body)
        status=args[2] if phase=='response' and len(args)>2 else 200
        binary=args[3] if phase=='response' and len(args)>3 else args[2] if phase=='request' and len(args)>2 else False
        if type(binary) is not bool:raise ValueError('Loon V2 Mock Base64 标记必须为布尔值')
        if phase=='request':raise ValueError('Loon V2 request.body.mock 尚未原生编译；不能误转成响应 Mock')
        import base64
        types={'json':'application/json','text':'text/plain','plain':'text/plain','text/event-stream':'text/event-stream',
               'css':'text/css','html':'text/html','javascript':'application/javascript','png':'image/png','gif':'image/gif',
               'jpeg':'image/jpeg','tiff':'image/tiff','svg':'image/svg+xml','mp4':'video/mp4','form-data':'multipart/form-data'}
        if mime not in types:raise ValueError('Loon V2 未知 Mock 内容类型：'+mime)
        value=body
        if binary:
            base64.b64decode(body,validate=True)
            value={'base64':body}
        return response(status,{'Content-Type':types[mime]},value)
    raise ValueError('Loon V2 未知 Action：'+name)
