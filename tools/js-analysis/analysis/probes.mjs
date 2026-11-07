import {parse} from '../core/syntax.mjs';

// Input hints only: parse original AST without executing author code.
export function probes(source){
 let tree;
 try{tree=parse(source,{ecmaVersion:'latest',sourceType:'module',allowReturnOutsideFunction:true});}
 catch(e){return {paths:[],strings:[],limits:[e.message]};}
 const nodes=[],parents=new WeakMap(),defs=new Map(),aliases=new Map(),strings=new Set(),objectKeys=new Set();
 const pending=[tree];
 while(pending.length){const n=pending.pop();nodes.push(n);
  for(const value of Object.values(n))for(const child of Array.isArray(value)?value:[value])if(child?.type){parents.set(child,n);pending.push(child);}
  if(n.type==='VariableDeclarator'&&n.id.type==='Identifier'&&n.init){if(!defs.has(n.id.name))defs.set(n.id.name,[]);defs.get(n.id.name).push(n.init);}
  if(n.type==='Literal'&&typeof n.value==='string'&&n.value.length<300)strings.add(n.value);
  if(n.type==='Property'&&!n.computed){const k=n.key.name??String(n.key.value);if(k.length<100)objectKeys.add(k);}
 }
 const prop=n=>n.computed?(n.property.type==='Literal'?String(n.property.value):
  (defs.get(n.property.name)??[]).some(v=>v.type==='Literal'&&typeof v.value==='number')?'0':null):n.property.name;
 function path(n,seen=new Set()){
  if(!n)return null;
  if(n.type==='ChainExpression')return path(n.expression,seen);
  if(n.type==='LogicalExpression')return path(n.left,seen)??path(n.right,seen);
  if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&n.callee.object.name==='JSON'&&prop(n.callee)==='parse')return [];
  if(n.type==='Identifier'){
   if(seen.has(n.name))return null;seen=new Set([...seen,n.name]);
   if(aliases.has(n.name))return aliases.get(n.name);
   for(const value of defs.get(n.name)??[]){const result=path(value,seen);if(result)return result;}
  }
  if(n.type==='MemberExpression'){const root=path(n.object,seen),key=prop(n);return root&&key!==null?[...root,key]:null;}
  return null;
 }
 // Callback item paths for common array operations.
 for(let pass=0;pass<3;pass++)for(const n of nodes)if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&['map','filter','forEach','find','some','every'].includes(prop(n.callee))){
  const root=path(n.callee.object),fn=n.arguments[0];
  if(root&&fn?.params?.[0]?.type==='Identifier')aliases.set(fn.params[0].name,[...root,'0']);
 }
 const functions=new Map(nodes.filter(n=>n.type==='FunctionDeclaration'&&n.id).map(n=>[n.id.name,n]));
 for(let pass=0;pass<3;pass++)for(const n of nodes)if(n.type==='CallExpression'&&n.callee.type==='Identifier'){
  const fn=functions.get(n.callee.name);if(!fn)continue;
  fn.params.forEach((param,i)=>{const root=path(n.arguments[i]);if(param.type==='Identifier'&&!defs.has(param.name)&&!aliases.has(param.name)&&root&&root.length<9)aliases.set(param.name,root);});
 }
 const paths=[],containers=[],jsonFields=[],regexes=[],guardKeys=new Set(),methods=new Set(['map','filter','forEach','find','some','every','push','splice','includes','indexOf','replace','replaceAll','split','join','toString','hasOwnProperty']);
 for(const n of nodes)if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'){
  if(n.callee.object.name==='Object'&&prop(n.callee)==='assign'){
   const root=path(n.arguments[0]);if(root){containers.push(root);for(const arg of n.arguments.slice(1))for(const p of arg.properties??[])if(p.type==='Property')paths.push([...root,p.key.name??String(p.key.value)]);}
  }
  if(n.callee.object.name==='JSON'&&prop(n.callee)==='parse'&&n.arguments[0]?.type==='MemberExpression'){
   const p=path(n.arguments[0]);if(p)jsonFields.push(p);
  }
  if(['replace','replaceAll'].includes(prop(n.callee))&&n.arguments[0]?.regex)regexes.push(n.arguments[0].regex.pattern);
 }
 for(const n of nodes)if(n.type==='MemberExpression'){
  const p=path(n);if(!p||!p.length||p.length>9)continue;
  const parent=parents.get(n);
  if(parent?.type==='CallExpression'&&parent.callee===n){
   if(['map','filter','forEach','find','some','every','push','splice'].includes(prop(n)))paths.push([...p.slice(0,-1),'0']);
   continue;
  }
  if(p.at(-1)==='length'){paths.push([...p.slice(0,-1),'0']);continue;}
  if(!methods.has(p.at(-1)))paths.push(p);
 }
 // Quoted JSON keys in string replacements are also useful input seeds.
 for(const n of nodes)if(n.type==='Literal'&&n.regex)for(const m of n.regex.pattern.matchAll(/["']([\w.-]+)["']\s*:/g))paths.push([m[1]]);
 for(const n of nodes)if(n.type==='BinaryExpression'&&n.operator==='in'&&n.left.type==='Literal'&&typeof n.left.value==='string'){
  guardKeys.add(n.left.value);
  const root=path(n.right);if(root)paths.push([...root,n.left.value]);
 }
 return {paths:paths.slice(0,500),containers,json_fields:jsonFields,regexes:regexes.slice(0,32),guard_keys:[...guardKeys].sort().slice(0,100),object_keys:[...objectKeys].sort(),strings:[...strings].sort().slice(0,300),limits:['启发式输入结构，不代表接口 schema 或完整分支覆盖']};
}
