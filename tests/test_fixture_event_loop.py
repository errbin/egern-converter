"""Independent query parsing and deterministic HTTP/deadline race fixtures."""
import json
from pathlib import Path
import subprocess
import unittest
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

ROOT=Path(__file__).resolve().parents[1]
URL='https://example.test/task.js'


class FixtureEventLoopTests(unittest.TestCase):
    def test_fixture_headers_only_expose_the_verified_runtime_contract(self):
        # 真机只保证大小写无关属性访问和可枚举键；entries/getAll/迭代会掩盖
        # 生成产物对不存在宿主方法的依赖，必须在差分 fixture 中直接失败。
        probe = r'''import {FixtureHeaders} from './tools/js-analysis/verification/fixtures.mjs';
import assert from 'node:assert/strict';
const headers = new FixtureHeaders({'Set-Cookie': ['a=1', 'b=2'], 'X-Test': 'yes'});
assert.equal(typeof headers.entries, 'undefined');
assert.equal(typeof headers.getAll, 'undefined');
assert.equal(typeof headers[Symbol.iterator], 'undefined');
assert.deepEqual(headers['set-cookie'], ['a=1', 'b=2']);
assert.deepEqual(Object.keys(headers), ['Set-Cookie', 'X-Test']);
assert.deepEqual(Object.fromEntries(Object.entries(headers)),
                 {'Set-Cookie': ['a=1', 'b=2'], 'X-Test': 'yes'});
console.log(JSON.stringify({ok: true}));
'''
        result = subprocess.run(['node', '--input-type=module', '-e', probe], cwd=ROOT,
                                text=True, capture_output=True, check=True)
        self.assertEqual(json.loads(result.stdout), {'ok': True})

    def test_callback_request_starts_synchronously_but_reply_remains_asynchronous(self):
        source="""$httpClient.get('https://example.test/api',(e,r,b)=>{
          $persistentStore.write(b,'late');$done({body:'callback'});
        });$done({body:'immediate'});"""
        output="""export default async function(ctx){
          void ctx.http.get('https://example.test/api',{
            timeout:5000,redirect:'follow',credentials:'include'
          }).then(async r=>{ctx.storage.set('late',await r.text())});
          return {body:'immediate'};
        }"""
        case={'name':'request start','event_loop':True,'request':{'url':URL},
              'http':[{'url':'https://example.test/api','body':'late'}],
              'expected':{'result':{'body':'immediate'},
                          'events':{'requests':[{'url':'https://example.test/api'}],'storageWrites':[]}}}
        result=compare(source,output,'surge',URL,case)
        self.assertEqual(result['status'],'passed',result)

    def test_query_model_matches_standard_valid_inputs_and_mutations(self):
        probe=r"""
import {FixtureSearchParams} from './tools/js-analysis/verification/fixtures.mjs';
import assert from 'node:assert/strict';
for(const input of ['?a=one+two&a=%E4%B8%AD%E6%96%87&empty&symbol=%2B%26%3D',
                    [['a','1'],['a','2']],{plain:'a b',symbol:'~!*()'}]){
 const expected=new URLSearchParams(input),actual=new FixtureSearchParams(input);
 for(const params of [expected,actual]){
  params.append('added','space +');params.set('a','replacement');params.append('a','second');
  params.delete('a','second');params.sort();
 }
 assert.equal(actual.toString(),expected.toString());
 assert.deepEqual([...actual],[...expected]);assert.equal(actual.get('a'),expected.get('a'));
 assert.deepEqual(actual.getAll('a'),expected.getAll('a'));assert.equal(actual.size,expected.size);
 assert.equal(actual.has('a','replacement'),expected.has('a','replacement'));
}
assert.throws(()=>new FixtureSearchParams('%E0%A4'),URIError);
console.log(JSON.stringify({ok:true}));
"""
        result=subprocess.run(['node','--input-type=module','-e',probe],cwd=ROOT,
                              text=True,capture_output=True,check=True)
        self.assertEqual(json.loads(result.stdout),{'ok':True})

    def test_mock_http_settles_before_pending_timeout(self):
        source="""(async()=>{
          const started=Date.now();
          const body=await Promise.race([
            $task.fetch({url:'https://example.test/api'}).then(r=>r.body),
            new Promise(resolve=>setTimeout(()=>resolve('deadline'),1000))
          ]);
          $done({body:body+':'+(Date.now()-started)});
        })();"""
        output=convert_script(source,'Fixture',URL,'',source_format='qx')
        case={'name':'HTTP before deadline','event_loop':True,'request':{'url':URL},
              'http':[{'url':'https://example.test/api','body':'response'}],
              'expected':{'result':{'body':'response:0'},'events':{'requests':[{'method':'GET'}]}}}
        result=compare(source,output,'qx',URL,case)
        self.assertEqual(result['status'],'passed',result)

    def test_concurrent_and_cancelled_timers_preserve_order_and_elapsed_time(self):
        source="""(async()=>{
          const log=[],start=Date.now();const cancelled=setTimeout(()=>log.push('cancelled'),1);
          clearTimeout(cancelled);
          await Promise.all([new Promise(resolve=>setTimeout(()=>{log.push('later');resolve()},20)),
                             new Promise(resolve=>setTimeout(()=>{log.push('first');resolve()},10))]);
          $done({body:log.join(',')+':'+(Date.now()-start)});
        })();"""
        # Test the fixture hosts with a direct native counterpart; clearTimeout
        # lowering is independent of the event-loop model exercised here.
        output=source.replace('$done({body:', 'return {body:').replace("(Date.now()-start)});", "(Date.now()-start)};")
        output='export default async function(ctx){return await '+output.removesuffix(';')+';}'
        case={'name':'timers','event_loop':True,'request':{'url':URL},
              'expected':{'result':{'body':'first,later:20'}}}
        result=compare(source,output,'qx',URL,case)
        self.assertEqual(result['status'],'passed',result)
