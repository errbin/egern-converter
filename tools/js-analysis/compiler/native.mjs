import {pathSetterField,lowerHTTPHelpers,lowerHTTPDelegates,lowerHTTPFactoryFields,httpFactoryPromiseCalls,lowerNodeRequestClient,lowerClosedHTTP,lowerSelectedHTTP,lowerAlternateHTTPReceivers} from '../http/requests.mjs';
import {parse,withSyntaxCache} from '../core/syntax.mjs';
import {analyze} from '../analysis/analyze.mjs';
import {rewriteUsageComments,copyrightDocumentation,formatNative,compactNative,singleLineSource} from '../output/source.mjs';
import {lowerClients,lowerMagic,lowerDevice,lowerPipeline} from '../platform/clients.mjs';
import {structuredFlow,completionStatements,pendingCompletion,closedIdentityMethodCall,closedRegeneratorConsumer} from './flow.mjs';
import {simplify} from '../transforms/simplify.mjs';
import {lowerEnv,foldTargetEnvironments,pruneTargetEnvironments,lowerClosedEnv,lowerExtendedClosedEnv,normalizePrototypeEnv,foldMultiPlatformProbes,pruneUnusedEnvMethods} from '../platform/environment.mjs';
import {specializeParameters,normalizeRecordParameters,lowerMessageParameters,lowerClosedMessageObjects,lowerClosedAccessors,specializeCallbacks,lowerClosedReceiverArguments,lowerFiniteMethodCalls,lowerFunctionDispatch,lowerSloppyThis,collectSloppyMemberWrites,lowerMinimalRegenerator,lowerCompletionForwarders,lowerAsyncRegenerator,lowerReboundHostGlobals,lowerClosedCompletionWrappers,lowerClosedStorageFacades} from '../transforms/specialization.mjs';
import {foldFactoryProbes,platformFold,lowerAPIObjectAliases,lowerQualifiedPlatformGlobals,lowerSelfNormalizedArgument,lowerDirectGlobalPlatformReceivers,assertSafeMissingGlobalProbes} from '../platform/globals.mjs';
import {pruneGeneratedFunctions,lowerStatefulFactories,lowerLegacyFactories,lowerGlobalMessages,lowerImplicitInstances} from '../transforms/factories.mjs';
import {protectLibraries,lowerDetachedGlobalObjectAliases} from '../analysis/libraries.mjs';
import {functions,property,key,children,index,patch,renderTree,initializedAfter,isolatedSwitchCase,closedMethodCallers} from '../core/ast.mjs';
import {valueFacts,regeneratorStateMachine} from '../analysis/values.mjs';
import {lowerFunctionConstructorSource,lowerStringTables,lowerLiteralStringTables,lowerObfuscatedTables,lowerDiscardedSelfCheckCallbacks} from '../transforms/decoding.mjs';
import {checkNativeEvaluation} from '../transforms/evaluation.mjs';

// Compile legacy HTTP scripts to direct Egern APIs. No runtime bridge is emitted.
// Upstream code is parsed, never evaluated. Unprovable control flow is rejected.
export function native(source,format='surge',options={}){
 return withSyntaxCache(()=>compileNative(source,format,options));
}
function compileNative(source,format,options){
 let libraries,stateMachineProof;
 try{
  // Reveal a closed, data-only Function-constructor shell before identifying
  // embedded libraries. No input body is evaluated during this reduction.
  const functionSource=lowerFunctionConstructorSource(source);
  libraries=protectLibraries(functionSource.source);
  const numbers=normalizeLegacyNumbers(libraries.source),literalTables=lowerLiteralStringTables(numbers.source),obfuscated=lowerObfuscatedTables(literalTables.source),selfChecks=lowerDiscardedSelfCheckCallbacks(obfuscated.source),decoded=lowerStringTables(selfChecks.source),envNormalized=normalizePrototypeEnv(decoded.source),probesFolded=pruneUnusedEnvMethods(simplify(foldMultiPlatformProbes(envNormalized.source).source)),scopeThis=lowerSloppyThis(typeof probesFolded==='string'?probesFolded:probesFolded.source),nodeRequest=lowerNodeRequestClient(scopeThis.source),dispatch=nodeRequest.source.includes('eval')?lowerFunctionDispatch(nodeRequest.source):{source:nodeRequest.source,transformations:[],rejected:[]};
  if(dispatch.rejected.length)throw Error('无法证明动态 eval 函数分派的目标：'+dispatch.rejected.map(item=>'第 '+item.line+' 行').join('、')+'；仅支持封闭且不可变的函数名集合');
  if(options.state_machine_proof){
   try{
    const proofSource=dispatch.source,tree=parse(proofSource,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true});
    const proof=regeneratorStateMachine(index(tree),proofSource);
    stateMachineProof={detected:proof.detected,proved:proof.proved,release:proof.release,gaps:proof.gaps,summary:proof.summary};
   }catch(error){stateMachineProof={detected:0,proved:false,release:false,gaps:['状态机证明失败：'+error.message],summary:{machines:0,proved:0,states:0,edges:0,saveSlots:0,driveCount:0,externalDrives:0}};}
  }
  // 先探测哪些异步状态机会真正降级；完成转发器只在那些机器范围内展开，
  // 避免把其它脚本里原本不可证的嵌入式完成路径带入原生终止分析。
  const asyncProbe=lowerAsyncRegenerator(dispatch.source);
  const asyncRanges=asyncProbe.released.filter(item=>item.released&&Number.isInteger(item.start)).map(item=>[item.start,item.end]);
  const forwarders=lowerCompletionForwarders(dispatch.source,asyncRanges);
  dispatch.source=forwarders.source;
  dispatch.transformations.push(...forwarders.transformations);
  const minimalStateMachines=lowerMinimalRegenerator(dispatch.source);
  dispatch.source=minimalStateMachines.source;
  dispatch.transformations.push(...minimalStateMachines.transformations);
  const asyncStateMachines=lowerAsyncRegenerator(dispatch.source);
  dispatch.source=asyncStateMachines.source;
  dispatch.transformations.push(...asyncStateMachines.transformations);
  if(stateMachineProof&&(minimalStateMachines.released.length||asyncStateMachines.released.length)){
   stateMachineProof.released=[...minimalStateMachines.released,...asyncStateMachines.released];
   stateMachineProof.release=stateMachineProof.released.some(item=>item.released);
  }
  const evaluation=checkNativeEvaluation(dispatch.source),device=lowerDevice(dispatch.source);
  libraries.source=device.source;libraries.transformations=[];
  return {...compile(functionSource.source,format,{...options,device,allowNoCompletion:!!probesFolded?.completionRemoved,sloppyThis:{global:scopeThis.globalName,helper:scopeThis.helperName}},libraries),native_evaluation:evaluation,
   ...(stateMachineProof?{state_machine:stateMachineProof}:{}),static_transformations:[...functionSource.transformations,...numbers.transformations,...literalTables.transformations,...obfuscated.transformations,...selfChecks.transformations,...decoded.transformations,...scopeThis.transformations,...nodeRequest.transformations,...dispatch.transformations,...libraries.transformations]};
 }catch(e){return {errors:[e.message],code:null,libraries:libraries?.blocks??[],...(stateMachineProof?{state_machine:stateMachineProof}:{})};}
}
function normalizeLegacyNumbers(source){
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),edits=[];
 for(const n of index(tree).nodes){
  if(n.type!=='Literal'||typeof n.value!=='number')continue;
  const raw=source.slice(n.start,n.end);if(!/^0\d+$/.test(raw))continue;
  const replacement=/^0[0-7]+$/.test(raw)?'0o'+raw.slice(1):String(n.value);
  edits.push({start:n.start,end:n.end,replacement,raw});
 }
 let output=source;for(const edit of edits.sort((a,b)=>b.start-a.start))output=output.slice(0,edit.start)+edit.replacement+output.slice(edit.end);
 return {source:output,transformations:edits.map(({raw,replacement})=>({kind:'strict-module-numeric-literal',from:raw,to:replacement}))};
}
function compile(original,format,options,libraries){
 // A parsed generic declaration does not establish a native DNS callback ABI.
 if(original.includes('$domain')||original.includes('__egern')){
  const input=index(parse(original,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}));
  if(input.nodes.some(n=>n.type==='Identifier'&&n.name.startsWith('__egern')))throw Error('与转换器保留标识符冲突');
  if(input.nodes.some(n=>input.free(n,'$domain')))throw Error('DNS 脚本读取 $domain：尚未确认原生 ctx 的查询域名输入与 addresses/ttl 返回契约；不使用 _compat 或猜测字段，暂不发布');
 }
 const device=options.device??{deviceParameter:false,deviceTypeToken:null};
 const prepared=lowerMagic(lowerImplicitInstances(lowerDirectGlobalPlatformReceivers(lowerQualifiedPlatformGlobals(libraries.source,format),format)));
 const pipeline=lowerPipeline(rewriteUsageComments(simplify(prepared)),format,options);
 if(pipeline.gaps?.length)throw Error('中间件结果返回链已解析；'+pipeline.gaps.join('；'));
 // Match reviewed client contracts before generic platform/parameter folding
 // changes their syntax. Only the resulting business code enters those passes.
 const clients=lowerClients(lowerClosedEnv(lowerEnv(lowerMagic(lowerImplicitInstances(lowerDirectGlobalPlatformReceivers(pipeline.source,format))),format)),format),bundled=clients.lowered||pipeline.lowered;
 let closed=foldTargetEnvironments(clients.source,format);
 closed=lowerClosedReceiverArguments(closed);
 for(let pass=0;pass<3;pass++){const folded=simplify(platformFold(simplify(foldTargetEnvironments(closed,format)),format,options).source),next=pruneTargetEnvironments(folded,format);if(next===closed)break;closed=next;}
 const extendedEnv=lowerExtendedClosedEnv(closed);
 const envClosed=lowerClosedEnv(extendedEnv);
 clients.source=lowerClosedReceiverArguments(envClosed);
 const reviewed=lowerClosedAccessors(options.entry_types?.length?pruneGeneratedFunctions(clients.source,new Set(),true):clients.source);
 let platform=platformFold(specializeParameters(lowerGlobalMessages(reviewed)),format,options).source;
 if(options.entry_types?.length)for(let pass=0;pass<4;pass++){const next=pruneGeneratedFunctions(pruneTargetEnvironments(simplify(platformFold(foldFactoryProbes(lowerFiniteMethodCalls(lowerClosedReceiverArguments(normalizeRecordParameters(platform))),format,options),format,options).source),format),new Set(),true);if(next===platform)break;platform=next;}
 const generatedFunctions=new Set();
 let closures=lowerStatefulFactories(lowerLegacyFactories(normalizeRecordParameters(lowerHTTPDelegates(platform)),generatedFunctions),generatedFunctions);
 for(let pass=0;pass<8;pass++){const next=pruneGeneratedFunctions(simplify(platformFold(specializeParameters(closures),format,options).source),generatedFunctions,!!options.entry_types?.length);if(next===closures)break;closures=next;}
 closures=specializeCallbacks(lowerSelectedHTTP(closures),generatedFunctions);
 let folded=platformFold(completionStatements(lowerClosedEnv(closures)),format,options);
 for(let pass=0;pass<8;pass++){const next=platformFold(completionStatements(simplify(folded.source)),format,options);if(next.source===folded.source)break;folded=next;}
 const prepare=input=>{
  // Pruning can expose a closed instance only after an unused prototype
  // member disappears. Revisit scalar replacement with that smaller graph,
  // then specialize the newly exposed callback functions at their call sites.
  for(let pass=0;pass<8;pass++){
   const pruned=pruneGeneratedFunctions(pruneTargetEnvironments(simplify(platformFold(foldTargetEnvironments(input,format),format,options).source),format),generatedFunctions,!!options.entry_types?.length);
   const next=lowerStatefulFactories(pruned,generatedFunctions);
   if(next===input)break;input=next;
  }
  return specializeCallbacks(input,generatedFunctions);
 };
 const finish=input=>{
  const detached=lowerDetachedGlobalObjectAliases(input);
  const normalizedArgument=lowerQualifiedPlatformGlobals(lowerSelfNormalizedArgument(detached,format),format);
  const alternate=lowerAlternateHTTPReceivers(normalizedArgument,format);
  const factories=lowerHTTPFactoryFields(lowerHTTPHelpers(lowerSelectedHTTP(lowerAPIObjectAliases(alternate.source))),format);
  libraries.transformations.push(...alternate.transformations);
  const messageSource=lowerMessageParameters(factories.source);
  const closedSource=lowerClosedMessageObjects(messageSource);
  const rebound=lowerReboundHostGlobals(closedSource);
  const wrapped=lowerClosedCompletionWrappers(rebound.source,format);
  const storage=lowerClosedStorageFacades(wrapped.source,format);
  const result=emitNative(storage.source,original,format,options,libraries,{pipeline,bundled,device,folded,generatedFunctions,factorySignatures:factories.signatures,hostRebinds:rebound.rebindings});
  libraries.transformations.push(...factories.transformations,...wrapped.transformations,...storage.transformations);return result;
 };
 // Expand callback delegates only after the reachable receiver graph has
 // been lowered. Expanding the earlier class input misses newly exposed calls.
 const ready=prepare(simplify(folded.source));
 try{return finish(ready);}catch(initial){
  let expanded=lowerClosedHTTP(ready);
  if(expanded===ready)throw initial;
  for(let pass=0;pass<4;pass++){
   const next=simplify(platformFold(specializeParameters(expanded),format,options).source);
   if(next===expanded)break;expanded=next;
  }
  libraries.transformations.push({kind:'closed-http-delegates',reason:'按封闭调用点展开回调委托后重新执行完整原生证明'});
  return finish(prepare(expanded));
 }
}
// 条件接收者只有在测试表达式可由平台值、字面量和闭合观察函数静态求值，
// 且选中分支是通知 API 时，才能按原参数顺序收敛为一次直接调用。测试中的
// 局部别名写入必须只服务于该接收者选择；否则保留原文继续拒绝。
function lowerConditionalPlatformReceivers(source,format){
 let tree,ix;
 try{tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true});ix=index(tree);}
 catch{return {source,transformations:[]};}
 const {nodes,parents,bindings,free,owners}=ix;
 const UNKNOWN=Symbol('unknown'),NOTIFY=Symbol('notify'),NOTIFICATION=Symbol('notification');
 const loops=new Set(['ForStatement','ForInStatement','ForOfStatement','WhileStatement','DoWhileStatement']);
 const enclosingFunction=node=>{let parent=parents.get(node);while(parent&&!functions.has(parent.type))parent=parents.get(parent);return parent??null;};
 const insideLoop=node=>{for(let parent=parents.get(node);parent&&!functions.has(parent.type);parent=parents.get(parent))if(loops.has(parent.type))return true;return false;};
 const canAffectCall=(node,call)=>{
  if(node.start<call.start)return true;
  if(insideLoop(call))return true;
  const callFn=enclosingFunction(call);
  let fn=enclosingFunction(node);
  while(fn&&fn!==callFn){if(fn.start>call.start)return fn.type==='FunctionDeclaration';return true;}
  return false;
 };
 const declarationCounts=new Map();
 for(const n of nodes)if(n.type==='VariableDeclarator'||n.type==='FunctionDeclaration'){
  const b=bindings.get(n.id);if(b)declarationCounts.set(b,(declarationCounts.get(b)||0)+1);
 }
 const staticProperty=n=>property(n);
 const platformValue=(n,format)=>{
  if(n?.type!=='Identifier'||!free(n))return UNKNOWN;
  if(n.name==='undefined')return undefined;
  if(n.name==='$notify')return format==='qx'?NOTIFY:undefined;
  if(n.name==='$notification')return format==='qx'?undefined:NOTIFICATION;
  return UNKNOWN;
 };
 const memberValue=(n,value)=>{
  const key=staticProperty(n);if(!key)return UNKNOWN;
  if(value===NOTIFICATION)return key==='post'?NOTIFY:UNKNOWN;
  // 其余接收者（包括 qx 下不存在的 $notification）没有可证明成员语义。
  return UNKNOWN;
 };
 const truthy=v=>!!v;
 const binary=(operator,a,b)=>{
  if(a===UNKNOWN||b===UNKNOWN)return UNKNOWN;
  switch(operator){
   case '===':return a===b;case '!==':return a!==b;case '==':return a==b;case '!=':return a!=b;
   case '<':return a<b;case '<=':return a<=b;case '>':return a>b;case '>=':return a>=b;
   case '+':return a+b;case '-':return a-b;case '*':return a*b;case '/':return a/b;
   default:return UNKNOWN;
  }
 };
 const readonlyStringObservation=call=>{
  if(call.type!=='CallExpression'||call.arguments.length===0||call.callee.type!=='MemberExpression')return false;
  const receiver=call.callee.object,name=staticProperty(call.callee);
  const stringReceiver=receiver.type==='Literal'&&typeof receiver.value==='string'||free(receiver,'String');
  return stringReceiver&&['concat','includes','indexOf','startsWith','endsWith','slice','substring','substr','replace','replaceAll','split','padStart','padEnd','repeat','trim'].includes(name);
 };
 const functionAt=(callee,call)=>{
  if(callee.type==='Identifier'){
   const b=bindings.get(callee);
   if(!b||b.writes.length||declarationCounts.get(b)!==1)return null;
   const fn=b.fn??b.init;
   if(!functions.has(fn?.type)||fn.async||fn.generator||fn.body.type!=='BlockStatement'||fn.body.body.length!==1||fn.body.body[0].type!=='ReturnStatement')return null;
   if(!b.refs.length||b.refs.some(ref=>parents.get(ref)?.type!=='CallExpression'||parents.get(ref).callee!==ref))return null;
   return fn;
  }
  if(callee.type!=='MemberExpression'||!callee.object||callee.object.type!=='Identifier')return null;
  const name=staticProperty(callee);if(name===undefined)return null;
  const objectBinding=bindings.get(callee.object);
  if(!objectBinding||objectBinding.writes.length||declarationCounts.get(objectBinding)!==1||objectBinding.init?.type!=='ObjectExpression')return null;
  if(objectBinding.init.properties.some(p=>p.type!=='Property'||p.kind!=='init'||p.computed&&key(p)===undefined))return null;
  const primitiveHooksSafe=objectBinding.init.properties.every(p=>!['toString','valueOf'].includes(String(key(p))));
  if(objectBinding.refs.some(ref=>{
   const parent=parents.get(ref),use=parents.get(parent);
   if(!canAffectCall(ref,call))return false;
   if(parent?.type==='MemberExpression'&&parent.object===ref){
    const key=staticProperty(parent);if(key===undefined)return true;
    return key===name&&(use?.type==='AssignmentExpression'&&use.left===parent||use?.type==='UpdateExpression'||use?.operator==='delete');
   }
   return !(primitiveHooksSafe&&parent?.type==='CallExpression'&&parent.arguments.includes(ref)&&readonlyStringObservation(parent));
  }))return null;
  const entries=objectBinding.init.properties.filter(p=>p.type==='Property'&&p.kind==='init'&&String(key(p))===String(name));
  const fn=entries.length===1?entries[0].value:null;
  if(!functions.has(fn?.type)||fn.async||fn.generator||fn.body.type!=='BlockStatement'||fn.body.body.length!==1||fn.body.body[0].type!=='ReturnStatement')return null;
  return fn;
 };
 const evaluate=(n,env,{allowAssignment=false,seenFns=new Set(),format,targetCall}={})=>{
  if(!n)return UNKNOWN;
  if(n.type==='Literal')return n.value;
  if(n.type==='Identifier'){
   const b=bindings.get(n);
   if(b&&env.has(b))return env.get(b);
   const value=platformValue(n,format);
   if(value!==UNKNOWN)return value;
   return UNKNOWN;
  }
  if(n.type==='MemberExpression'){
   const value=evaluate(n.object,env,{allowAssignment,seenFns,format,targetCall});if(value===UNKNOWN)return UNKNOWN;
   return memberValue(n,value);
  }
  if(n.type==='AssignmentExpression'){
   if(!allowAssignment||n.operator!=='='||n.left.type!=='Identifier')return UNKNOWN;
   const b=bindings.get(n.left);if(!b)return UNKNOWN;
   const value=evaluate(n.right,env,{allowAssignment,seenFns,format,targetCall});if(value===UNKNOWN)return UNKNOWN;
   env.set(b,value);return value;
  }
  if(n.type==='BinaryExpression'){
   const a=evaluate(n.left,env,{allowAssignment,seenFns,format,targetCall}),b=evaluate(n.right,env,{allowAssignment,seenFns,format,targetCall});
   return binary(n.operator,a,b);
  }
  if(n.type==='LogicalExpression'){
   const a=evaluate(n.left,env,{allowAssignment,seenFns,format,targetCall});if(a===UNKNOWN)return UNKNOWN;
   if(n.operator==='&&')return truthy(a)?evaluate(n.right,env,{allowAssignment,seenFns,format,targetCall}):a;
   if(n.operator==='||')return truthy(a)?a:evaluate(n.right,env,{allowAssignment,seenFns,format,targetCall});
   if(n.operator==='??')return a==null?evaluate(n.right,env,{allowAssignment,seenFns,format,targetCall}):a;
   return UNKNOWN;
  }
  if(n.type==='UnaryExpression'){
   if(n.operator==='typeof'&&!bindings.has(n.argument)){
    const value=platformValue(n.argument,format);
    if(value!==UNKNOWN)return value===undefined?'undefined':value===NOTIFY?'function':'object';
   }
   const value=evaluate(n.argument,env,{allowAssignment,seenFns,format,targetCall});if(value===UNKNOWN)return UNKNOWN;
   if(n.operator==='!')return !value;if(n.operator==='void')return undefined;
   if(n.operator==='typeof')return value===undefined?'undefined':value===NOTIFY?'function':value===NOTIFICATION?'object':typeof value;
   if(n.operator==='+')return +value;if(n.operator==='-')return -value;
   return UNKNOWN;
  }
  if(n.type==='ConditionalExpression'){
   const test=evaluate(n.test,env,{allowAssignment,seenFns,format,targetCall});if(test===UNKNOWN)return UNKNOWN;
   return evaluate(test?n.consequent:n.alternate,env,{allowAssignment,seenFns,format,targetCall});
  }
  if(n.type==='CallExpression'){
   if(n.optional||n.arguments.some(a=>a.type==='SpreadElement'))return UNKNOWN;
   const fn=functionAt(n.callee,targetCall);if(!fn||seenFns.has(fn))return UNKNOWN;
   const next=new Set(seenFns);next.add(fn);const local=new Map(env);
   for(let i=0;i<fn.params.length;i++){
    const parameter=fn.params[i],id=parameter.type==='AssignmentPattern'?parameter.left:parameter;
    if(id.type!=='Identifier'||parameter.type==='RestElement')return UNKNOWN;
    const value=n.arguments[i]?evaluate(n.arguments[i],env,{allowAssignment,seenFns,format,targetCall}):parameter.type==='AssignmentPattern'?evaluate(parameter.right,env,{allowAssignment,seenFns,format,targetCall}):undefined;
    if(value===UNKNOWN)return UNKNOWN;
    local.set(bindings.get(id),value);
   }
   return evaluate(fn.body.body[0].argument,local,{allowAssignment:false,seenFns:next,format,targetCall});
  }
  return UNKNOWN;
 };
 const declarationKind=binding=>{
  const declaration=nodes.find(n=>n.type==='VariableDeclarator'&&bindings.get(n.id)===binding);
  return declaration?parents.get(declaration)?.kind:undefined;
 };
 const edits=[];
 for(const call of nodes){
  if(call.type!=='CallExpression'||call.optional||call.callee.type!=='ConditionalExpression'||call.arguments.some(a=>a.type==='SpreadElement'))continue;
  const env=new Map(),assigned=new Set();
  const collectAssignments=n=>{
   if(!n||typeof n!=='object')return;
   if(n.type==='AssignmentExpression'){
    if(n.operator==='='&&n.left.type==='Identifier'&&bindings.has(n.left))assigned.add(bindings.get(n.left));
   }
   if(n.type==='FunctionExpression'||n.type==='FunctionDeclaration'||n.type==='ArrowFunctionExpression')return;
   for(const [name,value]of Object.entries(n)){
    if(['start','end','loc'].includes(name))continue;
    if(Array.isArray(value)){for(const child of value)if(child?.type)collectAssignments(child);}
    else if(value?.type)collectAssignments(value);
   }
  };
  collectAssignments(call.callee.test);
  let safe=true;
  for(const binding of assigned){
   if(declarationKind(binding)==='const')safe=false;
   if(binding.writes.some(write=>write.start<call.callee.test.start||write.end>call.callee.test.end))safe=false;
   if(binding.refs.some(ref=>ref.start<call.callee.start||ref.end>call.callee.end))safe=false;
  }
  if(!safe)continue;
  const test=evaluate(call.callee.test,env,{allowAssignment:true,format,targetCall:call});
  if(test===UNKNOWN)continue;
  const selected=test?call.callee.consequent:call.callee.alternate;
  const operation=evaluate(selected,env,{allowAssignment:false,format,targetCall:call});
  if(operation!==NOTIFY)continue;
  const args=call.arguments.map(argument=>source.slice(argument.start,argument.end)).join(', ');
  edits.push({start:call.start,end:call.end,replacement:`$notification.post(${args})`,api:'$notify'});
 }
 if(!edits.length)return {source,transformations:[]};
 let output=source;
 for(const edit of edits.sort((a,b)=>b.start-a.start))output=output.slice(0,edit.start)+edit.replacement+output.slice(edit.end);
 return {source:output,transformations:edits.map(({api})=>({kind:'conditional-platform-receiver',api}))};
}
// 只内联“本地封闭转发器”：形如 function(f, value){ return f(value); } 的
// 本地函数/对象属性，调用点把宿主平台值作为首参传入。必须逐参数证明返回
// 调用恰好使用同一绑定并按原顺序转发其余实参；否则保持拒绝，不做名称猜测。
function lowerDirectPlatformForwarders(source){
 let tree,ix;
 try{tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true});ix=index(tree);}
 catch{return {source,transformations:[]};}
 const {nodes,parents,bindings,free}=ix;
 // 调用点之后发生的普通逃逸不会改写已经在调用点取到的成员值；只有提升函数
 // 声明可能提前执行，或调用点处于循环中会进入下一轮时，后续节点才仍然相关。
 const loops=new Set(['ForStatement','ForInStatement','ForOfStatement','WhileStatement','DoWhileStatement']);
 const enclosingFunction=node=>{let parent=parents.get(node);while(parent&&!functions.has(parent.type))parent=parents.get(parent);return parent??null;};
 const insideLoop=node=>{for(let parent=parents.get(node);parent&&!functions.has(parent.type);parent=parents.get(parent))if(loops.has(parent.type))return true;return false;};
 // 只有同一函数内、调用点之后的直写，或调用点之后才创建且不提升的函数体，
 // 才不可能在调用前执行。
 const canAffectCall=(node,call)=>{
  if(node.start<call.start)return true;
  if(insideLoop(call))return true;
  const callFn=enclosingFunction(call);
  let fn=enclosingFunction(node);
  while(fn&&fn!==callFn){
   if(fn.start>call.start)return fn.type==='FunctionDeclaration';
   return true;
  }
  return false;
 };
 const writesMember=(object,prop,call)=>{
  for(const n of nodes){
   if(call&&!canAffectCall(n,call))continue;
   if(n.type!=='AssignmentExpression'&&n.type!=='UpdateExpression'&&!(n.type==='UnaryExpression'&&n.operator==='delete'))continue;
   let target=n.type==='AssignmentExpression'?n.left:n.type==='UpdateExpression'?n.argument:n.argument;
   if(target?.type!=='MemberExpression')continue;
   // 找到以该绑定为根的成员链最外层，检查被写入的是哪个属性。
   let member=target;
   while(member.object?.type==='MemberExpression')member=member.object;
   const base=member.object;
   const baseBinding=base?.type==='Identifier'?bindings.get(base):null;
   if(baseBinding!==object)continue;
   const name=propertyOf(member);
   // 动态键可能命中目标方法，必须拒绝；写入其它已知成员不影响方法值。
   if(name===undefined||name===prop)return true;
  }
  return false;
 };
 const propertyOf=member=>member.computed?(member.property?.type==='Literal'?member.property.value:undefined):member.property?.name;
 const closedObject=object=>{
  if(object?.type!=='ObjectExpression')return null;
  const key=object.properties.map(p=>p.type==='Property'&&p.kind==='init'?keyOf(p):undefined);
  if(key.some(k=>k===undefined||k==='__proto__')||new Set(key).size!==key.length)return null;
  return object;
 };
 const keyOf=p=>p.computed?(p.key?.type==='Literal'?p.key.value:undefined):(p.key?.name??p.key?.value);
 const resolveObject=node=>{
  if(node?.type==='Identifier'){const b=bindings.get(node);if(b&&!b.writes.length&&b.init?.type==='ObjectExpression')return {object:b.init,binding:b};}
  if(node?.type==='ObjectExpression')return {object:node,binding:null};
  return null;
 };
 const functionAt=(callee,call)=>{
  if(callee.type==='Identifier'){
   const b=bindings.get(callee);if(!b||b.writes.length)return null;
   const fn=b.fn??b.init;return fn&&functions.has(fn.type)?{fn,binding:null}:null;
  }
  if(callee.type!=='MemberExpression')return null;
  const name=property(callee);if(name===undefined)return null;
  const resolved=resolveObject(callee.object);if(!resolved)return null;
  const object=closedObject(resolved.object);if(!object)return null;
  const entries=object.properties.filter(p=>p.type==='Property'&&p.kind==='init'&&String(keyOf(p))===String(name));
  if(entries.length!==1)return null;
  const fn=entries[0].value;if(!functions.has(fn.type))return null;
  if(resolved.binding){
   if(writesMember(resolved.binding,name,call))return null;
   // 对象可以整体传入本地辅助函数，但必须证明该函数只读取参数。
   // 成员写入、动态属性写入、别名逃逸或未知调用都会让目标方法失去证明；
   // 只审查可能影响本次调用点的引用。
   for(const ref of resolved.binding.refs){
    if(!canAffectCall(ref,call))continue;
    const parent=parents.get(ref);
    if(parent?.type==='MemberExpression'&&parent.object===ref&&property(parent)!==undefined)continue;
    if(!readOnlyEscape(ref,new Set()))return null;
   }
  }
  return {fn,binding:resolved.binding,object,name};
 };
 const localFunction=callee=>{
  if(callee.type==='Identifier'){
   const binding=bindings.get(callee);if(!binding||binding.writes.length)return null;
   const fn=binding.fn??binding.init;return fn&&functions.has(fn.type)?fn:null;
  }
  if(callee.type!=='MemberExpression')return null;
  const name=property(callee);if(name===undefined)return null;
  const resolved=resolveObject(callee.object),object=resolved&&closedObject(resolved.object);
  if(!object)return null;
  const entries=object.properties.filter(p=>p.type==='Property'&&p.kind==='init'&&String(keyOf(p))===String(name));
  return entries.length===1&&functions.has(entries[0].value.type)?entries[0].value:null;
 };
 const nonCallable=node=>{
  if(node?.type==='ObjectExpression')return true;
  if(node?.type!=='Identifier')return false;
  const binding=bindings.get(node);return !!binding&&!binding.writes.length&&binding.init?.type==='ObjectExpression';
 };
 const readOnlyParameter=(parameter,valueIsNonCallable,seen)=>{
  if(parameter?.type!=='Identifier')return false;
  const binding=bindings.get(parameter);
  if(!binding||binding.writes.length||seen.has(binding))return false;
  const next=new Set(seen);next.add(binding);
  return binding.refs.every(ref=>{
   const parent=parents.get(ref),use=parents.get(parent);
   if(parent?.type==='AssignmentExpression'&&parent.left===ref||parent?.type==='UpdateExpression'||parent?.type==='UnaryExpression'&&parent.operator==='delete')return false;
   if(parent?.type==='MemberExpression'&&parent.object===ref){
    if(use?.type==='AssignmentExpression'&&use.left===parent||use?.type==='UpdateExpression'||use?.type==='UnaryExpression'&&use.operator==='delete'||use?.type==='CallExpression'&&use.callee===parent)return false;
    return true;
   }
   // 已知对象字面量不可调用；作为被调值只会先抛错，不会写入原对象。
   if(parent?.type==='CallExpression'&&parent.callee===ref)return valueIsNonCallable;
   if(parent?.type==='CallExpression'&&parent.arguments.includes(ref)){
    if(parent.arguments.filter(arg=>arg===ref).length!==1)return false;
    const fn=localFunction(parent.callee);
    if(!fn)return false;
    const target=fn.params[parent.arguments.indexOf(ref)];
    return !!target&&readOnlyParameter(target,valueIsNonCallable,next);
   }
   if(['BinaryExpression','LogicalExpression','UnaryExpression','ConditionalExpression','IfStatement','TemplateLiteral','SwitchStatement'].includes(parent?.type))return true;
   return false;
  });
 };
 const readOnlyEscape=(ref,seen)=>{
  const parent=parents.get(ref);
  // 真值判断、typeof/void 观察和纯表达式语句只读取当前对象值，不会把对象
  // 或其方法交给未知代码；成员读取另由 writesMember 检查，写入仍会拒绝。
  const observed=node=>{
   const p=parents.get(node);
   if(p?.type==='ConditionalExpression'&&p.test===node||
      ['IfStatement','WhileStatement','DoWhileStatement'].includes(p?.type)&&p.test===node||
      p?.type==='UnaryExpression'&&['!','typeof','void'].includes(p.operator)||
      p?.type==='ExpressionStatement'&&p.expression===node)return true;
   return p?.type==='LogicalExpression'&&p.left===node&&observed(p);
  };
  if(observed(ref))return true;
  if(parent?.type!=='CallExpression'||!parent.arguments.includes(ref))return false;
  if(parent.arguments.filter(arg=>arg===ref).length!==1)return false;
  const fn=localFunction(parent.callee);
  if(!fn)return false;
  const parameter=fn.params[parent.arguments.indexOf(ref)];
  return !!parameter&&readOnlyParameter(parameter,nonCallable(ref),seen);
 };
 // 这些宿主值在直接调用位置都有确定语义。只有转发器被证明恰好执行一次
 // 直接调用时，才能把值参数还原成同一调用位置的直接调用。
 const platformValues=new Set(['$done','$notify','setTimeout']);
 const isPlatformValue=node=>node.type==='Identifier'&&platformValues.has(node.name)&&free(node,node.name);
 // 去混淆器会把一次恒等转发拆成同序嵌套的多层 helper。每层都必须只返回
 // 一次调用、逐位原序传递全部参数，并且最终直接调用首参；任何重排、分支、
 // 副作用或写入都会让宿主值无法还原到直接调用位置。
 const invocationForwarder=(fn,count,seen=new Set())=>{
  if(!fn||seen.has(fn)||fn.async||fn.generator||fn.params.length!==count||fn.params.some(parameter=>parameter.type!=='Identifier'))return false;
  const parameterBindings=fn.params.map(parameter=>bindings.get(parameter));
  if(parameterBindings.some(binding=>!binding||binding.writes.length))return false;
  const returned=fn.body.type==='BlockStatement'
   ?fn.body.body.length===1&&fn.body.body[0].type==='ReturnStatement'?fn.body.body[0].argument:null
   :fn.body;
  if(returned?.type!=='CallExpression'||returned.optional||returned.arguments.some(argument=>argument.type==='SpreadElement'))return false;
  if(nodes.some(n=>n.start>=fn.start&&n.end<=fn.end&&(n.type==='ThisExpression'||n.type==='Identifier'&&n.name==='arguments'&&!bindings.has(n))))return false;
  const next=new Set(seen);next.add(fn);
  if(returned.callee.type==='Identifier'&&bindings.get(returned.callee)===parameterBindings[0]){
   return returned.arguments.length===count-1&&returned.arguments.every((argument,index)=>argument.type==='Identifier'&&bindings.get(argument)===parameterBindings[index+1]);
  }
  if(returned.arguments.length!==count||!returned.arguments.every((argument,index)=>argument.type==='Identifier'&&bindings.get(argument)===parameterBindings[index]))return false;
  const nested=functionAt(returned.callee,returned);
  return !!nested&&invocationForwarder(nested.fn,count,next);
 };
 const edits=[];
 for(const call of nodes){
  if(call.type!=='CallExpression'||call.optional||call.callee.type==='Super')continue;
  if(call.arguments.some(a=>a.type==='SpreadElement'))continue;
  const apiIndex=call.arguments.findIndex(isPlatformValue);
  if(apiIndex!==0)continue;
  const apis=call.arguments.filter(isPlatformValue);
  if(apis.length!==1)continue;
  const api=apis[0].name;
  const target=functionAt(call.callee,call);if(!target)continue;
  const fn=target.fn;
  if(!invocationForwarder(fn,call.arguments.length))continue;
  const forwarded=call.arguments.slice(1);
  const replacement=api+'('+forwarded.map(arg=>source.slice(arg.start,arg.end)).join(', ')+')';
  edits.push({start:call.start,end:call.end,replacement,api});
 }
 if(!edits.length)return {source,transformations:[]};
 let output=source;
 for(const edit of edits.sort((a,b)=>b.start-a.start))output=output.slice(0,edit.start)+edit.replacement+output.slice(edit.end);
 return {source:output,transformations:edits.map(({api})=>({kind:'direct-platform-value-forwarder',api}))};
}
function emitNative(source,original,format,options,libraries,{pipeline,bundled,device,folded,generatedFunctions,factorySignatures,hostRebinds=[]}){
 const compressionFallback=lowerCompressionFallbacks(source);
 source=compressionFallback.source;
 libraries.transformations.push(...compressionFallback.transformations);
 const forwarders=lowerDirectPlatformForwarders(source);
 source=forwarders.source;
 libraries.transformations.push(...forwarders.transformations);
 const conditionalReceivers=lowerConditionalPlatformReceivers(source,format);
 source=conditionalReceivers.source;
 libraries.transformations.push(...conditionalReceivers.transformations);
 const detachedAliases=lowerDetachedGlobalObjectAliases(source);
 source=detachedAliases;
 assertSafeMissingGlobalProbes(source);
 const report=analyze(source,format,{nativeMethods:true,nativeBundle:bundled,nativeStandardGlobals:true,nativeEntry:pipeline.lowered,entry_types:options.entry_types,nativeLibraryValues:libraries.valueContracts,sloppyThisHelper:options.sloppyThis?.helper,allowNoCompletion:options.allowNoCompletion});
 if(report.errors.length)throw Error(report.errors.join('；'));
 const comments=[];
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true,onComment:comments}),ix=index(tree);
 const {nodes,parents,bindings,owners,free}=ix;
 const factoryPromises=httpFactoryPromiseCalls(ix,factorySignatures);
 const values=valueFacts(ix);
 const names=new Set(nodes.filter(n=>n.type==='Identifier').map(n=>n.name));
 const fresh=base=>{let n=base,i=2;while(names.has(n))n=base+i++;names.add(n);return n;};
 const context=fresh('ctx');
 const scheduledOnly=Array.isArray(options.entry_types)&&options.entry_types.length>0&&options.entry_types.every(type=>type==='schedule');
 const complete=new Set(),asyncFns=new Set([tree]),lifted=new Set(),httpReplies=new Map(),extraAfter=new WeakMap(),bodyReads=new Map(),bodyWrites=new Set(),prefix=[],dynamicMethods=new WeakMap(),httpMethodSelections=new WeakSet();
 const generated=new WeakMap(),fieldValues=new WeakMap(),optionalHTTPFields=new WeakSet();
 // 闭包目标、类与成员调用证明只依赖当前 AST 索引和字段投影。大型 bundle
 // 会从结构化完成分析反复查询同一批方法；缓存这些纯查询，避免每次重新
 // 扫描全树。字段投影变化时统一失效，保持原有数据流精度。
 let targetCache=new WeakMap(),classOfCache=new WeakMap(),immutableClassCache=new WeakMap(),closedMethodCallsCache=new WeakMap(),resolveCache=new WeakMap();
 const invalidateResolutionCaches=()=>{targetCache=new WeakMap();classOfCache=new WeakMap();immutableClassCache=new WeakMap();closedMethodCallsCache=new WeakMap();resolveCache=new WeakMap();};
 const setFieldValue=(node,value)=>{fieldValues.set(node,value);invalidateResolutionCaches();};
 const parameterFunctions=new Map();
 for(const fn of nodes)if(functions.has(fn.type)){
  const seen=new Set();
  fn.params.forEach((parameter,position)=>{
   const binding=bindings.get(parameter.type==='AssignmentPattern'?parameter.left:parameter);
   if(!binding||seen.has(binding))return;
   seen.add(binding);if(!parameterFunctions.has(binding))parameterFunctions.set(binding,[]);
   parameterFunctions.get(binding).push({fn,position});
  });
 }
 const shapeHostValues=new WeakSet();
 const hostResponseBindings=new WeakSet();
 const closedHostResponseSnapshotBindings=new WeakSet();
 let hostRequestSnapshot=null,hostRequestInitializers=[],hostResponseSnapshot=null,hostResponseInitializers=[];
 // sloppy 成员写入只在渲染阶段保留语义，分析阶段仍看到作者原始赋值，
 // 这样请求/通知对象的数据流证明不会被 helper 调用打断。
 const sloppy=collectSloppyMemberWrites(ix,source),sloppyWrites=new Set(sloppy.writes);
 const sloppyWriteHelper=sloppyWrites.size?fresh('sloppySet'):null;
 libraries.transformations.push(...sloppy.transformations);
 if(options.sloppyThis?.helper)prefix.push(`const ${options.sloppyThis.global} = globalThis;function ${options.sloppyThis.helper}(value){return value == null ? ${options.sloppyThis.global} : value;}`);
 if(sloppyWriteHelper)prefix.push(`function ${sloppyWriteHelper}(target,key,value){if(target===null||target===undefined)throw new TypeError('Cannot set properties of '+target);if(typeof target==='object'||typeof target==='function')Reflect.set(target,key,value);return value;}`);
 if(device.deviceParameter)prefix.push(`if (!['iPhone', 'iPad', 'Mac'].includes(${context}.env.EGH_DEVICE_TYPE || 'iPhone')) throw new Error('EGH_DEVICE_TYPE must be iPhone, iPad or Mac');`);
 const argumentObject=options.argument_object&&nodes.some(n=>free(n,'$argument'))?fresh('scriptArgument'):null;
 if(argumentObject)prefix.push(`const ${argumentObject} = ${context}.env.argument ? JSON.parse(${context}.env.argument) : ${context}.env.argument;`);
 let started=null;
 const fail=(n,why)=>{const line=source.slice(0,n.start).split('\n').length;throw Error(`原生转换第 ${line} 行：${why}`);};
 // Sloppy legacy scripts sometimes assign a top-level result without declaring it.
 // ES modules are strict: preserve initialization and ReferenceError for
 // conditionally assigned sloppy globals using ordinary local bindings.
 const implicit=new Set(),implicitGroups=new Map(),guardedImplicit=new Map();
 for(const n of nodes)if(n.type==='Identifier'&&free(n)){
  const p=parents.get(n);if(p?.type==='AssignmentExpression'&&p.left===n){if(!implicitGroups.has(n.name))implicitGroups.set(n.name,[]);implicitGroups.get(n.name).push(n);}
 }
 const strictImplicit=new Set(),sloppyImplicit=new Set(),mixedImplicit=new Set();
 if(implicitGroups.size){
  const input=index(parse(libraries.source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}));
  for(const n of input.nodes)if(input.free(n)&&implicitGroups.has(n.name)&&input.parents.get(n)?.type==='AssignmentExpression'&&input.parents.get(n).left===n){
   let strict=false;
   for(let p=n;p;p=input.parents.get(p))if(['ClassDeclaration','ClassExpression'].includes(p.type)||(p.type==='Program'?p.body:p.body?.body)?.some(s=>s.directive==='use strict')){strict=true;break;}
   if(strict)strictImplicit.add(n.name);else sloppyImplicit.add(n.name);
  }
  for(const name of strictImplicit)if(sloppyImplicit.has(name))mixedImplicit.add(name);
 }
 for(const [name,writes]of implicitGroups){
  // 严格作用域里的未声明赋值在原脚本中必定抛出 ReferenceError；目标模块
  // 本身就是严格模式，原样保留即可得到同一异常时机，不能改写成局部变量。
  const inStrictScope=n=>{
   for(let scope=owners.get(n);scope;scope=owners.get(parents.get(scope))){
    if((scope.type==='Program'?scope.body:scope.body?.body)?.some(s=>s.directive==='use strict'))return true;
    if(scope===tree)break;
   }
   return false;
  };
  const strictWrites=writes.filter(inStrictScope);
  if(mixedImplicit.has(name))fail(writes[0],'同一隐式全局同时出现在严格与非严格作用域');
  if(strictImplicit.has(name)||strictWrites.length===writes.length){
   continue; // Preserve strict JavaScript ReferenceError/global-binding semantics verbatim.
  }
  if(strictWrites.length)fail(strictWrites[0],'同一隐式全局同时出现在严格与非严格作用域');
  const uses=nodes.filter(x=>free(x,name));
  if(name.startsWith('$')||['globalThis','global','window','module','exports','process','Object','Array','JSON','Date','Math','console','undefined','NaN','Infinity'].includes(name))fail(writes[0],'不能覆写宿主全局对象或平台 API');
  // Compound writes first read the existing sloppy binding. Keep an explicit
  // initialization bit so an uninitialized read still throws before its RHS.
  if(writes.some(n=>parents.get(n).operator!=='='))guardedImplicit.set(name,fresh(name+'Initialized'));
  for(const read of uses.filter(n=>!writes.includes(n))){
   if(parents.get(read)?.type==='UnaryExpression'&&parents.get(read).operator==='typeof')continue;
   const dominated=writes.some(n=>{
    const assignment=parents.get(n),statement=parents.get(assignment),block=parents.get(statement);
    if(statement?.type!=='ExpressionStatement'||!['Program','BlockStatement'].includes(block?.type))return false;
    if(block===tree)return initializedAfter(ix,statement,read);
    let nested=read;
    if(owners.get(read)!==owners.get(n)){
     // Function/arrow expressions cannot be invoked before their allocation.
     // A closure allocated after this unconditional write observes the same
     // initialized value when the surrounding constructor later exposes it.
     let fn=owners.get(read);const owner=owners.get(n);
     while(fn&&fn!==owner){
      if(!functions.has(fn.type)||fn.type==='FunctionDeclaration')return false;
      nested=fn;fn=owners.get(parents.get(fn));
     }
     if(fn!==owner)return false;
    }
    let enclosing=nested;while(parents.get(enclosing)&&parents.get(enclosing)!==block)enclosing=parents.get(enclosing);
    return parents.get(enclosing)===block&&enclosing.start>=statement.end;
   });
   if(!dominated&&!guardedImplicit.has(name))guardedImplicit.set(name,fresh(name+'Initialized'));
  }
  if(uses.some(n=>parents.get(n)?.type==='UnaryExpression'&&parents.get(n).operator==='delete'))fail(writes[0],'删除隐式全局变量尚未建立本地绑定契约');
  // 直接调用条件初始化的隐式全局时，调用目标本身可能是完成函数，契约无法
  // 静态确定。成员调用（例如 `value.replace(...)`）只消费该值的普通方法，
  // 读取点的 ReferenceError 保护已经保持原语义，不需要把接收者当成目标。
  if(guardedImplicit.has(name)&&uses.some(n=>parents.get(n)?.type==='CallExpression'&&parents.get(n).callee===n))fail(writes[0],'条件初始化的隐式全局调用尚未确定函数与完成结果契约');
  implicit.add(name);
 }
 if(implicit.size)prefix.push('let '+[...implicit].join(', ')+';');
 for(const flag of guardedImplicit.values())prefix.push('let '+flag+' = false;');
 const referenceError=guardedImplicit.size&&nodes.some(n=>n.type==='Identifier'&&n.name==='ReferenceError'&&!free(n))?fresh('nativeReferenceError'):null;
 const isAPI=(n,api,method)=>n?.type==='CallExpression'&&(method? n.callee.type==='MemberExpression'&&free(n.callee.object,api)&&property(n.callee)===method:free(n.callee,api));
 const isDone=n=>isAPI(n,'$done');
 // A mutable object committed from finally needs first-completion propagation,
 // independently of which libraries or author happen to surround it.
 let structured=bundled||generatedFunctions.size>0&&nodes.some(n=>n.type==='CallExpression'&&isDone(n)&&['LogicalExpression','ConditionalExpression'].includes(parents.get(n)?.type))||nodes.some(n=>n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&property(n.callee)==='finally'&&n.arguments.some(fn=>functions.has(fn.type)&&nodes.some(c=>c.start>=fn.start&&c.end<=fn.end&&isDone(c))))||nodes.some(n=>n.type==='TryStatement'&&n.finalizer&&nodes.some(c=>{
  if(c.start<n.finalizer.start||c.end>n.finalizer.end||!isDone(c)||c.arguments[0]?.type!=='Identifier')return false;
  const b=bindings.get(c.arguments[0]);return b?.init?.type==='ObjectExpression'&&b.writes.length&&b.writes.every(w=>w.type==='AssignmentExpression'&&w.operator==='='&&w.right.type==='ObjectExpression');
 }));
 function target(n,seen){
  const root=seen===undefined,cacheable=root&&n&&typeof n==='object';
  if(cacheable&&targetCache.has(n))return targetCache.get(n);
  const result=targetNode(n,root?new Set():seen);
  if(cacheable)targetCache.set(n,result);
  return result;
 }
 function targetNode(n,seen){
  if(functions.has(n?.type))return n;
  if(n?.type==='CallExpression'&&n.callee.type==='MemberExpression'&&n.arguments.length===1&&!n.optional&&closedIdentityMethodCall(ix,n,n.arguments[0]))return target(n.arguments[0],seen);
  if(n?.type==='Identifier'){const b=bindings.get(n);if(b&&!b.writes.length&&!seen.has(b)){seen.add(b);if(b.fn||b.init)return b.fn??target(b.init,seen);
   for(const {fn,position} of parameterFunctions.get(b)??[]){
    const parent=parents.get(fn),id=fn.id??(parent?.type==='VariableDeclarator'?parent.id:null),callee=id?bindings.get(id):null;
    const direct=parent?.type==='CallExpression'&&parent.callee===fn&&!parent.optional&&!parent.arguments.some(a=>a.type==='SpreadElement');
    let calls;
    if(direct)calls=[parent];
    else if(callee&&!callee.writes.length&&callee.refs.length){
     calls=callee.refs.map(r=>parents.get(r));
     if(calls.some((c,i)=>c?.type!=='CallExpression'||c.callee!==callee.refs[i]||c.arguments.some(a=>a.type==='SpreadElement')))return null;
    }else if(parent?.type==='Property'&&parent.value===fn&&parent.kind==='init'){
     // 对象方法简写与函数声明具有相同参数绑定，但调用点必须全部通过同一
     // 未改写对象的静态成员读取；对象逃逸或调用其他成员都无法证明目标身份。
     const object=parents.get(parent),declaration=parents.get(object),id=declaration?.type==='VariableDeclarator'&&declaration.init===object?declaration.id:null;
     const owner=id?.type==='Identifier'?bindings.get(id):null,name=key(parent);
     if(!owner||owner.writes.length||name===undefined||!owner.refs.length)return null;
     const members=owner.refs.map(r=>parents.get(r));
     if(members.some((m,i)=>m?.type!=='MemberExpression'||m.object!==owner.refs[i]||property(m)!==name))return null;
     calls=members.map(m=>parents.get(m));
     if(calls.some((c,i)=>c?.type!=='CallExpression'||c.callee!==members[i]||c.arguments.some(a=>a.type==='SpreadElement')))return null;
    }else if(parent?.type==='MethodDefinition'){
     calls=closedMethodCalls(parent);if(!calls)return null;
    }else return null;
    const targets=calls.map(c=>target(c.arguments[position]??(fn.params[position].type==='AssignmentPattern'?fn.params[position].right:null),new Set(seen)));
    return targets[0]&&targets.every(t=>t===targets[0])?targets[0]:null;
   }
  }}
  if(n?.type==='MemberExpression'&&property(n)!==undefined){
   const obj=resolve(n.object);
   if(obj?.type==='ObjectExpression'&&immutableObject(n.object,obj)){
    const entry=obj.properties.find(p=>p.type==='Property'&&key(p)===property(n)&&p.kind==='init');
    return entry?target(entry.value,seen):null;
   }
  // 本地构造函数显式返回对象字面量时，实例成员仍来自同一份静态属性表。
  // 只接受实例绑定未重绑、所有读取均为已知成员调用的闭合形状；这样既能
  // 解析 `const $ = new Env(); $.done(v)`，又不会把可变外壳当成方法身份。
  const factory=obj?.type==='NewExpression'&&factoryReturnObject(obj);
  if(factory&&immutableFactoryInstance(n.object,obj,factory,property(n))){
   const entry=factory.properties.find(p=>p.type==='Property'&&key(p)===property(n)&&p.kind==='init');
   return entry?target(entry.value,seen):null;
  }
   const cls=classOf(obj);
   if(cls&&!cls.superClass&&immutableClass(cls)){
    const method=cls.body.body.find(m=>m.type==='MethodDefinition'&&key(m)===property(n)&&m.kind==='method'&&m.static===(obj.type!=='NewExpression'&&obj.type!=='ThisExpression'));
    return method?.value??null;
   }
  }
  return null;
 }
 function factoryReturnObject(instance){
  const factory=resolve(instance.callee);
  if(!factory||factory.type!=='FunctionDeclaration'||factory.async||factory.generator)return null;
  const binding=bindings.get(factory.id);
  if(!binding||binding.writes.length||!factory.body||factory.body.type!=='BlockStatement')return null;
  const returns=nodes.filter(n=>n.type==='ReturnStatement'&&owners.get(n)===factory);
  if(returns.length!==1||!returns[0].argument)return null;
  const returned=resolve(returns[0].argument);
  return returned?.type==='ObjectExpression'?returned:null;
 }
 function immutableFactoryInstance(ref,instance,factory,name){
  if(ref.type!=='Identifier')return false;
  const binding=bindings.get(ref);
  if(!binding||binding.writes.length)return false;
  const keys=factory.properties.map(p=>p.type==='Property'&&p.kind==='init'?key(p):undefined);
  if(keys.some(k=>k===undefined||k==='__proto__')||new Set(keys).size!==keys.length)return false;
  return binding.refs.every(ref=>{
   const member=parents.get(ref);
   if(member?.type!=='MemberExpression'||member.object!==ref||property(member)===undefined)return false;
   let outer=member;
   while(parents.get(outer)?.type==='MemberExpression'&&parents.get(outer).object===outer)outer=parents.get(outer);
   const use=parents.get(outer);
   const write=use?.type==='AssignmentExpression'&&use.left===outer||use?.type==='UpdateExpression'||use?.type==='UnaryExpression'&&use.operator==='delete';
   if(write){const written=property(outer);return written!==undefined&&written!==name;}
   return property(member)!==name||use?.type==='CallExpression'&&use.callee===outer;
  });
 }
 // Method resolution is restricted to closed local objects/classes. A dynamic
 // write or escaped receiver invalidates the proof instead of guessing a target.
 function immutableObject(ref,obj){
  const keys=obj.properties.map(p=>p.type==='Property'&&p.kind==='init'?key(p):undefined);
  if(keys.some(k=>k===undefined||k==='__proto__')||new Set(keys).size!==keys.length)return false;
  if(ref.type!=='Identifier')return ref===obj;
  const b=bindings.get(ref);if(!b||b.writes.length)return false;
  return b.refs.every(r=>{const p=parents.get(r),q=parents.get(p);return p?.type==='MemberExpression'&&p.object===r&&q?.type==='CallExpression'&&q.callee===p&&property(p)!==undefined;});
 }
 function classOf(n){
  const cacheable=n&&typeof n==='object';
  if(cacheable&&classOfCache.has(n))return classOfCache.get(n);
  const result=classOfNode(n);
  if(cacheable)classOfCache.set(n,result);
  return result;
 }
 function classOfNode(n){
  if(['ClassExpression','ClassDeclaration'].includes(n?.type))return n;
  if(n?.type==='NewExpression'){
   const c=resolve(n.callee);
   if(['ClassExpression','ClassDeclaration'].includes(c?.type))return c;
   if(c?.type==='FunctionDeclaration'&&!c.async&&!c.generator){
    const returned=c.body?.body?.find(s=>s.type==='ReturnStatement')?.argument;
    if(returned?.type==='NewExpression'&&returned.callee.type==='ClassExpression')return returned.callee;
   }
  }
  if(n?.type==='ThisExpression'){
   for(let p=parents.get(n);p;p=parents.get(p)){
    if(functions.has(p.type)&&p.type!=='ArrowFunctionExpression'&&parents.get(p)?.type!=='MethodDefinition')return null;
    if(['ClassExpression','ClassDeclaration'].includes(p.type))return p;
   }
  }
  return null;
 }
 function immutableClass(cls){
  if(immutableClassCache.has(cls))return immutableClassCache.get(cls);
  const result=immutableClassProof(cls);
  immutableClassCache.set(cls,result);
  return result;
 }
 function immutableClassProof(cls){
  const members=cls.body.body,methods=members.filter(m=>m.type==='MethodDefinition');
  const inert=node=>!node||node.type==='Literal'||node.type==='UnaryExpression'&&['!','void','+','-','~'].includes(node.operator)&&inert(node.argument)||node.type==='BinaryExpression'&&inert(node.left)&&inert(node.right)||node.type==='ObjectExpression'&&node.properties.every(p=>p.type==='Property'&&!p.computed&&p.kind==='init'&&key(p)!=='__proto__'&&inert(p.value));
  if(members.some(m=>m.computed||m.type==='StaticBlock'||m.type==='MethodDefinition'&&['get','set'].includes(m.kind)||m.type!=='MethodDefinition'&&(m.type!=='PropertyDefinition'||m.static||!inert(m.value))))return false;
  if(new Set(members.map(m=>String(m.static)+':'+key(m))).size!==members.length)return false;
  // No prototype manipulation, reassignment or method shadowing anywhere in the
  // local class/instance references. Field writes to this remain ordinary JS.
  for(const n of nodes)if(n.type==='AssignmentExpression'||n.type==='UpdateExpression'||n.type==='UnaryExpression'&&n.operator==='delete'){
   const left=n.left??n.argument;if(left?.type!=='MemberExpression')continue;
   if(classOf(resolve(left.object))===cls&&(property(left)===undefined||methods.some(m=>key(m)===property(left))))return false;
  }
  const related=nodes.filter(n=>n.type==='Identifier'&&ix.reference(n)&&(resolve(n)===cls||classOf(resolve(n))===cls));
  if(related.some(r=>{const p=parents.get(r);return p?.type==='MemberExpression'&&p.object===r&&property(p)==='prototype';}))return false;
  if(!related.every(r=>{const p=parents.get(r),q=parents.get(p);return p?.type==='NewExpression'&&p.callee===r||p?.type==='MemberExpression'&&p.object===r&&property(p)!==undefined&&(q?.type==='CallExpression'&&q.callee===p||!methods.some(m=>key(m)===property(p)));}))return false;
  function omittedConstructorParameter(value){
   if(value?.type!=='Identifier')return false;
   let factory=parents.get(cls);while(factory&&factory.type!=='FunctionDeclaration')factory=parents.get(factory);
   if(!factory)return false;
   const constructor=cls.body.body.find(m=>m.type==='MethodDefinition'&&m.kind==='constructor');
   const index=constructor?.value.params.findIndex(p=>bindings.get(p.type==='AssignmentPattern'?p.left:p)===bindings.get(value));
   if(index<0)return false;
   const owner=bindings.get(factory.id);return !!owner&&!owner.writes.length&&owner.refs.every(ref=>{const call=parents.get(ref);return call?.type==='NewExpression'&&call.callee===ref&&call.arguments.length<=index;});
  }
 // 构造器里的 Object.assign(this, options) 只有 options 是每次调用点的静态对象，
 // 且键不会覆盖类方法时，才不会改变方法解析。参数只允许用于这次复制。
 function closedConstructorCopy(cls,call){
  if(call.arguments.length!==2||call.arguments[0].type!=='ThisExpression')return false;
  const ctor=cls.body.body.find(m=>m.type==='MethodDefinition'&&m.kind==='constructor');
  const source=call.arguments[1],position=ctor?.value.params.findIndex(p=>bindings.get(p.type==='AssignmentPattern'?p.left:p)===bindings.get(source));
  if(!ctor||position<0)return false;
  const sourceBinding=bindings.get(source);
  if(!sourceBinding||sourceBinding.refs.length!==1||sourceBinding.refs[0]!==source)return false;
  const returned=parents.get(cls);
  if(returned?.type!=='NewExpression'||returned.callee!==cls||parents.get(returned)?.type!=='ReturnStatement')return false;
  const factory=parents.get(parents.get(parents.get(returned)));
  if(!functions.has(factory?.type)||factory.type==='ArrowFunctionExpression'||!factory.id?.name)return false;
  const owner=bindings.get(factory.id);
  if(!owner||owner.writes.length||!owner.refs.length)return false;
  const methods=new Set(cls.body.body.filter(m=>m.type==='MethodDefinition').map(key));
  return owner.refs.every(ref=>{
   const construction=parents.get(ref);
   if(construction?.type!=='NewExpression'||construction.callee!==ref)return false;
   let actual=construction.arguments[position];
   if(!actual||free(actual,'undefined')||actual.type==='UnaryExpression'&&actual.operator==='void')actual=ctor.value.params[position]?.type==='AssignmentPattern'?ctor.value.params[position].right:null;
   if(!actual||actual.type==='Literal'&&actual.value===null)return true;
   return actual.type==='ObjectExpression'&&actual.properties.every(p=>p.type==='Property'&&p.kind==='init'&&!p.method&&!p.computed&&typeof key(p)==='string'&&key(p)!=='__proto__'&&!methods.has(key(p)));
  });
 }
  return nodes.filter(n=>n.type==='ThisExpression'&&classOf(n)===cls).every(r=>{
   const p=parents.get(r);
   if(p?.type==='MemberExpression'&&p.object===r&&property(p)!==undefined)return true;
   if(p?.type==='NewExpression'&&p.arguments.includes(r)){
    const c=resolve(p.callee);if(!['ClassExpression','ClassDeclaration'].includes(c?.type))return false;
    const ctor=c.body.body.find(m=>m.kind==='constructor'),param=ctor?.value.params[p.arguments.indexOf(r)],binding=bindings.get(param);
    return !!binding&&!binding.writes.length&&binding.refs.every(ref=>{const use=parents.get(ref);return use?.type==='AssignmentExpression'&&use.operator==='='&&use.right===ref&&use.left.type==='MemberExpression'&&use.left.object.type==='ThisExpression'&&property(use.left)!==undefined;});
   }
   if(p?.type==='CallExpression'&&p.arguments[0]===r&&p.callee.type==='MemberExpression'&&['call','apply'].includes(property(p.callee))&&resolve(p.callee.object).type==='Identifier')return true;
   return p?.type==='CallExpression'&&p.arguments[0]===r&&p.callee.type==='MemberExpression'&&free(p.callee.object,'Object')&&property(p.callee)==='assign'&&(omittedConstructorParameter(p.arguments[1])||closedConstructorCopy(cls,p));
  });
 }
 function closedMethodCalls(method){
  if(method&&typeof method==='object'&&closedMethodCallsCache.has(method))return closedMethodCallsCache.get(method);
  const result=closedMethodCallsProof(method);
  if(method&&typeof method==='object')closedMethodCallsCache.set(method,result);
  return result;
 }
 function closedMethodCallsProof(method){
  if(method?.type!=='MethodDefinition')return null;
  const cls=parents.get(parents.get(method)),name=key(method);
  if(!cls)return null;
  const collect=()=>nodes.filter(c=>{
   if(c.type!=='CallExpression'||c.optional||c.callee.type!=='MemberExpression'||c.callee.optional||property(c.callee)!==name||c.arguments.some(a=>a.type==='SpreadElement'))return false;
   const receiver=resolve(c.callee.object),classReceiver=['ClassExpression','ClassDeclaration'].includes(receiver?.type);
   if(classOf(receiver)===cls&&method.static===classReceiver)return true;
   if(method.static||c.callee.object.type!=='ThisExpression')return false;
   const owner=owners.get(c.callee.object),ownerMethod=parents.get(owner);
   return ownerMethod?.type==='MethodDefinition'&&!ownerMethod.static&&parents.get(parents.get(ownerMethod))===cls;
  });
  if(!immutableClass(cls)){
   // 有些已审查工厂会先创建实例，随后把同名标识符用于无关的隐式全局。
   // 这种整体标识符赋值不改变方法解析；但仍要求接收者的成员访问可静态
   // 枚举，且没有成员写入覆盖该方法。
   if(nodes.some(n=>{
    if(n.type!=='AssignmentExpression'&&n.type!=='UpdateExpression'&&!(n.type==='UnaryExpression'&&n.operator==='delete'))return false;
    const left=n.left??n.argument;
    return left?.type==='MemberExpression'&&classOf(resolve(left.object))===cls&&(property(left)===undefined||property(left)===name);
   }))return null;
   if(nodes.some(n=>n.type==='MemberExpression'&&classOf(resolve(n.object))===cls&&property(n)===undefined))return null;
   const calls=collect();return calls.length?calls:null;
  }
  const calls=collect();
  return calls.length?calls:null;
 }
 // 只有回调形参本身及其所有调用点都闭合时，才允许把响应快照原样转交。
 // 形参不得逃逸；每次传参都必须是可追溯的本地函数或默认函数。
 function closedCallbackParameter(n){
  if(n?.type!=='Identifier')return false;
  const binding=bindings.get(n);
  if(!binding||binding.writes.length||!binding.refs.length)return false;
  if(!binding.refs.every(ref=>{const p=parents.get(ref);return p?.type==='CallExpression'&&p.callee===ref;}))
   return false;
  const formals=nodes.filter(fn=>functions.has(fn.type)&&fn.params.some(p=>bindings.get(p.type==='AssignmentPattern'?p.left:p)===binding));
  if(formals.length!==1)return false;
  const fn=formals[0],position=fn.params.findIndex(p=>bindings.get(p.type==='AssignmentPattern'?p.left:p)===binding);
  const parent=parents.get(fn),id=fn.id??(parent?.type==='VariableDeclarator'?parent.id:null),fb=id?.type==='Identifier'?bindings.get(id):null;
  let calls;
  if(parent?.type==='MethodDefinition')calls=closedMethodCalls(parent);
  else if(fb&&!fb.writes.length)calls=fb.refs.map(ref=>parents.get(ref));
  else return false;
  if(!calls?.length||calls.some((call,i)=>call?.type!=='CallExpression'||call.optional||call.arguments.some(a=>a.type==='SpreadElement')||parent?.type!=='MethodDefinition'&&call.callee!==fb.refs[i]))return false;
  return calls.every(call=>{
   const parameter=fn.params[position],actual=call.arguments[position]??(parameter?.type==='AssignmentPattern'?parameter.right:null);
   return !!actual&&!!target(actual);
  });
 }
 const compressionNames={ungzip:'gunzip'};
 function compressionMethod(n,seen=new Set()){
  if(n?.type==='MemberExpression'&&free(n.object,'$utils'))return compressionNames[property(n)]??null;
  if(n?.type==='Identifier'){const b=bindings.get(n);if(b?.init&&!b.writes.length&&!seen.has(b)){seen.add(b);return compressionMethod(b.init,seen);}}
  return null;
 }
 // 闭合字面量表的整体引用只有在可证死分支里才可忽略；条件表必须只通过
 // 静态成员读取，否则表中的值可能在求值前已被改写。
 const checkingConstants=new Set();
 function closedConstant(node){
  if(node?.type==='Literal')return {value:node.value};
  if(node?.type!=='MemberExpression'||node.object.type!=='Identifier'||property(node)===undefined)return null;
  const binding=bindings.get(node.object);
  if(!binding||binding.writes.length||binding.init?.type!=='ObjectExpression')return null;
  if(!checkingConstants.has(binding)){
   checkingConstants.add(binding);
   for(const ref of binding.refs){
    const use=parents.get(ref);
    if(use?.type==='MemberExpression'&&use.object===ref){
     const parent=parents.get(use);
     if(parent?.type==='AssignmentExpression'&&parent.left===use||parent?.type==='UpdateExpression'||parent?.type==='UnaryExpression'&&parent.operator==='delete'){checkingConstants.delete(binding);return null;}
     continue;
    }
    if(deadReference(ref))continue;
    checkingConstants.delete(binding);return null;
   }
   checkingConstants.delete(binding);
  }
  const name=property(node),entries=binding.init.properties.filter(entry=>entry.type==='Property'&&entry.kind==='init'&&key(entry)===name);
  if(entries.length!==1||entries[0].value.type!=='Literal')return null;
  return {value:entries[0].value.value};
 }
 function constantBoolean(node){
  if(!node)return null;
  if(node.type==='Literal')return typeof node.value==='boolean'?node.value:null;
  if(node.type==='UnaryExpression'&&node.operator==='!'){const value=constantBoolean(node.argument);return value===null?null:!value;}
  if(node.type==='BinaryExpression'&&['===','==','!==','!='].includes(node.operator)){
   const left=closedConstant(node.left),right=closedConstant(node.right);
   if(!left||!right)return null;
   const equal=left.value===right.value;
   return ['===','=='].includes(node.operator)?equal:!equal;
  }
  return null;
 }
 function deadReference(ref){
  for(let child=ref,parent=parents.get(child);parent;child=parent,parent=parents.get(parent)){
   if(parent.type==='IfStatement'){
    if(child===parent.consequent&&constantBoolean(parent.test)===false)return true;
    if(child===parent.alternate&&constantBoolean(parent.test)===true)return true;
   }
   if(parent.type==='ConditionalExpression'){
    if(child===parent.consequent&&constantBoolean(parent.test)===false)return true;
    if(child===parent.alternate&&constantBoolean(parent.test)===true)return true;
   }
  }
  return false;
 }
 // 方法选择只接受 $httpClient 的静态方法引用，或由它们组成的条件/短路选择。
 // 任一分支不是静态方法就返回 null，调用方继续按未知值拒绝。
 function methodSelection(node){
  if(node?.type==='MemberExpression'&&free(node.object,'$httpClient')){
   const method=clientMethod(node);return typeof method==='string'?method:null;
  }
  if(node?.type==='LogicalExpression'&&node.operator==='||')return methodSelection(node.left);
  if(node?.type==='ConditionalExpression'){
   const left=methodSelection(node.consequent),right=methodSelection(node.alternate);
   return left&&right?[left,right]:null;
  }
  return null;
 }
 function markMethodSelections(node){
  if(node?.type==='ConditionalExpression'){
   httpMethodSelections.add(node);markMethodSelections(node.consequent);markMethodSelections(node.alternate);
  }
 }
 // 闭合三参转发器：函数体只做 `return 方法(请求, 回调)`。表属性必须唯一、
 // 不可写且不能通过动态键访问，表对象的整体引用也只能出现在可证死分支中。
 function forwarderFunction(callee){
  if(functions.has(callee?.type))return callee;
  if(callee?.type==='Identifier'){
   const binding=bindings.get(callee);
   if(binding&&!binding.writes.length){const value=resolve(binding.fn??binding.init);if(functions.has(value?.type))return value;}
   return null;
  }
  if(callee?.type==='MemberExpression'){
   const name=property(callee);if(name===undefined)return null;
   const object=resolve(callee.object);if(object?.type!=='ObjectExpression')return null;
   if(callee.object.type==='Identifier'){
    const binding=bindings.get(callee.object);if(!binding||binding.writes.length)return null;
    for(const ref of binding.refs){
     const member=parents.get(ref);
     if(member?.type==='MemberExpression'&&member.object===ref){
      const memberName=property(member);
      if(memberName===undefined)return null;
      if(memberName===name){
       const use=parents.get(member);
       if(use?.type==='AssignmentExpression'&&use.left===member||use?.type==='UpdateExpression'||use?.type==='UnaryExpression'&&use.operator==='delete')return null;
      }
      continue;
     }
     if(deadReference(ref))continue;
     return null;
    }
   }
   const entries=object.properties.filter(entry=>entry.type==='Property'&&entry.kind==='init'&&!entry.method&&!entry.computed&&key(entry)===name);
   if(entries.length!==1||!functions.has(entries[0].value.type))return null;
   return entries[0].value;
  }
  return null;
 }
 function invocationForwarder(call,seen=new Set()){
  if(call?.type!=='CallExpression'||call.optional||call.arguments.length<2||call.arguments.some(argument=>argument.type==='SpreadElement'))return null;
  const fn=forwarderFunction(call.callee);
  if(!fn||seen.has(fn)||fn.async||fn.generator||fn.params.length!==call.arguments.length||fn.params.some(parameter=>parameter.type!=='Identifier'))return null;
  seen=new Set(seen).add(fn);
  const parameterBindings=fn.params.map(parameter=>bindings.get(parameter));
  if(parameterBindings.some(binding=>!binding||binding.writes.length))return null;
  const body=fn.body.type==='BlockStatement'
   ?fn.body.body.length===1&&fn.body.body[0].type==='ReturnStatement'?fn.body.body[0].argument:null
   :fn.body;
  if(!body||body.type!=='CallExpression'||body.optional||body.arguments.some(argument=>argument.type==='SpreadElement'))return null;
  if(nodes.some(n=>n.start>=fn.start&&n.end<=fn.end&&(n.type==='ThisExpression'||n.type==='Identifier'&&n.name==='arguments'&&!bindings.has(n))))return null;
  if(body.callee.type==='Identifier'&&bindings.get(body.callee)===parameterBindings[0]){
   if(body.arguments.length!==fn.params.length-1)return null;
   for(let index=1;index<fn.params.length;index++){
    const argument=body.arguments[index-1];
    if(argument.type!=='Identifier'||bindings.get(argument)!==parameterBindings[index])return null;
   }
   return fn;
  }
  // 去混淆代码常把恒等转发拆成同序嵌套的多层 helper：外层将全部实参原序
  // 交给另一个闭合转发器，内层再调用首参。只有每层都逐位原序透传才成立。
  if(body.arguments.length!==fn.params.length)return null;
  for(let index=0;index<fn.params.length;index++){
   const argument=body.arguments[index];
   if(argument.type!=='Identifier'||bindings.get(argument)!==parameterBindings[index])return null;
  }
  return invocationForwarder(body,seen)?fn:null;
 }
 function closedForwarder(call){
  return call?.type==='CallExpression'&&call.arguments.length===3&&!!invocationForwarder(call);
 }
 // 条件方法别名只有在所有引用都是直接 HTTP 调用，或作为首参交给上述闭合
 // 转发器时才成立；写回、复制、比较或交给未知代码都拒绝。
 function httpMethodAlias(binding,ref){
  if(!binding||binding.writes.length||!binding.init||binding.init.type!=='ConditionalExpression')return null;
  if(!methodSelection(binding.init))return null;
  for(const use of binding.refs){
   const call=parents.get(use);
   if(call?.type==='CallExpression'&&call.callee===use){
    if(call.optional||call.arguments.length<2||call.arguments.some(argument=>argument.type==='SpreadElement'))return null;
    continue;
   }
   if(call?.type==='CallExpression'&&call.arguments[0]===use&&closedForwarder(call))continue;
   return null;
  }
  markMethodSelections(binding.init);
  return {value:ref,selection:binding.init};
 }
 // 声明渲染早于调用点识别，因此这里从分支反向找到别名根并复用同一证明；
 // 只有根是条件表达式且所有引用都通过调用/转发器检查时才标记。
 function provenMethodRoot(node){
  let root=node;
  while(parents.get(root)?.type==='ConditionalExpression')root=parents.get(root);
  if(httpMethodSelections.has(root))return true;
  const declarator=parents.get(root);
  const binding=declarator?.type==='VariableDeclarator'&&declarator.init===root&&declarator.id.type==='Identifier'?bindings.get(declarator.id):null;
  return !!binding&&!!httpMethodAlias(binding,null);
 }
 function clientMethod(n,seen=new Set()){
  if(n?.type==='MemberExpression'&&free(n.object,'$httpClient')){
   const methodValue=(value,seen=new Set())=>{
    value=resolve(value);if(!value||seen.has(value))return null;seen=new Set(seen);seen.add(value);
    if(value.type==='Literal'&&typeof value.value==='string')return value.value;
    if(value.type==='ConditionalExpression'&&value.test.type==='MemberExpression'){
     const fields=forwardedHTTPFields(value.test.object),field=property(value.test);
     if(fields&&field!==undefined&&!fields.has(field))return methodValue(value.alternate,seen);
    }
    return null;
   };
   const name=n.computed?methodValue(n.property):property(n);
   if(typeof name==='string')return name;
   if(n.computed){if(!dynamicMethods.has(n))dynamicMethods.set(n,{expression:n.property});return dynamicMethods.get(n);}
   return null;
  }
  if(n?.type==='ConditionalExpression'&&methodSelection(n)){markMethodSelections(n);return {value:n,selection:n};}
  if(n?.type==='Identifier'){
   const b=bindings.get(n);
   if(b?.init&&!b.writes.length&&!seen.has(b)){
    const alias=httpMethodAlias(b,n);
    if(alias)return alias;
    seen.add(b);return clientMethod(b.init,seen);
   }
  }
  if(n?.type==='LogicalExpression'&&n.operator==='||')return clientMethod(n.left,new Set(seen));
  return null;
 }
 function httpDispatch(n){
  if(n?.type!=='CallExpression'||n.optional||n.arguments.some(argument=>argument.type==='SpreadElement'))return null;
  const method=clientMethod(n.callee);
  if(method)return {method,request:n.arguments[0],callback:n.arguments[1],call:n};
  if(n.arguments.length!==3||!closedForwarder(n))return null;
  const forwarded=clientMethod(n.arguments[0]);
  if(!forwarded)return null;
  // 完成回调经转发器时还没有完成流证明，保持失败关闭，不让回调绕过终止分析。
  if(complete.has(target(n.arguments[2])))return null;
  return {method:forwarded,request:n.arguments[1],callback:n.arguments[2],call:n};
 }
 function terminal(n){
  // 逗号序列的完成结果由最后一个操作数决定；前面的操作数只保留求值顺序。
  // 只有末项可证完成时才把整个序列视为完成，避免把中途 side effect 当成结果。
  if(n?.type==='SequenceExpression')return terminal(n.expressions.at(-1));
  if(n?.type!=='CallExpression')return false;
  if(isDone(n))return true;
  if(clientMethod(n.callee)&&complete.has(target(n.arguments[1])))return true;
  if(free(n.callee,'setTimeout')&&[1,2].includes(n.arguments.length)&&complete.has(target(n.arguments[0])))return true;
  // setTimeout(show(), delay) calls show immediately; it does not pass show
  // as a callback. If show completes the script, propagate that result at
  // this call site instead of treating the call result as a delayed handler.
  if(free(n.callee,'setTimeout')&&[1,2].includes(n.arguments.length)&&n.arguments[0]?.type==='CallExpression'&&terminal(n.arguments[0]))return true;
  const fn=target(n.callee);if(fn&&complete.has(fn))return true;
  return n.callee.type==='MemberExpression'&&['then','catch','finally'].includes(property(n.callee))&&(terminal(n.callee.object)||n.arguments.some(x=>complete.has(target(x))));
 }
 function terminalExpression(n){
  if(!n)return false;
  if(n.type==='ConditionalExpression')return terminalExpression(n.consequent)&&terminalExpression(n.alternate);
  return terminal(n)||n.type==='AwaitExpression'&&terminal(n.argument);
 }
 function terminalConditional(n){
  for(let child=n,p=parents.get(child);p;child=p,p=parents.get(p)){
   if(p.type==='ConditionalExpression'){if(child!==p.consequent&&child!==p.alternate)return false;continue;}
   return p.type==='ExpressionStatement'&&terminalExpression(p.expression);
  }
  return false;
 }
 for(const n of nodes)if(isDone(n))complete.add(owners.get(n));
 for(const n of nodes){
  if(n.type==='Identifier'&&ix.reference(n)&&compressionMethod(n)){
   const p=parents.get(n);
   if(!(p?.type==='CallExpression'&&p.callee===n)&&!(p?.type==='VariableDeclarator'&&p.init===n))fail(n,'压缩 API 别名逃逸，无法传播 await');
  }
  if(isDone(n))complete.add(owners.get(n));
  if(n.type==='AwaitExpression'||n.async||n.type==='CallExpression'&&clientMethod(n.callee)&&complete.has(target(n.arguments[1])))asyncFns.add(owners.get(n));
  if(n.type==='CallExpression'&&compressionMethod(n.callee)){asyncFns.add(owners.get(n));lifted.add(owners.get(n));}
 }
 // 已完成状态机回调的 `.wrap` 是完成路径的闭合消费者：证明要求状态图
 // 完整、入口子图无环且回调内恰有一个完成调用。传播后，同脚本中的非完成
 // HTTP 辅助请求可沿用既有的“存在另一条完成路径”证明。
 const closedRegeneratorCompletion=call=>{
  if(call.type!=='CallExpression'||call.callee.type!=='MemberExpression'||property(call.callee)!=='wrap')return false;
  const callback=target(call.arguments[0]);if(!callback||!complete.has(callback))return false;
  return !!closedRegeneratorConsumer(ix,source,call,callback,node=>isDone(node)||complete.has(target(node.callee)));
 };
 let changed=true;while(changed){changed=false;for(const n of nodes)if(n.type==='CallExpression'){
  if(closedRegeneratorCompletion(n)){if(!complete.has(owners.get(n))){complete.add(owners.get(n));changed=true;}if(!complete.has(tree)){complete.add(tree);changed=true;}}
  if(clientMethod(n.callee)&&complete.has(target(n.arguments[1]))&&!asyncFns.has(owners.get(n))){asyncFns.add(owners.get(n));changed=true;}
  const fn=target(n.callee);if(terminal(n)&&!complete.has(owners.get(n))){complete.add(owners.get(n));changed=true;}
  if(fn&&asyncFns.has(fn)&&(!fn.async||complete.has(fn)||lifted.has(fn))&&!asyncFns.has(owners.get(n))){asyncFns.add(owners.get(n));changed=true;}
  if(fn&&lifted.has(fn)&&!fn.async&&!lifted.has(owners.get(n))){lifted.add(owners.get(n));changed=true;}
 }}
 structured ||= nodes.some(n=>n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&property(n.callee)==='finally'&&n.arguments.some(a=>complete.has(target(a))));
 structured ||= nodes.some(n=>n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&['then','catch','finally'].includes(property(n.callee))&&terminal(n.callee.object));
 structured ||= generatedFunctions.size>0&&nodes.some(n=>n.type==='CallExpression'&&complete.has(target(n.callee))&&['LogicalExpression','ConditionalExpression'].includes(parents.get(n)?.type));
 structured ||= [...complete].some(fn=>fn!==tree&&[...exits(fn.body)].some(path=>path==='return'||path==='continue'));
 structured ||= nodes.some(n=>n.type==='NewExpression'&&free(n.callee,'Promise')&&complete.has(target(n.arguments[0])));
 structured ||= nodes.some(n=>n.type==='CallExpression'&&free(n.callee,'setTimeout')&&[1,2].includes(n.arguments.length)&&complete.has(target(n.arguments[0])));
 // 展开/数组中的完成函数没有可证明的调用契约，必须进入结构化校验后拒绝。
 structured ||= nodes.some(n=>(n.type==='SpreadElement'||n.type==='ArrayExpression')&&nodes.some(c=>c.start>=n.start&&c.end<=n.end&&isDone(c)));
 // Root Promise completion with trailing Date method installation needs the
 // structured final join to preserve the original synchronous launch point.
 const rootCompletionChains=nodes.filter(n=>n.type==='CallExpression'&&owners.get(n)===tree&&n.callee.type==='MemberExpression'&&['then','catch','finally'].includes(property(n.callee))&&terminal(n));
 structured ||= rootCompletionChains.length>0&&nodes.some(n=>n.type==='AssignmentExpression'&&n.operator==='='&&n.left.type==='MemberExpression'&&n.left.object.type==='MemberExpression'&&property(n.left.object)==='prototype'&&free(n.left.object.object,'Date')||n.type==='VariableDeclaration'&&owners.get(n)===tree&&rootCompletionChains.some(c=>n.start>c.end));
 // Ignored asynchronous completion calls can retain their launch point and
 // concurrency using a native Promise result, rather than being awaited here.
 const ignoredConcurrent=n=>{
  if(n.type!=='CallExpression'||parents.get(n)?.type!=='ExpressionStatement'||!complete.has(target(n.callee))||!asyncFns.has(target(n.callee)))return false;
  for(let child=parents.get(n),p=parents.get(child);p;child=p,p=parents.get(p)){
   if(['Program','BlockStatement'].includes(p.type)&&p.body.slice(p.body.indexOf(child)+1).some(s=>!['FunctionDeclaration','EmptyStatement'].includes(s.type)))return true;
   if(['ForStatement','ForInStatement','ForOfStatement','WhileStatement','DoWhileStatement'].includes(p.type))return true;
   if(functions.has(p.type))break;
  }
  return false;
 };
 structured ||= nodes.some(ignoredConcurrent);
 const pending=!structured?pendingCompletion(ix,complete,asyncFns,target):null;
 const pendingResult=pending?fresh('pendingResult'):null;
 const pendingFinished=pending?fresh('pendingFinished'):null;
 if(pending)prefix.push('let '+pendingResult+'; let '+pendingFinished+' = false;');
 // 完成实参可能先经过闭合 helper，而 helper 正文会在 $done 投影前渲染。
 // 先求形可登记其中整体读取的宿主消息，避免合法的 return $response 被
 // 后续字段检查误判为对象逃逸；任何不可证形状仍在这里失败。
 // 这里只是提前登记宿主消息，真正的形状判定仍由 payload 完成；
 // 预处理失败时保持原行为，避免把调度/字符串完成等合法路径一并拒绝。
 for(const n of nodes)if(n.type==='CallExpression'&&n.arguments.length===1&&n.arguments[0].type!=='SpreadElement'&&
  isDone(n)&&['Identifier','CallExpression','AwaitExpression','SequenceExpression','ConditionalExpression','LogicalExpression'].includes(n.arguments[0].type)){try{shape(n.arguments[0]);}catch{}}
  // 完成包装函数可能先接收宿主响应别名；提前求解形，登记可安全投影正文写入的
  // 参数绑定，避免 helper 正文先于完成投影渲染时漏掉本地正文变量。
  for(const n of nodes)if(n.type==='CallExpression'&&n.arguments.length===1&&n.arguments[0].type!=='SpreadElement'&&target(n.callee)&&complete.has(target(n.callee))){try{shape(n.arguments[0]);}catch{}}
 function closedCompletionCallback(call,arg){
  const fn=target(call?.callee),position=call?.arguments.indexOf(arg),p=fn?.params[position],id=p?.type==='AssignmentPattern'?p.left:p,b=id?.type==='Identifier'?bindings.get(id):null;
  return !!b&&!b.writes.length&&b.refs.length>0&&b.refs.every(r=>{const c=parents.get(r);return c?.type==='CallExpression'&&c.callee===r&&target(r)===target(arg);});
 }
 function exits(n){
  if(!n)return new Set(['continue']);
  if(terminal(n)||n.type==='AwaitExpression'&&terminal(n.argument))return new Set(['complete']);
  if(['Program','BlockStatement'].includes(n.type)){
   const out=new Set(['continue']);for(const s of n.body)if(out.delete('continue'))for(const x of exits(s))out.add(x);return out;
  }
  if(n.type==='ReturnStatement')return new Set([n.argument&&terminal(n.argument.type==='AwaitExpression'?n.argument.argument:n.argument)?'complete':'return']);
  if(n.type==='ThrowStatement')return new Set(['complete']);
  if(n.type==='ExpressionStatement'){
   const e=n.expression;if(terminal(e)||e.type==='AwaitExpression'&&terminal(e.argument))return new Set(['complete']);
   if(e.type==='CallExpression'&&clientMethod(e.callee)&&complete.has(target(e.arguments[1])))return new Set(['complete']);
  }
  if(n.type==='IfStatement')return new Set([...exits(n.consequent),...exits(n.alternate)]);
  if(n.type==='TryStatement')return new Set([...exits(n.block),...(n.handler?exits(n.handler.body):[])]);
  if(['WhileStatement','DoWhileStatement','ForStatement','ForInStatement','ForOfStatement'].includes(n.type))return new Set(['continue',...exits(n.body)]);
  return new Set(['continue']);
 }
 if(!structured){
 for(const fn of complete)if(fn!==tree){const paths=exits(fn.body);if(paths.has('return')||paths.has('continue'))fail(fn,'完成函数存在不返回完成结果的路径，不能直接传播 return');}
 // A completion callback cannot escape to an arbitrary higher-order function.
 function tail(statement){
  let child=statement;
  for(let p=parents.get(child);p;child=p,p=parents.get(p)){
   if(['Program','BlockStatement'].includes(p.type)){
    const rest=p.body.slice(p.body.indexOf(child)+1);
    if(rest.some(s=>!['FunctionDeclaration','EmptyStatement'].includes(s.type)))return false;
   }
   if(p===owners.get(statement))break;
  }
  return true;
 }
 for(const n of nodes){
  if(functions.has(n.type)&&(complete.has(n)||lifted.has(n))){
   const p=parents.get(n);
   if(p?.type==='MethodDefinition'||p?.type==='Property'){
    if(!nodes.some(c=>c.type==='CallExpression'&&target(c.callee)===n)&&!closedMethodCallers(ix,n))fail(n,'完成／压缩方法 '+String(key(p))+' 的调用者未能静态解析，需展开对象／继承类工厂与回调传递；这不是不支持 JavaScript 方法语法');
   }
  }
  if(functions.has(n.type)&&lifted.has(n)){
   const p=parents.get(n);
   if(p?.type==='MethodDefinition'&&p.kind!=='method')fail(n,'压缩异步结果不能传播到构造器或访问器');
   const b=n.id?bindings.get(n.id):p?.type==='VariableDeclarator'?bindings.get(p.id):null;
   if(b?.refs.some(r=>{const q=parents.get(r);return !(q?.type==='CallExpression'&&q.callee===r)&&!(q?.type==='VariableDeclarator'&&q.init===r);}))fail(n,'压缩异步函数作为回调或值逃逸，无法传播 await');
   if(p?.type==='CallExpression'&&p.callee!==n)fail(n,'压缩异步回调不能交给同步高阶函数');
  }
  if(n.type==='Identifier'&&ix.reference(n)&&complete.has(target(n))){
   const p=parents.get(n);
   if(p?.type==='UnaryExpression'&&p.operator==='typeof')continue;
   const direct=p?.type==='CallExpression'&&p.callee===n;
   const alias=p?.type==='VariableDeclarator'&&p.init===n;
   const callback=p?.type==='CallExpression'&&p.callee.type==='MemberExpression'&&['then','catch'].includes(property(p.callee))||p?.type==='CallExpression'&&(clientMethod(p.callee)&&p.arguments[1]===n||closedCompletionCallback(p,n));
   if(!direct&&!alias&&!callback)fail(n,'完成函数引用逃逸，无法证明返回值传播');
  }
  if(n.type==='Identifier'&&ix.reference(n)&&lifted.has(target(n))&&!target(n).async){
   const p=parents.get(n);
   if(!(p?.type==='CallExpression'&&p.callee===n)&&!(p?.type==='VariableDeclarator'&&p.init===n))fail(n,'压缩异步函数别名逃逸，无法传播 await');
   if(p?.type==='VariableDeclarator'&&(p.id.type!=='Identifier'||bindings.get(p.id)?.writes.length))fail(n,'压缩异步函数别名被重新赋值，无法传播 await');
  }
  if(n.type==='TryStatement'&&n.finalizer&&nodes.some(x=>owners.get(x)===owners.get(n)&&x.start>=n.block.start&&x.end<=(n.handler?.end??n.block.end)&&(isDone(x)||terminal(x))))fail(n,'完成操作跨越 finally，无法用原生 return 保证原有终止顺序');
  if(n.type==='MemberExpression'&&property(n)==='finally'&&terminal(n.object))fail(n,'完成操作之后的 Promise.finally 无法安全改写');
  if(n.type==='MemberExpression'&&property(n)==='then'&&terminal(n.object))fail(n,'完成操作之后还有 then 续接，无法用原生 return 阻止后续执行');
  if(n.type==='ExpressionStatement'&&terminal(n.expression)){
   const e=n.expression,fn=target(e.callee);
   const asyncCompletion=e.type==='CallExpression'&&(fn&&asyncFns.has(fn)||clientMethod(e.callee)||e.callee.type==='MemberExpression'&&['then','catch'].includes(property(e.callee)));
   if(asyncCompletion&&!tail(n)&&!pending?.calls.has(e))fail(n,'未等待的完成任务后还有语句，可能并发执行，不能直接传播 return');
  }
  if(n.type==='SequenceExpression'){
   // 非末项若经嵌套函数或完成函数引用触发完成，转换只能从嵌套函数返回，
   // 外层仍会继续求值后续项；只有同一 owner 内的直接完成调用能立即 return。
   for(const part of n.expressions.slice(0,-1)){
    const within=node=>node.start>=part.start&&node.end<=part.end;
    const nestedCompletion=nodes.some(node=>within(node)&&isDone(node)&&owners.get(node)!==owners.get(n));
    const indirectTerminal=nodes.some(node=>within(node)&&node.type==='CallExpression'&&!isDone(node)&&terminal(node));
    if(nestedCompletion||indirectTerminal)fail(part,'逗号序列前项含完成操作但后续操作数仍会执行，无法保持原始终止顺序');
   }
  }
  if(functions.has(n.type)&&complete.has(n)){
   const p=parents.get(n);
   if(p?.type==='CallExpression'&&p.callee!==n){const m=p.callee.type==='MemberExpression'?property(p.callee):null;if(!['then','catch'].includes(m)&&!clientMethod(p.callee)&&!closedCompletionCallback(p,n)&&!closedIdentityMethodCall(ix,p,n))fail(n,'完成函数作为回调传递，无法证明全局终止流程');}
   if(p?.type==='NewExpression')fail(n,'Promise 执行器中的完成操作不能直接改写为 return');
  }
  if(n.type==='CallExpression'&&terminal(n)){
   const p=parents.get(n);
   // 逗号表达式作为独立语句时，各操作数的值都被丢弃；完成调用在其中
   // 仍然只负责终止流程，不会把完成结果当成业务返回值继续传播。
   let sequence=p;
   while(sequence?.type==='SequenceExpression')sequence=parents.get(sequence);
   const discardedSequence=p?.type==='SequenceExpression'&&sequence?.type==='ExpressionStatement';
   if(!discardedSequence&&!['ExpressionStatement','ReturnStatement','ArrowFunctionExpression'].includes(p?.type)&&!(p?.type==='AwaitExpression'&&['ExpressionStatement','ReturnStatement'].includes(parents.get(p)?.type))&&!(p?.type==='MemberExpression'&&['then','catch'].includes(property(p)))&&!(p?.type==='CallExpression'&&free(p.callee,'setTimeout')&&p.arguments[0]===n&&terminal(p))&&!terminalConditional(n))fail(n,'完成操作嵌入表达式，无法证明返回值传播');
  }
  if(isAPI(n,'$task','fetch')){
   const p=parents.get(n),gp=parents.get(p);
   if(!(p?.type==='AwaitExpression'&&(gp?.type==='VariableDeclarator'&&gp.id.type==='Identifier'||gp?.type==='ExpressionStatement'))&&!(p?.type==='MemberExpression'&&property(p)==='then'))fail(n,'HTTP 响应必须保存到局部变量或在 then 回调中读取，不能隐式模拟旧响应对象');
  }
 }
 }
 function resolve(n,seen){
  const root=seen===undefined,cacheable=root&&n&&typeof n==='object';
  if(cacheable&&resolveCache.has(n))return resolveCache.get(n);
  const result=resolveNode(n,root?new Set():seen);
  if(cacheable)resolveCache.set(n,result);
  return result;
 }
 function resolveNode(n,seen){
  if(fieldValues.has(n))return resolve(fieldValues.get(n),seen);
  if(n?.type!=='Identifier')return n;
  const b=bindings.get(n);if(b?.init&&!b.writes.length&&!seen.has(b)){seen.add(b);return resolve(b.init,seen);}return n;
 }
 function object(n,label){
  const b=n?.type==='Identifier'?bindings.get(n):null;
  if(b){
   if(b.writes.length)fail(n,label+' 在声明后被整体重绑，需要先确定字段的数据流');
   const consoleMethods=new Set(['log','warn','error','info','debug']);
   const closedConsole=nodes.filter(x=>free(x,'console')).every(ref=>{
    const member=parents.get(ref),call=parents.get(member);
    return member?.type==='MemberExpression'&&member.object===ref&&consoleMethods.has(property(member))&&call?.type==='CallExpression'&&call.callee===member;
   });
   for(const ref of b.refs){
    const p=parents.get(ref),a=parents.get(p);
    if(p?.type==='MemberExpression'&&p.object===ref&&(a?.type==='AssignmentExpression'&&a.left===p||a?.type==='UpdateExpression'||a?.type==='UnaryExpression'&&a.operator==='delete'))fail(p,label+' 在声明后被修改，需要先确定字段的数据流');
    if(p?.type==='VariableDeclarator'&&p.init===ref&&p.id.type==='Identifier')fail(ref,label+' 的别名复制无法证明对象身份不逃逸');
    if(p?.type==='CallExpression'&&p.arguments.includes(ref)){
     const callee=p.callee;
     if(callee.type==='MemberExpression'&&free(callee.object,'JSON')&&property(callee)==='stringify'||free(callee,'$log'))continue;
     if(callee.type==='MemberExpression'&&free(callee.object,'console')&&closedConsole)continue;
     if(callee.type==='MemberExpression'&&free(callee.object,'Object')&&property(callee)==='assign'&&p.arguments[0]?.type==='ObjectExpression'&&!p.arguments[0].properties.length&&p.arguments[1]===ref)continue;
     if(callee.type==='MemberExpression'&&free(callee.object,'$httpClient')||callee.type==='MemberExpression'&&free(callee.object,'$task')&&property(callee)==='fetch')continue;
     // 请求记录作为闭合三参转发器的第二个实参时，转发器只做
     // 方法(请求, 回调)的原序转交；该调用点本身仍是可证明的 HTTP 派发。
     if(p.arguments[1]===ref&&closedForwarder(p)&&httpDispatch(p))continue;
     fail(ref,label+' 被传给未知函数，无法证明对象身份不逃逸');
    }
   }
  }
  n=resolve(n);if(n?.type!=='ObjectExpression')fail(n??tree,label+' 必须是可静态追溯的对象');
  const fields=new Map();
  for(const p of n.properties){
   if(p.type==='SpreadElement'){
    const binding=p.argument.type==='Identifier'&&bindings.get(p.argument);
    if(binding&&closedHostResponseSnapshotBindings.has(binding)){
     for(const [k,v] of shape(p.argument))fields.set(k,v);
     continue;
    }
    fail(p,label+' 含动态字段或展开，无法证明可原生转换');
   }
   if(p.type!=='Property'||p.kind!=='init'||p.computed&&key(p)===undefined)fail(p,label+' 含动态字段或展开，无法证明可原生转换');
   fields.set(String(key(p)),p.value);
  }
  return fields;
 }
 function promiseValue(n,seen=new Set()){
  if(!n||seen.has(n))return false;seen.add(n);
  if(factoryPromises.has(n))return true;
  if(n.type==='Identifier')return promiseValue(resolve(n),seen);
  if(n.type==='NewExpression'&&free(n.callee,'Promise'))return true;
  if(n.type!=='CallExpression')return false;
  if(n.callee.type==='MemberExpression'){
   if(free(n.callee.object,'Promise')&&['resolve','reject','all','allSettled','race','any'].includes(property(n.callee)))return true;
   if(['then','catch','finally'].includes(property(n.callee)))return promiseValue(n.callee.object,seen);
  }
  const fn=target(n.callee);if(fn?.async)return true;
  if(fn?.body.type==='BlockStatement'&&fn.body.body.at(-1)?.type==='ReturnStatement'){
   const returns=nodes.filter(r=>r.type==='ReturnStatement'&&ix.owners.get(r)===fn);
   return returns.length>0&&returns.every(r=>promiseValue(r.argument,new Set(seen)));
  }
  return false;
 }
 function mergeShape(fields,incoming,seen){
   if(incoming.hostResponse)fields.hostResponse=true;
   if(incoming.hostRequest)fields.hostRequest=true;
   if(incoming.nullable){
    const alreadyNullable=fields.nullable;
    fields.undefinedOnly=alreadyNullable?!!(fields.undefinedOnly&&incoming.undefinedOnly):!!incoming.undefinedOnly;
    fields.nullable=true;
    // undefined 与其他可空来源必须分开记录；`typeof value === "object"`
    // 只能排除 undefined，不能同时证明 null 已被排除。
   }
  for(const [k,v] of incoming){
   if(k==='abort')fields.abortValues=[...(fields.abortValues??(fields.has(k)?[fields.get(k)]:[])),...(incoming.abortValues??[v])];
   if(k==='response'){
    fields.responseFields??=fields.has(k)?shape(fields.get(k),new Set(seen)):new Map();
    mergeShape(fields.responseFields,incoming.responseFields??shape(v,new Set(seen)),seen);
   }
   fields.set(k,v);
  }
  return fields;
 }
 function copyShape(source){
  const copy=new Map(source);
  for(const key of ['nullable','undefinedOnly','hostResponse','hostRequest','responseFields','variants','abortValues'])
   if(source[key]!==undefined)copy[key]=source[key];
  return copy;
 }
 // 只合并函数所有实际 return 的静态形状；Promise 回调参数必须能追到同一个
 // 异步函数的返回集合，不能把 Promise 对象本身当成完成结果。
 function returnedShape(fn,seen=new Set()){
  if(!fn||fn.generator||seen.has(fn))return null;
  const next=new Set(seen);next.add(fn);
  const returns=nodes.filter(n=>n.type==='ReturnStatement'&&owners.get(n)===fn);
  if(!returns.length)return null;
  const fields=new Map();
  for(const statement of returns){
   const argument=statement.argument;
   if(!argument||argument.type==='UnaryExpression'&&argument.operator==='void'){fields.nullable=true;fields.undefinedOnly=true;continue;}
   if(argument.type==='Literal'&&argument.value===null){fields.nullable=true;continue;}
   const value=shape(argument,new Set(next));
   if(!value)return null;
   mergeShape(fields,value,next);
  }
  return fields;
 }
 function promiseShape(n,seen=new Set()){
  if(n?.type==='AwaitExpression')return promiseShape(n.argument,seen);
  if(n?.type==='Identifier'){const b=bindings.get(n);if(b?.init&&!b.writes.length)return promiseShape(b.init,seen);}
  if(n?.type==='CallExpression'){
   const fn=target(n.callee);
   if(fn?.async)return returnedShape(fn,seen);
  }
  return null;
 }
 function promiseResolverShape(n,seen=new Set()){
  if(n?.type!=='NewExpression'||!free(n.callee,'Promise')||n.arguments.length!==1)return null;
  const executor=functions.has(n.arguments[0].type)?n.arguments[0]:target(n.arguments[0]);
  if(!executor||executor.async||executor.generator||executor.params[0]?.type!=='Identifier')return null;
  const resolver=bindings.get(executor.params[0]);
  if(!resolver||resolver.writes.length||!resolver.refs.length)return null;
  const calls=resolver.refs.map(ref=>{const call=parents.get(ref);return call?.type==='CallExpression'&&call.callee===ref&&call.arguments.length===1&&call.arguments[0].type!=='SpreadElement'?call:null;});
  if(calls.some(call=>!call))return null;
  const fields=new Map();
  for(const call of calls)mergeShape(fields,shape(call.arguments[0],new Set(seen)),seen);
  return fields;
 }
 function hostResponseShape(binding){
  const fn=nodes.find(candidate=>functions.has(candidate.type)&&candidate.params.some(parameter=>bindings.get(parameter.type==='AssignmentPattern'?parameter.left:parameter)===binding));
  const call=fn&&parents.get(fn);
  // globalThis.$httpClient 与裸 $httpClient 指向同一宿主注册入口；两者都必须
  // 来自自由全局引用，局部遮蔽仍不能获得响应字段证明。
  const client=call?.callee?.type==='MemberExpression'&&(free(call.callee.object,'$httpClient')||call.callee.object.type==='MemberExpression'&&free(call.callee.object.object,'globalThis')&&property(call.callee.object)==='$httpClient');
  if(!call||call.type!=='CallExpression'||call.callee.type!=='MemberExpression'||!client||!call.arguments.includes(fn))return null;
  const allowed=new Set(['status','statusCode','statusText','headers','body','bodyBytes','ok']);
  const fields=new Map();
  for(const ref of binding.refs){
   const member=parents.get(ref),field=property(member);
   if(member?.type==='MemberExpression'&&member.object===ref&&field!==undefined&&allowed.has(String(field))){
    if(field==='statusCode'){if(!fields.has('status'))fields.set('status',member);}
    else if(field!=='statusText'&&field!=='ok')fields.set(String(field),member);
    continue;
   }
   const resolverCall=parents.get(ref);
   const calleeBinding=resolverCall?.type==='CallExpression'&&resolverCall.callee.type==='Identifier'?bindings.get(resolverCall.callee):null;
   const executor=calleeBinding&&nodes.find(candidate=>functions.has(candidate.type)&&bindings.get(candidate.params[0])===calleeBinding);
   const construction=executor&&parents.get(executor);
   if(resolverCall?.type==='CallExpression'&&resolverCall.arguments.includes(ref)&&construction?.type==='NewExpression'&&free(construction.callee,'Promise'))continue;
   return null;
  }
  return fields;
 }
 function completionTruthyGuard(n,binding){
  const completion=parents.get(n),guard=parents.get(completion);
  if(completion?.type!=='CallExpression'||!isDone(completion)||!completion.arguments.includes(n))return false;
  let branch=completion;
  for(let parent=guard;parent;parent=parents.get(parent)){
   if(parent.type==='ExpressionStatement'||parent.type==='BlockStatement'&&parent.body.length===1&&parent.body[0]===branch){branch=parent;continue;}
   const test=parent?.type==='ConditionalExpression'&&parent.consequent===branch||parent?.type==='IfStatement'&&parent.consequent===branch?parent.test:null;
   return test?.type==='Identifier'&&bindings.get(test)===binding?test:null;
  }
  return null;
 }
 function truthyGuarded(n){
  const binding=bindings.get(n);
  if(!binding)return false;
  const same=test=>test?.type==='Identifier'&&bindings.get(test)===binding;
  for(let child=n,parent=parents.get(child);parent&&!functions.has(parent.type);child=parent,parent=parents.get(child)){
   if(parent.type==='IfStatement'&&parent.consequent===child&&same(parent.test))return true;
   if(parent.type==='ConditionalExpression'&&parent.consequent===child&&same(parent.test))return true;
   if(parent.type==='LogicalExpression'&&parent.operator==='&&'&&parent.right===child&&same(parent.left))return true;
  }
  return false;
 }
 // 静态表中所有候选函数都没有返回值时，动态键调用只可能得到 undefined。
 // 这里仅接受不可改写的局部字面量表；任何写入、删除、逃逸或未知候选都拒绝。
 function noValueFunction(fn){
  if(!functions.has(fn?.type)||fn.async||fn.generator)return false;
  return nodes.filter(statement=>statement.type==='ReturnStatement'&&owners.get(statement)===fn)
   .every(statement=>!statement.argument||statement.argument.type==='UnaryExpression'&&statement.argument.operator==='void');
 }
 function closedNoValueTableCall(binding){
  if(!binding||binding.writes.length||binding.init?.type!=='MemberExpression'||property(binding.init)!==undefined)return false;
  const tableName=binding.init.object,table=resolve(tableName);
  if(!tableName||table.type!=='ObjectExpression'||!table.properties.length)return false;
  if(tableName.type==='Identifier'){
   const owner=bindings.get(tableName);
   if(!owner||owner.writes.length||!owner.refs.length)return false;
   const readable=owner.refs.every(ref=>{
    const member=parents.get(ref),use=parents.get(member);
    return member?.type==='MemberExpression'&&member.object===ref&&(property(member)!==undefined||member===binding.init)&&
     !(use?.type==='AssignmentExpression'&&use.left===member)&&use?.type!=='UpdateExpression'&&
     !(use?.type==='UnaryExpression'&&use.operator==='delete')&&!(use?.type==='CallExpression'&&use.callee===member);
   });
   if(!readable)return false;
  }
  const result=table.properties.every(entry=>entry.type==='Property'&&entry.kind==='init'&&key(entry)!==undefined&&entry.value.type!=='SpreadElement'&&noValueFunction(target(entry.value)));
  return result;
 }
 function knownUndefined(n,seen=new Set()){
  if(!n||seen.has(n))return false;seen.add(n);
  if(n.type==='UnaryExpression'&&n.operator==='void')return true;
  if(n.type==='Identifier'){
   const binding=bindings.get(n);
   return !!binding&&!binding.writes.length&&knownUndefined(binding.init,seen);
  }
  if(n.type==='CallExpression'){
   if(n.callee.type==='Identifier'&&closedNoValueTableCall(bindings.get(n.callee)))return true;
   return noValueFunction(target(n.callee));
  }
  return false;
 }
 function knownBoolean(n){
  if(!n)return null;
  if(n.type==='Literal')return !!n.value;
  if(knownUndefined(n))return false;
  if(n.type==='UnaryExpression'&&n.operator==='!'){const value=knownBoolean(n.argument);return value===null?null:!value;}
  if(n.type==='LogicalExpression'&&n.operator==='&&'){
   const left=knownBoolean(n.left);
   if(left===false)return false;
   if(left===true)return knownBoolean(n.right);
  }
  return null;
 }
 function typeGuarded(n,type){
  const binding=bindings.get(n);
  if(!binding)return false;
  const same=test=>test?.type==='Identifier'&&bindings.get(test)===binding;
  const typeofCheck=test=>test?.type==='UnaryExpression'&&test.operator==='typeof'&&same(test.argument);
  for(let child=n,parent=parents.get(child);parent&&!functions.has(parent.type);child=parent,parent=parents.get(child)){
   if(parent.type==='SwitchCase'&&parent.test?.type==='Literal'&&parent.test.value===type){
    const statement=parents.get(parent);
    if(statement?.type==='SwitchStatement'&&typeofCheck(statement.discriminant))return true;
   }
   if(parent.type==='BinaryExpression'&&['===','=='].includes(parent.operator)){
    const [left,right]=parent.left===child?[parent.left,parent.right]:[parent.right,parent.left];
    if(typeofCheck(left)&&right.type==='Literal'&&right.value===type)return true;
   }
  }
  return false;
 }
 function returnedRecordOwner(record){
  if(record?.type!=='ObjectExpression')return null;
  let value=record,returned=parents.get(value);
  while(returned?.type==='SequenceExpression'&&returned.expressions.at(-1)===value){value=returned;returned=parents.get(value);}
  return returned?.type==='ReturnStatement'&&returned.argument===value?owners.get(returned):null;
 }
 // 包装记录只有在所有调用点都被 await 后按同一静态字段解构时，字段值才保持
 // 原对象身份；把包装记录交给未知代码或动态键读取仍然拒绝。
 function returnedRecordFieldDestructured(fn,field){
  if(!fn)return false;
  const binding=fn.id&&bindings.get(fn.id);
  if(binding&&(binding.writes.length||binding.refs.some(ref=>{const call=parents.get(ref);return call?.type!=='CallExpression'||call.callee!==ref;})))return false;
  const calls=nodes.filter(call=>call.type==='CallExpression'&&target(call.callee)===fn);
  return calls.length>0&&calls.every(call=>{
   const awaited=parents.get(call),assignment=parents.get(awaited);
   return awaited?.type==='AwaitExpression'&&awaited.argument===call&&assignment?.type==='AssignmentExpression'&&assignment.operator==='='&&assignment.right===awaited&&assignment.left.type==='ObjectPattern'&&assignment.left.properties.some(property=>property.type==='Property'&&!property.computed&&key(property)===field&&property.value.type==='Identifier');
  });
 }
 function returnsArgumentAsField(fn,position,field){
  if(!fn)return false;
  const parameter=fn.params[position],binding=parameter&&bindings.get(parameter.type==='AssignmentPattern'?parameter.left:parameter);
  if(!binding||binding.writes.length)return false;
  const returns=nodes.filter(returned=>returned.type==='ReturnStatement'&&owners.get(returned)===fn);
  if(returns.length!==1)return false;
  return binding.refs.some(ref=>{
   const p=parents.get(ref);
   return p?.type==='Property'&&p.value===ref&&!p.computed&&key(p)===field&&returnedRecordOwner(parents.get(p))===fn;
  })&&returnedRecordFieldDestructured(fn,field);
 }
 function closedShapeFlow(binding,seen=new Set()){
  if(!binding||seen.has(binding))return false;
  // 宿主响应参数已在调用边界被证明只按固定字段读取、展开或返回；快照替换后
  // 它已是本地纯数据记录，无需再要求其内部成员继续流向未知代码。
  if(closedHostResponseSnapshotBindings.has(binding))return true;
  const next=new Set(seen).add(binding);
  return binding.refs.every(ref=>{
   const p=parents.get(ref);
   if(truthyGuarded(ref))return true;
   if(p?.type==='UnaryExpression'&&['!','typeof','void'].includes(p.operator))return true;
   if(p?.type==='MemberExpression'&&p.object===ref){
    let member=p,parent=parents.get(member);
    while(parent?.type==='MemberExpression'&&parent.object===member){
     if(property(parent)===undefined)return false;
     member=parent;parent=parents.get(member);
    }
    if(property(p)===undefined)return false;
    if(parent?.type==='CallExpression'&&parent.callee===member)return false;
    if(parent?.type==='UnaryExpression'&&parent.operator==='delete')return true;
    if(parent?.type==='AssignmentExpression'&&parent.left===member)return parent.operator==='='||parent.operator==='+='||parent.operator==='-='||parent.operator==='*='||parent.operator==='/=';
    return true;
   }
   if(p?.type==='AssignmentExpression'&&p.left===ref)return p.operator==='=';
   if(p?.type==='UpdateExpression')return false;
   if(p?.type==='SequenceExpression')return p.expressions.at(-1)===ref;
   if(p?.type==='Property'&&p.value===ref&&!p.computed&&key(p)!==undefined){
    const fn=returnedRecordOwner(parents.get(p));
    if(returnedRecordFieldDestructured(fn,String(key(p))))return true;
   }
   if(p?.type==='CallExpression'&&p.arguments.includes(ref)){
    if(p.optional||p.arguments.filter(argument=>argument===ref).length!==1||p.arguments.some(argument=>argument.type==='SpreadElement'))return false;
    if(isDone(p)||target(p.callee)&&complete.has(target(p.callee)))return true;
    const fn=target(p.callee),position=p.arguments.indexOf(ref),parameter=fn?.params?.[position];
    if(!functions.has(fn?.type)||parameter?.type!=='Identifier')return false;
    return closedShapeFlow(bindings.get(parameter),next);
   }
   if(p?.type==='ReturnStatement'||p?.type==='ArrowFunctionExpression'&&p.body===ref)return true;
   return ['BinaryExpression','LogicalExpression','ConditionalExpression','IfStatement','WhileStatement','DoWhileStatement','SwitchStatement','ExpressionStatement'].includes(p?.type);
  });
 }
 function shape(n,seen=new Set()){
  if(!n)return new Map();
  if(n.type==='AwaitExpression')return promiseShape(n.argument,seen)??shape(n.argument,seen);
  // 宿主响应对象只有完成结果会用到的公开字段；请求对象按同一字段闭合规则
  // 参与完成结果时也只投影可原生表达的字段。二者都不是可复制的普通记录。
  if(free(n,'$response')){
   shapeHostValues.add(n);
   const fields=new Map([['status',n],['headers',n],['body',n]]);
   // 重绑快照已把宿主响应替换为本地纯数据，完成投影应读取 helper 返回的
   // 本地正文；没有快照时仍按宿主实时载荷读取。
   fields.hostResponse=!hostResponseSnapshot;
   return fields;
  }
  if(free(n,'$request')){
   shapeHostValues.add(n);
   const fields=new Map([['url',n],['method',n],['headers',n],['body',n]]);
   fields.hostRequest=true;
   return fields;
  }
  if(n.type==='Literal'&&n.value===null||n.type==='UnaryExpression'&&n.operator==='void'||free(n,'undefined')){
   const fields=new Map();fields.nullable=true;
   if(n.type!=='Literal'||n.value!==null)fields.undefinedOnly=true;
   return fields;
  }
  const resolved=promiseResolverShape(n,seen);if(resolved)return resolved;
  // 逗号表达式的完成值就是最后一个表达式；前面的副作用语句仍原样保留，
  // 不影响“最终返回的是哪个闭合对象”的形状证明。
  if(n.type==='SequenceExpression')return shape(n.expressions.at(-1),new Set(seen));
  if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&property(n.callee)==='then'&&n.arguments.length===1&&promiseValue(n.callee.object)){
   const fn=target(n.arguments[0]);
   if(fn?.type==='ArrowFunctionExpression'&&fn.body.type==='ObjectExpression')return shape(fn.body,seen);
  }
  if(n.type==='ObjectExpression')return object(n,'完成结果');
  if(n.type==='ConditionalExpression'){
   const known=knownBoolean(n.test);
   if(known===true)return shape(n.consequent,new Set(seen));
   if(known===false)return shape(n.alternate,new Set(seen));
   const fields=new Map();
   const consequent=shape(n.consequent,new Set(seen)),alternate=shape(n.alternate,new Set(seen));
   mergeShape(fields,consequent,seen);mergeShape(fields,alternate,seen);
   fields.nullable=!!(consequent.nullable||alternate.nullable);
   return fields;
  }
  if(n.type==='LogicalExpression'&&['||','??'].includes(n.operator)){
   const fields=new Map();
   const left=shape(n.left,new Set(seen)),right=shape(n.right,new Set(seen));
   mergeShape(fields,left,seen);mergeShape(fields,right,seen);
   fields.nullable=!!(left.nullable&&right.nullable);
   return fields;
  }
  if(n.type==='Identifier'){
   const b=bindings.get(n);if(!b)fail(n,'无法静态追溯完成结果');
   // 数据流回到正在求解的绑定形成闭包时，本次递归不贡献新字段；外层仍须
   // 由至少一条独立写入提供可渲染字段，避免把纯自引用误认为完成结果。
   if(seen.has(b))return new Map();seen.add(b);
   const host=hostResponseShape(b);if(host)return host;
   const callbackFn=owners.get(n),callback=parents.get(callbackFn),callbackIndex=callback?.type==='CallExpression'?callback.arguments.indexOf(callbackFn):-1;
   if(callbackIndex>=0&&callback.callee.type==='MemberExpression'&&property(callback.callee)==='finally'&&promiseValue(callback.callee.object)){
    const parameter=callbackFn.params[callbackIndex];
    if(parameter?.type==='AssignmentPattern'&&bindings.get(parameter.left)===b&&!b.writes.length)return shape(parameter.right,seen);
   }
   if(callbackIndex===0&&callback.callee.type==='MemberExpression'&&property(callback.callee)==='then'){
    const resolved=promiseShape(callback.callee.object,seen);
    if(resolved)return resolved;
   }
   if(b.writes.length){
    if(!structured)fail(n,'完成结果变量被重新赋值，无法确定字段');
    // 完成值在 $done 调用点按当时的绑定值取快照；读取点之后的普通赋值不会
    // 改变已经提交的完成结果。这里只合并读取点之前能静态求形的赋值，同时排除
    // 提升函数声明可能在读取点前被调用的写入。
    const loopTypes=new Set(['ForStatement','ForInStatement','ForOfStatement','WhileStatement','DoWhileStatement']);
    const enclosingFunction=node=>{let parent=parents.get(node);while(parent&&!functions.has(parent.type))parent=parents.get(parent);return parent??null;};
    const completionFn=enclosingFunction(n);
    for(let parent=parents.get(n);parent&&!functions.has(parent.type);parent=parents.get(parent))
     if(loopTypes.has(parent.type))fail(n,'完成结果变量被重新赋值，无法确定字段');
    const canReachRead=ref=>{
     if(ref.start<n.start)return true;
     const fn=enclosingFunction(ref);
     while(fn&&fn!==completionFn){
      if(fn.start>n.start)return fn.type==='FunctionDeclaration';
      return true;
     }
     return false;
    };
    if([...b.writes,...b.refs].some(ref=>ref.start>=n.start&&canReachRead(ref)))fail(n,'完成结果变量被重新赋值，无法确定字段');
    const relevantWrites=b.writes.filter(w=>w.end<=n.start);
    if(!b.init&&!relevantWrites.length)fail(n,'完成结果形状无法静态确定');
    const fields=b.init?shape(b.init,new Set(seen)):new Map();
    if(!b.init){
     const definite=w=>{
      const writeStatement=parents.get(w);
      // 含 await/yield 的写入可能挂起；之后创建的闭包仍可能先于赋值完成运行，
      // 不能据此认定读取一定看到新值。
      const pending=node=>!!node&&(['AwaitExpression','YieldExpression'].includes(node.type)||children(node).some(pending));
      const pendingWrite=pending(w.right);
      // 写入语句本身必须无条件执行；若被条件、循环或异常边界包围，闭包内读取
      // 可能看到未初始化值，仍按可空处理。
      let unconditional=true;
      for(let node=writeStatement;node&&node!==owners.get(writeStatement);node=parents.get(node)){
       const parent=parents.get(node);
       if(['IfStatement','ConditionalExpression','LogicalExpression','WhileStatement','DoWhileStatement','ForStatement','ForInStatement','ForOfStatement','SwitchStatement','TryStatement'].includes(parent?.type)){unconditional=false;break;}
      }
      // 读取位于写入语句之后创建的闭包中时，闭包分配必然晚于写入语句；提升
      // 函数声明仍可能提前运行，因此不在此放宽。
      if(!pendingWrite&&unconditional&&n.start>=writeStatement?.end){
       let owner=owners.get(n);
       while(owner&&owner!==owners.get(writeStatement)&&owner!==tree){
        if(!functions.has(owner.type)||owner.type==='FunctionDeclaration'||owner.start<writeStatement.end)break;
        owner=owners.get(parents.get(owner));
       }
       if(owner===tree||owner===owners.get(writeStatement))return true;
      }
      let node=w;
      for(let parent=parents.get(node);parent&&!functions.has(parent.type);node=parent,parent=parents.get(node)){
      // 写入语句在文本上先于读取，且读取位于其后创建的闭包或后续语句时，
      // 该写入支配读取；这覆盖先声明局部结果、再在完成回调中读取的形态。
      const after=!pendingWrite&&writeStatement&&initializedAfter(ix,writeStatement,n);
      if(after)return true;
      if(pendingWrite){
       // 含 await 的写入只有在承载它的异步函数立即调用、且该调用本身在读取前
       // 被 await 时，才能确定读取发生在赋值完成之后。
       const fn=owners.get(w),call=fn&&parents.get(fn),awaited=call&&parents.get(call);
       if(functions.has(fn?.type)&&call?.type==='CallExpression'&&call.callee===fn&&awaited?.type==='AwaitExpression'&&awaited.argument===call){
        let boundary=awaited;
        while(boundary&&!['ExpressionStatement','VariableDeclaration'].includes(boundary.type))boundary=parents.get(boundary);
        if(boundary&&initializedAfter(ix,boundary,n))return true;
       }
       // Promise.finally/then 回调只在承载异步写入的立即调用 Promise 结算后
       // 运行；读取位于该回调内时同样满足写入完成。catch 可继续链路，但其
       // 回调本身可能在赋值前运行，不能作为完成证明。
       let chained=call;
       while(functions.has(fn?.type)&&call?.type==='CallExpression'&&call.callee===fn){
        const member=parents.get(chained);
        if(member?.type!=='MemberExpression'||member.object!==chained)break;
        const method=property(member),next=parents.get(member);
        if(!['then','catch','finally'].includes(method)||next?.type!=='CallExpression'||next.callee!==member)break;
        if(method!=='catch'){
         const callback=next.arguments[0],callbackFn=callback&&(functions.has(callback.type)?callback:target(callback));
         if(functions.has(callbackFn?.type)&&n.start>=callbackFn.start&&n.end<=callbackFn.end)return true;
        }
        chained=next;
       }
      }
      // 逗号表达式按从左到右求值；位于读取点之前的赋值必然先执行。
      if(parent.type==='SequenceExpression')continue;
      // 同一 return 表达式中的前序赋值也必然早于返回值读取。
      if(parent.type==='ReturnStatement'&&n.start>=parent.start&&n.end<=parent.end)return true;
       if(parent.type==='LogicalExpression'||parent.type==='ConditionalExpression'&&parent.test!==node||parent.type==='IfStatement'&&parent.test!==node)return false;
       if(['WhileStatement','DoWhileStatement','ForStatement','ForInStatement','ForOfStatement','SwitchStatement','TryStatement'].includes(parent.type))return false;
       if(parent.type==='BlockStatement'||parent.type==='Program'){
        const position=parent.body.indexOf(node);
        if(position<0)return false;
        return parent.body.slice(0,position).some(statement=>{
         if(statement.type==='ExpressionStatement'&&statement.expression.type==='AssignmentExpression')return statement.expression.left.type==='Identifier'&&bindings.get(statement.expression.left)===b;
         if(statement.type==='VariableDeclaration')return statement.declarations.some(declaration=>declaration.id.type==='Identifier'&&bindings.get(declaration.id)===b&&declaration.init);
         return false;
        });
       }
      }
      return false;
     };
     if(!relevantWrites.some(definite)){fields.nullable=true;fields.undefinedOnly=true;}
    }
    const destructured=write=>{
     if(write.type!=='AssignmentExpression'||write.operator!=='='||write.left.type!=='ObjectPattern')return null;
     const matches=write.left.properties.filter(property=>property.type==='Property'&&property.value.type==='Identifier'&&bindings.get(property.value)===b);
     if(matches.length!==1||matches[0].computed&&key(matches[0])===undefined)return null;
     return key(matches[0]);
    };
    for(const w of relevantWrites){
     if(w.type!=='AssignmentExpression'||w.operator!=='=')fail(n,'完成结果变量被重新赋值，无法确定字段');
     const field=destructured(w);
     if(field===null){mergeShape(fields,shape(w.right,new Set(seen)),seen);continue;}
     const source=shape(w.right,new Set(seen)),value=source.get(String(field));
     if(!value)fail(n,'完成结果解构字段无法静态确定');
     if(source.nullable)fields.nullable=true;
     mergeShape(fields,shape(value,new Set(seen)),seen);
    }
    if(fields.nullable){
     const truthy=truthyGuarded(n)||completionTruthyGuard(n,b);
     const objectGuard=typeGuarded(n,'object');
     if(!truthy&&!(objectGuard&&fields.undefinedOnly)){
      fail(n,'完成结果可能为空，无法证明完成调用位于同一真值分支');
     }
     fields.nullable=false;fields.undefinedOnly=false;
    }
    const closed=closedShapeFlow(b);
    for(const ref of b.refs){
     if(ref.start>=n.start)continue;
     const p=parents.get(ref),a=parents.get(p);
     // 绑定自身的重新赋值由上面的 relevantWrites 统一求形，不再按逃逸处理。
     if(p?.type==='AssignmentExpression'&&p.left===ref&&p.operator==='=')continue;
     // 解构赋值左侧的绑定同样是写入目标，值已按对应静态字段单独求形。
     let pattern=ref,parent=parents.get(pattern);
     while(parent?.type==='Property'&&parent.value===pattern&&parents.get(parent)?.type==='ObjectPattern'){pattern=parent;parent=parents.get(pattern);}
     if(pattern?.type==='Property'&&parent?.type==='ObjectPattern'){pattern=parent;parent=parents.get(pattern);}
     if(parent?.type==='AssignmentExpression'&&parent.left===pattern&&parent.operator==='='&&relevantWrites.includes(parent))continue;
     // Promise 执行器只把同一对象交回其 resolver，且该 Promise 被 await 后
     // 重新赋给同一绑定时，不构成对象身份逃逸，也不贡献新的字段来源。
     const resolverCall=p?.type==='CallExpression'&&p.arguments.length===1&&p.arguments[0]===ref&&isPromiseResolver(p.callee)?p:null;
     const executor=resolverCall&&nodes.find(candidate=>functions.has(candidate.type)&&bindings.get(candidate.params[0])===bindings.get(resolverCall.callee));
     const construction=executor&&parents.get(executor),returned=construction?.type==='NewExpression'&&free(construction.callee,'Promise')&&construction.arguments[0]===executor?parents.get(construction):null;
     const owner=returned?.type==='ReturnStatement'&&returned.argument===construction?owners.get(returned):null,ownerCall=owner&&parents.get(owner),awaited=ownerCall?.type==='CallExpression'&&ownerCall.callee===owner?parents.get(ownerCall):null,assignment=awaited?.type==='AwaitExpression'&&awaited.argument===ownerCall?parents.get(awaited):null;
     if(assignment?.type==='AssignmentExpression'&&assignment.operator==='='&&assignment.right===awaited&&assignment.left.type==='Identifier'&&bindings.get(assignment.left)===b)continue;
     if(p?.type==='MemberExpression'&&p.object===ref){
      if(property(p)===undefined)fail(p,'完成结果包含动态字段');
      if(a?.type==='UnaryExpression'&&a.operator==='delete'&&a.argument===p)fail(p,'完成结果字段被直接删除，需要先确定完成结果的数据流');
      if(a?.type==='AssignmentExpression'&&a.left===p)mergeShape(fields,new Map([[property(p),a.right]]),seen);
     }else if(p?.type==='IfStatement'&&p.test===ref&&b.refs.some(other=>completionTruthyGuard(other,b)===ref))continue;
      else if(p?.type==='UnaryExpression'&&p.operator==='typeof')continue;
     else if(closed)continue;
     else if(p?.type==='LogicalExpression'&&['||','??'].includes(p.operator)&&p.left===ref&&p.right.type==='AssignmentExpression'&&p.right.left.type==='Identifier'&&bindings.get(p.right.left)===b)continue;
     else if(!(p?.type==='CallExpression'&&isDone(p))&&!(p?.type==='CallExpression'&&target(p.callee)&&complete.has(target(p.callee))))fail(ref,'可变完成结果对象逃逸，无法确定字段');
    }
    return fields;
   }
   if(b.init){
    const fields=shape(b.init,seen);
    if(fields.nullable){
     if(!truthyGuarded(n)&&!completionTruthyGuard(n,b)){
      fail(n,'完成结果可能为空，无法证明完成调用位于同一真值分支');
     }
     fields.nullable=false;
    }
    const closed=closedShapeFlow(b);
    for(const ref of b.refs){
     const p=parents.get(ref),a=parents.get(p);
     if(p?.type==='MemberExpression'&&p.object===ref){
      if(property(p)===undefined)fail(p,'完成结果包含动态字段');
      if(a?.type==='UnaryExpression'&&a.operator==='delete'&&a.argument===p)fail(p,'完成结果字段被直接删除，需要先确定完成结果的数据流');
      if(a?.type==='AssignmentExpression'&&a.left===p)mergeShape(fields,new Map([[property(p),a.right]]),seen);
     }else if(p?.type==='IfStatement'&&p.test===ref&&b.refs.some(other=>completionTruthyGuard(other,b)===ref))continue;
      else if(p?.type==='UnaryExpression'&&p.operator==='typeof')continue;
     else if(closed)continue;
     else if(!(p?.type==='CallExpression'&&isDone(p))&&!(p?.type==='CallExpression'&&target(p.callee)&&complete.has(target(p.callee))))fail(ref,'完成结果对象逃逸，无法追溯所有字段修改');
    }
    return fields;
   }
   // A forwarding parameter can be resolved from every direct caller.
   let fn=null,param=-1;for(const f of nodes)if(functions.has(f.type)){const i=f.params.findIndex(p=>bindings.get(p.type==='AssignmentPattern'?p.left:p)===b);if(i>=0){fn=f;param=i;break;}}
   if(fn){
    if(!closedShapeFlow(b))fail(n,'完成结果参数逃逸，无法追溯所有字段修改');
    const calls=nodes.filter(c=>c.type==='CallExpression'&&target(c.callee)===fn);if(calls.length){
    const values=[];
    for(const c of calls){const argument=c.arguments[param],parameter=fn.params[param],fallback=parameter.type==='AssignmentPattern'?parameter.right:undefined;const value=shape(!argument||free(argument,'undefined')?fallback:argument,new Set(seen));if(value.nullable&&argument&&truthyGuarded(argument))value.nullable=false;values.push(value);}
    if(values.length&&values.every(value=>value.hostResponse))hostResponseBindings.add(b);
    const all=new Map();for(const value of values)mergeShape(all,value,seen);
    // 完成包装函数的各直接调用点可能位于互斥分支。保留每个调用点的闭合
    // 形状，供完成值在运行时按判别键分派；不把互斥字段合成为一个不存在的对象。
    const signatures=new Set();
    const variants=values.filter(value=>{
     const signature=JSON.stringify([...value.keys()].sort())+'|'+!!value.nullable;
     if(signatures.has(signature))return false;signatures.add(signature);return true;
    });
    if(variants.length>1)all.variants=variants;
    return all;
   }}
  }
  if(n.type==='CallExpression'&&(n.callee.type==='Identifier'||functions.has(n.callee.type))){
   const fn=functions.has(n.callee.type)?n.callee:target(n.callee);
   if(fn&&!fn.async){const fields=returnedShape(fn,seen);if(fields)return fields;}
  }
  fail(n,'完成结果形状无法静态确定');
 }
 function cleanHeaders(h,fields=['content-length','content-encoding','transfer-encoding']){
  return `Object.fromEntries(Object.entries(${h}).filter(([name]) => !${JSON.stringify(fields)}.includes(name.toLowerCase())))`;
 }
 function bytesText(text){const value=fresh('bytes');return `((${value}) => new Uint8Array(${value} instanceof ArrayBuffer ? ${value} : ${value}.buffer, ${value} instanceof ArrayBuffer ? 0 : ${value}.byteOffset, ${value}.byteLength))(${text})`;}
 function bytes(n){const text=render(n),v=resolve(n);if(v?.type==='NewExpression'&&v.callee.name==='Uint8Array')return text;return bytesText(text);}
 function bodyValue(n){
  const v=resolve(n);
  if(v?.type==='NewExpression'&&['DataView','ArrayBuffer','Int8Array','Uint16Array','Int16Array','Uint32Array','Int32Array','Float32Array','Float64Array'].includes(v.callee.name)||v?.type==='MemberExpression'&&property(v)==='buffer')return bytes(n);
  return render(n);
 }
 function status(n){
  const value=resolve(n);if(value?.type==='Literal'){
   if(typeof value.value==='number'&&Number.isInteger(value.value)&&value.value>=100&&value.value<=599)return render(n);
   if(typeof value.value==='string'){const m=value.value.match(/^HTTP\/[\d.]+\s+(\d{3})/);if(m)return m[1];}
   fail(n,'无效 HTTP 状态码');
  }
  return nativeStatus(render(n));
 }
 function nativeStatus(text){const value=fresh('status');return `((${value}) => typeof ${value} === 'string' ? Number(${value}.match(/^HTTP\\/[\\d.]+\\s+(\\d{3})/)?.[1]) : ${value})(${text})`;}
 function payload(n,nested=false,reference=null,provenFields=null){
  // Scheduled completion is a return value, never an HTTP response patch.
  // Preserve authored panel/custom fields and their ordinary JavaScript reads.
  if(scheduledOnly&&!nested&&!reference)return n?render(n):'{}';
  if(!reference&&n?.type==='ConditionalExpression')return `(${render(n.test)} ? ${payload(n.consequent,nested)} : ${payload(n.alternate,nested)})`;
  if(!reference&&stringCompletion(n)){
   if(format!=='qx'||nested)fail(n,'字符串完成结果需要 QX 的 $done(body) 契约；当前平台没有已确认的字符串完成映射');
   return '{body: '+render(n)+'}';
  }
  if(!reference&&free(n,'$request')){
   if(nested)fail(n,'请求对象不能嵌套为响应完成结果');
   shapeHostValues.add(n);
  }
  if(!reference&&free(n,'$response')){
   if(bodyWrites.has('response:body'))fail(n,'响应正文重绑后不能整体传递响应对象，无法证明状态与头部更新');
   if(nested)fail(n,'响应对象不能嵌套为请求阶段的合成响应');
   if(format==='qx')fail(n,'QX 整体响应的 statusCode/bodyBytes 字段需要显式映射');
   const body=readBody('$response','body');
   return `(${context}.response ? {status: ${context}.response.status, headers: ${body} === undefined ? ${context}.response.headers : ${cleanHeaders(context+'.response.headers')}, body: ${body}} : {})`;
  }
  const fields=provenFields??shape(n);for(const k of fields.keys())if(!['url','method','headers','body','bodyBytes','status','response','abort'].includes(k))fail(n,'不支持的完成字段：'+k);
  if(fields.hostRequest&&!fields.variants?.length){
   const value=reference??render(n),body=readBody('$request','body');
   return `((${value}) => ({url: ${value}.url, ...(${value}.method === undefined ? {} : {method: ${value}.method}), ...(${value}.headers === undefined ? {} : {headers: ((${value}.headers && typeof ${value}.headers.entries === 'function') ? Object.fromEntries(${value}.headers.entries()) : {...${value}.headers})}), ...(${body} === undefined ? {} : {body: ${body}})}))(${value})`;
  }
  if(fields.variants?.length>1){
   const value=reference??fresh('completionValue');
   const guards=fields.variants.map(variant=>{
    const keys=new Set(variant.keys());
    const category=variant.hostRequest?'request':keys.has('response')?'response':keys.has('url')?'url':keys.has('abort')?'abort':keys.has('status')||keys.has('headers')||keys.has('body')||keys.has('bodyBytes')?'responseShape':'empty';
    let test;
    if(category==='response')test=`${value} && typeof ${value} === 'object' && 'response' in ${value}`;
    else if(category==='request')test=`${value} === ${render(variant.get('url'))}`;
    else if(category==='url')test=`${value} && typeof ${value} === 'object' && 'url' in ${value} && !('status' in ${value})`;
    else if(category==='abort')test=`${value} && typeof ${value} === 'object' && 'abort' in ${value}`;
    else if(category==='responseShape')test=variant.hostResponse?`${context}.response !== undefined && ${value} === ${context}.response`:`${value} && typeof ${value} === 'object' && !('response' in ${value}) && ('status' in ${value} || !('url' in ${value}) && ('headers' in ${value} || 'body' in ${value} || 'bodyBytes' in ${value}))`;
    else test=null;
    return {category,test,variant};
   });
   const categories=new Set(guards.map(item=>item.category));
   if(guards.filter(item=>item.category!=='empty').length&&categories.size===guards.length){
    const fallback=guards.find(item=>item.category==='empty');
    let text=fallback?payload(n,false,value,copyShape(fallback.variant)):'{}';
    for(const item of guards.filter(item=>item.category!=='empty')){
     const variant=copyShape(item.variant);variant.nullable=false;
     text=`(${item.test} ? ${payload(n,false,value,variant)} : ${text})`;
    }
    return `((${value}) => ${text})(${render(n)})`;
   }
  }
  if(fields.nullable){
   // 被调函数返回 null 时，`$done(value())` 等价于不修改消息；只有所有非空
   // 返回分支都具备封闭完成形状时才成立。这里只求值一次，其余可空形态仍拒绝。
   if(reference||!fields.size)fail(n,'完成结果可能为空，不能映射为固定字段');
   const value=fresh('completionValue');
   const nestedFields=copyShape(fields);nestedFields.nullable=false;nestedFields.undefinedOnly=false;
   return `((${value}) => ${value} == null ? {} : ${payload(n,false,value,nestedFields)})(${render(n)})`;
  }
  if(fields.has('abort')){
   if(fields.size!==1||(fields.abortValues??[fields.get('abort')]).some(v=>resolve(v)?.value!==true))fail(n,'abort 仅支持静态 true');
   return !reference&&n.type==='ObjectExpression'?`${context}.abort()`:`(${reference??render(n)}.abort === undefined ? {} : ${context}.abort())`;
  }
  if(fields.has('response')){
   if(fields.size!==1)fail(n,'response 与其他完成字段冲突');
   if(!reference&&n.type==='ObjectExpression')return payload(fields.get('response'),true);
   // A forwarding helper can also receive its default {}. Keep the actual
   // nested value and caller's lexical data; never copy a caller's expression
   // into the helper or synthesize a response for an omitted field.
   const value=fresh('completionResponse');
   return `((${value}) => ${value} === undefined ? {} : ${payload(fields.get('response'),true,value,fields.responseFields)})(${reference??render(n)}.response)`;
  }
  // 宿主响应的 body/bodyBytes 是同一载荷的文本与二进制视图，完成时投影为
  // 一个带运行期回退的 body；普通记录同时出现两个字段仍然拒绝。
  const hostBody=!!(fields.hostResponse&&fields.has('body')&&fields.has('bodyBytes'));
  if(fields.has('body')&&fields.has('bodyBytes')&&!hostBody)fail(n,'body 与 bodyBytes 冲突');
  let text,evaluate;
  if(!n)text='{}';
  else if(!reference&&n.type==='ObjectExpression'){
   const out=[];for(const [k,v]of fields){let val=k==='bodyBytes'?bytes(v):k==='body'?bodyValue(v):k==='status'?status(v):render(v);if(k==='headers'&&(fields.has('body')||fields.has('bodyBytes')))val=cleanHeaders(val);out.push(`${k==='bodyBytes'?'body':k}: ${val}`);}text='{'+out.join(', ')+'}';
  }else{
   // Copy only statically proven fields, preserving branches where a field is absent.
   const input=reference??render(n),value=reference||n.type==='Identifier'?input:fresh('completionValue'),out=[];for(const [k,v]of fields){if(hostBody&&k==='bodyBytes')continue;let val=k==='bodyBytes'?bytesText(value+'.bodyBytes'):`${value}.${k}`;if(k==='body'&&fields.hostResponse)val=readBody('$response','body');if(k==='bodyBytes'&&fields.hostResponse)val=readBody('$response','bodyBytes');if(k==='status')val=nativeStatus(`${value}.status`);if(k==='headers'&&(fields.has('body')||fields.has('bodyBytes')))val=`${value}.body === undefined && ${value}.bodyBytes === undefined ? ${value}.headers : ${cleanHeaders(value+'.headers')}`;if(k==='body'&&hostBody){const bytes=readBody('$response','bodyBytes');out.push(`...(${value}.body === undefined && ${value}.bodyBytes === undefined ? {} : {body: ${val} === undefined ? ${bytesText(bytes)} : ${val}})`);continue;}out.push(`...(${value}.${k} === undefined ? {} : {${k==='bodyBytes'?'body':k}: ${val}})`);}text='{'+out.join(', ')+'}';
   if(!reference&&n.type!=='Identifier')evaluate={value,input};
  }
  const absent=evaluate?` || ${evaluate.value}.status === undefined`:reference||n?.type==='Identifier'?` || ${reference??render(n)}.status === undefined`:'';
  const result=nested?`${context}.respond({status: 200, ...${text}})`:
   fields.has('status')?`(${context}.response${absent} ? ${text} : ${context}.respond(${text}))`:text;
  return evaluate?`((${evaluate.value}) => (${result}))(${evaluate.input})`:result;
 }
 function stringCompletion(n,seen=new Set()){
  if(!n)return false;
  if(n.type==='Literal')return typeof n.value==='string';
  if(n.type==='TemplateLiteral')return true;
  if(n.type==='Identifier'){
   const b=bindings.get(n);if(!b?.init||b.writes.length||seen.has(b))return false;
   seen.add(b);return stringCompletion(b.init,seen);
  }
  if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&free(n.callee.object,'JSON')&&property(n.callee)==='stringify'){
   // Do not assume native JSON semantics after aliasing or modifying the global.
   return nodes.filter(x=>free(x,'JSON')).every(x=>{const p=parents.get(x),q=parents.get(p);return p?.type==='MemberExpression'&&['parse','stringify'].includes(property(p))&&q?.type==='CallExpression'&&q.callee===p;});
  }
  return false;
 }
 function scalarNotificationOption(n,seen=new Set()){
  if(!n||free(n,'undefined')||n.type==='UnaryExpression'&&n.operator==='void'&&n.argument.type==='Literal'||n.type==='Literal'&&n.value===null)return true;
  if(values.string(n))return true;
  if(n.type==='Identifier'){
   const b=bindings.get(n);if(!b||seen.has(b))return false;seen=new Set(seen);seen.add(b);
   if(b.init)return scalarNotificationOption(b.init,seen)&&b.writes.every(w=>w.type==='AssignmentExpression'&&w.operator==='='&&w.left.type==='Identifier'&&bindings.get(w.left)===b&&scalarNotificationOption(w.right,new Set(seen)));
   if(b.writes.length)return false;
   const owner=owners.get(n),position=owner?.params?.findIndex(p=>bindings.get(p.type==='AssignmentPattern'?p.left:p)===b)??-1;
   if(position>=0){
    const parent=parents.get(owner),id=owner.id??(parent?.type==='VariableDeclarator'?parent.id:null),callee=id&&bindings.get(id);
    const direct=parent?.type==='CallExpression'&&parent.callee===owner;
    const refs=callee?.refs??[],calls=direct?[parent]:refs.map(r=>parents.get(r));
    if((direct||callee&&!callee.writes.length)&&calls.length&&calls.every((c,i)=>c?.type==='CallExpression'&&(direct||c.callee===refs[i])&&!c.optional&&!c.arguments.some(a=>a.type==='SpreadElement'))&&
     calls.every(c=>{let value=c.arguments[position];if((!value||free(value,'undefined'))&&owner.params[position].type==='AssignmentPattern')value=owner.params[position].right;return scalarNotificationOption(value,new Set(seen));}))return true;
   }

   for(let child=n,p=parents.get(n);p;child=p,p=parents.get(p))if(p.type==='SwitchCase'&&p.test?.type==='Literal'&&p.test.value==='string'&&isolatedSwitchCase(ix,p)){const t=parents.get(p)?.discriminant;if(t?.type==='UnaryExpression'&&t.operator==='typeof'&&bindings.get(t.argument)===b)return true;}
   return false;
  }
  if(n.type!=='MemberExpression'||n.object.type!=='Identifier'||typeof property(n)!=='string')return false;
  const field=property(n),b=bindings.get(n.object);
  if(!b||b.init||b.writes.length||seen.has(b)||Object.hasOwn(Object.prototype,field)||Object.hasOwn(String.prototype,field))return false;
  if(nodes.some(x=>x.type==='MemberExpression'&&['prototype','__proto__','constructor','setPrototypeOf','getPrototypeOf','getOwnPropertyDescriptor','getOwnPropertyDescriptors','defineProperty','defineProperties','__defineGetter__','__defineSetter__','__lookupGetter__','__lookupSetter__'].includes(property(x))||free(x,'Reflect')||x.type==='CallExpression'&&(free(x.callee,'eval')||free(x.callee,'Function'))))return false;
  if(b.refs.some(ref=>{const p=parents.get(ref),q=parents.get(p);
   if(p?.type==='UnaryExpression'&&p.operator==='typeof')return false;
   if(p?.type==='MemberExpression'&&p.object===ref)return property(p)===undefined||q?.type==='AssignmentExpression'&&q.left===p||q?.type==='UpdateExpression'||q?.operator==='delete';
   if(p?.type==='CallExpression'&&p.arguments.length===1&&p.arguments[0]===ref&&p.callee.type==='MemberExpression'&&free(p.callee.object,'JSON')&&property(p.callee)==='stringify')return false;
   for(let x=parents.get(ref);x;x=parents.get(x))if(x.type==='SwitchCase'&&x.test?.type==='Literal'&&x.test.value==='string'&&isolatedSwitchCase(ix,x)){const t=parents.get(x)?.discriminant;if(t?.type==='UnaryExpression'&&t.operator==='typeof'&&bindings.get(t.argument)===b)return false;}
   return true;
  }))return false;
  if(nodes.filter(x=>free(x,'JSON')).some(x=>{const p=parents.get(x),q=parents.get(p);return p?.type!=='MemberExpression'||!['parse','stringify'].includes(property(p))||q?.type!=='CallExpression'||q.callee!==p;}))return false;
  const fn=owners.get(n),position=fn?.params?.findIndex(p=>bindings.get(p.type==='AssignmentPattern'?p.left:p)===b)??-1;
  if(position<0)return false;
  const p=parents.get(fn),id=fn.id??(p?.type==='VariableDeclarator'?p.id:null),fb=id?bindings.get(id):null;
  if(!fb||fb.writes.length||!fb.refs.length||fb.init!==fn||nodes.filter(x=>(x.type==='VariableDeclarator'||x.type==='FunctionDeclaration')&&bindings.get(x.id)===fb).length!==1)return false;
  const plain=value=>!value||free(value,'undefined')||value.type==='UnaryExpression'&&value.operator==='void'&&value.argument.type==='Literal'||values.string(value)||value.type==='ObjectExpression'&&value.properties.every(p=>p.type==='Property'&&p.kind==='init'&&key(p)!==undefined&&!['__proto__','toJSON',field].includes(key(p))&&p.value.type==='Literal');
  return fb.refs.every(ref=>{const call=parents.get(ref);if(call?.type!=='CallExpression'||call.callee!==ref||call.arguments.some(a=>a.type==='SpreadElement'))return false;let actual=call.arguments[position];if((!actual||free(actual,'undefined'))&&fn.params[position].type==='AssignmentPattern')actual=fn.params[position].right;return plain(actual);});
 }
 function notification(n){
  const a=n.arguments;if(a.length<1||a.length>4)fail(n,'通知参数数量无法转换');
  let returned=a[3]?.type==='CallExpression'?notificationReturnedFields(a[3]):null;
  if(a[3]?.type==='Identifier'){
   const b=bindings.get(a[3]),w=b?.writes[0];
   if(b&&!b.writes.length&&b.init?.type==='CallExpression'&&owners.get(a[3])===owners.get(b.init)&&b.refs.every(ref=>{
    if(ref===a[3])return true;
    const p=parents.get(ref);
    return p?.type==='CallExpression'&&p.arguments[0]===ref&&p.callee.type==='MemberExpression'&&free(p.callee.object,'JSON')&&property(p.callee)==='stringify'||p?.type==='UnaryExpression'&&p.operator==='typeof';
   }))returned=notificationReturnedFields(b.init);
   if(b?.writes.length===1&&w.type==='AssignmentExpression'&&w.operator==='='&&w.left.type==='Identifier'&&bindings.get(w.left)===b&&w.right.type==='CallExpression'&&owners.get(w)===owners.get(n)){
    let expression=w;while(parents.get(expression)?.type==='SequenceExpression')expression=parents.get(expression);
    const p=parents.get(expression);let dominated=false;
    if(p?.type==='IfStatement'&&p.test===expression&&a[3].start>=w.end&&a[3].end<=p.end)dominated=true;
    if(p?.type==='ExpressionStatement'){const block=parents.get(p);let use=n;while(parents.get(use)&&parents.get(use)!==block)use=parents.get(use);dominated=['Program','BlockStatement'].includes(block?.type)&&parents.get(use)===block&&use.start>=p.end;}
    if(dominated)returned=notificationReturnedFields(w.right);
   }
  }
  const resolved=a[3]?resolve(a[3]):null;
  const optionsObject=a[3]&&!(free(resolved,'undefined')||resolved?.type==='UnaryExpression'&&resolved.operator==='void'&&resolved.argument.type==='Literal'||resolved?.type==='Literal'&&(resolved.value===null||typeof resolved.value==='string'));
  const captured=optionsObject?a.map((_,i)=>fresh(['notificationTitle','notificationSubtitle','notificationBody','notificationOptions'][i])):null;
  const argument=i=>captured?captured[i]:render(a[i]);
  const out=[`title: ${argument(0)}`];if(a[1])out.push(`subtitle: ${argument(1)}`);if(a[2])out.push(`body: ${argument(2)}`);
  if(a[3]){
   const opt=resolve(a[3]);if(free(opt,'undefined')||opt?.type==='UnaryExpression'&&opt.operator==='void'&&opt.argument.type==='Literal'||opt?.type==='Literal'&&opt.value===null){}
   else if(opt?.type==='Literal'&&typeof opt.value==='string'||values.string(a[3]))out.push(`action: {type: 'openUrl', url: ${argument(3)}}`);
   else {
    const mutable=returned??notificationFields(a[3],n)??(scalarNotificationOption(a[3])?{fields:new Map(),optional:new Set(),nullable:true,stringUrl:true}:null);
    if(mutable?.stringUrl)out.push(`...(typeof ${argument(3)} === 'string' ? {action: {type: 'openUrl', url: ${argument(3)}}} : {})`);
    const f=mutable?.fields??object(a[3],'通知参数'),allowed=['url','openUrl','open-url','action','text','update-pasteboard','mediaUrl','media-url','media-base64','media-base64-mime','auto-dismiss','sound'];
    const value=k=>captured?`${argument(3)}${mutable?.nullable?'?.':''}[${JSON.stringify(k)}]`:render(f.get(k));
    const add=(k,text)=>out.push(`...(${mutable?.nullable?`${argument(3)} != null && `:''}${mutable?.optional.has(k)?`Object.hasOwn(${argument(3)}, ${JSON.stringify(k)}) && `:''}${value(k)} !== undefined ? {${text}} : {})`);
    for(const k of f.keys())if(!allowed.includes(k))fail(a[3],'未适配通知字段：'+k);
    if(mutable?.returnedRecord){
     const optionsName=fresh('notificationSourceOptions'),resultName=fresh('notificationNativeOptions'),urlName=fresh('notificationSourceUrl'),mediaUrlName=fresh('notificationMediaUrl'),base64Name=fresh('notificationMediaBase64'),mimeName=fresh('notificationMediaMime'),dismissName=fresh('notificationAutoDismiss');
     const statements=[`const ${resultName} = {};`,`const ${urlName} = ${optionsName}?.url ?? ${optionsName}?.openUrl ?? ${optionsName}?.["open-url"];`,`if (${optionsName}?.action === "clipboard") { if (${optionsName}?.text !== undefined) ${resultName}.action = {type: "clipboard", text: ${optionsName}.text}; } else if (${urlName} !== undefined) ${resultName}.action = {type: "openUrl", url: ${urlName}};`,`const ${mediaUrlName} = ${optionsName}?.["media-url"] ?? ${optionsName}?.mediaUrl;`,`if (${mediaUrlName} !== undefined) ${resultName}.attachment = {url: ${mediaUrlName}}; else { const ${base64Name} = ${optionsName}?.["media-base64"]; if (${base64Name} !== undefined) { const ${mimeName} = ${optionsName}?.["media-base64-mime"]; if (${mimeName} === undefined) throw new Error("Base64 notification attachment requires MIME type"); ${resultName}.attachment = {base64: ${base64Name}, mimeType: ${mimeName}}; } }`,`const ${dismissName} = ${optionsName}?.["auto-dismiss"];`,`if (${dismissName} !== undefined) { if (${dismissName} === true) ${resultName}.duration = 10; else if (${dismissName} !== false) { if (typeof ${dismissName} !== "number" || !Number.isFinite(${dismissName}) || ${dismissName} < 0) throw new TypeError("Notification auto-dismiss must be boolean or non-negative seconds"); ${resultName}.duration = ${dismissName}; } }`,`if (${optionsName}?.sound !== undefined) { if (typeof ${optionsName}.sound !== "boolean") throw new TypeError("Notification sound must be boolean"); ${resultName}.sound = ${optionsName}.sound; }`,`return ${resultName};`];
     out.push(`...(((${optionsName}) => {${statements.join(' ')}})(${argument(3)}))`);
    }else{
    const urls=['url','openUrl','open-url'].filter(k=>f.has(k));
    // 多平台脚本会同时写 QX 的 open-url 和通用 url。只有所有字段都是同一个
    // 可静态追溯的值（同一字面量或同一未写入绑定）时，选中任意一个才不影响
    // 通知目标；其它组合仍是冲突。
    if(urls.length>1){
     const first=resolve(f.get(urls[0]));
     if(!urls.every(k=>{
      const value=resolve(f.get(k));
      if(value===first)return true;
      if(first?.type==='Literal'&&value?.type==='Literal')return typeof first.value===typeof value.value&&first.value===value.value;
      const a=first?.type==='Identifier'?bindings.get(first):null,b=value?.type==='Identifier'?bindings.get(value):null;
      return !!a&&a===b&&!a.writes.length;
     }))fail(a[3],'通知 URL 字段冲突');
    }
    const url=urls.length?f.get(urls[0]):null,clip=f.get('update-pasteboard')??(resolve(f.get('action'))?.value==='clipboard'?f.get('text'):null);
    if(url&&clip)fail(a[3],'通知操作冲突');
    if(url)add(urls[0],`action: {type: 'openUrl', url: ${value(urls[0])}}`);else if(clip){if(mutable)fail(a[3],'可变剪贴板通知参数尚无确定的操作分支');const k=f.has('update-pasteboard')?'update-pasteboard':'text';add(k,`action: {type: 'clipboard', text: ${value(k)}}`);}else if(f.has('action')||f.has('text'))fail(a[3],'通知操作不完整');
    const media=f.get('mediaUrl')??f.get('media-url');if(media&&f.has('media-base64'))fail(a[3],'通知附件冲突');
    if(media){const k=f.has('mediaUrl')?'mediaUrl':'media-url';add(k,`attachment: {url: ${value(k)}}`);}
    if(f.has('media-base64')){if(!f.has('media-base64-mime'))fail(a[3],'Base64 附件需要 MIME');add('media-base64',`attachment: {base64: ${value('media-base64')}, mimeType: ${value('media-base64-mime')}}`);}
    if(f.has('auto-dismiss')){
     if(mutable)fail(a[3],'可变 auto-dismiss 参数需要可证明的布尔或秒数数据流');
     const dismiss=resolve(f.get('auto-dismiss'));
     if(free(dismiss,'undefined')||dismiss?.type==='UnaryExpression'&&dismiss.operator==='void'&&dismiss.argument.type==='Literal'||dismiss?.type==='Literal'&&dismiss.value===false){}
     else if(dismiss?.type==='Literal'&&dismiss.value===true)out.push('duration: 10');
     else if(dismiss?.type==='Literal'&&typeof dismiss.value==='number'&&Number.isFinite(dismiss.value)&&dismiss.value>=0)out.push('duration: '+(captured?`${argument(3)}["auto-dismiss"]`:render(dismiss)));
     else fail(f.get('auto-dismiss'),'auto-dismiss 必须为布尔值或非负秒数');
    }
    if(f.has('sound')){if(mutable)fail(a[3],'可变 sound 参数需要可证明的布尔数据流');const s=resolve(f.get('sound'));if(s.type!=='Literal'||typeof s.value!=='boolean')fail(s,'sound 必须为布尔值');out.push('sound: '+value('sound'));}
    }
   }
  }
  const call=`${context}.notify({${out.join(', ')}})`;
  return captured?`((${captured.join(', ')}) => ${call})(${a.map(render).join(', ')})`:call;
 }
 function notificationReturnedFields(call){
  const fn=target(call.callee);if(!fn||fn.async||fn.generator||fn.body.type!=='BlockStatement')return null;
  function callSites(fn){
   const parent=parents.get(fn);if(parent?.type==='CallExpression'&&parent.callee===fn&&!parent.optional)return [parent];
   const id=fn.id??(parent?.type==='VariableDeclarator'?parent.id:null),binding=id?.type==='Identifier'?bindings.get(id):null;
   if(!binding||binding.writes.length||!binding.refs.length)return null;
   const pairs=binding.refs.map(ref=>[ref,parents.get(ref)]);
   return pairs.every(([ref,c])=>c?.type==='CallExpression'&&c.callee===ref&&!c.optional&&!c.arguments.some(a=>a.type==='SpreadElement'))?pairs.map(([,c])=>c):null;
  }
  function actualRecords(argument,owner,seen=new Set()){
   if(!argument||seen.has(argument))return null;seen=new Set(seen);seen.add(argument);
   const value=resolve(argument);if(value?.type==='ObjectExpression')return [value];
   if(value?.type!=='Identifier'||!owner)return null;
   const position=owner.params.findIndex(p=>bindings.get(p.type==='AssignmentPattern'?p.left:p)===bindings.get(value));
   if(position<0)return null;
   const callers=callSites(owner);if(!callers)return null;
   const output=[];
   for(const caller of callers){
    let argument=caller.arguments[position],parameter=owner.params[position];
    if((!argument||free(argument,'undefined'))&&parameter.type==='AssignmentPattern')argument=parameter.right;
    const records=actualRecords(argument,owners.get(caller),seen);if(!records)return null;output.push(...records);
   }
   return output.length?output:null;
  }
  const inputField=n=>{
   if(n?.type!=='MemberExpression'||n.object.type!=='Identifier'||property(n)===undefined)return null;
   const position=fn.params.findIndex(p=>bindings.get(p.type==='AssignmentPattern'?p.left:p)===bindings.get(n.object));if(position<0)return null;
   let argument=call.arguments[position];if((!argument||free(argument,'undefined'))&&fn.params[position]?.type==='AssignmentPattern')argument=fn.params[position].right;
   const records=actualRecords(argument,owners.get(call));if(!records||records.some(record=>record.properties.some(p=>p.type!=='Property'||p.kind!=='init'||p.computed&&key(p)===undefined)))return null;
   const fields=records.map(record=>record.properties.find(p=>String(key(p))===String(property(n))));
   if(fields.every(field=>!field))return {known:true,value:undefined};
   return null;
  };
  const inputTruth=n=>{
   const known=value=>{
    if(!value||free(resolve(value),'undefined')||resolve(value)?.type==='UnaryExpression'&&resolve(value).operator==='void')return false;
    const expression=resolve(value);
    if(expression?.type==='Literal')return Boolean(expression.value);
    if(expression?.type==='ObjectExpression'||expression?.type==='ArrayExpression'||functions.has(expression?.type))return true;
    return null;
   };
   const field=inputField(n);if(field)return known(field.value);
   const expression=resolve(n);
   if(expression?.type==='Literal')return Boolean(expression.value);
   if(expression?.type==='UnaryExpression'&&expression.operator==='!'){const value=inputTruth(expression.argument);return value===null?null:!value;}
   if(expression?.type==='ConditionalExpression'){const test=inputTruth(expression.test);return test===null?null:inputTruth(test?expression.consequent:expression.alternate);}
   if(expression?.type==='LogicalExpression'){
    const left=inputTruth(expression.left),right=inputTruth(expression.right);
    if(expression.operator==='||')return left===true||right===true?true:left===false?right:null;
    if(expression.operator==='&&')return left===false||right===false?false:left===true?right:null;
    if(expression.operator==='??'){
     const value=resolve(expression.left);
     if(value?.type==='Literal'&&value.value!==null)return Boolean(value.value);
     if(value?.type==='Literal'&&value.value===null||free(value,'undefined'))return right;
    }
   }
   if(expression?.type==='Identifier'&&bindings.has(expression)){
    const binding=bindings.get(expression);if(binding.init&&!binding.writes.length&&binding.init!==expression)return inputTruth(binding.init);
   }
   return null;
  };
  const unreachable=n=>{
   for(let child=n,p=parents.get(child);p&&p!==fn;child=p,p=parents.get(p)){
    if(p.type==='IfStatement'){
     const truth=inputTruth(p.test);
     if(truth===false&&p.consequent===child||truth===true&&p.alternate===child)return true;
    }
    if(p.type==='LogicalExpression'&&p.right===child){const truth=inputTruth(p.left);if(p.operator==='&&'&&truth===false||p.operator==='||'&&truth===true)return true;}
    if(p.type==='SwitchCase'&&p.test&&isolatedSwitchCase(ix,p)&&parents.get(p)?.discriminant.type==='UnaryExpression'&&parents.get(p).discriminant.operator==='typeof'){
     const v=resolve(p.test);if(v?.type==='Literal'&&typeof v.value!=='string'||v?.type==='UnaryExpression'&&v.operator==='void')return true;
    }
   }
   return false;
  };
  const returns=nodes.filter(n=>n.type==='ReturnStatement'&&owners.get(n)===fn&&!unreachable(n)),fields=new Map(),required=[];let stringUrl=false;
  if(!returns.length)return null;
  for(const statement of returns){
   const value=statement.argument?.type==='SequenceExpression'?statement.argument.expressions.at(-1):statement.argument;
   if(!value||free(value,'undefined')||value.type==='UnaryExpression'&&value.operator==='void'||value.type==='Literal'&&value.value===null){required.push(new Set());continue;}
   if(value.type==='Literal'&&typeof value.value==='string'){stringUrl=true;required.push(new Set());continue;}
   const b=value?.type==='Identifier'?bindings.get(value):null,initial=b?.init??resolve(value);
   if(b&&fn.params.some(p=>p.type==='Identifier'&&bindings.get(p)===b)&&!b.writes.length){
    let guarded=false;
    for(let p=parents.get(statement);p&&p!==fn;p=parents.get(p))if(p.type==='SwitchCase'&&p.test?.type==='Literal'&&p.test.value==='string'&&isolatedSwitchCase(ix,p)){const test=parents.get(p)?.discriminant;if(test?.type==='UnaryExpression'&&test.operator==='typeof'&&bindings.get(test.argument)===b)guarded=true;}
    for(let child=statement,p=parents.get(statement);p&&p!==fn;child=p,p=parents.get(p))if(p.type==='IfStatement'&&p.consequent===child){
     const t=p.test;
     if(t.type==='UnaryExpression'&&t.operator==='!'&&t.argument.type==='Identifier'&&bindings.get(t.argument)===b)guarded=true;
     if(t.type==='BinaryExpression'&&['===','=='].includes(t.operator))for(const [a,c]of [[t.left,t.right],[t.right,t.left]])if(a.type==='UnaryExpression'&&a.operator==='typeof'&&a.argument.type==='Identifier'&&bindings.get(a.argument)===b&&c.type==='Literal'&&c.value==='string')guarded=true;
    }
    if(guarded){stringUrl=true;required.push(new Set());continue;}
   }
   if(initial?.type!=='ObjectExpression')return null;
   const own=new Set();
   const add=object=>{for(const p of object.properties){if(p.type!=='Property'||p.kind!=='init'||key(p)===undefined||key(p)==='__proto__')return false;const v=resolve(p.value);if(free(v,'undefined')||v?.type==='UnaryExpression'&&v.operator==='void')continue;fields.set(key(p),p.value);}return true;};
   if(!add(initial))return null;for(const p of initial.properties)own.add(key(p));
   if(b)for(const w of b.writes){if(w.type!=='AssignmentExpression'||w.operator!=='='||w.left.type!=='Identifier'||bindings.get(w.left)!==b||w.right.type!=='ObjectExpression'||!add(w.right))return null;for(const k of own)if(!w.right.properties.some(p=>key(p)===k))own.delete(k);}
   if(b)for(const ref of b.refs){
    const p=parents.get(ref);
    if(b.writes.some(w=>w.left===ref))continue;
    if(p?.type==='MemberExpression'&&p.object===ref){const w=parents.get(p),k=property(p);if(typeof k!=='string'||k==='__proto__'||w?.type!=='AssignmentExpression'||w.left!==p||w.operator!=='=')return null;if(unreachable(w))continue;fields.set(k,w.right);continue;}
    if(p?.type==='ReturnStatement'&&p.argument===ref||p?.type==='SequenceExpression'&&p.expressions.at(-1)===ref&&parents.get(p)?.type==='ReturnStatement')continue;
    if(p?.type!=='CallExpression'||p.arguments[0]!==ref||p.callee.type!=='MemberExpression')return null;
    if(free(p.callee.object,'JSON')&&property(p.callee)==='stringify')continue;
    if(!free(p.callee.object,'Object')||property(p.callee)!=='assign'||p.arguments.length!==2||p.arguments[1].type!=='ObjectExpression'||!add(p.arguments[1]))return null;
   }
   required.push(own);
  }
  if([...fields.keys()].some(k=>!['url','openUrl','open-url','action','text','update-pasteboard','mediaUrl','media-url','media-base64','media-base64-mime','auto-dismiss','sound'].includes(k)))return null;
  return {fields,optional:new Set([...fields.keys()].filter(k=>required.some(s=>!s.has(k)))),nullable:true,stringUrl,returnedRecord:true};
 }
 function notificationFields(ref,call){
  if(ref.type!=='Identifier')return null;
  const b=bindings.get(ref),initial=resolve(ref);
  if(!b||b.writes.length||initial?.type!=='ObjectExpression')return null;
  if(nodes.filter(n=>n.type==='VariableDeclarator'&&bindings.get(n.id)===b).length!==1)return null;
  const writes=[];
  for(const r of b.refs){
   const p=parents.get(r),q=parents.get(p);
   if(p?.type==='CallExpression'&&p.arguments[3]===r&&(isAPI(p,'$notify')||isAPI(p,'$notification','post')))continue;
   if(p?.type==='CallExpression'&&p.arguments[0]===r&&p.arguments.length===1&&p.callee.type==='MemberExpression'&&free(p.callee.object,'JSON')&&property(p.callee)==='stringify')continue;
   if(p?.type!=='MemberExpression'||p.object!==r||property(p)===undefined)return null;
   if(q?.type==='AssignmentExpression'&&q.left===p&&q.operator==='='){
    if(!call)return null;
    if(q.start>=call.start)fail(ref,'通知参数在通知调用后仍被修改，无法确定发送时的字段值');
    writes.push(p);continue;
   }
   return null; // No aliases, deletes, accessors, dynamic keys or unknown calls.
  }
  if(!writes.length)return null;
  const fields=new Map();
  for(const p of initial.properties){if(p.type!=='Property'||p.kind!=='init'||key(p)===undefined||key(p)==='__proto__')return null;fields.set(key(p),p.value);}
  const optional=new Set();
  for(const member of writes){const k=property(member);if(k==='__proto__')return null;if(!fields.has(k))optional.add(k);fields.set(k,parents.get(member).right);}
  if([...fields.keys()].some(k=>!['url','openUrl','open-url','mediaUrl','media-url','auto-dismiss'].includes(k)))return null;
  return {fields,optional};
 }
 function http(input,method,qx){
  // `{url: op, ...op}` 只把同一个闭合请求记录重新展开一次。展开值会覆盖
  // 先写的 url，且先写的值只是无副作用的同一绑定读取；后续实时记录证明
  // 还会要求所有调用点都确定包含 url。满足这些条件时按 op 本身处理。
  const selfURLSpread=node=>{
   if(node?.type!=='ObjectExpression'||node.properties.length>2)return null;
   const spread=node.properties.at(-1),leading=node.properties.slice(0,-1);
   if(spread?.type!=='SpreadElement'||spread.argument.type!=='Identifier')return null;
   const binding=bindings.get(spread.argument);if(!binding)return null;
   if(leading.some(entry=>entry.type!=='Property'||entry.kind!=='init'||entry.method||entry.computed||key(entry)!=='url'||entry.value.type!=='Identifier'||bindings.get(entry.value)!==binding))return null;
   return spread.argument;
  };
  function stringValue(n,seen=new Set()){
   const stringMethods=new Set(['replace','replaceAll','trim','trimStart','trimEnd','toLowerCase','toUpperCase','toLocaleLowerCase','toLocaleUpperCase','normalize','padStart','padEnd','repeat','charAt','substring','substr']);
   if(values.string(n))return true;
   n=resolve(n,seen);if(!n)return false;
   if(n.type==='CallExpression'&&!n.optional&&n.callee.type==='MemberExpression'&&stringMethods.has(property(n.callee))&&values.type(n.callee.object)==='string')return true;
   if(n.type==='Literal')return typeof n.value==='string';
   if(n.type==='TemplateLiteral')return true;
   if(n.type==='Identifier'){
    const b=bindings.get(n);
    for(let owner=owners.get(n),position=-1;b&&functions.has(owner?.type);owner=owners.get(parents.get(owner))){
     position=owner.params.findIndex(p=>bindings.get(p.type==='AssignmentPattern'?p.left:p)===b);
     if(position<0)continue;
     const call=parents.get(owner);
     if(!b.writes.length&&!seen.has(b)&&['FunctionExpression','ArrowFunctionExpression'].includes(owner.type)&&call?.type==='CallExpression'&&call.callee===owner&&!call.optional&&!call.arguments.some(a=>a.type==='SpreadElement')){
      let argument=call.arguments[position],parameter=owner.params[position];
      if((!argument||free(argument,'undefined'))&&parameter.type==='AssignmentPattern')argument=parameter.right;
      if(argument&&stringValue(argument,new Set(seen).add(b)))return true;
     }
     break;
    }
   }
   if(n.type==='MemberExpression'){
    const obj=resolve(n.object,new Set(seen));
    if(obj?.type==='ObjectExpression')return obj.properties.every(p=>p.type==='Property'&&stringValue(p.value,new Set(seen)));
   }
   return false;
  }
  let f;if(stringValue(input))f=new Map([['url',input]]);else{
   f=forwardedHTTPFields(input,qx);
   // 闭合的实时请求记录：字段可静态枚举、唯一派发，所有字段修改都发生在派发之前，
   // 且请求对象的身份没有被别名复制或交给其它函数。请求参数可以在入口重绑一次为
   // 新的展开快照；此后只允许读取或改写已知字段。走与 $argument 相同的实时字段
   // 路径，发送时读取更新后的字段，不把修改折叠成表达式。
   const liveLocalRequest=(request=input)=>{
    if(request?.type!=='Identifier')return false;
    const consoleMethods=new Set(['log','warn','error','info','debug']);
    // 日志观察只有在 console 本身没有被重绑定、交给未知函数或动态读取时
    // 才等价于静态观察；否则请求对象可能逃逸到未知代码。
    const closedConsole=nodes.filter(n=>free(n,'console')).every(ref=>{
     const member=parents.get(ref),call=parents.get(member);
     return member?.type==='MemberExpression'&&member.object===ref&&consoleMethods.has(property(member))&&call?.type==='CallExpression'&&call.callee===member;
    });
    const consoleObservation=call=>closedConsole&&call?.type==='CallExpression'&&call.callee.type==='MemberExpression'&&free(call.callee.object,'console')&&consoleMethods.has(property(call.callee));
    // 证明赋值在边界求值前一定执行：向上只允许普通容器，且两者在同一个
    // 语句列表（块、switch case 或逗号序列）中按原文顺序出现。条件、循环、
    // 函数边界跨越都会让记录可能仍是 undefined。
    const definiteBefore=(write,boundary)=>{
     if(!boundary||write.end>boundary.start||owners.get(write)!==owners.get(boundary))return false;
     const ancestors=new Set();for(let item=boundary;item;item=parents.get(item))ancestors.add(item);
     let child=write;
     while(parents.get(child)&&!ancestors.has(parents.get(child))){
      const parent=parents.get(child);
      if(['IfStatement','ConditionalExpression','LogicalExpression','WhileStatement','DoWhileStatement','ForStatement','ForInStatement','ForOfStatement','SwitchStatement','TryStatement','CatchClause','FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(parent.type))return false;
      child=parent;
     }
     const common=parents.get(child);if(!common)return false;
     const list=common.type==='BlockStatement'||common.type==='Program'?common.body:common.type==='SwitchCase'?common.consequent:common.type==='SequenceExpression'?common.expressions:null;
     if(!list)return false;
     let boundaryChild=boundary;while(parents.get(boundaryChild)!==common)boundaryChild=parents.get(boundaryChild);
     const writeIndex=list.indexOf(child),boundaryIndex=list.indexOf(boundaryChild);
     return writeIndex>=0&&boundaryIndex>=0&&writeIndex<boundaryIndex;
    };
    // 延迟初始化的局部记录只允许一次直接对象赋值；所有读取都必须位于赋值
    // 之后，避免把未初始化时的 undefined 当成同一个闭合记录。
    const delayedRecordSource=(source,boundary)=>{
     if(!source||source.init||source.writes.length!==1)return null;
     const write=source.writes[0];
     if(write.type!=='AssignmentExpression'||write.operator!=='='||write.left.type!=='Identifier'||bindings.get(write.left)!==source||write.right.type!=='ObjectExpression')return null;
     if(!definiteBefore(write,boundary)||!source.refs.every(ref=>ref===write.left||ref.start>=write.end))return null;
     return write.right;
    };
    const binding=bindings.get(request);
    if(!binding||!binding.refs.length)return false;
    const parameter=nodes.some(n=>functions.has(n.type)&&n.params.some(p=>bindings.get(p.type==='AssignmentPattern'?p.left:p)===binding));
    const fields=['url','method','headers','header','body','bodyBytes','timeout','policy','policy-descriptor','node','params','redirection','followRedirect','follow-redirect','auto-redirect','auto-cookie','insecure','binary-mode','full-header-mode',...(qx?['opts']:[])];
    const sameBinding=ref=>bindings.get(ref)===binding;
    const parameterCallSites=target=>{
     const fn=nodes.find(n=>functions.has(n.type)&&n.params.some(p=>bindings.get(p.type==='AssignmentPattern'?p.left:p)===target));
     const fnParent=parents.get(fn),id=fn?.id??(fnParent?.type==='VariableDeclarator'?fnParent.id:null),fnBinding=id?.type==='Identifier'?bindings.get(id):null;
     const position=fn?.params.findIndex(p=>bindings.get(p.type==='AssignmentPattern'?p.left:p)===target);
     if(!fn||position<0)return null;
     let calls;
     if(fnParent?.type==='MethodDefinition'){
      // 方法调用点无法闭合时不能继续做参数记录证明，否则会越过拒绝面。
      const methodCalls=closedMethodCalls(fnParent);
      if(!methodCalls)return null;
      calls=methodCalls.map(call=>({call,actual:call.arguments[position]}));
     }
     else if(fnParent?.type==='CallExpression'&&fnParent.callee===fn&&!fnParent.optional&&!fnParent.arguments.some(a=>a.type==='SpreadElement'))calls=[{call:fnParent,actual:fnParent.arguments[position]}];
     else if(fnParent?.type==='Property'&&fnParent.value===fn&&!fnParent.computed&&key(fnParent)!==undefined)calls=replyCallers(fn).map(call=>({call,actual:call.arguments[position]}));
     else{
      if(!fnBinding||fnBinding.writes.length||!fnBinding.refs.length)return null;
      calls=[];
      for(const ref of fnBinding.refs){
       const call=parents.get(ref);
       if(call?.type==='CallExpression'&&call.callee===ref&&!call.optional&&!call.arguments.some(a=>a.type==='SpreadElement')){calls.push({call,actual:call.arguments[position]});continue;}
       // 函数值作为闭合调用转发器的首个实参时，转发器只会以剩余实参直接
       // 调用它；该转发点等价于一个真实调用点，实参取转发器第二项。
       if(call?.type==='CallExpression'&&call.arguments[0]===ref&&invocationForwarder(call)){calls.push({call,actual:call.arguments[1]});continue;}
       // 函数存在性观察不构成调用点，也不会把函数值交给未知代码；其余非
       // 调用引用仍拒绝，避免参数实参来源无法闭合。
       const member=call?.type==='MemberExpression'&&call.object===ref&&property(call)!==undefined&&!['call','apply','bind','constructor','prototype'].includes(String(property(call)));
       const memberParent=member&&parents.get(call);
       const observed=call?.type==='UnaryExpression'&&['typeof','!'].includes(call.operator)||
        ['IfStatement','WhileStatement','DoWhileStatement','ConditionalExpression'].includes(call?.type)&&call.test===ref||
        member&&!(memberParent?.type==='AssignmentExpression'&&memberParent.left===call||memberParent?.type==='UpdateExpression'||memberParent?.type==='UnaryExpression'&&memberParent.operator==='delete');
       if(!observed)return null;
      }
     }
     return calls?.length?{fn,position,calls}:null;
    };
    // 记录字段集合优先静态枚举。实参本身可以是不透明的运行期请求值，但只有
    // 参数绑定未复制、未逃逸、只访问白名单字段且只有一个派发点时才会走到这里。
    // 参数入口的一次自我快照（如 t={...defaults,...t}）仍要求旧字段集合由
    // 所有调用点的闭合实参共同证明。
    const recordFields=(node,seen=new Set(),selfFields=null,boundary=null)=>{
     if(free(node,'$request'))return new Set(['url','method','headers','body','bodyBytes']);
     if(node?.type==='Literal'&&typeof node.value==='string'||node?.type==='TemplateLiteral')return new Set(['url']);
     if(node?.type==='ConditionalExpression'&&node.test.type==='BinaryExpression'&&['===','=='].includes(node.test.operator)&&node.test.left.type==='UnaryExpression'&&node.test.left.operator==='typeof'&&node.test.left.argument.type==='Identifier'&&node.test.right.type==='Literal'&&node.test.right.value==='string'&&node.alternate.type==='Identifier'&&bindings.get(node.test.left.argument)===bindings.get(node.alternate)&&node.consequent.type==='ObjectExpression'&&node.consequent.properties.length===1&&node.consequent.properties[0].type==='Property'&&key(node.consequent.properties[0])==='url'&&node.consequent.properties[0].value.type==='Identifier'&&bindings.get(node.consequent.properties[0].value)===bindings.get(node.alternate))return recordFields(node.alternate,seen,selfFields,boundary)??new Set(['url']);
     if(node?.type==='Identifier'){
      if(sameBinding(node))return selfFields?new Set(selfFields):null;
      const source=bindings.get(node);
      if(!source||seen.has(source))return null;
      const assigned=delayedRecordSource(source,boundary);
      if(!source.init&&!assigned){
       // 局部函数的参数只有在所有调用点都能闭合到静态记录时，字段集合才
       // 能由实参共同证明。默认值仍按原规则只接受全部省略的调用点。
       const site=parameterCallSites(source);if(!site)return null;
       const all=new Set();
       for(const entry of site.calls){
        let actual=entry.actual,formal=site.fn.params[site.position];
        if(!actual||free(actual,'undefined'))actual=formal?.type==='AssignmentPattern'?formal.right:null;
        if(!actual)return null;
        const values=recordFields(actual,new Set(seen).add(source),null,entry.call);
        if(!values)return null;for(const name of values)all.add(name);
       }
       return all;
      }
      if(source.writes.length&&!assigned)return null;
      const result=recordFields(source.init??assigned,new Set(seen).add(source),null,boundary);
      if(!result||!boundary)return result;
      // 实参记录可以在调用前用静态字段逐项装配。只有同一函数内、无分支包裹、
      // 且在调用之前完成的普通赋值才加入字段集合；动态键、删除、更新和
      // 调用后的写入都不能证明请求字段在派发时存在。
      const boundaryOwner=owners.get(boundary);
      const ancestors=new Set();for(let node=boundary;node;node=parents.get(node))ancestors.add(node);
      for(const write of nodes){
       if(write.type!=='AssignmentExpression'||write.operator!=='='||write.left.type!=='MemberExpression'||write.left.object.type!=='Identifier'||bindings.get(write.left.object)!==source)continue;
       const field=property(write.left);
       if(field===undefined||!fields.includes(field))return null;
       // 其它函数里的字段规范化会在调用返回前实时生效，但不属于调用点的
       // 静态装配序列；它们不贡献“必定存在”的字段，也不据此拒绝记录。
       if(owners.get(write)!==boundaryOwner)continue;
       if(write.end>boundary.start)return null;
       // 写入必须与派发共享同一个语句列表，并在其中位于派发之前；中途出现
       // 分支、异常或循环时无法证明派发时字段已写入，只忽略该字段。
       let container=write;while(parents.get(container)&&!ancestors.has(parents.get(container)))container=parents.get(container);
       const common=parents.get(container);
       if(!common||!['BlockStatement','SwitchCase','Program'].includes(common.type))continue;
       const direct=node=>{while(parents.get(node)!==common)node=parents.get(node);return node;};
       const list=common.type==='SwitchCase'?common.consequent:common.body;
       const writeChild=direct(write),boundaryChild=direct(boundary);
       if(!list.includes(writeChild)||!list.includes(boundaryChild)||list.indexOf(writeChild)>=list.indexOf(boundaryChild))continue;
       for(let parent=parents.get(write);parent&&parent!==writeChild;parent=parents.get(parent)){
        if(['IfStatement','ConditionalExpression','LogicalExpression','TryStatement','ForStatement','ForInStatement','ForOfStatement','WhileStatement','DoWhileStatement'].includes(parent.type))continue;
       }
       result.add(field);
      }
      return result;
     }
     node=resolve(node,seen);
     if(free(node,'$request'))return new Set(['url','method','headers','body','bodyBytes']);
     if(node?.type==='Literal'&&typeof node.value==='string'||node?.type==='TemplateLiteral')return new Set(['url']);
     if(node?.type!=='ObjectExpression')return null;
     const result=new Set();
     for(const entry of node.properties){
      if(entry.type==='SpreadElement'){
       const argument=entry.argument;
       if(argument.type==='Identifier'&&sameBinding(argument)){
        if(!selfFields)return null;
        for(const name of selfFields)result.add(name);
        continue;
       }
       const spread=recordFields(argument,new Set(seen),null);
       if(!spread)return null;
       for(const name of spread)result.add(name);
       continue;
      }
      if(entry.type!=='Property'||entry.kind!=='init'||entry.method||key(entry)===undefined||!fields.includes(String(key(entry))))return null;
      result.add(String(key(entry)));
     }
     return result;
    };
    // 实参绑定可以来自调用点的局部记录；该记录除了作为本次实参，只能静态
    // 读取字段或交给已审查的日志/字符串化观察。交给未知函数、写入成员或
    // 复制别名都会让字段集合与对象身份不再闭合。
    const safeRecordSource=(actual,call)=>{
     if(actual?.type!=='Identifier')return true;
     const sourceBinding=bindings.get(actual);if(!sourceBinding)return true;
     const dispatchesThrough=(invocation,argument,seen=new Set())=>{
      const fn=target(invocation.callee),position=invocation.arguments.indexOf(argument);
      if(!fn||position<0||seen.has(fn))return false;
      const parameter=fn.params[position],id=parameter?.type==='AssignmentPattern'?parameter.left:parameter;
      const parameterBinding=id?.type==='Identifier'?bindings.get(id):null;
      if(!parameterBinding)return false;
      const next=new Set(seen);next.add(fn);
      return parameterBinding.refs.some(inner=>{
       const dispatch=parents.get(inner);
       if(dispatch?.type!=='CallExpression'||!dispatch.arguments.includes(inner))return false;
       if(dispatch.callee.type==='MemberExpression'&&(free(dispatch.callee.object,'$httpClient')||free(dispatch.callee.object,'$task')&&property(dispatch.callee)==='fetch'))return true;
       return dispatchesThrough(dispatch,inner,next);
      });
     };
     const ok=sourceBinding.refs.every(ref=>{
      if(ref===actual)return true;
      const member=parents.get(ref),use=parents.get(member);
      if(member?.type==='AssignmentExpression'&&member.left===ref&&delayedRecordSource(sourceBinding,call)===member.right)return true;
      if(member?.type==='MemberExpression'&&member.object===ref&&property(member)!==undefined){
       if((use?.type==='AssignmentExpression'&&use.left===member||use?.type==='UpdateExpression'||use?.type==='UnaryExpression'&&use.operator==='delete')&&sourceBinding.init?.type!=='ObjectExpression')return false;
       return true;
      }
      if(member?.type==='BinaryExpression'&&['in','===','!==','==','!='].includes(member.operator)||member?.type==='UnaryExpression'&&['typeof','!'].includes(member.operator))return true;
      if(member?.type==='CallExpression'&&member.arguments.includes(ref)){
       if(member.callee.type==='MemberExpression'&&free(member.callee.object,'JSON')&&property(member.callee)==='stringify')return true;
       if(consoleObservation(member))return true;
       if(free(member.callee,'$log'))return true;
       if(dispatchesThrough(member,ref))return true;
      }
      return false;
     });
     return ok;
    };
    const rootObjectBinding=node=>{
     if(node?.type!=='Identifier')return null;
     let binding=bindings.get(node),seen=new Set();
     while(binding&&!seen.has(binding)){
      seen.add(binding);
      if(binding.init?.type==='ObjectExpression')return binding;
      if(binding.init?.type==='Identifier'&&!binding.writes.length){binding=bindings.get(binding.init);continue;}
      return null;
     }
     return null;
    };
    // 字段值交由未知函数处理时，只有能证明该值在运行时恒为 undefined 才安全。
    // 这覆盖直接缺席的参数字段，以及由这种字段逐项装配的局部记录字段。
    const fieldValueAbsent=(node,seen=new Set())=>{
     if(!node)return false;
     if(free(node,'undefined'))return true;
     if(node.type==='UnaryExpression'&&node.operator==='void'&&node.argument.type==='Literal')return true;
     if(node.type!=='MemberExpression'||property(node)===undefined)return false;
     const field=String(property(node));
     if(node.object.type==='Identifier'){
      const source=bindings.get(node.object),site=source&&parameterCallSites(source);
      if(site&&!seen.has(source)){
       const next=new Set(seen);next.add(source);
       const result=site.calls.every(entry=>{
        let actual=entry.actual,formal=site.fn.params[site.position];
        if(!actual||free(actual,'undefined'))actual=formal?.type==='AssignmentPattern'?formal.right:null;
        if(!actual)return true;
        if(!safeRecordSource(actual,entry.call))return false;
        const record=recordFields(actual,new Set(),null,entry.call);
        return !!record&&!record.has(field);
       });
       return result;
      }
     }
     const root=rootObjectBinding(node.object);
     if(!root)return false;
     let write=null;
     for(const candidate of nodes){
      if(candidate.type!=='AssignmentExpression'||candidate.operator!=='='||candidate.left.type!=='MemberExpression')continue;
      if(bindings.get(candidate.left.object)!==root||property(candidate.left)!==field)continue;
      if(candidate.end>node.start||owners.get(candidate)!==owners.get(node))continue;
      if(write)return false;
      write=candidate;
     }
     if(!write){
      if(root.init.properties.some(entry=>entry.type!=='Property'||entry.kind!=='init'||key(entry)===undefined))return false;
      return !root.init.properties.some(entry=>key(entry)===field);
     }
     const ancestors=new Set();for(let item=node;item;item=parents.get(item))ancestors.add(item);
     let common=write;while(common&&!ancestors.has(common))common=parents.get(common);
     if(!common)return false;
     const control=new Set(['IfStatement','ConditionalExpression','LogicalExpression','WhileStatement','DoWhileStatement','ForStatement','ForInStatement','ForOfStatement','SwitchCase','TryStatement']);
     if(control.has(common.type))return false;
     for(let item=write;item&&item!==common;item=parents.get(item))if(control.has(item.type))return false;
     const result=fieldValueAbsent(write.right,seen);
     return result;
    };
    const parameterRecords=()=>{
     if(!parameter)return null;
     const site=parameterCallSites(binding);
     if(!site)return null;
     return site.calls.map(entry=>{
      let actual=entry.actual,formal=site.fn.params[site.position];
      if(!actual||free(actual,'undefined')||actual.type==='UnaryExpression'&&actual.operator==='void'&&actual.argument.type==='Literal')actual=formal?.type==='AssignmentPattern'?formal.right:null;
      if(actual&&!safeRecordSource(actual,entry.call))return null;
      const record=actual?recordFields(actual,new Set(),null,entry.call):null;
      return record;
     });
    };
    const sourceRecords=parameter?parameterRecords():null;
    if(parameter&&!sourceRecords)return false;
    const selfFields=sourceRecords?.every(Boolean)?new Set(sourceRecords.flatMap(record=>[...record])):null;
    const baseFields=parameter?selfFields:binding.init&&recordFields(binding.init);
    let finalFields=null;
    if(!parameter){
     if(!binding.init||binding.writes.length)return false;
     // 局部别名可以在别名建立前由源记录逐项装配字段；以别名读取点为界，
     // 只吸收此前、同一语句列表内完成的静态写入。
     finalFields=recordFields(binding.init,new Set(),null,request);
     if(!finalFields)return false;
    }else{
     if(binding.writes.length>1)return false;
     if(binding.writes.length){
      const write=binding.writes[0];
      if(write.type!=='AssignmentExpression'||write.operator!=='='||write.left.type!=='Identifier'||!sameBinding(write.left))return false;
      finalFields=recordFields(write.right,new Set(),selfFields);
      if(!finalFields)return false;
     }
    }
    const dispatchOf=ref=>{
     const spread=parents.get(ref);
     if(spread?.type==='SpreadElement'&&spread.argument===ref&&parents.get(spread)===input&&selfURLSpread(input)===ref){
      const call=parents.get(input);
      if(call?.type==='CallExpression'&&call.arguments.includes(input)&&isAPI(call,'$task','fetch'))return call;
     }
     const call=parents.get(ref);
     if(call?.type!=='CallExpression'||!call.arguments.includes(ref))return null;
     if(call.callee.type==='MemberExpression'){
      if(free(call.callee.object,'$httpClient'))return call;
      if(free(call.callee.object,'$task')&&property(call.callee)==='fetch')return call;
     }
     // 请求记录作为闭合三参转发器的第二个实参时，转发器本身已证明只做
     // 方法(请求, 回调)的原序转交，因此仍是唯一派发点。
     if(call.arguments[1]===ref&&closedForwarder(call)&&httpDispatch(call))return call;
     return null;
    };
    const dispatches=binding.refs.map(dispatchOf).filter(Boolean);
    if(!dispatches.length)return false;
    // 同一记录可能在同一 if/else 决策树的两个互斥分支里各自派发一次。
    // 只有两两互斥时才允许多个派发点；顺序执行的两个接收者仍然拒绝。
    const exclusive=(a,b)=>{
     for(let ancestor=parents.get(a);ancestor;ancestor=parents.get(ancestor)){
      if(ancestor.type!=='IfStatement'&&ancestor.type!=='ConditionalExpression')continue;
      const consequent=ancestor.consequent,alternate=ancestor.alternate;if(!consequent||!alternate)continue;
      const side=(node,part)=>part.start<=node.start&&node.end<=part.end;
      const left=side(a,consequent)?'consequent':side(a,alternate)?'alternate':null;
      const right=side(b,consequent)?'consequent':side(b,alternate)?'alternate':null;
      if(left&&right&&left!==right)return true;
     }
     return false;
    };
    if(dispatches.length>1&&!dispatches.every((a,i)=>dispatches.every((b,j)=>i===j||exclusive(a,b))))return false;
    const dispatch=dispatches[0],dispatchSet=new Set(dispatches);
    const firstDispatch=dispatches.reduce((a,b)=>a.start<=b.start?a:b);
    if(parameter&&binding.writes.length&&binding.writes[0].end>=firstDispatch.start)return false;
    // 请求对象仍可能被派发后才运行的定时器或回调捕获。这些捕获不能改写已发送
    // 的内容，但也不得修改记录或创建可再次派发的别名。
    const dispatchOwner=owners.get(dispatch),deferredFns=new Set();
    if(dispatches.some(call=>owners.get(call)!==dispatchOwner))return false;
    const addCallback=(value)=>{const fn=target(value);if(fn&&fn!==dispatchOwner)deferredFns.add(fn);};
    const addCallCallbacks=(call,seen=new Set())=>{
     if(!call||seen.has(call))return;seen=new Set(seen);seen.add(call);
     for(const argument of call.arguments)addCallback(argument);
     const holder=parents.get(call);
     if(holder?.type==='MemberExpression'&&holder.object===call&&['then','catch','finally'].includes(property(holder))){
      const chained=parents.get(holder);
      if(chained?.type==='CallExpression'&&chained.callee===holder)addCallCallbacks(chained,seen);
     }
    };
    for(const call of dispatches)addCallCallbacks(call);
    for(const call of nodes)if(call.type==='CallExpression'&&owners.get(call)===dispatchOwner&&(free(call.callee,'setTimeout')||free(call.callee,'setInterval')))for(const argument of call.arguments)addCallback(argument);
    const pending=[...deferredFns];
    while(pending.length){
     const fn=pending.pop();
     for(const call of nodes)if(call.start>=fn.start&&call.end<=fn.end&&call.type==='CallExpression'){
      const called=target(call.callee);
      if(called&&called!==dispatchOwner&&!deferredFns.has(called)){deferredFns.add(called);pending.push(called);}
      for(const argument of call.arguments){const callback=target(argument);if(callback&&callback!==dispatchOwner&&!deferredFns.has(callback)){deferredFns.add(callback);pending.push(callback);}}
     }
    }
    const deferredRef=ref=>deferredFns.has(owners.get(ref));
    const mutatesRequest=ref=>{
     let node=ref;
     while(parents.get(node)?.type==='MemberExpression'&&parents.get(node).object===node)node=parents.get(node);
     const use=parents.get(node),direct=parents.get(ref);
     return direct?.type==='AssignmentExpression'&&direct.left===ref||
      use?.type==='AssignmentExpression'&&use.left===node||use?.type==='UpdateExpression'||use?.type==='UnaryExpression'&&use.operator==='delete';
    };
    const deferredEscape=ref=>{
     const p=parents.get(ref);
     return p?.type==='VariableDeclarator'&&p.init===ref||p?.type==='ReturnStatement'||p?.type==='AssignmentExpression'||p?.type==='ArrayExpression';
    };
    const observing=ref=>{
     const p=parents.get(ref);
     if(p?.type==='UnaryExpression'&&['typeof','!'].includes(p.operator))return true;
     if(p?.type==='BinaryExpression'&&['===','!==','==','!='].includes(p.operator))return true;
     if(p?.type==='LogicalExpression'&&p.left===ref||p?.type==='LogicalExpression'&&p.right===ref)return true;
     if(['IfStatement','WhileStatement','DoWhileStatement','ConditionalExpression'].includes(p?.type)&&p.test===ref)return true;
     if(p?.type==='SequenceExpression'&&p.expressions.at(-1)===ref)return true;
     return p?.type==='ExpressionStatement';
    };
    const conditionalWrite=node=>{
     for(let child=node,parent=parents.get(child);parent&&!functions.has(parent.type);child=parent,parent=parents.get(child)){
      if(parent.type==='IfStatement'&&(parent.consequent===child||parent.alternate===child))return true;
      if(parent.type==='ConditionalExpression'&&(parent.consequent===child||parent.alternate===child))return true;
      if(parent.type==='LogicalExpression'&&parent.right===child)return true;
      if(['WhileStatement','DoWhileStatement','ForStatement','ForInStatement','ForOfStatement','SwitchCase','TryStatement'].includes(parent.type))return true;
     }
     return false;
    };
    const transportFlag=field=>['binary-mode','full-header-mode','auto-redirect','auto-cookie','insecure'].includes(field);
    for(const ref of binding.refs){
     const p=parents.get(ref),q=parents.get(p);
     if(dispatchSet.has(p))continue;
     if(deferredRef(ref)){
      if(mutatesRequest(ref)||deferredEscape(ref))return false;
      continue;
     }
     if(parameter&&binding.writes.length&&ref.start>=binding.writes[0].right.start&&ref.end<=binding.writes[0].right.end){
      let child=ref,parent=parents.get(child);
      while(parent&&child!==binding.writes[0].right){
       if(['CallExpression','NewExpression','ReturnStatement'].includes(parent.type))break;
       child=parent;parent=parents.get(child);
      }
      if(child===binding.writes[0].right||parent===binding.writes[0].right)continue;
     }
     if(p?.type==='AssignmentExpression'&&p.left===ref){
      if(!parameter||binding.writes.length!==1||binding.writes[0]!==p)return false;
      continue;
     }
     if(p?.type==='Property'&&p.value===ref&&parents.get(p)===input&&key(p)==='url'&&bindings.get(selfURLSpread(input))===binding)continue;
     if(p?.type==='SpreadElement'&&p.argument===ref&&q===input&&selfURLSpread(input)===ref)continue;
     if(p?.type!=='MemberExpression'||p.object!==ref||property(p)===undefined)return false;
     const field=String(property(p));
     // 参数记录的字段集合来自所有闭合调用点。读取一个在所有记录中都不存在的
     // 字段等价于 undefined；只允许这种静态缺席读取，不能把任意未知字段
     // 视为可转发。原型链上的名字仍按未知字段拒绝。
     const absent=parameter&&selfFields&&!selfFields.has(field)&&!['__proto__','constructor','prototype','toString','toLocaleString','valueOf','hasOwnProperty','isPrototypeOf','propertyIsEnumerable','__defineGetter__','__defineSetter__','__lookupGetter__','__lookupSetter__'].includes(field);
     if(!fields.includes(field)&&!absent)return false;
     if(q?.type==='MemberExpression'&&q.object===p){
      const nested=property(q);
      if(nested===undefined)return false;
      if(field==='headers'||field==='header'){
       const use=parents.get(q);
       if(use?.type==='AssignmentExpression'&&use.left===q){if(use.operator!=='='||!(use.end<firstDispatch.start))return false;}
       else if(use?.type==='UnaryExpression'&&use.operator==='delete'&&use.argument===q){if(!(use.end<firstDispatch.start))return false;}
       else if(use?.type==='CallExpression'&&use.callee===q)return false;
       continue;
      }
      if(field==='method'&&['toLocaleLowerCase','toLowerCase'].includes(String(nested))&&parents.get(q)?.type==='CallExpression'&&parents.get(q).callee===q)continue;
      if(field==='opts'&&qx&&['redirection','skip-cert-verify','auto-cookie','policy'].includes(String(nested))){
       const use=parents.get(q);
       if(use?.type==='AssignmentExpression'&&use.left===q){if(use.operator!=='='||!(use.end<firstDispatch.start))return false;continue;}
       if(use?.type==='UnaryExpression'&&use.operator==='delete'&&use.argument===q){if(!(use.end<firstDispatch.start))return false;continue;}
       if(use?.type==='CallExpression'&&use.callee===q)return false;
       continue;
      }
      return false;
     }
     if(q?.type==='AssignmentExpression'&&q.left===p){
      if(q.operator!=='='&&!(q.operator==='+='&&field==='url'))return false;
      if(!(q.end<firstDispatch.start))return false;
      if(transportFlag(field)){
       const value=resolve(q.right);
       if(baseFields?.has(field)&&(conditionalWrite(q)||value?.type!=='Literal'||typeof value.value!=='boolean'))return false;
      }
      continue;
     }
     if(q?.type==='UpdateExpression')return false;
     if(q?.type==='UnaryExpression'&&q.operator==='delete'&&q.argument===p){if(field==='url'||!(q.end<firstDispatch.start))return false;continue;}
     if(q?.type==='CallExpression'&&q.arguments.includes(p)){
      if(field==='headers'&&free(q.callee.object,'Object')&&property(q.callee)==='assign'){if(!(q.end<firstDispatch.start))return false;continue;}
      // 所有闭合调用点都缺席的字段值恒为 undefined；把该值交给未知函数只会
      // 观察一个不可变的基本值，不可能借此修改请求记录。
      if(absent||fieldValueAbsent(p))continue;
      if(['url','method','timeout','policy','policy-descriptor','node','params','redirection','followRedirect','follow-redirect','auto-redirect','auto-cookie','insecure','binary-mode','full-header-mode'].includes(field))continue;
      return false;
     }
     if(q?.type==='CallExpression'&&q.callee===p)return false;
     if(p?.type==='VariableDeclarator'&&p.init===ref&&p.id.type==='Identifier')return false;
     if(q?.type==='SpreadElement')return false;
     if(p?.type==='CallExpression'&&p.arguments.includes(ref)){
      const callee=p.callee;
      if(callee.type==='MemberExpression'&&free(callee.object,'console')&&closedConsole&&consoleMethods.has(property(callee)))continue;
      if(callee.type==='MemberExpression'&&free(callee.object,'JSON')&&property(callee)==='stringify')continue;
      if(free(callee,'$log'))continue;
      return false;
     }
     if(observing(ref)||observing(p))continue;
    }
    const assignsField=(node,name)=>{
     if(!node||functions.has(node.type))return false;
     if(node.type==='AssignmentExpression')return (node.operator==='='||node.operator==='+='&&name==='url')&&node.left.type==='MemberExpression'&&sameBinding(node.left.object)&&property(node.left)===name;
     if(node.type==='IfStatement')return assignsField(node.test,name)||assignsField(node.consequent,name)&&assignsField(node.alternate,name);
     if(node.type==='ConditionalExpression')return assignsField(node.test,name)||assignsField(node.consequent,name)&&assignsField(node.alternate,name);
     if(node.type==='LogicalExpression')return assignsField(node.left,name)||assignsField(node.right,name);
     if(node.type==='ExpressionStatement')return assignsField(node.expression,name);
     if(['BlockStatement','Program'].includes(node.type))return node.body.some(statement=>assignsField(statement,name));
     if(node.type==='SequenceExpression')return node.expressions.some(expression=>assignsField(expression,name));
     return false;
    };
    const assignedBefore=name=>{
     for(let child=dispatch,parent=parents.get(child);parent&&!functions.has(parent.type);child=parent,parent=parents.get(child)){
      if(['BlockStatement','Program'].includes(parent.type)){
       const position=parent.body.indexOf(child);
       if(position>=0&&parent.body.slice(0,position).some(statement=>assignsField(statement,name)))return true;
      }
     }
     return false;
    };
    const urlDefinite=(finalFields??(parameter?selfFields:null))?.has('url')||!parameter&&sourceRecords?.every(record=>record.has('url'))||assignedBefore('url');
    if(!urlDefinite)return false;
    return true;
   };
   const live=liveLocalRequest(selfURLSpread(input)??input);
   if(!f&&(free(input,'$argument')&&!qx||live)){
    // 静的可见记录不允许把传输标志留到运行期判断：只能静态证明未启用才放行。
    // $argument 派生记录本身是运行期输入，沿用既有运行期守卫，不在本单元改动范围内。
    if(!free(input,'$argument')){
     const visible=resolve(input);
     if(visible?.type==='ObjectExpression')for(const property of visible.properties){
      if(property.type!=='Property')continue;
      const name=String(key(property));
      if(!['binary-mode','full-header-mode'].includes(name))continue;
      const value=resolve(property.value);
      if(!(value?.type==='Literal'&&value.value===false))fail(input,'HTTP 请求的 '+name+' 必须静态证明未启用');
     }
    }
    const request=fresh('httpRequest'),dynamicMethod=!method?.value&&(!!method?.expression||qx&&live&&!method),selector=dynamicMethod?fresh('httpMethod'):null;
    const methodValue=method?.expression?render(method.expression):`${request}?.method`;
    const callee=method?.value?render(method.value):dynamicMethod?`((${selector}) => {${selector}=String(${selector} ?? 'get').toLowerCase();if (!['get','post','put','delete','head','options','patch'].includes(${selector})) throw new TypeError('Unsupported HTTP method');return ${context}.http[${selector}];})(${methodValue}).bind(${context}.http)`:`${context}.http.${(method||'GET').toLowerCase()}`;
    const url=`typeof ${request} === 'string' ? ${request} : ${request}.url`;
    const headers=`${request}?.headers ?? ${request}?.header`,body=`${request}?.bodyBytes ?? ${request}?.body`,policy=`${request}?.policy ?? ${request}?.node`;
    // QX 未设置 timeout 时由平台使用缺省 5000ms；省略字段与写出缺省值等价。
    // 显式值（包括运行期确定的非 undefined 值）仍按毫秒原样转发。
    const options=qx
     ?`{...((${headers}) === undefined ? {} : {headers: ${headers}}), ...((${body}) === undefined ? {} : {body: ${body}}), ...(${request}?.timeout === undefined ? {} : {timeout: ${request}.timeout}), ...((${policy}) === undefined ? {} : {policy: ${policy}}), redirect: ${request}?.["auto-redirect"] === undefined || ${request}?.["auto-redirect"] ? 'follow' : 'manual', credentials: ${request}?.["auto-cookie"] ? 'include' : 'omit', insecureTls: ${request}?.insecure === true}`
     :`{...((${headers}) === undefined ? {} : {headers: ${headers}}), ...((${body}) === undefined ? {} : {body: ${body}}), timeout: ${request}?.timeout === undefined ? 5000 : ${request}.timeout * ${format==='loon'?1:1000}, ...((${policy}) === undefined ? {} : {policy: ${policy}}), ...(${request}?.["policy-descriptor"] === undefined ? {} : {policyDescriptor: ${request}["policy-descriptor"]}), redirect: ${request}?.["auto-redirect"] === undefined || ${request}?.["auto-redirect"] ? 'follow' : 'manual', credentials: ${request}?.["auto-cookie"] === false ? 'omit' : 'include', ...(${request}?.insecure === undefined ? {} : {insecureTls: ${request}.insecure})}`;
    const call=`${callee}(${url}, ${options})`,guard=`if (${request} && typeof ${request} === 'object' && (${request}["binary-mode"] === true || ${request}["full-header-mode"] === true)) throw new Error('Dynamic binary-mode/full-header-mode requires a static HTTP request record');`,code=`((${request}) => {${guard}return ${call};})(${render(input)})`;
    return {code,url,options,callee,dynamic:dynamicMethod,binary:false,full:false,runtimeRequest:{name:request,expression:input,binaryGuard:true}};
   }
   if(!f)f=object(input,'HTTP 请求');
  }
  // Several multi-platform SDKs use the singular `header` spelling in their
  // request record, while both native client APIs require `headers`. Resolve
  // this closed alias at the conversion boundary and reject ambiguity.
  if(f.has('header')){
   if(f.has('headers'))fail(input,'HTTP 请求同时包含 header 与 headers，无法确定合并顺序');
   f.set('headers',f.get('header'));f.delete('header');
  }
  for(const k of ['_method','_respType','_timeout','params'])f.delete(k);
  // Explicitly disabling got-style status exceptions matches native HTTP:
  // HTTP error statuses remain responses; transport errors still reject.
  if(f.has('throwHttpErrors')){if(resolve(f.get('throwHttpErrors'))?.type!=='Literal'||resolve(f.get('throwHttpErrors')).value!==false)fail(input,'HTTP throwHttpErrors 仅支持明确关闭状态码异常');f.delete('throwHttpErrors');}
  const callbackSelector=method?.expression;
  if(!qx&&method&&f.has('method')){const declared=resolve(f.get('method'));if(!callbackSelector&&(declared?.type!=='Literal'||typeof declared.value!=='string'||declared.value.toLowerCase()!==method.toLowerCase()))fail(input,'HTTP 参数 method 与所调用的方法不一致或无法静态确定');f.delete('method');}
  // opts.filter belongs to QX's isolated response-filter environment, not
  // callback HTTP clients. Multi-platform scripts sometimes pass the same
  // record to both. Only a closed literal filter is inert in this branch;
  // unknown options, getters and effectful initializers still need a proof.
  if(!qx&&f.has('opts')){
   let original=f.get('opts');if(fieldValues.has(original))original=fieldValues.get(original);
   if(original?.type==='Identifier'){
    const binding=bindings.get(original);
    if(!binding||binding.writes.length||binding.refs.some(ref=>{const p=parents.get(ref);return p?.type!=='Property'||p.value!==ref||key(p)!=='opts';}))fail(input,'回调 HTTP 的 QX opts 引用逃逸或发生修改');
   }
   const opts=resolve(f.get('opts'));
   if(opts?.type!=='ObjectExpression'||opts.properties.some(p=>p.type!=='Property'||p.kind!=='init'||p.method||key(p)!=='filter'||p.value.type!=='Literal'||typeof p.value.value!=='string'))fail(input,'回调 HTTP 的 QX opts 仅支持静态 filter 字符串');
   object(f.get('opts'),'回调 HTTP 的 QX opts');f.delete('opts');
  }
  const allowed=qx?['url','method','headers','body','bodyBytes','timeout','opts']:['url','headers','body','timeout','policy','policy-descriptor','insecure','auto-redirect','auto-cookie','binary-mode','full-header-mode',...(format==='loon'?['node']:[])];
  for(const k of f.keys())if(!allowed.includes(k))fail(input,'未适配 HTTP 参数：'+k);
  if(!f.has('url'))fail(input,'HTTP 请求缺少 URL');
  const declaredMethod=f.get('method'),dynamicMethod=!!callbackSelector||qx&&!method&&fieldValues.has(declaredMethod)&&resolve(declaredMethod)?.type!=='Literal';
  if(!method?.value)method=method??resolve(declaredMethod)?.value??'GET';
  if(!method?.value&&!dynamicMethod&&(typeof method!=='string'||!['get','post','put','delete','head','options','patch'].includes(method.toLowerCase())))fail(input,'HTTP 方法必须可静态确定');
  const out=[];if(f.has('headers')){const captured=fresh('httpHeaders');let h=captured;if(f.has('body')||f.has('bodyBytes'))h=cleanHeaders(h,['content-length','transfer-encoding']);out.push(`...((${captured}) => ${captured} == null ? {} : {headers: ${h}})(${render(f.get('headers'))})`);}
  if(f.has('bodyBytes'))out.push(optionalHTTPFields.has(f.get('bodyBytes'))?`...(${render(f.get('bodyBytes'))} === undefined ? {} : {body: ${bytes(f.get('bodyBytes'))}})`:'body: '+bytes(f.get('bodyBytes')));else if(f.has('body'))out.push(optionalHTTPFields.has(f.get('body'))?`...(${render(f.get('body'))} === undefined ? {} : {body: ${bodyValue(f.get('body'))}})`:'body: '+bodyValue(f.get('body')));
  const flag=(m,k,fallback)=>{if(!m.has(k))return fallback;const v=resolve(m.get(k));if(v.type!=='Literal'||typeof v.value!=='boolean')fail(v,'HTTP 布尔参数必须可静态确定：'+k);return v.value;};
  if(qx){const o=f.has('opts')?object(f.get('opts'),'QX HTTP 选项'):new Map();for(const k of o.keys())if(!['redirection','skip-cert-verify','auto-cookie','policy'].includes(k))fail(input,'未适配 HTTP opts：'+k);
   if(f.has('timeout'))out.push('timeout: '+render(f.get('timeout')));
   out.push(`redirect: '${flag(o,'redirection',true)?'follow':'manual'}'`,`credentials: '${flag(o,'auto-cookie',false)?'include':'omit'}'`,`insecureTls: ${flag(o,'skip-cert-verify',false)}`);if(o.has('policy'))out.push('policy: '+render(o.get('policy')));
  }else{
   const timeout=fresh('httpTimeout');
   out.push('timeout: '+(f.has('timeout')?`((${timeout}) => ${timeout} === undefined ? 5000 : ${timeout} * ${format==='loon'?1:1000})(${render(f.get('timeout'))})`:5000));
   if(f.has('policy')||f.has('node')){const policy=f.get('policy')??f.get('node');out.push(optionalHTTPFields.has(policy)?`...(${render(policy)} === undefined ? {} : {policy: ${render(policy)}})`:'policy: '+render(policy));}
   if(f.has('policy-descriptor'))out.push('policyDescriptor: '+render(f.get('policy-descriptor')));
   out.push(`redirect: '${flag(f,'auto-redirect',true)?'follow':'manual'}'`,`credentials: '${flag(f,'auto-cookie',true)?'include':'omit'}'`);if(f.has('insecure'))out.push('insecureTls: '+flag(f,'insecure',false));
  }
  const selector=dynamicMethod?fresh('httpMethod'):null;
  const url=render(f.get('url')),options=`{${out.join(', ')}}`,callee=method?.value?render(method.value):dynamicMethod?`((${selector}) => {if (!['get','post','put','delete','head','options','patch'].includes(${selector})) throw new TypeError('Unsupported HTTP method');return ${context}.http[${selector}];})(${callbackSelector?render(callbackSelector):render(declaredMethod)+'.toLowerCase()'}).bind(${context}.http)`:`${context}.http.${method.toLowerCase()}`;
  const call=`${callee}(${url}, ${options})`,runtime=f.runtimeRequest,guard=runtime?.binaryGuard?`if (${runtime.name} && typeof ${runtime.name} === 'object' && (${runtime.name}["binary-mode"] === true || ${runtime.name}["full-header-mode"] === true)) throw new Error('Dynamic binary-mode/full-header-mode requires a static HTTP request record');`:'',code=runtime?`((${runtime.name}) => {${guard}return ${call};})(${render(runtime.expression)})`:call;
  return {code,url,options,callee,dynamic:method?.value?false:dynamicMethod,binary:flag(f,'binary-mode',false),full:flag(f,'full-header-mode',false),runtimeRequest:f.runtimeRequest};
 }
 function forwardedHTTPFields(input,qx){
  const parsedRequest=input?.type==='CallExpression'&&input.arguments.length===1&&input.callee.type==='MemberExpression'&&free(input.callee.object,'JSON')&&property(input.callee)==='parse';
  if(input?.type!=='Identifier'&&!parsedRequest)return null;
  // 只接受从当前请求对象直接转发的 headers；其内容在运行期确定，发送前
  // 仍由二进制模式守卫拒绝无法静态映射的响应形态。
  const requestHeaders=(node,seen=new Set())=>{
   if(node?.type==='LogicalExpression'&&node.operator==='||')return requestHeaders(node.left,seen)&&requestHeaders(node.right,seen);
   if(node?.type==='ObjectExpression')return !node.properties.length;
   if(node?.type==='Identifier'&&free(node,'$request'))return true;
   if(node?.type!=='MemberExpression'||node.computed||property(node)!=='headers'||node.object.type!=='Identifier')return false;
   if(free(node.object,'$request'))return true;
   const binding=bindings.get(node.object);if(!binding||seen.has(binding))return false;
   const fn=nodes.find(candidate=>functions.has(candidate.type)&&candidate.params.some(parameter=>bindings.get(parameter.type==='AssignmentPattern'?parameter.left:parameter)===binding));
   if(!fn)return false;
   const position=fn.params.findIndex(parameter=>bindings.get(parameter.type==='AssignmentPattern'?parameter.left:parameter)===binding);
   const parent=parents.get(fn),id=fn.id??(parent?.type==='VariableDeclarator'?parent.id:null),fnBinding=id?.type==='Identifier'?bindings.get(id):null;
   let calls;
   if(parent?.type==='CallExpression'&&parent.callee===fn&&!parent.optional&&!parent.arguments.some(argument=>argument.type==='SpreadElement'))calls=[parent];
   else if(fnBinding&&!fnBinding.writes.length&&fnBinding.refs.length)calls=fnBinding.refs.map(ref=>{const call=parents.get(ref);return call?.type==='CallExpression'&&call.callee===ref&&!call.optional&&!call.arguments.some(argument=>argument.type==='SpreadElement')?call:null;});
   else return false;
   if(!calls.length||calls.some(call=>!call))return false;
   const next=new Set(seen);next.add(binding);
   return calls.every(call=>requestHeaders(call.arguments[position],next));
  };
  // A closed request helper may normalize a string/object parameter and then
  // mutate that same record before dispatch. Keep those authored mutations in
  // place and project the live fields at the native call. Every external
  // caller and every field the helper touches must fit this closed record.
  function closedLiveRequest(ref){
   const stop=()=>null;
   if(ref?.type!=='Identifier')return stop('ref');
   const binding=bindings.get(ref);if(!binding)return stop('binding');
   const fn=nodes.find(n=>functions.has(n.type)&&n.params.some(p=>bindings.get(p.type==='AssignmentPattern'?p.left:p)===binding));
   if(!fn)return stop('fn');
   const parent=parents.get(fn),id=fn.id??(parent?.type==='VariableDeclarator'?parent.id:null),fnBinding=id?.type==='Identifier'?bindings.get(id):null;
   const position=fn.params.findIndex(p=>bindings.get(p.type==='AssignmentPattern'?p.left:p)===binding);
   let calls;
   if(parent?.type==='MethodDefinition')calls=closedMethodCalls(parent);
   else if(parent?.type==='CallExpression'&&parent.callee===fn&&!parent.optional&&!parent.arguments.some(a=>a.type==='SpreadElement'))calls=[parent];
   else{
    if(!fnBinding||fnBinding.writes.length||!fnBinding.refs.length)return stop('fn binding');
    calls=fnBinding.refs.map(ref=>{
    const direct=parents.get(ref);
    if(direct?.type==='CallExpression'&&direct.callee===ref&&!direct.optional&&!direct.arguments.some(a=>a.type==='SpreadElement'))return direct;
    const wrapperCall=direct?.type==='CallExpression'&&direct.arguments.includes(ref)?direct:null;
    const wrapper=wrapperCall&&target(wrapperCall.callee);
    if(!wrapperCall||!functions.has(wrapper?.type)||wrapper.async||wrapper.generator||wrapper.params.some(p=>p.type!=='Identifier')||wrapperCall.arguments.some(a=>a.type==='SpreadElement'))return null;
    const statements=wrapper.body.type==='BlockStatement'?wrapper.body.body.filter(s=>s.type!=='EmptyStatement'):[{type:'ReturnStatement',argument:wrapper.body}];
    const forwarded=statements.length===1&&statements[0].type==='ReturnStatement'?statements[0].argument:null;
    if(forwarded?.type!=='CallExpression'||forwarded.optional||forwarded.callee.type!=='Identifier')return null;
    const forwardedParam=wrapper.params.findIndex(p=>bindings.get(p)===bindings.get(forwarded.callee));
    if(forwardedParam<0||wrapperCall.arguments[forwardedParam]!==ref||forwarded.arguments.some(a=>a.type==='SpreadElement'))return null;
    const allowedParams=new Set([forwarded.callee,...forwarded.arguments].filter(a=>a.type==='Identifier').map(a=>bindings.get(a)));
    if(wrapper.params.some(p=>{const pb=bindings.get(p);return pb?.writes.length||pb?.refs.some(r=>!allowedParams.has(pb)||!([forwarded.callee,...forwarded.arguments].includes(r)));}))return null;
    const args=forwarded.arguments.map(arg=>{
     if(arg.type==='Identifier'){
      const i=wrapper.params.findIndex(p=>bindings.get(p)===bindings.get(arg));
      if(i>=0)return wrapperCall.arguments[i]??null;
     }
     return arg.type==='Literal'||arg.type==='TemplateLiteral'&&!arg.expressions.length?arg:null;
    });
    return args.some(a=>!a)?null:{...wrapperCall,arguments:args};
    });
   }
   if(!calls?.length||calls.some(c=>!c||!c.arguments[position]&&fn.params[position]?.type!=='AssignmentPattern'))return null;
   // 直接 IIFE 或具名 helper 的实参可能来自外层请求对象。除了当前调用点，
   // 该对象的其它引用也必须只是静态字段读取或已证明安全的日志/字符串化观察；
   // 交给未知函数或写入成员都会让封闭字段证明失效。
   const closedArgument=node=>{
    if(node?.type!=='Identifier')return true;
    const b=bindings.get(node);if(!b)return true;
    for(const ref of b.refs){
     if(ref===node)continue;
     const p=parents.get(ref),q=parents.get(p);
     if(p?.type==='MemberExpression'&&p.object===ref){
      if(property(p)===undefined)return false;
      continue;
     }
     if(p?.type==='CallExpression'&&p.arguments.includes(ref)){
      if(consoleObservation(p)||p.callee.type==='MemberExpression'&&free(p.callee.object,'JSON')&&property(p.callee)==='stringify')continue;
      return false;
     }
     return false;
    }
    return true;
   };
   const shape=(node,seen=new Set())=>{
    node=resolve(node,seen);if(!node)return stop('shape node');
    if(node.type==='Literal'&&typeof node.value==='string'||node.type==='TemplateLiteral')return new Set(['url']);
    if(node.type!=='ObjectExpression')return stop('shape type:'+node.type);
    const keys=new Set();
    for(const p of node.properties){
     if(p.type!=='Property'||p.kind!=='init'||p.method||key(p)===undefined||key(p)==='__proto__')return stop('shape property');
     const k=String(key(p));if(!['url','method','headers','body','bodyBytes','params','timeout','policy','node','redirection','auto-redirect','auto-cookie','insecure','binary-mode','full-header-mode'].includes(k)||keys.has(k))return stop('shape key:'+k);keys.add(k);
     if(k==='headers'){
      const headerValue=resolve(p.value,seen);
      if(headerValue.type!=='ObjectExpression')return stop('shape headers:'+headerValue.type);
      const headerNames=new Set();
      for(const h of headerValue.properties){
       if(h.type==='SpreadElement'){
        if(!requestHeaders(h.argument))return stop('shape header spread');
        keys.dynamicHeaders=true;continue;
       }
       if(h.kind!=='init'||h.method||key(h)===undefined||['__proto__','constructor'].includes(String(key(h))))return stop('shape header property');
       headerNames.add(String(key(h)).toLowerCase());
      }
      keys.headerNames=headerNames;
     }
    }
    return keys.has('url')?keys:null;
   };
   const shapes=calls.map(c=>shape(c.arguments[position]??fn.params[position]?.right));
   if(shapes.some(s=>!s))return stop('shape calls');
   if(calls.some(c=>!closedArgument(c.arguments[position])))return stop('argument escape');
   const allowed=new Set(['constructor','url','method','headers','body','bodyBytes','params','timeout','policy','node','redirection','auto-redirect','auto-cookie','insecure','binary-mode','full-header-mode']);
   const dispatches=binding.refs.flatMap(ref=>{
    const call=parents.get(ref);
    return call?.type==='CallExpression'&&call.arguments.includes(ref)&&call.callee.type==='MemberExpression'&&free(call.callee.object,'$httpClient')?[call]:[];
   });
   const beforeDispatch=node=>{
    const local=dispatches.filter(call=>owners.get(call)===owners.get(node));
    return local.length>0&&local.every(call=>node.end<call.start);
   };
   let hasDispatch=false;
   for(const r of binding.refs){
    const p=parents.get(r),q=parents.get(p);
    if(p?.type==='AssignmentExpression'&&p.left===r){
     if(p.operator!=='='||p.right.type!=='ObjectExpression')return null;
     if(!beforeDispatch(p))return null;
     for(const entry of p.right.properties){
      if(entry.type==='Property'){
       if(entry.kind!=='init'||key(entry)===undefined||!allowed.has(String(key(entry))))return null;
       continue;
      }
      if(entry.type!=='SpreadElement'||entry.argument.type!=='Identifier'||bindings.get(entry.argument)!==binding)return null;
     }
     continue;
    }
    if(p?.type==='SpreadElement'&&q?.type==='ObjectExpression'&&parents.get(q)?.type==='AssignmentExpression'&&parents.get(q).left.type==='Identifier'&&bindings.get(parents.get(q).left)===binding)continue;
    if(p?.type==='Property'&&p.value===r&&key(p)==='url'&&q?.type==='ObjectExpression'&&parents.get(q)?.type==='AssignmentExpression'&&parents.get(q).left.type==='Identifier'&&bindings.get(parents.get(q).left)===binding)continue;
    if(p?.type==='MemberExpression'&&p.object===r&&property(p)!==undefined){
     const field=String(property(p));if(!allowed.has(field))return null;
     if(q?.type==='MemberExpression'&&q.object===p){
      if(!['constructor','headers','method'].includes(field))return null;
      const use=parents.get(q);
      if((use?.type==='AssignmentExpression'&&use.left===q||use?.type==='UpdateExpression'||use?.type==='UnaryExpression'&&use.operator==='delete')&&!beforeDispatch(use))return null;
     }
     // 允许"发送前对 url 做追加"这一合法形态：它的实际执行被保留，HTTP 请求在发送
     // 时读取更新后的实时字段，因此不需要把 += 折叠成右侧表达式（折叠会丢原始 URL
     // 或让 queryStr 之类的调用重复执行）。其它非 = 的成员写入仍然拒绝。
     if(q?.type==='AssignmentExpression'&&q.left===p&&q.operator!=='='){
      const appendBeforeSend=field==='url'&&q.operator==='+='&&dispatches.length>0&&
       dispatches.every(call=>owners.get(call)===owners.get(q)&&q.end<call.start);
      if(!appendBeforeSend)return null;
     }
     if(q?.type==='AssignmentExpression'&&q.left===p&&!beforeDispatch(q))return null;
     if(q?.type==='UpdateExpression')return null;
     if(q?.type==='UnaryExpression'&&q.operator==='delete'&&!beforeDispatch(q))return null;
     if(q?.type==='CallExpression'&&q.callee===p&&!['toLocaleLowerCase'].includes(field))return null;
     continue;
    }
    if(p?.type==='CallExpression'&&p.arguments.includes(r)&&p.callee.type==='MemberExpression'&&free(p.callee.object,'$httpClient')){hasDispatch=true;continue;}
    return null;
   }
   if(!hasDispatch)return stop('dispatch');
   // Static call-site records establish that Accept and the binary response
   // flags are absent. Do not choose a response mode from a runtime header.
   if(shapes.some(s=>s.has('binary-mode')||s.has('full-header-mode')||!s.dynamicHeaders&&s.headerNames?.has('accept'))||nodes.some(n=>n.type==='MemberExpression'&&n.object.type==='MemberExpression'&&bindings.get(n.object.object)===binding&&property(n.object)==='headers'&&['accept','binary-mode','full-header-mode'].includes(String(property(n)).toLowerCase())&&(()=>{const use=parents.get(n);return use?.type==='AssignmentExpression'&&use.left===n||use?.type==='UpdateExpression'||use?.operator==='delete';})()))return null;
   const request=fresh('httpRequest'),result=new Map();
   const read=name=>{const value={type:'Identifier',name:'httpRequestField',start:ref.start,end:ref.end};generated.set(value,`${request}[${JSON.stringify(name)}]`);if(['headers','body'].includes(name))optionalHTTPFields.add(value);return value;};
   for(const name of ['url','headers','body'])result.set(name,read(name));
   result.runtimeRequest={name:request,expression:ref,binaryGuard:shapes.some(s=>s.dynamicHeaders)};return result;
  }
  const forwarding=new Set();
  const consoleMethods=new Set(['log','warn','error','info','debug']);
  const closedConsole=nodes.filter(n=>free(n,'console')).every(ref=>{
   const member=parents.get(ref),call=parents.get(member);
   return member?.type==='MemberExpression'&&member.object===ref&&consoleMethods.has(property(member))&&call?.type==='CallExpression'&&call.callee===member;
  });
  const consoleObservation=call=>closedConsole&&call?.type==='CallExpression'&&call.callee.type==='MemberExpression'&&free(call.callee.object,'console')&&consoleMethods.has(property(call.callee));
  // 调用点的实参记录除了本次转交外，只能做静态字段读取或已证明的日志观察。
  // 这防止同一条记录在进入 helper 之前已被未知函数接收或复制。
  const closedRecordSource=(actual,call,forwarded=null)=>{
   if(actual?.type!=='Identifier')return true;
   const sourceBinding=bindings.get(actual);if(!sourceBinding)return true;
   const dispatchesThrough=(invocation,argument,seen=new Set())=>{
    const fn=target(invocation.callee),position=invocation.arguments.indexOf(argument);
    if(!fn||position<0||seen.has(fn))return false;
    const parameter=fn.params[position],id=parameter?.type==='AssignmentPattern'?parameter.left:parameter;
    const parameterBinding=id?.type==='Identifier'?bindings.get(id):null;
    if(!parameterBinding)return false;
    const next=new Set(seen);next.add(fn);
    return parameterBinding.refs.some(inner=>{
     const dispatch=parents.get(inner);
     if(dispatch?.type!=='CallExpression'||!dispatch.arguments.includes(inner))return false;
     if(dispatch.callee.type==='MemberExpression'&&(free(dispatch.callee.object,'$httpClient')||free(dispatch.callee.object,'$task')&&property(dispatch.callee)==='fetch'))return true;
     return dispatchesThrough(dispatch,inner,next);
    });
   };
   const ok=sourceBinding.refs.every(ref=>{
    if(ref===actual)return true;
    const member=parents.get(ref),use=parents.get(member);
    if(member?.type==='MemberExpression'&&member.object===ref&&property(member)!==undefined){
     if(use?.type==='AssignmentExpression'&&use.left===member||use?.type==='UpdateExpression'||use?.type==='UnaryExpression'&&use.operator==='delete')return sourceBinding.init?.type==='ObjectExpression';
     return true;
    }
    if(member?.type==='BinaryExpression'&&['in','===','!==','==','!='].includes(member.operator)||member?.type==='UnaryExpression'&&['typeof','!'].includes(member.operator))return true;
     if(member?.type==='CallExpression'&&member.arguments.includes(ref)){
     if(member===call||forwarded?.includes(member))return true;
     if(dispatchesThrough(member,ref))return true;
     const fn=target(member.callee),position=member.arguments.indexOf(ref);
     const parameter=fn?.params[position],id=parameter?.type==='AssignmentPattern'?parameter.left:parameter;
     const parameterBinding=id?.type==='Identifier'?bindings.get(id):null;
     if(parameterBinding?.refs.some(inner=>{
      const dispatch=parents.get(inner);
      return dispatch?.type==='CallExpression'&&dispatch.arguments.includes(inner)&&dispatch.callee.type==='MemberExpression'&&
       (free(dispatch.callee.object,'$httpClient')||free(dispatch.callee.object,'$task')&&property(dispatch.callee)==='fetch');
     }))return true;
     if(member.callee.type==='MemberExpression'&&free(member.callee.object,'JSON')&&property(member.callee)==='stringify')return true;
     if(consoleObservation(member))return true;
     if(free(member.callee,'$log'))return true;
    }
    return false;
   });
   return ok;
  };
  const exclusive=(a,b)=>{
   const guards=n=>{const out=[];for(let child=n,p=parents.get(n);p;child=p,p=parents.get(p))if(p.type==='IfStatement'&&p.consequent===child&&p.test.type==='BinaryExpression'&&p.test.operator==='==='&&p.test.left.type==='Identifier'&&p.test.right.type==='Literal'&&!bindings.get(p.test.left)?.writes.length)out.push([bindings.get(p.test.left),p.test.right.value]);return out;};
   const left=guards(a),right=guards(b);return left.some(([binding,value])=>binding&&right.some(([other,candidate])=>binding===other&&!Object.is(value,candidate)));
  };
  const objectCopy=n=>n?.type==='CallExpression'&&n.callee.type==='MemberExpression'&&free(n.callee.object,'Object')&&property(n.callee)==='assign'&&n.arguments.length===2&&n.arguments[0].type==='ObjectExpression'&&!n.arguments[0].properties.length&&nodes.filter(n=>free(n,'Object')).every(r=>{const p=parents.get(r),q=parents.get(p);return p?.type==='MemberExpression'&&!(q?.type==='AssignmentExpression'&&q.left===p||q?.type==='UpdateExpression'||q?.operator==='delete')||p?.type==='CallExpression'&&p.callee===r;});
  function readOnly(fn,position,seen=new Set()){
   const param=fn?.params[position],id=param?.type==='AssignmentPattern'?param.left:param,b=id?.type==='Identifier'?bindings.get(id):null;
   if(!b||b.writes.length)return false;if(seen.has(b))return true;seen=new Set(seen);seen.add(b);
   return b.refs.every(ref=>{const p=parents.get(ref),q=parents.get(p);
    if(p?.type==='UnaryExpression'&&['typeof','!'].includes(p.operator))return true;
    if(p?.type==='MemberExpression'&&p.object===ref)return property(p)!==undefined&&!(q?.type==='AssignmentExpression'&&q.left===p||q?.type==='UpdateExpression'||q?.operator==='delete');
    if(p?.type==='BinaryExpression'&&['in','+','===','!==','==','!='].includes(p.operator))return true;
    if(p?.type!=='CallExpression'||!p.arguments.includes(ref))return false;
    const c=p.callee,k=c.type==='MemberExpression'?property(c):null;
    if(c.type==='MemberExpression'&&free(c.object,'JSON')&&k==='stringify'||consoleObservation(p))return true;
    if(p.arguments[0]===ref&&c.type==='MemberExpression'&&(free(c.object,'$httpClient')&&['get','post','put','delete','head','options','patch'].includes(k)||free(c.object,'$task')&&k==='fetch'))return true;
    return readOnly(target(c),p.arguments.indexOf(ref),seen);
   });
  }
  function fields(n,seen=new Set()){
   if(n?.type==='TemplateLiteral'||n?.type==='Literal'&&typeof n.value==='string')return new Map([['url',n]]);
   if(stringRecord(n))return fields(n.alternate,seen);
   if(n?.type==='CallExpression'&&n.arguments.length===1&&n.callee.type==='MemberExpression'&&free(n.callee.object,'JSON')&&property(n.callee)==='parse'){
    const request=fresh('httpRequest'),result=new Map(),read=name=>{const value={type:'Identifier',name:'httpRequestField',start:n.start,end:n.end};generated.set(value,`${request}[${JSON.stringify(name)}]`);if(['headers','body'].includes(name))optionalHTTPFields.add(value);return value;};
   for(const name of ['url','headers','body','timeout','policy'])result.set(name,read(name));
   optionalHTTPFields.add(result.get('policy'));
    generated.set(result.get('timeout'),`(${request}["timeout"] === undefined ? ${format==='loon'?5000:5} : ${request}["timeout"])`);
    result.runtimeRequest={name:request,expression:n};return result;
   }
   // URL-or-record normalization keeps the existing object, wrapping only
   // strings. Trace all closed inputs, then read live fields from the result.
   if(n?.type==='ConditionalExpression'&&n.test.type==='MemberExpression'&&property(n.test)==='url'&&n.test.object.type==='Identifier'&&n.consequent.type==='Identifier'&&bindings.get(n.test.object)===bindings.get(n.consequent)&&n.alternate.type==='ObjectExpression'&&n.alternate.properties.length===1&&key(n.alternate.properties[0])==='url'&&n.alternate.properties[0].value.type==='Identifier'&&bindings.get(n.alternate.properties[0].value)===bindings.get(n.consequent))return fields(n.consequent,seen);
   if(n?.type==='ObjectExpression')return n.properties.every(p=>p.type==='Property'&&p.kind==='init'&&key(p)!==undefined&&key(p)!=='__proto__')?new Map(n.properties.map(p=>[String(key(p)),p.value])):null;
   if(n?.type==='ConditionalExpression'){
    const branches=[fields(n.consequent,new Set(seen)),fields(n.alternate,new Set(seen))];
    if(branches.some(branch=>!branch))return null;
    const result=new Map(branches.flatMap(branch=>[...branch]));
    result.optional=new Set([...result.keys()].filter(k=>branches.some(branch=>!branch.has(k)||branch.optional?.has(k))));
    if([...result.optional].some(k=>!['headers','body','bodyBytes','params','_method','_respType','_timeout'].includes(k)))return null;
    for(const k of ['method','binary-mode','full-header-mode','auto-redirect','auto-cookie','insecure'])if(result.has(k)&&branches.some(branch=>resolve(branch.get(k))?.type!=='Literal'||resolve(branch.get(k))?.value!==resolve(result.get(k))?.value))return null;
    return result;
   }
   if(objectCopy(n))return fields(n.arguments[1],seen);
   if(n?.type==='CallExpression'){
    const fn=target(n.callee),last=fn?.body.type==='BlockStatement'?fn.body.body.at(-1):null;
    if(!fn||fn.async||fn.generator||seen.has(fn)||last?.type!=='ReturnStatement'||nodes.some(r=>r.type==='ReturnStatement'&&owners.get(r)===fn&&r!==last))return null;
    const returned=last.argument?.type==='Identifier'?bindings.get(last.argument):null;
    const parses=node=>node?.type==='CallExpression'&&node.callee.type==='MemberExpression'&&free(node.callee.object,'JSON')&&property(node.callee)==='parse'&&node.arguments.length===1;
    const empty=node=>!node||free(node,'undefined')||node.type==='UnaryExpression'&&node.operator==='void'&&node.argument.type==='Literal';
    if(returned&&empty(returned.init)&&returned.writes.length&&returned.writes.every(w=>w.type==='AssignmentExpression'&&w.operator==='='&&bindings.get(w.left)===returned&&parses(w.right))){
     const request=fresh('httpRequest'),result=new Map();
     for(const name of ['url','method','headers','body','timeout','policy']){
      const value={type:'Identifier',name:'httpRequestField',start:n.start,end:n.end};
      generated.set(value,`${request}[${JSON.stringify(name)}]`);if(['headers','body','policy'].includes(name))optionalHTTPFields.add(value);result.set(name,value);
     }
     generated.set(result.get('timeout'),`(${request}["timeout"] === undefined ? ${format==='loon'?5000:5} : ${request}["timeout"])`);
     result.runtimeRequest={name:request,expression:n};return result;
    }
    const next=new Set(seen);next.add(fn);const value=last.argument?.type==='SequenceExpression'?last.argument.expressions.at(-1):last.argument;
    return fields(value,next);
   }
   if(n?.type!=='Identifier')return null;let b=bindings.get(n),implicitName=null;
   if(!b&&free(n)&&implicit.has(n.name)){
    const owner=owners.get(n),refs=nodes.filter(r=>free(r,n.name)&&owners.get(r)===owner),writes=refs.map(r=>parents.get(r)).filter(w=>w?.type==='AssignmentExpression'&&w.left.type==='Identifier'&&free(w.left,n.name));
    const dominates=w=>{const s=parents.get(w),block=parents.get(s);let statement=n;while(parents.get(statement)&&parents.get(statement)!==block)statement=parents.get(statement);return w.operator==='='&&s?.type==='ExpressionStatement'&&['Program','BlockStatement'].includes(block?.type)&&parents.get(statement)===block&&statement.start>=s.end;};
    if(!writes.some(dominates))return null;
    const start=Math.max(...writes.filter(dominates).map(w=>w.end));
    if(nodes.some(x=>x.start>=start&&x.end<=n.start&&owners.get(x)===owner&&['AwaitExpression','YieldExpression'].includes(x.type)))return null;
    const exits=statement=>statement?.type==='ReturnStatement'||statement?.type==='ThrowStatement'||statement?.type==='BlockStatement'&&exits(statement.body.at(-1));
    const unreachableAtRead=call=>{for(let child=call,parent=parents.get(child);parent&&owners.get(parent)===owner;child=parent,parent=parents.get(parent))if(parent.type==='IfStatement'&&((parent.consequent===child&&exits(child))||(parent.alternate===child&&exits(child)))&&!(n.start>=child.start&&n.end<=child.end))return true;return false;};
    if(nodes.some(x=>x.type==='CallExpression'&&x.start>=start&&x.end<=n.start&&owners.get(x)===owner&&!unreachableAtRead(x)))return null;
    implicitName=n.name;b={name:n.name,init:null,refs,writes};
   }
   if(!b||seen.has(b))return null;seen=new Set(seen);seen.add(b);
   const sameBinding=ref=>bindings.get(ref)===b||implicitName!==null&&free(ref,implicitName);
   let initial=b.init,branchValues=null;const consumedWrites=new Set();
   if(b.writes.length){
    const owner=owners.get(n);if(!owner||b.writes.some(w=>owners.get(w)!==owner))return null;
    const empty=value=>!value||free(value,'undefined')||value.type==='Literal'&&value.value===null||value.type==='UnaryExpression'&&value.operator==='void'&&value.argument.type==='Literal';
    // A local record may be assigned in several branches before the request.
    // Join its possible shapes and read the chosen live object at the call.
    // Empty initial states remain authored failure paths, never fabricated URLs.
    if((empty(initial)||initial?.type==='ObjectExpression')&&b.writes.every(w=>w.type==='AssignmentExpression'&&w.operator==='='&&w.left.type==='Identifier'&&sameBinding(w.left)&&w.right.type==='ObjectExpression'&&w.end<n.start)){
     branchValues=[...(empty(initial)?[]:[initial]),...b.writes.map(w=>w.right)];
     for(const write of b.writes)consumedWrites.add(write.left);
    }else{
    const blockStatement=node=>{let child=node,parent=parents.get(child);while(parent&&!['Program','BlockStatement'].includes(parent.type)){child=parent;parent=parents.get(child);}return parent?{block:parent,statement:child}:null;};
    const target=blockStatement(n);if(!target)return null;
    const before=[];
    for(const write of b.writes){
     if(write.type!=='AssignmentExpression'||write.operator!=='='||write.left.type!=='Identifier'||!sameBinding(write.left))return null;
     const location=blockStatement(write);if(!location)return null;
     const index=location.block.body.indexOf(location.statement),targetIndex=target.block.body.indexOf(target.statement);
     if(location.block!==target.block||index<0||targetIndex<0){if(write.start<n.start)return null;continue;}
     if(index<targetIndex||index===targetIndex&&write.end<n.start){
      let child=write,parent=parents.get(child),direct=true;
      while(parent&&parent!==location.block){if(!['ExpressionStatement','SequenceExpression'].includes(parent.type)){direct=false;break;}child=parent;parent=parents.get(child);}
      if(!direct)return null;
      before.push(write);consumedWrites.add(write.left);
     }
    }
    if(before.length)initial=before.sort((a,b)=>a.start-b.start).at(-1).right;
    }
   }
   const copied=objectCopy(initial);
   let result;
   if(branchValues){
    const candidates=branchValues.map(value=>fields(value,new Set(seen)));if(candidates.some(value=>!value))return null;
    result=new Map(candidates.flatMap(value=>[...value]));
    result.optional=new Set([...result.keys()].filter(k=>candidates.some(value=>!value.has(k)||value.optional?.has(k))));
    if([...result.optional].some(k=>!['headers','body','bodyBytes','params'].includes(k)))return null;
    for(const k of ['method','binary-mode','full-header-mode','auto-redirect','auto-cookie','insecure'])if(result.has(k)&&candidates.some(value=>resolve(value.get(k))?.type!=='Literal'||resolve(value.get(k))?.value!==resolve(result.get(k))?.value))return null;
   }
   else if(initial)result=fields(initial,seen);
   else{
    let fn,position;for(const candidate of nodes.filter(n=>functions.has(n.type))){const i=candidate.params.findIndex(p=>bindings.get(p.type==='AssignmentPattern'?p.left:p)===b);if(i>=0){fn=candidate;position=i;break;}}
    const parent=parents.get(fn),id=fn?.id??(parent?.type==='VariableDeclarator'?parent.id:null),binding=id?bindings.get(id):null;
    const direct=parent?.type==='CallExpression'&&parent.callee===fn;
    const cls=parent?.type==='MethodDefinition'?parents.get(parents.get(parent)):null;
    const method=cls&&immutableClass(cls),methodCalls=method?nodes.filter(n=>n.type==='CallExpression'&&target(n.callee)===fn):null;
    if(!direct&&!method&&(!binding||binding.writes.length||!binding.refs.length))return null;
    const calls=direct?[parent]:method?methodCalls:binding.refs.map(r=>parents.get(r));if(!calls.length||calls.some((c,i)=>c?.type!=='CallExpression'||!direct&&!method&&c.callee!==binding.refs[i]||c.arguments.some(a=>a.type==='SpreadElement')))return null;
    const parameterDispatches=b.refs.filter(ref=>{
     const call=parents.get(ref);
     return call?.type==='CallExpression'&&call.arguments.includes(ref)&&call.callee.type==='MemberExpression'&&
      (free(call.callee.object,'$httpClient')||free(call.callee.object,'$task')&&property(call.callee)==='fetch');
    });
    if(parameterDispatches.length>1)return null;
    const dispatch=parameterDispatches.length?parents.get(parameterDispatches[0]):null;
    // helper 形参本身也必须保持同一个对象身份。除唯一派发外，只允许静态字段
    // 读写、已知观察和派发前字段修改；复制别名、交给未知函数或派发后再改
    // 都会让发送内容和证明时看到的记录不再一致。
    const parameterClosed=!dispatch||b.refs.every(ref=>{
     if(ref===parameterDispatches[0])return true;
     const p=parents.get(ref),q=parents.get(p);
     if(p?.type==='MemberExpression'&&p.object===ref&&property(p)!==undefined){
      const field=String(property(p));
      if(q?.type==='MemberExpression'&&q.object===p){
       const nested=property(q),use=parents.get(q);
       if(nested===undefined)return false;
       if(field==='headers'||field==='header'){
        if(use?.type==='AssignmentExpression'&&use.left===q||use?.type==='UpdateExpression'||use?.type==='UnaryExpression'&&use.operator==='delete')return use.end<dispatch.start;
        if(use?.type==='CallExpression'&&use.callee===q)return false;
        return true;
       }
       if(field==='method'&&['toLocaleLowerCase','toLowerCase'].includes(String(nested))&&use?.type==='CallExpression'&&use.callee===q)return true;
      if(field==='opts'&&qx&&['redirection','skip-cert-verify','auto-cookie','policy'].includes(String(nested))){
       if(use?.type==='AssignmentExpression'&&use.left===q)return use.operator==='='&&use.end<dispatch.start;
       if(use?.type==='UnaryExpression'&&use.operator==='delete'&&use.argument===q)return use.end<dispatch.start;
       return use?.type!=='CallExpression'||use.callee!==q;
      }
       return false;
      }
      if(q?.type==='AssignmentExpression'&&q.left===p)return q.end<dispatch.start;
      if(q?.type==='UpdateExpression')return false;
      if(q?.type==='UnaryExpression'&&q.operator==='delete')return q.end<dispatch.start;
      if(q?.type==='CallExpression'&&q.callee===p)return false;
      if(q?.type==='CallExpression'&&q.arguments.includes(p)){
       if(field==='headers'||field==='header')return q.end<dispatch.start;
       return false;
      }
      return true;
     }
     if(p?.type==='CallExpression'&&p.arguments.includes(ref)){
      if(consoleObservation(p)||p.callee.type==='MemberExpression'&&free(p.callee.object,'JSON')&&property(p.callee)==='stringify'||free(p.callee,'$log'))return true;
      return readOnly(target(p.callee),p.arguments.indexOf(ref));
     }
     if(p?.type==='VariableDeclarator'&&p.init===ref)return false;
     if(p?.type==='AssignmentExpression'&&p.right===ref)return p.left.type==='Identifier'&&bindings.get(p.left)===b;
     if(p?.type==='SpreadElement'&&q?.type==='ObjectExpression'){
      const assignment=parents.get(q);
      return assignment?.type==='AssignmentExpression'&&assignment.left.type==='Identifier'&&bindings.get(assignment.left)===b;
     }
     if(p?.type==='UnaryExpression'&&['typeof','!'].includes(p.operator))return true;
     return false;
    });
    if(!parameterClosed)return null;
    const candidates=calls.map(c=>{
     const actual=c.arguments[position];
     if(actual&&!closedRecordSource(actual,c,calls))return null;
     forwarding.add(c);return fields(actual,new Set(seen));
    });
    if(candidates.some(c=>!c))return null;
    result=new Map(candidates.flatMap(c=>[...c]));result.optional=new Set([...result.keys()].filter(k=>candidates.some(c=>!c.has(k)||c.optional?.has(k))));
    if([...result.optional].some(k=>!['headers','body','bodyBytes','params','_method','_respType','_timeout'].includes(k)))return null;
    // Value-dependent options need the same static literal at every call.
    for(const k of ['binary-mode','full-header-mode','auto-redirect','auto-cookie','insecure'])if(result.has(k)&&candidates.some(c=>resolve(c.get(k))?.type!=='Literal'||resolve(c.get(k))?.value!==resolve(result.get(k))?.value))return null;
    if(result.has('method')&&candidates.some(c=>!c.has('method')))return null;
   }
   if(!result)return null;
   // A builder may assign the URL in both sides of an authored conditional.
   // Prove definite assignment without choosing a branch or replaying a value.
   const assignsField=(node,field)=>{
    if(!node||functions.has(node.type))return false;
    if(node.type==='AssignmentExpression')return node.operator==='='&&node.left.type==='MemberExpression'&&sameBinding(node.left.object)&&property(node.left)===field;
    if(node.type==='IfStatement')return assignsField(node.test,field)||assignsField(node.consequent,field)&&assignsField(node.alternate,field);
    if(node.type==='ConditionalExpression')return assignsField(node.test,field)||assignsField(node.consequent,field)&&assignsField(node.alternate,field);
    if(node.type==='LogicalExpression')return assignsField(node.left,field);
    if(node.type==='ExpressionStatement')return assignsField(node.expression,field);
    if(['BlockStatement','Program'].includes(node.type))return node.body.some(statement=>assignsField(statement,field));
    if(node.type==='SequenceExpression')return node.expressions.some(expression=>assignsField(expression,field));
    return false;
   };
   const assignedBefore=field=>{
    for(let child=n,parent=parents.get(child);parent&&!functions.has(parent.type);child=parent,parent=parents.get(child)){
     if(['BlockStatement','Program'].includes(parent.type)){
      const position=parent.body.indexOf(child);
      if(position>=0&&parent.body.slice(0,position).some(statement=>assignsField(statement,field)))return true;
     }
    }
    return false;
   };
   const UNKNOWN_FIELD=Symbol('unknown field');
   const fieldConstant=value=>{
    if(value?.type==='Literal')return value.value;
    if(value?.type==='UnaryExpression'&&value.operator==='void'&&value.argument.type==='Literal')return undefined;
    if(value?.type==='MemberExpression'&&bindings.get(value.object)===b&&property(value)!==undefined&&!result.has(String(property(value)))&&b.refs.every(r=>{const m=parents.get(r),u=parents.get(m);return m?.type!=='MemberExpression'||property(m)!==property(value)||!(u?.type==='AssignmentExpression'&&u.left===m||u?.type==='UpdateExpression');}))return undefined;
    if(value?.type==='LogicalExpression'&&['||','&&'].includes(value.operator)){const a=fieldConstant(value.left);if(a!==UNKNOWN_FIELD)return value.operator==='||'?(a||fieldConstant(value.right)):(a&&fieldConstant(value.right));}
    if(value?.type==='BinaryExpression'&&['===','!=='].includes(value.operator)){const a=fieldConstant(value.left),c=fieldConstant(value.right);if(a!==UNKNOWN_FIELD&&c!==UNKNOWN_FIELD)return value.operator==='==='?a===c:a!==c;}
    return UNKNOWN_FIELD;
   };
   for(const ref of b.refs){const p=parents.get(ref),use=parents.get(p);
    if(ref.start>n.start&&owners.get(ref)===owners.get(n))continue;
    if(p?.type==='AssignmentExpression'&&p.left===ref){if(consumedWrites.has(ref)||p.start>n.start&&owners.get(p)===owners.get(n))continue;return null;}
    if(p?.type==='UnaryExpression'&&p.operator==='typeof')continue;
    if(p?.type==='ConditionalExpression'&&p.alternate===ref&&stringRecord(p))continue;
    let dead=false;for(let child=ref,parent=parents.get(child);parent;child=parent,parent=parents.get(parent))if(parent.type==='LogicalExpression'&&parent.right===child){const value=fieldConstant(parent.left);if(value!==UNKNOWN_FIELD&&(parent.operator==='||'&&value||parent.operator==='&&'&&!value))dead=true;}
    if(dead||exclusive(ref,n))continue;
    if(p?.type==='MemberExpression'&&p.object===ref){const k=property(p);if(k===undefined)return null;
     const nested=parents.get(p),nestedWrite=parents.get(nested);
     if(nested?.type==='MemberExpression'&&nested.object===p&&(nestedWrite?.type==='AssignmentExpression'&&nestedWrite.left===nested&&nestedWrite.operator==='='||nestedWrite?.type==='UnaryExpression'&&nestedWrite.operator==='delete'&&nestedWrite.argument===nested)&&k==='headers'&&property(nested)!==undefined&&owners.get(nestedWrite)===owners.get(n)&&nestedWrite.end<n.start)continue;
     if(use?.type==='AssignmentExpression'&&use.left===p){
      // Closed multi-platform HTTP wrappers commonly choose a method from the
      // live request body (GET by default, POST when a body exists). Keep that
      // authored data flow intact; the dynamic $httpClient method expression
      // is separately emitted as ctx.http[method].
      if(k==='method'&&use.operator==='='&&owners.get(use)===owners.get(n)&&use.end<n.start){result.set('method',use.right);continue;}
      if(use.operator==='='&&['url','body'].includes(String(k))&&result.has(String(k))&&values.string(result.get(String(k)))&&values.string(use.right))continue;
      // URL concatenation remains in the authored helper. The emitted request
      // reads the live field after this mutation, never its original literal.
      if(k==='url'&&use.operator==='+='&&result.has('url')&&owners.get(use)===owners.get(n)&&use.end<n.start)continue;
      // An overwrite of an existing data field may be conditional. Keep the
      // authored branch and read the live value at the request, rather than
      // replaying its initializer or requiring the branch to always run.
      if(use.operator==='='&&result.has(String(k))&&['url','headers','body','bodyBytes','params'].includes(String(k))&&owners.get(use)===owners.get(n)&&use.end<n.start){result.set(String(k),use.right);continue;}
      // Closed builders often start with {} and fill data fields in nested
      // blocks. Read their live values, including optional conditional fields.
      // A newly introduced URL must dominate the request; transport flags still
      // use the stricter constant proof below.
      if(b.init?.type==='ObjectExpression'&&use.operator==='='&&['url','headers','body','bodyBytes','params'].includes(String(k))&&owners.get(use)===owners.get(n)&&use.end<n.start){
       if(k==='url'&&!result.has('url')){
        const ancestors=new Set();for(let p=n;p;p=parents.get(p))ancestors.add(p);
        let p=use;while(p&&!ancestors.has(p)){if(!['AssignmentExpression','ExpressionStatement','SequenceExpression','BlockStatement'].includes(p.type)&&!assignedBefore('url'))return null;p=parents.get(p);}
        if(!p)return null;
       }else if(!result.has(String(k))){result.optional??=new Set();result.optional.add(String(k));}
       result.set(String(k),use.right);continue;
      }
      let expression=use;while(parents.get(expression)?.type==='SequenceExpression')expression=parents.get(expression);
      const s=parents.get(expression),block=parents.get(s);let enclosing=n;while(parents.get(enclosing)&&parents.get(enclosing)!==block)enclosing=parents.get(enclosing);
      if(copied){if(use.operator!=='='||!result.has(String(k))||!['url','headers','body'].includes(String(k)))return null;}
      else if(use.operator!=='='||s?.type!=='ExpressionStatement'||!['Program','BlockStatement'].includes(block?.type)||parents.get(enclosing)!==block||s.end>enclosing.start&&!(enclosing===s&&use.end<n.start))return null;
      result.set(String(k),use.right);
     }else if(use?.operator==='delete'){
      if(k==='method'&&!result.has('method'))continue;
      // A closed adapter may clone its input and remove source-platform fields
      // before dispatch. Keep that authored normalization; the native request
      // still receives only the proven live fields projected below.
      if(!copied&&!['headers','body','bodyBytes'].includes(String(k)))return null;
      result.optional??=new Set();result.optional.add(String(k));
     }else if(use?.type==='UpdateExpression')return null;continue;}
    if(p?.type==='VariableDeclarator'&&p.init===ref&&p.id.type==='Identifier'){
     const alias=bindings.get(p.id);
     const readAlias=(binding,seen=new Set())=>{
      if(!binding||binding.writes.length||seen.has(binding))return false;seen=new Set(seen);seen.add(binding);
      return binding.refs.every(r=>{const m=parents.get(r),u=parents.get(m);
       if(m?.type==='MemberExpression'&&m.object===r)return property(m)!==undefined&&!(u?.type==='AssignmentExpression'&&u.left===m||u?.type==='UpdateExpression'||u?.operator==='delete');
       if(m?.type==='VariableDeclarator'&&m.init===r)return readAlias(bindings.get(m.id),seen);
       return m?.type==='CallExpression'&&m.arguments.includes(r)&&(forwarding.has(m)||m.callee.type==='MemberExpression'&&free(m.callee.object,'$httpClient'));
      });
     };
     if(readAlias(alias))continue;
    }
    if(p?.type==='CallExpression'&&p.arguments.length===1&&p.arguments[0]===ref&&p.callee.type==='MemberExpression'&&free(p.callee.object,'JSON')&&property(p.callee)==='stringify')continue;
    if(p?.type==='CallExpression'&&p.arguments.includes(ref)&&consoleObservation(p))continue;
    if(p?.type==='BinaryExpression'&&p.operator==='in'&&p.right===ref&&p.left.type==='Literal')continue;
    if(p?.type==='ConditionalExpression'&&p.consequent===ref&&p.test.type==='MemberExpression'&&sameBinding(p.test.object)&&property(p.test)==='url')continue;
    if(p?.type==='Property'&&p.value===ref&&key(p)==='url'&&parents.get(p)?.type==='ObjectExpression'&&parents.get(parents.get(p))?.type==='ConditionalExpression')continue;
    if((copied||['ObjectExpression','ConditionalExpression'].includes(b.init?.type))&&(p?.type==='ReturnStatement'||p?.type==='SequenceExpression'&&p.expressions.at(-1)===ref&&parents.get(p)?.type==='ReturnStatement'))continue;
    if(p?.type==='CallExpression'&&pathSetterField(ix,p,ref)==='headers'){
     if(!result.has('headers')){result.set('headers',{type:'ObjectExpression',properties:[],start:ref.start,end:ref.end});result.optional??=new Set();result.optional.add('headers');}
     continue;
    }
    if(p?.type==='CallExpression'&&p.arguments.includes(ref)&&readOnly(target(p.callee),p.arguments.indexOf(ref)))continue;
    if(objectCopy(p)&&p.arguments[1]===ref)continue;
    if(p?.type==='CallExpression'&&(forwarding.has(p)||p.callee.type==='MemberExpression'&&(free(p.callee.object,'$httpClient')||isAPI(p,'$task','fetch'))))continue;
    return null;
   }
   return result;
  }
  function stringRecord(n){
   const t=n?.test,c=n?.consequent,a=n?.alternate;
   return n?.type==='ConditionalExpression'&&t?.type==='BinaryExpression'&&['===','=='].includes(t.operator)&&t.left.type==='UnaryExpression'&&t.left.operator==='typeof'&&t.left.argument.type==='Identifier'&&t.right.type==='Literal'&&t.right.value==='string'&&a.type==='Identifier'&&bindings.get(t.left.argument)===bindings.get(a)&&c.type==='ObjectExpression'&&c.properties.length===1&&c.properties[0].type==='Property'&&key(c.properties[0])==='url'&&c.properties[0].value.type==='Identifier'&&bindings.get(c.properties[0].value)===bindings.get(a);
  }
  const origin=closedLiveRequest(input)??fields(input);if(!origin)return null;
  const projected=new Map([...origin].map(([k,value])=>{if(origin.runtimeRequest){if(origin.optional?.has(k))optionalHTTPFields.add(value);return [k,value];}const node={type:'Identifier',name:'httpField',start:input.start,end:input.end};setFieldValue(node,value);if(origin.optional?.has(k))optionalHTTPFields.add(node);generated.set(node,`${render(input)}[${JSON.stringify(k)}]`);return [k,node];}));
  projected.runtimeRequest=origin.runtimeRequest?{...origin.runtimeRequest,expression:input}:undefined;return projected;
 }
 // 回调可能把完整响应放进局部包装记录的 response 键，再由封闭 Promise
 // 执行器解析。只有该记录不再外传、且 response 键只做真值/存在性观察或读取
 // 已投影的 status / statusCode / headers 时才成立；其他字段仍拒绝。
 function isPromiseResolver(ref){
  if(ref?.type!=='Identifier')return false;
  const resolver=bindings.get(ref);
  if(!resolver||resolver.writes.length||!resolver.refs.length)return false;
  const executor=nodes.find(fn=>functions.has(fn.type)&&bindings.get(fn.params[0])===resolver);
  const construction=parents.get(executor);
  return !!executor&&!executor.async&&!executor.generator&&construction?.type==='NewExpression'&&free(construction.callee,'Promise')&&construction.arguments[0]===executor;
 }
 function forwardsToResolver(call,value,seen=new Set(),substitutions=new Map()){
  if(!call||call.type!=='CallExpression'||call.optional||call.arguments.some(a=>a.type==='SpreadElement'))return false;
  const actual=node=>{
   if(node?.type!=='Identifier')return node;
   const binding=bindings.get(node),replacement=binding&&substitutions.get(binding);
   return replacement&&replacement!==node?actual(replacement):node;
  };
  const resolvedValue=actual(value),positions=call.arguments.map((arg,i)=>actual(arg)===resolvedValue?i:-1).filter(i=>i>=0);
  if(positions.length!==1)return false;
  const callee=actual(call.callee);
  if(isPromiseResolver(callee))return call.arguments.length===1;
  const fn=target(callee);
  if(!fn||fn.async||fn.generator||seen.has(fn))return false;
  const next=new Set(seen);next.add(fn);
  const statements=fn.body?.type==='BlockStatement'?fn.body.body:null;
  if(statements?.length!==1||statements[0].type!=='ReturnStatement'||statements[0].argument?.type!=='CallExpression')return false;
  const parameter=fn.params[positions[0]];
  if(parameter?.type!=='Identifier')return false;
  const binding=bindings.get(parameter);
  if(!binding||binding.writes.length)return false;
  const returned=statements[0].argument,uses=returned.arguments.filter(arg=>arg.type==='Identifier'&&bindings.get(arg)===binding);
  if(uses.length!==1||binding.refs.length!==1||binding.refs[0]!==uses[0])return false;
  const mapped=new Map(substitutions);
  fn.params.forEach((formal,index)=>{
   if(formal.type!=='Identifier')return;
   const targetBinding=bindings.get(formal);
   if(targetBinding&&call.arguments[index])mapped.set(targetBinding,actual(call.arguments[index]));
  });
  return forwardsToResolver(returned,uses[0],next,mapped);
 }
 function closedResponseRecord(record){
  if(record?.type==='ObjectExpression'){
   const call=parents.get(record);
   return call?.type==='CallExpression'&&forwardsToResolver(call,record)?record:null;
  }
  if(record?.type!=='Identifier')return null;
  const binding=bindings.get(record);
  if(!binding||binding.writes.length||binding.init?.type!=='ObjectExpression')return null;
  let responseWrites=0;
  for(const ref of binding.refs){
   const parent=parents.get(ref),use=parents.get(parent);
   if(parent?.type==='MemberExpression'&&parent.object===ref){
    const name=property(parent);
    if(name===undefined||parent.computed&&parent.property.type!=='Literal')return null;
    if(use?.type!=='AssignmentExpression'||use.left!==parent||use.operator!=='=')return null;
    if(name==='response')responseWrites++;
    continue;
   }
   if(parent?.type==='CallExpression'&&forwardsToResolver(parent,ref))continue;
   return null;
  }
  return responseWrites===1?record:null;
 }
 function responseReadObserved(node){
  for(let current=node;;){
   const parent=parents.get(current);
   if(parent?.type==='MemberExpression'&&parent.object===current){
    return ['status','statusCode','headers'].includes(property(parent));
   }
   // 宿主响应可以先赋给局部别名，再只读取投影字段。别名必须是单次写入，
   // 且所有引用都是静态字段读取；整体再传递或动态字段仍拒绝。
   if(parent?.type==='AssignmentExpression'&&parent.operator==='='&&parent.right===current&&parent.left.type==='Identifier'){
    const alias=bindings.get(parent.left);
    return !!alias&&alias.writes.length===1&&alias.refs.length>0&&alias.refs.every(ref=>{
     const use=parents.get(ref);
     if(use===parent&&use.left===ref)return true;
     const member=use?.type==='MemberExpression'&&use.object===ref?use:null;
     const field=member?property(member):undefined;
     if(field===undefined||!['status','statusCode','headers','body','bodyBytes'].includes(field))return false;
     // 别名只能读取投影字段；写回、删除、更新或把字段当函数调用都会改变
     // 宿主响应语义，必须继续拒绝。
     const memberUse=parents.get(member);
     if(memberUse?.type==='AssignmentExpression'&&memberUse.left===member)return false;
     if(memberUse?.type==='UpdateExpression'||memberUse?.type==='UnaryExpression'&&memberUse.operator==='delete')return false;
     if(memberUse?.type==='CallExpression'&&memberUse.callee===member)return false;
     return true;
    });
   }
   if(parent?.type==='SequenceExpression'&&parent.expressions.includes(current)){
    if(parent.expressions.at(-1)!==current)return true;
    current=parent;continue;
   }
   if(parent?.type==='ExpressionStatement'&&parent.expression===current)return true;
   if(parent?.type==='UnaryExpression'&&['!','typeof','void'].includes(parent.operator))return true;
   if(['IfStatement','WhileStatement','DoWhileStatement'].includes(parent?.type)&&parent.test===current)return true;
   if(parent?.type==='ConditionalExpression'&&parent.test===current)return true;
   if(parent?.type==='LogicalExpression'&&parent.left===current)return true;
   if(parent?.type==='BinaryExpression'&&['==','===','!=','!=='].includes(parent.operator)&&
      (parent.left===current&&parent.right.type==='Literal'&&parent.right.value===null||parent.right===current&&parent.left.type==='Literal'&&parent.left.value===null))return true;
   return false;
  }
 }
 let responseReadsProven=null;
 function closedResponseReads(){
  if(responseReadsProven!==null)return responseReadsProven;
  responseReadsProven=nodes.every(node=>{
   if(node.type!=='MemberExpression'||property(node)!=='response')return true;
   const parent=parents.get(node);
   if(parent?.type==='AssignmentExpression'&&parent.left===node)return true;
   if(parent?.type==='UpdateExpression'||parent?.type==='UnaryExpression'&&parent.operator==='delete')return true;
   return responseReadObserved(node);
  });
  return responseReadsProven;
 }
 const closedResponseUses=new WeakSet();
 function closedWholeResponseUse(ref){
  if(closedResponseUses.has(ref))return true;
  const parent=parents.get(ref);
  let record=null;
  if(parent?.type==='AssignmentExpression'&&parent.operator==='='&&parent.right===ref&&parent.left.type==='MemberExpression'&&property(parent.left)==='response')record=parent.left.object;
  else if(parent?.type==='Property'&&parent.value===ref&&key(parent)==='response')record=parents.get(parent);
  if(!record||!closedResponseRecord(record)||!closedResponseReads())return false;
  closedResponseUses.add(ref);return true;
 }
 const replyFieldNames=new Set(['body','bodyBytes','status','statusCode','headers','ok','statusText']);
 function replyTarget(callee){
  if(functions.has(callee?.type))return callee;
  if(callee?.type!=='Identifier')return null;
  const binding=bindings.get(callee);return binding?.fn&&functions.has(binding.fn.type)?binding.fn:null;
 }
 function replyCalls(fn){
  const parent=parents.get(fn),id=fn.id??(parent?.type==='VariableDeclarator'?parent.id:null),binding=id?.type==='Identifier'?bindings.get(id):null;
  if(parent?.type==='CallExpression'&&parent.callee===fn&&!parent.optional&&parent.arguments.every(a=>a.type!=='SpreadElement'))return [parent];
  if(!binding||binding.writes.length||!binding.refs.length)return null;
  const calls=[];
  for(const ref of binding.refs){const call=parents.get(ref);if(call?.type!=='CallExpression'||call.callee!==ref||call.optional||call.arguments.some(a=>a.type==='SpreadElement'))return null;calls.push(call);}
  return calls;
 }
 function replyValueContext(ref){
  let current=ref,parent=parents.get(current);
  while(parent?.type==='SequenceExpression'&&parent.expressions.at(-1)===current){current=parent;parent=parents.get(current);}
  while(parent?.type==='AwaitExpression'&&parent.argument===current||parent?.type==='ChainExpression'&&parent.expression===current){current=parent;parent=parents.get(current);}
  return [current,parent];
 }
 function replyFieldUse(ref,fields,state){
  const member=parents.get(ref),name=property(member);
  if(member?.type!=='MemberExpression'||member.object!==ref||name===undefined||!replyFieldNames.has(String(name)))return false;
  fields.add(String(name));
  const use=parents.get(member);
  if(use?.type==='AssignmentExpression'&&use.left===member){if(use.operator!=='=')return false;state.write=true;return true;}
  if(use?.type==='UpdateExpression'||use?.type==='UnaryExpression'&&use.operator==='delete')return false;
  if(use?.type==='CallExpression'&&use.callee===member)return false;
  // 快照里的 headers 是普通记录；动态键仍依赖原始 Headers 语义，必须拒绝。
  if(String(name)==='headers'&&use?.type==='MemberExpression'&&property(use)===undefined)return false;
  return true;
 }
 function replyProjection(binding,fields,state,seen=new Set()){
  if(!binding||seen.has(binding))return false;seen=new Set(seen);seen.add(binding);
  for(const ref of binding.refs){
   const [current,parent]=replyValueContext(ref);
   if(parent?.type==='UnaryExpression'&&parent.operator==='typeof')continue;
   const other=parent?.left===current?parent.right:parent?.right===current?parent.left:null;
   if(parent?.type==='BinaryExpression'&&['==','!=','===','!=='].includes(parent.operator)&&(other?.type==='Literal'&&other.value===null||free(other,'undefined')))continue;
   if(parent?.type==='LogicalExpression'&&parent.left===current||['IfStatement','ConditionalExpression','WhileStatement','DoWhileStatement'].includes(parent?.type)&&parent.test===current||parent?.type==='UnaryExpression'&&parent.operator==='!')continue;
   if(parent?.type==='MemberExpression'&&parent.object===current){if(!replyFieldUse(current,fields,state))return false;continue;}
   if(parent?.type==='ReturnStatement'&&parent.argument===current||parent?.type==='ArrowFunctionExpression'&&parent.body===current){
    const fn=owners.get(parent);if(!fn||!replyReturned(fn,fields,state,seen))return false;state.whole=true;continue;
   }
   if(parent?.type==='CallExpression'&&parent.arguments.includes(current)){
    const fn=replyTarget(parent.callee),parameter=fn?.params[parent.arguments.indexOf(current)],id=parameter?.type==='AssignmentPattern'?parameter.left:parameter;
    if(!fn||id?.type!=='Identifier'||!replyParameter(fn,id,fields,state,seen))return false;state.whole=true;continue;
   }
   if(parent?.type==='VariableDeclarator'&&parent.init===current&&parent.id.type==='Identifier'){
    if(!replyProjection(bindings.get(parent.id),fields,state,seen))return false;state.whole=true;continue;
   }
   if(parent?.type==='AssignmentExpression'&&parent.right===current&&parent.operator==='='&&parent.left.type==='Identifier'){
    if(!replyProjection(bindings.get(parent.left),fields,state,seen))return false;state.whole=true;continue;
   }
   return false;
  }
  return true;
 }
 function replyParameter(fn,parameter,fields,state,seen){
  const binding=bindings.get(parameter);if(!binding||seen.has(binding))return false;seen=new Set(seen);seen.add(binding);
  for(const ref of binding.refs){
   const [current,parent]=replyValueContext(ref);
   if(parent?.type==='MemberExpression'&&parent.object===current){if(!replyFieldUse(current,fields,state))return false;continue;}
   if(parent?.type==='ReturnStatement'&&parent.argument===current||parent?.type==='ArrowFunctionExpression'&&parent.body===current){
    const owner=owners.get(parent);if(!owner||!replyReturned(owner,fields,state,seen))return false;continue;
   }
   if(parent?.type==='CallExpression'&&parent.arguments.includes(current)){
    const next=replyTarget(parent.callee),nextParameter=next?.params[parent.arguments.indexOf(current)],id=nextParameter?.type==='AssignmentPattern'?nextParameter.left:nextParameter;
    if(!next||id?.type!=='Identifier'||!replyParameter(next,id,fields,state,seen))return false;continue;
   }
   if(parent?.type==='VariableDeclarator'&&parent.init===current&&parent.id.type==='Identifier'){
    if(!replyProjection(bindings.get(parent.id),fields,state,seen))return false;continue;
   }
   return false;
  }
  return true;
 }
 function replyReturned(fn,fields,state,seen){
  const calls=replyCalls(fn);if(!calls||!calls.length||seen.has(fn))return false;seen=new Set(seen);seen.add(fn);
  return calls.every(call=>{
   const [current,parent]=replyValueContext(call);
   if(parent?.type==='VariableDeclarator'&&parent.init===current&&parent.id.type==='Identifier')return replyProjection(bindings.get(parent.id),fields,state,seen);
   if(parent?.type==='ReturnStatement'&&parent.argument===current||parent?.type==='ArrowFunctionExpression'&&parent.body===current){const owner=owners.get(parent);return !!owner&&replyReturned(owner,fields,state,seen);}
   if(parent?.type==='CallExpression'&&parent.arguments.includes(current)){const next=replyTarget(parent.callee),parameter=next?.params[parent.arguments.indexOf(current)],id=parameter?.type==='AssignmentPattern'?parameter.left:parameter;return !!next&&id?.type==='Identifier'&&replyParameter(next,id,fields,state,seen);}
   if(parent?.type==='ExpressionStatement')return true;
   return false;
  });
 }
 function reply(binding,fn=null,allowSnapshot=false){
  if(binding&&allowSnapshot){
   const fields=new Set(),state={write:false,whole:false};
   if(replyProjection(binding,fields,state,new Set())&&(state.whole||fields.has('ok')||fields.has('statusText'))){
    const info={uses:fields,body:fields.has('body')?fresh('responseText'):null,bytes:fields.has('bodyBytes')||fields.has('body')?fresh('responseBytes'):null,snapshot:true,fn};
    httpReplies.set(binding,info);return info;
   }
  }
  const refs=binding?.refs??[],uses=new Set();for(const ref of refs){const p=parents.get(ref);
   if(p?.type==='VariableDeclarator'&&p.init===ref&&p.id.type==='ObjectPattern'){
    for(const entry of p.id.properties){const name=entry.type==='Property'?key(entry):null;if(!['body','bodyBytes','status','statusCode','headers'].includes(name))fail(entry,'未知 HTTP 响应解构字段');uses.add(name);}continue;
   }
   if(closedWholeResponseUse(ref))continue;
   if(p?.type!=='MemberExpression'||p.object!==ref)fail(ref,'HTTP 响应整体传递无法静态转换');const k=property(p);if(!['body','bodyBytes','status','statusCode','headers'].includes(k))fail(p,'未知 HTTP 响应字段');uses.add(k);}
  const info={uses,body:uses.has('body')?fresh('responseText'):null,bytes:uses.has('bodyBytes')?fresh('responseBytes'):null,fn};if(binding)httpReplies.set(binding,info);if(fn&&(info.body||info.bytes))asyncFns.add(fn);return info;
 }
 function replyPrelude(info,name){const out=[];if(info.bytes)out.push(`const ${info.bytes} = await ${name}.arrayBuffer();`);if(info.body)out.push(`const ${info.body} = ${info.bytes?`new TextDecoder().decode(${info.bytes})`:`await ${name}.text()`};`);return out.join('\n');}
 // Promise 执行器把宿主响应整体交给 resolver 时，响应对象会穿过局部工厂和
 // 对象方法。只有整条 Promise 消费链都能闭合到固定字段时，才在 resolver
 // 调用处生成纯数据快照；否则继续按未知整体传递拒绝。
 const closedShellCache=new WeakMap();
 function staticObjectShell(n,seen=new Set()){
  if(!n||seen.has(n))return null;
  if(n.type==='Identifier'){
   const b=bindings.get(n);if(!b||b.writes.length)return null;
   seen=new Set(seen);seen.add(b);return b.init?staticObjectShell(b.init,seen):null;
  }
  if(n.type==='SequenceExpression')return staticObjectShell(n.expressions.at(-1),seen);
  if(n.type==='ObjectExpression'){
   const keys=n.properties.map(p=>p.type==='Property'&&p.kind==='init'?key(p):undefined);
   if(keys.some(k=>k===undefined||k==='__proto__')||new Set(keys).size!==keys.length)return null;
   return n;
  }
  if(n.type==='NewExpression'){const returned=factoryReturnObject(n);return returned?staticObjectShell(returned,seen):null;}
  if(n.type==='MemberExpression'&&property(n)!==undefined){
   const object=staticObjectShell(n.object,seen);if(!object)return null;
   const entry=object.properties.find(p=>p.type==='Property'&&p.kind==='init'&&key(p)===String(property(n)));
   return entry?staticObjectShell(entry.value,seen):null;
  }
  return null;
 }
 function closedObjectShell(object){
  if(!object)return false;
  if(closedShellCache.has(object))return closedShellCache.get(object);
  closedShellCache.set(object,false);
  const closed=!nodes.some(n=>{
   const left=n.type==='AssignmentExpression'&&n.left.type==='MemberExpression'?n.left:
    n.type==='UpdateExpression'&&n.argument.type==='MemberExpression'?n.argument:
    n.type==='UnaryExpression'&&n.operator==='delete'&&n.argument.type==='MemberExpression'?n.argument:null;
   if(!left)return false;
   return staticObjectShell(left.object)===object;
  });
  closedShellCache.set(object,closed);return closed;
 }
 function staticFunctionValue(n,seen=new Set()){
  if(functions.has(n?.type))return n;
  if(n?.type==='Identifier'){
   const b=bindings.get(n);if(!b||b.writes.length||seen.has(b))return null;
   seen=new Set(seen);seen.add(b);return b.fn??(b.init?staticFunctionValue(b.init,seen):null);
  }
  if(n?.type==='MemberExpression'&&property(n)!==undefined){
   const object=staticObjectShell(n.object,seen);if(!object)return null;
   const entry=object.properties.find(p=>p.type==='Property'&&p.kind==='init'&&key(p)===String(property(n)));
   return entry?staticFunctionValue(entry.value,seen):null;
  }
  return null;
 }
 function replyCallers(fn){
  const calls=new Set(nodes.filter(call=>call.type==='CallExpression'&&target(call.callee)===fn));
  const propertyNode=parents.get(fn);
  if(propertyNode?.type==='Property'&&propertyNode.value===fn&&!propertyNode.computed&&key(propertyNode)!==undefined){
   const object=parents.get(propertyNode),name=String(key(propertyNode));
   if(object?.type==='ObjectExpression'&&closedObjectShell(object))for(const call of nodes){
    if(call.type==='CallExpression'&&call.callee.type==='MemberExpression'&&!call.callee.optional&&property(call.callee)===name&&staticObjectShell(call.callee.object)===object)calls.add(call);
   }
  }
  return [...calls];
 }
 function promiseRefContext(ref){
  let current=ref,parent=parents.get(current);
  while(parent?.type==='SequenceExpression'&&parent.expressions.at(-1)===current){current=parent;parent=parents.get(current);}
  while(parent?.type==='ChainExpression'&&parent.expression===current){current=parent;parent=parents.get(current);}
  return [current,parent];
 }
 function tracePromiseResolved(awaitNode,fields,state,seen){
  const parent=parents.get(awaitNode);
  if(parent?.type==='VariableDeclarator'&&parent.init===awaitNode&&parent.id.type==='Identifier')return replyProjection(bindings.get(parent.id),fields,state,seen);
  if(parent?.type==='AssignmentExpression'&&parent.right===awaitNode&&parent.left.type==='Identifier')return replyProjection(bindings.get(parent.left),fields,state,seen);
  if(parent?.type==='ExpressionStatement')return true;
  return false;
 }
 function tracePromiseFunction(fn,fields,state,seen){
  if(!functions.has(fn?.type))return false;
  const calls=replyCallers(fn);
  return calls.length>0&&calls.every(call=>tracePromiseValue(call,fields,state,seen));
 }
 function tracePromiseBinding(binding,fields,state,seen){
  if(!binding)return false;
  for(const ref of binding.refs){
   const [current,parent]=promiseRefContext(ref);
   if(parent?.type==='AwaitExpression'&&parent.argument===current){if(!tracePromiseResolved(parent,fields,state,seen))return false;continue;}
   if(parent?.type==='MemberExpression'&&parent.object===current){
    const name=property(parent),call=parents.get(parent);
    if(['then','catch','finally'].includes(name)&&call?.type==='CallExpression'&&call.callee===parent){
     if(name==='then'&&call.arguments[0]){
      const fn=target(call.arguments[0]);if(!fn?.params[0]||fn.params[0].type!=='Identifier')return false;
      if(!replyProjection(bindings.get(fn.params[0]),fields,state,seen))return false;
      if(state.write)return false;
     }
     continue;
    }
    return false;
   }
   if(parent?.type==='ReturnStatement'&&parent.argument===current){if(!tracePromiseFunction(owners.get(parent),fields,state,seen))return false;continue;}
   if(parent?.type==='ArrowFunctionExpression'&&parent.body===current){if(!tracePromiseFunction(parent,fields,state,seen))return false;continue;}
   if(parent?.type==='VariableDeclarator'&&parent.init===current&&parent.id.type==='Identifier'){if(!tracePromiseBinding(bindings.get(parent.id),fields,state,seen))return false;continue;}
   if(parent?.type==='ExpressionStatement')continue;
   return false;
  }
  return true;
 }
 function tracePromiseValue(expression,fields,state,seen=new Set()){
  if(!expression||seen.has(expression))return true;
  seen=new Set(seen);seen.add(expression);
  const [current,parent]=promiseRefContext(expression);
  if(parent?.type==='ArrowFunctionExpression'&&parent.body===current)return tracePromiseFunction(parent,fields,state,seen);
  if(parent?.type==='ReturnStatement'&&parent.argument===current)return tracePromiseFunction(owners.get(parent),fields,state,seen);
  if(parent?.type==='VariableDeclarator'&&parent.init===current&&parent.id.type==='Identifier')return tracePromiseBinding(bindings.get(parent.id),fields,state,seen);
  if(parent?.type==='AssignmentExpression'&&parent.right===current&&parent.left.type==='Identifier')return tracePromiseBinding(bindings.get(parent.left),fields,state,seen);
  if(parent?.type==='AwaitExpression'&&parent.argument===current)return tracePromiseResolved(parent,fields,state,seen);
  if(parent?.type==='MemberExpression'&&parent.object===current){
   const name=property(parent),call=parents.get(parent);
   if(['then','catch','finally'].includes(name)&&call?.type==='CallExpression'&&call.callee===parent){
    if(name==='then'&&call.arguments[0]){
     const fn=target(call.arguments[0]);if(!fn?.params[0]||fn.params[0].type!=='Identifier')return false;
     if(!replyProjection(bindings.get(fn.params[0]),fields,state,seen))return false;
     if(state.write)return false;
    }
    return true;
   }
   return false;
  }
  if(parent?.type==='ExpressionStatement')return true;
  return false;
 }
 function sameReplyMember(left,right){
  return left?.type==='MemberExpression'&&right?.type==='MemberExpression'&&left.object.type==='Identifier'&&right.object.type==='Identifier'&&bindings.get(left.object)===bindings.get(right.object)&&property(left)!==undefined&&property(left)===property(right);
 }
 function forwardedReply(binding,fn){
  if(!binding)return null;
  const fields=new Set(),state={write:false,whole:false},resolvers=[];
  for(const ref of binding.refs){
   const [current,parent]=replyValueContext(ref);
   if(parent?.type==='UnaryExpression'&&parent.operator==='typeof')continue;
   const other=parent?.left===current?parent.right:parent?.right===current?parent.left:null;
   if(parent?.type==='BinaryExpression'&&['==','!=','===','!=='].includes(parent.operator)&&(other?.type==='Literal'&&other.value===null||free(other,'undefined')))continue;
   if(parent?.type==='LogicalExpression'&&parent.left===current||['IfStatement','ConditionalExpression','WhileStatement','DoWhileStatement'].includes(parent?.type)&&parent.test===current||parent?.type==='UnaryExpression'&&parent.operator==='!')continue;
   if(parent?.type==='MemberExpression'&&parent.object===current){
    if(!replyFieldUse(current,fields,state))return null;
    const use=parents.get(parent);
    if(use?.type==='AssignmentExpression'&&use.left===parent&&!sameReplyMember(use.right,parent))fail(parent,'Promise 转发的 HTTP 响应字段写入无法证明为本地快照');
    continue;
   }
   if(parent?.type==='CallExpression'&&parent.arguments.length===1&&parent.arguments[0]===current&&isPromiseResolver(parent.callee)){resolvers.push(parent);continue;}
   return null;
  }
  if(!resolvers.length)return null;
  const constructions=new Set();
  for(const call of resolvers){
   const resolver=bindings.get(call.callee);if(!resolver)return null;
   const executor=nodes.find(candidate=>functions.has(candidate.type)&&bindings.get(candidate.params[0])===resolver);
   const construction=executor&&parents.get(executor);
   if(construction?.type!=='NewExpression'||!free(construction.callee,'Promise')||construction.arguments[0]!==executor)return null;
   constructions.add(construction);
  }
  if(constructions.size!==1)return null;
  const downstream={write:false,whole:false};
  if(!tracePromiseValue([...constructions][0],fields,downstream,new Set()))return null;
  if(downstream.write)return null;
  const info={uses:fields,body:fields.has('body')?fresh('responseText'):null,bytes:fields.has('bodyBytes')||fields.has('body')?fresh('responseBytes'):null,snapshot:true,promiseForward:true,fn};
  httpReplies.set(binding,info);if(info.body||info.bytes)asyncFns.add(fn);return info;
 }
 function forwardedHeaders(raw){return `Object.fromEntries([...${raw}.headers.entries()].map(([name, value]) => [name, ${raw}.headers.getAll(name).length > 1 ? ${raw}.headers.getAll(name) : value]))`;}
 function forwardedSnapshot(info,raw){
  const out=[];
  for(const name of ['status','statusCode','headers','body','bodyBytes','ok','statusText'])if(info.uses.has(name)){
   const value=name==='body'?info.body:name==='bodyBytes'?info.bytes:
    name==='headers'?forwardedHeaders(raw):name==='status'?`${raw}.status`:
    name==='statusCode'?`${raw}.status ?? ${raw}.statusCode`:name==='ok'?`${raw}.ok`:`${raw}.statusText`;
   out.push(`${name}: ${value}`);
  }
  return `{${out.join(', ')}}`;
 }
 // QX 的 $task.fetch 回调可能直接解构旧响应。只有函数仅作为本次 then
 // 的参数、解构字段全部属于已知响应字段且结链返回值被丢弃时，才把原生
 // 响应物化为一次性数据快照；失败分支仍把原始错误对象交给同一回调。
 function replyPattern(fn,call){
  if(fn.generator||fn.params.length!==1||fn.params[0]?.type!=='ObjectPattern')return null;
  // 解构快照会在回调前插入 await。回调自身若是完成函数，改写会把原本
  // 同步的 $done 边界变成异步链，现有完成顺序证明不覆盖这种混合。
  if(complete.has(fn))return null;
  const parent=parents.get(fn),id=fn.id??(parent?.type==='VariableDeclarator'?parent.id:null),binding=id?bindings.get(id):null;
  if(binding){if(binding.writes.length||!binding.refs.length||binding.refs.some(ref=>parents.get(ref)!==call||!call.arguments.includes(ref)))return null;}
  else if(parent!==call||!call.arguments.includes(fn))return null;
  const pattern=fn.params[0],fields=[],seen=new Set();let rest=null;
  for(const entry of pattern.properties){
   if(entry.type==='RestElement'){
    if(rest||entry!==pattern.properties.at(-1)||entry.argument.type!=='Identifier')return null;
    rest=entry.argument.name;continue;
   }
   if(entry.type!=='Property'||entry.kind!=='init'||entry.method||entry.computed||entry.value.type!=='Identifier')return null;
   const name=key(entry);if(name===undefined||!replyFieldNames.has(String(name))||seen.has(String(name)))return null;
   seen.add(String(name));fields.push({name:String(name),local:entry.value.name});
  }
  if(!fields.length&&!rest)return null;
  return {fields,rest};
 }
 function replyPatternPrelude(info,raw){
  const {fields,rest}=info.pattern,names=fields.map(field=>field.local).concat(rest?[rest]:[]);
  const destructure=source.slice(info.fn.params[0].start,info.fn.params[0].end),headers=forwardedHeaders(raw),bytes=fresh('responseBytes'),text=fresh('responseText');
  const snapshot=`{ statusCode: ${raw}.status, headers: ${headers}, body: ${text}, bodyBytes: ${bytes} }`;
  return `let ${names.join(', ')};\nif (${raw} && typeof ${raw}.arrayBuffer === 'function') {const ${bytes} = await ${raw}.arrayBuffer();const ${text} = new TextDecoder().decode(${bytes});(${destructure} = ${snapshot});} else {(${destructure} = ${raw} ?? {});}`;
 }
 // Register awaited QX replies and Promise callback parameters before rendering.
 for(const n of nodes){
  if(n.type==='VariableDeclarator'&&n.id.type==='Identifier'&&n.init?.type==='AwaitExpression'&&(isAPI(n.init.argument,'$task','fetch')||bundled&&n.init.argument.type==='CallExpression'&&n.init.argument.callee.type==='MemberExpression'&&n.init.argument.callee.object.type==='MemberExpression'&&free(n.init.argument.callee.object.object,'$native')&&property(n.init.argument.callee.object)==='http')){const b=bindings.get(n.id),info=reply(b,null,true);if(!info.snapshot)extraAfter.set(n,()=>replyPrelude(info,n.id.name));}
  if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&property(n.callee)==='then'&&isAPI(n.callee.object,'$task','fetch')){
   const fn=target(n.arguments[0]);if(!fn)fail(n,'HTTP 响应处理函数必须可静态追溯');
   const chain=parents.get(n),statement=chain?.type==='ChainExpression'?parents.get(chain):chain;
   if(fn.params[0]?.type==='ObjectPattern'&&statement?.type!=='ExpressionStatement')fail(n,'HTTP 响应解构回调必须位于返回值被丢弃的 Promise 链');
   if(fn.params[0]?.type==='ObjectPattern'){
    const pattern=replyPattern(fn,n);if(!pattern)fail(fn.params[0],'HTTP 响应解构必须是封闭的静态字段和尾部 rest');
    const info={uses:new Set(pattern.fields.map(field=>field.name)),body:null,bytes:null,snapshot:true,fn,pattern};
    httpReplies.set(fn,info);asyncFns.add(fn);
   }else if(fn.params[0]){
    const binding=bindings.get(fn.params[0]),forwarded=binding&&forwardedReply(binding,fn);if(!forwarded)reply(binding,fn,false);
   }
  }
  if(n.type==='CallExpression'&&clientMethod(n.callee)){
   const fn=target(n.arguments[1]),p=fn?.params[1];
   if(p?.type==='Identifier'){
    const binding=bindings.get(p),h=http(n.arguments[0],clientMethod(n.callee),false);
    let snapshot=false;
    for(const ref of binding.refs){const parent=parents.get(ref),use=parents.get(parent);if(parent?.type==='MemberExpression'&&parent.object===ref){const name=property(parent),assigned=use?.type==='AssignmentExpression'&&use.left===parent&&use.operator==='=';const prototypeKey=['__proto__','constructor','prototype','toString','toLocaleString','valueOf','hasOwnProperty','isPrototypeOf','propertyIsEnumerable','__defineGetter__','__defineSetter__','__lookupGetter__','__lookupSetter__'].includes(name);if(!['status','statusCode','headers','body'].includes(name)&&(!assigned||prototypeKey))fail(parent,'未知 HTTP 回调响应字段');if(name==='body'||assigned||use?.operator==='delete')snapshot=true;}
     else if(parent?.type==='TemplateLiteral')snapshot=true;
     else if(parent?.type==='SpreadElement'){
      const object=parents.get(parent),call=parents.get(object);
      if(call?.type==='CallExpression'&&call.arguments.includes(object)){
       const fn=target(call.callee),parameter=fn?.params[call.arguments.indexOf(object)],id=parameter?.type==='AssignmentPattern'?parameter.left:parameter;
       const staticPattern=id?.type==='Identifier'||id?.type==='ObjectPattern'&&id.properties.every(entry=>entry.type==='RestElement'||entry.type==='Property'&&entry.kind==='init'&&!entry.method&&!entry.computed&&key(entry)&&key(entry)!=='__proto__');
       if(fn&&staticPattern)snapshot=true;
      }
     }
     else if(parent?.type==='CallExpression'&&parent.arguments.includes(ref)){const safeStringify=parent.callee.type==='MemberExpression'&&free(parent.callee.object,'JSON')&&property(parent.callee)==='stringify';if(!target(parent.callee)&&!closedCallbackParameter(parent.callee)&&!safeStringify&&!isPromiseResolver(parent.callee))fail(ref,'HTTP 回调响应对象传入了未知函数：'+source.slice(parent.start,parent.end).slice(0,160));snapshot=true;}
     else if(closedWholeResponseUse(ref))snapshot=true;}
    httpReplies.set(binding,{uses:new Set(),body:null,bytes:null,full:h.full,snapshot});
   }
  }
 }
 function readBody(api,k){
  const type=api==='$request'?'request':'response',id=type+':'+k;
  if(!bodyReads.has(id))bodyReads.set(id,fresh(type+(k==='body'?'Body':'Bytes')));
  return bodyReads.get(id);
 }
 function render(n){
  if(!n)return '';
  if(generated.has(n))return generated.get(n);
  const text=emit(n);generated.set(n,text);return text;
 }
 function emit(n){
  if(n.type==='VariableDeclarator'&&n.id.type==='Identifier'&&httpReplies.get(bindings.get(n.id))?.snapshot){
   const info=httpReplies.get(bindings.get(n.id)),raw=fresh('response'),lines=[`const ${raw} = await ${render(n.init.argument)};`];
   if(info.bytes)lines.push(`const ${info.bytes} = await ${raw}.arrayBuffer();`);
   if(info.body)lines.push(`const ${info.body} = new TextDecoder().decode(${info.bytes});`);
   const fields=[...info.uses].map(name=>{
    const value=name==='body'?info.body:name==='bodyBytes'?info.bytes:name==='statusCode'?`${raw}.statusCode ?? ${raw}.status`:
     name==='status'?`${raw}.status ?? ${raw}.statusCode`:
     name==='headers'?`Object.fromEntries([...${raw}.headers.entries()].map(([field, value]) => [field, ${raw}.headers.getAll(field).length > 1 ? ${raw}.headers.getAll(field) : value]))`:
     name==='ok'?`${raw}.ok`:`${raw}.${name}`;
    return `${name}: ${value}`;
   });
   return `${render(n.id)} = await (async () => { ${lines.join(' ')} return {${fields.join(', ')}}; })()`;
  }
  if(n.type==='CallExpression'&&n.callee.type==='Identifier'&&n.callee.name===device.deviceTypeToken&&!n.arguments.length)return `(${context}.env.EGH_DEVICE_TYPE || 'iPhone')`;
  if(n.type==='CallExpression'&&free(n.callee,'setTimeout')&&n.arguments.length===2&&n.arguments[0]?.type==='CallExpression'&&n.arguments[1].type==='Literal'&&typeof n.arguments[1].value==='number'&&target(n.arguments[0].callee)&&parents.get(n)?.type==='ExpressionStatement')return render(n.arguments[0]);
  if(n.type==='AssignmentExpression'&&n.operator==='='&&n.left.type==='MemberExpression'&&n.left.object.type==='Identifier'){
   const info=httpReplies.get(bindings.get(n.left.object));
   if(info?.promiseForward&&sameReplyMember(n.right,n.left))return property(n.left)==='bodyBytes'?info.bytes:info.body;
  }
  if(n.type==='AssignmentExpression'&&n.operator==='='&&free(n.left)&&guardedImplicit.has(n.left.name))return '('+n.left.name+' = ('+render(n.right)+'), '+guardedImplicit.get(n.left.name)+' = true, '+n.left.name+')';
  if(n.type==='AssignmentExpression'&&n.operator!=='='&&free(n.left)&&guardedImplicit.has(n.left.name))return '('+guardedImplicit.get(n.left.name)+' ? ('+n.left.name+' '+n.operator+' ('+render(n.right)+')) : (() => {throw new '+(referenceError??'ReferenceError')+'('+JSON.stringify(n.left.name+' is not defined')+');})())';
  if(n.type==='Property'&&n.shorthand&&free(n.value)&&guardedImplicit.has(n.value.name))return n.value.name+': '+render(n.value);
  // 已证明为宿主响应别名的参数，其 body 读写统一落到本地正文变量；这样
  // 闭合 helper 的正文修改能进入完成投影，同时不直接改写宿主响应对象。
  if(n.type==='MemberExpression'&&property(n)==='body'&&n.object.type==='Identifier'&&hostResponseBindings.has(bindings.get(n.object))){
   const parent=parents.get(n);
   if(parent?.type==='AssignmentExpression'&&parent.left===n&&parent.operator!=='=')fail(n,'宿主响应正文只支持简单赋值');
   if(parent?.type==='UpdateExpression'||parent?.type==='UnaryExpression'&&parent.operator==='delete')fail(n,'宿主响应正文字段被直接修改');
   if(parent?.type==='AssignmentExpression'&&parent.left===n)bodyWrites.add('response:body');
   return readBody('$response','body');
  }
  if(n.type==='AssignmentExpression'&&sloppyWrites.has(n)){
   const left=n.left,binding=left.object.type==='Identifier'?bindings.get(left.object):null;
   // 宿主响应正文写入必须落到本地正文变量，不能被 sloppy helper 当成普通
   // 对象属性写回；否则完成投影仍读取旧正文。
   if(property(left)==='body'&&hostResponseBindings.has(binding)){
    if(n.operator!=='=')fail(n,'宿主响应正文只支持简单赋值');
    bodyWrites.add('response:body');
    return readBody('$response','body')+' = '+render(n.right);
   }
   return `${sloppyWriteHelper}(${render(left.object)}, ${JSON.stringify(property(left))}, ${render(n.right)})`;
  }

  if(n.type==='VariableDeclarator'&&n.id.type==='ObjectPattern'&&n.init?.type==='Identifier'){
   const info=httpReplies.get(bindings.get(n.init));if(info&&!info.snapshot){
    const fields=[...info.uses].map(name=>`${name}: ${name==='body'?info.body:name==='bodyBytes'?info.bytes:name==='statusCode'?render(n.init)+'.status':render(n.init)+'.'+name}`);
    return `${render(n.id)} = {${fields.join(', ')}}`;
   }
  }
  if(n.type==='NewExpression'&&['Request','Response'].some(name=>free(n.callee,name))&&n.arguments.length===2){
   const kind=n.callee.name==='Request'?'request':'response',message=n.arguments[1];
   if(free(message,'$'+kind)){
    if(kind==='response'&&format==='qx')fail(n,'QX 整体响应的 statusCode 字段不能作为标准 Response 初始化参数');
    const fields=kind==='request'?`method: ${context}.request.method, headers: ${context}.request.headers, body: ${readBody('$request','body')}`:`status: ${context}.response.status, headers: ${context}.response.headers`;
    return `new ${n.callee.name}(${render(n.arguments[0])}, {${fields}})`;
   }
  }
  if(n.type==='Identifier'&&free(n)){
   if(n.name==='$request'&&hostRequestSnapshot)return hostRequestSnapshot;
   if(n.name==='$response'&&hostResponseSnapshot)return hostResponseSnapshot;
   if(guardedImplicit.has(n.name)){
    const p=parents.get(n);
    if(p?.type==='AssignmentExpression'&&p.left===n||p?.type==='UnaryExpression'&&p.operator==='typeof')return n.name;
    return '('+guardedImplicit.get(n.name)+' ? '+n.name+' : (() => {throw new '+(referenceError??'ReferenceError')+'('+JSON.stringify(n.name+' is not defined')+');})())';
   }
   const map={$request:`${context}.request`,$response:`${context}.response`,$argument:options.argument_object?argumentObject:`(${context}.env.argument || '')`,$cronexp:`${context}.cron`,...(bundled?{$native:context}:{})};
   if(['$request','$response'].includes(n.name)){
    const p=parents.get(n);
    const other=p?.left===n?p.right:p?.left;
    const nullCheck=p?.type==='BinaryExpression'&&['==','!=','===','!=='].includes(p.operator)&&(other?.type==='Literal'&&other.value===null||free(other,'undefined'));
    if(!shapeHostValues.has(n)&&!nullCheck&&!(p?.type==='MemberExpression'&&p.object===n)&&!(p?.type==='UnaryExpression'&&['typeof','!'].includes(p.operator))&&!(p?.type==='LogicalExpression'&&p.left===n)&&!(['IfStatement','ConditionalExpression'].includes(p?.type)&&p.test===n)&&!(p?.type==='ExpressionStatement'&&p.expression===n))fail(n,'请求 / 响应对象整体传递无法证明字段语义，须直接读取具体字段');
   }
   if(map[n.name])return map[n.name];
   // QX 脚本常用裸 $prefs 和成员真值探测来兼容多平台存储。目标宿主只暴露
   // ctx.storage，因此仅允许它们出现在 typeof、逻辑合取或条件测试中；对象或
   // 方法引用一旦赋值、传参或逃逸仍按未知平台值失败关闭。
   if(n.name==='$prefs'&&format==='qx'){
    const p=parents.get(n);
    const probe=p?.type==='UnaryExpression'&&p.operator==='typeof'||p?.type==='LogicalExpression'||
     ['IfStatement','WhileStatement','DoWhileStatement','ConditionalExpression'].includes(p?.type)&&p.test===n;
    if(probe)return context+'.storage';
    fail(n,'存储对象整体传递无法证明字段语义，只能用于存在性判断');
   }
   if(n.name.startsWith('$')){fail(n,'平台 API 作为值传递，无法直接原生改写：'+n.name);}
  }
  if(n.type==='MemberExpression'){
   const k=property(n),o=n.object;
   if(hostRequestSnapshot&&free(o,'$request')){
    if(k===undefined)fail(n,'宿主请求字段必须是静态成员');
    return hostRequestSnapshot+'['+JSON.stringify(k)+']';
   }
   if(hostResponseSnapshot&&free(o,'$response')){
    if(k===undefined)fail(n,'宿主响应字段必须是静态成员');
    return hostResponseSnapshot+'['+JSON.stringify(k)+']';
   }
   if(o.type==='MemberExpression'&&free(o.object,'$network')&&['v4','v6'].includes(property(o))){const fields={primaryAddress:'address',primaryInterface:'interface',primaryRouter:'gateway'};if(!fields[k])fail(n,'未知网络地址字段');return `${context}.device.${property(o)==='v4'?'ipv4':'ipv6'}.${fields[k]}`;}
   if(free(o,'$httpClient')){
    const m=clientMethod(n);let alias=n;
    if(typeof m==='string'){
     if(provenMethodRoot(parents.get(n)))return context+'.http.'+m;
    }else if(m?.selection){
     if(provenMethodRoot(parents.get(n)))return patch(source,m.selection,render);
     fail(n,'HTTP 方法条件别名存在未证明的引用');
    }
    if(m?.expression)fail(n,'动态 HTTP 方法引用必须直接调用，不能在未确定求值时机时保存为别名');
    while(parents.get(alias)?.type==='LogicalExpression'&&parents.get(alias).operator==='||')alias=parents.get(alias);
    const p=parents.get(alias),b=p?.type==='VariableDeclarator'&&p.init===alias?bindings.get(p.id):null;
    if(!m)fail(n,'HTTP 方法必须可静态确定');
    if(!b||b.writes.length||!b.refs.length||!b.refs.every(ref=>{const use=parents.get(ref);return use?.type==='CallExpression'&&use.callee===ref&&clientMethod(ref)===m;}))fail(n,'HTTP 方法作为值传递，尚未证明旧回调和原生请求参数的调用契约');
    return context+'.http.'+m;
   }
   if(free(o,'$utils')&&compressionMethod(n)){
    const p=parents.get(n);if(!(p?.type==='VariableDeclarator'&&p.init===n))fail(n,'压缩 API 引用必须直接调用或保存为可追溯的局部别名');
    if(p.id.type!=='Identifier'||bindings.get(p.id)?.writes.length)fail(n,'压缩 API 别名被重新赋值，无法传播 await');
    return context+'.compress.'+compressionMethod(n);
   }
   if(free(o,'$prefs')&&format==='qx'){
    const storageMethod={valueForKey:'get',setValueForKey:'set',removeValueForKey:'delete'}[k];
    if(!storageMethod)fail(n,'未知 QX 存储成员：'+k);
    const p=parents.get(n);
    const probe=p?.type==='UnaryExpression'&&['!','typeof'].includes(p.operator)||p?.type==='LogicalExpression'||
     ['IfStatement','WhileStatement','DoWhileStatement','ConditionalExpression'].includes(p?.type)&&p.test===n;
    if(!probe)fail(n,'存储方法引用只能用于存在性判断或直接调用');
    return context+'.storage.'+storageMethod;
   }
   if(free(o,'$persistentStore')){
    // 旧持久化 API 的方法引用只允许作为存在性探测；直接调用已在调用表达式
    // 分支按同一 key/value 顺序映射，整体对象或函数别名仍按逃逸拒绝。
    const storageMethod={read:'get',write:'set',removeValueForKey:'delete'}[k];
    if(!storageMethod)fail(n,'未知持久化存储成员：'+k);
    const p=parents.get(n);
    const probe=p?.type==='UnaryExpression'&&['!','typeof'].includes(p.operator)||p?.type==='LogicalExpression'||
     ['IfStatement','WhileStatement','DoWhileStatement','ConditionalExpression'].includes(p?.type)&&p.test===n;
    if(!probe)fail(n,'存储方法引用只能用于存在性判断或直接调用');
    return context+'.storage.'+storageMethod;
   }
   if(free(o,'$request')||free(o,'$response')){
    const parent=parents.get(n);
    if(parent?.type==='AssignmentExpression'&&parent.left===n){
     if(free(o,'$response')&&k==='body'&&!options.binary){bodyWrites.add('response:body');return readBody(o.name,k);}
     fail(n,'请求 / 响应字段被直接修改，需要先确定完成结果的数据流');
    }
    if(parent?.type==='UpdateExpression'||parent?.type==='UnaryExpression'&&parent.operator==='delete')fail(n,'请求 / 响应字段被直接修改，需要先确定完成结果的数据流');
    if(['body','bodyBytes'].includes(k))return readBody(o.name,k);
    if(free(o,'$response')&&k==='statusCode')return context+'.response.status';
    if(!['url','method','status','headers'].includes(k))fail(n,'未知请求 / 响应字段');
   }
   const info=o.type==='Identifier'?httpReplies.get(bindings.get(o)):null;
   if(info?.promiseForward){
    if(k==='body')return info.body;
    if(k==='bodyBytes')return info.bytes;
    if(k==='headers')return forwardedHeaders(render(o));
    if(k==='status')return `${render(o)}.status`;
    if(k==='statusCode')return `${render(o)}.status ?? ${render(o)}.statusCode`;
    if(k==='ok')return `${render(o)}.ok`;
    if(k==='statusText')return `${render(o)}.statusText`;
   }
   if(info&&!info.snapshot){if(k==='body')return info.body;if(k==='bodyBytes')return info.bytes;if(k==='statusCode')return render(o)+'.status';if(k==='headers'&&info.full)return `Object.entries(${render(o)}.headers).flatMap(([field, value]) => (Array.isArray(value) ? value : [value]).map(value => ({field, value})))`;}
   if(free(o,'$script')){if(k==='name')return context+'.script.name';if(k==='binaryBodyMode')return String(!!options.binary);if(k==='startTime'){if(!started){started=fresh('scriptStarted');prefix.push(`const ${started} = Date.now();`);}return format==='loon'?started:`(${started} / 1000)`;}}
   if(free(o,'$environment'))return k==='language'?context+'.app.language':context+'.env';
   if(free(o,'$notification')&&k==='post'){
    const p=parents.get(n);
    if(p?.type==='UnaryExpression'&&['typeof','!'].includes(p.operator)||['IfStatement','WhileStatement','DoWhileStatement','ConditionalExpression'].includes(p?.type)&&p.test===n||p?.type==='LogicalExpression'&&p.left===n)return context+'.notify';
    fail(n,'通知方法引用只能用于存在性判断或直接调用');
   }
   if(free(o,'$network')){const map={wifi:'wifi',v4:'ipv4',v6:'ipv6',dns:'dnsServers','cellular-data':'cellular'};if(!map[k])fail(n,'未知网络字段');return context+'.device.'+map[k];}
  }
  if(n.type==='CallExpression'){
   const compression=compressionMethod(n.callee);
   if(compression){if(n.arguments.length!==1||n.arguments[0].type==='SpreadElement')fail(n,'压缩 API 必须接收一个二进制参数');return `(await ${context}.compress.${compression}(${bytes(n.arguments[0])}))`;}
   if(isDone(n)){const value=payload(n.arguments[0]);return pending?`((value) => (${pendingFinished} = true, value))(${value})`:value;}
   if(n.arguments.length===1&&n.arguments[0].type==='Identifier'&&isPromiseResolver(n.callee)){
    const info=httpReplies.get(bindings.get(n.arguments[0]));
    if(info?.promiseForward)return `${render(n.callee)}(${forwardedSnapshot(info,n.arguments[0].name)})`;
   }
   if(isAPI(n,'$notify')||isAPI(n,'$notification','post'))return notification(n);
   if(isAPI(n,'$log'))return `console.log(${n.arguments.map(a=>a.type==='SpreadElement'?'...'+render(a.argument):render(a)).join(', ')})`;
   if(isAPI(n,'$task','fetch'))return http(n.arguments[0],null,true).code+`.catch(error => {throw {error: String(error.message ?? error)};})`;
   if(n.callee.type==='MemberExpression'&&(free(n.callee.object,'$prefs')||free(n.callee.object,'$persistentStore'))){
    const m=property(n.callee),a=n.arguments,keyIndex=['write','setValueForKey'].includes(m)?1:0;
    const fallback=format==='loon'?`('egern-hub:loon:' + ${context}.script.name)`:JSON.stringify(options.storage_key??'egern-hub:script');const k=a[keyIndex]?`(${render(a[keyIndex])} ?? ${fallback})`:fallback;
    if(['read','valueForKey'].includes(m))return `${context}.storage.get(${k})`;
    if(m==='removeValueForKey')return `(() => {try {${context}.storage.delete(${k}); return true;} catch {return false;}})()`;
    if(['write','setValueForKey'].includes(m)){
     const value=fresh('storageValue'),key=fresh('storageKey'),resolvedKey=`(${key} ?? ${fallback})`;
     return `((${value}, ${key}) => {try {${m==='write'?`if (${value} === null) ${context}.storage.delete(${resolvedKey}); else `:''}${context}.storage.set(${resolvedKey}, ${value}); return true;} catch {return false;}})(${a[0]?render(a[0]):'undefined'}, ${a[1]?render(a[1]):'undefined'})`;
    }
   }
   if(n.callee.type==='MemberExpression'&&free(n.callee.object,'$utils')){const map={geoip:'country',ipasn:'asn',ipaso:'organization'},m=property(n.callee);return `(${context}.lookupIP(${render(n.arguments[0])})?.${map[m]} ?? null)`;}
   if(clientMethod(n.callee))fail(n,'HTTP 回调必须在独立语句中调用');
   const fn=target(n.callee),p=parents.get(n);
   if(!structured&&!bundled&&fn&&(complete.has(fn)&&asyncFns.has(fn)||lifted.has(fn)&&!fn.async)&&p?.type!=='AwaitExpression'&&!(p?.type==='MemberExpression'&&['then','catch'].includes(property(p))))return '(await '+patch(source,n,render)+')';
  }
  if(n.type==='ReturnStatement'&&n.argument?.type==='CallExpression'&&httpDispatch(n.argument)){
   const dispatch=httpDispatch(n.argument),completing=complete.has(target(dispatch.callback));
   return callback(n.argument,undefined,undefined,dispatch)+(completing?'':'\nreturn;');
  }
  if(n.type==='ExpressionStatement'){
   const e=n.expression;
   if(e.type==='SequenceExpression'){
    const flat=x=>x.type==='SequenceExpression'?x.expressions.flatMap(flat):[x],parts=flat(e);
    if(parts.some(x=>x.type==='CallExpression'&&httpDispatch(x)))return parts.map(x=>emit({...n,start:x.start,end:x.end,expression:x})).join('\n');
   }
   if(pending?.calls.has(e))return '{'+pendingResult+' = '+patch(source,e,render)+'; if ('+pendingFinished+') return await '+pendingResult+';}';
   if(e.type==='CallExpression'&&httpDispatch(e))return callback(e,undefined,undefined,httpDispatch(e));
   if(terminal(e)||e.type==='AwaitExpression'&&terminal(e.argument))return 'return '+render(e)+';';
   if(e.type==='ConditionalExpression'&&terminalExpression(e)){
    const branch=x=>x.type==='ConditionalExpression'?`if (${render(x.test)}) {${branch(x.consequent)}} else {${branch(x.alternate)}}`:'return '+render(x)+';';
    return branch(e);
   }
   // Detached async work can outlive a return; do not silently change ordering.
   if(e.type==='CallExpression'&&(target(e.callee)&&asyncFns.has(target(e.callee))||e.callee.type==='MemberExpression'&&['then','catch'].includes(property(e.callee)))){
    // Authored non-completing async calls keep their ignored Promise. Awaiting
    // them would change concurrent requests and the original $done boundary.
    const callee=target(e.callee);
    if(callee?.async&&!complete.has(callee)&&!lifted.has(callee))return patch(source,n,render);
    if(structured&&!terminal(e)&&promiseValue(e))return patch(source,n,render);
    {
     const callbackContext=(fn,seen=new Set())=>{
      if(!functions.has(fn?.type)||seen.has(fn))return false;
      seen=new Set(seen);seen.add(fn);const call=parents.get(fn);
      if(call?.type==='NewExpression'&&free(call.callee,'Promise')&&call.arguments[0]===fn||call?.type==='CallExpression'&&clientMethod(call.callee)&&call.arguments[1]===fn)return true;
      if(callbackContext(owners.get(parents.get(fn)),seen))return true;
      const callers=nodes.filter(n=>n.type==='CallExpression'&&target(n.callee)===fn);
      return callers.length>0&&callers.every(n=>callbackContext(owners.get(n),seen));
     };
     if(callbackContext(owners.get(e))&&(!callee&&e.callee.type==='MemberExpression'&&['then','catch'].includes(property(e.callee))||callee?.async&&!complete.has(callee)&&!lifted.has(callee)))return patch(source,n,render);
    }
    // then/catch 的所有回调都已解析为不完成、不同步提升的普通函数时，
    // 该 Promise 链只是被忽略的普通异步工作；原样保留不会改变完成边界。
    if(e.callee.type==='MemberExpression'&&['then','catch'].includes(property(e.callee))&&e.arguments.every(argument=>argument.type==='Identifier'&&free(argument,'undefined')||(()=>{
     const fn=target(argument);return functions.has(fn?.type)&&!complete.has(fn)&&!asyncFns.has(fn)&&!lifted.has(fn);
    })()))return patch(source,n,render);
    if(lifted.has(target(e.callee))&&!target(e.callee).async)return render(e)+';';
    fail(e,'独立异步任务未传播完成结果，无法证明终止顺序');
   }
  }
  if(n.type==='VariableDeclaration'){
   const after=n.declarations.map(d=>extraAfter.get(d)?.()).filter(Boolean);return patch(source,n,render)+(after.length?'\n'+after.join('\n'):'');
  }
  if((n.type==='MethodDefinition'||n.type==='Property'&&n.method)&&asyncFns.has(n.value)&&!n.value.async){
   if(n.kind!=='method'&&n.kind!=='init')fail(n,'访问器和构造器不能改为异步');
   const text=patch(source,n,render);return n.static?text.replace(/^static\s+/, 'static async '):'async '+text;
  }
  if(functions.has(n.type)){
   const info=[...httpReplies.values()].find(x=>x.fn===n);
   // Pure callbacks/helpers do not need a new return block. Preserve their
   // expression form; only API/async/completion boundaries require lowering.
   if(!complete.has(n)&&!info&&(!asyncFns.has(n)||n.async))return patch(source,n,render);
   let head=patch(source,{...n,body:null,end:n.body.start},render);
   let prologue=info&&!info.pattern?replyPrelude(info,n.params[0].name):'';
   if(info?.pattern){
    const raw=fresh('response');
    head=source.slice(n.start,n.params[0].start)+raw+source.slice(n.params[0].end,n.body.start);
    prologue=replyPatternPrelude(info,raw);
   }
   if(n.body.type!=='BlockStatement')head=head.slice(0,head.lastIndexOf('=>')+2)+' ';
   const method=parents.get(n)?.type==='MethodDefinition'||parents.get(n)?.type==='Property'&&parents.get(n).method;
   if(asyncFns.has(n)&&!n.async&&!method)head='async '+head;
   if(n.body.type==='BlockStatement'){
    const body=render(n.body),inner=body.slice(1,-1);
    if(prologue&&n.body.body.some(s=>s.directive))fail(n,'HTTP 回调含 directive，需要先明确正文读取位置');
    return head+'{'+prologue+'\n'+inner+(complete.has(n)?'\nthrow new Error("Script ended without a completion result");':'')+'}';
   }
   return head+'{'+prologue+'\nreturn '+render(n.body)+';}';
  }
  return patch(source,n,render);
 }
 function callback(n,completionGuard,detached,dispatch){
  const requestNode=dispatch?.request??n.arguments[0];
  const callbackNode=dispatch?.callback??n.arguments[1];
  const fn=target(callbackNode);if(!fn||fn.params.some(p=>p.type!=='Identifier')||fn.params.length>3)fail(n,'HTTP 回调必须是可追溯的简单函数');
  const h=http(requestNode,dispatch?.method??clientMethod(n.callee),false),r=fresh('httpResponse'),e=fresh('httpError'),b=fresh('httpBody'),caught=fresh('networkError');
  const response=fn.params[1]&&bindings.get(fn.params[1]);
  let snapshot=httpReplies.get(response)?.snapshot;
  // 方法转发器入口不会在注册扫描中表现为直接的 $httpClient 调用；消费处
  // 重新确认每条响应引用都属于闭合包装记录，才能安全地物化纯数据快照。
  if(!snapshot&&response&&response.refs.length&&response.refs.every(ref=>closedWholeResponseUse(ref)))snapshot=true;
  const owner=owners.get(n);
  if(parents.get(n)?.type==='ReturnStatement'&&owner.async&&!complete.has(fn)){
   const p=parents.get(owner),binding=bindings.get(owner.id??(p?.type==='VariableDeclarator'?p.id:null));
   const calls=binding&&!binding.writes.length?binding.refs.map(r=>parents.get(r)):p?.type==='CallExpression'&&p.callee===owner?[p]:null;
   const ignored=call=>{const use=parents.get(call),host=parents.get(use);return use?.type==='ExpressionStatement'||use?.type==='ArrowFunctionExpression'&&use.body===call&&host?.type==='NewExpression'&&free(host.callee,'Promise')&&host.arguments[0]===use;};
   if(!calls?.length||calls.some((call,i)=>call?.type!=='CallExpression'||binding&&call.callee!==binding.refs[i]||!ignored(call)))fail(n,'异步 HTTP 回调辅助函数的立即返回值被使用，尚未证明回调与后续代码的执行顺序');
  }
  // Materialize only the documented callback data, not a host Response object
  // whose enumerable fields, methods and Headers implementation differ.
  const responseHeaders=h.full?`[...${r}.headers.entries()].flatMap(([field,value])=>(${r}.headers.getAll(field).length > 1 ? ${r}.headers.getAll(field) : [value]).map(value=>({field,value})))`:`Object.fromEntries([...${r}.headers.entries()].map(([name,value])=>[name, ${r}.headers.getAll(name).length > 1 ? ${r}.headers.getAll(name) : value]))`;
  const responseValue=snapshot?`(${r} === null ? null : {status: ${r}.status, statusCode: ${r}.status, headers: ${responseHeaders}})`:r;
  if(!complete.has(fn)||detached){
   function inExecutor(owner,seen=new Set()){
    if(seen.has(owner))return false;seen=new Set(seen);seen.add(owner);const parent=parents.get(owner);
    if(parent?.type==='NewExpression'&&free(parent.callee,'Promise')&&parent.arguments[0]===owner)return true;
    if(parent?.type==='CallExpression'&&free(parent.callee,'setTimeout')&&parent.arguments[0]===owner&&[1,2].includes(parent.arguments.length))return inExecutor(owners.get(parent),seen);
    if(parent?.type==='CallExpression'&&parent.callee===owner)return inExecutor(owners.get(parent),seen);
    if(parent?.type==='CallExpression'&&clientMethod(parent.callee)&&parent.arguments[1]===owner)return inExecutor(owners.get(parent),seen);
    if(parent?.type==='CallExpression'&&functions.has(parent.callee.type)&&parent.arguments.includes(owner)){
     const parameter=parent.callee.params[parent.arguments.indexOf(owner)],binding=bindings.get(parameter?.type==='AssignmentPattern'?parameter.left:parameter);
     if(binding&&!binding.writes.length&&binding.refs.length&&binding.refs.every(ref=>{const call=parents.get(ref);return call?.type==='CallExpression'&&call.callee===ref&&inExecutor(owners.get(call),seen);}))return true;
    }
    const id=owner?.id??(parent?.type==='VariableDeclarator'?parent.id:null),b=id?bindings.get(id):null;
    return !!b&&!b.writes.length&&b.refs.length>0&&b.refs.every(r=>{const c=parents.get(r);return c?.type==='NewExpression'&&free(c.callee,'Promise')&&c.arguments[0]===r||c?.type==='CallExpression'&&(c.callee===r||free(c.callee,'setTimeout')&&c.arguments[0]===r&&[1,2].includes(c.arguments.length))&&inExecutor(owners.get(c),seen);});
   }
   // A callback with no completion may also be deliberately detached. Keep
   // its original request start and ignored return when another proven path
   // owns script completion; never turn it into an awaited root request.
   if(!inExecutor(owners.get(n))&&!complete.has(tree))fail(fn,'非完成 HTTP 回调必须位于可追溯的 Promise 执行器，或由其他可追溯路径完成脚本');
     if(!snapshot&&response?.refs.some(ref=>{const p=parents.get(ref);return p?.type!=='MemberExpression'||p.object!==ref||!['status','statusCode','headers'].includes(property(p));}))fail(fn,'HTTP 回调响应对象不能整体传递');
   // Argument construction belongs to the original synchronous executor. A
   // thrown URL/header expression must reject that Promise, not become a
   // network error passed to the callback of a detached async function.
   const url=fresh('httpURL'),options=fresh('httpOptions'),handler=fresh('httpCallback'),send=h.dynamic?fresh('httpSend'):null;
   const requestBody=h.runtimeRequest
    ? `const ${handler} = ${render(callbackNode)}; const ${url} = ${h.url}; const ${options} = ${h.options};`
    : `const ${url} = ${h.url}; const ${options} = ${h.options}; const ${handler} = ${render(callbackNode)};`;
   const requestCall=send?`${send}(${url}, ${options})`:`${h.callee}(${url}, ${options})`;
   const dispatch=`{${requestBody} void (async () => {let ${e} = null, ${r} = null, ${b} = null;try {${r} = await ${requestCall}; ${b} = ${h.binary?`new Uint8Array(await ${r}.arrayBuffer())`:`await ${r}.text()`};} catch (${caught}) {${e} = String(${caught}.message ?? ${caught}); ${r} = null;} ${detached?`if (${detached.completion}) return; await `:''}${handler}(${e}, ${responseValue}, ${b});})()${detached?`.catch(${detached.reject})`:''};}`;
   const callee=send?`const ${send} = ${h.callee}; `:'';
   if(h.runtimeRequest){
    const {name,expression}=h.runtimeRequest;
    return `{${callee}((${name}) => ${dispatch})(${render(expression)});}`;
   }
   return `{${callee}${dispatch.slice(1)}`;
  }
  return `{let ${e} = null, ${r} = null, ${b} = null;\ntry {${r} = await ${h.code}; ${b} = ${h.binary?`new Uint8Array(await ${r}.arrayBuffer())`:`await ${r}.text()`};} catch (${caught}) {${e} = String(${caught}.message ?? ${caught}); ${r} = null;}\n${completionGuard?'':'return '}await (${render(callbackNode)})(${e}, ${responseValue}, ${b});${completionGuard??''}}`;
 }
 // 宿主请求只有经过闭合 helper 的静态字段读写时，才降为一次本地快照。快照
 // 保留字段值而不把可变宿主对象交给业务代码；helper 不得复制、转发或返回
 // 该对象，返回值被忽略方可接受，字段写入只允许静态普通赋值。
 const responseSnapshotFields=new Set(['status','statusCode','headers','body','bodyBytes','ok','statusText']);
 const snapshotStringMethods=new Set(['replace','replaceAll','trim','trimStart','trimEnd','toLowerCase','toUpperCase','toLocaleLowerCase','toLocaleUpperCase','normalize','padStart','padEnd','repeat','charAt','substring','substr','split','includes','startsWith','endsWith','match','matchAll','search','indexOf','lastIndexOf','slice']);
 // 直接内联 helper 的宿主参数只在已证明的静态字段上使用；快照在调用边界
 // 建立，后续包装记录与返回值只携带本地数据，不再保留宿主对象身份。
 const inlineHostSnapshotProof=(binding,directFields,{allowedWrites=null,allowDone=false,allowDynamicHeaders=false}={})=>{
  if(!binding)return false;
  for(const ref of binding.refs){
   const p=parents.get(ref),q=parents.get(p),other=p?.left===ref?p.right:p?.right===ref?p.left:null;
   if(p?.type==='UnaryExpression'&&['!','typeof','void'].includes(p.operator))continue;
   if(p?.type==='BinaryExpression'&&['==','!=','===','!=='].includes(p.operator)&&(other?.type==='Literal'&&other.value===null||free(other,'undefined')))continue;
   if(p?.type==='LogicalExpression'&&p.left===ref||['IfStatement','ConditionalExpression','WhileStatement','DoWhileStatement'].includes(p?.type)&&p.test===ref)continue;
   if(p?.type==='MemberExpression'&&p.object===ref){
    const field=property(p);if(field===undefined||!directFields.has(String(field)))return false;
    if(q?.type==='MemberExpression'&&q.object===p){
     const nested=property(q);
     if(String(field)==='headers'){
      const use=parents.get(q);
      if(nested===undefined&&!allowDynamicHeaders||['__proto__','prototype','constructor'].includes(String(nested)))return false;
      if(use?.type==='AssignmentExpression'&&use.left===q||use?.type==='UpdateExpression'||use?.type==='UnaryExpression'&&use.operator==='delete'||use?.type==='CallExpression'&&use.callee===q)return false;
      continue;
     }
     if(['url','method'].includes(String(field))&&nested!==undefined&&snapshotStringMethods.has(String(nested))&&parents.get(q)?.type==='CallExpression'&&parents.get(q).callee===q)continue;
     return false;
    }
    if(q?.type==='CallExpression'&&q.callee===p)return false;
    if(q?.type==='UpdateExpression')return false;
    if(q?.type==='UnaryExpression'&&q.operator==='delete'&&q.argument===p)return false;
    if(q?.type==='AssignmentExpression'&&q.left===p&&(q.operator!=='='||allowedWrites&&!allowedWrites.has(String(field))))return false;
    continue;
   }
   if(p?.type==='Property'&&p.value===ref&&!p.computed&&key(p)!==undefined)continue;
   if(p?.type==='SpreadElement'&&p.argument===ref)continue;
   if(p?.type==='SequenceExpression'&&p.expressions.at(-1)===ref)continue;
   if(p?.type==='ReturnStatement'&&p.argument===ref||p?.type==='ArrowFunctionExpression'&&p.body===ref)continue;
   if(allowDone&&p?.type==='CallExpression'&&(isDone(p)||target(p.callee)&&complete.has(target(p.callee))))continue;
   return false;
  }
  return true;
 };
 const proveHostRequestSnapshot=()=>{
  const stop=()=>null;
  const astChildren=value=>Array.isArray(value)?value.filter(item=>item&&typeof item==='object'&&typeof item.type==='string'):value&&typeof value==='object'&&typeof value.type==='string'?[value]:[];
  const callSites=fn=>{
   const parent=parents.get(fn);
   if(parent?.type==='CallExpression'&&parent.callee===fn&&!parent.optional&&!parent.arguments.some(a=>a.type==='SpreadElement'))return [parent];
   return nodes.filter(n=>n.type==='CallExpression'&&!n.optional&&!n.arguments.some(a=>a.type==='SpreadElement')&&target(n.callee)===fn);
  };
  // 解析一个表达式可能求值到的本地闭合函数集合。只在每个分支都落到已知
  // 函数或确定不可调用的空值时成功；未知调用、动态值或逃逸一律拒绝。
  const functionCandidates=expression=>{
   const resolved=new Set(),seen=new Set();let nonFunction=false;
   const visitReturns=fn=>{
    if(!functions.has(fn?.type))return false;
    let found=false,ok=true;
    const walk=node=>{
     if(!node||!ok)return;
     if(functions.has(node.type)&&node!==fn)return;
     if(node.type==='ReturnStatement'){found=true;if(node.argument){if(!visit(node.argument))ok=false;}else nonFunction=true;return;}
     for(const value of Object.values(node))for(const child of astChildren(value))walk(child);
    };
    walk(fn.body);return ok&&found||ok&&!found;
   };
   const visit=node=>{
    if(!node)return false;
    if(functions.has(node.type)){resolved.add(node);return true;}
    if(node.type==='Identifier'&&node.name==='undefined'&&free(node,'undefined')){nonFunction=true;return true;}
    if(node.type==='Identifier'){
     const binding=bindings.get(node);if(!binding||binding.writes.length||seen.has(binding))return false;
     seen.add(binding);
     const result=(()=>{
      const init=binding.fn??binding.init;if(init)return visit(init);
      const owner=nodes.find(candidate=>functions.has(candidate.type)&&candidate.params.some(parameter=>bindings.get(parameter.type==='AssignmentPattern'?parameter.left:parameter)===binding));
      if(!owner)return false;
      const position=owner.params.findIndex(parameter=>bindings.get(parameter.type==='AssignmentPattern'?parameter.left:parameter)===binding);
      const calls=callSites(owner);if(!calls.length)return false;
      return calls.every(call=>{const argument=call.arguments[position];if(!argument){nonFunction=true;return true;}return visit(argument);});
     })();
     seen.delete(binding);return result;
    }
    if(node.type==='ConditionalExpression')return visit(node.consequent)&&visit(node.alternate);
    if(node.type==='LogicalExpression')return visit(node.left)&&visit(node.right);
    if(node.type==='SequenceExpression')return visit(node.expressions.at(-1));
    if(node.type==='AssignmentExpression')return visit(node.right);
    if(node.type==='Literal'&&(node.value===null||node.value===undefined)){nonFunction=true;return true;}
    if(node.type==='UnaryExpression'&&node.operator==='void'){nonFunction=true;return true;}
    if(node.type==='CallExpression'){
     if(functions.has(node.callee.type))return visitReturns(node.callee);
     const fn=target(node.callee);return !!fn&&visitReturns(fn);
    }
    return false;
   };
   return visit(expression)?{ok:true,functions:[...resolved],nonFunction}:{ok:false,functions:[],nonFunction:false};
  };
  const parameterProof=(targetBinding,seen=new Set())=>{
   if(!targetBinding||targetBinding.writes.length||seen.has(targetBinding))return stop('parameter binding');
   seen=new Set(seen);seen.add(targetBinding);
   const fn=nodes.find(n=>functions.has(n.type)&&n.params.some(p=>bindings.get(p.type==='AssignmentPattern'?p.left:p)===targetBinding));
   if(!fn)return stop('parameter function');
   const read=new Set(),write=new Set(),returnedFields=new Set();let returnsRequest=false,directReturn=false;
   for(const ref of targetBinding.refs){
    const p=parents.get(ref),q=parents.get(p);
    if(p?.type==='ReturnStatement'&&p.argument===ref){returnsRequest=true;directReturn=true;continue;}
    if(p?.type==='SequenceExpression'&&p.expressions.at(-1)===ref){
     const statement=parents.get(p);if(statement?.type==='ReturnStatement'&&statement.argument===p){returnsRequest=true;directReturn=true;continue;}
    }
    if(p?.type==='Property'&&p.value===ref&&!p.computed&&key(p)!==undefined){
     const record=parents.get(p),owner=returnedRecordOwner(record);
     if(owner===fn&&returnedRecordFieldDestructured(fn,String(key(p)))){returnsRequest=true;returnedFields.add(String(key(p)));continue;}
     return stop('parameter use:Property');
    }
    if(p?.type==='CallExpression'&&p.arguments.includes(ref)&&p.arguments.filter(argument=>argument===ref).length===1&&!p.arguments.some(argument=>argument.type==='SpreadElement')){
     const position=p.arguments.indexOf(ref),candidates=functionCandidates(p.callee);
     if(!candidates.ok)return stop('forward target');
     for(const candidate of candidates.functions){
      const parameter=candidate.params[position];if(!parameter)continue;
      const nested=parameterProof(bindings.get(parameter.type==='AssignmentPattern'?parameter.left:parameter),seen);
      if(!nested)return stop('forward proof');
      if(nested.returnsRequest&&!ignored(p))return stop('forward return');
      for(const field of nested.read)read.add(field);
      for(const field of nested.write)if(read.has(field))read.add(field);
     }
     continue;
    }
    if(p?.type!=='MemberExpression'||p.object!==ref||property(p)===undefined)return stop('parameter use:'+(p?.type??'none'));
    const field=String(property(p));
    if(['__proto__','prototype','constructor'].includes(field))return stop('parameter prototype:'+field);
    if(q?.type==='MemberExpression'&&q.object===p){
     const nested=property(q),stringMethods=new Set(['replace','replaceAll','trim','trimStart','trimEnd','toLowerCase','toUpperCase','toLocaleLowerCase','toLocaleUpperCase','normalize','padStart','padEnd','repeat','charAt','substring','substr','split','includes','startsWith','endsWith','match','matchAll','search','indexOf','lastIndexOf','slice']);
     if(field==='headers'){
      if(nested!==undefined&&['__proto__','prototype','constructor'].includes(String(nested)))return stop('nested field:'+field);
     }else if(['url','method'].includes(field)&&nested!==undefined&&stringMethods.has(String(nested))&&parents.get(q)?.type==='CallExpression'&&parents.get(q).callee===q){
      // url / method 是宿主保证的字符串字段；只允许原地调用字符串方法。
     }else return stop('nested field:'+field);
     const use=parents.get(q);
     if(use?.type==='AssignmentExpression'&&use.left===q||use?.type==='UpdateExpression'||use?.type==='UnaryExpression'&&use.operator==='delete'||use?.type==='CallExpression'&&use.callee===q&&!['url','method'].includes(field))return stop('nested mutation:'+field);
     read.add(field);continue;
    }
    if(q?.type==='AssignmentExpression'&&q.left===p){if(q.operator!=='=')return stop('compound field:'+field);write.add(field);continue;}
    if(q?.type==='UpdateExpression'||q?.type==='UnaryExpression'&&q.operator==='delete'||q?.type==='CallExpression'&&q.callee===p)return stop('field mutation:'+field);
    read.add(field);
   }
   return {read,write,returnsRequest,directReturn,returnedFields};
  };
  const ignored=call=>{let node=call,parent=parents.get(node);while(parent?.type==='AwaitExpression'||parent?.type==='SequenceExpression'){node=parent;parent=parents.get(node);}return parent?.type==='ExpressionStatement';};
  const directFields=new Set(['url','method','headers','body','bodyBytes']);
  const prototypeFields=new Set(['__proto__','prototype','constructor']);
  // 宿主请求先别名到局部变量时，只允许再次经同一请求参数、同一静态字段的
  // 包装记录解构回写，以及完成投影或静态字段读取，避免宿主对象身份外流。
  const aliasProof=(binding,sourceRef)=>{
   if(!binding||!binding.refs.length)return null;
   const writes=new Set(binding.writes);
   for(const write of binding.writes){
    if(write.type!=='AssignmentExpression'||write.operator!=='='||write.left.type!=='ObjectPattern')return null;
    const fields=write.left.properties.filter(property=>property.type==='Property'&&property.value.type==='Identifier'&&bindings.get(property.value)===binding&&(!property.computed||key(property)!==undefined));
    if(fields.length!==1)return null;
    const field=String(key(fields[0]));
    if(write.right.type!=='AwaitExpression'||write.right.argument.type!=='CallExpression')return null;
    const call=write.right.argument,fn=target(call.callee),same=argument=>argument===sourceRef||sourceRef.type==='Identifier'&&argument?.type==='Identifier'&&argument.name===sourceRef.name&&free(argument,sourceRef.name),position=call.arguments.findIndex(same);
    if(position<0||!returnsArgumentAsField(fn,position,field))return null;
   }
   const fields=new Set();
   for(const ref of binding.refs){
    const p=parents.get(ref);
    let pattern=ref,parent=parents.get(pattern);
    while(parent?.type==='Property'&&parent.value===pattern&&parents.get(parent)?.type==='ObjectPattern'){pattern=parent;parent=parents.get(pattern);}
    if(pattern?.type==='Property'&&parent?.type==='ObjectPattern'){pattern=parent;parent=parents.get(pattern);}
    if(parent?.type==='AssignmentExpression'&&writes.has(parent))continue;
    if(p?.type==='CallExpression'&&p.arguments.filter(argument=>argument===ref).length===1&&!p.arguments.some(argument=>argument.type==='SpreadElement')&&(isDone(p)||target(p.callee)&&complete.has(target(p.callee)))){
     for(const field of ['url','method','headers','body'])fields.add(field);
     continue;
    }
    if(p?.type==='MemberExpression'&&p.object===ref&&property(p)!==undefined&&directFields.has(String(property(p)))){
     const use=parents.get(p);
     if(use?.type==='MemberExpression'||use?.type==='AssignmentExpression'&&use.left===p||use?.type==='UpdateExpression'||use?.type==='UnaryExpression'&&use.operator==='delete'||use?.type==='CallExpression'&&use.callee===p)return null;
     fields.add(String(property(p)));continue;
    }
    return null;
   }
   return fields;
  };
  const reads=new Set(),whole=[],customWrites=[];
  for(const ref of nodes.filter(n=>n.type==='Identifier'&&free(n,'$request'))){
   const p=parents.get(ref);
   // 裸引用只用于保留原有求值/报错时机，不读取也不转交宿主对象。
   if(p?.type==='ExpressionStatement'&&p.expression===ref)continue;
   // 整体请求直接交给已证明的完成包装函数时，完成值本身仍走 shape/payload
   // 的字段投影；这里只把投影需要的只读字段加入快照，不把宿主对象本身放行。
   if(p?.type==='CallExpression'&&p.arguments.includes(ref)&&!p.arguments.some(a=>a.type==='SpreadElement')&&
      (isDone(p)||!customWrites.length&&target(p.callee)&&complete.has(target(p.callee)))){
    for(const field of ['url','method','headers','body'])reads.add(field);
    continue;
   }
   if(p?.type==='VariableDeclarator'&&p.init===ref&&p.id.type==='Identifier'){
    const fields=aliasProof(bindings.get(p.id),ref);
    if(!fields)return stop('request alias');
    for(const field of fields)reads.add(field);
    whole.push(ref);continue;
   }
   if(p?.type==='MemberExpression'&&p.object===ref){
    const field=property(p);
    if(field===undefined||parents.get(p)?.type==='MemberExpression')return stop('direct field:'+(field??'dynamic'));
    const use=parents.get(p);
    if(use?.type==='AssignmentExpression'&&use.left===p){
     // 宿主对象上的自定义字段只在静态键、简单赋值且值不是宿主对象本身时
     // 允许降为本地快照写入；文档字段的写入仍需要单独的数据流证明。
     if(use.operator!=='='||directFields.has(field)||prototypeFields.has(field)||use.right===ref)return stop('direct mutation:'+field);
     customWrites.push(use);reads.add(field);continue;
    }
    if(use?.type==='UpdateExpression'||use?.type==='UnaryExpression'&&use.operator==='delete'||use?.type==='CallExpression'&&use.callee===p)return stop('direct mutation:'+field);
    if(!directFields.has(field)&&!reads.has(field))return stop('direct field:'+field);
    reads.add(field);continue;
   }
   if(p?.type==='CallExpression'&&p.arguments.includes(ref)&&!p.arguments.some(a=>a.type==='SpreadElement')){
    const fn=target(p.callee),position=p.arguments.indexOf(ref),parameter=fn?.params[position];
    if(!functions.has(fn?.type)||!parameter)return stop('whole target:'+(fn?.type??'unknown')+'/'+(p.callee?.type??'unknown'));
    const parameterBinding=bindings.get(parameter.type==='AssignmentPattern'?parameter.left:parameter);
    const proof=parameterProof(parameterBinding);
    if(!proof){
     if(functions.has(p.callee.type)&&inlineHostSnapshotProof(parameterBinding,directFields,{allowDynamicHeaders:true})){for(const field of directFields)reads.add(field);whole.push(ref);continue;}
     return stop('whole proof');
    }
    if(proof.returnsRequest&&!ignored(p)&&(proof.directReturn||!proof.returnedFields.size))return stop('whole proof');
    for(const field of proof.read)reads.add(field);
    for(const field of proof.write)if(reads.has(field))reads.add(field);
    whole.push(ref);continue;
   }
   return stop('whole use:'+(p?.type??'none'));
  }
  if(!whole.length||customWrites.some(write=>whole.some(ref=>write.start>parents.get(ref).start)))return null;
  return reads;
 };
 const hostRequestReads=proveHostRequestSnapshot();
 const proveHostResponseSnapshot=()=>{
  const reboundNames=new Set(hostRebinds.filter(rebind=>rebind.kind==='$response').map(rebind=>rebind.name));
  if(!reboundNames.size)return null;
  const refs=[],closed=[];
  for(const assignment of nodes.filter(node=>node.type==='AssignmentExpression'&&node.operator==='='&&node.left.type==='Identifier'&&reboundNames.has(node.left.name))){
   const awaited=assignment.right.type==='AwaitExpression'?assignment.right.argument:assignment.right;
   if(awaited.type!=='CallExpression'||awaited.arguments.some(argument=>argument.type==='SpreadElement'))return null;
   const passed=awaited.arguments.filter(argument=>argument.type==='Identifier'&&free(argument,'$response'));
   if(passed.length!==1)return null;
   const fn=target(awaited.callee),position=awaited.arguments.indexOf(passed[0]),parameter=fn?.params[position];
   if(!functions.has(awaited.callee.type)||!parameter)fail(passed[0],'宿主响应重绑目标无法证明只访问固定字段');
   const binding=bindings.get(parameter.type==='AssignmentPattern'?parameter.left:parameter);
   if(!inlineHostSnapshotProof(binding,responseSnapshotFields,{allowedWrites:new Set(['body','status'])}))fail(passed[0],'宿主响应重绑后含未闭合字段或调用');
   refs.push(passed[0]);closed.push(binding);
  }
  if(!refs.length)return null;
  // 重绑之外的宿主读取仍可能观察实时对象；此类形态保留原有保守判据。
  const expected=new Set(refs);
  const unexpected=nodes.find(node=>node.type==='Identifier'&&free(node,'$response')&&!expected.has(node)&&!(parents.get(node)?.type==='ExpressionStatement'));
  if(unexpected)fail(unexpected,'宿主响应重绑之外的实时读取无法与本地快照保持一致');
  for(const binding of closed)closedHostResponseSnapshotBindings.add(binding);
  return new Set(responseSnapshotFields);
 };
 const hostResponseReads=proveHostResponseSnapshot();
 if(hostRequestReads){
  hostRequestSnapshot=fresh('hostRequest');
  const headers=`(() => {const value = ${context}.request.headers;if (value && typeof value.entries === 'function') {const result = Object.create(null);for (const [name, headerValue] of value.entries()) {if (result[name] === undefined) result[name] = headerValue;else result[name] = Array.isArray(result[name]) ? [...result[name], headerValue] : [result[name], headerValue];}return result;}return Object.assign(Object.create(null), value ?? {});})()`;
  hostRequestInitializers=[`const ${hostRequestSnapshot} = {${[...hostRequestReads].map(field=>field==='body'?`body: ${readBody('$request','body')}`:field==='bodyBytes'?`bodyBytes: ${readBody('$request','bodyBytes')}`:field==='headers'?`headers: ${headers}`:`${JSON.stringify(field)}: ${context}.request[${JSON.stringify(field)}]`).join(', ')}};`];
 }
 if(hostResponseReads){
  hostResponseSnapshot=fresh('hostResponse');
  const headers=`(() => {const value = ${context}.response?.headers;if (value && typeof value.entries === 'function') {const result = {};for (const [name, headerValue] of value.entries()) {if (result[name] === undefined) result[name] = headerValue;else result[name] = Array.isArray(result[name]) ? [...result[name], headerValue] : [result[name], headerValue];}return result;}return {...(value ?? {})};})()`;
  const raw=`${context}.response`;
  hostResponseInitializers=[`const ${hostResponseSnapshot} = ${raw} == null ? null : {status: ${raw}.status, statusCode: ${raw}.status, headers: ${headers}, body: ${readBody('$response','body')}, bodyBytes: ${readBody('$response','bodyBytes')}, ok: /^2\\d\\d$/.test(String(${raw}.status)), statusText: ${raw}.statusText ?? ''};`];
 }
 // Only attribution/legal information joins the generated native usage header.
 // Code-local business comments remain in place for readable source layouts.
 const leadingEnd=tree.body[0]?.start??source.length;
 let documentation=copyrightDocumentation(comments.filter(c=>c.end<=leadingEnd).map(c=>c.value).join('\n\n'));
 let body;
 if(structured){
  const flow=structuredFlow({source,tree,ix,context,fresh,api:emit,payload,isDone,compressionMethod,extraAfter,substitutions:generated,
   callTarget:target,isPromiseCall:n=>factoryPromises.has(n),isHTTP:n=>n?.type==='CallExpression'&&!!clientMethod(n.callee),httpStatement:callback,
   replyPrelude:fn=>{const info=[...httpReplies.values()].find(x=>x.fn===fn);return info?replyPrelude(info,fn.params[0].name):'';}});
  prefix.push(flow.prefix);body=flow.body;
 }else body=render(tree).slice(leadingEnd)+(pending?'\nif ('+pendingResult+' !== undefined) return await '+pendingResult+';':'');
 const reads=[];
 for(const type of ['request','response']){
  const a=bodyReads.get(type+':body'),b=bodyReads.get(type+':bodyBytes');if(!a&&!b)continue;
  const msg=`${context}.${type}`,buffer=fresh(type+'Buffer'),declaration=bodyWrites.has(type+':body')?'let':'const';
  if(b||options.binary){reads.push(`const ${buffer} = ${msg}?.body == null ? undefined : await ${msg}.arrayBuffer();`);if(b)reads.push(`const ${b} = ${buffer} === undefined ? undefined : ${folded.qx?'':`new Uint8Array(`}${buffer}${folded.qx?'':')'};`);if(a)reads.push(`${declaration} ${a} = ${buffer} === undefined ? undefined : ${options.binary&&!folded.qx?`new Uint8Array(${buffer})`:`new TextDecoder().decode(${buffer})`};`);}
  else reads.push(`${declaration} ${a} = ${msg}?.body == null ? undefined : await ${msg}.text();`);
 }
 if(hostRequestSnapshot)reads.push(...hostRequestInitializers);
 if(hostResponseSnapshot)reads.push(...hostResponseInitializers);
 const guard=options.enabled_env?`if (${context}.env._hub_enabled === 'false') return;\n`:'';
 // Egern scheduled scripts may finish by returning from the default function;
 // HTTP, response, and generic entries still need a proven completion value.
 const missingCompletion=scheduledOnly?'':'throw new Error("Script ended without a completion result");\n';
 const code=`${referenceError?`const ${referenceError} = globalThis.ReferenceError;\n`:''}export default async function(${context}) {\n${guard}${[...prefix,...reads].join('\n')}${prefix.length||reads.length?'\n':''}${body}\n${missingCompletion}}\n`;
 const check=parse(code,{ecmaVersion:'latest',sourceType:'module'}),final=index(check);
 const leftovers=final.nodes.filter(n=>final.free(n)&&n.name.startsWith('$'));
 if(leftovers.length)throw Error('转换结果残留平台 API：'+[...new Set(leftovers.map(n=>n.name))].join(', '));
 let formatted;
 if(singleLineSource(options.layout_source??original)){
  const compact=compactNative(code);formatted=compact.code;
  documentation=copyrightDocumentation([documentation,...compact.comments].filter(Boolean).join('\n\n'));
 }else formatted=formatNative(code);
 formatted=libraries.restore(formatted);
 const restored=index(parse(formatted,{ecmaVersion:'latest',sourceType:'module'}));
 if(restored.nodes.some(n=>restored.free(n)&&n.name.startsWith('$')))throw Error('公共库恢复后残留平台 API');
 return {errors:[],code:formatted,documentation,apis:report.apis,asynchronous:report.asynchronous||lifted.size>0,mode:'native',libraries:libraries.blocks,device_type_parameter:device.deviceParameter,verification_format:pipeline.verificationFormat};
}

function lowerCompressionFallbacks(source){
 const comments=[],tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true,onComment:comments}),ix=index(tree),replace=new WeakMap(),transformations=[];let changed=false;
 const {nodes,parents,bindings,free}=ix;
 // 平台类型表已证明 $utils 是对象，压缩成员也由后续原生投影提供。因此这类
 // 能力守卫在目标宿主恒真，分支中的非恒等回退不可达，可以安全删除。只接受
 // 由平台对象类型和已映射压缩成员探测组成的 && 合取；未知探测、||、动态成员
 // 或局部同名绑定都必须保留原文并继续走失败关闭路径。
 const guarded=(test,name)=>{
  if(test?.type==='LogicalExpression'){
   if(test.operator!=='&&')return null;
   const left=guarded(test.left,name),right=guarded(test.right,name);
   return left&&right?{probe:left.probe||right.probe}:null;
  }
  if(test?.type!=='BinaryExpression'||!['===','=='].includes(test.operator))return null;
  const type=test.left?.type==='UnaryExpression'&&test.left.operator==='typeof'?test.left:test.right?.type==='UnaryExpression'&&test.right.operator==='typeof'?test.right:null;
  const value=type===test.left?test.right:test.left,argument=type?.argument?.type==='ChainExpression'?type.argument.expression:type?.argument;
  if(value?.type!=='Literal')return null;
  if(value.value==='object'&&free(argument,'$utils'))return {probe:false};
  if(value.value==='function'&&argument?.type==='MemberExpression'&&free(argument.object,'$utils')&&property(argument)===name)return {probe:true};
  return null;
 };
 for(const n of nodes){
  if(n.type!=='ConditionalExpression'||comments.some(c=>c.start>=n.start&&c.end<=n.end))continue;
  const yes=n.consequent.type==='MemberExpression'&&free(n.consequent.object,'$utils')?property(n.consequent):null;
  const no=n.alternate.type==='MemberExpression'&&free(n.alternate.object,'$utils')?property(n.alternate):null;
  const name=yes??no;
  if(!['ungzip'].includes(name)||!guarded(n.test,name)?.probe)continue;
  const declaration=parents.get(n),binding=declaration?.type==='VariableDeclarator'&&declaration.init===n&&declaration.id.type==='Identifier'?bindings.get(declaration.id):null;
  if(!binding||binding.writes.length||!binding.refs.length||binding.refs.some(ref=>{const call=parents.get(ref);return call?.type!=='CallExpression'||call.callee!==ref||call.optional||call.arguments.some(a=>a.type==='SpreadElement');}))continue;
  replace.set(n,`$utils.${name}`);changed=true;
  transformations.push({kind:'native-compression-fallback',line:source.slice(0,n.start).split('\n').length,api:name,reason:'将平台能力守卫恒真的可选压缩函数与不可达回退映射为 Egern 原生压缩 API'});
 }
 return {source:changed?renderTree(source,tree,n=>replace.has(n)?{direct:true,value:replace.get(n)}:null):source,transformations};
}
