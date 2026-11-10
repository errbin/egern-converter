// 对多平台 Env 逐步执行归一化、平台探测折叠、常量裁剪与死方法清理。
import {readFileSync} from 'node:fs';
import {normalizePrototypeEnv,foldMultiPlatformProbes,pruneUnusedEnvMethods} from '../../tools/js-analysis/platform/environment.mjs';
import {simplify} from '../../tools/js-analysis/transforms/simplify.mjs';

const source=readFileSync(0,'utf8');
const counts=text=>({
 require:(text.match(/\brequire\b/g)||[]).length,
 isNode:(text.match(/\bisNode\b/g)||[]).length,
 getEnv:(text.match(/\bgetEnv\b/g)||[]).length,
 persistentStore:(text.match(/\$persistentStore\b/g)||[]).length,
 done:(text.match(/\$done\b/g)||[]).length,
});
try{
 const normalized=normalizePrototypeEnv(source),folded=foldMultiPlatformProbes(normalized.source);
 const simplified=simplify(folded.source),pruned=pruneUnusedEnvMethods(simplified);
 process.stdout.write(JSON.stringify({
  normalized:normalized.normalized,
  folded:folded.folded,
  pruned:pruned.pruned,
  completionRemoved:pruned.completionRemoved,
  stages:{
   normalize:{source:normalized.source,counts:counts(normalized.source)},
   fold:{source:folded.source,counts:counts(folded.source)},
   simplify:{source:simplified,counts:counts(simplified)},
   prune:{source:pruned.source,counts:counts(pruned.source)},
  },
  source:pruned.source,
 }));
}catch(error){
 process.stdout.write(JSON.stringify({error:error.message}));
}
