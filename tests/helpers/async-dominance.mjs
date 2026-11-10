// 对源代码中的首个 Promise 完成根执行纯静态支配证明，供正反例回归使用。
import {readFileSync} from 'node:fs';
import {parse} from '../../tools/js-analysis/core/syntax.mjs';
import {index,closedAsyncCompletionRoot,functions,property} from '../../tools/js-analysis/core/ast.mjs';

const source=readFileSync(0,'utf8');
const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true});
const ix=index(tree);
const completionOwners=new Set();
for(const node of ix.nodes){
 if(node.type==='CallExpression'&&ix.free(node.callee,'$done'))completionOwners.add(ix.owners.get(node));
}
const target=node=>{
 if(functions.has(node?.type))return node;
 if(node?.type!=='Identifier')return null;
 const binding=ix.bindings.get(node);
 return binding?.fn??(functions.has(binding?.init?.type)?binding.init:null);
};
let changed=true;
while(changed){
 changed=false;
 for(const node of ix.nodes){
  if(node.type!=='CallExpression')continue;
  const fn=target(node.callee);
  if(fn&&completionOwners.has(fn)&&!completionOwners.has(ix.owners.get(node))){completionOwners.add(ix.owners.get(node));changed=true;}
  if(node.callee.type==='MemberExpression'&&['then','catch','finally'].includes(property(node.callee))&&node.arguments.some(argument=>completionOwners.has(target(argument)))&&!completionOwners.has(ix.owners.get(node))){completionOwners.add(ix.owners.get(node));changed=true;}
 }
}
const candidates=ix.nodes.filter(node=>node.type==='CallExpression'&&ix.parents.get(node)?.type==='ExpressionStatement'&&node.callee.type==='MemberExpression'&&['then','catch','finally'].includes(property(node.callee)));
const candidate=candidates.find(node=>{
 const parent=ix.parents.get(node);
 return parent.body?.some?.(statement=>statement===parent)||ix.parents.get(parent)?.type==='Program';
})??candidates[0];
process.stdout.write(JSON.stringify({proved:!!candidate&&closedAsyncCompletionRoot(ix,candidate,fn=>completionOwners.has(fn))}));
