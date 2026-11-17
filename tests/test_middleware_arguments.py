"""中间件参数声明与入口契约的定向回归。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script


# SDK 方法体取自 kokoryh/Sparkle 的真实打包产物；业务中间件缩短为单个透传函数，
# 只保留被测的 setupArgument、compose 与 new Runner().use(...).run() 入口形状。
SOURCE = '''var p=class{static log(e){console.log(e)}};
var x=t=>async(e,r)=>{let o=s=>async()=>{let n=s===t.length?r:t[s];if(n)return await n(e,o(s+1))};return o(0)()};
var l=class{static createInstance(){if(typeof $loon<"u")return new b;if(typeof $task<"u")throw new Error("QuantumultX is not supported");return new y}request;response;state={};argument={};constructor(){this.request=this.createRequest(typeof $request<"u"?$request:null),this.response=this.createResponse(typeof $response<"u"?$response:null)}exit(){$done({})}end(){let e=this.state.type;e==="response"?this.done(this.response):e==="fakeResponse"?this.done({response:this.response}):e==="request"?this.done(this.request):e==="abort"?this.abort():this.exit()}};
var y=class extends l{createRequest(e){return Object.create(e,{bodyBytes:{get(){return this.body},set(r){this.body=r}}})}createResponse(e){return Object.create(e,{bodyBytes:{get(){return this.body},set(r){this.body=r}}})}setupArgument(e){if(Object.assign(this.argument,e),typeof $argument=="string")try{Object.assign(this.argument,JSON.parse($argument))}catch(r){p.log(r)}}getVal(e){return $persistentStore.read(e)}setVal(e,r){$persistentStore.write(r,e)}done(e){$done({...e})}abort(){$done({abort:!0})}};
var b=class extends y{setupArgument(e){super.setupArgument(e),typeof $argument=="object"&&Object.assign(this.argument,$argument)}abort(){$done()}};
var g=class{middleware=[];use(e){return this.middleware.push(e),this}run(){let e=l.createInstance();x(this.middleware)(e).catch(r=>e.onerror(r)).finally(()=>e.end())}};
new g().use((e,t)=>{e.setupArgument({flag:true});return t()}).run();
'''

URL = 'https://example.test/middleware.js'


def convert(source, source_format='loon'):
    return convert_script(source, 'Fixture', URL, '', source_format=source_format)


class MiddlewareArgumentTests(unittest.TestCase):
    def test_setup_argument_merges_defaults_and_configured_json(self):
        for source_format in ('loon', 'surge'):
            with self.subTest(source_format=source_format):
                output = convert(SOURCE, source_format)
                self.assertIn('setupArgument(e)', output)
                self.assertIn('Object.assign(this.argument, e)', output)
                self.assertIn('JSON.parse(ctx.env.argument)', output)
                self.assertIn('e.setupArgument({', output)
                self.assertIn('async run()', output)

    def test_unreviewed_setup_argument_shapes_are_rejected(self):
        cases = {
            'copy': SOURCE.replace('Object.assign(this.argument,e)', 'Object.assign(this.argument,{...e})', 1),
            'dynamic-key': SOURCE.replace('Object.assign(this.argument,e)', 'Object.assign(this.argument,{[e.key]:e.value})', 1),
            'escaped-value': SOURCE.replace('Object.assign(this.argument,e)', 'this.argument=e', 1),
        }
        for label, source in cases.items():
            with self.subTest(label=label), self.assertRaisesRegex(ConversionError, '未知的 surge.setupArgument 语义契约'):
                convert(source)

    def test_runner_requires_reviewed_compose_and_single_entry(self):
        changed_compose = SOURCE.replace('if(n)return await n(e,o(s+1))', 'if(n)return n(e,o(s+1))', 1)
        renamed_compose = (changed_compose.replace('var x=t=>', 'var _=t=>')
                           .replace('x(this.middleware)', '_(this.middleware)'))
        cases = {
            'changed-compose': (changed_compose, '未知的 runner 语义契约'),
            'renamed-changed-compose': (renamed_compose, '未知的 runner 语义契约'),
            'second-entry': (SOURCE + 'new g().run();\n', '中间件入口不是唯一的顶层调用'),
        }
        for label, (source, error) in cases.items():
            with self.subTest(label=label), self.assertRaisesRegex(ConversionError, error):
                convert(source)


if __name__ == '__main__':
    unittest.main()
