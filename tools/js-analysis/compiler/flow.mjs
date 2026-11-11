import {children,patch,renderTree,property,key,functions,initializedAfter,closedAsyncCompletionRoot,standardGlobals as builtin,index} from '../core/ast.mjs';
import {parse} from '../core/syntax.mjs';
import {valueFacts} from '../analysis/values.mjs';

// 唯一静态方法定义 + 唯一调用点，且方法体只做原型/属性设置后原样返回参数：
// 该调用对回调值而言是恒等包装。名字在整个封闭程序内必须唯一，避免同名方法
// 来自外部对象或发生重写。
export function closedIdentityMethodCall(ix,call,arg){
 const {nodes,parents,bindings,free}=ix;
 if(call?.type!=='CallExpression'||call.arguments.length!==1||call.arguments[0]!==arg)return false;
 const callee=call.callee;if(callee.type!=='MemberExpression')return false;
 const name=property(callee);if(name===undefined||name==='__proto__'||name==='constructor')return false;
 const definitions=[],uses=[],definitionMembers=new Set();
 for(const n of nodes){
  if(n.type==='AssignmentExpression'&&n.operator==='='&&n.left.type==='MemberExpression'&&property(n.left)===name&&functions.has(n.right?.type)){definitions.push(n.right);definitionMembers.add(n.left);}
  else if(n.type==='Property'&&n.kind==='init'&&key(n)===name&&functions.has(n.value?.type))definitions.push(n.value);
  else if(n.type==='MemberExpression'&&property(n)===name)uses.push(n);
 }
 if(definitions.length!==1||uses.length!==definitionMembers.size+1||uses.find(item=>!definitionMembers.has(item))!==callee)return false;
 const builtin=new Set(['Object','Array','JSON','Math','String','Number','Boolean','Promise','Error','Date','RegExp','Function','Symbol','Reflect','Map','Set','WeakMap','WeakSet','parseInt','parseFloat','isNaN','isFinite','encodeURI','decodeURI','encodeURIComponent','decodeURIComponent']);
 const local=n=>{
  if(!n)return false;
  if(n.type==='Literal')return true;
  if(n.type==='Identifier')return !!bindings.get(n)||builtin.has(n.name);
  if(n.type==='MemberExpression')return local(n.object)&&(!n.computed||n.property.type==='Literal');
  if(n.type==='CallExpression')return local(n.callee)&&!n.optional&&n.arguments.every(local);
  if(n.type==='SequenceExpression')return n.expressions.every(local);
  return false;
 };
 if(!local(callee.object))return false;
 const wrapper=definitions[0];
 if(wrapper.async||wrapper.generator||wrapper.params.length!==1||wrapper.params[0].type!=='Identifier')return false;
 const parameter=bindings.get(wrapper.params[0]);if(!parameter||parameter.writes.length)return false;
 const same=n=>n?.type==='Identifier'&&bindings.get(n)===parameter;
 const objectBuiltin=n=>n?.type==='MemberExpression'&&free(n.object,'Object')&&['setPrototypeOf','create','defineProperty','getPrototypeOf'].includes(property(n));
 const truth=n=>{
  if(n?.type==='Literal')return typeof n.value==='boolean'?n.value:null;
  if(n?.type==='UnaryExpression'&&n.operator==='!'){const value=truth(n.argument);return value===null?null:!value;}
  if(objectBuiltin(n))return true;
  return null;
 };
 const effect=n=>{
  if(n?.type==='AssignmentExpression'&&n.operator==='='&&n.left.type==='MemberExpression'&&same(n.left.object))return true;
  if(n?.type==='CallExpression'&&objectBuiltin(n.callee)&&!n.arguments.some(argument=>argument.type==='SpreadElement'))return property(n.callee)!=='create'||!n.arguments.some(argument=>!local(argument));
  if(n?.type==='SequenceExpression')return n.expressions.every(effect);
  if(n?.type==='ConditionalExpression'){const value=truth(n.test);if(value===true)return effect(n.consequent);if(value===false)return effect(n.alternate);return effect(n.consequent)&&effect(n.alternate);}
  return false;
 };
 const returnsParameter=n=>{
  if(same(n))return true;
  if(n?.type==='SequenceExpression')return n.expressions.slice(0,-1).every(effect)&&returnsParameter(n.expressions.at(-1));
  if(n?.type==='ConditionalExpression'){const value=truth(n.test);if(value===true)return returnsParameter(n.consequent);if(value===false)return returnsParameter(n.alternate);return returnsParameter(n.consequent)&&returnsParameter(n.alternate);}
  return false;
 };
 const statements=wrapper.body.type==='BlockStatement'?wrapper.body.body:[wrapper.body];
 return statements.length===1&&statements[0].type==='ReturnStatement'&&!!statements[0].argument&&returnsParameter(statements[0].argument);
}

// Structured early-return propagation for statically resolved bundled clients.
// Native payloads are stored only while unwinding ordinary JS helper calls;
// there is no legacy API object, thrown sentinel or async polling runtime.

export function structuredFlow({source,tree,ix,context,fresh,api,payload,isDone,compressionMethod,replyPrelude,extraAfter,substitutions,callTarget,isHTTP,httpStatement,isPromiseCall}){
 const {nodes,parents,bindings,owners,free}=ix,completion=fresh('completion'),overrides=new WeakMap();
 const done=new Set(),asyncAdded=new Set();
 const fail=(n,message)=>{throw Error(`结构化原生转换第 ${source.slice(0,n.start).split('\n').length} 行：${message}`);};
 function resolve(n,seen=new Set()){
  if(n?.type==='Identifier'){const b=bindings.get(n);if(b&&!b.writes.length&&!seen.has(b)&&(b.fn||b.init)){seen.add(b);return resolve(b.fn??b.init,seen);}}
  return n;
 }
 function targets(n,seen=new Set()){
  n=resolve(n,seen);if(functions.has(n?.type))return [n];
  if(n?.type==='AssignmentExpression'&&n.operator==='=')return targets(n.right,seen);
  if(n?.type==='SequenceExpression')return targets(n.expressions.at(-1),seen);
  if(n?.type==='Identifier'){
   const binding=bindings.get(n),writes=(binding?.writes??[]).filter(write=>write.type==='AssignmentExpression'&&write.operator==='='&&write.left.type==='Identifier'&&write.right!==n&&write.end<=n.start);
   if(writes.length&&!seen.has(binding)){
    const write=writes.reduce((a,b)=>a.start>b.start?a:b),ancestors=new Set();
    for(let current=write;current;current=parents.get(current))ancestors.add(current);
    let common=null;
    for(let current=n;current;current=parents.get(current))if(ancestors.has(current)){common=current;break;}
    let writeChild=write,referenceChild=n;
    if(common){while(parents.get(writeChild)!==common)writeChild=parents.get(writeChild);while(parents.get(referenceChild)!==common)referenceChild=parents.get(referenceChild);}
    // 必须能证明最后一次赋值在读取之前完成：同一序列、语句块或实参列表中
    // 位于左侧且没有更晚的写入。
    let ordered=false;
    if(common?.type==='SequenceExpression'){const a=common.expressions.indexOf(writeChild),b=common.expressions.indexOf(referenceChild);ordered=a>=0&&b>=0&&a<b;}
    else if(common?.type==='BlockStatement'||common?.type==='Program'){const a=common.body.indexOf(writeChild),b=common.body.indexOf(referenceChild);ordered=a>=0&&b>=0&&a<b;}
    else if(common?.type==='CallExpression'){const a=common.arguments.indexOf(writeChild),b=common.arguments.indexOf(referenceChild);ordered=a>=0&&b>=0&&a<b;}
    if(ordered){const next=new Set(seen);next.add(binding);const result=targets(write.right,next);return result;}
   }
  }
  if(n?.type==='CallExpression'&&n.callee.type==='MemberExpression'&&n.arguments.length===1&&closedIdentityMethodCall(ix,n,n.arguments[0]))return targets(n.arguments[0],seen);
  if(n?.type==='MemberExpression'){
   const object=resolve(n.object,new Set(seen));
   if(object?.type==='ObjectExpression'){
    const values=object.properties.filter(p=>p.type==='Property'&&p.kind==='init'&&(property(n)===undefined||key(p)===property(n)));
    return values.flatMap(p=>targets(p.value,new Set(seen)));
   }
  }
  const fn=callTarget?.(n);return fn?[fn]:[];
 }
 function promiseValue(n,seen=new Set()){
  if(!n||seen.has(n))return false;seen=new Set(seen);seen.add(n);
  if(isPromiseCall?.(n))return true;
  const resolved=resolve(n);if(resolved!==n)return promiseValue(resolved,seen);
  if(n.type==='AssignmentExpression'&&n.operator==='=')return promiseValue(n.right,seen);
  if(n.type==='SequenceExpression')return promiseValue(n.expressions.at(-1),seen);
  if(n.type==='ConditionalExpression')return promiseValue(n.consequent,seen)&&promiseValue(n.alternate,seen);
  if(n.type==='NewExpression'&&free(n.callee,'Promise'))return true;
  if(n.type!=='CallExpression')return false;
  if(n.callee.type==='MemberExpression'&&free(n.callee.object,'$task')&&property(n.callee)==='fetch')return true;
  if(n.callee.type==='MemberExpression'){
   if(free(n.callee.object,'Promise')&&['resolve','reject','all','allSettled','race','any','withResolvers'].includes(property(n.callee)))return true;
   if(['then','catch','finally'].includes(property(n.callee)))return promiseValue(n.callee.object,seen);
  }
  const fns=targets(n.callee);
  return fns.length>0&&fns.every(fn=>{
   if(fn.async)return true;
   if(fn.body.type!=='BlockStatement')return promiseValue(fn.body,seen);
   if(fn.body.body.at(-1)?.type!=='ReturnStatement')return false;
   const returns=nodes.filter(r=>r.type==='ReturnStatement'&&owners.get(r)===fn);
   return returns.length>0&&returns.every(r=>promiseValue(r.argument,seen));
  });
 }
 const executors=new Set(nodes.filter(n=>n.type==='NewExpression'&&free(n.callee,'Promise')&&n.arguments.length===1)
  .flatMap(n=>targets(n.arguments[0])).filter(fn=>!fn.async&&!fn.generator&&fn.params.every(p=>p.type==='Identifier')));
 const timerCallback=n=>n?.type==='CallExpression'&&free(n.callee,'setTimeout')&&[1,2].includes(n.arguments.length)&&targets(n.arguments[0]).length===1?targets(n.arguments[0])[0]:null;
 const executorHelpers=new Set(executors);
 let helpersChanged=true;while(helpersChanged){helpersChanged=false;for(const n of nodes)if(n.type==='CallExpression'&&executorHelpers.has(owners.get(n)))for(const fn of targets(n.callee))if(!fn.async&&!executorHelpers.has(fn)){executorHelpers.add(fn);helpersChanged=true;}}
 for(const n of nodes){if(isDone(n))done.add(owners.get(n));if(n.type==='CallExpression'&&compressionMethod(n.callee)&&!owners.get(n).async)asyncAdded.add(owners.get(n));}
 let changed=true;while(changed){changed=false;for(const n of nodes){
  if(n.type==='NewExpression'&&free(n.callee,'Promise')&&targets(n.arguments[0]).some(fn=>executors.has(fn)&&done.has(fn))&&!done.has(owners.get(n))){done.add(owners.get(n));changed=true;}
  if(n.type!=='CallExpression')continue;
  const candidates=targets(n.callee);
  if(n.callee.type==='MemberExpression'&&['then','catch','finally'].includes(property(n.callee))&&n.arguments.some(a=>targets(a).some(fn=>done.has(fn)))&&!done.has(owners.get(n))){done.add(owners.get(n));changed=true;}
  if(candidates.some(fn=>done.has(fn))&&!done.has(owners.get(n))){done.add(owners.get(n));changed=true;}
  if(isHTTP?.(n)&&targets(n.arguments[1]).some(fn=>done.has(fn))&&!done.has(owners.get(n))){done.add(owners.get(n));changed=true;}
  if(done.has(timerCallback(n))&&!done.has(owners.get(n))){done.add(owners.get(n));changed=true;}
  if(candidates.some(fn=>asyncAdded.has(fn)||fn.async&&done.has(fn))&&!executorHelpers.has(owners.get(n))&&!owners.get(n).async&&!asyncAdded.has(owners.get(n))){asyncAdded.add(owners.get(n));changed=true;}
  if(isHTTP?.(n)&&targets(n.arguments[1]).some(fn=>done.has(fn))&&!executorHelpers.has(owners.get(n))&&!owners.get(n).async&&!asyncAdded.has(owners.get(n))){asyncAdded.add(owners.get(n));changed=true;}
  if(n.callee.type==='MemberExpression'&&['then','catch','finally'].includes(property(n.callee))&&done.has(owners.get(n))&&!executorHelpers.has(owners.get(n))&&!asyncAdded.has(owners.get(n))){asyncAdded.add(owners.get(n));changed=true;}
 }}
 function closedCallback(call,arg,seen=new Set()){
  if(isHTTP?.(call)&&call.arguments[1]===arg)return true;
  if(closedIdentityMethodCall(ix,call,arg))return true;
  if(timerCallback(call)&&call.arguments[0]===arg)return true;
  if(call?.type==='NewExpression'&&free(call.callee,'Promise')&&call.arguments.length===1&&call.arguments[0]===arg)return targets(arg).length===1&&executors.has(targets(arg)[0]);
  const fns=targets(call?.callee),position=call?.arguments.indexOf(arg);
  return fns.length>0&&fns.every(fn=>{
   const param=fn.params[position],b=bindings.get(param?.type==='AssignmentPattern'?param.left:param);
   if(!b||b.writes.length||!b.refs.length||seen.has(b))return false;
   const next=new Set(seen);next.add(b);
   return b.refs.every(ref=>{const p=parents.get(ref);return p?.type==='CallExpression'&&(p.callee===ref||closedCallback(p,ref,next));});
  });
 }
 for(const n of nodes){
  if(n.type==='VariableDeclarator'&&n.id.type==='Identifier'&&(targets(n.init).some(fn=>done.has(fn)||asyncAdded.has(fn))||n.init?.type==='ObjectExpression'&&n.init.properties.some(p=>targets(p.value).some(fn=>done.has(fn)||asyncAdded.has(fn))))){
   const binding=bindings.get(n.id);
   if(binding?.writes.length)fail(n,'完成函数或分发表被重新赋值');
   if(n.init.type==='ObjectExpression'&&binding?.refs.some(r=>{const p=parents.get(r),q=parents.get(p);return !(p?.type==='ForInStatement'&&p.right===r||p?.type==='MemberExpression'&&p.object===r&&q?.type==='CallExpression'&&q.callee===p);}))fail(n,'完成函数分发表发生修改或逃逸');
  }
  if(n.type==='FunctionDeclaration'&&done.has(n)&&bindings.get(n.id)?.writes.length)fail(n,'完成函数被重新赋值');
  // wrap 状态机回调的返回值由 wrap/_invoke 消费，且状态参数可进入完成载荷；
  // “目标函数忽略返回值”不能成立，因此该族继续按未知回调拒绝。
  if(functions.has(n.type)&&(done.has(n)||asyncAdded.has(n))&&n.type!=='FunctionDeclaration'){
   const p=parents.get(n);
   if(!(p?.type==='CallExpression'&&(p.callee===n||closedCallback(p,n))||p?.type==='NewExpression'&&closedCallback(p,n)||p?.type==='VariableDeclarator'&&p.init===n||p?.type==='Property'&&p.value===n||p?.type==='MethodDefinition'&&p.value===n||p?.type==='SequenceExpression'&&p.expressions.at(-1)===n||p?.type==='CallExpression'&&p.callee.type==='MemberExpression'&&['then','catch','finally'].includes(property(p.callee))))fail(n,'内联完成函数传给未知回调');
  }
  if(free(n,'globalThis')){
   const p=parents.get(n);
   if(p?.type==='MemberExpression'&&p.object===n&&builtin.has(property(p)))continue;
   if(p?.type==='CallExpression'&&p.arguments.includes(n)){
    const fns=targets(p.callee),param=p.arguments.indexOf(n);
    if(fns.length===1){const fn=fns[0],b=bindings.get(fn.params[param]);if(b&&b.refs.every(r=>{const q=parents.get(r);return q?.type==='MemberExpression'&&q.object===r&&builtin.has(property(q));}))continue;}
   }
   fail(n,'全局对象访问超出可确认的标准 JavaScript 内建字段');
  }
  if(n.type==='Identifier'&&ix.reference(n)&&targets(n).some(fn=>done.has(fn)||asyncAdded.has(fn))){
   const p=parents.get(n);
   if(p?.type==='UnaryExpression'&&p.operator==='typeof')continue;
   if(p?.type==='CallExpression'&&p.callee===n||p?.type==='VariableDeclarator'&&p.init===n||p?.type==='Property'&&p.value===n)continue;
   if(p?.type==='CallExpression'&&p.callee.type==='MemberExpression'&&['then','catch','finally'].includes(property(p.callee)))continue;
   if(p?.type==='CallExpression'&&closedCallback(p,n))continue;
   if(p?.type==='NewExpression'&&closedCallback(p,n))continue;
   fail(n,'完成函数传给未知回调，无法短路调用者');
  }
 }
 // Preserve a root completion chain's launch point while trailing scalar
 // declarations or authored Date methods initialize synchronously.
 const completesChain=n=>n?.type==='CallExpression'&&(targets(n.callee).some(fn=>done.has(fn))||n.callee.type==='MemberExpression'&&['then','catch','finally'].includes(property(n.callee))&&(n.arguments.some(a=>targets(a).some(fn=>done.has(fn)))||completesChain(n.callee.object)));
 const rootChains=nodes.filter(n=>n.type==='CallExpression'&&owners.get(n)===tree&&n.callee.type==='MemberExpression'&&['then','catch','finally'].includes(property(n.callee))&&completesChain(n)&&parents.get(n)?.type==='ExpressionStatement');
 const scalarInitializer=n=>!n||n.type==='Literal'&&!n.regex||n.type==='ArrayExpression'&&n.elements.length===0||n.type==='UnaryExpression'&&['!','void','+','-','~'].includes(n.operator)&&scalarInitializer(n.argument)||['BinaryExpression','LogicalExpression'].includes(n.type)&&scalarInitializer(n.left)&&scalarInitializer(n.right);
 const scalarDeclaration=n=>n.type==='VariableDeclaration'&&n.declarations.every(d=>d.id.type==='Identifier'&&scalarInitializer(d.init));
 const prototypeSetup=n=>{
  const a=n.type==='ExpressionStatement'?n.expression:null,m=a?.left,p=m?.object;
  return a?.type==='AssignmentExpression'&&a.operator==='='&&functions.has(a.right.type)&&!done.has(a.right)&&!asyncAdded.has(a.right)&&m?.type==='MemberExpression'&&!m.computed&&p?.type==='MemberExpression'&&property(p)==='prototype'&&free(p.object,'Date')&&!['constructor','__proto__','toString','valueOf'].includes(property(m));
 };
 const stableDateReference=n=>{
  const p=parents.get(n);
  if(p?.type==='NewExpression'&&p.callee===n)return true;
  if(p?.type!=='MemberExpression'||p.object!==n)return false;
  if(property(p)==='now')return parents.get(p)?.type==='CallExpression'&&parents.get(p).callee===p;
  if(property(p)!=='prototype')return false;
  const member=parents.get(p),use=parents.get(member);
  if(member?.type!=='MemberExpression'||member.object!==p||typeof property(member)!=='string')return false;
  if(use?.type==='AssignmentExpression'&&use.left===member)return prototypeSetup(parents.get(use));
  return !(use?.type==='UpdateExpression'||use?.operator==='delete');
 };
 const setupStable=!nodes.some(n=>n.type==='MemberExpression'&&['getPrototypeOf','setPrototypeOf','defineProperty','defineProperties','__proto__'].includes(property(n))||n.type==='MemberExpression'&&['constructor','__defineGetter__','__defineSetter__','__lookupGetter__','__lookupSetter__'].includes(property(n))||free(n,'Reflect')||free(n,'Date')&&!stableDateReference(n));
 let deferred=null;
 if(rootChains.length===1&&setupStable){
  const call=rootChains[0];let child=parents.get(call),valid=true,setup=false;
  for(let p=parents.get(child);p;child=p,p=parents.get(p)){
   if(['Program','BlockStatement'].includes(p.type))for(const next of p.body.slice(p.body.indexOf(child)+1)){
    if(['FunctionDeclaration','EmptyStatement'].includes(next.type))continue;
    if(prototypeSetup(next)||scalarDeclaration(next))setup=true;else valid=false;
   }else if(p.type!=='IfStatement'){valid=false;break;}
  }
  if(valid&&setup)deferred={call,statement:parents.get(call),promise:fresh('pendingCompletion')};
 }
 function guard(owner){return `if (${completion}) ${owner===tree?'return '+completion+'.value;':'return;'}`;}
 function tail(n,asynchronous=false){
  if(deferred?.call===n)return true;
  let p=parents.get(n);
  while(p?.type==='UnaryExpression'&&['!','void'].includes(p.operator)){n=p;p=parents.get(n);}
  while(p?.type==='MemberExpression'&&['then','catch','finally'].includes(property(p))&&p.object===n){
   const call=parents.get(p);if(call?.type!=='CallExpression'||call.callee!==p)break;n=call;p=parents.get(n);
  }
  while(p?.type==='ConditionalExpression'&&p.test!==n||p?.type==='LogicalExpression'&&p.right===n||p?.type==='SequenceExpression'&&p.expressions.at(-1)===n){n=p;p=parents.get(n);}
  if(p?.type==='ReturnStatement')return true;
  if(p?.type!=='ExpressionStatement')return false;
  n=p;
  while((p=parents.get(n))){
   if(p.type==='Program'||p.type==='BlockStatement'){if(p.body.slice(p.body.indexOf(n)+1).some(s=>!['FunctionDeclaration','EmptyStatement'].includes(s.type)))return false;n=p;continue;}
   if(p.type==='TryStatement'&&asynchronous&&p.finalizer&&n!==p.finalizer&&p.finalizer.body.length)return false;
   if(p.type==='IfStatement'||p.type==='TryStatement'||p.type==='CatchClause'){n=p;continue;}
   return functions.has(p.type);
  }
  return true;
 }
 const asyncCompletionReceiver=n=>{let base=n;while(base?.type==='CallExpression'&&base.callee.type==='MemberExpression'&&['then','catch','finally'].includes(property(base.callee)))base=base.callee.object;return base?.type==='CallExpression'&&targets(base.callee).some(fn=>done.has(fn)&&(fn.async||asyncAdded.has(fn)));};
 const detachedCalls=new Set(nodes.filter(n=>n.type==='CallExpression'&&parents.get(n)?.type==='ExpressionStatement'&&(targets(n.callee).some(fn=>done.has(fn)&&(asyncAdded.has(fn)||fn.async))||asyncCompletionReceiver(n)&&promiseValue(n)||closedAsyncCompletionRoot(ix,n,fn=>done.has(fn))&&promiseValue(n))&&!tail(n,true)));
 const detachedHTTP=new Set(nodes.filter(n=>n.type==='CallExpression'&&parents.get(n)?.type==='ExpressionStatement'&&isHTTP?.(n)&&targets(n.arguments[1]).some(fn=>done.has(fn))&&!tail(n,true)));
 const executorCompletion=[...executors].some(fn=>done.has(fn));
 const concurrent=executorCompletion||nodes.some(n=>done.has(timerCallback(n)))||detachedCalls.size>0||detachedHTTP.size>0;
 if(concurrent&&nodes.some(n=>n.type==='Identifier'&&n.name==='Promise'&&bindings.has(n)))fail(tree,'并发完成传播依赖标准 Promise，局部 Promise 绑定尚未证明');
 if(concurrent&&nodes.some(n=>{
  if(!free(n,'Promise'))return false;
  const p=parents.get(n),call=parents.get(p);
  if(p?.type==='NewExpression'&&p.callee===n||p?.type==='UnaryExpression'&&p.operator==='typeof')return false;
  return !(p?.type==='MemberExpression'&&p.object===n&&['resolve','reject','all','allSettled','race','any','withResolvers'].includes(property(p))&&call?.type==='CallExpression'&&call.callee===p);
 }))fail(tree,'并发完成传播依赖标准 Promise，构造器修改或逃逸尚未证明');
 const finish=concurrent?fresh('finishNative'):null,reject=concurrent?fresh('rejectNative'):null,finished=concurrent?fresh('nativeResult'):null;
 const awaitValue=code=>executorCompletion?`await Promise.race([${code}, ${finished}])`:`await ${code}`;
 function raw(n){return substitutions.has(n)?substitutions.get(n):api(n);}
 function render(n){return overrides.has(n)?overrides.get(n):statementTypes.has(n.type)?statement(n):expression(n).code;}
 const result=(code,before=[])=>({code,before});
 const statementTypes=new Set(['Program','BlockStatement','ExpressionStatement','VariableDeclaration','ReturnStatement','ThrowStatement','IfStatement','TryStatement','ForStatement','ForInStatement','ForOfStatement','WhileStatement','DoWhileStatement','SwitchStatement','BreakStatement','ContinueStatement','EmptyStatement','FunctionDeclaration','LabeledStatement']);
 function expression(n,owner=owners.get(n),wait=false,deferPromise=false){
  if(!n)return result('');
  if(functions.has(n.type))return result(functionText(n));
  if(n.type==='AwaitExpression'){const e=expression(n.argument,owner,true);if(!concurrent)return e;const value=fresh('awaitedValue');return result(value,[...e.before,`const ${value} = ${e.code};`,guard(owner)]);}
  if(n.type==='CallExpression'&&isDone(n)){
   // Payload shapes and API fields still go through the same native mapper.
   const v=n.arguments[0],prefix=[];
   if(v){const e=expression(v,owner);prefix.push(...e.before);substitutions.set(v,e.code);}
   return result('undefined',[...prefix,`${completion} = {value: ${payload(v)}};`,...(concurrent?[`${finish}(${completion}.value);`]:[]),owner===tree?`return ${completion}.value;`:'return;']);
  }
  if(n.type==='SequenceExpression'){
   const before=[];for(const part of n.expressions.slice(0,-1)){const e=expression(part,owner);before.push(...e.before,'('+e.code+');');}
   const last=expression(n.expressions.at(-1),owner);return result(last.code,[...before,...last.before]);
  }
  if(n.type==='LogicalExpression'){
   const a=expression(n.left,owner),b=expression(n.right,owner);
   if(!b.before.length){substitutions.set(n.left,a.code);substitutions.set(n.right,b.code);return result(raw(n),a.before);}
   const value=fresh('value'),test=n.operator==='&&'?value:n.operator==='||'?'!'+value:`${value} == null`;
   return result(value,[...a.before,`let ${value} = ${a.code};`,`if (${test}) {${b.before.join('\n')}\n${value} = ${b.code};}`]);
  }
  if(n.type==='ConditionalExpression'){
   const test=expression(n.test,owner),yes=expression(n.consequent,owner),no=expression(n.alternate,owner);
   if(!yes.before.length&&!no.before.length){substitutions.set(n.test,test.code);substitutions.set(n.consequent,yes.code);substitutions.set(n.alternate,no.code);return result(raw(n),test.before);}
   const value=fresh('value');return result(value,[...test.before,`let ${value};`,`if (${test.code}) {${yes.before.join('\n')}\n${value}=${yes.code};} else {${no.before.join('\n')}\n${value}=${no.code};}`]);
  }
  if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&['then','catch','finally'].includes(property(n.callee))&&done.has(owner))return promise(n,owner,wait);
  if(n.type==='MemberExpression'&&free(n.object,'$utils'))return result(raw(n));
  const opaqueCallee=n.type==='CallExpression'&&(n.callee.type==='MemberExpression'&&free(n.callee.object)&&['$notification','$utils','$persistentStore','$prefs','$task','$httpClient'].includes(n.callee.object.name)||n.callee.type==='Identifier'&&free(n.callee,'$log'));
  const parts=children(n).filter(([field,c])=>(!opaqueCallee||field!=='callee')&&(!['Property','MethodDefinition'].includes(n.type)||c===n.value||n.computed)).map(([field,c])=>({field,node:c,value:expression(c,owner)}));
  // 纯读取的接收者没有求值顺序副作用，参数中的完成副作用可以先展开。
  const simpleReference=node=>node.type==='Identifier'||node.type==='ThisExpression'||node.type==='MemberExpression'&&!node.optional&&property(node)!==undefined&&simpleReference(node.object);
  const before=[];
  for(let i=0;i<parts.length;i++){
   const p=parts[i];before.push(...p.value.before);
   let code=p.value.code;
   if(parts.slice(i+1).some(x=>x.value.before.length)&&!['Literal','FunctionExpression','ArrowFunctionExpression'].includes(p.node.type)){
    if(n.type==='AssignmentExpression'&&n.operator==='='&&p.field==='left'&&['Identifier','ArrayPattern','ObjectPattern'].includes(p.node.type)){substitutions.set(p.node,code);continue;}
    if(n.type==='CallExpression'&&p.field==='callee'){if(simpleReference(p.node))continue;fail(n,'复杂接收者与完成参数交错，需先确定求值顺序');}
    if(n.type==='AssignmentExpression'&&p.field==='left'){if(p.node.type==='Identifier'||p.node.type==='MemberExpression'&&simpleReference(p.node.object))continue;fail(n,'复杂接收者与完成参数交错，需先确定求值顺序');}
    const saved=fresh('value');before.push(`const ${saved} = ${code};`);code=saved;
   }
   substitutions.set(p.node,code);
  }
  let code=raw(n);
  // Evaluate a Promise receiver before attaching handlers. A synchronous error
  // creating it is not a rejection of that Promise.
  if(deferPromise)return result(code,before);
  if(n.type==='CallExpression'){
   if(done.has(timerCallback(n))){
    const callback=n.arguments[0],args=fresh('timerArguments'),error=fresh('timerError');
    substitutions.set(callback,`(...${args}) => {if (${completion}) return;try {Promise.resolve((${raw(callback)})(...${args})).catch(${reject});} catch (${error}) {${reject}(${error});}}`);
    return result(raw(n),before);
   }
   const candidates=targets(n.callee),completing=candidates.some(fn=>done.has(fn)),newAsync=candidates.some(fn=>asyncAdded.has(fn));
   // Await lifted value calls in-place: JavaScript preserves receiver and
   // assignment-reference evaluation order across await without temporaries.
   if(newAsync&&!completing)return result('('+awaitValue(code)+')',before);
   if(detachedCalls.has(n))return result('void ('+code+').catch('+reject+')',before);
   if(completing||newAsync){
    if(completing&&(newAsync||candidates.some(fn=>fn.async))&&!wait&&!tail(n,true))fail(n,'未等待的异步完成任务后仍有执行路径，不能串行化原有并发');
    const async=wait||newAsync||candidates.some(fn=>fn.async);
    const value=fresh('callResult');before.push(`const ${value} = ${async?awaitValue(code):code};`);
    if(completing)before.push(guard(owner));
    return result(value,before);
   }
  }
  return result(wait?awaitValue(code):code,before);
 }
 function functionText(n){
  if(!(concurrent&&n.async)&&![...done,...asyncAdded].some(fn=>fn&&fn.start>=n.start&&fn.end<=n.end)&&!nodes.some(c=>c.start>=n.start&&c.end<=n.end&&c.type==='CallExpression'&&targets(c.callee).some(fn=>asyncAdded.has(fn))))return api(n);
  const prelude=(concurrent&&(done.has(n)||n.async)?`if (${completion}) return;\n`:'')+replyPrelude(n),body=n.body.type==='BlockStatement'?statement(n.body):'{'+line(expression(n.body,n),true)+'}';
  let head=patch(source,{...n,body:null,end:n.body.start},render);
  if(n.body.type!=='BlockStatement')head=head.slice(0,head.lastIndexOf('=>')+2)+' ';
  if(executorHelpers.has(n)&&(asyncAdded.has(n)||hasPromiseCompletion(n)||prelude.includes('await ')))fail(n,'Promise 执行器需要异步提升，不能改变同步执行器契约');
  const method=parents.get(n)?.type==='MethodDefinition'||parents.get(n)?.type==='Property'&&parents.get(n).method;
  if((asyncAdded.has(n)||hasPromiseCompletion(n)||prelude.includes('await '))&&!n.async&&!method)head='async '+head;
  return head+(prelude?'{'+prelude+'\n'+body.slice(1,-1)+'}':body);
 }
 function hasPromiseCompletion(fn){return nodes.some(n=>owners.get(n)===fn&&n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&['then','catch','finally'].includes(property(n.callee))&&done.has(fn));}
 function line(e,ret=false){return e.before.join('\n')+(e.code==='undefined'&&e.before.length?'':'\n'+(ret?'return ':'')+(!ret&&/^\s*(?:function\b|async\s+function\b|class\b|\{)/.test(e.code)?'('+e.code+')':e.code)+';');}
 function asBlock(n){const text=statement(n);return n.type==='BlockStatement'?text:'{'+text+'}';}
 function httpCallStatement(call,owner){
  const callback=call.arguments[1],fn=targets(callback)[0];
  if(done.has(fn)&&!tail(call,true)&&!detachedHTTP.has(call))fail(call,'未等待的 HTTP 完成任务后仍有执行路径，不能串行化原有并发');
  if(fn)substitutions.set(callback,functionText(fn));
  return httpStatement(call,guard(owner),executorCompletion&&executorHelpers.has(owner)||detachedHTTP.has(call)||concurrent&&!done.has(fn)?{completion,reject}:null);
 }
 function statement(n){
  const owner=owners.get(n);
  if(n.type==='Program'||n.type==='BlockStatement'){
   let position=n.type==='Program'?(n.body[0]?.start??n.end):n.start+1,body='';
   for(const child of n.body){body+=source.slice(position,child.start)+'\n'+statement(child);position=child.end;}
   body+=source.slice(position,n.type==='Program'?n.end:n.end-1);return n.type==='Program'?body:'{'+body+'}';
  }
  if(n.type==='FunctionDeclaration')return functionText(n);
  if(n.type==='ExpressionStatement'){
   if(deferred?.statement===n)return `{${deferred.promise} = (async () => {${line(expression(n.expression,owner))}})();${guard(owner)}}`;
   if(n.expression.type==='SequenceExpression'){
    const flatten=node=>node.type==='SequenceExpression'?node.expressions.flatMap(flatten):[node],parts=flatten(n.expression),calls=parts.filter(part=>isHTTP?.(part));
    if(calls.length){
     if(calls.length!==1||parts.at(-1)!==calls[0])fail(n,'HTTP 请求位于有后续求值的逗号表达式中，无法保持完成顺序');
     return parts.map(part=>part===calls[0]?httpCallStatement(part,owner):line(expression(part,owner))).join('\n');
    }
   }
   if(isHTTP?.(n.expression)){
    return httpCallStatement(n.expression,owner);
   }
   return line(expression(n.expression,owner));
  }
  if(n.type==='ReturnStatement'){
   if(isHTTP?.(n.argument)){
    const callback=n.argument.arguments[1],fn=targets(callback)[0];
    if(fn)substitutions.set(callback,functionText(fn));
    return httpStatement(n.argument,guard(owner))+'\nreturn;';
   }
   return n.argument?line(expression(n.argument,owner),true):'return;';
  }
  if(n.type==='ThrowStatement'){const e=expression(n.argument,owner);return e.before.join('\n')+'\nthrow '+e.code+';';}
  if(n.type==='VariableDeclaration'){
   const lines=[];for(const d of n.declarations){const e=expression(d.init,owner);lines.push(...e.before,`${n.kind} ${source.slice(d.id.start,d.id.end)}${d.init?' = '+e.code:''};`);const extra=extraAfter.get(d)?.();if(extra)lines.push(extra);}return lines.join('\n');
  }
  if(n.type==='IfStatement'){const e=expression(n.test,owner);return e.before.join('\n')+`\nif (${e.code}) ${asBlock(n.consequent)}`+(n.alternate?' else '+asBlock(n.alternate):'');}
  if(n.type==='TryStatement'){
   let code='try '+asBlock(n.block);
   if(n.handler)code+=' catch'+(n.handler.param?' ('+source.slice(n.handler.param.start,n.handler.param.end)+')':'')+' '+asBlock(n.handler.body);
   if(n.finalizer)code+=` finally {if (!${completion}) ${asBlock(n.finalizer)}}`;
   return code;
  }
  if(n.type==='ForInStatement'||n.type==='ForOfStatement'){
   const e=expression(n.right,owner),left=n.left.type==='VariableDeclaration'?source.slice(n.left.start,n.left.end):expression(n.left,owner).code;
   return e.before.join('\n')+`\nfor ${n.await?'await ':''}(${left} ${n.type==='ForInStatement'?'in':'of'} ${e.code}) ${asBlock(n.body)}`;
  }
  if(n.type==='ForStatement'||n.type==='WhileStatement'||n.type==='DoWhileStatement'){
   for(const part of [n.init,n.test,n.update])if(part){
    if(nodes.some(x=>x.start>=part.start&&x.end<=part.end&&x.type==='CallExpression'&&(isDone(x)||compressionMethod(x.callee)||targets(x.callee).some(fn=>done.has(fn)))))fail(part,'循环控制表达式含完成操作');
    overrides.set(part,api(part));
   }
   overrides.set(n.body,asBlock(n.body));return patch(source,n,render);
  }
  if(n.type==='SwitchStatement'){
   const e=expression(n.discriminant,owner),cases=n.cases.map(c=>{
    const label=c.test?expression(c.test,owner):null;if(label?.before.length)fail(c,'switch 标签含完成操作');
    return (label?'case '+label.code:'default')+':'+c.consequent.map(statement).join('\n');
   });return e.before.join('\n')+`\nswitch (${e.code}) {${cases.join('\n')}}`;
  }
  if(['BreakStatement','ContinueStatement','EmptyStatement'].includes(n.type))return source.slice(n.start,n.end);
  if(n.type==='LabeledStatement')return n.label.name+':'+statement(n.body);
  return expression(n,owner).code;
 }
 function opaquePromiseCallback(n,seen=new Set()){
  const value=resolve(n);if(value!==n){if(seen.has(value))return false;seen=new Set(seen);seen.add(value);return opaquePromiseCallback(value,seen);}
  if(n?.type==='Literal'||n?.type==='TemplateLiteral'||free(n,'undefined'))return true;
  if(n?.type==='BinaryExpression'&&n.operator==='+'&&(n.left.type==='Literal'&&typeof n.left.value==='string'||n.right.type==='Literal'&&typeof n.right.value==='string'||opaquePromiseCallback(n.left,seen)&&n.left.type==='BinaryExpression'))return true;
  if(n?.type==='MemberExpression'&&free(n.object,'console')&&['log','error','warn','info','debug'].includes(property(n)))return nodes.filter(r=>free(r,'console')).every(r=>{const m=parents.get(r),use=parents.get(m);return m?.type==='MemberExpression'&&property(m)!==undefined&&!(use?.type==='AssignmentExpression'&&use.left===m||use?.type==='UpdateExpression'||use?.operator==='delete');});
  return false;
 }
 function promise(n,owner,wait){
  const chain=[];let base=n;
  while(base.type==='CallExpression'&&base.callee.type==='MemberExpression'&&['then','catch','finally'].includes(property(base.callee))){
   const method=property(base.callee);
   if(base.arguments.length!==1&&!(method==='then'&&base.arguments.length===2))fail(base,'Promise 完成回调必须是一个可解析函数');
   const callbacks=base.arguments.map(argument=>{
    const candidates=targets(argument);
    if(candidates.length!==1){if(!candidates.length&&opaquePromiseCallback(argument))return {fn:null,argument,opaque:true};fail(base,'Promise 完成回调必须是一个可解析函数');}
    if(!functions.has(argument.type)&&!callbackReference(argument))fail(base,'Promise 回调引用必须在注册前完成初始化且不可变');
    return {fn:candidates[0],argument};
   });
   chain.unshift({method,...callbacks[0],rejected:callbacks[1]});base=base.callee.object;
  }
  // Completion elsewhere in a function does not make every ordinary Promise
  // chain a completion chain. Preserve its callbacks, rejection and concurrency.
  const baseCompletes=base.type==='CallExpression'&&targets(base.callee).some(fn=>done.has(fn));
  if(!baseCompletes&&!chain.some(c=>done.has(c.fn)||c.rejected&&done.has(c.rejected.fn))){
   const initial=expression(base,owner),code=chain.reduce((text,c)=>text+'.'+c.method+'('+callbackText(c)+(c.rejected?','+callbackText(c.rejected):'')+')',initial.code);
   return result(wait?awaitValue(code):code,initial.before);
  }
  if(detachedCalls.has(n)){
   const initial=expression(base,owner,false,true);
   const handler=callback=>{const fn=fresh('promiseCallback'),args=fresh('promiseArguments');return `((${fn}) => typeof ${fn} === 'function' ? (...${args}) => {if (${completion}) return;return ${fn}(...${args});} : ${fn})(${callbackText(callback)})`;};
   const code=chain.reduce((text,c)=>text+'.'+c.method+'('+handler(c)+(c.rejected?','+handler(c.rejected):'')+')',initial.code);
   return result('void ('+code+').catch('+reject+')',initial.before);
  }
  if(parents.get(n)?.type!=='AwaitExpression'&&!tail(n,true))fail(n,'未等待的 Promise 完成链后仍有执行路径');
  const order=chain.map(x=>x.method).join(',');
  if(!promiseValue(base))fail(base,'Promise 完成链接收者没有可证明的 Promise 契约');
  if(chain.some(c=>c.opaque||c.rejected?.opaque)||!['then','then,catch','then,finally','then,catch,finally','catch,finally','finally','catch'].includes(order)){
   // Keep arbitrarily repeated native Promise steps in authored order. The
   // guards suppress later handlers only after legacy completion has ended the
   // script; rejection routing and finally's value preservation remain JS.
   const initial=expression(base,owner,false,true),value=fresh('promiseValue');
   const handler=callback=>{const args=fresh('promiseArguments');if(callback.opaque){const fn=fresh('promiseCallback');return `((${fn}) => typeof ${fn} === 'function' ? (...${args}) => {if (${completion}) return;return ${fn}(...${args});} : ${fn})(${callbackText(callback)})`;}return `(...${args}) => {if (${completion}) return;return (${callbackText(callback)})(...${args});}`;};
   const code=chain.reduce((text,c)=>text+'.'+c.method+'('+handler(c)+(c.rejected?','+handler(c.rejected):'')+')',initial.code);
   return result(value,[...initial.before,`const ${value} = ${awaitValue('('+code+')')};`,guard(owner)]);
  }
  const value=fresh('promiseValue'),error=fresh('promiseError');
  function invoke(callback,arg,assign=true){const call=awaitValue(`(${callbackText(callback)})(${arg??''})`);return `${assign?value+' = ':''}${call};\n${guard(owner)}`;}
  const then=chain.find(c=>c.method==='then'),caught=chain.find(c=>c.method==='catch'),final=chain.find(c=>c.method==='finally');
  const rejected=then?.rejected,initial=expression(base,owner,!rejected,!!rejected);
  const start=`${initial.before.join('\n')}\n${value} = ${initial.code};\n${guard(owner)}`;
  // The second then argument handles only rejection of the receiver. Errors
  // thrown by onFulfilled belong to the subsequent catch, never onRejected.
  const failed=rejected?fresh('promiseRejected'):null,pending=rejected?fresh('promiseReceiver'):null;
  const body=rejected?`let ${failed} = false;\ntry {${value} = ${awaitValue(pending)};} catch (${error}) {${failed} = true; ${value} = ${error};}\n${guard(owner)}\nif (${failed}) {${invoke(rejected,value)}} else {${invoke(then,value)}}`:`${start}\n${then?invoke(then,value):''}`;
  const setup=rejected?[...initial.before,`const ${pending} = ${initial.code};`]:[];
  return result(value,[...setup,`let ${value};`,caught||final?`try {${body}}${caught?` catch (${error}) {${invoke(caught,error)}}`:''}${final?` finally {if (!${completion}) {${invoke(final,undefined,false)}}}`:''}`:body]);
 }
 function callbackText(callback){return functions.has(callback.argument.type)?functionText(callback.fn):api(callback.argument);}
 function callbackReference(n,seen=new Set()){
  if(n?.type!=='Identifier')return false;
  const b=bindings.get(n);if(!b||b.writes.length||seen.has(b)||!b.init)return false;
  if(b.init.type==='FunctionDeclaration')return true;
  const d=parents.get(b.init),statement=parents.get(d),block=parents.get(statement);
  if(d?.type!=='VariableDeclarator'||statement?.type!=='VariableDeclaration')return false;
  let at=n;while(parents.get(at)&&parents.get(at)!==block)at=parents.get(at);
  const after=owners.get(n)===owners.get(statement)&&parents.get(at)===block&&at.start>=statement.end||block?.type==='Program'&&initializedAfter(ix,statement,n);
  if(!after)return false;
  return functions.has(b.init.type)||b.init.type==='Identifier'&&callbackReference(b.init,new Set([...seen,b]));
 }
 const rendered=statement(tree);
 return {body:rendered+(deferred?`\nif (${deferred.promise} !== undefined) {await ${deferred.promise};${guard(tree)}}`:'')+(concurrent?`\nreturn await ${finished};`:''),prefix:`let ${completion};${concurrent?`let ${finish}, ${reject};const ${finished} = new Promise((resolve,reject) => {${finish}=resolve;${reject}=reject;});`:''}${deferred?`let ${deferred.promise};`:''}`,render,raw:substitutions,done};
}

// Expand discarded statement expressions before native return propagation.
// Never rewrite completion calls inside arguments, assignments or used values.

export function completionStatements(source){
 const comments=[];
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true,onComment:comments}),ix=index(tree);
 const done=n=>n?.type==='CallExpression'&&ix.free(n.callee,'$done');
 const http=n=>n?.type==='CallExpression'&&n.callee.type==='MemberExpression'&&ix.free(n.callee.object,'$httpClient')&&['get','post','put','delete','head','options','patch'].includes(property(n.callee));
 const containment=new WeakMap();
 function contains(root){
  if(!root)return false;
  const stack=[{node:root,state:0}];
  while(stack.length){
   const frame=stack.at(-1),n=frame.node;
   if(containment.has(n)){stack.pop();continue;}
   if(!frame.state){
    if(done(n)||http(n)){containment.set(n,true);stack.pop();continue;}
    frame.children=n.type==='SequenceExpression'?n.expressions:n.type==='ConditionalExpression'?[n.test,n.consequent,n.alternate]:n.type==='LogicalExpression'&&['&&','||'].includes(n.operator)?[n.left,n.right]:[];
    frame.state=1;
    for(let i=frame.children.length-1;i>=0;i--){const child=frame.children[i];if(child&&!containment.has(child))stack.push({node:child,state:0});}
    continue;
   }
   const has=node=>!!node&&containment.get(node)===true;
   const result=n.type==='SequenceExpression'?n.expressions.some(has):n.type==='ConditionalExpression'?!has(n.test)&&(has(n.consequent)||has(n.alternate)):n.type==='LogicalExpression'&&['&&','||'].includes(n.operator)?!has(n.left)&&has(n.right):false;
   containment.set(n,result);stack.pop();
  }
  return containment.get(root)===true;
 }
 function flowNodes(root,mode){
  const result=[],pending=[root];
  while(pending.length){
   const n=pending.pop();
   if(mode==='statement'&&n.type==='SequenceExpression'){for(let i=n.expressions.length-1;i>=0;i--)pending.push(n.expressions[i]);continue;}
   if(mode==='return'&&n.type==='ConditionalExpression'&&contains(n)||mode==='statement'&&n.type==='ConditionalExpression'&&contains(n)){
    result.push(n.test);pending.push(n.alternate,n.consequent);continue;
   }
   if(mode==='statement'&&n.type==='LogicalExpression'&&contains(n)){result.push(n.left);pending.push(n.right);continue;}
   result.push(n);
  }
  return result;
 }
 function flowText(root,child,mode){
  const output=[],pending=[{kind:'node',node:root}];
  while(pending.length){
   const task=pending.pop();if(task.kind==='text'){output.push(task.value);continue;}
   const n=task.node;
   if(mode==='return'&&n.type==='ConditionalExpression'&&contains(n)){
    pending.push({kind:'text',value:'}'},{kind:'node',node:n.alternate},{kind:'text',value:'} else {'},{kind:'node',node:n.consequent},{kind:'text',value:`if (${child(n.test)}) {`});continue;
   }
   if(mode==='return'){output.push('return '+child(n)+';');continue;}
   if(n.type==='SequenceExpression'){
    for(let i=n.expressions.length-1;i>=0;i--){pending.push({kind:'node',node:n.expressions[i]});if(i)pending.push({kind:'text',value:'\n'});}continue;
   }
   if(n.type==='ConditionalExpression'&&contains(n)){
    pending.push({kind:'text',value:'}'},{kind:'node',node:n.alternate},{kind:'text',value:'} else {'},{kind:'node',node:n.consequent},{kind:'text',value:`if (${child(n.test)}) {`});continue;
   }
   if(n.type==='LogicalExpression'&&contains(n)){
    pending.push({kind:'text',value:'}'},{kind:'node',node:n.right},{kind:'text',value:`if (${n.operator==='||'?'!('+child(n.left)+')':child(n.left)}) {`});continue;
   }
   output.push(child(n)+';');
  }
  return output.join('');
 }
 return renderTree(source,tree,n=>{
  if(n.type==='ReturnStatement'&&n.argument?.type==='ConditionalExpression'&&contains(n.argument)&&!comments.some(c=>c.start>=n.start&&c.end<=n.end)){
   const argument=n.argument;return {children:flowNodes(argument,'return'),render:child=>'{'+flowText(argument,child,'return')+'}'};
  }
  if(n.type==='ExpressionStatement'&&n.expression.type==='UnaryExpression'&&['!','void'].includes(n.expression.operator)&&!comments.some(c=>c.start>=n.start&&c.end<=n.end&&(c.start<n.expression.argument.start||c.end>n.expression.argument.end))){
   const argument=n.expression.argument;return {children:[argument],render:child=>'{('+child(argument)+');}'};
  }
  if(n.type==='ExpressionStatement'&&contains(n.expression)&&!done(n.expression)&&!http(n.expression)&&!comments.some(c=>c.start>=n.start&&c.end<=n.end)){
   const expression=n.expression;return {children:flowNodes(expression,'statement'),render:child=>'{'+flowText(expression,child,'statement')+'}'};
  }
  return null;
 });
}

// A single root task may start before trailing scalar initializers. Awaiting
// at its call site would change what that task observes after its first await.
// Keep the start point and defer only the final join; reject multiple tasks or
// unproved work after launch. Reviewed synchronous tails keep their original
// position; a synchronous completion stops them before the final join.
export function pendingCompletion(ix,complete,asyncFns,target){
 const {nodes,parents,owners}=ix,tree=nodes[0],calls=new Set();
 const pure=n=>!n||n.type==='Literal'&&!n.regex||n.type==='UnaryExpression'&&['!','void','+','-','~'].includes(n.operator)&&pure(n.argument)||['BinaryExpression','LogicalExpression'].includes(n.type)&&pure(n.left)&&pure(n.right);
 const prototypeInitializer=s=>{
  const a=s?.type==='ExpressionStatement'?s.expression:null,l=a?.left,r=a?.right;
  if(a?.type!=='AssignmentExpression'||a.operator!=='='||l?.type!=='MemberExpression'||l.object.type!=='Identifier'||property(l)!=='prototype'||r?.type!=='ObjectExpression'||r.properties.length!==1)return false;
  const b=ix.bindings.get(l.object),p=r.properties[0];
  return b?.init?.type==='FunctionDeclaration'&&!b.writes.length&&p.type==='Property'&&p.kind==='init'&&key(p)==='constructor'&&p.value.type==='Identifier'&&ix.bindings.get(p.value)===b;
 };
 const facts=valueFacts(ix),standard=new Set(['Math','String','Number','console']);
 const ordinaryCalls=new Set(['abs','ceil','floor','round','random','min','max','pow','trunc','fromCharCode','fromCodePoint','log','warn','error','info','debug','toFixed','toPrecision','toExponential','toString']);
 const builtinsModified=nodes.some(n=>{
  if(n.type==='MemberExpression'&&['prototype','__proto__',...ordinaryCalls].includes(property(n))){const p=parents.get(n);if(['prototype','__proto__'].includes(property(n))||p?.type==='AssignmentExpression'&&p.left===n||p?.type==='UpdateExpression'||p?.operator==='delete')return true;}
  return n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&ix.free(n.callee.object,'Object')&&['assign','setPrototypeOf','defineProperty','defineProperties'].includes(property(n.callee));
 });
 const globalsStable=!builtinsModified&&nodes.filter(n=>ix.free(n)&&standard.has(n.name)).every(n=>{let m=n;while(parents.get(m)?.type==='MemberExpression'&&parents.get(m).object===m)m=parents.get(m);const p=parents.get(m);return p?.type==='CallExpression'&&p.callee===m;});
 // ToPrimitive can invoke arbitrary user code, including another async task.
 // Prove operands and arguments are scalars before treating the tail as sync.
 function scalar(n,seen=new Set()){
  if(!n||n.type==='Literal'&&!n.regex||ix.free(n)&&['undefined','NaN','Infinity'].includes(n.name))return true;
  if(seen.has(n))return false;seen=new Set(seen);seen.add(n);
  if(n.type==='Identifier'){
   const b=ix.bindings.get(n);if(!b||seen.has(b))return false;seen.add(b);
   if(b.init)return scalar(b.init,seen)&&b.writes.every(w=>w.type==='UpdateExpression'||w.type==='AssignmentExpression'&&w.left.type==='Identifier'&&ix.bindings.get(w.left)===b&&scalar(w.right,seen));
   const fn=nodes.find(fn=>functions.has(fn.type)&&fn.params.some(p=>ix.bindings.get(p.type==='AssignmentPattern'?p.left:p)===b));
   if(!fn||b.writes.length)return false;
   const pos=fn.params.findIndex(p=>ix.bindings.get(p.type==='AssignmentPattern'?p.left:p)===b),id=fn.id??(parents.get(fn)?.type==='VariableDeclarator'?parents.get(fn).id:null),fb=id?ix.bindings.get(id):null;
   return !!fb&&!fb.writes.length&&fb.refs.length>0&&fb.refs.every(ref=>{const call=parents.get(ref);if(call?.type!=='CallExpression'||call.callee!==ref||call.arguments.some(a=>a.type==='SpreadElement'))return false;const value=call.arguments[pos],fallback=fn.params[pos].type==='AssignmentPattern'?fn.params[pos].right:null;return scalar(!value||ix.free(value,'undefined')?fallback:value,seen);});
  }
  if(n.type==='UnaryExpression')return ['!','void','typeof'].includes(n.operator)||scalar(n.argument,seen);
  if(['BinaryExpression','LogicalExpression'].includes(n.type))return scalar(n.left,seen)&&scalar(n.right,seen);
  if(n.type==='ConditionalExpression')return scalar(n.consequent,seen)&&scalar(n.alternate,seen);
  if(n.type==='TemplateLiteral')return n.expressions.every(x=>scalar(x,seen));
  if(n.type==='MemberExpression')return property(n)==='length'&&scalar(n.object,seen);
  if(n.type==='CallExpression'){
   if(n.optional||n.arguments.some(a=>!scalar(a,seen)))return false;
   const fn=target(n.callee);
   if(fn){if(fn.async||fn.generator||seen.has(fn))return false;const next=new Set(seen);next.add(fn);const results=fn.body.type==='BlockStatement'?nodes.filter(r=>r.type==='ReturnStatement'&&owners.get(r)===fn).map(r=>r.argument):[fn.body];return results.every(r=>scalar(r,next));}
   const m=n.callee;return globalsStable&&m.type==='MemberExpression'&&ordinaryCalls.has(property(m))&&(ix.free(m.object)&&standard.has(m.object.name)||scalar(m.object,seen));
  }
  return false;
 }
 function synchronous(n,seen=new Set()){
  if(!n)return true;
  if(functions.has(n.type))return true;
  if(['AwaitExpression','YieldExpression','NewExpression','WithStatement','TaggedTemplateExpression','SpreadElement'].includes(n.type))return false;
  if(n.type==='BinaryExpression'&&(!scalar(n.left)||!scalar(n.right))||n.type==='UnaryExpression'&&!['!','void','typeof','delete'].includes(n.operator)&&!scalar(n.argument)||n.type==='TemplateLiteral'&&n.expressions.some(x=>!scalar(x))||n.type==='Property'&&n.computed&&!scalar(n.key))return false;
  if(n.type==='CallExpression'){
   if(n.optional||n.arguments.some(a=>a.type==='SpreadElement'||functions.has(a.type)))return false;
   const fn=target(n.callee);
   if(fn){
    if(fn.async||fn.generator||complete.has(fn)||asyncFns.has(fn)||seen.has(fn))return false;
    const next=new Set(seen);next.add(fn);if(!synchronous(fn.body,next))return false;
   }else{
    const m=n.callee;
    if(!globalsStable||m.type!=='MemberExpression'||!ordinaryCalls.has(property(m))||n.arguments.some(a=>!scalar(a)))return false;
    if(!(ix.free(m.object)&&standard.has(m.object.name))&&!scalar(m.object))return false;
   }
  }
  if(n.type==='MemberExpression'&&!(parents.get(n)?.type==='CallExpression'&&parents.get(n).callee===n)){
   if(property(n)!=='length'||!facts.string(n.object))return false;
  }
  if(n.type==='AssignmentExpression'||n.type==='UpdateExpression'){
   const left=n.type==='AssignmentExpression'?n.left:n.argument;
   if(left.type!=='Identifier'||!ix.bindings.has(left)||n.type==='UpdateExpression'&&!scalar(left)||n.type==='AssignmentExpression'&&n.operator!=='='&&(!scalar(left)||!scalar(n.right)))return false;
  }
  return children(n).every(([k,c])=>n.type==='CallExpression'&&k==='callee'||synchronous(c,seen));
 }
 const inert=s=>prototypeInitializer(s)||['FunctionDeclaration','EmptyStatement'].includes(s.type)||s.type==='VariableDeclaration'&&s.declarations.every(d=>d.id.type==='Identifier'&&pure(d.init));
 const candidates=nodes.filter(n=>n.type==='CallExpression'&&owners.get(n)===tree&&complete.has(target(n.callee))&&asyncFns.has(target(n.callee))&&parents.get(n)?.type==='ExpressionStatement');
 let root;
 for(const n of candidates){
  let child=parents.get(n),p=parents.get(child),nonTail=false,valid=true;
  while(p){
   if(p.type==='Program'||p.type==='BlockStatement'){
    const rest=p.body.slice(p.body.indexOf(child)+1);if(rest.some(s=>!inert(s)&&!synchronous(s)))valid=false;
    if(rest.some(s=>!['FunctionDeclaration','EmptyStatement'].includes(s.type)))nonTail=true;
    if(p===tree){if(nonTail){if(root&&root!==child)valid=false;else root=child;}break;}
   }else if(p.type!=='IfStatement'){valid=false;break;}
   child=p;p=parents.get(child);
  }
  if(!valid&&nonTail)return null;
  if(nonTail&&valid)calls.add(n);
 }
 if(!calls.size||!root)return null;
 const count=n=>{
  if(n.type==='ExpressionStatement')return calls.has(n.expression)?1:0;
  if(n.type==='IfStatement')return Math.max(count(n.consequent),n.alternate?count(n.alternate):0);
  if(n.type==='BlockStatement')return n.body.reduce((sum,s)=>sum+count(s),0);
  return 0;
 };
 // A tail completion in another branch of the same launch statement must also
 // join at the epilogue, otherwise it may inadvertently serialize execution.
 for(const n of candidates)if(n.start>=root.start&&n.end<=root.end)calls.add(n);
 if(count(root)>1||[...calls].some(n=>n.start<root.start||n.end>root.end))return null;
 return {calls};
}
