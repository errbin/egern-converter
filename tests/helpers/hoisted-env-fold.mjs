// 对经典 Env 外壳执行平台折叠与不可达方法裁剪，供支配关系回归使用。
import {readFileSync} from 'node:fs';
import {foldTargetEnvironments,pruneTargetEnvironments} from '../../tools/js-analysis/platform/environment.mjs';
import {platformFold} from '../../tools/js-analysis/platform/globals.mjs';
import {simplify} from '../../tools/js-analysis/transforms/simplify.mjs';

const source=readFileSync(0,'utf8');
let output;
try{
 output=foldTargetEnvironments(source,'surge');
 for(let pass=0;pass<3;pass++)output=pruneTargetEnvironments(simplify(platformFold(output,'surge',{}).source),'surge');
 process.stdout.write(JSON.stringify({
  folded:!/this\.getEnv\(\)/.test(output),
  require:(output.match(/\brequire\b/g)||[]).length,
  source:output,
 }));
}catch(error){
 process.stdout.write(JSON.stringify({error:error.message}));
}
