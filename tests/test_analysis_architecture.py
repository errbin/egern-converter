"""Keep converter extensions inside the fixed functional modules."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from tools.egern_hub import js_analysis


ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / 'tools/js-analysis'


class AnalysisArchitectureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.tool = Path(self.temp.name)
        self.layout = json.loads((TOOL / 'architecture.json').read_text())
        paths = list(self.layout['entrypoints'])
        for category, names in self.layout['categories'].items():
            paths.extend(f'{category}/{name}' for name in names)
        paths.extend(f'vendor/{name}' for name in self.layout['vendor'])
        for name in paths:
            path = self.tool / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.touch()
        self.write_layout()

    def write_layout(self):
        (self.tool / 'architecture.json').write_text(json.dumps(self.layout))

    def test_repository_inventory_and_import_graph(self):
        js_analysis.validate_analysis_layout()
        code = """
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {parse} from './tools/js-analysis/vendor/acorn.mjs';
const root=path.resolve('tools/js-analysis');
const layout=JSON.parse(fs.readFileSync(path.join(root,'architecture.json'),'utf8'));
const internal=Object.entries(layout.categories).flatMap(([category,names])=>names.map(name=>category+'/'+name));
const files=[...layout.entrypoints,...internal];
const allowed=new Set([...files,...layout.vendor.map(name=>'vendor/'+name)].map(name=>path.resolve(root,name)));
const edges=new Map();
for(const name of [...files,'../js-readability/index.mjs']){
 const file=path.resolve(root,name),dependencies=[];
 const tree=parse(fs.readFileSync(file,'utf8'),{ecmaVersion:'latest',sourceType:'module'});
 for(const node of tree.body.filter(n=>n.type==='ImportDeclaration')){
  const specifier=node.source.value;
  if(specifier.startsWith('node:'))continue;
  if(name.startsWith('../js-readability/')&&!specifier.startsWith('.'))continue;
  assert(specifier.startsWith('.'),'Only relative or Node imports: '+name);
  const target=path.resolve(path.dirname(file),specifier);
  assert(allowed.has(target),'Undeclared import: '+name+' -> '+specifier);
  assert(name==='verify.mjs'||name.startsWith('verification/')||!target.includes('/verification/'),
         'Fixture host imported by production compiler: '+name);
  dependencies.push(target);
 }
 edges.set(file,dependencies);
}
const visiting=new Set(),visited=new Set();
function visit(file){
 assert(!visiting.has(file),'Import cycle: '+file);
 if(visited.has(file))return;
 visiting.add(file);for(const next of edges.get(file)??[])visit(next);
 visiting.delete(file);visited.add(file);
}
for(const file of edges.keys())visit(file);
for(const name of internal)await import(pathToFileURL(path.resolve(root,name)));
console.log(JSON.stringify({internal:internal.length,total:files.length}));
"""
        result = subprocess.run(['node', '--input-type=module', '-e', code],
                                cwd=ROOT, text=True, capture_output=True, check=True, timeout=30)
        self.assertEqual(json.loads(result.stdout), {'internal': 20, 'total': 24})

    def test_new_patch_files_and_undeclared_vendor_code_are_rejected(self):
        for name in ['http/extra.mjs', 'patch.mjs', 'analysis/patch.js', 'vendor/patch.cjs']:
            with self.subTest(name=name):
                path = self.tool / name
                path.touch()
                with self.assertRaisesRegex(ValueError, '未登记文件'):
                    js_analysis.validate_analysis_layout(self.tool)
                path.unlink()

    def test_registering_a_new_file_cannot_raise_the_budget(self):
        self.layout['categories']['http'].append('extra.mjs')
        (self.tool / 'http/extra.mjs').touch()
        self.write_layout()
        with self.assertRaisesRegex(ValueError, '不得超过 24'):
            js_analysis.validate_analysis_layout(self.tool)

    def test_new_categories_and_nested_directories_are_rejected(self):
        self.layout['categories']['patches'] = ['extra.mjs']
        self.write_layout()
        with self.assertRaisesRegex(ValueError, '既定的 8 个功能分类'):
            js_analysis.validate_analysis_layout(self.tool)
        del self.layout['categories']['patches']
        self.write_layout()
        (self.tool / 'http/patches').mkdir()
        with self.assertRaisesRegex(ValueError, '未登记目录'):
            js_analysis.validate_analysis_layout(self.tool)

    def test_missing_modules_and_extra_entrypoints_are_rejected(self):
        (self.tool / 'http/requests.mjs').unlink()
        with self.assertRaisesRegex(ValueError, '缺失文件'):
            js_analysis.validate_analysis_layout(self.tool)
        self.layout['entrypoints'].append('patch.mjs')
        self.write_layout()
        with self.assertRaisesRegex(ValueError, '既定的 4 个命令入口'):
            js_analysis.validate_analysis_layout(self.tool)

    def test_malformed_inventory_is_a_clear_error(self):
        for text in ['{', '[]', '{}']:
            with self.subTest(text=text):
                (self.tool / 'architecture.json').write_text(text)
                with self.assertRaisesRegex(ValueError, '固定分类'):
                    js_analysis.validate_analysis_layout(self.tool)

    def test_structure_violation_stops_analysis_and_syntax_check_before_node(self):
        with patch.object(js_analysis, 'validate_analysis_layout', side_effect=ValueError('固定分类')):
            with patch.object(js_analysis.subprocess, 'run') as run:
                for action in [lambda: js_analysis._run_batch([{'source': '$done({});'}]),
                               lambda: js_analysis.validate_generated(['export default()=>({});'])]:
                    with self.assertRaisesRegex(ValueError, '固定分类'):
                        action()
                run.assert_not_called()
