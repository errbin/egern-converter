// 统计本地语料中的缓存式内嵌壳，并逐文件验证整族折叠。
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {inspectCachedShellFamily,lowerObfuscatedTables} from '../../tools/js-analysis/transforms/decoding.mjs';

const indexPath=process.argv[2];
const index=JSON.parse(readFileSync(indexPath,'utf8'));
const sources=join(dirname(indexPath),'sources');
let inspected=0,twoShells=0,foldedTwoShellFiles=0,foldedTwoShells=0;const failures=[];
for(const [url,meta]of Object.entries(index)){
 let source;
 try{source=readFileSync(join(sources,meta.file),'utf8');}catch{continue;}
 let found;
 try{found=inspectCachedShellFamily(source);}catch{continue;}
 if(!found.length)continue;
 inspected++;
 const shells=found.reduce((count,item)=>count+item.shells,0);
 if(shells!==2)continue;
 twoShells++;
 try{
  lowerObfuscatedTables(source);
  foldedTwoShellFiles++;foldedTwoShells+=shells;
 }catch(error){
  if(!error.message.includes('轮转'))failures.push({url,error:error.message});
 }
}
process.stdout.write(JSON.stringify({inspected,twoShells,foldedTwoShellFiles,foldedTwoShells,failures}));
