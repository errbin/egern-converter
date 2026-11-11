"""Request fields follow authored branch and sloppy-global assignments."""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL='https://example.test/record.js'


class HTTPRecordAssignmentTests(unittest.TestCase):
    def check(self,source,argument,expected):
        output=convert_script(source,'Fixture',URL,'',source_format='loon')
        case={'name':'live request record','argument':argument,'request':{'url':URL},
              'http':[{'url':'https://example.test/'+expected,'body':'ok'}],
              'expected':{'result':{'body':'ok'}}}
        result=compare(source,output,'loon',URL,case)
        self.assertEqual(result['status'],'passed',result)

    def test_local_branch_assignment_and_header_deletion_preserve_selected_record(self):
        source='''let options=null;
if($argument==='a'){options={url:'https://example.test/a',headers:{Cookie:'fixture',X:'a'}};delete options.headers.Cookie}
else{options={url:'https://example.test/b',headers:{X:'b'}}}
$httpClient.get(options,(e,r,b)=>$done({body:b}));'''
        for argument in ['a','b']:self.check(source,argument,argument)

    def test_sloppy_global_request_retains_url_appends_before_call(self):
        source='''url={url:'https://example.test/',headers:{X:'fixture'}};
if($argument==='stop')return $done({});
url.url+='record';$httpClient.get(url,(e,r,b)=>$done({body:b}));'''
        self.check(source,'continue','record')

    def test_closed_parameter_url_append_before_dispatch(self):
        # 请求对象作为参数进入函数后、在派发前对 url 做追加：保留实际执行，HTTP 在发送
        # 时读取更新后的实时 url；params 只参与拼接，不作为原生 HTTP 字段传出。
        source='''function send(t){t.params&&(t.url+='?'+t.params);$httpClient.get(t,(e,r,b)=>$done({body:b}))}
send({url:'https://example.test/path',params:'a=1'});'''
        self.check(source,'', 'path?a=1')

    def test_closed_parameter_snapshot_and_default_spread_before_dispatch(self):
        # 参数在入口可以重绑一次为新的展开快照；所有调用点省略默认参数，且自我展开
        # 的旧字段来自闭合实参时，字段集合仍然可枚举。
        source='''function send(t,defaults={}){t={...defaults,...t};t.method=t.method||'GET';t.url+='?snapshot=1';
$httpClient.get(t,(e,r,b)=>$done({body:b}))}
send({url:'https://example.test/path'});'''
        self.check(source,'','path?snapshot=1')

    def test_host_request_fields_forwarded_to_closed_helper(self):
        # 宿主请求可以作为闭合 helper 的来源；helper 只读取已列出的宿主字段，
        # 并在唯一派发前构造新的封闭请求记录。
        source='''function send(req){const options={url:req.url,headers:{...req.headers}};
options.url+='?from=request';$httpClient.get(options,(e,r,b)=>$done({body:b}))}
send($request);'''
        self.check(source,'','record.js?from=request')

    def test_host_request_is_snapshotted_before_closed_helper_mutations(self):
        # 宿主请求整体进入闭合 helper 时先复制为本地快照；helper 的 headers、body
        # 与本地元数据写入只影响快照，后续请求和完成处理读取同一对象身份。
        source='''function prepare(request){request.headers={...request.headers,'X-Prepared':'yes'};
request.body='prepared';request.localMeta='meta';return request}
async function finish(request,response){response.body=response.body+':'+request.localMeta;return response}
(async()=>{await prepare($request);const options={url:$request.url,method:'POST',headers:$request.headers,body:$request.body};
const response=await new Promise((resolve,reject)=>{$httpClient.post(options,(error,reply,body)=>{
if(error)reject(error);else{reply.body=body;resolve(reply)}})});
const result=await finish($request,response);$done({body:result.body})})();'''
        output=convert_script(source,'Fixture',URL,'',source_format='loon')
        self.assertIn('hostRequest',output)
        case={'name':'host request helper snapshot','request':{'url':URL,'method':'POST','body':'original',
                                                               'headers':{'X-Test':'yes'}},
              'http':[{'url':URL,'body':'reply','status':200}],
              'expected':{'result':{'body':'reply:meta'},
                          'events':{'requests':[{'url':URL,'method':'POST',
                                                 'headers':{'x-prepared':'yes'},'body':'prepared'}]}}}
        result=compare(source,output,'loon',URL,case)
        self.assertEqual(result['status'],'passed',result)

    def test_host_request_snapshot_rejects_aliases_escapes_and_dynamic_members(self):
        # 参数复制、交给未知函数或动态字段都会破坏快照身份与字段闭合性，
        # 必须保持拒绝。
        for source in [
            '''function prepare(request){const copy=request;copy.url+='?x';return copy}
(async()=>{await prepare($request);$done({})})();''',
            '''function prepare(request){unknown(request)}
(async()=>{await prepare($request);$done({})})();''',
            '''function prepare(request){request[$argument]='x';return request}
(async()=>{await prepare($request);$done({})})();''',
        ]:
            with self.subTest(source=source),self.assertRaises(ConversionError):
                convert_script(source,'Fixture',URL,'',source_format='loon')

    def test_host_request_custom_fields_stay_in_the_closed_snapshot(self):
        # 宿主请求上的自定义元数据只写入本地快照，并在闭合 helper 内读取；
        # 写入必须早于整对象转交，字段键静态可枚举，值不能回指宿主对象。
        source='''function prepare(request){return request.__cachedBody}
(async()=>{$request.__cachedBody='meta';$done({body:await prepare($request)})})();'''
        output=convert_script(source,'Fixture',URL,'',source_format='loon')
        self.assertIn('hostRequest',output)
        self.assertIn('"__cachedBody"',output)
        case={'name':'host request custom field','request':{'url':URL},
              'expected':{'result':{'body':'meta'}}}
        result=compare(source,output,'loon',URL,case)
        self.assertEqual(result['status'],'passed',result)

        for rejected in [
            '''function prepare(request){return request.url}
(async()=>{const value=prepare($request);$request.__cachedBody='late';$done({body:value})})();''',
            '''function prepare(request){return request.url}
(async()=>{$request.__cachedBody=$request;$done({body:await prepare($request)})})();''',
            '''function prepare(request){return 'x'}
(async()=>{$request[$argument]='x';$done({body:await prepare($request)})})();''',
            '''function prepare(request){return 'x'}
(async()=>{$request.constructor='x';$done({body:await prepare($request)})})();''',
        ]:
            with self.subTest(source=rejected),self.assertRaises(ConversionError):
                convert_script(rejected,'Fixture',URL,'',source_format='loon')

    def test_live_projection_preserves_request_headers(self):
        # 优先级必须保证 headers 的 ?? 先求值，否则请求会被错误地投影为空头。
        source='''const options={url:'https://example.test/path',headers:{Y:'base'}};
options.url+='?h=1';$httpClient.get(options,(e,r,b)=>$done({body:b}));'''
        output=convert_script(source,'Fixture',URL,'',source_format='loon')
        case={'name':'live headers','request':{'url':URL},
              'http':[{'url':'https://example.test/path?h=1','body':'ok'}],
              'expected':{'result':{'body':'ok'},
                          'events':{'requests':[{'url':'https://example.test/path?h=1','headers':{'y':'base'}}]}}}
        result=compare(source,output,'loon',URL,case)
        self.assertEqual(result['status'],'passed',result)

    def test_qx_live_timeout_remains_in_milliseconds(self):
        # QX 请求 helper 已把秒归一为毫秒，实时投影不能再乘 1000。
        source='''function send(t){t={...t};$task.fetch(t).then(r=>$done({body:r.body}))}
send({url:'https://example.test/',timeout:5000});'''
        output=convert_script(source,'Fixture',URL,'',source_format='qx')
        self.assertIn('timeout:',output)
        self.assertNotIn('.timeout * 1000',output)

    def test_closed_local_record_url_append_before_dispatch(self):
        # 闭合的本地请求对象：字段静态可枚举、唯一派发、追加发生在派发之前，走实时
        # 字段路径，发送时读取更新后的 url。
        source='''const options={url:'https://example.test/base',params:'a=1'};
options.url+='?'+options.params;
$httpClient.get(options,(e,r,b)=>$done({body:b}));'''
        self.check(source,'', 'base?a=1')

    def test_url_append_after_dispatch_is_rejected(self):
        # 派发之后再改 url 无法证明发送时读到的值，继续拒绝。
        source='''const options={url:'https://example.test/base'};
$httpClient.get(options,(e,r,b)=>$done({body:b}));
options.url+='later';'''
        with self.assertRaises(ConversionError):
            convert_script(source,'Fixture',URL,'',source_format='loon')

    def test_non_url_compound_assignment_is_rejected(self):
        # 只对 url 的 += 开证明；其它字段的复合赋值仍然拒绝。
        source='''const options={url:'https://example.test/base',body:'x'};
options.body+='y';
$httpClient.get(options,(e,r,b)=>$done({body:b}));'''
        with self.assertRaises(ConversionError):
            convert_script(source,'Fixture',URL,'',source_format='loon')

    def test_absent_or_literal_false_transport_flag_is_allowed(self):
        # 缺失与字面量 false 都必须放行，防止检查退化成一律拒绝。
        for declaration in ["","'binary-mode':false,","'full-header-mode':false,'binary-mode':false,"]:
            source=("const options={url:'https://example.test/base',"+declaration+
                    "headers:{'X-Fixture':'1'}};$httpClient.get(options,(e,r,b)=>$done({body:b}));")
            with self.subTest(declaration=declaration):
                output=convert_script(source,'Fixture',URL,'',source_format='loon')
                self.assertIn('ctx.http',output)
                self.assertNotIn('$httpClient',output)

    def test_dynamic_transport_flags_are_rejected_at_conversion(self):
        # 传输标志只能静态证明未启用；未知或可能为真时在转换阶段拒绝，不留给运行期抛错。
        for flag in ["'binary-mode'","'full-header-mode'"]:
            source=("const options={url:'https://example.test/base',"+flag+":$argument};"
                    "$httpClient.get(options,(e,r,b)=>$done({body:b}));")
            with self.subTest(flag=flag),self.assertRaises(ConversionError):
                convert_script(source,'Fixture',URL,'',source_format='loon')

    def test_unknown_spread_or_rebind_after_dispatch_is_rejected(self):
        # 未知展开来源使字段集合不再可枚举；派发后的整体重绑也不能倒推发送时字段。
        for source in [
            '''function send(t){t={...t,...$argument};$httpClient.get(t,(e,r,b)=>$done({body:b}))}
send({url:'https://example.test/base'});''',
            '''function send(t){$httpClient.get(t,(e,r,b)=>$done({body:b}));
t={...t,url:'https://example.test/later'}}send({url:'https://example.test/base'});''',
        ]:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                convert_script(source,'Fixture',URL,'',source_format='loon')

    def test_dynamic_member_or_alias_escape_is_rejected(self):
        for source in [
            '''const options={url:'https://example.test/base'};const key=$argument;
options[key]='https://example.test/later';$httpClient.get(options,(e,r,b)=>$done({body:b}));''',
            '''const options={url:'https://example.test/base'};const copy=options;
copy.url+='?copy';$httpClient.get(options,(e,r,b)=>$done({body:b}));''',
        ]:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                convert_script(source,'Fixture',URL,'',source_format='loon')

    def test_external_call_or_await_between_global_write_and_request_invalidates_shape(self):
        for operation in ['foreign();','await Promise.resolve();']:
            source="url={url:'https://example.test/a'};"+operation+'$httpClient.get(url,(e,r,b)=>$done({body:b}));'
            with self.subTest(operation=operation),self.assertRaises(ConversionError):
                convert_script(source,'Fixture',URL,'',source_format='loon')

    def test_transport_flags_require_same_value_in_every_branch(self):
        source='''let options=null;if($argument){options={url:'https://example.test/a','binary-mode':true}}
else{options={url:'https://example.test/a','binary-mode':false}}$httpClient.get(options,(e,r,b)=>$done({body:b}));'''
        with self.assertRaises(ConversionError):convert_script(source,'Fixture',URL,'',source_format='loon')
