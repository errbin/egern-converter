"""请求记录可在派发前用静态字段逐项装配，不依赖对象字面量初始化。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL = 'https://example.test/request-assembly.js'


class HTTPRequestAssemblyTests(unittest.TestCase):
    def test_fields_written_before_one_dispatch_are_preserved(self):
        source = '''const options={};
options.url='https://example.test/assembled';
options.headers={X:'yes'};
$httpClient.get(options,(e,r,b)=>$done({body:b}));'''
        output = convert_script(source, 'Fixture', URL, '', source_format='loon')
        fixture = {'name': 'assembled request', 'request': {'url': URL},
                   'http': [{'url': 'https://example.test/assembled', 'body': 'ok'}],
                   'expected': {'result': {'body': 'ok'},
                                'events': {'requests': [{'url': 'https://example.test/assembled',
                                                          'headers': {'x': 'yes'}}]}}}
        result = compare(source, output, 'loon', URL, fixture)
        self.assertEqual(result['status'], 'passed', result)

    def test_conditional_late_dynamic_and_extra_fields_remain_rejected(self):
        for source in [
            "const options={};if($argument)options.url='https://example.test/a';"
            "$httpClient.get(options,(e,r,b)=>$done({body:b}));",
            "const options={};$httpClient.get(options,(e,r,b)=>$done({body:b}));"
            "options.url='https://example.test/late';",
            "const options={};options[$argument]='x';$httpClient.get(options,(e,r,b)=>$done({body:b}));",
            "const options={};options.foo='x';$httpClient.get(options,(e,r,b)=>$done({body:b}));",
        ]:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '', source_format='loon')

    def test_escape_and_foreign_owner_writes_remain_rejected(self):
        for source in [
            "const options={};unknown(options);$httpClient.get(options,(e,r,b)=>$done({body:b}));",
            "const options={};function setup(target){target.url='https://example.test/helper'}"
            "setup(options);$httpClient.get(options,(e,r,b)=>$done({body:b}));",
        ]:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '', source_format='loon')

    def test_absent_field_can_be_observed_but_mixed_unknown_records_are_rejected(self):
        source = '''function send(t){
  t.params&&(t.url+='?'+t.params);
  function observe(value){return value}
  observe(t.body);
  $httpClient.get(t,(e,r,b)=>$done({body:b}));
}
send({url:'https://example.test/path',params:'a=1'});'''
        output = convert_script(source, 'Fixture', URL, '', source_format='loon')
        fixture = {'name': 'absent field observation', 'request': {'url': URL},
                   'http': [{'url': 'https://example.test/path?a=1', 'body': 'ok'}],
                   'expected': {'result': {'body': 'ok'}}}
        result = compare(source, output, 'loon', URL, fixture)
        self.assertEqual(result['status'], 'passed', result)

        for rejected in [
            '''function send(t){function observe(value){return value}observe(t.body);
$httpClient.get(t,(e,r,b)=>$done({body:b}))}
send($argument?{url:'https://example.test/a',body:{value:1}}:{url:'https://example.test/b'});''',
            '''function send(t){function observe(value){return value}observe(t.body);
$httpClient.get(t,(e,r,b)=>$done({body:b}))}send(makeRecord());''',
        ]:
            with self.subTest(source=rejected), self.assertRaises(ConversionError):
                convert_script(rejected, 'Fixture', URL, '', source_format='loon')


if __name__ == '__main__':
    unittest.main()
