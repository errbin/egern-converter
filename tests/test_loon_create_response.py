"""loon.createResponse 基态与安全 trailers 描述符的结构化契约回归。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script


# SDK 骨架取自 kokoryh/Sparkle 的中间件客户端；业务中间件保持透传，
# 只替换被测的 loon.createResponse 实现。
SOURCE = '''var p=class{static log(e){console.log(e)}};
var x=t=>async(e,r)=>{let o=s=>async()=>{let n=s===t.length?r:t[s];if(n)return await n(e,o(s+1))};return o(0)()};
var l=class{static createInstance(){if(typeof $loon<"u")return new b;if(typeof $task<"u")throw new Error("QuantumultX is not supported");return new y}request;response;state={};argument={};constructor(){this.request=this.createRequest(typeof $request<"u"?$request:null),this.response=this.createResponse(typeof $response<"u"?$response:null)}exit(){$done({})}end(){let e=this.state.type;e==="response"?this.done(this.response):e==="fakeResponse"?this.done({response:this.response}):e==="request"?this.done(this.request):e==="abort"?this.abort():this.exit()}};
var y=class extends l{createRequest(e){return Object.create(e,{bodyBytes:{get(){return this.body},set(r){this.body=r}}})}createResponse(e){return Object.create(e,{bodyBytes:{get(){return this.body},set(r){this.body=r}}})}setupArgument(e){if(Object.assign(this.argument,e),typeof $argument=="string")try{Object.assign(this.argument,JSON.parse($argument))}catch(r){p.log(r)}}getVal(e){return $persistentStore.read(e)}setVal(e,r){$persistentStore.write(r,e)}done(e){$done({...e})}abort(){$done({abort:!0})}};
var b=class extends y{CREATE_RESPONSE setupArgument(e){super.setupArgument(e),typeof $argument=="object"&&Object.assign(this.argument,$argument)}abort(){$done()}};
var g=class{middleware=[];use(e){return this.middleware.push(e),this}run(){let e=l.createInstance();x(this.middleware)(e).catch(r=>e.onerror(r)).finally(()=>e.end())}};
new g().use((e,t)=>{e.setupArgument({flag:true});return t()}).run();
'''

TRAILER_MIDDLEWARE = '''var Ut=(s,e)=>e().then(()=>{if(s.response.trailers!==void 0||s.request.headers.te!=="trailers")return;let t=s.response.headers;Object.hasOwn(t,"grpc-status")||(s.response.headers={...t,"grpc-status":"0"})});
new g().use((e,t)=>{e.response.trailers=e.response.headers;return t()}).use(Ut).run();
'''

BODY_BYTES = 'bodyBytes:{get(){return this.body},set(t){this.body=t}}'
TRAILERS = 'trailers:{get(){return this.h2_trailers},set(t){this.h2_trailers=t}}'


def source_for(descriptors, middleware=None, parameter='e', value='t'):
    create = 'createResponse(%s){return Object.create(%s,{%s})}' % (parameter, parameter, descriptors)
    create = create.replace('set(t)', 'set({})'.format(value)).replace('this.body=t', 'this.body={}'.format(value)).replace('this.h2_trailers=t', 'this.h2_trailers={}'.format(value))
    source = SOURCE.replace('CREATE_RESPONSE ', create + ' ')
    return source if middleware is None else source.replace("new g().use((e,t)=>{e.setupArgument({flag:true});return t()}).run();\n", middleware)


def convert(source):
    return convert_script(source, 'Fixture', 'https://example.test/loon-create-response.js', '', source_format='loon')


class LoonCreateResponseTests(unittest.TestCase):
    def test_base_shape_is_registered_by_method_contract(self):
        output = convert(source_for(BODY_BYTES))
        self.assertIn('export default async function', output)

    def test_exact_trailers_descriptor_is_dropped(self):
        variants = {
            'standard': source_for(BODY_BYTES + ',' + TRAILERS, TRAILER_MIDDLEWARE),
            'renamed-parameters': source_for(BODY_BYTES + ',trailers:{get(){return this.h2_trailers},set(value){this.h2_trailers=value}}', TRAILER_MIDDLEWARE, 'response', 'value'),
            'descriptor-order': source_for(TRAILERS + ',' + BODY_BYTES, TRAILER_MIDDLEWARE),
        }
        for label, source in variants.items():
            with self.subTest(label=label):
                output = convert(source)
                self.assertNotIn('.trailers', output)
                self.assertNotIn('trailers:', output)
                self.assertNotIn('h2_trailers', output)
                self.assertIn('s.request.headers.te !== "trailers"', output)

    def test_other_descriptors_and_changed_shapes_are_rejected(self):
        unknown = '未知的 loon.createResponse 语义契约'
        cases = {
            'extra-status': (BODY_BYTES + ',' + TRAILERS + ',status:{value:200}', unknown),
            'extra-headers': (BODY_BYTES + ',' + TRAILERS + ',headers:{value:{}}', unknown),
            'extra-custom-key': (BODY_BYTES + ',' + TRAILERS + ',anything:{value:1}', unknown),
            'trailers-wrong-getter': (BODY_BYTES + ',trailers:{get(){return this.other},set(t){this.h2_trailers=t}}', 'trailers 读取器'),
            'trailers-wrong-setter': (BODY_BYTES + ',trailers:{get(){return this.h2_trailers},set(t){this.other=t}}', 'trailers 写入器'),
            'trailers-enumerable': (BODY_BYTES + ',' + TRAILERS + ',enumerable:!0', unknown),
            'trailers-value': (BODY_BYTES + ',trailers:{value:void 0}', unknown),
            'bodybytes-getter-changed': (BODY_BYTES.replace('return this.body', 'return this.data') + ',' + TRAILERS, unknown),
            'bodybytes-setter-changed': (BODY_BYTES.replace('this.body=t', 'this.data=t') + ',' + TRAILERS, unknown),
            'bodybytes-writable': (BODY_BYTES.replace('set(t){this.body=t}', 'set(t){this.body=t},writable:!0') + ',' + TRAILERS, unknown),
            'trailers-configurable': (BODY_BYTES + ',' + TRAILERS + ',configurable:!0', unknown),
            'second-extra-descriptor': (BODY_BYTES + ',' + TRAILERS + ',cookies:{value:[]}', unknown),
        }
        for label, (descriptors, message) in cases.items():
            with self.subTest(label=label), self.assertRaisesRegex(ConversionError, message):
                convert(source_for(descriptors))

    def test_unproven_business_trailers_access_is_rejected(self):
        source = source_for(BODY_BYTES + ',' + TRAILERS, 'new g().use((e,t)=>{other.trailers=e.trailers;return t()}).run();\n')
        with self.assertRaisesRegex(ConversionError, '无法证明 trailers 访问'):
            convert(source)


if __name__ == '__main__':
    unittest.main()
