// 统计本地语料中的内联缓存式解码器整族折叠结果，供定向回归使用。
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {lowerObfuscatedTables} from '../../tools/js-analysis/transforms/decoding.mjs';

const indexPath=process.argv[2];
const index=JSON.parse(readFileSync(indexPath,'utf8'));
const sources=join(dirname(indexPath),'sources');
const result={files:0,folded:0,nofold:0,errors:{}};
for(const meta of Object.values(index)){
  if(!meta.file)continue;
  let source;
  try{source=readFileSync(join(sources,meta.file),'utf8');}catch{continue;}
  result.files++;
  try{
    if(lowerObfuscatedTables(source).transformations.length)result.folded++;
    else result.nofold++;
  }catch(error){
    const reason=String(error.message).split('：').at(-1);
    result.errors[reason]=(result.errors[reason]||0)+1;
  }
}
process.stdout.write(JSON.stringify(result));
