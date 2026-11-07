"""Stored JSON and closed Env SDK conversion, with independent fixture checks."""
import copy
import json
from pathlib import Path
import subprocess
import unittest

from tools.egern_hub.script_convert import convert_script, convert_scripts
from tools.egern_hub.verify import compare, execute

ROOT = Path(__file__).resolve().parents[1]
URL = 'https://gist.githubusercontent.com/Sliverkiss/33800a98dcd029ba09f8b6fc6f0f5162/raw/aliyun.js'
ORIGINAL = ROOT/'sources/Sliverkiss/gist-33800a98dcd029ba09f8b6fc6f0f5162/raw/aliyun.js'


def transform(module, method, sources, *args):
    code = f"""import{{{method}}}from'./tools/js-analysis/{module}.mjs';
    let input='';for await(const chunk of process.stdin)input+=chunk;
    console.log(JSON.stringify(JSON.parse(input).map(source=>{method}(source{''.join(','+json.dumps(a) for a in args)}))));"""
    result = subprocess.run(['node','--input-type=module','-e',code],input=json.dumps(sources),
                            capture_output=True,text=True,check=True,cwd=ROOT)
    return json.loads(result.stdout)


class StoredSDKTests(unittest.TestCase):
    def test_storage_json_conversion_requires_closed_data_provenance(self):
        base = "let data=$prefs.valueForKey('items')||[];data=eval('('+data+')');save(data);function save(value){$prefs.setValueForKey(JSON.stringify(value),'items')}"
        out = transform('transforms/evaluation','lowerStorageEvaluation',[base])[0]
        self.assertEqual(len(out['transformations']),1)
        self.assertIn('JSON.parse(data',out['source'])
        self.assertTrue(out['transformations'][0]['limitations'])
        invalid = [
            base.replace("$prefs.valueForKey('items')",'$request.body'),
            base.replace('save(data);','foreign(data);save(data);'),
            base.replace('save(data);',"data=$request.body;save(data);"),
            base.replace('JSON.stringify(value)','value'),
            'Object.setPrototypeOf(JSON,custom);'+base,
            'JSON.parse=custom;'+base,
            'globalThis.JSON.parse=custom;'+base,
            'const Object=custom;'+base,
            base.replace("$prefs.valueForKey('items')","read('items')")+"function read(key){$prefs.valueForKey(key);return $request.body}",
        ]
        for result in transform('transforms/evaluation','lowerStorageEvaluation',invalid):
            self.assertEqual(result['transformations'],[])

    def test_stored_json_writer_preserves_mutation_and_notifications(self):
        source="""let value=$prefs.valueForKey('items')||[];
        if(!Array.isArray(value))value=eval('('+value+')');
        value.push({name:'fixture'});save(value);$notify('saved','','');$done({});
        function save(items){$prefs.setValueForKey(JSON.stringify(items),'items')}"""
        converted=convert_script(source,'Fixture',URL,'',source_format='qx')
        for initial in [{},{'items':'[{"name":"existing"}]'}]:
            expected=json.loads(initial.get('items','[]'))+[{'name':'fixture'}]
            case={'name':'stored JSON','native_evaluation':True,'request':{'url':'https://example.test/'},'storage':initial,
                  'expected':{'storage':{'items':json.dumps(expected,separators=(',',':'))}}}
            self.assertEqual(compare(source,converted,'qx',URL,case)['status'],'passed')
        self.assertIn('eval(',converted)
        self.assertNotIn('$prefs',converted)

    def test_fixture_json_model_does_not_enable_executable_storage_or_function(self):
        source="let value=eval('('+$prefs.valueForKey('input')+')');$done({body:JSON.stringify(value)});"
        fixture={'name':'JSON only','request':{'url':'https://example.test/'},'storage':{'input':'{"a":1}'}}
        self.assertNotIn('error',execute(source,'qx',URL,fixture,'original'))
        fixture['storage']['input']='(function(){$prefs.setValueForKey("executed","bad");return 1})()'
        result=execute(source,'qx',URL,fixture,'original')
        self.assertIn('JSON fixture model',result['fixture_error'])
        self.assertNotIn('bad',result['observation']['storage'])
        result=execute('Function("return 1")();$done({});','qx',URL,fixture,'original')
        self.assertIn('Code generation',result['error'])

    def test_receiver_specialization_rejects_shadowing_mutation_and_escapes(self):
        base='const sdk=new Env();send(sdk);function send(receiver){receiver.post("url")}function Env(){return new class{post(){}}}'
        output=transform('transforms/specialization','lowerClosedReceiverArguments',[base])[0]
        self.assertIn('sdk.post',output)
        invalid=[base.replace('receiver.post','let sdk;receiver.post'),
                 base.replace('send(sdk);','sdk=unknown;send(sdk);'),
                 base.replace('receiver.post("url")','unknown(receiver)'),
                 base.replace('send(sdk);','unknown(send);send(sdk);')]
        for original,output in zip(invalid,transform('transforms/specialization','lowerClosedReceiverArguments',invalid)):
            self.assertEqual(output,original)
        ordinary=base.replace('function Env(){return new class{post(){}}}','function Env(){return {post(){}}}')
        self.assertEqual(transform('transforms/specialization','lowerClosedReceiverArguments',[ordinary])[0],ordinary)

    def test_finite_dispatch_unions_branches_of_unknown_condition(self):
        source="""const sdk=new Env();const method=foreign()?'get':'post';
        sdk[method]('url');function Env(){return new class{get(){}post(){}}}"""
        output=transform('transforms/specialization','lowerFiniteMethodCalls',[source])[0]
        self.assertIn('sdk.get(',output)
        self.assertIn('sdk.post(',output)
        self.assertEqual(output.count('foreign()'),1)
        unknown=source.replace("'post'",'foreignMethod()')
        self.assertEqual(transform('transforms/specialization','lowerFiniteMethodCalls',[unknown])[0],unknown)

    def test_finite_dispatch_preserves_selector_and_arguments_once(self):
        source="""const sdk=new Env();let log=[];let method='post';
        sdk[(log.push('selector'),method)]((log.push('argument'),'url'));
        function Env(){return new class{post(value){log.push(value)}}}return log;"""
        # Unknown selectors, including side-effecting expressions, remain intact.
        self.assertEqual(transform('transforms/specialization','lowerFiniteMethodCalls',[source])[0],source)
        source=source.replace("(log.push('selector'),method)",'method')
        output=transform('transforms/specialization','lowerFiniteMethodCalls',[source])[0]
        self.assertIn('selectedMethod',output)
        code="console.log(JSON.stringify(JSON.parse(await new Promise(r=>{let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>r(s))})).map(s=>new Function(s)())));"
        result=subprocess.run(['node','--input-type=module','-e',code],input=json.dumps([source,output]),capture_output=True,text=True,check=True)
        self.assertEqual(json.loads(result.stdout),[['argument','url'],['argument','url']])

    def test_type_switch_proofs_do_not_ignore_fallthrough_or_early_closures(self):
        sources=[
            "function show(o){switch(typeof o){case 'undefined': record();case 'object':return o.url}}show();show({media:'x'});",
            "function outer(){const read=()=>send(options);read();const options={url:'x'}}function send(o){return o.method}outer();",
        ]
        outputs=transform('transforms/specialization','specializeParameters',sources)
        self.assertIn('o.url',outputs[0])
        self.assertIn('o.method',outputs[1])
        inherited="function check(o){return 'toString' in o}check({});"
        self.assertIn("'toString' in o",transform('transforms/specialization','specializeParameters',[inherited])[0])
        shared="function show(o){switch(typeof o){case 'string':let shared='bad';return;case 'object':return shared}}show({});"
        self.assertIn("let shared='bad'",transform('transforms/specialization','specializeParameters',[shared])[0])

    def test_default_record_destructuring_preserves_fields_and_defaults(self):
        source="""function options(value={}){const {url:alias}=value;return alias}
        $done({body:String(options())+'|'+String(options({media:'fixture'}))});"""
        output=convert_script(source,'Fixture',URL,'',source_format='surge')
        case={'name':'default record aliases','request':{'url':'https://example.test/'},
              'expected':{'result':{'body':'undefined|undefined'}}}
        self.assertEqual(compare(source,output,'surge',URL,case)['status'],'passed')
        mutation="function options(value={}){const {url:alias}=value;alias='changed';return alias}options();"
        self.assertIn("return alias",transform('transforms/specialization','specializeParameters',[mutation])[0])

    def test_unused_classes_pruned_without_discarding_class_initialization(self):
        sources=["class Unused{run(){require('unused')}}$done({});",
                 "class Effect{static {record()}}$done({});",
                 "class Effect{[record()](){}}$done({});",
                 "class Effect extends record(){}$done({});"]
        code="""import{pruneGeneratedFunctions}from'./tools/js-analysis/transforms/factories.mjs';let s='';for await(const x of process.stdin)s+=x;console.log(JSON.stringify(JSON.parse(s).map(x=>pruneGeneratedFunctions(x,new Set(),true))));"""
        result=subprocess.run(['node','--input-type=module','-e',code],input=json.dumps(sources),capture_output=True,text=True,check=True,cwd=ROOT)
        outputs=json.loads(result.stdout)
        self.assertNotIn('Unused',outputs[0])
        for output in outputs[1:]:self.assertIn('record()',output)

    def test_promise_executor_chain_keeps_completion(self):
        source="""let order=[];function request(){return new Promise((resolve,reject)=>{
          Promise.resolve('fixture').then(value=>resolve(value)).catch(reject);
          order.push('executor');
        })}(async()=>{let value=await request();$done({body:order.join(',')+'|'+value})})();"""
        output=convert_script(source,'Fixture',URL,'',source_format='loon')
        fixture={'name':'executor ordering','request':{'url':'https://example.test/'},'expected':{'result':{'body':'executor|fixture'}}}
        self.assertEqual(compare(source,output,'loon',URL,fixture)['status'],'passed')

    def test_schedule_fixture_has_no_intercepted_message(self):
        source="if(typeof $request==='undefined')$done({body:'scheduled'});else $done({body:'request'});"
        output=convert_script(source,'Fixture',URL,'',source_format='qx')
        fixture={'name':'scheduled entry','entry_type':'schedule','request':{'url':'https://example.test/'},
                 'expected':{'result':{'body':'scheduled'}}}
        self.assertEqual(compare(source,output,'qx',URL,fixture)['status'],'passed')

    @unittest.skipUnless(ORIGINAL.is_file(),'Requires original cached source')
    def test_cached_aliyun_dual_entry_refreshes_token_before_api_failure(self):
        source=ORIGINAL.read_text()
        output=convert_scripts([{'id':'dual','source':source,'author':'Sliverkiss','url':URL,'license_text':'',
                                 'source_format':'qx','entry_types':['http_request','schedule']}])['dual']
        fixture={'name':'scheduled token refresh and API failure','entry_type':'schedule','native_evaluation':True,
                 'request':{'url':'https://example.test/'},
                 'storage':{'aliyun_data':'[{"name":"Fixture","device_id":"fixture-device","refresh_token":"old-token"}]'},
                 'http':[{'url':'https://raw.githubusercontent.com/Sliverkiss/GoodNight/main/notice.json','body':'{}'},
                         {'url':'https://raw.githubusercontent.com/Sliverkiss/GoodNight/main/tip.json','body':'{}'},
                         {'url':'https://auth.aliyundrive.com/v2/account/token',
                          'body':'{"nick_name":"Fixture","device_id":"fixture-device","refresh_token":"new-token","access_token":"fixture-access"}'},
                         {'url':'https://member.aliyundrive.com/v2/activity/sign_in_list','body':'{"message":"fixture-api-error"}'}],
                 'expected':{'storage':{'aliyun_data':'[{"name":"Fixture","device_id":"fixture-device","refresh_token":"new-token"}]'}}}
        cases=[fixture]
        transport=copy.deepcopy(fixture);transport['name']='scheduled transport failure';transport['http'][-1]={'url':fixture['http'][-1]['url'],'error':'fixture-offline'};cases.append(transport)
        bark=copy.deepcopy(fixture);bark['name']='scheduled Bark delivery';bark['storage']['bark_key']='fixture-bark-key';bark['http'].append({'url':'https://api.day.app/push','status':200,'body':'{}'});cases.append(bark)
        for case in cases:
            with self.subTest(name=case['name']):
                result=compare(source,output,'qx',URL,case)
                self.assertEqual(result['status'],'passed',result)

    def test_sequence_callback_keeps_completion(self):
        source="""let count=0;(async()=>{let value=await new Promise(resolve=>{
          count++, $httpClient.post({url:'https://api.test/'},(e,r,b)=>resolve(b));
        });$done({body:count+'|'+value})})();"""
        output=convert_script(source,'Fixture',URL,'',source_format='loon')
        fixture={'name':'sequence request','request':{'url':'https://example.test/'},'http':[{'url':'https://api.test/','body':'fixture'}],
                 'expected':{'result':{'body':'1|fixture'}}}
        self.assertEqual(compare(source,output,'loon',URL,fixture)['status'],'passed')
