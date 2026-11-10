// 依次执行结构折叠与旧字符串表步骤，验证残留版本哨兵不会二次误拒。
import {readFileSync} from 'node:fs';
import {lowerObfuscatedTables,lowerStringTables} from '../../tools/js-analysis/transforms/decoding.mjs';

const source=readFileSync(0,'utf8');
try{
 const folded=lowerObfuscatedTables(source),decoded=lowerStringTables(folded.source);
 process.stdout.write(JSON.stringify({folded:folded.transformations.length,decoded:decoded.transformations.length,source:decoded.source}));
}catch(error){
 process.stdout.write(JSON.stringify({error:error.message}));
}
