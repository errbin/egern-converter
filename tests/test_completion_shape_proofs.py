"""完成结果的函数返回与 Promise 回调形状保持双向证明。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL = 'https://example.test/source.js'


class CompletionShapeProofTests(unittest.TestCase):
    def check(self, source, cases, format='loon'):
        output = convert_script(source, 'Fixture', URL, '', source_format=format)
        self.assertNotIn('$done(', output)
        for case in cases:
            result = compare(source, output, format, URL, case)
            self.assertEqual(result['status'], 'passed', result)

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

    def test_type_guarded_uninitialized_and_closed_host_response_shapes(self):
        sources = [
            '''async function produce(){return {body:'changed'}}
let result;
(async()=>{result=await produce()})();
new Promise(resolve=>resolve()).finally(()=>{switch(typeof result){case 'object':$done(result);break;}});''',
            '''function snapshot(){try{return $response}catch{return}}
$done(snapshot());''',
        ]
        for source in sources:
            with self.subTest(source=source):
                self.check(source, [
                    {'name':'guarded completion', 'request':{'url':URL},
                     'response':{'status':200,'body':'original'}},
                ])
                if source.startswith('function snapshot'):
                    self.check(source, [{'name':'guarded completion without response',
                                         'request':{'url':URL}}])

        source = '''function produce(empty){if(empty)return;return {body:'changed'}}
let result;
(async()=>{result=await produce($request.url.includes('empty'))})();
new Promise(resolve=>resolve()).finally(()=>{switch(typeof result){case 'object':$done(result);break;case 'undefined':$done({});break;}});'''
        self.check(source, [{'name':'undefined return guard '+state,
            'request':{'url':URL+('' if state=='value' else '/empty')},
            'response':{'body':'original'}} for state in ['value','empty']])

        source = '''function finish(response){return {body:response.body}}
$httpClient.get({url:'https://example.test/api'},(error,response,body)=>{
if(error)$done({});else $done(finish(response));});'''
        self.check(source, [{'name':'closed host response helper', 'request':{'url':URL},
            'http':[{'url':'https://example.test/api','status':200,'body':'reply'}]}])

        source = '''function finish(value){$done(value)}
if($argument==='response')finish($response);
else if($argument==='wrap')finish({response:$response});
else if($argument==='request')finish($request);
else finish({});'''
        self.check(source, [{'name':'completion variant '+argument,
            'request':{'url':URL,'method':'GET'},
            'response':{'status':200,'body':'original'},
            'argument':argument} for argument in ['response','wrap','request','empty']])

        source = '''function finish(value){$done(value)}
let result;
(async()=>{result=$response})();
new Promise(resolve=>resolve()).finally(()=>{
  if(result){if($argument==='response'){result.status=201;finish(result);}else finish({});}
  else finish({});
});'''
        self.check(source, [{'name':'mutated host response '+argument,
            'request':{'url':URL},
            'response':{'status':200,'body':'original'},
            'argument':argument} for argument in ['response','empty']])
        self.check(source, [{'name':'mutated host response without response',
            'request':{'url':URL},
            'argument':argument} for argument in ['response','empty']])

    def test_unproven_completion_shape_variants_remain_rejected(self):
        sources = [
            '''let result;(async()=>{result=null})();
new Promise(resolve=>resolve()).finally(()=>{switch(typeof result){case 'object':$done(result);break;}});''',
            '''async function produce(){return {body:'changed'}}let result;
(async()=>{result=await produce()})();
new Promise(resolve=>resolve()).finally(()=>{switch(typeof result){case 'object':$done(result);break;default:$done(result)}});''',
            '''async function produce(){return {body:'changed'}}let result;
(async()=>{result=await produce()})();
new Promise(resolve=>resolve()).finally(()=>$done(result));''',
            '''$done({body:'changed',unknown:1});''',
            '''function finish(value){$done(value)}
if($argument)finish({response:{body:'a'},body:'x'});else finish({response:{body:'b'}});''',
            '''function finish(value){unknown(value);return value}
$done(finish($response));''',
        ]
        for source in sources:
            with self.subTest(source=source), self.assertRaisesRegex(ConversionError, '完成结果|支持|response'):
                convert_script(source, 'Fixture', URL, '', source_format='loon')


if __name__ == '__main__':
    unittest.main()
