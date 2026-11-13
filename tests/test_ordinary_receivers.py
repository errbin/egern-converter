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

    def test_closed_local_constructor_and_prototype_methods_keep_instance_this(self):
        # 构造函数写成函数表达式、方法挂在原型上（含计算属性名）时，this 指向
        # 本地构造出的实例，属于普通 JavaScript，不是旧平台全局对象。
        self.check('var C=function(v){this.value=v};C.prototype.read=function(){return this.value};$done({body:new C("ok").read()});','ok')
        self.check('var C=function(v){this["\\x76"]=v};C["prototype"]["read"]=function(){return this["\\x76"]};$done({body:new C("ok")["read"]()});','ok')

    def test_escaped_constructor_keeps_sloppy_this(self):
        # 构造器引用逃逸（keep=C）或经 .constructor 取回后再普通调用，this 仍按 sloppy
        # 语义取全局对象；构造器与原型链保持原样，因此 .constructor 同一性比较也一致。
        self.check('var C=function(){this.v=1};var keep=C;C.prototype.read=function(){return this.v};$done({body:typeof this});','object')
        self.check('var C=function(v){this.v=v};C.prototype.read=function(){return this.v};var x=new C(1);$done({body:x.constructor===C?x.read():"no"});',1)

    def test_plain_call_this_reads_the_global_object(self):
        # 普通调用里的 this 在旧平台是全局对象，转换后由 sloppy 语义包装保留，
        # 因此这类读取不再拒绝，改为验证行为等价。
        self.check('function f(){return this.body}$done({body:String(f())});','undefined')

    def test_sloppy_primitive_property_write_keeps_silent_failure(self):
        # 旧平台脚本给字符串写属性会静默失败；ES 模块严格模式必须保持同样结果，
        # 不能额外抛出 TypeError 并改变完成消息。
        self.check('function update(e){e.data.signed=1;return "ok"}$done({body:update({data:"fixture"})});','ok')

    def test_program_scope_this_keeps_the_script_global_object(self):
        # 旧平台脚本作用域的 this 就是全局对象；产物是 ES 模块、没有顶层 this，
        # 因此生成代码里注入一个指向标准 globalThis 的局部绑定，行为保持一致。
        self.check('var g=this;$done({body:typeof g});','object')
        self.check('(function(g){$done({body:typeof g})})(this);','object')

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
            # 接收者逃逸的构造器与 constructor 反射不再拒绝：sloppy 语义由注入包装保留。
            'class F extends Function{read(){return this.toString()}}$done({body:new F("return 1").read()});',
            'class Fake extends Error{static [Symbol.hasInstance](x){return true}}function f(x){return x instanceof Fake?x.toString():"other"}$done({body:f(()=>1)});',
        ]:
            with self.subTest(source=source),self.assertRaises(ConversionError):
                convert_script(source,'Author','https://example.test/source.js','')
