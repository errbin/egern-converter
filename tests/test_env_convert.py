"""Closed Env logging/completion specialization and its rejection boundary."""
import json
from pathlib import Path
import subprocess
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

ROOT=Path(__file__).resolve().parents[1]
SNAPSHOT=ROOT/'sources/fmz200/wool_scripts/main/Scripts'
URL='https://example.test/env.js'


@unittest.skipUnless((SNAPSHOT/'meiyou/meiyou_ads.js').is_file(),'Fetch the fmz200 snapshot for Env integration tests')
class EnvCompilerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source=(SNAPSHOT/'meiyou/meiyou_ads.js').read_text()
        code="""
import {parse} from './tools/js-analysis/vendor/acorn.mjs';
import {index} from './tools/js-analysis/core/ast.mjs';
let source='';for await(const chunk of process.stdin)source+=chunk;
const fn=index(parse(source,{ecmaVersion:'latest'})).nodes.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='Env');
process.stdout.write(source.slice(fn.start,fn.end));
"""
        cls.factory=subprocess.run(['node','--input-type=module','-e',code],input=source,text=True,capture_output=True,check=True,cwd=ROOT).stdout

    def test_reviewed_factory_is_erased_and_preserves_completion(self):
        for factory_name in ['Env','RenamedRuntime']:
            factory=self.factory.replace('function Env(',f'function {factory_name}(',1)
            source=f'const runtime = new {factory_name}("Fixture");runtime.done({{body:"ok"}});'+factory
            output=convert_script(source,'Original',URL,'',source_format='loon')
            self.assertNotRegex(output.split('export default',1)[1],r'\$done|function Env|new Env|require\(|setTimeout|\.getEnv\(')
            fixture={'name':'Env completion','request':{'url':'https://example.test/'},'response':{'body':''},'expected':{'result':{'body':'ok'}}}
            result=compare(source,output,'loon',URL,fixture)
            self.assertEqual(result['status'],'passed',result)

    @unittest.skipUnless((ROOT/'sources/zmqcherish/proxy-script/main/weibo_main.js').is_file(),'Fetch the original Weibo dependency')
    def test_older_env_combines_plain_storage_with_completion_without_keeping_runtime(self):
        source=(ROOT/'sources/zmqcherish/proxy-script/main/weibo_main.js').read_text()
        code="""
import {parse} from './tools/js-analysis/vendor/acorn.mjs';
import {index} from './tools/js-analysis/core/ast.mjs';
let source='';for await(const chunk of process.stdin)source+=chunk;
const fn=index(parse(source,{ecmaVersion:'latest'})).nodes.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='Env');
process.stdout.write(source.slice(fn.start,fn.end));
"""
        factory=subprocess.run(['node','--input-type=module','-e',code],input=source,text=True,capture_output=True,check=True,cwd=ROOT).stdout
        sample='const runtime=new Env("Fixture");const value=runtime.getdata("config");runtime.done({body:value||"empty"});'+factory
        for platform in ['surge','loon','qx']:
            converted=convert_script(sample,'Author',URL,'',source_format=platform)
            self.assertNotRegex(converted,r'new Env|function Env|require\(|\$persistentStore|\$done')
            fixture={'name':'Combined Env storage and completion','request':{'url':URL},'response':{'body':''},'storage':{'config':'stored'}}
            self.assertEqual(compare(sample,converted,platform,URL,fixture)['status'],'passed')
        changed=factory.replace('开始!', 'changed!',1)
        changed_source=sample.replace(factory,changed)
        changed_output=convert_script(changed_source,'Author',URL,'',source_format='surge')
        self.assertIn('changed!',changed_output)
        self.assertEqual(compare(changed_source,changed_output,'surge',URL,fixture)['status'],'passed')

    def test_modified_factory_escaping_state_and_early_use_are_rejected(self):
        entries=[
            'const runtime=new Env("Fixture",{name:"changed"});runtime.done({});',
            'const runtime=new Env("Fixture");unknown(runtime);runtime.done({});',
            'const runtime=new Env("Fixture");runtime.done=()=>0;runtime.done({});',
            'runtime.done({});const runtime=new Env("Fixture");',
            'const Object={assign(){throw Error("custom")}};const runtime=new Env("Fixture");runtime.done({});',
        ]
        for entry in entries:
            with self.subTest(entry=entry),self.assertRaises(ConversionError):
                convert_script(entry+self.factory,'Original',URL,'',source_format='loon')
        changed=self.factory.replace('开始!', 'changed!',1)
        self.assertNotEqual(changed,self.factory)
        source='const runtime=new Env("Fixture");runtime.done({});'+changed
        output=convert_script(source,'Original',URL,'',source_format='loon')
        self.assertIn('changed!',output)
        self.assertEqual(compare(source,output,'loon',URL,{'name':'changed logging','request':{'url':URL}})['status'],'passed')

    def test_unused_platform_methods_do_not_block_a_reviewed_env(self):
        variant=self.factory.replace('return new class{','return new class{unusedModel(){return typeof $loon!=="undefined"?$loon:$environment["device-model"]}',1)
        self.assertNotEqual(variant,self.factory)
        source='const runtime=new Env("Fixture");runtime.done({body:"ok"});'+variant
        for platform in ['surge','loon']:
            output=convert_script(source,'Original',URL,'',source_format=platform)
            self.assertNotRegex(output,r'\$loon|\$environment|unusedModel|new Env|require\(')
            fixture={'name':'unused framework method','request':{'url':'https://example.test/'},'expected':{'result':{'body':'ok'}}}
            result=compare(source,output,platform,URL,fixture)
            self.assertEqual(result['status'],'passed',result)

    def test_constructor_dependencies_and_accessors_still_require_review(self):
        variants=[
            self.factory.replace('return new class{','return new class{get name(){throw Error("changed")}',1),
            self.factory.replace('class s{constructor(t){this.env=t}', 'class s{constructor(t){this.env=t;unknown(t)}',1),
        ]
        for variant in variants:
            self.assertNotEqual(variant,self.factory)
            with self.subTest(),self.assertRaises(ConversionError):
                convert_script('const runtime=new Env("Fixture");runtime.done({});'+variant,'Original',URL,'',source_format='loon')

    def test_unrecognized_logging_stays_in_the_general_native_compiler(self):
        changed=self.factory.replace('console.log(t.map','console.error(t.map',1)
        source='const runtime=new Env("Fixture");runtime.done({});'+changed
        output=convert_script(source,'Original',URL,'',source_format='loon')
        self.assertIn('console.error(',output)
        self.assertEqual(compare(source,output,'loon',URL,{'name':'console error','request':{'url':URL}})['status'],'passed')
