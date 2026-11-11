import json
from pathlib import Path
import shutil
import subprocess
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from support import source_text

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(shutil.which('node'), 'Node is used only for runtime verification')
class ScriptTests(unittest.TestCase):
    def execute(self, source, body='', url='https://example.com/', method='GET', status=200, headers=None, binary=False, request=False, ast=False, env=None, http=None, storage=None, source_format="surge"):
        script = convert_script(source, 'Original Author', 'https://example.com/source.js', 'MIT License', binary, source_format=source_format, ast=ast)
        data = json.dumps({'script': script, 'body': body, 'url': url, 'method': method, 'status': status, 'headers': headers or {}, 'request': request, 'env': env or {}, 'http': http or [], 'storage': storage or {}})
        harness = '''
import {readFileSync} from 'node:fs';
import {FixtureHeaders as Headers} from './tools/js-analysis/verification/fixtures.mjs';
const d = JSON.parse(readFileSync(0, 'utf8'));
const {default: run} = await import('data:text/javascript;base64,'+Buffer.from(d.script).toString('base64'));
const notifications=[], requests=[], consumed=[], logs=[];
console.log=(...args)=>logs.push(args);
const store = new Map(Object.entries(d.storage));
const storage={get:key=>store.get(key)??null,set:(key,value)=>{store.set(key,value);},delete:key=>{store.delete(key);}};
const http=Object.fromEntries(['get','post','put','delete','head','options','patch'].map(method=>[method,async(url,options)=>{
 requests.push({method,url,options});
 const fixture=d.http[requests.length-1];
 if(!fixture) throw Error('Unexpected HTTP request');
 await Promise.resolve();
 if(fixture.error) throw Error(fixture.error);
 let reads=0;
 const body=fixture.bytes?Uint8Array.from(fixture.bytes):new TextEncoder().encode(fixture.body??'');
 const read=()=>{reads++;if(reads>1)throw Error('Stream consumed twice');consumed.push(url);return body;};
 const headers=fixture.nativeHeaders?{...fixture.headers}:new Headers(fixture.headers??{});
 if(fixture.nativeHeaders)Object.defineProperty(headers,'getAll',{value:key=>{const value=headers[key];return value===undefined?[]:Array.isArray(value)?value:[value];}});
 return {status:fixture.status??200,headers,text:async()=>new TextDecoder().decode(read()),arrayBuffer:async()=>read().buffer};
}]));
const message = {url:d.url, method:d.method, status:d.status, headers:new Headers(d.headers), body:d.body,
 text:async()=>d.body, arrayBuffer:async()=>new TextEncoder().encode(d.body).buffer};
const result = await run({request:d.request ? message : {...message,body:null}, response:d.request ? undefined : message, env:d.env, storage,http,script:{name:'Fixture'},cron:'0 8 * * *',device:{wifi:{ssid:'WiFi',bssid:'aa'},ipv4:{address:'10.0.0.2',gateway:'10.0.0.1',interface:'en0'},dnsServers:['1.1.1.1']},lookupIP:ip=>ip==='1.1.1.1'?{country:'AU',asn:13335,organization:'Cloudflare'}:null,abort:()=>({aborted:true}), notify:x=>notifications.push(x), respond:x=>({syntheticResponse:x})});
if(result?.body instanceof Uint8Array) result.body=Array.from(result.body);
process.stdout.write(JSON.stringify({result,notifications,requests,storage:Object.fromEntries(store),consumed,logs}));
'''
        result = subprocess.run(['node', '--input-type=module', '-e', harness], input=data, text=True, capture_output=True, check=True, timeout=10)
        # Original scripts may write console logs before the result.
        return json.loads(result.stdout.splitlines()[-1])

    def test_done_terminates_and_notifications_are_mapped(self):
        result = self.execute('$notification.post("title","sub","body"); $done({body:"ok"}); throw new Error("unreachable");')
        self.assertEqual(result['result']['body'], 'ok')
        self.assertEqual(result['notifications'][0], {'title': 'title', 'subtitle': 'sub', 'body': 'body'})

    def test_ast_catch_preserves_done_termination_and_real_error_handling(self):
        for clause in ['catch(e)', 'catch']:
            with self.subTest(clause=clause):
                code = 'try { $done({body:"first"}); } ' + clause + ' { $done({body:"swallowed"}); } $done({body:"last"});'
                self.assertEqual(self.execute(code, ast=True)['result']['body'], 'first')
                code = 'try { JSON.parse("bad"); } ' + clause + ' { $done({body:"recovered"}); }'
                self.assertEqual(self.execute(code, ast=True)['result']['body'], 'recovered')

    def test_ast_scope_comments_and_environment_probe(self):
        code = '/* $httpClient eval Promise */ const text="$prefs $unknown"; function f($local){return $local+1;} const code=typeof $task!=="undefined"?"HTTP/1.1 200 OK":200; $notify("T","S","B"); $done({status:code,body:String(f(4))});'
        result = self.execute(code, ast=True)
        self.assertEqual(result['result']['body'], '5')
        self.assertEqual(result['notifications'][0]['title'], 'T')

    def test_surge_nested_response_and_qx_status_line(self):
        for code in ['$done({response:{status:302,headers:{Location:"https://example.org"},body:""}});', '$done({status:"HTTP/1.1 302 Found",headers:{Location:"https://example.org"},body:""});']:
            self.assertEqual(self.execute(code, request=True, ast=True)['result']['syntheticResponse']['status'], 302)
        with self.assertRaisesRegex(ConversionError, '状态码'):
            self.execute('$done({status:"invalid status"});', ast=True)

    def test_speedtest_companion_script_real_branches(self):
        import hashlib
        key = hashlib.sha256(b'speedtest.js').hexdigest()[:16]
        source = source_text(f'ios151-file-{key}')
        result = json.loads(self.execute(source, '{"user":{}}', url='https://user-api.speedtest.net/v1/flows/users/login', ast=True)['result']['body'])
        self.assertTrue(result['user']['isVip'])
        self.assertEqual(len(result['subscriptions']), 2)
        xml = '<config vpn="true"><ad>ad</ad><video>ad</video></config>'
        result = self.execute(source, xml, url='https://www.speedtest.net/ios-config.php', ast=True)['result']['body']
        self.assertNotIn('<ad>', result)
        self.assertIn('vpn="false"', result)
        self.assertEqual(self.execute(source, 'bad json', url='https://user-api.speedtest.net/v1/flows/users/login', ast=True)['result']['body'], 'bad json')
        self.assertEqual(self.execute(source, '', ast=True)['result'], {})

    def test_optional_platform_probes_and_notification_action(self):
        code = 'if(typeof $loon!=="undefined")throw Error("wrong platform"); $notify("T","S","B",{"open-url":"https://example.com"}); $done({});'
        self.assertEqual(self.execute(code, ast=True)['notifications'][0]['action'], {'type':'openUrl','url':'https://example.com'})

    def test_telegram_real_script_respects_client_argument(self):
        import hashlib
        key = hashlib.sha256(b'TgRedirect.js').hexdigest()[:16]
        source = source_text(f'ios151-file-{key}')
        result = self.execute(source, url='https://t.me/example', request=True, ast=True, env={'argument':'client=Swiftgram'})['result']
        self.assertEqual(result['syntheticResponse']['status'], 302)
        self.assertEqual(result['syntheticResponse']['headers']['Location'], 'sg://resolve?domain=example')

    def test_surge_callback_http_waits_and_maps_options(self):
        source = '$httpClient.post({url:"https://api.example",body:{a:1},timeout:2.5,policy:"Proxy","policy-descriptor":"direct","auto-redirect":false,"auto-cookie":false,insecure:false}, (error,response,data)=>{if(error)throw Error(error);$done({body:response.status+":"+data}); throw Error("unreachable");});'
        result = self.execute(source, ast=True, http=[{'status':201,'body':'created'}])
        self.assertEqual(result['result']['body'], '201:created')
        options = result['requests'][0]['options']
        self.assertEqual(options, {'body':{'a':1},'timeout':2500,'policy':'Proxy','policyDescriptor':'direct','redirect':'manual','credentials':'omit','insecureTls':False})
        self.assertEqual(result['consumed'], ['https://api.example'])

    def test_callback_transport_error_and_script_exception_are_distinct(self):
        result = self.execute('$httpClient.get("https://api.example",(e,r,b)=>$done({body:e+":"+(r===null)}));', ast=True, http=[{'error':'offline'}])
        self.assertEqual(result['result']['body'], 'offline:true')
        with self.assertRaisesRegex(ConversionError, '非完成 HTTP 回调必须位于可追溯的 Promise 执行器'):
            self.execute('$httpClient.get("https://api.example",()=>{throw Error("callback failed")}); function unused(){$done({})}', ast=True, http=[{'body':'ok'}])

    def test_qx_promise_chain_success_error_and_native_completion(self):
        source = '$task.fetch({url:"https://api.example",method:"PATCH",opts:{redirection:false,"auto-cookie":false,"skip-cert-verify":false,policy:"direct"}}).then(r=>$done({body:r.statusCode+":"+r.body})).catch(e=>$done({body:"caught "+e.error}));'
        result = self.execute(source, ast=True, http=[{'status':202,'body':'accepted'}])
        self.assertEqual(result['result']['body'], '202:accepted')
        self.assertEqual(result['requests'][0]['method'], 'patch')
        self.assertEqual(result['requests'][0]['options'], {'redirect':'manual','credentials':'omit','insecureTls':False,'policy':'direct'})
        self.assertEqual(self.execute(source, ast=True, http=[{'error':'offline'}])['result']['body'], 'caught offline')

    def test_async_iife_await_nested_requests_and_storage(self):
        source = '(async()=>{const first=await $task.fetch({url:"https://first.example"});$prefs.setValueForKey(first.body,"token");const second=await $task.fetch({url:"https://second.example",headers:{Authorization:$prefs.valueForKey("token")}});$done({body:second.body})})();'
        result = self.execute(source, ast=True, http=[{'body':'token123'},{'body':'final'}])
        self.assertEqual(result['result']['body'], 'final')
        self.assertEqual(result['storage']['token'], 'token123')
        self.assertEqual(result['requests'][1]['options']['headers']['Authorization'], 'token123')

    def test_qx_prefs_object_exists_only_for_closed_capability_probes(self):
        source = '(async()=>{if(typeof $prefs!=="undefined"&&$prefs.valueForKey){$prefs.setValueForKey($prefs.valueForKey("token")||"none","seen")}$done({body:$prefs.valueForKey("seen")})})();'
        result = self.execute(source, source_format='qx', ast=True, storage={'token':'abc'})
        self.assertEqual(result['result']['body'], 'abc')
        self.assertEqual(result['storage']['seen'], 'abc')
        for source in ['const p=$prefs;$done({});',
                       'const f=$prefs.valueForKey;f("x");$done({});',
                       '$prefs.unknown;$done({});']:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                self.execute(source, source_format='qx', ast=True)

    def test_async_alias_is_native_and_unresolved_parallel_projection_is_rejected(self):
        source = 'const worker=async()=>{await $task.fetch({url:"https://api.example"});$done({body:"ok"})};const alias=worker;alias();'
        self.assertEqual(self.execute(source, ast=True, http=[{'body':'ok'}])['result']['body'],'ok')
        source = 'Promise.all([1,2].map(async n=>(await $task.fetch({url:"https://api.example/"+n})).body)).then(rows=>$done({body:rows.join(",")}));'
        with self.assertRaisesRegex(ConversionError, 'HTTP 响应必须'):
            self.execute(source, ast=True, http=[{'body':'a'},{'body':'b'}])

    def test_storage_delete_default_key_and_geoip_native_apis(self):
        source = '$persistentStore.write("shared","key");$prefs.removeValueForKey("gone");$persistentStore.write("own");const data={shared:$prefs.valueForKey("key"),own:$persistentStore.read(),country:$utils.geoip("1.1.1.1"),asn:$utils.ipasn("1.1.1.1"),name:$script.name,ssid:$network.wifi.ssid};$persistentStore.write(null,"key");$done({body:JSON.stringify(data)});'
        result=self.execute(source,ast=True,storage={'gone':'old'})
        self.assertEqual(json.loads(result['result']['body']),{'shared':'shared','own':'own','country':'AU','asn':13335,'name':'Fixture','ssid':'WiFi'})
        self.assertNotIn('gone',result['storage']);self.assertNotIn('key',result['storage'])
        self.assertEqual(result['storage']['egern-hub:https://example.com/source.js'],'own')

    def test_abort_and_no_done_errors(self):
        self.assertEqual(self.execute('$done({abort:true});', ast=True)['result'], {'aborted':True})
        with self.assertRaisesRegex(ConversionError, '独立异步任务'):
            self.execute('$task.fetch({url:"https://api.example"}).then(r=>r.body);function unused(){$done({})}',ast=True,http=[{'body':'ok'}])

    def test_http_unknown_options_do_not_silently_disappear(self):
        for options in ['timeout:10','opts:{hints:false}']:
            source = '$task.fetch({url:"https://api.example",'+options+'}).then(r=>$done({}));'
            with self.subTest(options=options), self.assertRaises(ConversionError):
                self.execute(source,ast=True)
        # Statically traceable local option objects receive the same build-time validation.
        for expression in ['{url:"https://api.example",timeout:10}', '{url:"https://api.example",opts:{redirection:"false"}}']:
            with self.subTest(expression=expression), self.assertRaises(ConversionError):
                self.execute('const input='+expression+';$task.fetch(input).then(r=>$done({}));',ast=True)

    def test_binary_view_boundaries_and_request_length_are_preserved(self):
        source = 'const raw=new Uint8Array([9,65,66,8]);const view=new DataView(raw.buffer,1,2);$httpClient.post({url:"https://api.example",headers:{"Content-Length":"4","X-Keep":"yes"},body:view},(e,r,b)=>$done({body:view}));'
        result=self.execute(source,ast=True,http=[{'body':'ok'}])
        self.assertEqual(result['result']['body'],[65,66])
        self.assertEqual(result['requests'][0]['options']['body'],{'0':65,'1':66})
        self.assertEqual(result['requests'][0]['options']['headers'],{'X-Keep':'yes'})
        for expression in ['raw.buffer.slice(1,3)', 'new DataView(raw.buffer,1,2)', 'raw.subarray(1,3)']:
            source='const raw=new Uint8Array([9,65,66,8]);$done({bodyBytes:'+expression+'});'
            self.assertEqual(self.execute(source,ast=True)['result']['body'],[65,66])

    def test_missing_synchronous_done_is_reported(self):
        with self.assertRaises(subprocess.CalledProcessError):
            self.execute('function unused(){$done({})}',ast=True)

    def test_detached_await_continuation_preserves_first_completion(self):
        source='(async()=>{await Promise.resolve(); console.log("late");})();$done({body:"first"});'
        self.assertEqual(self.execute(source,ast=True)['result'],{'body':'first'})

    def test_source_platform_start_time_units(self):
        source='$done({body:String($script.startTime)});'
        surge=float(self.execute(source,ast=True)['result']['body'])
        loon=float(self.execute(source,ast=True,source_format='loon')['result']['body'])
        self.assertAlmostEqual(surge,loon/1000,delta=10)
        result=self.execute('$persistentStore.write("own");$done({body:$persistentStore.read()});',ast=True,source_format='loon')
        self.assertEqual(result['storage']['egern-hub:loon:Fixture'],'own')

    def test_binary_http_and_qx_bytes(self):
        source = '$httpClient.get({url:"https://api.example","binary-mode":true},(e,r,b)=>$done({bodyBytes:b}));'
        self.assertEqual(self.execute(source,ast=True,http=[{'bytes':[0,255,128]}])['result']['body'],[0,255,128])
        source = '$task.fetch({url:"https://api.example"}).then(r=>$done({bodyBytes:r.bodyBytes}));'
        result=self.execute(source,ast=True,http=[{'bytes':[0,255,128]}])
        self.assertEqual(result['result']['body'],[0,255,128])
        self.assertEqual(len(result['consumed']),1)

    def test_finally_across_completion_is_rejected_and_normal_cleanup_is_preserved(self):
        source = 'try{$done({body:"first"})}finally{$persistentStore.write("wrong","late");$done({body:"last"})}'
        with self.assertRaisesRegex(ConversionError, 'finally'):
            self.execute(source,ast=True)
        source = 'try{JSON.parse("bad")}catch(e){}finally{$persistentStore.write("yes","cleanup")} $done({});'
        self.assertEqual(self.execute(source,ast=True)['storage']['cleanup'],'yes')
        source = '$task.fetch({url:"https://api.example"}).then(r=>$done({body:r.body})).finally(()=>$persistentStore.write("wrong","late"));'
        result=self.execute(source,ast=True,http=[{'body':'first'}])
        self.assertEqual(result['result'],{'body':'first'})
        self.assertNotIn('late',result['storage'])

    def test_promise_executor_completion_and_strict_directives(self):
        source = 'new Promise(resolve=>{$done({body:"first"})});$persistentStore.write("wrong","late");'
        with self.assertRaisesRegex(ConversionError, '执行器'):
            self.execute(source,ast=True)
        # Strict legacy assignments cannot be localized across a nested function.
        source = 'async function worker(){"use strict"; undeclaredProbe=1; $done({})} worker();'
        with self.assertRaisesRegex(ConversionError, '隐式全局'):
            self.execute(source,ast=True)

    def test_optional_chains_and_arrow_expression_shapes(self):
        source = 'const missing=null; const f=async()=>({value:1}); f().then(x=>{missing?.noop().next();$done({body:String(x.value)})});'
        self.assertEqual(self.execute(source,ast=True)['result']['body'],'1')
        source = '(async()=>{const arrow=()=>1; const arr=[arrow()].map(x=>x+1);$done({body:String(arr[0])})})();'
        self.assertEqual(self.execute(source,ast=True)['result']['body'],'2')

    def test_qx_body_bytes_are_arraybuffer_and_surge_binary_body_is_typed(self):
        source = '$done({bodyBytes:new Uint8Array($response.bodyBytes).reverse().buffer});'
        self.assertEqual(self.execute(source,body='abc',ast=True,source_format='qx')['result']['body'],[99,98,97])
        source = '$done({body:$response.body.reverse()});'
        self.assertEqual(self.execute(source,body='abc',ast=True,binary=True)['result']['body'],[99,98,97])

    def test_native_notification_clipboard_attachment_and_sound(self):
        source = '$notification.post("T","S","B",{action:"clipboard",text:"copy me","media-url":"https://img.example/a.png",sound:false});$done({});'
        result=self.execute(source,ast=True)['notifications'][0]
        self.assertEqual(result['action'],{'type':'clipboard','text':'copy me'})
        self.assertEqual(result['attachment'],{'url':'https://img.example/a.png'})
        self.assertFalse(result['sound'])
        source = '$notify("T","S","B",{"update-pasteboard":"text","media-base64":"AA==","media-base64-mime":"image/png"});$done({});'
        self.assertEqual(self.execute(source,ast=True)['notifications'][0]['attachment'],{'base64':'AA==','mimeType':'image/png'})

    def test_loon_timeout_uses_milliseconds_and_node_maps_to_policy(self):
        source = 'const method="get";const send=$httpClient[method]||$httpClient.get;send({url:"https://api.example",timeout:15000,node:"HK"},(e,r,b)=>$done({body:b}));'
        result=self.execute(source,ast=True,source_format='loon',http=[{'body':'ok'}])
        self.assertEqual(result['requests'][0]['options']['timeout'],15000)
        self.assertEqual(result['requests'][0]['options']['policy'],'HK')

    def test_real_ydm2_both_platform_paths_and_transport_failure(self):
        import hashlib
        key=hashlib.sha256(b'ydm2.js').hexdigest()[:16]
        source=source_text(f'ios151-file-{key}')
        for platform in ['surge','qx']:
            result=self.execute(source,ast=True,source_format=platform,request=True,url='https://d2x03a61ogs2x5.cloudfront.net/api/m3u8/decode/authPath?auth_key=old',http=[{'body':'"new-token"'}])
            self.assertIn('auth_key=new-token',result['result']['url'])
            self.assertEqual(len(result['requests']),1)
        result=self.execute(source,ast=True,request=True,url='https://d2x03a61ogs2x5.cloudfront.net/api/m3u8/decode/authPath?auth_key=old',http=[{'error':'offline'}])
        self.assertEqual(result['result'],{})
        self.assertEqual(self.execute(source,ast=True,request=True)['result'],{})

    def test_real_mh_async_subscription_logic_with_mocked_responses(self):
        import hashlib
        key=hashlib.sha256(b'mh.js').hexdigest()[:16]
        source=source_text(f'ios151-file-{key}')
        # Fixtures only: never register an account or call the source's remote services.
        result=self.execute(source,ast=True,url='https://www.zju.edu.cn',http=[{'body':'{"data":{"token":"fixture-token"}}'},{'body':'fixture-subscription'}])
        self.assertEqual(result['result']['body'],'fixture-subscription')
        self.assertEqual([x['method'] for x in result['requests']],['post','get'])
        self.assertIn('token=fixture-token',result['requests'][1]['url'])
        failure=self.execute(source,ast=True,url='https://www.zju.edu.cn',http=[{'error':'offline'}])
        self.assertEqual(json.loads(failure['result']['body'])['message'],'脚本执行失败')

    def test_real_huanyu_dynamic_routing_requires_explicit_native_lowering(self):
        import hashlib
        key=hashlib.sha256(b'huanyu/dist/loon.js').hexdigest()[:16]
        source=source_text(f'ios151-file-{key}')
        # Dynamic method routing and post-declaration option mutation need a
        # dedicated native lowering; never restore the old runtime as fallback.
        with self.assertRaises(ConversionError):
            self.execute(source,body='raw',request=True,binary=True,ast=True,source_format='loon')

    def test_native_header_shape_preserves_multiple_cookie_fields(self):
        source='$httpClient.get({url:"https://api.example","full-header-mode":true},(e,r,b)=>$done({body:JSON.stringify(r.headers)}));'
        result=self.execute(source,ast=True,http=[{'nativeHeaders':True,'headers':{'set-cookie':['a=1; Path=/','b=2; Path=/'],'X-Keep':'yes'},'body':''}])
        self.assertEqual(json.loads(result['result']['body']),[{'field':'set-cookie','value':'a=1; Path=/'},{'field':'set-cookie','value':'b=2; Path=/'},{'field':'X-Keep','value':'yes'}])

    def test_case_insensitive_headers_and_body_length(self):
        result = self.execute('const h=$response.headers; if(!h.hasOwnProperty("Location")) throw Error("missing"); h.Location="https://new.example"; $done({headers:h,body:"new"});', headers={'location': 'https://old.example', 'content-length': '200'})['result']
        self.assertEqual(result['headers']['location'], 'https://new.example')
        self.assertNotIn('content-length', result['headers'])

    def test_request_synthetic_response(self):
        result = self.execute('$done({status:302,headers:{Location:"https://example.org"},body:"redirect"});', request=True)['result']
        self.assertEqual(result['syntheticResponse']['status'], 302)

    def test_binary_response(self):
        result = self.execute('$done({bodyBytes:$response.bodyBytes.reverse()});', body='abc', binary=True)['result']
        self.assertEqual(result['body'], [99, 98, 97])

    def test_ios151_reviewed_response_scripts(self):
        fixtures = [
            ('appraven', {}, {'premium': False}, 'premium', True),
            ('ft-chinese', {}, {}, 'paywall', 0),
            ('bodyok', {'url': 'https://api.apphud.com/v1/subscriptions'}, {'data': {'subscriptions': []}}, 'data', None),
            ('notability', {}, {}, 'data', None),
            ('duet-display', {}, {}, 'success', True),
            ('emmo', {}, {'isVip': '0'}, 'isVip', '1'),
            ('bosum', {}, {'tryAndSee': 'N'}, 'tryAndSee', 'Y'),
            ('wankang', {}, {'data': {}}, 'data', None),
            ('audio-editor', {}, {'data': {}}, 'data', None),
            ('singerdream', {}, {'nested': {'isVip': False}}, 'nested', {'isVip': True}),
        ]
        for key, options, body, field, expected in fixtures:
            with self.subTest(script=key):
                source = source_text(f'adapted-ios151-{key}')
                result = json.loads(self.execute(source, json.dumps(body, separators=(',', ':')), **options)['result']['body'])
                self.assertIn(field, result)
                if expected is not None:
                    self.assertEqual(result[field], expected)
                if key == 'bodyok':
                    self.assertEqual(result['data']['subscriptions'][0]['product_id'], 'ok.annual.sub')
                if key == 'notability':
                    self.assertEqual(result['data']['processAppleReceipt']['subscription']['status'], 'active')
                if key == 'wankang':
                    self.assertEqual(result['data']['vip_type'], 3)
                if key == 'audio-editor':
                    self.assertTrue(result['data']['isSubscribe'])

    def test_original_vgtime(self):
        source = source_text('adapted-app2smile-vgtime')
        result = self.execute(source, '{"data":{"ad":{"id":1},"keep":true}}')['result']
        self.assertEqual(json.loads(result['body']), {'data': {'ad': None, 'keep': True}})

    def test_original_weread_and_passthrough(self):
        source = source_text('adapted-maasea-weread')
        result = self.execute(source, '{}', 'https://i.weread.qq.com/mobileSync')['result']
        self.assertEqual(json.loads(result['body'])['notifCount'], 0)
        self.assertEqual(self.execute(source, '{}')['result'], {})

    def test_original_news_qidian_adsense_redirect(self):
        fixtures = [
            ('qqnews', 'https://news.ssp.qq.com/app', 'POST', '{"adList":[1]}', 'adList', None),
            ('qidian', 'https://magev6.if.qidian.com/argus/api/v2/deeplink/geturl', 'GET', '{"Data":{"ActionUrl":"ad"}}', 'Data', {'ActionUrl': ''}),
            ('adsense', 'https://mi.gdt.qq.com/gdt_mview.fcg?', 'GET', '{"ret":0}', 'ret', 102006),
        ]
        for key, url, method, body, field, expected in fixtures:
            with self.subTest(key=key):
                source = source_text(f'adapted-app2smile-{key}')
                result = self.execute(source, body, url, method)['result']
                self.assertEqual(json.loads(result['body'])[field], expected)
        source = source_text('adapted-app2smile-baidu-no-redirect')
        result = self.execute(source, '', 'https://boxer.baidu.com/scheme?tokenData=%7B%22url%22%3A%22https%3A%2F%2Fexample.com%22%7D', status=302, headers={'location':'https://apps.apple.com/app'})['result']
        self.assertEqual(result['headers']['location'], 'https://example.com')


class ConversionTests(unittest.TestCase):
    def test_credits_and_license(self):
        output = convert_script('$done({});', 'Maasea', 'https://example.com/a.js', 'Copyright Original\nMIT License')
        for text in ['Original author: Maasea', 'Egern adaptation: ErrBin', 'Copyright Original', 'export default async function(ctx)']:
            self.assertIn(text, output)
        self.assertTrue(output.startswith('/*\nOriginal author: Maasea\n'))
        self.assertIn('\nCopyright Original\nMIT License\n\n用法\n', output)

    def test_repository_notes_are_not_embedded_in_converted_script_headers(self):
        from tools.egern_hub.script_convert import convert_scripts
        source='/* Original author notice stays here. */\n$done({});'
        for license_name in ['未声明许可证','待核验']:
            with self.subTest(license_name=license_name):
                output=convert_scripts([dict(id='demo',source=source,author='baby',url='https://example.com/demo.js',
                    license=license_name,license_text='Repository provenance notes\nEgern 适配：ErrBin — https://github.com/errbin/')])['demo']
                self.assertTrue(output.startswith('/*\nOriginal author: baby\nSource: https://example.com/demo.js\nEgern adaptation: ErrBin\nLicense: '+license_name+'\n\nOriginal author notice stays here.\n\n用法\n'))
                self.assertNotIn('Repository provenance notes',output)
                self.assertNotIn('Egern 适配：',output)
                self.assertEqual(output.count('Original author notice stays here.'),1)

    def test_comment_terminators_in_credit_fields_cannot_end_generated_header(self):
        output=convert_script('$done({});', 'Example */ author', 'https://example.com/*/demo.js', 'Copyright */ Original')
        self.assertEqual(output.count('*/'),1)
        self.assertIn('export default async function(ctx)',output)

    def test_default_conversion_uses_syntax_analysis(self):
        output = convert_script('try {$done({})} catch(e) {}', 'A', 'https://example.com', 'MIT')
        self.assertIn('try{return{};}', output)
        self.assertNotIn('__egernCompleted', output)

    def test_unimplemented_apis_fail(self):
        for source in ['$task.execute("x"); $done({});', 'setTimeout(()=>$done({}),10);', '$httpClient.unknown("x"); $done({});']:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                convert_script(source, 'A', 'https://example.com', 'MIT')

class AstConversionTests(unittest.TestCase):
    def test_real_dependencies_and_completion_hazards_still_fail(self):
        for source in ['$httpClient.unknown("x"); $done({});', '$task.execute({}); $done({});', 'const __egernCompleted=1; $done({});', 'function f(){return Function("return 1")()} $done({});', '$done({body:broken syntax});']:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                convert_script(source, 'A', 'https://example.com', 'MIT', ast=True)
