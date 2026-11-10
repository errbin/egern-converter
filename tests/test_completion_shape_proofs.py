"""完成结果的函数返回与 Promise 回调形状保持双向证明。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL = 'https://example.test/source.js'


class CompletionShapeProofTests(unittest.TestCase):
    def test_direct_nullable_return_and_promise_resolution_keep_result_shape(self):
        sources = [
            '''function result(){if($request.url.includes('empty'))return null;return {body:'changed'};}
const value=result();value?$done(value):$done({});''',
            '''function result(){if($request.url.includes('empty'))return null;return {body:'changed'};}
$done(result());''',
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
            'function result(){if($request.url)return null;return unknown()}$done(result());',
            'function result(){if($request.url)return null;return "changed"}$done(result());',
            'function result(){if($request.url)return null;return {body:"changed"}}const value=result();$done(value);',
            'async function result(){return {body:"changed"}}$done(result());',
            'unknown().then(value=>$done(value));',
            'const obj={then(fn){return {body:"other"}}};(async()=>{$done(await obj.then(value=>({body:"expected"})))})();',
        ]
        for source in sources:
            with self.subTest(source=source), self.assertRaisesRegex(ConversionError, '形状|可能为空'):
                convert_script(source, 'Fixture', URL, '', source_format='loon')


    def test_completion_read_ignores_writes_that_cannot_reach_it(self):
        sources = [
            """let value={body:'changed'};
new Promise(r=>r()).finally(()=>{
 if($request.url.includes('changed')){ $done(value); }
 else { value=null; $done({}); }
});""",
            """let value={body:'changed'};
value=$request.url.includes('changed')?{body:'a'}:{body:'b'};
new Promise(r=>r()).finally(()=>{
 if($request.url){ $done(value); } else { $done({}); }
});""",
        ]
        for source in sources:
            output = convert_script(source, 'Fixture', URL, '', source_format='loon')
            self.assertNotIn('$done(', output)
            for request in ['https://example.test/changed', 'https://example.test/other']:
                fixture = {'name':'completion read', 'request':{'url':request},
                           'response':{'body':'original'}}
                result = compare(source, output, 'loon', URL, fixture)
                self.assertEqual(result['status'], 'passed', result)

    def test_completion_read_rejects_writes_that_can_precede_or_repeat_it(self):
        wrap = lambda body, other="$done({});": (
            "new Promise(r=>r()).finally(()=>{\n"
            " if($request.url.includes('changed')){ %s }\n"
            " else { %s }\n"
            "});" % (body, other))
        sources = [
            "let value={body:'changed'};\n" + wrap("value=null; $done(value);"),
            "let value={body:'changed'};\n" + wrap("value=unknown(); $done(value);"),
            "let value={body:'changed'};\n" + wrap("const k=$request.url; value[k]='x'; $done(value);"),
            "let value;\n" + wrap("$done(value);", "value={body:'x'}; $done({});"),
            "let value={body:'changed'};\nmutate();\n" + wrap("$done(value);") + "\nfunction mutate(){value=null}",
            "let value={body:'changed'};\n" + wrap(
                "for(let i=0;i<2;i++){ if(i)value=null; $done(value); }", "$done({});"),
        ]
        for source in sources:
            with self.subTest(source=source), self.assertRaisesRegex(ConversionError, '完成结果|形状'):
                convert_script(source, 'Fixture', URL, '', source_format='loon')


if __name__ == '__main__':
    unittest.main()
