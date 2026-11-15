import {parse} from '../core/syntax.mjs';

const SOURCE_LIMIT=1024*1024;
const NODE_LIMIT=100000;
const WORK_LIMIT=2000000;
const PATH_DEPTH_LIMIT=64;
const WORK_LIMIT_REASON='自动探针分析跳过：静态分析工作量超过上限';
const SCOPED_RETRY_LIMIT='按作用域收缩后完成静态分析';

function skipped(reason){
 return {paths:[],containers:[],json_fields:[],regexes:[],guard_keys:[],object_keys:[],strings:[],
  limits:[reason],probe_skipped:true};
}

// Input hints only: parse original AST without executing author code.
// 常规脚本保持原有的全局名称解析路径，保证既有输入提示不变；只有工作量
// 达到上限时才用作用域收缩重试，避免同名局部变量跨函数反复互撞。
export function probes(source){
 const report=analyze(source,false);
 if(!report.probe_skipped||!report.limits?.includes(WORK_LIMIT_REASON))return report;
 const scoped=analyze(source,true);
 if(!scoped.probe_skipped){
  return {...scoped,limits:[...scoped.limits,SCOPED_RETRY_LIMIT]};
 }
 return {...scoped,limits:[scoped.limits?.[0]===WORK_LIMIT_REASON
  ?'自动探针分析跳过：按作用域收缩后仍超过静态分析工作量上限'
  :scoped.limits?.[0]]};
}

function analyze(source,scoped){
 if(source.length>SOURCE_LIMIT)return skipped('自动探针分析跳过：源码超过 1 MiB 静态分析上限');
 let tree;
 try{tree=parse(source,{ecmaVersion:'latest',sourceType:'module',allowReturnOutsideFunction:true});}
 catch(e){return {paths:[],strings:[],limits:[e.message]};}
 const nodes=[],parents=new WeakMap(),defs=new Map(),aliases=new Map(),strings=new Set(),objectKeys=new Set();
 const ownerOf=scoped?new WeakMap():null,defsByOwner=scoped?new Map():null,functionsByOwner=scoped?new Map():null;
 let work=0,exhausted=false;
 const step=()=>{if(++work<=WORK_LIMIT)return true;exhausted=true;return false;};
 const isFunction=n=>['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(n.type);
 const addOwned=(map,owner,name,value)=>{let owners=map.get(name);if(!owners){owners=new Map();map.set(name,owners);}let list=owners.get(owner);if(!list){list=[];owners.set(owner,list);}list.push(value);};
 const pending=scoped?[{node:tree,owner:tree}]:[tree];
 while(pending.length){if(nodes.length>=NODE_LIMIT)return skipped('自动探针分析跳过：AST 节点超过静态分析上限');if(!step())return skipped(WORK_LIMIT_REASON);const entry=pending.pop(),n=scoped?entry.node:entry,owner=scoped?entry.owner:null;nodes.push(n);
  if(scoped)ownerOf.set(n,owner);
  const childOwner=scoped&&isFunction(n)?n:owner;
  for(const value of Object.values(n))for(const child of Array.isArray(value)?value:[value])if(child?.type){if(!step())return skipped(WORK_LIMIT_REASON);parents.set(child,n);pending.push(scoped?{node:child,owner:childOwner}:child);}
  if(n.type==='VariableDeclarator'&&n.id.type==='Identifier'&&n.init){if(!defs.has(n.id.name))defs.set(n.id.name,[]);defs.get(n.id.name).push(n.init);if(scoped)addOwned(defsByOwner,owner,n.id.name,n.init);}
  if(n.type==='FunctionDeclaration'&&n.id&&scoped)addOwned(functionsByOwner,owner,n.id.name,n);
  if(n.type==='Literal'&&typeof n.value==='string'&&n.value.length<300)strings.add(n.value);
  if(n.type==='Property'&&!n.computed){const k=n.key.name??String(n.key.value);if(k.length<100)objectKeys.add(k);}
 }
 if(scoped)ownerOf.set(tree,null);
 // 作用域模式沿函数所有者链查找最近的声明；没有局部声明时不回退到全局
 // 同名表，否则会重新引入跨函数误解析和指数级重复遍历。
 const owned=(map,node,name)=>{for(let owner=ownerOf.get(node);owner;owner=ownerOf.get(owner)){const list=map.get(name)?.get(owner);if(list)return list;}return [];};
 const visibleDefs=scoped?node=>owned(defsByOwner,node,node.name):node=>defs.get(node.name)??[];
 const visibleFunction=scoped?node=>owned(functionsByOwner,node,node.callee.name)[0]??null:null;
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
   for(const value of visibleDefs(n)){if(!step())return null;const result=path(value,seen,depth+1);if(result)return result;}
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
 if(!scoped)for(const n of nodes){if(!step())break;if(n.type==='FunctionDeclaration'&&n.id)functions.set(n.id.name,n);}
 for(let pass=0;pass<3&&!exhausted;pass++)for(const n of nodes){if(!step())break;if(n.type==='CallExpression'&&n.callee.type==='Identifier'){
  const fn=scoped?visibleFunction(n):functions.get(n.callee.name);if(!fn)continue;
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
 if(exhausted)return skipped(WORK_LIMIT_REASON);
 return {paths:paths.slice(0,500),containers,json_fields:jsonFields,regexes:regexes.slice(0,32),guard_keys:[...guardKeys].sort().slice(0,100),object_keys:[...objectKeys].sort(),strings:[...strings].sort().slice(0,300),limits:['启发式输入结构，不代表接口 schema 或完整分支覆盖']};
}
