import {parse} from '../core/syntax.mjs';
import {index,patch,property,functions} from '../core/ast.mjs';

// Stored settings with a closed JSON writer are data, never a source of new
// platform APIs. Restrict this lowering to self-assigning parenthesized reads;
// arbitrary eval, foreign writers and executable legacy settings stay rejected.
export function lowerStorageEvaluation(source,{inspectOnly=false}={}){
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree),replace=new WeakMap(),transformations=[],closedEvaluations=[];
 const {nodes,parents,bindings,free}=ix;
 const evaluations=nodes.filter(n=>n.type==='CallExpression'&&free(n.callee,'eval')&&!n.optional&&n.arguments.length===1);
 if(!evaluations.length)return {source,transformations};
 const stable=name=>nodes.filter(n=>free(n,name)).every(n=>{const p=parents.get(n),use=parents.get(p);return name==='Object'&&p?.type==='CallExpression'&&p.callee===n||p?.type==='MemberExpression'&&p.object===n&&use?.type==='CallExpression'&&use.callee===p;});
 if(!stable('JSON')||!stable('Object')||nodes.some(n=>n.type==='Identifier'&&(['JSON','Object'].includes(n.name)&&bindings.has(n)||['globalThis','global','window','self'].some(name=>free(n,name)))))return {source,transformations};
 const functionsByBinding=new Map(),definitions=new Map();
 for(const n of nodes)if(['FunctionDeclaration','VariableDeclarator'].includes(n.type)){const b=bindings.get(n.id);definitions.set(b,(definitions.get(b)??0)+1);}
 for(const fn of nodes.filter(n=>functions.has(n.type))){const p=parents.get(fn),id=fn.id??(p?.type==='VariableDeclarator'?p.id:null),b=bindings.get(id);if(b&&!b.writes.length&&definitions.get(b)===1)functionsByBinding.set(b,fn);}
 const target=n=>{
  if(n?.type==='Identifier')return functionsByBinding.get(bindings.get(n));
  if(!inspectOnly||n?.type!=='MemberExpression'||n.object.type!=='Identifier'||typeof property(n)!=='string')return null;
  const instance=bindings.get(n.object),allocation=instance?.init;
  if(!instance||instance.writes.length||!['CallExpression','NewExpression'].includes(allocation?.type)||allocation.callee.type!=='Identifier')return null;
  const factory=functionsByBinding.get(bindings.get(allocation.callee)),returned=factory?.body.body.at(-1)?.argument;
  const cls=returned?.type==='NewExpression'&&returned.callee.type==='ClassExpression'?returned.callee:null;
  if(!cls||cls.superClass||cls.body.body.some(m=>m.computed||m.static))return null;
  // Select the method by this specific closed allocation, never by its name
  // alone. A foreign assignment/escape can replace the writer and void proof.
  if(instance.refs.some(r=>{const p=parents.get(r),use=parents.get(p);return p?.type!=='MemberExpression'||p.object!==r||property(p)===undefined||property(p)===property(n)&&(use?.type==='AssignmentExpression'&&use.left===p||use?.type==='UpdateExpression'||use?.operator==='delete');}))return null;
  const method=cls.body.body.find(m=>m.type==='MethodDefinition'&&property({computed:m.computed,property:m.key})===property(n));
  return method?.value;
 };
 const json=n=>n?.type==='CallExpression'&&n.callee.type==='MemberExpression'&&free(n.callee.object,'JSON')&&property(n.callee)==='stringify'&&n.arguments.length===1;
 const read=n=>n?.type==='CallExpression'&&n.callee.type==='MemberExpression'&&(free(n.callee.object,'$prefs')&&property(n.callee)==='valueForKey'||free(n.callee.object,'$persistentStore')&&property(n.callee)==='read');
 const STORED=Symbol('stored'),UNKNOWN=Symbol('unknown'),NEXT=Symbol('next');
 function origin(n,env=new Map(),seen=new Set()){
  if(!n||seen.has(n))return UNKNOWN;seen=new Set(seen);seen.add(n);
  if(n.type==='Literal'&&!n.regex)return n.value;
  if(n.type==='Identifier'){
   const b=bindings.get(n);if(env.has(b))return env.get(b);
   return b?.init&&!b.writes.length?origin(b.init,env,seen):UNKNOWN;
  }
  if(read(n)&&n.arguments.length===1&&typeof origin(n.arguments[0],env,seen)==='string')return STORED;
  if(n.type==='LogicalExpression'&&n.operator==='||'&&n.right.type==='ArrayExpression'&&!n.right.elements.length)return origin(n.left,env,seen)===STORED?STORED:UNKNOWN;
  if(n.type==='UnaryExpression'&&n.operator==='!'){const v=origin(n.argument,env,seen);return v===UNKNOWN||v===STORED?UNKNOWN:!v;}
  if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&n.callee.object.regex&&n.callee.object.regex.pattern==='^@'&&n.callee.object.regex.flags===''&&property(n.callee)==='test'&&n.arguments.length===1){const key=origin(n.arguments[0],env,seen);return typeof key==='string'?key.startsWith('@'):UNKNOWN;}
  const fn=n.type==='CallExpression'?target(n.callee):null;
  if(!fn||fn.async||fn.generator||seen.has(fn)||n.arguments.some(a=>a.type==='SpreadElement')||fn.params.some(p=>p.type!=='Identifier'))return UNKNOWN;
  const local=new Map(env);fn.params.forEach((p,i)=>local.set(bindings.get(p),origin(n.arguments[i],env,seen)));
  const next=new Set(seen);next.add(fn);
  function statement(s){
   if(s.type==='BlockStatement'){for(const child of s.body){const out=statement(child);if(out!==NEXT)return out;}return NEXT;}
   if(s.type==='VariableDeclaration'){for(const d of s.declarations){if(d.id.type!=='Identifier')return UNKNOWN;local.set(bindings.get(d.id),origin(d.init,local,next));}return NEXT;}
   if(s.type==='ReturnStatement')return origin(s.argument,local,next);
   if(s.type==='IfStatement'){const test=origin(s.test,local,next);return test===UNKNOWN||test===STORED?UNKNOWN:test?statement(s.consequent):s.alternate?statement(s.alternate):NEXT;}
   if(s.type==='EmptyStatement')return NEXT;
   return UNKNOWN;
  }
  const result=statement(fn.body);return result===NEXT?UNKNOWN:result;
 }
 function readsStorage(n){return origin(n)===STORED;}
 function jsonWriter(fn,position,seen=new Set()){
  if(!fn||seen.has(fn)||fn.params[position]?.type!=='Identifier')return false;seen=new Set(seen);seen.add(fn);
  const b=bindings.get(fn.params[position]);if(!b||b.writes.length||!b.refs.length)return false;
  return b.refs.every(r=>{const p=parents.get(r);if(json(p)&&p.arguments[0]===r)return true;if(p?.type!=='CallExpression'||p.arguments.filter(a=>a===r).length!==1)return false;return jsonWriter(target(p.callee),p.arguments.indexOf(r),seen);});
 }
 function argument(n){const a=n.arguments[0];return a?.type==='BinaryExpression'&&a.operator==='+'&&a.right.type==='Literal'&&a.right.value===')'&&a.left.type==='BinaryExpression'&&a.left.operator==='+'&&a.left.left.type==='Literal'&&a.left.left.value==='('?a.left.right:null;}
 for(const n of evaluations){
  const value=argument(n),b=value?.type==='Identifier'?bindings.get(value):null,p=parents.get(n);
  if(!b||!inspectOnly&&!readsStorage(b.init)||p?.type!=='AssignmentExpression'||p.operator!=='='||p.left.type!=='Identifier'||bindings.get(p.left)!==b)continue;
  if(b.writes.some(w=>w.type!=='AssignmentExpression'||w.operator!=='='||w.left.type!=='Identifier'||bindings.get(w.left)!==b||w.right.type!=='CallExpression'||!free(w.right.callee,'eval')||bindings.get(argument(w.right))!==b))continue;
  const writers=b.refs.filter(r=>{const c=parents.get(r);return c?.type==='CallExpression'&&c.arguments.includes(r)&&!(c.callee.type==='MemberExpression'&&free(c.callee.object,'Array')&&property(c.callee)==='isArray');});
  if(!writers.length||!writers.every(r=>{const c=parents.get(r);return json(c)||jsonWriter(target(c.callee),c.arguments.indexOf(r));}))continue;
  closedEvaluations.push(n);
  // JSON.parse's __proto__ data property differs from an evaluated object
  // literal. A reviver restores that existing, already-reviewed distinction.
  replace.set(n,()=>`JSON.parse(${source.slice(value.start,value.end)}, (key, value) => {
    if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, '__proto__')) {
      const prototype = value['__proto__']; delete value['__proto__'];
      if (prototype === null || typeof prototype === 'object') Object.setPrototypeOf(value, prototype);
    }
    return value;
  })`);
  transformations.push({kind:'stored-json-evaluation',line:source.slice(0,n.start).split('\n').length,
   reason:'Self-assigned stored settings have a closed JSON.stringify writer; decode as data without executing storage text',
   limitations:['Initial or externally edited settings must use JSON, matching the authored writer; executable JavaScript settings are not supported']});
 }
 const render=n=>replace.has(n)?replace.get(n)():patch(source,n,render);
 return {source:inspectOnly?source:render(tree),transformations,evaluations:closedEvaluations};
}

// Replace only eval("(" + JSON.stringify(value) + ")"). Its input is data,
// not source code. Object-literal __proto__ semantics differ from JSON.parse,
// so restore that distinction with a bottom-up reviver. Other eval stays rejected.
export function lowerJSONEvaluation(source,{inspectOnly=false}={}){
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree),replace=new WeakMap(),transformations=[],evaluations=[];
 const stable=name=>ix.nodes.filter(n=>ix.free(n,name)).every(n=>{const p=ix.parents.get(n),use=ix.parents.get(p);return p?.type==='MemberExpression'&&p.object===n&&use?.type==='CallExpression'&&use.callee===p;});
 if(!stable('JSON')||!stable('Object')||ix.nodes.some(n=>n.type==='Identifier'&&n.name==='Object'&&ix.bindings.has(n)))return {source,transformations};
 for(const n of ix.nodes)if(n.type==='CallExpression'&&ix.free(n.callee,'eval')&&!n.optional&&n.arguments.length===1){
  const arg=n.arguments[0];let value;
  if(arg.type==='TemplateLiteral'&&arg.expressions.length===1&&arg.quasis[0].value.cooked==='('&&arg.quasis[1].value.cooked===')')value=arg.expressions[0];
  else if(arg.type==='BinaryExpression'&&arg.operator==='+'&&arg.right.type==='Literal'&&arg.right.value===')'&&arg.left.type==='BinaryExpression'&&arg.left.operator==='+'&&arg.left.left.type==='Literal'&&arg.left.left.value==='(')value=arg.left.right;
  if(value?.type!=='CallExpression'||value.callee.type!=='MemberExpression'||!ix.free(value.callee.object,'JSON')||property(value.callee)!=='stringify'||value.arguments.length!==1||value.arguments[0].type==='SpreadElement')continue;
  evaluations.push(n);
  replace.set(n,()=>`((json) => json === undefined ? undefined : JSON.parse(json, (key, value) => {
    if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, '__proto__')) {
      const prototype = value['__proto__']; delete value['__proto__'];
      if (prototype === null || typeof prototype === 'object') Object.setPrototypeOf(value, prototype);
    }
    return value;
  }))(${render(value)})`);
  transformations.push({kind:'json-data-evaluation',line:source.slice(0,n.start).split('\n').length,reason:'Only JSON.stringify output is parsed; object-literal prototype semantics retained'});
 }
 function render(n){return replace.has(n)?replace.get(n)():patch(source,n,render);}
 return {source:inspectOnly?source:render(tree),transformations,evaluations};
}

// Preserve an author's runtime-configurable code extension without leaking its
// declarations from strict-module eval into the surrounding module scope.

const marker='__egernConfiguredEval';

export function lowerConfiguredEval(source){
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree),replace=new WeakMap();let lowered=0;
 if(ix.nodes.some(n=>n.type==='Identifier'&&n.name.startsWith('__egern')))throw Error('与转换器保留标识符冲突');
 for(const seq of ix.nodes.filter(n=>n.type==='SequenceExpression'&&n.expressions.length===2)){
  const [load,invoke]=seq.expressions;
  if(load.type!=='CallExpression'||load.callee.type!=='Identifier'||load.callee.name!=='eval'||load.arguments.length!==1||invoke.type!=='AwaitExpression')continue;
  const call=invoke.argument;
  if(call?.type!=='CallExpression'||call.callee.type!=='Identifier'||call.arguments.some(a=>a.type==='SpreadElement'))continue;
  const handler=call.callee.name;
  if(!/^[A-Za-z_$][\w$]*$/.test(handler)||handler===marker)continue;
  const payload=source.slice(load.arguments[0].start,load.arguments[0].end);
  const args=call.arguments.map(a=>source.slice(a.start,a.end)).join(',');
  const error=JSON.stringify('CODESERVER_FUN must define '+handler);
  replace.set(seq,()=>`(await (await (function ${marker}(source){const factory=eval('(async function(){'+source+'\\n;return typeof ${handler} === "function" ? ${handler} : (() => { throw new TypeError(${error}); });})');return factory();})(${payload}))(${args}))`);
  lowered++;
 }
 const render=n=>{if(replace.has(n)){const value=replace.get(n);return typeof value==='function'?value():value;}return patch(source,n,render);};
 const output=render(tree);
 return {source:output,lowered:lowered>0,marker};
}

// JavaScript evaluation stays native. Track its lexical observations separately
// from platform API translation; library blocks are protected before this pass.
function evaluator(ix,n,seen=new Set()){
 if(['eval','Function'].some(name=>ix.free(n,name)))return n.name;
 if(n?.type==='MemberExpression'&&ix.free(n.object,'globalThis')&&['eval','Function'].includes(property(n)))return property(n);
 if(n?.type==='Identifier'){
  const b=ix.bindings.get(n);if(b?.init&&!b.writes.length&&!seen.has(b)){seen.add(b);return evaluator(ix,b.init,seen);}
 }
 return null;
}

export function checkNativeEvaluation(source){
 const ix=index(parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true})),calls=[];
 for(const call of ix.nodes){
  if(!['CallExpression','NewExpression'].includes(call.type))continue;
  const kind=evaluator(ix,call.callee);if(!kind)continue;
  const constructor=kind==='Function',direct=ix.free(call.callee,'eval');
  const args=constructor?call.arguments.slice(-1):call.arguments.slice(0,1);
  for(const arg of args){
   const text=arg.type==='Literal'&&typeof arg.value==='string'?arg.value:arg.type==='TemplateLiteral'&&!arg.expressions.length?arg.quasis[0].value.cooked:null;
   if(text===null)continue;
   const parameters=constructor?call.arguments.slice(0,-1).map(n=>n.type==='Literal'&&typeof n.value==='string'?n.value:null):[];
   if(parameters.includes(null))continue;
   let evaluated;try{evaluated=index(parse(constructor?'(function('+parameters.join(',')+'){'+text+'\n})':text,{ecmaVersion:'latest',allowReturnOutsideFunction:true}));}catch{continue;}
   const visible=name=>{if(!direct)return false;for(let scope=ix.scopes.get(call);scope;scope=scope.parent)if(scope.names.has(name))return true;return false;};
   const legacy=evaluated.nodes.filter(n=>evaluated.free(n)&&!visible(n.name)&&/^\$(?:request|response|done|notification|notify|task|httpClient|persistentStore|prefs|utils|script|environment|network|argument)$/.test(n.name));
   if(legacy.length)throw Error('动态 JavaScript 文本中包含待转换的旧平台 API：'+[...new Set(legacy.map(n=>n.name))].join(', ')+'；原生 eval/Function 本身保持不变');
  }
  calls.push({kind,line:source.slice(0,call.start).split('\n').length,
   preserved:true,limitations:'动态文本由 JavaScript 引擎原样执行；静态 API 分析不覆盖运行时生成的文本'});
 }
 return calls;
}

const evaluationCache=new WeakMap();
export function evaluationBindings(ix,source){
 if(evaluationCache.has(ix))return evaluationCache.get(ix);
 const observed=new Set();ix.evaluationReferences=new Map();
 if(!ix.nodes.some(n=>n.type==='CallExpression'&&ix.free(n.callee,'eval'))){evaluationCache.set(ix,observed);return observed;}
 // A closed JSON writer establishes a data-only input contract. Inspect that
 // provenance without replacing eval or changing object-literal semantics.
 const jsonCalls=new Set(source?(lowerStorageEvaluation(source,{inspectOnly:true}).evaluations??[]).map(n=>n.start):[]);
 const stringifiedCalls=new Set(source?(lowerJSONEvaluation(source,{inspectOnly:true}).evaluations??[]).map(n=>n.start):[]);
 for(const call of ix.nodes)if(call.type==='CallExpression'&&ix.free(call.callee,'eval')){
  if(jsonCalls.has(call.start))continue;
  const arg=call.arguments[0],text=arg?.type==='Literal'&&typeof arg.value==='string'?arg.value:arg?.type==='TemplateLiteral'&&!arg.expressions.length?arg.quasis[0].value.cooked:null;
  let references=stringifiedCalls.has(call.start)?new Set(['undefined']):null;
  if(text!==null)try{const nested=index(parse(text,{ecmaVersion:'latest',allowReturnOutsideFunction:true}));references=new Set(nested.nodes.filter(n=>nested.free(n)).map(n=>n.name));}catch{}
  const visible=new Set();
  for(let scope=ix.scopes.get(call);scope;scope=scope.parent)for(const [name,b]of scope.names){
   if(visible.has(name))continue;visible.add(name);
   if(references===null||references.has(name)){observed.add(b);if(!ix.evaluationReferences.has(b))ix.evaluationReferences.set(b,[]);ix.evaluationReferences.get(b).push(call);}
  }
 }
 evaluationCache.set(ix,observed);return observed;
}
