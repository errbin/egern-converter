import {analyze} from './analysis/analyze.mjs';
import {behavior} from './analysis/behavior.mjs';
import {probes} from './analysis/probes.mjs';
import {native} from './compiler/native.mjs';
import {readFileSync} from 'node:fs';

// Reuse one parser/runtime for a bounded batch. Never execute input scripts.
const jobs=JSON.parse(readFileSync(0,'utf8'));
if(!Array.isArray(jobs))throw new TypeError('Expected analysis jobs');
const reports=jobs.map(({source,source_format='surge',mode='convert',options={}})=>{
  if(typeof source!=='string')throw new TypeError('Expected source text');
  return mode==='native'?native(source,source_format,options):mode==='probes'?probes(source):mode==='behavior'?behavior(source):analyze(source,source_format);
});
process.stdout.write(JSON.stringify(reports));
