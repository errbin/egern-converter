import unittest
from pathlib import Path
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.convert import ConversionError
from tools.egern_hub.verify import compare

ROOT=Path(__file__).resolve().parents[1]


class PromiseHTTPTests(unittest.TestCase):
    def test_computed_callback_method_uses_native_http_and_evaluates_selector_once(self):
        source='''(async()=>{
          let order='';const method=$request.method.toLowerCase();
          function select(){order+='method:';return method}
          function address(){order+='url:';return 'https://api.test/'}
          const value=await new Promise(resolve=>{
            $httpClient[select()]({url:address()},(e,r,b)=>resolve(e||b));
          });$done({body:order+value});
        })();'''
        output=convert_script(source,'Author','https://example.test/a.js','')
        self.assertNotIn('$httpClient',output)
        for method in ['GET','POST','DELETE']:
            case={'name':'computed HTTP','request':{'url':'https://example.test/','method':method},
                  'http':[{'url':'https://api.test/','body':'ok'}],
                  'expected':{'result':{'body':'method:url:ok'},'events':{'requests':[{'method':method}]}}}
            result=compare(source,output,'surge','https://example.test/a.js',case)
            self.assertEqual(result['status'],'passed',result)

    def test_assigned_iife_and_closed_helpers_keep_promise_completion(self):
        for expression,setup in [
            ('(run = async () => {value="changed"})()', 'let run;'),
            ('(0, async () => {value="changed"})()', ''),
            ('start()', 'function start(){return Promise.resolve().then(()=>{value="changed"})}'),
            ('start()', 'const start=()=>Promise.resolve().then(()=>{value="changed"});'),
        ]:
            source='let value="old";'+setup+expression+'.catch(()=>{value="caught"}).finally(()=>$done({body:value}));'
            output=convert_script(source,'Author','https://example.test/a.js','')
            result=compare(source,output,'surge','https://example.test/a.js',{
                'name':'closed promise','request':{'url':'https://example.test/'},
                'expected':{'result':{'body':'changed'}}})
            self.assertEqual(result['status'],'passed',result)
        for expression in ['start()', 'condition ? Promise.resolve() : {}']:
            source='function start(){if(condition)return Promise.resolve();return {catch(){}}}('+expression+').catch(()=>{}).finally(()=>$done({}));'
            with self.assertRaisesRegex(ConversionError,'Promise'):
                convert_script(source,'Author','https://example.test/a.js','')

    def test_finally_return_does_not_replace_promise_value(self):
        source='(async()=>{const value=await Promise.resolve("kept").catch(()=>"recovered").finally(()=>{if($request.url.includes("finish"))$done({body:"early"});return "ignored"});$done({body:value})})();'
        output=convert_script(source,'Author','https://example.test/a.js','')
        for suffix,body in [('other','kept'),('finish','early')]:
            case={'name':'finally value','request':{'url':'https://example.test/'+suffix},'expected':{'result':{'body':body}}}
            result=compare(source,output,'surge','https://example.test/a.js',case)
            self.assertEqual(result['status'],'passed',result)
        with self.assertRaisesRegex(ConversionError,'Promise'):
            convert_script('unknown().catch(()=>{}).finally(()=>$done({}));','Author','https://example.test/a.js','')

    def test_forwarded_callback_and_finally_completion(self):
        source='function get(o,c){$httpClient.get(o,c)}async function run(){return await new Promise(resolve=>{get({url:"https://api.test/"},(e,r,b)=>resolve(b||"error"))})}run().then(x=>{value=x}).catch(()=>{}).finally(()=>$done({body:value}));var value="old";'
        output=convert_script(source,'Author','https://example.test/a.js','')
        case={'name':'forwarded callback with scalar setup','request':{'url':'https://example.test/'},'event_loop':True,
              'http':[{'url':'https://api.test/','body':'changed'}],'expected':{'result':{'body':'changed'}}}
        self.assertEqual(compare(source,output,'surge','https://example.test/a.js',case)['status'],'passed')
        source='let value="old";function get(o,c){$httpClient.get(o,c)}async function run(){value=await new Promise(resolve=>{get({url:"https://api.test/"},(e,r,b)=>resolve(b||"error"))})}run().catch(()=>{}).finally(()=>$done({body:value}));'
        output=convert_script(source,'Author','https://example.test/a.js','')
        for response,expected in [({'body':'changed'},'changed'),({'error':'synthetic'},'error')]:
            case={'name':'callback','request':{'url':'https://example.test/'},'response':{'body':'old'},'http':[{'url':'https://api.test/',**response}],'expected':{'result':{'body':expected}}}
            self.assertEqual(compare(source,output,'surge','https://example.test/a.js',case)['status'],'passed')

    def test_closed_request_parameter_is_bound_when_lowering_callback_http(self):
        source='''function send(request,callback){$httpClient.get(request,callback)}
        (async()=>{const body=await new Promise(resolve=>send({url:'https://api.test/',headers:{'X-Fixture':'yes'}},(e,r,b)=>resolve(e||b)));$done({body})})();'''
        output=convert_script(source,'Fixture','https://example.test/a.js','',source_format='loon')
        self.assertNotIn('$httpClient',output)
        case={'name':'closed request parameter callback','event_loop':True,
              'request':{'url':'https://example.test/'},
              'http':[{'url':'https://api.test/','headers':{'x-fixture':'yes'},'body':'ok'}],
              'expected':{'result':{'body':'ok'},
                          'events':{'requests':[{'method':'GET','url':'https://api.test/',
                                                 'headers':{'x-fixture':'yes'}}]}}}
        result=compare(source,output,'loon','https://example.test/a.js',case)
        self.assertEqual(result['status'],'passed',result)

    def test_request_argument_failure_rejects_the_original_executor(self):
        source='let value="old";function options(){throw Error("synthetic argument error")}async function run(){value=await new Promise(resolve=>{$httpClient.get({url:"https://api.test/",headers:options()},(e,r,b)=>resolve("callback"))})}run().catch(()=>{value="caught"}).finally(()=>$done({body:value}));'
        output=convert_script(source,'Author','https://example.test/a.js','')
        case={'name':'argument failure','request':{'url':'https://example.test/'},'http':[],'expected':{'result':{'body':'caught'},'events':{'requests':[]}}}
        result=compare(source,output,'surge','https://example.test/a.js',case)
        self.assertEqual(result['status'],'passed',result)

    def test_empty_array_setup_after_root_completion_chain_is_initialized_before_resume(self):
        source='''
        (async()=>{await Promise.resolve();value=items.length})()
          .catch(()=>{value=-1})
          .finally(()=>$done({body:String(value)}));
        let items=[];
        let value='pending';
        '''
        output=convert_script(source,'Author','https://example.test/a.js','')
        case={'name':'root chain and empty-array setup','request':{'url':'https://example.test/'},
              'expected':{'result':{'body':'0'}}}
        result=compare(source,output,'surge','https://example.test/a.js',case)
        self.assertEqual(result['status'],'passed',result)

    def test_native_timer_keeps_delay_and_order(self):
        source='(async()=>{const t=Date.now();await new Promise(resolve=>setTimeout(resolve,25000));$done({body:String(Date.now()-t)})})();'
        output=convert_script(source,'Author','https://example.test/a.js','')
        self.assertRegex(output,r'setTimeout\(resolve,\s*25000\)')
        case={'name':'timer','request':{'url':'https://example.test/'},'timers':[25000],'expected':{'result':{'body':'25000'}}}
        self.assertEqual(compare(source,output,'surge','https://example.test/a.js',case)['status'],'passed')
        case['timers']=[10]
        self.assertEqual(compare(source,output,'surge','https://example.test/a.js',case)['status'],'inconclusive')
        with self.assertRaises(ConversionError):convert_script('setTimeout("dangerous()",10);$done({});','Author','https://example.test/a.js','')

    def test_timer_fixtures_do_not_guess_concurrency_or_ignore_unused_delays(self):
        source='(async()=>{await Promise.all([new Promise(r=>setTimeout(r,10)),new Promise(r=>setTimeout(r,20))]);$done({})})();'
        output=convert_script(source,'Author','https://example.test/a.js','')
        case={'name':'concurrent','request':{'url':'https://example.test/'},'timers':[10,20]}
        self.assertEqual(compare(source,output,'surge','https://example.test/a.js',case)['status'],'inconclusive')
        source='$done({});'
        output=convert_script(source,'Author','https://example.test/a.js','')
        self.assertEqual(compare(source,output,'surge','https://example.test/a.js',case)['status'],'inconclusive')

    def test_http_callback_inside_timer_keeps_executor_and_request_order(self):
        for callback in ['()=>request()', 'request']:
            for delay in ['', ',0', ',25']:
                source='''(async()=>{
                  const started=Date.now();let order='start';
                  const value=await new Promise(resolve=>{
                    function request(){order+=':timer';$httpClient.get({url:'https://api.test/'},(e,r,b)=>{order+=':http';resolve(e||b)})}
                    setTimeout(CALLBACK DELAY);order+=':scheduled';
                  });
                  $done({body:order+':'+value+':'+(Date.now()-started)});
                })();'''.replace('CALLBACK',callback).replace(' DELAY',delay)
                output=convert_script(source,'Author','https://example.test/a.js','')
                self.assertIn('ctx.http.get',output)
                self.assertNotIn('$httpClient',output)
                for response,value in [({'body':'ok'},'ok'),({'error':'synthetic'},'synthetic')]:
                    case={'name':'timer callback','event_loop':True,'request':{'url':'https://example.test/'},
                          'http':[{'url':'https://api.test/',**response}],
                          'expected':{'result':{'body':'start:scheduled:timer:http:'+value+':'+str(25 if delay==',25' else 0)}}}
                    result=compare(source,output,'surge','https://example.test/a.js',case)
                    self.assertEqual(result['status'],'passed',result)

    def test_detached_timed_http_does_not_delay_completion(self):
        for source in [
            'setTimeout(()=>{$httpClient.get("https://api.test/",(e,r,b)=>console.log(b))});$done({});',
            'function later(){$httpClient.get("https://api.test/",(e,r,b)=>console.log(b))}setTimeout(later);$done({});',
        ]:
            with self.subTest(source=source):
                output=convert_script(source,'Author','https://example.test/a.js','')
                case={'name':'detached timer','event_loop':True,'request':{'url':'https://example.test/'},
                      'expected':{'mode':'modify','events':{'requests':[]}}}
                result=compare(source,output,'surge','https://example.test/a.js',case)
                self.assertEqual(result['status'],'passed',result)

    def test_detached_authored_task_starts_request_before_immediate_completion(self):
        source='''function main(){run()}
          async function run(){const value=await new Promise(resolve=>{
            $httpClient.get('https://api.test/',(e,r,b)=>resolve(b))
          });$persistentStore.write(value,'late');}
          main();$done({body:'immediate'});'''
        output=convert_script(source,'Author','https://example.test/a.js','')
        case={'name':'detached HTTP','event_loop':True,'request':{'url':'https://example.test/'},
              'http':[{'url':'https://api.test/','body':'late response'}],
              'expected':{'result':{'body':'immediate'},'events':{'requests':[{'method':'GET'}],'storageWrites':[]}}}
        result=compare(source,output,'surge','https://example.test/a.js',case)
        self.assertEqual(result['status'],'passed',result)

    def test_detached_completion_preserves_the_first_synchronous_result(self):
        source='async function run(){await Promise.resolve();$done({body:"late"})}run();$done({body:"immediate"});'
        output=convert_script(source,'Author','https://example.test/a.js','')
        case={'name':'synchronous finish before detached continuation','request':{'url':'https://example.test/'},'event_loop':True,
              'expected':{'result':{'body':'immediate'}}}
        self.assertEqual(compare(source,output,'surge','https://example.test/a.js',case)['status'],'passed')

    def test_http_helpers_and_aliases_preserve_binding_boundaries(self):
        sources=[
            'function get(o,c){$httpClient.get(o,c)}get=other;get({},()=>{});$done({});',
            'function get(o,c){$httpClient.get(o,c)}consume(get);$done({});',
            'read();let [req]=[$request];function read(){$done({body:req.url})}',
            'let [req]=[$request];req=other;$done({body:req.url});',
        ]
        for source in sources:
            with self.subTest(source=source),self.assertRaises(ConversionError):
                convert_script(source,'Author','https://example.test/a.js','')

    def test_documented_network_fields_use_native_device(self):
        source='$done({body:JSON.stringify({carrier:$network["cellular-data"].carrier,radio:$network["cellular-data"].radio,ssid:$network.wifi.ssid,bssid:$network.wifi.bssid,ip:$network.v4.primaryAddress,gateway:$network.v4.primaryRouter,interface:$network.v4.primaryInterface,ip6:$network.v6.primaryAddress,interface6:$network.v6.primaryInterface,dns:$network.dns})});'
        output=convert_script(source,'Author','https://example.test/a.js','')
        self.assertNotIn('$network',output)
        self.assertIn('ctx.device',output)
        for cellular,wifi in [({'carrier':'synthetic','radio':'NR'},{'ssid':'Synthetic','bssid':'00:00:00:00:00:00'}),({'carrier':None,'radio':None},{'ssid':None,'bssid':None})]:
            case={'name':'device network','request':{'url':'https://example.test/'},'device':{'cellular':cellular,'wifi':wifi,'ipv4':{'address':'192.0.2.1','gateway':'192.0.2.254','interface':'en0'},'ipv6':{'address':'2001:db8::1','interface':'en0'},'dnsServers':['192.0.2.53']}}
            self.assertEqual(compare(source,output,'surge','https://example.test/a.js',case)['status'],'passed')
