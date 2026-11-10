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

    def test_external_call_or_await_between_global_write_and_request_invalidates_shape(self):
        for operation in ['foreign();','await Promise.resolve();']:
            source="url={url:'https://example.test/a'};"+operation+'$httpClient.get(url,(e,r,b)=>$done({body:b}));'
            with self.subTest(operation=operation),self.assertRaises(ConversionError):
                convert_script(source,'Fixture',URL,'',source_format='loon')

    def test_transport_flags_require_same_value_in_every_branch(self):
        source='''let options=null;if($argument){options={url:'https://example.test/a','binary-mode':true}}
else{options={url:'https://example.test/a','binary-mode':false}}$httpClient.get(options,(e,r,b)=>$done({body:b}));'''
        with self.assertRaises(ConversionError):convert_script(source,'Fixture',URL,'',source_format='loon')
