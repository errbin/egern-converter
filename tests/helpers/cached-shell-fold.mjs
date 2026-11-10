// 对合成缓存式解码器族执行静态折叠，供结构分支回归使用。
import {readFileSync} from 'node:fs';
import {lowerObfuscatedTables} from '../../tools/js-analysis/transforms/decoding.mjs';

const source=readFileSync(0,'utf8');
try{
 const result=lowerObfuscatedTables(source);
 process.stdout.write(JSON.stringify({transformations:result.transformations.length,source:result.source}));
}catch(error){
 process.stdout.write(JSON.stringify({error:error.message}));
}
