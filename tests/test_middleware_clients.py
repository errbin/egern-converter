"""Source-derived SDK specialization, completion ownership and API boundaries."""
import json
from pathlib import Path
import re
import subprocess
import unittest

from tools.egern_hub.js_analysis import analyze_many
from tools.egern_hub.verify import compare

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT/'sources/kokoryh/Sparkle/master/dist'


@unittest.skipUnless((SNAPSHOT/'bilibili.json.js').is_file(), 'Requires the original-author source snapshot')
class MiddlewareClientTests(unittest.TestCase):
    def report(self, source, binary=False):
        return analyze_many([(source, 'loon', json.dumps({'binary':binary}))], mode='native')[0]


    def test_all_three_factories_and_finalizers_resolve_before_transport_checks(self):
        code = """
import {readFileSync} from 'node:fs';
import {simplify} from './tools/js-analysis/transforms/simplify.mjs';
import {lowerPipeline} from './tools/js-analysis/platform/clients.mjs';
import {parse} from './tools/js-analysis/vendor/acorn.mjs';
import {index,key} from './tools/js-analysis/core/ast.mjs';
const result=[];
for(const name of ['bilibili.json.js','bilibili.protobuf.response.js','bilibili.protobuf.request.js']){
 const value=lowerPipeline(simplify(readFileSync('sources/kokoryh/Sparkle/master/dist/'+name,'utf8')),'loon',{binary:name.includes('protobuf')});
 const ix=index(parse(value.source,{ecmaVersion:'latest',allowAwaitOutsideFunction:true,allowReturnOutsideFunction:true}));
 const method=name=>ix.nodes.find(n=>n.type==='MethodDefinition'&&key(n)===name);
 result.push({lowered:value.lowered,gaps:value.gaps,runAsync:method('run').value.async,
   finalReturns:method('run').value.body.body.at(-1).finalizer.body[0].type,
   endReturns:method('end').value.body.body.at(-1).type,
   entryReturns:ix.nodes[0].body.at(-1).type});
}
process.stdout.write(JSON.stringify(result));
"""
        result = subprocess.run(['node', '--input-type=module', '-e', code], cwd=ROOT, text=True, capture_output=True, check=True)
        rows = json.loads(result.stdout)
        self.assertEqual(len(rows), 3)
        for row in rows:
            self.assertTrue(row['lowered'])
            self.assertTrue(row['runAsync'])
            for field in ['finalReturns', 'endReturns', 'entryReturns']:
                self.assertEqual(row[field], 'ReturnStatement')
        self.assertEqual(rows[0]['gaps'], [])
        self.assertEqual(rows[1]['gaps'], [])
        self.assertEqual(rows[2]['gaps'], [])


    def test_unknown_http_options_are_rejected_during_conversion(self):
        source=(SNAPSHOT/'bilibili.protobuf.request.js').read_text()
        changed=source.replace('timeout:3','timeout:3,policy:"DIRECT"',1)
        self.assertNotEqual(source,changed)
        self.assertIn('HTTP 请求选项无法静态映射',self.report(changed,True)['errors'][0])

    def test_modified_contract_or_escaped_factory_is_rejected(self):
        source = (SNAPSHOT/'bilibili.json.js').read_text()
        changed = source.replace('end(){let e=this.state.type', 'end(){let e=this.state.mode', 1)
        self.assertNotEqual(source, changed)
        self.assertTrue(self.report(changed)['errors'])
        root = re.search(r'var (\w+)=class\{static createInstance', source)[1]
        report = self.report(source+'\n'+root+'.end=()=>0;')
        self.assertIn('引用被修改或逃逸', report['errors'][0])
