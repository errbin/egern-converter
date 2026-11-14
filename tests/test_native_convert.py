"""Direct compilation contracts; no compatibility runtime can be a fallback."""
import json
import shutil
import subprocess
import unittest

from tests import test_script_convert as execution
from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script, convert_scripts


def compile_source(source, **options):
    return convert_script(source, 'Author', 'https://example.test/source.js', 'MIT', **options)


@unittest.skipUnless(shutil.which('node'), 'Native compilation requires Node')
class NativeCompilerTests(unittest.TestCase):
    execute = execution.ScriptTests.execute

    def test_generated_artifacts_reject_unverified_header_methods(self):
        # 真机 Headers 没有这些集合方法；最终产物护栏必须跟踪局部别名、解构、
        # 函数返回值和数组/对象承载，且不能误伤 Object.entries 安全投影。
        probe = r'''import {assertNoUnverifiedHeaderCalls} from './tools/js-analysis/compiler/native.mjs';
import assert from 'node:assert/strict';
const unsafe = [
  'ctx.request["headers"].entries()',
  'ctx.response.headers.getAll("set-cookie")',
  'ctx.request["headers"]["getAll"]("set-cookie")',
  'ctx.response?.headers?.entries?.()',
  'const h=ctx.response.headers; h.entries();',
  'const h=ctx.request.headers; h.getAll("set-cookie");',
  'const {headers:h}=ctx.response; h.entries();',
  'const {headers}=ctx.request; headers.getAll("x");',
  'const h=ctx.response.headers; const {entries}=h; entries();',
  'function pick(){return ctx.response.headers} pick().entries();',
  'function identity(value){return value} identity(ctx.request.headers).getAll("x");',
  'const box=[ctx.response.headers]; box[0].entries();',
  'const box={headers:ctx.request.headers}; box.headers.getAll("x");',
  'const h=Object.assign({},ctx.response.headers); h.entries();',
  'const h={}; Object.assign(h,ctx.response.headers); h.keys();',
  'const h=ctx.request.headers; h["entries"]();',
  'const h=ctx.response.headers; h.keys();',
  'const h=ctx.response.headers; h.values();',
  'const h=ctx.response.headers; h.forEach(()=>{});',
  'const h=ctx.response.headers; h.has("x");',
  'const h=ctx.response.headers; const entries=h.entries; entries();',
];
for (const code of unsafe) assert.throws(() => assertNoUnverifiedHeaderCalls(code), /Headers/);
for (const code of [
  'Object.fromEntries(Object.entries(ctx.request["headers"]))',
  'Object.keys(ctx.response.headers)',
  'Object.values(ctx.request.headers)',
  'ctx.request.headers["x-test"]',
  'const h=ctx.response.headers; Object.entries(h)',
  'const values=[1,2]; values.entries()',
  'const params=new URLSearchParams(""); params.has("x")',
]) assert.doesNotThrow(() => assertNoUnverifiedHeaderCalls(code));
console.log(JSON.stringify({ok: true}));
'''
        result = subprocess.run(['node', '--input-type=module', '-e', probe], cwd=execution.ROOT,
                                text=True, capture_output=True, check=True)
        self.assertEqual(json.loads(result.stdout), {'ok': True})

    def test_header_method_alias_shapes_fail_conversion(self):
        # 故障注入：这些输入都会在最终产物中保留宿主 Headers 方法调用，必须由
        # 转换入口直接抛出 ConversionError，而不是留给差分 fixture 掩盖。
        unsafe = [
            'const l=[...$response.headers.entries()];$done({body:l.join(",")});',
            'const h=$response.headers;const l=[...h.entries()];$done({body:l.join(",")});',
            'const h=$response.headers;const l=h.getAll("set-cookie");$done({body:l.join(",")});',
            'const h=$request.headers;const l=[...h.entries()];$done({body:l.join(",")});',
            'const {entries}=$response.headers;const l=[...entries()];$done({body:l.join(",")});',
            'const h=$response.headers;const {getAll}=h;const l=getAll("set-cookie");$done({body:l.join(",")});',
            'function pick(){return $response.headers}const h=pick();const l=[...h.entries()];$done({body:l.join(",")});',
            'function identity(value){return value}const l=[...identity($response.headers).entries()];$done({body:l.join(",")});',
            'const box=[$response.headers];const l=[...box[0].entries()];$done({body:l.join(",")});',
            'const box={headers:$response.headers};const l=[...box.headers.entries()];$done({body:l.join(",")});',
            'const h=Object.assign({},$response.headers);const l=[...h.entries()];$done({body:l.join(",")});',
            'const h={};Object.assign(h,$response.headers);const l=[...h.entries()];$done({body:l.join(",")});',
            'const h=$response.headers;const l=[...h?.entries?.()];$done({body:l.join(",")});',
            'const h=$response.headers;const l=[...h["entries"]()];$done({body:l.join(",")});',
        ]
        for method in ('entries', 'getAll', 'keys', 'values', 'forEach', 'has'):
            unsafe.append(f'const h=$response.headers;const value=h.{method}("x");$done({{body:String(value)}});')
        for source in unsafe:
            with self.subTest(source=source), self.assertRaisesRegex(ConversionError, 'Headers'):
                compile_source(source)
        safe = '$done({body:Object.entries($response.headers).join(",")});'
        self.assertIn('Object.entries(ctx.response.headers)', compile_source(safe))

    def test_equal_header_method_errors_are_not_differential_equivalence(self):
        # 2dd0e05 后原脚本与产物都会因同一缺失方法报 TypeError；差分不能把
        # “两边同错”当成通过，否则不兼容产物会静默发布。
        from tools.egern_hub.verify import compare
        original = 'const h=$response.headers;const l=[...h.entries()];$done({body:l.join(",")});'
        converted = ('export default async function(ctx){const h=ctx.response.headers;'
                     'const l=[...h.entries()];return{body:l.join(",")};}')
        fixture = {'name': 'header method error', 'request': {'url': 'https://example.test/'},
                   'response': {'status': 200, 'headers': {'X-Test': 'yes'}, 'body': 'x'}}
        result = compare(original, converted, 'surge', 'https://example.test/source.js', fixture)
        self.assertEqual(result['status'], 'header_method_error', result)
        self.assertEqual(result['original_error'], result['converted_error'])

    def test_awaited_completion_expression_runs_once(self):
        from tools.egern_hub.verify import compare
        source='let calls=0;function value(){calls++;return Promise.resolve(calls)}(async()=>{$done(await value().then(async n=>({status:201,headers:{"X-Calls":String(n)},body:String(n)})))})();'
        output=compile_source(source,source_format='loon')
        for response in [None,{'body':'old'}]:
            fixture={'name':'single evaluation','request':{'url':'https://example.test/'},'expected':{'result':{'status':201,'headers':{'x-calls':'1'},'body':'1'}}}
            if response is not None:fixture['response']=response
            self.assertEqual(compare(source,output,'loon','https://example.test/source.js',fixture)['status'],'passed')
        source='(async()=>{$done(await Promise.resolve().then(async()=>({status:undefined,body:"only body"})))})();'
        output=compile_source(source,source_format='loon')
        fixture={'name':'absent status','request':{'url':'https://example.test/'},'expected':{'mode':'modify','result':{'body':'only body'}}}
        self.assertEqual(compare(source,output,'loon','https://example.test/source.js',fixture)['status'],'passed')

    def test_fetch_constructors_read_native_fields_without_legacy_objects(self):
        from tools.egern_hub.verify import compare
        source='(async()=>{const r=new Request($request.url,$request);const s=new Response($response.body,$response);$done(await Promise.resolve(s).then(async s=>({status:s.status,headers:Object.fromEntries(Object.entries(s.headers)),body:new Uint8Array(await s.arrayBuffer())})))})();'
        output=compile_source(source,source_format='loon',binary=True)
        self.assertNotIn('$request',output)
        self.assertNotIn('$response',output)
        fixture={'name':'fetch bytes','binary':True,'request':{'url':'https://example.test/','method':'POST','bytes':[65]},'response':{'status':202,'headers':{'X-Fixture':'yes'},'bytes':[0,1,2]},'expected':{'result':{'status':202,'headers':{'x-fixture':'yes'},'body':[0,1,2]}}}
        self.assertEqual(compare(source,output,'loon','https://example.test/source.js',fixture)['status'],'passed')

    def test_unknown_then_receiver_is_not_treated_as_a_promise(self):
        source='(async()=>{$done(await unknown().then(x=>({body:"expected"})))})();'
        with self.assertRaisesRegex(ConversionError,'形状'):compile_source(source)
        source='const obj={then(fn){return {body:"other"}}};(async()=>{$done(await obj.then(x=>({body:"expected"})))})();'
        with self.assertRaisesRegex(ConversionError,'形状'):compile_source(source)
        with self.assertRaisesRegex(ConversionError,'QX'):
            compile_source('(async()=>{const s=new Response($response.body,$response);$done({body:await s.text()})})();',source_format='qx')

    def test_conditional_completion_and_response_passthrough_use_native_fields(self):
        from tools.egern_hub.verify import compare
        sources=[
            'const body=$response.body;$done(body ? {body:body+"!"} : {});',
            '$done($response);',
            'const body=$response.body;if(body==="replace")$done({body:"changed"});else $done($response);',
        ]
        for source in sources:
            output=compile_source(source,source_format='loon')
            self.assertNotIn('$response',output)
            self.assertLessEqual(output.count('await ctx.response.text()'),1)
            for body in ['replace','original','']:
                fixture={'name':'conditional response','request':{'url':'https://example.test/'},
                         'response':{'status':200,'headers':{'Content-Type':'text/plain','Content-Length':'8'},'body':body}}
                with self.subTest(source=source,body=body):
                    result=compare(source,output,'loon','https://example.test/source.js',fixture)
                    self.assertEqual(result['status'],'passed',result)
        output=compile_source('$done($response);',source_format='loon')
        result=compare('$done($response);',output,'loon','https://example.test/source.js',
                       {'name':'missing response','request':{'url':'https://example.test/'}})
        self.assertEqual(result['status'],'passed',result)

    def test_generators_and_closed_object_receivers_keep_native_javascript_semantics(self):
        from tools.egern_hub.verify import compare
        cases=[
            ('function* values(){yield "a";yield "b";} $done({body:[...values()].join("")});','ab'),
            ('function read(){return this.value;} const box={value:"ok",read}; $done({body:box.read()});','ok'),
        ]
        for source,body in cases:
            with self.subTest(source=source):
                output=compile_source(source)
                self.assertNotIn('$done',output)
                result=compare(source,output,'surge','https://example.test/source.js',
                               {'name':'native completion','request':{'url':'https://example.test/'},
                                'expected':{'result':{'body':body}}})
                self.assertEqual(result['status'],'passed',result)

    def test_closed_function_constructor_body_becomes_native_completion(self):
        from tools.egern_hub.verify import compare
        source='(+[])["constructor"]["constructor"](\'$done({body:"ok"});\')();'
        output=compile_source(source,source_format='loon')
        self.assertNotIn('$done',output)
        self.assertIn('export default async function(ctx)',output)
        self.assertIn('return{body:"ok"}',output)
        fixture={'name':'closed generated body','request':{'url':'https://example.test/'},
                 'expected':{'result':{'body':'ok'}}}
        decoded='$done({body:"ok"});'
        result=compare(decoded,output,'loon','https://example.test/source.js',fixture)
        self.assertEqual(result['status'],'passed',result)

    def test_returned_string_is_not_treated_as_an_executed_script(self):
        source='''(+[])["constructor"]["constructor"]("return '$done({body:\\"ok\\"});'")();'''
        harness="import {lowerFunctionConstructorSource} from './tools/js-analysis/transforms/decoding.mjs';let source='';for await(const chunk of process.stdin)source+=chunk;const result=lowerFunctionConstructorSource(source);process.stdout.write(JSON.stringify({same:result.source===source,layers:result.transformations.length}));"
        result=subprocess.run(['node','--input-type=module','-e',harness],input=source,text=True,
                              capture_output=True,check=True,cwd=str(execution.ROOT))
        self.assertEqual(json.loads(result.stdout),{'same':True,'layers':0})

    def test_message_mutation_and_qx_whole_response_fail_closed(self):
        for source in ['$response.body="changed";$done($response);',
                       'delete $response.status;$done($response);',
                       '$request.url="https://changed.test/";$done({});']:
            with self.subTest(source=source),self.assertRaises(ConversionError):
                compile_source(source,source_format='loon')
        with self.assertRaisesRegex(ConversionError,'QX'):
            compile_source('$done($response);',source_format='qx')

    def test_readonly_literal_tables_can_expose_direct_api_properties(self):
        source='var table=["body","replace"];var body=$response[table[0]][table[1]](/ad/g,"clean");$done({body});'
        output=compile_source(source,source_format='loon')
        self.assertNotIn('table',output)
        self.assertIn('ctx.response.text()',output)
        self.assertEqual(self.execute(source,body='ad banner',ast=True)['result']['body'],'clean banner')

    def test_only_unreachable_expressions_after_free_done_are_removed(self):
        source='const marker="jsjiami.com";$done({body:"ok"});eval(marker);'
        output=compile_source(source)
        self.assertNotIn('eval(',output)
        self.assertNotIn('jsjiami',output)
        output=compile_source('const marker="jsjiami.com";eval(marker);$done({});')
        self.assertIn('eval(marker)',output)
        source='function $done(){return "local"}const marker="jsjiami.com";$done();eval(marker);'
        with self.assertRaises(ConversionError):compile_source(source)

    def test_native_gzip_decode_propagates_await_through_functions_and_aliases(self):
        import gzip
        from tools.egern_hub.verify import compare
        data='压缩后的业务响应'.encode()
        fixtures={'name':'gzip response','binary':True,'request':{'url':'https://example.test/'},
                  'response':{'status':200,'bytes':list(gzip.compress(data,mtime=0))},
                  'expected':{'result':{'body':list(data)}}}
        sources=[
            '$done({body:$utils.ungzip($response.body)});',
            'const ctx="author variable";$done({body:$utils.ungzip($response.body)});',
            'const unzip=$utils.ungzip;function read(b){return unzip(b)}function decode(b){return read(b)}$done({body:decode($response.body)});',
            'const unzip=typeof $utils==="object"&&typeof $utils?.ungzip==="function"?$utils.ungzip:x=>x;$done({body:unzip($response.body)});',
            'const unzip=typeof $utils==="object"&&typeof $utils?.ungzip==="function"?$utils.ungzip:b=>{throw new Error("fallback must not run")};$done({body:unzip($response.body)});',
            'const decoder={read(b){return $utils.ungzip(b)}};$done({body:decoder.read($response.body)});',
            'class Decoder{read(b){return $utils.ungzip(b)}}const decoder=new Decoder();$done({body:decoder.read($response.body)});',
        ]
        for source in sources:
            with self.subTest(source=source):
                output=compile_source(source,binary=True)
                self.assertRegex(output,r'await ctx\d*\.compress\.gunzip\(')
                self.assertNotIn('$utils',output)
                self.assertEqual(compare(source,output,'surge','https://example.test/source.js',fixtures)['status'],'passed')

    def test_gzip_capability_fallback_with_binary_false_reads_body_bytes(self):
        import gzip
        from tools.egern_hub.verify import compare
        data='二进制响应'.encode()
        source='const unzip=typeof $utils==="object"&&typeof $utils?.ungzip==="function"?$utils.ungzip:b=>{throw new Error("fallback must not run")};$done({body:unzip($response.bodyBytes)});'
        output=compile_source(source,binary=False)
        self.assertRegex(output,r'await ctx\d*\.compress\.gunzip\(')
        self.assertNotIn('$utils',output)
        fixture={'name':'gzip bodyBytes','binary':True,'request':{'url':'https://example.test/'},
                 'response':{'status':200,'bytes':list(gzip.compress(data,mtime=0))},
                 'expected':{'result':{'body':list(data)}}}
        for platform in ('surge','loon'):
            with self.subTest(platform=platform):
                result=compare(source,output,platform,'https://example.test/source.js',fixture)
                self.assertEqual(result['status'],'passed',result)

    def test_compression_capability_fallback_rejects_unproven_or_escaped_aliases(self):
        sources=[
            'const unzip=typeof $utils==="object"&&typeof $utils?.gunzip==="function"?$utils.ungzip:b=>{throw new Error("fallback")};$done({body:unzip($response.body)});',
            'const key=$request.url;const unzip=typeof $utils==="object"&&typeof $utils?.[key]==="function"?$utils.ungzip:b=>{throw new Error("fallback")};$done({body:unzip($response.body)});',
            '$utils.ungzip=value=>value;const unzip=typeof $utils==="object"&&typeof $utils?.ungzip==="function"?$utils.ungzip:b=>{throw new Error("fallback")};$done({body:unzip($response.body)});',
            'const unzip=typeof $utils==="object"&&typeof $utils?.ungzip==="function"?$utils.ungzip:b=>{throw new Error("fallback")};$done({body:[1].map(unzip)});',
            'let unzip=typeof $utils==="object"&&typeof $utils?.ungzip==="function"?$utils.ungzip:b=>{throw new Error("fallback")};if($request.url)unzip=b=>b;$done({body:unzip($response.body)});',
        ]
        for source in sources:
            with self.subTest(source=source),self.assertRaises(ConversionError):
                compile_source(source,binary=True)
        from tools.egern_hub.verify import compare
        local='function decode($utils,fallback){const unzip=typeof $utils==="object"||typeof $utils.ungzip==="function"?$utils.ungzip:fallback;$done({body:unzip($response.body)});}decode({ungzip:value=>value},value=>"fallback");'
        output=compile_source(local)
        self.assertNotIn('ctx.compress.gunzip',output)
        fixture={'name':'shadowed utils','request':{'url':'https://example.test/'},
                 'response':{'body':'plain'},'expected':{'result':{'body':'plain'}}}
        self.assertEqual(compare(local,output,'surge','https://example.test/source.js',fixture)['status'],'passed')

    def test_gzip_invalid_stream_keeps_null_failure(self):
        from tools.egern_hub.verify import compare
        source='$done({body:String($utils.ungzip($response.body)===null)});'
        output=compile_source(source,binary=True)
        fixture={'name':'invalid gzip','binary':True,'request':{'url':'https://example.test/'},
                 'response':{'bytes':[0,1,2]},'expected':{'result':{'body':'true'}}}
        self.assertEqual(compare(source,output,'surge','https://example.test/source.js',fixture)['status'],'passed')

    def test_closed_object_and_class_methods_propagate_completion(self):
        sources=[
            'const result={finish(){ $done({body:"ok"}); }};result.finish();$notify("wrong");',
            'class Result{finish(){this.value="ok";$done({body:this.value});}}const result=new Result();result.finish();$notify("wrong");',
            'const Result=class Named{static finish(){$done({body:"ok"});}};Result.finish();$notify("wrong");',
        ]
        for source in sources:
            with self.subTest(source=source):
                result=self.execute(source,ast=True)
                self.assertEqual(result['result'],{'body':'ok'})
                self.assertEqual(result['notifications'],[])

    def test_changed_methods_and_escaped_async_references_are_rejected(self):
        sources=[
            'class Result{finish(){$done({});}}const r=new Result();r.finish=()=>0;r.finish();$done({});',
            'class Result{finish(){$done({});}}Result.prototype.finish=()=>0;const r=new Result();r.finish();$done({});',
            'const r={finish(){$done({})}};Object.assign(r,{finish:()=>0});r.finish();$done({});',
            'const unzip=$utils.ungzip;[1].map(unzip);$done({});',
            'let unzip=$utils.ungzip;if($request.url)unzip=x=>x;$done({body:unzip($response.body)});',
            'function read(x){return $utils.ungzip(x)}const alias=read;[1].map(alias);$done({});',
            'function read(x){return $utils.ungzip(x)}let alias=read;if($request.url)alias=x=>x;$done({body:alias($response.body)});',
            '[1].map(x=>$utils.ungzip(x));$done({});',
            'class Decoder{constructor(){this.bytes=$utils.ungzip($response.body)}}new Decoder();$done({});',
            'const r={finish(){$done({})},finish(){return 0}};r.finish();$done({});',
            'class Result{finish(){$done({})}finish(){return 0}}const r=new Result();r.finish();$done({});',
        ]
        for source in sources:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                compile_source(source,binary=True)

    def test_simple_script_is_direct_and_small(self):
        result = compile_source('const data=JSON.parse($response.body);data.ok=true;$done({body:JSON.stringify(data)});')
        self.assertIn('await ctx.response.text()', result)
        self.assertIn('return{body:JSON.stringify(data)};', result)
        for name in ('$response', '$done', '__egern', 'new Proxy', 'new Promise', 'Symbol('):
            self.assertNotIn(name, result)
        self.assertLess(len(result[result.index('export default'):].encode()), 650)

    def test_native_source_is_verbatim(self):
        source = '// 原生作者\nexport default async ctx => ({body: await ctx.response.text()});\n'
        self.assertEqual(compile_source(source, source_format='egern'), source)
        self.assertEqual(compile_source(source, source_format='egern', readable=True), source)

    def test_leading_documentation_precedes_entry_and_generated_body_reads(self):
        preamble='\ufeff/*\n * 火龙果\n * 小果ai不可用\n[mitm]\nhostname = api.example\n*/\n// Original author notice\n\n'
        source=preamble+'const data=JSON.parse($response.body);\n /* Keep this comment with business code. */ $done({body:JSON.stringify(data)});'
        output=compile_source(source)
        self.assertNotIn('火龙果',output)
        self.assertNotIn('小果ai不可用',output)
        preamble,body=output.split('export default',1)
        self.assertIn('Original author notice\n\n用法\n',preamble)
        self.assertEqual(preamble.count('/*'),1)
        self.assertEqual(preamble.count('*/'),1)
        self.assertTrue(body.startswith(' async function(ctx) {\n  const responseBody'))
        self.assertNotIn('[mitm]',output)
        self.assertNotIn('hostname = api.example',output)
        self.assertGreater(output.index('/* Keep this comment'),output.index('const data ='))
        self.assertEqual(self.execute(source,body='{"ok":true}',ast=True)['result']['body'],'{"ok":true}')

    def test_inline_leading_comment_and_directive_keep_valid_boundaries(self):
        output=compile_source('/* Description */$done({});')
        self.assertNotIn('Description',output)
        self.assertIn('\n用法\n',output)
        source='// Description\n"use strict"; /* Directive-local comment */\n$done({});'
        output=compile_source(source)
        self.assertNotIn('Description',output)
        self.assertIn('\n用法\n',output)
        self.assertIn('*/\n\n\nexport default async function(ctx) {\n  "use strict";',output)
        self.assertEqual(self.execute(source,ast=True)['result'],{})

    def test_legacy_ast_switch_cannot_restore_a_bridge(self):
        for ast in (True, False):
            output = compile_source('$notify("title","sub","body");$done({});', ast=ast)
            self.assertIn('ctx.notify({title:', output)
            self.assertNotIn('$notify', output)
            self.assertNotIn('__egern', output)

    def test_lexical_context_name_and_local_platform_names_are_preserved(self):
        source = 'const ctx="local";function value($response){return $response+ctx;} $done({body:value("ok")});'
        output = compile_source(source)
        self.assertNotIn('$done', output)
        self.assertEqual(self.execute(source, ast=True)['result']['body'], 'oklocal')

    def test_native_entry_and_nested_blocks_have_consistent_indentation(self):
        source='const data=JSON.parse($response.body);\nfunction modify(obj){if(obj){for(const key of Object.keys(obj)){obj[key]=true;}}}modify(data);$done({body:JSON.stringify(data)});'
        output=compile_source(source)
        self.assertIn('  const data = JSON.parse(responseBody);',output)
        self.assertIn('  function modify(obj) {\n    if (obj) {\n      for (const key of Object.keys(obj)) {\n        obj[key] = true;\n      }\n    }\n  }',output)
        self.assertEqual(self.execute(source,body='{"flag":false}',ast=True)['result']['body'],'{"flag":true}')

    def test_formatting_preserves_multiline_literals_regex_and_return_linebreaks(self):
        from tools.egern_hub.verify import compare
        source=r'''const text = String.raw`first
    second\n`;
const pattern=/^\s+\{value\}\/$/u;const big=12345678901234567890n;
function result(){return
  {wrong:true};}
// Keep this business comment.
$done({body:JSON.stringify([text,pattern.source,String(big),result()===undefined])});'''
        output=compile_source(source)
        self.assertIn('String.raw`first\n    second\\n`',output)
        self.assertIn(r'/^\s+\{value\}\/$/u',output)
        self.assertIn('// Keep this business comment.',output)
        fixture={'name':'formatting literals and ASI','request':{'url':'https://example.test/'},
            'response':{'status':200,'body':''},'expected':{'result':{'body':'["first\\n    second\\\\n","^\\\\s+\\\\{value\\\\}\\\\/$","12345678901234567890",true]'}}}
        self.assertEqual(compare(source,output,'surge','https://example.test/source.js',fixture)['status'],'passed')

    def test_forwarding_function_returns_to_entry_without_running_late_effects(self):
        source = 'function finish(x){$done(x);$notify("wrong");} try{finish({body:"first"});$notify("wrong");}catch(e){$notify("caught");}$done({body:"last"});'
        result = self.execute(source, ast=True)
        self.assertEqual(result['result'], {'body':'first'})
        self.assertEqual(result['notifications'], [])

    def test_qx_http_body_is_read_once_and_native_status_is_used(self):
        source = '$task.fetch({url:"https://api.example"}).then(r=>$done({body:r.statusCode+":"+r.body+":"+r.body+":"+new Uint8Array(r.bodyBytes).length}));'
        output = compile_source(source)
        self.assertIn('ctx.http.get(', output)
        for name in ('$task', '$done', 'statusCode', '__egern'):
            self.assertNotIn(name, output)
        result = self.execute(source, ast=True, http=[{'body':'abc','status':201}])
        self.assertEqual(result['result']['body'], '201:abc:abc:3')
        self.assertEqual(result['consumed'], ['https://api.example'])

    def test_completion_in_named_async_helper_is_propagated(self):
        source = 'async function work(){const r=await $task.fetch({url:"https://api.example"});$done({body:r.body});}const alias=work;alias();'
        self.assertEqual(self.execute(source, ast=True, http=[{'body':'ok'}])['result']['body'], 'ok')

    def test_native_http_lowering_preserves_callback_variable_scope(self):
        source = 'var x="outer";function outer(){return x;}$httpClient.get("https://api.example",(e,r,b)=>{var x="inner";$done({body:outer()+":"+x});});'
        self.assertEqual(self.execute(source, ast=True, http=[{'body':'ok'}])['result']['body'], 'outer:inner')

    def test_object_arrow_and_optional_chains_keep_their_values(self):
        source = 'const f=async()=>({value:1});f().then(v=>{const x=null;x?.noop().next();$done({body:String(v.value)});});'
        self.assertEqual(self.execute(source, ast=True)['result']['body'], '1')

    def test_typed_byte_conversion_evaluates_business_expression_once(self):
        source = 'let count=0;const buffer=new Uint8Array([9,65,66,8]);function value(){count++;return new DataView(buffer.buffer,1,2)}const result=value();$done({bodyBytes:result,headers:{Count:String(count)}});'
        result = self.execute(source, ast=True)['result']
        self.assertEqual(result['body'], [65,66])
        self.assertEqual(result['headers']['Count'], '1')

    def test_binary_mode_qx_body_remains_text(self):
        source = '$done({body:typeof $response.body+":"+($response.bodyBytes instanceof ArrayBuffer)});'
        self.assertEqual(self.execute(source, body='abc', binary=True, source_format='qx', ast=True)['result']['body'], 'string:true')

    def test_qx_task_fetch_timeout_passes_through_in_milliseconds(self):
        from tools.egern_hub.verify import compare
        source = '$task.fetch({url:"https://api.example",timeout:15000}).then(r=>$done({body:r.body}));'
        output = compile_source(source, source_format='qx')
        self.assertRegex(output, r'timeout:\s*15000')
        self.assertNotIn('.timeout * 1000', output)
        fixture = {'name':'qx timeout','request':{'url':'https://example.test/'},
                   'http':[{'status':200,'body':'ok'}], 'expected':{'result':{'body':'ok'}}}
        result = compare(source,output,'qx','https://example.test/source.js',fixture)
        self.assertEqual(result['status'],'passed',result)

    def test_qx_dynamic_request_omits_absent_timeout_and_keeps_explicit_values(self):
        from tools.egern_hub.verify import compare
        prefix = 'const request={url:"https://api.example"'
        suffix = ';request.url+="?x=1";$task.fetch(request).then(r=>$done({body:r.body}));'
        cases = [
            ('absent', prefix + '}' + suffix, None),
            ('literal', prefix + ',timeout:15000}' + suffix, 15000),
            ('runtime write', prefix + '};request.timeout=15000;request.url+="?x=1";$task.fetch(request).then(r=>$done({body:r.body}));', 15000),
        ]
        for name, source, timeout in cases:
            with self.subTest(name=name):
                output = compile_source(source, source_format='qx')
                if timeout is None:
                    self.assertNotIn('timeout:', output)
                else:
                    self.assertIn('timeout:', output)
                    observed = self.execute(source, source_format='qx', ast=True, http=[{'body':'ok'}])
                    self.assertEqual(observed['requests'][0]['options']['timeout'], timeout)
                fixture = {'name':name,'request':{'url':'https://example.test/'},
                           'http':[{'status':200,'body':'ok'}], 'expected':{'result':{'body':'ok'}}}
                result = compare(source, output, 'qx', 'https://example.test/source.js', fixture)
                self.assertEqual(result['status'], 'passed', result)
        # 非 QX 动态请求仍保留平台缺省 timeout，证明省略契约只作用于 QX。
        callback = 'const request={url:"https://api.example"};request.url+="?x=1";$httpClient.get(request,(e,r,b)=>{if(e)throw Error(e);$done({body:b});});'
        self.assertIn('timeout:5000', compile_source(callback, source_format='surge'))

    def test_unknown_flow_and_api_shapes_are_build_errors(self):
        sources = [
            'const finish=()=>{$done({})};[1].forEach(finish);$done({});',
            'const finish=()=>{$done({})};const box={finish};box.finish();',
            'try{$done({});}finally{$notify("late");}',
            'const input={url:"https://api.example"};input.unknown=5;$task.fetch(input).then(r=>$done({}));',
            'const f=()=>JSON.parse("{}");$done(f());',
            'let result={};result={body:"changed"};$done(result);',
            'const result={};Object.assign(result,{body:"changed"});$done(result);',
            '$task.fetch({url:"https://api.example"}).then(({body})=>$done({body}));',
            '$task.fetch({url:"https://api.example"}).then(r=>$done(r));',
        ]
        for source in sources:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                compile_source(source)

    def test_batch_failures_have_reasons_and_successes_are_native(self):
        items=[dict(id='good',source='$done({});',author='A',url='https://example.test/a.js',license_text='MIT'),
               dict(id='bad',source='try{$done({})}finally{$notify("late")}',author='A',url='https://example.test/b.js',license_text='MIT')]
        errors={}
        generated=convert_scripts(items, errors=errors)
        self.assertEqual(set(generated), {'good'})
        self.assertIn('finally', errors['bad'])
        self.assertNotIn('$done', generated['good'])

    def test_conditional_completion_returns_each_leaf(self):
        from tools.egern_hub.verify import compare
        source='function yes(){$done({body:"yes"})}function no(){$done({body:"no"})}$request.url.includes("yes")?yes():no();'
        output=compile_source(source)
        for suffix in ['yes','no']:
            case={'name':'conditional completion','request':{'url':'https://example.test/'+suffix},'expected':{'result':{'body':suffix}}}
            self.assertEqual(compare(source,output,'surge','https://example.test/source.js',case)['status'],'passed')
        with self.assertRaises(ConversionError):
            compile_source('function yes(){$done({body:"yes"})}unknown()?yes():console.log("continue");')
