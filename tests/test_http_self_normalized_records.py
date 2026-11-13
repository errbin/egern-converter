"""不透明请求参数的一次自我归一化仍可保持闭合字段证明。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL = 'https://example.test/self-normalized-request.js'


class HTTPSelfNormalizedRecordTests(unittest.TestCase):
    def convert(self, source):
        return convert_script(source, 'Fixture', URL, '', source_format='surge')

    def test_opaque_parameter_self_normalization_and_opts_copy(self):
        source = ('function send(req){req=typeof req==="string"?{url:req}:req;'
                  'req.opts=Object.assign({},req.opts,{redirection:false});'
                  '$httpClient.get(req,(e,r,b)=>$done({body:b}))}'
                  'const options=JSON.parse($argument);send(options);')
        native = self.convert(source)
        case = {'name': 'opaque self-normalized request',
                'argument': '{"url":"https://example.test/opaque","headers":{"X":"1"}}',
                'request': {'url': URL},
                'http': [{'url': 'https://example.test/opaque', 'body': 'ok'}],
                'expected': {'result': {'body': 'ok'}}}
        result = compare(source, native, 'surge', URL, case)
        self.assertEqual(result['status'], 'passed', result)

    def test_non_self_normalizing_or_escaping_records_still_reject(self):
        sources = [
            ('function send(req){req=typeof req==="string"?{url:req}:req;'
             'req.opts=Object.assign(req.opts,{redirection:false});'
             '$httpClient.get(req,(e,r,b)=>$done({body:b}))}'
             'const options=JSON.parse($argument);send(options);'),
            ('function send(req){req=typeof req==="string"?{url:req}:req;'
             'req.opts=Object.assign({},req.opts,{redirection:false});unknown(req.opts);'
             '$httpClient.get(req,(e,r,b)=>$done({body:b}))}'
             'const options=JSON.parse($argument);send(options);'),
            ('function send(req){req=typeof req==="number"?{url:req}:req;'
             '$httpClient.get(req,(e,r,b)=>$done({body:b}))}'
             'const options=JSON.parse($argument);send(options);'),
            ('function send(req){req=typeof req==="string"?{url:req}:req;'
             'req=typeof req==="string"?{url:req}:req;'
             '$httpClient.get(req,(e,r,b)=>$done({body:b}))}'
             'const options=JSON.parse($argument);send(options);'),
        ]
        for source in sources:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                self.convert(source)


if __name__ == '__main__':
    unittest.main()
