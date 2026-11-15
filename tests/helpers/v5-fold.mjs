// 对合成的 jsjiami v5 表执行闭合静态折叠，供结构反例回归使用。
import {readFileSync} from 'node:fs';
import {lowerV5StringTables} from '../../tools/js-analysis/transforms/decoding.mjs';

const source=readFileSync(0,'utf8');
try{
 const result=lowerV5StringTables(source);
 process.stdout.write(JSON.stringify({transformations:result.transformations,source:result.source}));
}catch(error){
 process.stdout.write(JSON.stringify({error:error.message}));
}
