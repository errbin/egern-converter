"""Native client specialization and structured completion, without platform shims."""
import json
from pathlib import Path
import re
import shutil
import subprocess
import unittest

from tools.egern_hub.script_convert import convert_scripts, convert_script
from tools.egern_hub.verify import compare, execute
from tools.egern_hub.convert import ConversionError

ROOT=Path(__file__).resolve().parents[1]
URL='https://example.test/flow.js'


@unittest.skipUnless(shutil.which('node'),'Native compiler needs Node')
class StructuredFlowTests(unittest.TestCase):
    def compile(self,source):
        result=subprocess.run(['node',str(ROOT/'tests/helpers/compile-flow.mjs')],input=source,text=True,capture_output=True,check=True)
        return json.loads(result.stdout)

    def test_mixed_returns_short_circuit_sequences_and_finally(self):
        sources=[
            'function finish(x){if(x)$done({body:"early"});return "ordinary"}const r=finish(true);$done({body:r});',
            'function finish(x){if(x)$done({body:"early"});return "ordinary"}const r=finish(false);$done({body:r});',
            'function stop(){$done({body:"early"})}let x=false;x&&(stop(),x=true);$done({body:String(x)});',
            'function stop(){$done({body:"early"})}let x=true;x&&(stop(),x=false);$done({body:String(x)});',
            'function stop(){$done({body:"early"})}try{stop()}finally{$done({body:"wrong"})}',
            'function finish(x){if(x)$done({body:"early"});return "ordinary"}const v=finish(false)==="ordinary"?finish(true):"wrong";$done({body:v});',
            'function stop(){$done({body:"early"})}const methods={run:stop};for(const key in methods){methods[key]()}$done({body:"wrong"});',
            'function a(){$done({body:"a"})}function b(){$done({body:"b"})}const methods={a,b};for(const key in methods){methods[key]()}',
            '(async()=>{function finish(x){if(x)$done({body:"early"});return x}Promise.resolve(true).then(x=>finish(x)).catch(()=>{}).finally(()=>$done({body:"fallback"}));})();',
            '(async()=>{function finish(x){if(x)$done({body:"early"});return x}Promise.resolve(false).then(x=>finish(x)).catch(()=>{}).finally(()=>$done({body:"fallback"}));})();',
            '(async()=>{Promise.reject("error").then(x=>$done({body:x})).catch(e=>$done({body:e})).finally(()=>$done({body:"wrong"}));})();',
            'async function stop(){await Promise.resolve();$done({body:"late"})}stop();$done({body:"raced"});',
        ]
        for source in sources:
            with self.subTest(source=source):
                output=self.compile(source)
                self.assertNotIn('error',output)
                fixture={'name':'structured-flow','request':{'url':'https://example.test/'}}
                self.assertEqual(compare(source,output['code'],'surge',URL,fixture)['status'],'passed')
                self.assertNotRegex(output['code'],r'\$done|new Proxy|Symbol\(')

    def test_unsafe_completion_dispatch_and_source_inspection_rejected(self):
        sources=[
            '[1].map(x=>$done({body:String(x)}));$done({});',
            'function stop(){$done({})}const methods={run:stop};methods.run=()=>0;methods.run();',
            'function stop(){$done({})}const methods={run:stop};Object.assign(methods,{run:()=>0});methods.run();',
            'function stop(){$done({})}const methods={run:stop};for(const key in methods){methods[key]=()=>0;methods[key]();}',
            'function stop(){$done({})}const methods={run:stop};const alias=methods;for(const key in alias){alias[key]();}',
            'function stop(){$done({})}let alias=stop;alias=()=>0;alias();',
            'function stop(){$done({})}stop=()=>0;stop();',
            'function stop(){$done({})}[1].map(stop);',
            'function self() {return self.toString()}$done({body:self()});',
            '$done({body:globalThis.process.env.SECRET});',
            'Promise.resolve().then(()=>$done({})).catch(()=>{}).finally(()=>{});$done({body:"raced"});',
        ]
        for source in sources:
            with self.subTest(source=source):self.assertIn('error',self.compile(source))

    def test_contracts_ignore_local_names_and_formatting_but_reject_changed_behavior(self):
        code="""
import {parse} from './tools/js-analysis/vendor/acorn.mjs';
import {methodContract} from './tools/js-analysis/platform/clients.mjs';
const fn=s=>parse('('+s+')',{ecmaVersion:'latest'}).body[0].expression;
const a=methodContract(fn('(value, key)=>{const data=JSON.stringify(value);return storage.set(key,data)}'));
const b=methodContract(fn('(other, name) => { /* whitespace */ const text = JSON.stringify(other); return storage.set(name, text); }'));
const c=methodContract(fn('(other,name)=>{const text=JSON.stringify(other);return storage.set(text,name)}'));
const d=methodContract(fn('(x)=>({x})'))!==methodContract(fn('(y)=>({y})'));
const e=methodContract(fn('(x)=>x.left'),new Set(['left','right']))!==methodContract(fn('(y)=>y.right'),new Set(['left','right']));
process.stdout.write(JSON.stringify([a===b,a!==c,d,e]));
"""
        result=subprocess.run(['node','--input-type=module','-e',code],cwd=ROOT,text=True,capture_output=True,check=True)
        self.assertEqual(json.loads(result.stdout),[True,True,True,True])


SNAPSHOT=ROOT/'sources/Maasea/sgmodule/master/Script'
