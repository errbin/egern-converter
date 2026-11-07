"""Observable SDK behavior and conservative boundaries of static specialization."""
import json
from pathlib import Path
import subprocess
import unittest
from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script,convert_scripts
from tools.egern_hub.verify import compare

ROOT=Path(__file__).resolve().parents[1]
URL='https://example.test/capture.js'


def node(code,value):
    result=subprocess.run(['node','--input-type=module','-e',code],input=json.dumps(value),text=True,capture_output=True,cwd=ROOT,check=True)
    return json.loads(result.stdout)


class CookieCompilerGuardTests(unittest.TestCase):
    def equivalent(self,source,fixture):
        output=convert_script(source,'Fixture',URL,'',source_format='loon')
        result=compare(source,output,'loon',URL,fixture)
        self.assertEqual(result['status'],'passed',result)
        return output

    def test_forwarded_http_options_preserve_optional_headers_and_response_mutation(self):
        source='''const r=init();
        (async()=>{const a=await get({url:'https://api.test/one'});
          const b=await get({url:'https://api.test/two',headers:{Token:'fixture'}});
          $done({body:a+'|'+b})})();
        function get(opts){return new Promise(resolve=>r.get(opts,(e,resp,body)=>resolve(e||resp.statusCode+':'+resp.body)))}
        function init(){const get=(opts,cb)=>$httpClient.get(opts,(e,resp,body)=>{if(!e){resp.body=body;resp.statusCode=resp.status}cb(e,resp,body)});return {get}}'''
        fixture={'name':'HTTP forwarding','request':{'url':URL},'response':{'body':'old'},
                 'http':[{'url':'https://api.test/one','status':201,'body':'one'}, {'url':'https://api.test/two','status':202,'body':'two'}],
                 'expected':{'result':{'body':'201:one|202:two'}}}
        for response in [None,'offline']:
            case=json.loads(json.dumps(fixture))
            if response:case['http'][1]={'url':'https://api.test/two','error':response};case['expected']['result']['body']='201:one|offline'
            self.equivalent(source,case)

    def test_notification_result_builder_keeps_options_and_argument_order(self):
        source='''let count=0;
        function text(){return String(++count)}
        function options(){const result={};if($request.url.includes('open'))Object.assign(result,{url:'https://example.test/'});return result}
        $notification.post(text(),text(),text(),options());$done({body:String(count)});'''
        for suffix in ['open','empty']:
            self.equivalent(source,{'name':'notification builder','request':{'url':'https://example.test/'+suffix},
                'expected':{'result':{'body':'3'},'events':{'notifications':[{'title':'1','subtitle':'2','body':'3',**({'action':{'type':'openUrl','url':'https://example.test/'}} if suffix=='open' else {})}]}}})

    def test_constant_completion_branches_keep_later_result(self):
        for source in [
            'function finish(x){if(x)$done({});}finish(false);$done({body:"later"});',
            'function finish(x){if(x)return;$done({});}finish(true);$done({body:"later"});',
        ]:self.equivalent(source,{'name':'constant completion','request':{'url':URL},'expected':{'result':{'body':'later'}}})

    def test_returned_conditional_completion_propagates_both_branches(self):
        source='function finish(){return $request.url.endsWith("yes")?$done({body:"yes"}):$done({body:"no"})}finish();'
        for name in ['yes','no']:self.equivalent(source,{'name':name,'request':{'url':URL+'/'+name},'expected':{'result':{'body':name}}})

    def test_conditional_catch_chain_short_circuits_after_completion(self):
        source='''const r=init();$request.url.endsWith('capture')?r.done({body:'capture'}):(async()=>{throw Error('fixture')})().catch(e=>r.done({body:e.message}));
        function init(){const done=(value={})=>$done(value);return {done}}'''
        for suffix,body in [('capture','capture'),('error','fixture')]:self.equivalent(source,{'name':suffix,'request':{'url':URL+'/'+suffix},'expected':{'result':{'body':body}}})

    def test_platform_records_are_not_folded_after_mutation_or_escape(self):
        inputs=[
            'const env={isNode:false};env.isNode=true;if(env.isNode)work();',
            'const env={isNode:false};const alias=env;alias.isNode=true;if(env.isNode)work();',
            'const env={isNode:false};Object.assign(env,{isNode:true});if(env.isNode)work();',
            'const env={isNode:false};unknown(env);if(env.isNode)work();',
            'const env={isNode:false};for(env.isNode of [true]){}if(env.isNode)work();',
        ]
        outputs=node("import{platformFold}from'./tools/js-analysis/platform/globals.mjs';let s='';for await(const p of process.stdin)s+=p;console.log(JSON.stringify(JSON.parse(s).map(s=>platformFold(s,'loon').source)))",inputs)
        for output in outputs:self.assertIn('if(env.isNode)',output)

    def test_destructuring_and_loop_assignments_invalidate_parameter_proofs(self):
        sources=[
            'let mode=false;[mode]=[true];if(mode)$done({body:"yes"});else $done({body:"no"});',
            'let mode=false;({x:mode}={x:true});if(mode)$done({body:"yes"});else $done({body:"no"});',
            'let mode=false;for(mode of [true]){}if(mode)$done({body:"yes"});else $done({body:"no"});',
        ]
        for source in sources:self.equivalent(source,{'name':'write tracking','request':{'url':URL},'expected':{'result':{'body':'yes'}}})

    def test_custom_to_string_returning_a_function_is_rejected(self):
        for source in [
            'const o={toString(){return function hidden(){$done({})}}};$done({body:o.toString().toString()});',
            'const o={match(){return function hidden(){$done({})}}};$done({body:o.match().toString()});',
            'Array.prototype.toString=()=>function hidden(){$done({})};const o=[];$done({body:o.toString().toString()});',
        ]:
            with self.assertRaisesRegex(ConversionError,'toString'):convert_script(source,'Fixture',URL,'',source_format='loon')

    def test_unused_allocations_do_not_drop_coercion_or_prototype_effects(self):
        sources=[
            'function make(){const value={valueOf(){record()}};return +value}make();',
            'function make(){return typeof value;let value}make();',
            'function make(){const out={};["GET"].forEach(k=>out[k.toLowerCase()]=()=>0);return out}Array.prototype.forEach=unknown;make();',
        ]
        values=node("import{parse}from'./tools/js-analysis/vendor/acorn.mjs';import{index}from'./tools/js-analysis/core/ast.mjs';import{inertFactoryCall}from'./tools/js-analysis/transforms/factories.mjs';let s='';for await(const p of process.stdin)s+=p;console.log(JSON.stringify(JSON.parse(s).map(s=>{const ix=index(parse(s,{ecmaVersion:'latest'}));return inertFactoryCall(ix,ix.nodes.find(n=>n.type==='CallExpression'&&n.callee.name==='make'))})))",sources)
        self.assertEqual(values,[False,False,False])

    def test_missing_option_is_not_folded_after_prototype_mutation(self):
        sources=[
            "Object.prototype.method='POST';function send(options){return options.method}send({url:'x'});",
            "Object.defineProperty(Object.prototype,'method',{value:'POST'});function send(options){return options.method}send({url:'x'});",
            "const proto=Object.prototype;proto.method='POST';function send(options){return options.method}send({url:'x'});",
        ]
        outputs=node("import{specializeParameters}from'./tools/js-analysis/transforms/specialization.mjs';let s='';for await(const p of process.stdin)s+=p;console.log(JSON.stringify(JSON.parse(s).map(s=>specializeParameters(s))))",sources)
        for output in outputs:self.assertIn('options.method',output)

    def test_json_roundtrip_retains_object_literal_prototypes_without_general_eval(self):
        # Only these synthetic, test-owned original expressions execute eval.
        inputs=[None,{'a':[1,True,None]}, {'__proto__':{'toString':'custom'},'a':1}, {'__proto__':None}, [1,{'__proto__':{'x':2},'b':3}]]
        output=node("""import{lowerJSONEvaluation}from'./tools/js-analysis/transforms/evaluation.mjs';let s='';for await(const p of process.stdin)s+=p;
        const original='eval(`(${JSON.stringify(input)})`)';const rewritten=lowerJSONEvaluation(original);
        const describe=v=>v===null?null:typeof v!=='object'?v:{keys:Object.keys(v),prototype:Object.getPrototypeOf(v)===null?null:Object.getPrototypeOf(v)===Object.prototype?'Object':Object.getPrototypeOf(v)===Array.prototype?'Array':Object.getPrototypeOf(v),children:Object.keys(v).map(k=>describe(v[k]))};
        console.log(JSON.stringify({count:rewritten.transformations.length,pairs:JSON.parse(s).map(input=>[describe(eval(original)),describe(eval(rewritten.source))]),general:lowerJSONEvaluation('eval(input)').source}));""",inputs)
        self.assertEqual(output['count'],1)
        self.assertEqual(output['general'],'eval(input)')
        for left,right in output['pairs']:self.assertEqual(left,right)

    def test_undefined_notification_options_are_omitted_and_evaluated_once(self):
        source='''let count=0;function option(){count++;return undefined}
        $notification.post('title','','',{url:option(),mediaUrl:option()});$done({body:String(count)});'''
        self.equivalent(source,{'name':'undefined options','request':{'url':URL},'expected':{'result':{'body':'2'},'events':{'notifications':[{'title':'title','subtitle':'','body':''}]}}})

    def test_unused_generated_client_pruning_keeps_constructor_effects(self):
        template='''const r=API();r.done();function API(){function HTTP(){%s}return new class{constructor(){this.http=HTTP();$persistentStore.write('initialized','constructor')}done(){$done({})}}}'''
        items=[{'id':'capture','url':URL,'source':template%"const clients={};['GET','POST'].forEach(k=>clients[k.toLowerCase()]=()=>require('unused'));return clients",'author':'Fixture','license_text':'','source_format':'loon','entry_types':['http_request']}]
        output=convert_scripts(items)['capture']
        self.assertNotIn('require(',output)
        self.assertEqual(compare(items[0]['source'],output,'loon',URL,{'name':'unused client','request':{'url':URL},'expected':{'storage':{'constructor':'initialized'}}})['status'],'passed')
        items[0]['source']=template%"$persistentStore.write('called','allocation');return {}"
        output=convert_scripts(items)['capture']
        result=compare(items[0]['source'],output,'loon',URL,{'name':'effectful client','request':{'url':URL},'expected':{'storage':{'constructor':'initialized','allocation':'called'}}})
        self.assertEqual(result['status'],'passed',result)

    def test_pending_task_observes_trailing_initializers_without_serializing_launch(self):
        source='''if($request.url.endsWith('a'))a();else b();var count=7;
        async function a(){await Promise.resolve();$persistentStore.write(String(count),'count');$done({body:'a'})}
        async function b(){await Promise.resolve();$done({body:String(count)})}'''
        for suffix in ['a','b']:
            expected={'result':{'body':'a' if suffix=='a' else '7'}}
            if suffix=='a':expected['storage']={'count':'7'}
            output=self.equivalent(source,{'name':'pending '+suffix,'request':{'url':URL+'/'+suffix},'expected':expected})
            self.assertIn('pendingResult',output)
        for source in [
            'async function a(){await Promise.resolve();$done({})}a();a();var count=7;',
            'async function a(){await Promise.resolve();$done({})}a();$persistentStore.write("late","key");',
            'async function a(){await Promise.resolve();$done({})}a();const count=unknown();',
        ]:
            with self.assertRaises(ConversionError):convert_script(source,'Fixture',URL,'',source_format='loon')

    def test_distinct_callback_contracts_keep_native_completion_and_http_results(self):
        source='''const env=init();
        (async()=>{const body=await fetch();env.get({url:'https://api.test/two',method:'GET'},(e,r,b)=>env.done({body:body+'|'+b}))})();
        function fetch(){return new Promise(resolve=>env.get({url:'https://api.test/one',method:'GET'},(e,r,b)=>resolve(b)))}
        function init(){const get=(opts,callback)=>{$httpClient.get(opts,(e,r,b)=>callback(e,r,b))};const done=(value={})=>$done(value);return {get,done}}'''
        self.equivalent(source,{'name':'callback contracts','request':{'url':URL},'http':[{'url':'https://api.test/one','body':'one'},{'url':'https://api.test/two','body':'two'}],
            'expected':{'result':{'body':'one|two'}}})
