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
