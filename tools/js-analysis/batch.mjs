import {analyze} from './analysis/analyze.mjs';
import {behavior} from './analysis/behavior.mjs';
import {probes} from './analysis/probes.mjs';
import {native} from './compiler/native.mjs';
import {readFileSync} from 'node:fs';

// Reuse one parser/runtime for a bounded batch. Never execute input scripts.
const jobs=JSON.parse(readFileSync(0,'utf8'));
if(!Array.isArray(jobs))throw new TypeError('Expected analysis jobs');
const reports=[];
for(const job of jobs){
  const {source,source_format='surge',mode='convert',options={},progress}=job;
  if(typeof source!=='string')throw new TypeError('Expected source text');
  if(progress)process.stderr.write('@@EGERN_PROGRESS '+JSON.stringify(progress)+'\n');
  const report=mode==='native'?native(source,source_format,options):mode==='probes'?probes(source):mode==='behavior'?behavior(source):analyze(source,source_format);
  reports.push(report);
  if(progress){
    const failed=progress.stage==='converting' && report.errors?.length;
    const stage=failed?'conversion_failed':progress.stage==='converting'?'converted':progress.stage==='verification_probes'?'probes_ready':progress.stage;
    process.stderr.write('@@EGERN_PROGRESS '+JSON.stringify({...progress,stage,...(failed?{reason:report.errors.join('; ')}:{})})+'\n');
  }
}
process.stdout.write(JSON.stringify(reports));
