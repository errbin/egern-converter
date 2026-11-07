// Isolate structured return propagation from platform-client recognition.
import {readFileSync} from 'node:fs';
import {parse} from '../../tools/js-analysis/vendor/acorn.mjs';
import {index,patch} from '../../tools/js-analysis/core/ast.mjs';
import {structuredFlow} from '../../tools/js-analysis/compiler/flow.mjs';
const source=readFileSync(0,'utf8'),tree=parse(source,{ecmaVersion:'latest'}),ix=index(tree),substitutions=new WeakMap();
const names=new Set(ix.nodes.filter(n=>n.type==='Identifier').map(n=>n.name));
const fresh=base=>{let name=base,i=2;while(names.has(name))name=base+i++;names.add(name);return name;};
const isDone=n=>n.type==='CallExpression'&&ix.free(n.callee,'$done');
function api(n){
 if(substitutions.has(n))return substitutions.get(n);
 if(ix.free(n,'$request'))return 'ctx.request';
 if(ix.free(n,'$response'))return 'ctx.response';
 return patch(source,n,api);
}
try{
 const flow=structuredFlow({source,tree,ix,context:'ctx',fresh,api,payload:n=>n?api(n):'{}',isDone,compressionMethod:()=>null,replyPrelude:()=>'',extraAfter:new WeakMap(),substitutions});
 process.stdout.write(JSON.stringify({code:'export default async function(ctx){'+flow.prefix+flow.body+'}'}));
}catch(e){process.stdout.write(JSON.stringify({error:e.message}));}
