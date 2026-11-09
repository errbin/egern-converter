"""Closed SDK lowering must preserve effects and reject escaping receivers."""
import unittest
from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script, convert_scripts
from tools.egern_hub.verify import compare

URL='https://example.test/cookie.js'
FACTORY='''function init(){
 isSurge=()=>undefined===this.$httpClient?false:true;
 isQuanX=()=>undefined===this.$task?false:true;
 save=(value,key)=>{if(isSurge())return $persistentStore.write(value,key);if(isQuanX())return $prefs.setValueForKey(value,key)};
 notify=(title)=>{if(isSurge())$notification.post(title,'','');if(isQuanX())$notify(title,'','')};
 done=(value={})=>$done(value);
 unused=()=>eval('unknown');
 return {save,notify,done};
}'''


def compile_source(source, **options):
    return convert_script(source,'Fixture',URL,'',source_format='loon',**options)


class CookieFactoryTests(unittest.TestCase):
    def assert_equivalent(self,source,fixture,**options):
        output=compile_source(source,**options)
        result=compare(source,output,'loon',URL,fixture)
        self.assertEqual(result['status'],'passed',result)
        self.assertNotRegex(output.split('export default',1)[1],r'\$(?:done|request|response|httpClient|task|prefs|persistentStore|notification|notify)\b|new Env|function init\(')
        return output

    def test_implicit_factory_functions_are_closed_and_direct_native(self):
        source="const r=init();r.save($request.headers.Cookie,'cookie');r.notify('saved');r.done();"+FACTORY
        fixture={'name':'capture','request':{'url':URL,'headers':{'Cookie':'fixture-cookie'}},
                 'expected':{'storage':{'cookie':'fixture-cookie'}}}
        output=self.assert_equivalent(source,fixture)
        self.assertIn('ctx.storage.set(',output)
        self.assertIn('ctx.notify(',output)
        self.assertNotIn('eval(',output)

    def test_forwarded_default_and_explicit_completion_fields(self):
        for call in ['r.done()','r.done(undefined)','r.done({body:"changed"})']:
            source='const r=init();'+call+';'+FACTORY
            self.assert_equivalent(source,{'name':'default','request':{'url':URL},'response':{'body':'old'}})

    def test_constructor_state_and_finally_completion_preserve_effects(self):
        source='''const r=new Env('Capture');
        (async()=>{r.subtitle='saved';r.save($request.headers.Cookie,'cookie')})()
          .finally(()=>{r.notify(r.name);r.done()});
        function Env(name){this.name=name;this.logs=[];
        this.isSurge=()=>typeof $httpClient!=='undefined';
        this.save=(value,key)=>this.isSurge()?$persistentStore.write(value,key):false;
        this.notify=title=>$notification.post(title,this.subtitle,'');
        this.unused=()=>require('fs');this.done=(value={})=>$done(value)}'''
        self.assert_equivalent(source,{'name':'state','request':{'url':URL,'headers':{'Cookie':'fixture'}},'expected':{'storage':{'cookie':'fixture'}}})

    def test_factory_values_keep_order_captures_and_shadowed_parameters(self):
        source='''const r=init();$done({body:r.value('keep')});
        function init(){const state=[];const helper=x=>x+'!';
          const value=helper=>{state.push(helper);return state.join(',')};return {value}}'''
        output=self.assert_equivalent(source,{'name':'shadow','request':{'url':URL},'response':{'body':'old'},'expected':{'result':{'body':'keep'}}})
        self.assertNotIn("x + '!'",output)

    def test_request_phase_is_derived_input_and_shared_jobs_merge_phases(self):
        source='''if(typeof $request!=='undefined')capture();else scheduled();
        function capture(){$persistentStore.write($request.headers.Cookie,'cookie');$done({})}
        function scheduled(){eval('unavailable')}'''
        items=[{'id':'capture','url':URL,'source':source,'author':'Fixture','license_text':'','source_format':'loon','entry_types':['http_request']}]
        output=convert_scripts(items)['capture']
        self.assertNotIn('eval(',output)
        fixture={'name':'phase','request':{'url':URL,'headers':{'Cookie':'value'}}}
        self.assertEqual(compare(source,output,'loon',URL,fixture)['status'],'passed')
        errors={}
        convert_scripts(items+[dict(items[0],id='schedule',entry_types=['schedule'])],errors=errors)
        self.assertEqual(set(errors),{'capture','schedule'})

    def test_receiver_mutation_escape_early_use_and_strict_globals_are_rejected(self):
        for entry in [
            'const r=init();unknown(r);r.done();',
            'const r=init();r.done=()=>0;r.done();',
            'const r=init();const f=r.save;r.done();',
            'const r=init();save=()=>0;r.done();',
            'save("early","key");const r=init();r.done();',
            '"use strict";const r=init();r.done();',
        ]:
            with self.subTest(entry=entry),self.assertRaises(ConversionError):compile_source(entry+FACTORY)
        # 接收者逃逸的实例方法里的完成结果仍可转换：this 的 sloppy 语义由包装保留，
        # 完成流按方法调用点传播，不再因为没有静态接收者证明而拒绝。
        source='const r=new Env("Fixture");unknown(r);r.done();function Env(name){this.name=name;this.done=()=>$done({})}'
        output=compile_source(source)
        self.assertNotIn('$done',output)

    def test_top_level_message_this_is_readonly_and_lexical(self):
        source='if(this.$request)$persistentStore.write(this.$request.body,"body");$done({});'
        self.assert_equivalent(source,{'name':'global message','request':{'url':URL,'body':'fixture'},'expected':{'storage':{'body':'fixture'}}})
        with self.assertRaises(ConversionError):compile_source('function read(){return this.$request.body}$done({body:read()});')
