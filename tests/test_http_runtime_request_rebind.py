"""Runtime request records rebind only before dispatch and only through closed snapshots."""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL = 'https://example.test/runtime-request.js'


class RuntimeRequestRebindTests(unittest.TestCase):
    def convert(self, source):
        return convert_script(source, 'Fixture', URL, '', source_format='loon')

    def assert_case(self, source, output, case):
        result = compare(source, output, 'loon', URL, case)
        self.assertEqual(result['status'], 'passed', result)

    def test_mixed_static_and_runtime_call_sites_keep_live_fields(self):
        # 同一个闭合 helper 既有静态调用点，也有 JSON.parse 产生的运行期记录；
        # 字段集合未知时仍可投影，但对象身份和字段名必须保持静态闭合。
        source = '''function send(options){options.headers=options.headers||{};options.headers.X='fixture';
$httpClient.get(options,(e,r,b)=>$done({body:b}))}
if($argument)send(JSON.parse($argument));else send({url:'https://example.test/static'});'''
        output = self.convert(source)
        for argument, endpoint in [
            ('', 'https://example.test/static'),
            ('{"url":"https://example.test/runtime","headers":{"Y":"keep"}}', 'https://example.test/runtime'),
        ]:
            with self.subTest(argument=argument):
                self.assert_case(source, output, {
                    'name': 'mixed request call sites', 'argument': argument,
                    'request': {'url': URL},
                    'http': [{'url': endpoint, 'body': 'ok'}],
                    'expected': {'result': {'body': 'ok'},
                                 'events': {'requests': [{'url': endpoint, 'headers': {
                                     'x': 'fixture', **({'y': 'keep'} if argument else {}),
                                 }}]}},
                })

    def test_exclusive_constructor_switch_snapshots_are_projected_live(self):
        # 参数按 constructor 进入互斥 case，各自生成静态键快照；随后字段写入
        # 仍在唯一派发前，发送时读取运行期更新后的值。
        source = '''function send(value){switch(value.constructor){
case Object:value={...(void 0),...value};break;
case String:value={...(void 0),url:value}}
value.method=value.method||'GET';delete value.headers?.['X-Remove'];
$httpClient.get(value,(e,r,b)=>$done({body:b}))}
if($argument)send('https://example.test/string');
else send({url:'https://example.test/object',headers:{X:'keep','X-Remove':'drop'}});'''
        output = self.convert(source)
        for argument, endpoint in [('', 'https://example.test/object'), ('yes', 'https://example.test/string')]:
            with self.subTest(endpoint=endpoint):
                self.assert_case(source, output, {
                    'name': 'exclusive request snapshots', 'argument': argument,
                    'request': {'url': URL},
                    'http': [{'url': endpoint, 'body': 'ok'}],
                    'expected': {'result': {'body': 'ok'}},
                })

    def test_sequential_or_fallthrough_rebinds_are_rejected(self):
        for body in [
            '''value={...(void 0),...value};value={...(void 0),...value};''',
            '''switch(value.constructor){case Object:value={...(void 0),...value};
case String:value={...(void 0),url:value}}''',
        ]:
            source = '''function send(value){''' + body + '''
$httpClient.get(value,(e,r,b)=>$done({body:b}))}
send({url:'https://example.test/object'});'''
            with self.subTest(body=body), self.assertRaises(ConversionError):
                self.convert(source)


    def test_closed_builder_and_logging_observer_keep_runtime_fields(self):
        # 闭合 builder 返回静态键请求记录，日志 helper 只观察参数；字段值
        # 仍按原代码在派发前求值，发送时读取运行期更新后的记录。
        source = """function log(value){console.log(typeof value==='string'?value:JSON.stringify(value))}
function build(input){const request={url:input.url,headers:{Accept:'*/*'}};request.headers.X='fixture';log(request);return request}
function send(request){$httpClient.get(request,(e,r,b)=>$done({body:b}))}
send(build({url:'https://example.test/live'}));"""
        output = self.convert(source)
        self.assert_case(source, output, {
            'name': 'closed builder and logging observer',
            'request': {'url': URL},
            'http': [{'url': 'https://example.test/live', 'body': 'ok'}],
            'expected': {'result': {'body': 'ok'},
                         'events': {'requests': [{'url': 'https://example.test/live',
                                                  'headers': {'accept': '*/*', 'x': 'fixture'}}]}},
        })


if __name__ == '__main__':
    unittest.main()
