"""Preserve upstream one-line execution layout without changing the program."""
import json
from pathlib import Path
import subprocess
import unittest

from tools.egern_hub.script_convert import convert_script,convert_scripts
from tools.egern_hub.verify import compare

URL='https://example.test/compact.js'

class CompactNativeTests(unittest.TestCase):
    def convert(self,source,**kwargs):return convert_script(source,'Author',URL,'',**kwargs)

    def test_one_line_body_with_multiline_notices(self):
        source='/* Author notice\n * Description */\n\nconst d=JSON.parse($response.body);d.ok=true;$done({body:JSON.stringify(d)});\n'
        output=self.convert(source)
        self.assertIn('Author notice',output)
        self.assertNotIn('Description',output)
        code=output[output.index('export default'):].strip()
        self.assertEqual(len(code.splitlines()),1)
        fixture={'name':'json','request':{'url':'https://example.test/'},'response':{'body':'{"ok":false}'},'expected':{'result':{'body':'{"ok":true}'}}}
        self.assertEqual(compare(source,output,'surge',URL,fixture)['status'],'passed')

    def test_multiline_and_native_sources_keep_their_layout(self):
        source='const d=JSON.parse($response.body);\nd.ok=true;\n$done({body:JSON.stringify(d)});'
        self.assertGreater(len(self.convert(source).split('export default',1)[1].splitlines()),3)
        native='// Native notice\nexport default async ctx=>({});\n'
        self.assertEqual(self.convert(native,source_format='egern'),native)

    def test_readability_pass_does_not_lose_original_layout_in_single_or_batch_conversion(self):
        source='const value="\\u4e2d\\u6587";$done({body:value});'
        if not (Path(__file__).resolve().parents[1]/'tools/js-readability/node_modules/astring').exists():self.skipTest('Install readability dependencies')
        single=self.convert(source,readable=True)
        batch=convert_scripts([{'id':'test','source':source,'url':URL,'author':'Author','license_text':'','readable':True}])['test']
        for output in [single,batch]:
            self.assertEqual(len(output.split('export default',1)[1].strip().splitlines()),1)
            self.assertIn('中文',output)

    def test_templates_regex_operators_and_inline_notices(self):
        cases=[
            'let a=1,b=2;const s=` a ${a} b `;$done({body:s+(a + ++b)});',
            'const s="a/b";/* Keep original credit */$done({body:s.replace(/a\\/b/g,"ok")});',
            'let a=1;let b=2;$done({body:String(a + ++b)+String(a - --b)});',
            'const data={"__proto__":null,value:1};$done({body:JSON.stringify(data)});',
        ]
        fixture={'name':'lexical-boundaries','request':{'url':'https://example.test/'}}
        for source in cases:
            with self.subTest(source=source):
                output=self.convert(source)
                self.assertEqual(len(output.split('export default',1)[1].strip().splitlines()),1)
                self.assertEqual(compare(source,output,'surge',URL,fixture)['status'],'passed')
                if 'Keep original credit' in source:self.assertIn('Keep original credit',output.split('export default',1)[0])

    def test_formatter_protects_asi_numeric_access_and_template_lines(self):
        code="""
import {compactNative,singleLineSource} from './tools/js-analysis/output/source.mjs';
const source='export default function(){function f(){return\\n{value:1}};return {body:String(f())+1 .toString()};}';
const compact=compactNative(source).code;
let rejected=false;try{compactNative('export default ()=>`a\\nb`;')}catch{rejected=true}
process.stdout.write(JSON.stringify({compact,rejected,one:singleLineSource('/*notice\\nsecond*/\\nconst s=`a ${1} b`;'),multi:singleLineSource('const s=`a\\nb`;')}));
"""
        result=subprocess.run(['node','--input-type=module','-e',code],text=True,capture_output=True,check=True)
        output=json.loads(result.stdout)
        self.assertTrue(output['rejected']);self.assertTrue(output['one']);self.assertFalse(output['multi'])
        self.assertIn('return;',output['compact']);self.assertIn('1 .toString()',output['compact'])
