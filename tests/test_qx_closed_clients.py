"""QX 闭合客户端工厂选择、字段投影与完成边界。"""
import json
from pathlib import Path
import subprocess
import unittest

from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare


ROOT = Path(__file__).resolve().parents[1]
URL = 'https://example.test/qx-client.js'
QX_TASK_FETCH = r'''async fetch(e){return await new Promise(t=>{let n={url:"",method:"GET"};for(let[i,s]of Object.entries(e))i==="id"?n.sessionIndex=s:i==="bodyBytes"?n.bodyBytes=QuanX.transferBodyBytes(s,"ArrayBuffer"):n[i]=s;e.bodyBytes&&delete n.body,$task.fetch(n).then(i=>{let s={status:200,headers:{}};for(let[a,o]of Object.entries(i))a==="sessionIndex"?s.id=o:a==="bodyBytes"?s.bodyBytes=QuanX.transferBodyBytes(o,"Uint8Array"):a==="statusCode"?s.status=o:s[a]=o;t(s)})})}'''
CALLBACK_FETCH = r'''async fetch(e){return await new Promise((t,n)=>{let{method:i,body:s,bodyBytes:a,...o}=e,f=a??s,l=f instanceof Uint8Array;$httpClient[i.toLowerCase()]({...o,body:f,"binary-mode":l},(u,p,g)=>{u&&n(u);let d=l?"bodyBytes":"body";t({status:p.status??p.statusCode,headers:p.headers,[d]:g})})})}'''
BASE = r'''var ae=class{constructor(e,t,n){this.name=e??"",this.isDebug=n?.debug??!1,e&&this.debug(`${e} Start`),this.className=t??"",this.init()}static getInstance(e,t){let n="Surge";return typeof $loon<"u"?n="Loon":typeof $task<"u"&&(n="QuanX"),ae.instances[n]||(ae.instances[n]=ae.classNames[n](e,n,t)),ae.instances[n]}debug(e){this.isDebug&&(typeof e=="object"&&(e=JSON.stringify(e)),console.log(e))}createProxy(e){return new Proxy(e,{get:this.getFn,set:this.setFn})}getFn(e,t,n){return e[t]}setFn(e,t,n,i){return e[t]=n,!0}init(){try{this.request=this.createProxy($request),this.response=this.createProxy($response)}catch(e){this.debug(e.toString())}}exit(){$done({})}};
ae.instances={};ae.classNames={QuanX:(e,t,n)=>new QuanX(e,t,n),Surge:(e,t,n)=>new Surge(e,t,n),Loon:(e,t,n)=>new Loon(e,t,n)};
var Surge=class extends ae{};var Loon=class extends ae{};
var QuanX=class extends ae{static transferBodyBytes(e,t){return e instanceof ArrayBuffer?t==="Uint8Array"?new Uint8Array(e):e:e instanceof Uint8Array&&t==="ArrayBuffer"?e.buffer.slice(e.byteOffset,e.byteLength+e.byteOffset):e}msg(e=this.name,t="",n="",i){$notify(e,t,n,{"open-url":i??""})}''' + QX_TASK_FETCH + r'''done(e){let t=e.response??e,n={};for(let[i,s]of Object.entries(t))i==="status"?n.status=`HTTP/1.1 ${s}`:i==="bodyBytes"?n.bodyBytes=QuanX.transferBodyBytes(s,"ArrayBuffer"):n[i]=s;$done(n)}};
QuanX.clientAdapter={id:"sessionIndex",status:"statusCode"};'''
CLIENT = 'var client=ae.getInstance("Fixture",{});'


class ClosedQXClientTests(unittest.TestCase):
    def lower_many(self, cases):
        code = r'''import fs from 'node:fs';
import {lowerClients} from './tools/js-analysis/platform/clients.mjs';
const cases=JSON.parse(fs.readFileSync(0,'utf8'));
const result=cases.map(({source,format})=>{try{const value=lowerClients(source,format);return {source:value.source,lowered:value.lowered};}catch(error){return {error:error.message};}});
process.stdout.write(JSON.stringify(result));'''
        run = subprocess.run(['node', '--input-type=module', '-e', code],
                             input=json.dumps(cases), cwd=ROOT, text=True,
                             capture_output=True, check=True)
        return json.loads(run.stdout)

    def test_qx_factory_adapter_bodybytes_done_and_notification(self):
        source = BASE + CLIENT + ("var upload=client.request.bodyBytes;"
                                  "var value=client.response.bodyBytes;"
                                  "var status=client.response.status;"
                                  "client.msg('Title','Sub','Body');"
                                  "client.done({bodyBytes:value});")
        result = self.lower_many([{'source': source, 'format': 'qx'}])[0]
        self.assertTrue(result['lowered'])
        output = result['source']
        self.assertIn('new Uint8Array($request.bodyBytes)', output)
        self.assertIn('new Uint8Array($response.bodyBytes)', output)
        self.assertIn('$response.statusCode', output)
        self.assertIn("$notify('Title', 'Sub', 'Body', {url: \"\" ?? ''})", output)
        self.assertIn('$done({bodyBytes:value})', output)
        self.assertNotIn('ae.instances', output)

    def test_qx_empty_done_preserves_empty_completion(self):
        result = self.lower_many([{'source': BASE + CLIENT + 'client.done({});',
                                   'format': 'qx'}])[0]
        self.assertTrue(result['lowered'])
        self.assertIn('$done({})', result['source'])

    def test_qx_missing_or_unknown_factory_is_rejected(self):
        missing = BASE.replace('QuanX:(e,t,n)=>new QuanX(e,t,n),', '')
        unknown = BASE.replace('QuanX:(e,t,n)=>new QuanX(e,t,n),',
                               'Other:(e,t,n)=>new QuanX(e,t,n),')
        results = self.lower_many([
            {'source': missing + CLIENT + 'client.exit();', 'format': 'qx'},
            {'source': unknown + CLIENT + 'client.exit();', 'format': 'qx'},
            {'source': BASE + CLIENT + 'client.exit();', 'format': 'stash'},
        ])
        self.assertTrue(all(result.get('error') for result in results))
        self.assertIn('无法静态确定 qx 客户端工厂', results[0]['error'])
        self.assertIn('客户端工厂含未知行为', results[1]['error'])
        self.assertIn('Surge、Loon 或 QX', results[2]['error'])

    def test_qx_adapter_missing_conflicting_or_dynamic_field_is_rejected(self):
        missing = BASE.replace('QuanX.clientAdapter={id:"sessionIndex",status:"statusCode"};', '')
        conflicting = BASE.replace('status:"statusCode"', 'status:"body"')
        results = self.lower_many([
            {'source': missing + CLIENT + 'client.exit();', 'format': 'qx'},
            {'source': conflicting + CLIENT + 'client.exit();', 'format': 'qx'},
            {'source': BASE + CLIENT + 'var field="url";client.response[field];', 'format': 'qx'},
        ])
        self.assertTrue(all(result.get('error') for result in results))
        self.assertIn('缺少已确认的请求／响应字段适配器', results[0]['error'])
        self.assertIn('客户端字段映射超出已确认的平台字段', results[1]['error'])
        self.assertIn('请求或响应必须使用可确定的字段', results[2]['error'])

    def test_qx_done_rejects_status_response_dynamic_and_spread_fields(self):
        values = ["client.done({status:200,bodyBytes:value});",
                  "client.done({response:{bodyBytes:value}});",
                  "client.done({['bodyBytes']:value});",
                  "client.done({...value});"]
        results = self.lower_many([
            {'source': BASE + CLIENT + 'var value=new Uint8Array(1);' + value,
             'format': 'qx'} for value in values
        ])
        self.assertTrue(all(result.get('error') for result in results))
        for result in results:
            self.assertIn('QX done 仅支持互不重复的静态 body/bodyBytes/headers 完成字段',
                          result['error'])

    def convert(self, source):
        return convert_script(source, 'Fixture', URL, '', source_format='qx')

    def test_qx_task_fetch_maps_status_bytes_and_closed_options(self):
        source = BASE + CLIENT + r'''(async()=>{
const r=await client.fetch({url:'https://api.test/a',method:'GET',opts:{redirection:false,'auto-cookie':true,'skip-cert-verify':true,policy:'direct'}});
$done({body:r.status+':'+r.body+':'+new Uint8Array(r.bodyBytes).length});
})();'''
        lowered = self.lower_many([{'source': source, 'format': 'qx'}])[0]
        self.assertTrue(lowered.get('lowered'), lowered)
        self.assertIn('$task.fetch(', lowered['source'])
        output = self.convert(source)
        self.assertNotIn('$task', output)
        fixture = {'name': 'qx client task fetch', 'request': {'url': URL},
                   'http': [{'url': 'https://api.test/a', 'status': 202,
                             'headers': {'X-Test': 'yes'}, 'body': 'ok'}],
                   'expected': {'result': {'body': '202:ok:2'}}}
        result = compare(source, output, 'qx', URL, fixture)
        self.assertEqual(result['status'], 'passed', result)

    def test_qx_task_fetch_statuscode_uses_native_response_status(self):
        source = r'''(async()=>{
const r=await $task.fetch({url:'https://api.test/status',opts:{redirection:true}});
$done({body:r.statusCode+':'+r.body+':'+new Uint8Array(r.bodyBytes).length});
})();'''
        output = self.convert(source)
        fixture = {'name': 'qx task fetch statuscode', 'request': {'url': URL},
                   'http': [{'url': 'https://api.test/status', 'status': 204, 'body': 'ok'}],
                   'expected': {'result': {'body': '204:ok:2'}}}
        result = compare(source, output, 'qx', URL, fixture)
        self.assertEqual(result['status'], 'passed', result)

    def test_qx_task_fetch_bodybytes_precedence_and_response_coexistence(self):
        source = BASE + CLIENT + r'''(async()=>{
const r=await client.fetch({url:'https://api.test/upload',method:'POST',body:'covered',bodyBytes:new Uint8Array([65,66])});
$done({body:r.status+':'+r.body+':'+new Uint8Array(r.bodyBytes).length});
})();'''
        output = self.convert(source)
        fixture = {'name': 'qx client bytes precedence', 'request': {'url': URL},
                   'http': [{'url': 'https://api.test/upload', 'status': 201, 'body': 'ok'}],
                   'expected': {'result': {'body': '201:ok:2'}}}
        result = compare(source, output, 'qx', URL, fixture)
        self.assertEqual(result['status'], 'passed', result)

    def test_qx_task_fetch_rejects_unmapped_or_open_request_fields(self):
        cases = [
            ("client.fetch({url:'https://example.test/',opts:{hints:false}});",
             'opts 缺少 hints 的原生映射判据'),
            ("client.fetch({url:'https://example.test/',opts:{filter:'return body'}});",
             'opts 缺少 filter 的原生映射判据'),
            ("var opts={redirection:false};client.fetch({url:'https://example.test/',opts:{...opts}});",
             'opts 字段必须唯一且可枚举'),
            ("client.fetch({url:'https://example.test/',opts:{redirection:'false'}});",
             'opts.redirection 必须是静态布尔值'),
            ("client.fetch({url:'https://example.test/',id:42});",
             'fetch 缺少 id 的原生映射判据'),
            ("client.fetch({url:'https://example.test/',bodyBytes:new Uint8Array(1),body:sideEffect()});",
             '被 bodyBytes 覆盖的正文必须是无副作用字面量'),
        ]
        results = self.lower_many([
            {'source': BASE + CLIENT + value, 'format': 'qx'} for value, _ in cases
        ])
        for result, (_, expected) in zip(results, cases):
            self.assertTrue(result.get('error'), result)
            self.assertIn(expected, result['error'])

    def test_qx_callback_fetch_and_spread_notification_remain_explicit_gaps(self):
        results = self.lower_many([
            {'source': BASE.replace(QX_TASK_FETCH, CALLBACK_FETCH) + CLIENT +
                      "client.fetch({url:'https://example.test/',method:'GET'});",
             'format': 'qx'},
            {'source': BASE + CLIENT + "var args=['t','s','b'];client.msg(...args);",
             'format': 'qx'},
        ])
        self.assertTrue(all(result.get('error') for result in results))
        self.assertIn('QX 客户端 fetch 缺少基于 $task.fetch 的已确认 statusCode/bodyBytes/opts 契约',
                      results[0]['error'])
        self.assertIn('客户端方法参数无法保留求值语义', results[1]['error'])


if __name__ == '__main__':
    unittest.main()
