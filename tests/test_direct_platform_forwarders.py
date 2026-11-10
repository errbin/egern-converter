"""本地直接转发器可以安全承接 $done；非直接/可变转发器必须拒绝。"""
import unittest
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare
from tools.egern_hub.convert import ConversionError
URL='https://example.test/direct-forwarder.js'

class DirectPlatformForwarderTests(unittest.TestCase):
    def check(self,source,body='ok'):
        output=convert_script(source,'Fixture',URL,'')
        case={'name':'direct platform forwarder','request':{'url':URL},'expected':{'result':{'body':body}}}
        result=compare(source,output,'surge',URL,case)
        self.assertEqual(result['status'],'passed',result)
        return output

    def test_object_property_and_function_declaration_forward_done(self):
        self.check("const h={done:function(f,v){return f(v)}};h.done($done,{body:'ok'});")
        self.check("const h={done:(f,v)=>f(v)};h.done($done,{body:'ok'});")
        self.check("function finish(f,v){return f(v)}finish($done,{body:'ok'});")
        output=convert_script("const h={done:function(f){return f()}};h.done($done);",'Fixture',URL,'')
        self.assertIn('return{}',output.replace(' ',''))

    def test_non_forwarding_shapes_remain_rejected(self):
        for source in [
            "const h={done:function(f,v){return v}};h.done($done,{body:'ok'});",
            "const h={done:function(f,v){return v(f)}};h.done($done,{body:'ok'});",
            "const h={done:function(f,v){console.log(v);return f(v)}};h.done($done,{body:'ok'});",
            "const h={done:function(f,v){return f(v)}};h.done=function(){return 1};h.done($done,{body:'ok'});",
            "const h={done:function(f,v){return f(v)}};unknown(h);h.done($done,{body:'ok'});",
        ]:
            with self.subTest(source=source),self.assertRaises(ConversionError):
                convert_script(source,'Fixture',URL,'')

    def test_read_only_object_escape_keeps_the_forwarder_proven(self):
        self.check(
            "const h={done:function(f,v){return f(v)},same:function(a,b){return a!==b}};"
            "h.same(h,{});h.done($done,{body:'ok'});"
        )

    def test_platform_value_forwarders_cover_notify_and_timers(self):
        notify = "const h={call:function(f,a,b,c,d){return f(a,b,c,d)}};h.call($notify,'t','s','b',{url:'https://example.test/'});$done({body:'ok'});"
        native = convert_script(notify, 'Fixture', URL, '', source_format='qx')
        self.assertNotIn('$notify', native)
        self.assertIn('ctx.notify', native)
        case = {'name': 'notify forwarder', 'request': {'url': URL},
                'expected': {'result': {'body': 'ok'}, 'events': {'notifications': [{'title': 't'}]}}}
        result = compare(notify, native, 'qx', URL, case)
        self.assertEqual(result['status'], 'passed', result)

        timer = "const h={delay:function(f,cb,ms){return f(cb,ms)}};new Promise(resolve=>h.delay(setTimeout,()=>resolve('ok'),10)).then(v=>$done({body:v}));"
        for output_format in ['qx', 'surge', 'loon']:
            with self.subTest(format=output_format):
                native = convert_script(timer, 'Fixture', URL, '', source_format=output_format)
                case = {'name': 'timer forwarder', 'request': {'url': URL}, 'event_loop': True,
                        'expected': {'result': {'body': 'ok'}}}
                result = compare(timer, native, output_format, URL, case)
                self.assertEqual(result['status'], 'passed', result)

    def test_platform_value_forwarders_still_require_exact_argument_order(self):
        for source in [
            "const h={call:function(f,a,b){return f(b,a)}};h.call($notify,'t','s');$done({});",
            "const h={delay:function(f,cb,ms){return f(ms,cb)}};h.delay(setTimeout,()=>{},10);$done({});",
        ]:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '')

    def test_mutating_or_aliasing_escape_is_rejected(self):
        for source in [
            "const h={done:function(f,v){return f(v)},mutate:function(o){o.done=function(){return 1}}};"
            "h.mutate(h);h.done($done,{body:'ok'});",
            "const h={done:function(f,v){return f(v)},mutate:function(o,k){o[k]=function(){return 1}}};"
            "h.mutate(h,'done');h.done($done,{body:'ok'});",
            "const h={done:function(f,v){return f(v)}};unknown(h);h.done($done,{body:'ok'});",
            "const h={done:function(f,v){return f(v)}};Object.assign(h,{done:function(){return 1}});"
            "h.done($done,{body:'ok'});",
        ]:
            with self.subTest(source=source),self.assertRaises(ConversionError):
                convert_script(source,'Fixture',URL,'')
