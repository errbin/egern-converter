import contextlib
import io
import json
import os
import subprocess
import unittest
from unittest.mock import patch
from tools.egern_hub import js_analysis


class BatchAnalysisTests(unittest.TestCase):
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

    def test_standard_prototype_receiver_does_not_allow_unknown_object_receivers(self):
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
])assert(check(source).some(error=>error.includes('this 绑定')));
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
