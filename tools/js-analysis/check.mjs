import {parse} from './core/syntax.mjs';
import {assertNoUnverifiedHeaderCalls} from './compiler/native.mjs';
import {readFileSync} from 'node:fs';

if(process.argv.includes('--header-calls')){
  // 供差分验证复用编译器的 Headers 污点检查；存在未验证调用或语法错误时
  // 以非零状态退出，调用方据此区分宿主方法与普通集合方法。
  try{assertNoUnverifiedHeaderCalls(readFileSync(0,'utf8'));}
  catch{process.exitCode=2;}
}else{
// Validate every generated artifact without evaluating any upstream code.
const scripts=JSON.parse(readFileSync(0,'utf8'));
const errors=[];
for(const [id,source] of Object.entries(scripts)) {
  try {parse(source,{ecmaVersion:'latest',sourceType:'module'});}
  catch(error) {errors.push(id+': '+error.message);}
}
process.stdout.write(JSON.stringify(errors));
}
