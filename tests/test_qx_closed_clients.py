"""QX 闭合客户端工厂选择、字段投影与完成边界。"""
import json
from pathlib import Path
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]
BASE = r'''var ae=class{constructor(e,t,n){this.name=e??"",this.isDebug=n?.debug??!1,e&&this.debug(`${e} Start`),this.className=t??"",this.init()}static getInstance(e,t){let n="Surge";return typeof $loon<"u"?n="Loon":typeof $task<"u"&&(n="QuanX"),ae.instances[n]||(ae.instances[n]=ae.classNames[n](e,n,t)),ae.instances[n]}exit(){$done({})}};
ae.instances={};ae.classNames={QuanX:(e,t,n)=>new QuanX(e,t,n),Surge:(e,t,n)=>new Surge(e,t,n),Loon:(e,t,n)=>new Loon(e,t,n)};
var Surge=class extends ae{};var Loon=class extends ae{};
var QuanX=class extends ae{msg(e=this.name,t="",n="",i){$notify(e,t,n,{"open-url":i??""})}async fetch(e){return await new Promise((t,n)=>{let{method:i,body:s,bodyBytes:a,...o}=e,f=a??s,l=f instanceof Uint8Array;$httpClient[i.toLowerCase()]({...o,body:f,"binary-mode":l},(u,p,g)=>{u&&n(u);let d=l?"bodyBytes":"body";t({status:p.status??p.statusCode,headers:p.headers,[d]:g})})})}done(e){let t=e.response??e,n={};for(let[i,s]of Object.entries(t))i==="status"?n.status=`HTTP/1.1 ${s}`:i==="bodyBytes"?n.bodyBytes=QuanX.transferBodyBytes(s,"ArrayBuffer"):n[i]=s;$done(n)}};
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

    def test_qx_fetch_and_spread_notification_remain_explicit_gaps(self):
        results = self.lower_many([
            {'source': BASE + CLIENT + "client.fetch({url:'https://example.test/',method:'GET'});",
             'format': 'qx'},
            {'source': BASE + CLIENT + "var args=['t','s','b'];client.msg(...args);",
             'format': 'qx'},
        ])
        self.assertTrue(all(result.get('error') for result in results))
        self.assertIn('QX fetch 的 statusCode/bodyBytes/opts 返回契约尚未展开',
                      results[0]['error'])
        self.assertIn('客户端方法参数无法保留求值语义', results[1]['error'])


if __name__ == '__main__':
    unittest.main()
