import contextlib
import io
import json
import os
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch
from tools.egern_hub import js_analysis


class BatchAnalysisTests(unittest.TestCase):
    def test_ast_patch_preserves_lexical_boundaries_without_repeated_prefix_scans(self):
        probe="""
import assert from 'node:assert/strict';
import {parse} from './tools/js-analysis/core/syntax.mjs';
import {index,patch} from './tools/js-analysis/core/ast.mjs';
const render=(source,from,to)=>{
 const tree=parse(source,{ecmaVersion:'latest'}),ix=index(tree);
 const target=ix.nodes.find(node=>node.start===source.indexOf(from)&&node.end===source.indexOf(from)+from.length);
 assert.ok(target,`missing replacement target ${from}`);
 const replacements=new WeakMap([[target,to]]);
 const emit=node=>replacements.has(node)?replacements.get(node):patch(source,node,emit);
 return emit(tree);
};
assert.equal(render('function f(){return!flag}','!flag','false'),'function f(){return false}');
assert.equal(render('function f(){return !flag.toString()}','flag','0'),'function f(){return !0 .toString()}');
console.log(JSON.stringify({ok:true}));
"""
        result=subprocess.run(['node','--input-type=module','-e',probe],text=True,capture_output=True,check=True,
                              cwd=Path(__file__).resolve().parents[1])
        self.assertEqual(json.loads(result.stdout),{'ok':True})

    def test_dominance_proof_handles_long_closed_function_chains(self):
        probe="""
import assert from 'node:assert/strict';
import {parse} from './tools/js-analysis/core/syntax.mjs';
import {index,initializedAfter} from './tools/js-analysis/core/ast.mjs';
const count=6000,rows=['const ready=1;'];
for(let i=0;i<count;i++)rows.push(`function f${i}(){${i+1<count?`f${i+1}()`:'return 1'}}`);
rows.push('f0();');
const tree=parse(rows.join('\\n'),{ecmaVersion:'latest'}),ix=index(tree);
const reference=ix.nodes.find(node=>node.type==='Identifier'&&node.name===`f${count-1}`&&ix.reference(node));
assert.ok(reference);
assert.equal(initializedAfter(ix,tree.body[0],reference),true);
console.log(JSON.stringify({ok:true}));
"""
        result=subprocess.run(['node','--input-type=module','-e',probe],text=True,capture_output=True,check=True,
                              cwd=Path(__file__).resolve().parents[1])
        self.assertEqual(json.loads(result.stdout),{'ok':True})

    def test_ast_index_handles_deeply_nested_syntax(self):
        probe="""
import assert from 'node:assert/strict';
import {index,renderTree} from './tools/js-analysis/core/ast.mjs';
let leaf={type:'ExpressionStatement',start:0,end:1,expression:{type:'Identifier',name:'value',start:0,end:1}};
for(let i=0;i<12000;i++)leaf={type:'BlockStatement',start:0,end:1,body:[leaf]};
const tree={type:'Program',start:0,end:1,body:[leaf]},ix=index(tree);
assert.equal(ix.nodes.length,12003);
assert.equal(ix.free(ix.nodes.at(-1)),true);
assert.equal(renderTree('0',tree),'0');
console.log(JSON.stringify({ok:true}));
"""
        result=subprocess.run(['node','--input-type=module','-e',probe],text=True,capture_output=True,check=True,
                              cwd=Path(__file__).resolve().parents[1])
        self.assertEqual(json.loads(result.stdout),{'ok':True})

    def test_constant_folding_handles_long_alias_chains(self):
        probe="""
import assert from 'node:assert/strict';
import {simplify} from './tools/js-analysis/transforms/simplify.mjs';
const count=5000,rows=['const v'+(count-1)+'=true;'];
for(let i=count-2;i>=0;i--)rows.push(`const v${i}=v${i+1};`);
rows.push('if(v0){hit()}else{miss()}');
const output=simplify(rows.join('\\n'));
assert.match(output,/hit\\(\\)/);
assert.doesNotMatch(output,/miss\\(\\)/);
console.log(JSON.stringify({ok:true}));
"""
        result=subprocess.run(['node','--input-type=module','-e',probe],text=True,capture_output=True,check=True,
                              cwd=Path(__file__).resolve().parents[1])
        self.assertEqual(json.loads(result.stdout),{'ok':True})

    def test_initializer_order_is_proved_inside_the_same_execution_block(self):
        probe="""
import assert from 'node:assert/strict';
import {parse} from './tools/js-analysis/core/syntax.mjs';
import {index,initializedAfter} from './tools/js-analysis/core/ast.mjs';
const inspect=source=>{
 const ix=index(parse(source,{ecmaVersion:'latest'}));
 const declaration=ix.nodes.find(n=>n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id?.name==='runtime'));
 const reference=ix.bindings.get(declaration.declarations[0].id).refs[0];
 return initializedAfter(ix,declaration,reference);
};
assert.equal(inspect('if (ready) { const runtime = create(); runtime.use(); }'),true);
assert.equal(inspect('if (ready) { const runtime = create(); register(() => runtime.use()); }'),true);
assert.equal(inspect('if (ready) { function use(){ runtime.use(); } use(); const runtime = create(); }'),false);
assert.equal(inspect('if (ready) { var runtime = create(); } else { runtime.use(); }'),false);
console.log(JSON.stringify({ok:true}));
"""
        result=subprocess.run(['node','--input-type=module','-e',probe],text=True,capture_output=True,check=True)
        self.assertEqual(json.loads(result.stdout),{'ok':True})

    def test_constructor_field_folding_requires_completed_unconditional_writes(self):
        probe="""
import assert from 'node:assert/strict';
import {foldTargetEnvironments} from './tools/js-analysis/platform/environment.mjs';
const fold=source=>foldTargetEnvironments(source,'surge');
const direct=fold('function Env(){return new class{constructor(){this.value="set"}isNode(){return false}getValue(){return this.value}}}const runtime=Env();runtime.getValue();');
assert.match(direct,/getValue\\(\\)\\{return "set"\\}/);
const conditional=fold('function Env(){return new class{constructor(){if(Math.random())this.value="set"}isNode(){return false}getValue(){return this.value}}}const runtime=Env();runtime.getValue();');
assert.match(conditional,/getValue\\(\\)\\{return this\\.value\\}/);
const early=fold('function Env(){return new class{constructor(){return;this.value="set"}isNode(){return false}getValue(){return this.value}}}const runtime=Env();runtime.getValue();');
assert.match(early,/getValue\\(\\)\\{return this\\.value\\}/);
const reachable=fold('function Env(){return new class{constructor(){this.getValue();this.value="set"}isNode(){return false}getValue(){return this.value}}}const runtime=Env();runtime.getValue();');
assert.match(reachable,/getValue\\(\\)\\{return this\\.value\\}/);
const separateReceiver=fold('function Env(){return new class{constructor(){this.value="env"}isNode(){return false}getValue(){return this.value}}}class Other{getValue(){return this.value}}const runtime=Env();runtime.getValue();new Other().getValue();');
assert.match(separateReceiver,/class Other\\{getValue\\(\\)\\{return this\\.value\\}\\}/);
console.log(JSON.stringify({ok:true}));
"""
        result=subprocess.run(['node','--input-type=module','-e',probe],text=True,capture_output=True,check=True,
                              cwd=Path(__file__).resolve().parents[1])
        self.assertEqual(json.loads(result.stdout),{'ok':True})

    def test_platform_switch_pruning_keeps_references_to_removed_case_bindings(self):
        probe="""
import assert from 'node:assert/strict';
import {platformFold} from './tools/js-analysis/platform/globals.mjs';
const fold=source=>platformFold(source,'qx').source;
const closed=fold('switch(typeof $task){case "object":var kept="yes";break;default:var removed="no";}');
assert.doesNotMatch(closed,/switch\\s*\\(/);
assert.match(closed,/kept/);
assert.doesNotMatch(closed,/removed/);
const escaped=fold('switch(typeof $task){case "object":var kept="yes";break;default:var removed="no";}use(removed);');
assert.match(escaped,/switch\\s*\\(/);
assert.match(escaped,/use\\(removed\\)/);
console.log(JSON.stringify({ok:true}));
"""
        result=subprocess.run(['node','--input-type=module','-e',probe],text=True,capture_output=True,check=True,
                              cwd=Path(__file__).resolve().parents[1])
        self.assertEqual(json.loads(result.stdout),{'ok':True})

    def test_class_method_http_sequence_keeps_callback_behavior(self):
        source='''const api = new class {
  post(options, callback = () => {}) {
    options.headers && delete options.headers["Content-Length"], $httpClient.post(options, (error, response, body) => callback(error, response, body));
  }
};
api.post({url:"https://api.example.test/", headers:{"Content-Length":"99"}, body:"payload"}, (error, response, body) => $done({body}));'''
        report=js_analysis.analyze_many([(source,'surge')],mode='native')[0]
        self.assertFalse(report['errors'],report['errors'])
        runner=str(Path(__file__).resolve().parents[1]/'tools/js-analysis/verify.mjs')
        fixture={'name':'class method HTTP sequence','request':{'url':'https://example.test/source.js'},
                 'http':[{'url':'https://api.example.test/','body':'reply'}]}
        observations=[]
        for side,code in [('original',source),('converted',report['code'])]:
            payload={'source':code,'platform':'surge','url':'https://example.test/source.js',
                     'fixture':fixture,'side':side}
            result=subprocess.run(['node','--experimental-vm-modules','--max-old-space-size=128',runner],
                                  input=json.dumps(payload),capture_output=True,text=True,timeout=5,check=True)
            observations.append(json.loads(result.stdout)['observation'])
        self.assertEqual(observations[0],observations[1])

    def test_library_restore_removes_split_export_placeholders(self):
        probe="""
import assert from 'node:assert/strict';
import {parse} from './tools/js-analysis/core/syntax.mjs';
import {methodContract} from './tools/js-analysis/platform/clients.mjs';
import {libraryContracts,protectLibraries} from './tools/js-analysis/analysis/libraries.mjs';
const source='const MESSAGE_TYPE = "protobuf-ts/unknown"; class Runtime { constructor(){} fromBinary(){} toBinary(){} internalBinaryRead(){} internalBinaryWrite(){} mergePartial(){} } $done({body:MESSAGE_TYPE});';
const tree=parse(source,{ecmaVersion:'latest'}),body=tree.body.slice(0,2);
const contract=methodContract({type:'Program',sourceType:'script',start:body[0].start,end:body.at(-1).end,body});
libraryContracts.set(contract,{name:'protobuf-ts fixture runtime',source:'https://example.test/library'});
const library=protectLibraries(source),marker=library.source.match(/var (publicLibraryBlock\\d+), MESSAGE_TYPE, Runtime;/);
assert.ok(marker);
const formatted=library.source.replace(marker[0],`var ${marker[1]};\\nvar MESSAGE_TYPE;\\nvar Runtime;`);
const restored=library.restore(formatted);
parse(restored,{ecmaVersion:'latest',sourceType:'module'});
assert.equal((restored.match(/(?:const|let|var)\\s+MESSAGE_TYPE\\b/g)||[]).length,1);
assert.equal((restored.match(/class Runtime\\b/g)||[]).length,1);
console.log(JSON.stringify({ok:true}));
"""
        result=subprocess.run(['node','--input-type=module','-e',probe],text=True,capture_output=True,check=True,
                              cwd=Path(__file__).resolve().parents[1])
        self.assertEqual(json.loads(result.stdout),{'ok':True})

    def test_native_progress_preserves_reports_and_reports_failed_script_reason(self):
        jobs=[('$done({body:"ok"});','surge'),('$custom();$done({});','surge')]
        progress=[{'kind':'script','stage':'converting','id':name,'index':index,'total':2}
                  for index,name in enumerate(['good.js','bad.js'],1)]
        output=io.StringIO()
        with patch.dict(os.environ,{'EGERN_PROGRESS_EVENTS':'1'}),contextlib.redirect_stdout(output):
            reports=js_analysis.analyze_many(jobs,mode='native',progress_items=progress)
        events=[json.loads(line[len(js_analysis.PROGRESS_PREFIX):])
                for line in output.getvalue().splitlines() if line.startswith(js_analysis.PROGRESS_PREFIX)]
        self.assertFalse(reports[0]['errors'])
        self.assertTrue(reports[1]['errors'])
        self.assertEqual([event['stage'] for event in events],
                         ['converting','converted','converting','conversion_failed'])
        self.assertEqual(events[-1]['id'],'bad.js')
        self.assertIn(reports[1]['errors'][0],events[-1]['reason'])

    def test_standard_prototype_and_unknown_receivers_are_ordinary_this(self):
        # this 是标准 JavaScript：接收者是否可由静态证明不再决定是否拒绝；转换阶段
        # 对无法证明接收者的位置注入 sloppy 语义包装，运行时保留全局对象语义。
        probe="""
import {analyze} from './tools/js-analysis/analysis/analyze.mjs';
import assert from 'node:assert/strict';
const options={nativeMethods:true,nativeStandardGlobals:true};
const check=source=>analyze(source,'loon',options).errors;
assert.deepEqual(check('Date.prototype.fixture=function(){return this.getFullYear()};$done({});'),[]);
for(const source of [
 'Date.container.fixture=function(){return this.value};$done({});',
 'unreviewed.prototype.fixture=function(){return this.value};$done({});',
 'const Date={prototype:{}};Date.prototype.fixture=function(){return this.value};$done({});'
])assert.deepEqual(check(source),[]);
assert(check('function read(){return this.$request.body}$done({});').some(error=>error.includes('this 读取旧平台全局对象')));
console.log(JSON.stringify({ok:true}));
"""
        result=subprocess.run(['node','--input-type=module','-e',probe],text=True,capture_output=True,check=True)
        self.assertEqual(json.loads(result.stdout),{'ok':True})

    def test_native_batches_limit_combined_compiler_work_and_keep_duplicates(self):
        jobs=[('$done({body:"'+str(i)+'"});','surge') for i in range(19)]
        jobs += [jobs[2]]
        def analyze(batch):return [{'source':job['source']} for job in batch]
        with patch.object(js_analysis,'_run_batch',side_effect=analyze) as run:
            reports=js_analysis.analyze_many(jobs,mode='native')
        self.assertEqual([len(call.args[0]) for call in run.call_args_list],[8,8,3])
        self.assertEqual(reports[-1],reports[2])

    def test_timed_out_batch_splits_without_hiding_single_script_timeout(self):
        jobs=[{'source':str(i)} for i in range(4)]
        def run(command,**kwargs):
            batch=json.loads(kwargs['input'])
            if len(batch)>1:raise subprocess.TimeoutExpired(command,kwargs['timeout'])
            return subprocess.CompletedProcess(command,0,json.dumps(batch),'')
        with patch.object(js_analysis.subprocess,'run',side_effect=run) as calls:
            self.assertEqual(js_analysis._run_batch(jobs),jobs)
        self.assertEqual(calls.call_count,7)
        with patch.object(js_analysis.subprocess,'run',side_effect=subprocess.TimeoutExpired('node',60)):
            with self.assertRaisesRegex(ValueError,'1 个输入，60 秒'):
                js_analysis._run_batch(jobs[:1])

    def test_single_native_timeout_is_a_rejection_without_losing_other_results(self):
        jobs=[{'source':'slow','mode':'native','options':{'storage_key':'egern-hub:https://example.test/slow.js'}},
              {'source':'fast','mode':'native'}]
        def run(command,**kwargs):
            batch=json.loads(kwargs['input'])
            if any(job['source']=='slow' for job in batch):
                raise subprocess.TimeoutExpired(command,kwargs['timeout'])
            return subprocess.CompletedProcess(command,0,json.dumps([{'errors':[],'code':'fast'}]),'')
        with patch.object(js_analysis.subprocess,'run',side_effect=run):
            reports=js_analysis._run_batch(jobs)
        self.assertTrue(reports[0]['analysis_timeout'])
        self.assertIn('https://example.test/slow.js',reports[0]['errors'][0])
        self.assertIsNone(reports[0]['code'])
        self.assertEqual(reports[1],{'errors':[],'code':'fast'})

    def test_single_probe_timeout_is_skipped_and_cannot_abort_verification(self):
        job={'source':'const response = $response.body;','source_format':'any','mode':'probes','options':{}}
        with patch.object(js_analysis.subprocess,'run',side_effect=subprocess.TimeoutExpired('node',60)):
            report=js_analysis._run_batch([job])[0]
        self.assertTrue(report['probe_skipped'])
        self.assertIn('跳过自动生成输入',report['limits'][0])

    def test_finite_eval_function_dispatch_is_lowered_and_unknown_targets_reject(self):
        probe="""
import assert from 'node:assert/strict';
import {native} from './tools/js-analysis/compiler/native.mjs';
const finite='const routes={"/a":"first","/b":"second"};function first(d){d.value="a";}function second(d){d.value="b";}function choose(){const key=Object.keys(routes).find(k=>$request.url.includes(k));return key?routes[key]:null;}const method=choose();const data={};if(method){const fn=eval(method);new fn(data);}$done({body:JSON.stringify(data)});';
const lowered=native(finite,'surge');
assert.deepEqual(lowered.errors,[]);
assert.doesNotMatch(lowered.code,/eval\\(/);
assert.ok(lowered.static_transformations.some(item=>item.kind==='finite-function-dispatch'));
const entries=native(finite.replace('const key=Object.keys(routes).find(k=>$request.url.includes(k));return key?routes[key]:null;','for(const [key,value]of Object.entries(routes)){if($request.url.includes(key))return value;}return null;'),'surge');
assert.deepEqual(entries.errors,[]);
assert.doesNotMatch(entries.code,/eval\\(/);
const dynamic=native('const method=$argument;eval(method)();$done({});','loon');
assert.ok(dynamic.errors.some(error=>error.includes('无法证明动态 eval 函数分派的目标')));
console.log(JSON.stringify({ok:true}));
"""
        result=subprocess.run(['node','--input-type=module','-e',probe],text=True,capture_output=True,check=True,
                              cwd=Path(__file__).resolve().parents[1],timeout=10)
        self.assertEqual(json.loads(result.stdout),{'ok':True})

    def test_probe_resource_skip_is_reported_with_script_progress(self):
        job=('x'*(1024*1024+1),'any')
        progress={'kind':'script','stage':'verification_probes','id':'oversized.js','index':1,'total':1}
        output=io.StringIO()
        with patch.dict(os.environ,{'EGERN_PROGRESS_EVENTS':'1'}),contextlib.redirect_stdout(output):
            report=js_analysis.analyze_many([job],mode='probes',progress_items=[progress])[0]
        events=[json.loads(line[len(js_analysis.PROGRESS_PREFIX):])
                for line in output.getvalue().splitlines() if line.startswith(js_analysis.PROGRESS_PREFIX)]
        self.assertTrue(report['probe_skipped'])
        self.assertTrue(any(event.get('stage')=='probe_generation_skipped' and event.get('id')=='oversized.js'
                            for event in events))

    def test_probe_batches_remain_bounded_without_spawning_one_process_per_script(self):
        jobs=[('const value='+str(index)+';','any') for index in range(33)]
        def analyze(batch):return [{'paths':[[job['source']]]} for job in batch]
        with patch.object(js_analysis,'_run_batch',side_effect=analyze) as run:
            reports=js_analysis.analyze_many(jobs,mode='probes')
        self.assertEqual([len(call.args[0]) for call in run.call_args_list],[32,1])
        self.assertEqual(len(reports),33)

    def test_jobs_keep_independent_scope_diagnostics_and_source_platform(self):
        source='$httpClient.get({url:"https://example.com",node:"DIRECT"},()=>{$done({})});'
        jobs=[('const $custom=1;$done({body:String($custom)});','surge'),
              ('$custom();$done({});','surge'),
              (source,'loon'),(source,'surge'),
              ('$done({body:"last"});','qx')]
        reports=js_analysis.analyze_many(jobs)
        self.assertFalse(reports[0]['errors'])
        self.assertIn('未适配 API：$custom',reports[1]['errors'])
        self.assertFalse(reports[2]['errors'])
        self.assertIn('未适配 HTTP 参数：$httpClient.node',reports[3]['errors'])
        self.assertFalse(reports[4]['errors'])
        self.assertEqual(reports[4]['apis'],['$done'])

    def test_large_batches_are_bounded_and_duplicate_results_keep_order(self):
        jobs=[('$done({body:"'+str(i)+'"});','surge') for i in range(257)]
        jobs += [jobs[3],jobs[0]]
        with patch.object(js_analysis,'_run_batch',wraps=js_analysis._run_batch) as run:
            reports=js_analysis.analyze_many(iter(jobs))
        self.assertEqual(run.call_count,9)
        self.assertEqual(len(run.call_args_list[0].args[0]),32)
        self.assertEqual(len(run.call_args_list[-1].args[0]),1)
        self.assertEqual(len(reports),259)
        self.assertEqual(reports[257],reports[3])
        self.assertEqual(reports[258],reports[0])
        self.assertTrue(all(not report['errors'] for report in reports))

    def test_probe_ast_node_limit_skips_large_inputs_without_running_them(self):
        probe="""
import assert from 'node:assert/strict';
import {probes} from './tools/js-analysis/analysis/probes.mjs';
const source='(()=>{const value={key:1};})();\\n'.repeat(13000);
const report=probes(source);
assert.equal(report.probe_skipped,true);
assert.match(report.limits[0],/AST 节点/);
console.log(JSON.stringify({ok:true}));
"""
        result=subprocess.run(['node','--input-type=module','-e',probe],text=True,capture_output=True,check=True,
                              cwd=Path(__file__).resolve().parents[1],timeout=5)
        self.assertEqual(json.loads(result.stdout),{'ok':True})
