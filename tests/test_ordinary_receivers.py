import unittest
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.convert import ConversionError
from tools.egern_hub.verify import compare


class OrdinaryReceiverTests(unittest.TestCase):
    def check(self, source, body):
        output=convert_script(source,'Author','https://example.test/source.js','')
        case={'name':'ordinary receiver','request':{'url':'https://example.test/'},
              'expected':{'result':{'body':body}}}
        result=compare(source,output,'surge','https://example.test/source.js',case)
        self.assertEqual(result['status'],'passed',result)

    def test_ordinary_values_and_instance_methods(self):
        self.check('class Value{toString(){return "ordinary"}read(){return this.toString()}}$done({body:new Value().read()});','ordinary')
        self.check('function f(v){return typeof v!=="object"?String(v):v.toString()}$done({body:f([1,2])});','1,2')
        self.check('function f(v){if(typeof v==="string")return v.toString();return "other"}$done({body:f("text")});','text')

    def test_property_descriptor_receiver_is_bound_by_object_create(self):
        self.check('const o=Object.create({body:"text"},{bodyBytes:{get(){return this.body},set(v){this.body=v}}});o.bodyBytes="changed";$done({body:o.bodyBytes});','changed')

    def test_readonly_standard_object_members_keep_descriptor_proof(self):
        self.check('const ignored=Object.prototype.toString;const keys=globalThis.Object.keys({a:1}).join(",");const o=Object.create({body:"text"},{bodyBytes:{get(){return this.body},set(v){this.body=v}}});o.bodyBytes="changed";$done({body:keys+":"+o.bodyBytes});','a:changed')

    def test_error_logging_and_inherited_instance_methods_are_ordinary_js(self):
        self.check('function log(e){return e instanceof Error?e.toString():"other"}$done({body:log(new Error("message"))});','Error: message')
        self.check('class Exit extends Error{toString(){return "exit"}read(){return this.toString()}}function log(e){if(e instanceof Exit)return e.toString();return "other"}$done({body:log(new Exit())+new Exit().read()});','exitexit')
        self.check('function log(v){return typeof v!=="object"||v===null?String(v):v instanceof Error?v.toString():Array.isArray(v)?JSON.stringify(v):typeof v.toString==="function"&&v.toString!==Object.prototype.toString?v.toString():JSON.stringify(v)}$done({body:log({toString(){return "object"}})});','object')

    def test_closed_define_property_alias_keeps_object_create_receiver(self):
        self.check('const define=Object.defineProperty;const value={};define(value,"key",{value:1});const o=Object.create({body:"text"},{bodyBytes:{get(){return this.body}}});$done({body:o.bodyBytes+value.key});','text1')

    def test_standard_object_instances_keep_ordinary_string_conversion(self):
        self.check('const value=new URL("https://example.test/");value.hostname="example.test";$done({body:value.toString()});','https://example.test/')
        self.check('const value=new Map();value.set("key",1);$done({body:value.toString()});','[object Map]')

    def test_source_inspection_and_unknown_this_still_reject(self):
        for source in [
            'function f(){return "x"}$done({body:f.toString()});',
            'class F{static read(){return this.toString()}}$done({body:F.read()});',
            'function f(v){if(typeof v!=="function")return "other";return v.toString()}$done({body:f(()=>1)});',
            'function f(v){if(typeof v==="object"){v=()=>1;return v.toString()}}$done({body:f({})});',
            'function f(v){if(typeof v==="object"){[v]=[()=>1];return v.toString()}}$done({body:f({})});',
            'function f(v){if(typeof v==="object"){for(v of [()=>1])return v.toString()}}$done({body:f({})});',
            'Object.create=(p,d)=>d.bodyBytes.get();const o=Object.create({body:"x"},{bodyBytes:{get(){return this.body}}});$done({body:o});',
            'globalThis.Object.create=(p,d)=>d.bodyBytes.get();const o=Object.create({body:"x"},{bodyBytes:{get(){return this.body}}});$done({body:o});',
            'function f(){return this.body}$done({body:f()});',
            'class F extends Function{read(){return this.toString()}}$done({body:new F("return 1").read()});',
            'class Fake extends Error{static [Symbol.hasInstance](x){return true}}function f(x){return x instanceof Fake?x.toString():"other"}$done({body:f(()=>1)});',
        ]:
            with self.subTest(source=source),self.assertRaises(ConversionError):
                convert_script(source,'Author','https://example.test/source.js','')
