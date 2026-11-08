import {parse} from '../core/syntax.mjs';

const SOURCE_LIMIT=1024*1024;
const NODE_LIMIT=100000;
const WORK_LIMIT=2000000;
const PATH_DEPTH_LIMIT=64;

function skipped(reason){
 return {paths:[],containers:[],json_fields:[],regexes:[],guard_keys:[],object_keys:[],strings:[],
  limits:[reason],probe_skipped:true};
}

// Input hints only: parse original AST without executing author code.
export function probes(source){
 if(source.length>SOURCE_LIMIT)return skipped('自动探针分析跳过：源码超过 1 MiB 静态分析上限');
 let tree;
 try{tree=parse(source,{ecmaVersion:'latest',sourceType:'module',allowReturnOutsideFunction:true});}
 catch(e){return {paths:[],strings:[],limits:[e.message]};}
 const nodes=[],parents=new WeakMap(),defs=new Map(),aliases=new Map(),strings=new Set(),objectKeys=new Set();
 let work=0,exhausted=false;
 const step=()=>{if(++work<=WORK_LIMIT)return true;exhausted=true;return false;};
 const pending=[tree];
 while(pending.length){if(nodes.length>=NODE_LIMIT)return skipped('自动探针分析跳过：AST 节点超过静态分析上限');if(!step())return skipped('自动探针分析跳过：静态分析工作量超过上限');const n=pending.pop();nodes.push(n);
  for(const value of Object.values(n))for(const child of Array.isArray(value)?value:[value])if(child?.type){if(!step())return skipped('自动探针分析跳过：静态分析工作量超过上限');parents.set(child,n);pending.push(child);}
  if(n.type==='VariableDeclarator'&&n.id.type==='Identifier'&&n.init){if(!defs.has(n.id.name))defs.set(n.id.name,[]);defs.get(n.id.name).push(n.init);}
  if(n.type==='Literal'&&typeof n.value==='string'&&n.value.length<300)strings.add(n.value);
  if(n.type==='Property'&&!n.computed){const k=n.key.name??String(n.key.value);if(k.length<100)objectKeys.add(k);}
 }
 const prop=n=>{
  if(!n?.computed)return n?.property?.name??null;
  if(n.property.type==='Literal')return String(n.property.value);
  for(const value of defs.get(n.property.name)??[]){if(!step())return null;if(value.type==='Literal'&&typeof value.value==='number')return '0';}
  return null;
 };
 function path(n,seen=new Set(),depth=0){
  if(!step())return null;
  if(depth>PATH_DEPTH_LIMIT){exhausted=true;return null;}
  if(!n)return null;
  if(n.type==='ChainExpression')return path(n.expression,seen,depth+1);
  if(n.type==='LogicalExpression')return path(n.left,seen,depth+1)??path(n.right,seen,depth+1);
  if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&n.callee.object.name==='JSON'&&prop(n.callee)==='parse')return [];
  if(n.type==='Identifier'){
   if(seen.has(n.name))return null;seen=new Set([...seen,n.name]);
   if(aliases.has(n.name))return aliases.get(n.name);
   for(const value of defs.get(n.name)??[]){if(!step())return null;const result=path(value,seen,depth+1);if(result)return result;}
  }
  if(n.type==='MemberExpression'){const root=path(n.object,seen,depth+1),key=prop(n);return root&&key!==null?[...root,key]:null;}
  return null;
 }
 // Callback item paths for common array operations.
 for(let pass=0;pass<3&&!exhausted;pass++)for(const n of nodes){if(!step())break;if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&['map','filter','forEach','find','some','every'].includes(prop(n.callee))){
  const root=path(n.callee.object),fn=n.arguments[0];
  if(root&&fn?.params?.[0]?.type==='Identifier')aliases.set(fn.params[0].name,[...root,'0']);
 }}
 const functions=new Map();
 for(const n of nodes){if(!step())break;if(n.type==='FunctionDeclaration'&&n.id)functions.set(n.id.name,n);}
 for(let pass=0;pass<3&&!exhausted;pass++)for(const n of nodes){if(!step())break;if(n.type==='CallExpression'&&n.callee.type==='Identifier'){
  const fn=functions.get(n.callee.name);if(!fn)continue;
  for(let i=0;i<fn.params.length;i++){if(!step())break;const param=fn.params[i],root=path(n.arguments[i]);if(param.type==='Identifier'&&!defs.has(param.name)&&!aliases.has(param.name)&&root&&root.length<9)aliases.set(param.name,root);}
 }}
 const paths=[],containers=[],jsonFields=[],regexes=[],guardKeys=new Set(),methods=new Set(['map','filter','forEach','find','some','every','push','splice','includes','indexOf','replace','replaceAll','split','join','toString','hasOwnProperty']);
 for(const n of nodes){if(!step())break;if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'){
   if(n.callee.object.name==='Object'&&prop(n.callee)==='assign'){
   const root=path(n.arguments[0]);if(root){containers.push(root);for(const arg of n.arguments.slice(1))for(const p of arg.properties??[]){if(!step())break;if(p.type==='Property')paths.push([...root,p.key.name??String(p.key.value)]);}}
  }
  if(n.callee.object.name==='JSON'&&prop(n.callee)==='parse'&&n.arguments[0]?.type==='MemberExpression'){
   const p=path(n.arguments[0]);if(p)jsonFields.push(p);
  }
  if(['replace','replaceAll'].includes(prop(n.callee))&&n.arguments[0]?.regex)regexes.push(n.arguments[0].regex.pattern);
 }}
 for(const n of nodes){if(!step())break;if(n.type==='MemberExpression'){
  const p=path(n);if(!p||!p.length||p.length>9)continue;
  const parent=parents.get(n);
  if(parent?.type==='CallExpression'&&parent.callee===n){
   if(['map','filter','forEach','find','some','every','push','splice'].includes(prop(n)))paths.push([...p.slice(0,-1),'0']);
   continue;
  }
  if(p.at(-1)==='length'){paths.push([...p.slice(0,-1),'0']);continue;}
  if(!methods.has(p.at(-1)))paths.push(p);
 }}
 // Quoted JSON keys in string replacements are also useful input seeds.
 for(const n of nodes){if(!step())break;if(n.type==='Literal'&&n.regex)for(const m of n.regex.pattern.matchAll(/["']([\w.-]+)["']\s*:/g)){if(!step())break;paths.push([m[1]]);}}
 for(const n of nodes){if(!step())break;if(n.type==='BinaryExpression'&&n.operator==='in'&&n.left.type==='Literal'&&typeof n.left.value==='string'){
  guardKeys.add(n.left.value);
  const root=path(n.right);if(root)paths.push([...root,n.left.value]);
 }}
 if(exhausted)return skipped('自动探针分析跳过：静态分析工作量超过上限');
 return {paths:paths.slice(0,500),containers,json_fields:jsonFields,regexes:regexes.slice(0,32),guard_keys:[...guardKeys].sort().slice(0,100),object_keys:[...objectKeys].sort(),strings:[...strings].sort().slice(0,300),limits:['启发式输入结构，不代表接口 schema 或完整分支覆盖']};
}
