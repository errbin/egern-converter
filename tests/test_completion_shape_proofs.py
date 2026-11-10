"""完成结果的函数返回与 Promise 回调形状保持双向证明。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL = 'https://example.test/source.js'


class CompletionShapeProofTests(unittest.TestCase):
    def test_guarded_nullable_return_and_promise_resolution_keep_result_shape(self):
        sources = [
            '''function result(){if($request.url.includes('empty'))return null;return {body:'changed'};}
const value=result();value?$done(value):$done({});''',
            '''async function result(){return {body:'changed'};}
result().then(value=>$done(value || {body:'fallback'}));''',
        ]
        for source in sources:
            output = convert_script(source, 'Fixture', URL, '', source_format='loon')
            self.assertNotIn('$done(', output)
            for request in ['https://example.test/changed', 'https://example.test/empty']:
                fixture = {'name':'completion shape', 'request':{'url':request},
                           'response':{'body':'original'}}
                result = compare(source, output, 'loon', URL, fixture)
                self.assertEqual(result['status'], 'passed', result)

    def test_unproven_nullable_or_promise_shapes_remain_rejected(self):
        sources = [
            'function result(){if($request.url)return null;return {body:"changed"}}$done(result());',
            'async function result(){return {body:"changed"}}$done(result());',
            'unknown().then(value=>$done(value));',
            'const obj={then(fn){return {body:"other"}}};(async()=>{$done(await obj.then(value=>({body:"expected"})))})();',
        ]
        for source in sources:
            with self.subTest(source=source), self.assertRaisesRegex(ConversionError, '形状|可能为空'):
                convert_script(source, 'Fixture', URL, '', source_format='loon')


if __name__ == '__main__':
    unittest.main()
