"""Contract specialization must erase only closed, unchanged platform factories."""
import json
from pathlib import Path
import subprocess
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

ROOT=Path(__file__).resolve().parents[1]
SNAPSHOT=ROOT/'sources/fmz200/wool_scripts/main/Scripts'


def factory(path,name):
    code="""
import {parse} from './tools/js-analysis/vendor/acorn.mjs';
import {index} from './tools/js-analysis/core/ast.mjs';
let s='';for await(const c of process.stdin)s+=c;
const n=index(parse(s,{ecmaVersion:'latest'})).nodes.find(n=>n.type==='FunctionDeclaration'&&n.id.name===process.argv[1]);
process.stdout.write(s.slice(n.start,n.end));
"""
    return subprocess.run(['node','--input-type=module','-e',code,name],input=path.read_text(),cwd=ROOT,text=True,capture_output=True,check=True).stdout


@unittest.skipUnless((SNAPSHOT/'rrtv_json.js').is_file() and (SNAPSHOT/'xiaohongshu/xiaohongshu.js').is_file(),'Fetch the fmz200 snapshot for factory integration tests')
class ClosedFactoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.magic=factory(SNAPSHOT/'rrtv_json.js','MagicJS')
        cls.env=factory(SNAPSHOT/'xiaohongshu/xiaohongshu.js','Env')

    def compile(self,s):
        return convert_script(s,'Original','https://example.test/original.js','',source_format='loon')

    def test_plain_key_storage_factory_uses_ctx_storage(self):
        for name in ['Env','RenamedEnv']:
            source=f'const runtime=new {name}("Fixture");runtime.setdata("saved","key");$done({{body:runtime.getdata("key")}});'+self.env.replace('function Env(',f'function {name}(',1)
            output=self.compile(source)
            self.assertIn('ctx.storage.set(',output)
            self.assertNotRegex(output,r'require\(|new Env|\.getdata\(|\.setdata\(')
            fixture={'name':'storage','request':{'url':'https://example.test/'},'response':{'body':'old'},'expected':{'result':{'body':'saved'},'storage':{'key':'saved'}}}
            self.assertEqual(compare(source,output,'loon','https://example.test/original.js',fixture)['status'],'passed')

    def test_storage_factory_rejects_unproven_state(self):
        entries=[
            'const r=new Env("Fixture");unknown(r);r.getdata("key");$done({});',
            'const r=new Env("Fixture");r.getdata=()=>0;$done({body:r.getdata("key")});',
            'read();const r=new Env("Fixture");function read(){r.getdata("key")}$done({});',
            'const Object={assign(){throw Error("custom")}};const r=new Env("Fixture");r.getdata("key");$done({});',
        ]
        for entry in entries:
            with self.subTest(entry=entry),self.assertRaises(ConversionError):self.compile(entry+self.env)

    def test_nested_storage_uses_proven_sdk_body_without_a_contract_shortcut(self):
        source='const r=new Env("Fixture");$done({body:r.getdata("@object.nested")});'+self.env
        output=self.compile(source)
        self.assertNotRegex(output,r'\$persistentStore|new Env|function Env')
        for storage in [{'object':'{"nested":"stored"}'},{'object':'invalid'},{}]:
            case={'name':'nested storage','request':{'url':'https://example.test/'},'storage':storage}
            self.assertEqual(compare(source,output,'loon','https://example.test/original.js',case)['status'],'passed')

    def test_magic_factory_maps_fields_and_done_without_runtime(self):
        for name in ['MagicJS','RenamedMagic']:
            source=f'const scriptName="Fixture";const r=new {name}(scriptName,"INFO");(()=>{{if(r.isResponse)r.done({{body:r.response.body+"!"}});r.done()}})();'+self.magic.replace('function MagicJS(',f'function {name}(',1)
            output=self.compile(source)
            self.assertNotRegex(output,r'new MagicJS|\.isResponse|\.isNode|require\(|\$done|\$response')
            fixture={'name':'magic','request':{'url':'https://example.test/'},'response':{'body':'test'},'expected':{'result':{'body':'test!'}}}
            self.assertEqual(compare(source,output,'loon','https://example.test/original.js',fixture)['status'],'passed')

    def test_magic_factory_rejects_early_use_escapes_and_external_effects(self):
        entries=[
            'const r=new MagicJS("Fixture","INFO");unknown(r);r.done();',
            'const r=new MagicJS("Fixture","DEBUG");r.done();',
            'const r=new MagicJS(name,"INFO");const name="Fixture";r.done();',
            'read();const r=new MagicJS("Fixture","INFO");function read(){r.done()}',
            'const r=new MagicJS("Fixture","INFO");r.done();console.log(_keyStr);',
        ]
        for entry in entries:
            with self.subTest(entry=entry),self.assertRaises(ConversionError):self.compile(entry+self.magic)
        changed=self.magic.replace('MagicJS",t="INFO"','MagicJS",t="DEBUG"',1)
        self.assertNotEqual(changed,self.magic)
        with self.assertRaises(ConversionError):self.compile('const r=new MagicJS("Fixture","INFO");r.done();'+changed)
