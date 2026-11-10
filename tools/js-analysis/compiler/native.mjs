import {pathSetterField,lowerHTTPHelpers,lowerHTTPDelegates,lowerHTTPFactoryFields,httpFactoryPromiseCalls,lowerNodeRequestClient,lowerClosedHTTP,lowerSelectedHTTP} from '../http/requests.mjs';
import {parse,withSyntaxCache} from '../core/syntax.mjs';
import {analyze} from '../analysis/analyze.mjs';
import {rewriteUsageComments,copyrightDocumentation,formatNative,compactNative,singleLineSource} from '../output/source.mjs';
import {lowerClients,lowerMagic,lowerDevice,lowerPipeline} from '../platform/clients.mjs';
import {structuredFlow,completionStatements,pendingCompletion} from './flow.mjs';
import {simplify} from '../transforms/simplify.mjs';
import {lowerEnv,foldTargetEnvironments,pruneTargetEnvironments,lowerClosedEnv,lowerExtendedClosedEnv,normalizePrototypeEnv,foldMultiPlatformProbes,pruneUnusedEnvMethods} from '../platform/environment.mjs';
import {specializeParameters,normalizeRecordParameters,lowerMessageParameters,lowerClosedMessageObjects,lowerClosedAccessors,specializeCallbacks,lowerClosedReceiverArguments,lowerFiniteMethodCalls,lowerFunctionDispatch,lowerSloppyThis} from '../transforms/specialization.mjs';
import {foldFactoryProbes,platformFold,lowerAPIObjectAliases,lowerQualifiedPlatformGlobals,lowerSelfNormalizedArgument,lowerDirectGlobalPlatformReceivers,assertSafeMissingGlobalProbes} from '../platform/globals.mjs';
import {pruneGeneratedFunctions,lowerStatefulFactories,lowerLegacyFactories,lowerGlobalMessages,lowerImplicitInstances} from '../transforms/factories.mjs';
import {protectLibraries,lowerDetachedGlobalObjectAliases} from '../analysis/libraries.mjs';
import {functions,property,key,children,index,patch,renderTree,initializedAfter,isolatedSwitchCase,closedMethodCallers} from '../core/ast.mjs';
import {valueFacts} from '../analysis/values.mjs';
import {lowerFunctionConstructorSource,lowerStringTables,lowerLiteralStringTables,lowerObfuscatedTables} from '../transforms/decoding.mjs';
import {checkNativeEvaluation} from '../transforms/evaluation.mjs';

// Compile legacy HTTP scripts to direct Egern APIs. No runtime bridge is emitted.
// Upstream code is parsed, never evaluated. Unprovable control flow is rejected.
export function native(source,format='surge',options={}){
 return withSyntaxCache(()=>compileNative(source,format,options));
}
function compileNative(source,format,options){
 let libraries;
 try{
  // Reveal a closed, data-only Function-constructor shell before identifying
  // embedded libraries. No input body is evaluated during this reduction.
  const functionSource=lowerFunctionConstructorSource(source);
  libraries=protectLibraries(functionSource.source);
  const numbers=normalizeLegacyNumbers(libraries.source),literalTables=lowerLiteralStringTables(numbers.source),obfuscated=lowerObfuscatedTables(literalTables.source),decoded=lowerStringTables(obfuscated.source),envNormalized=normalizePrototypeEnv(decoded.source),probesFolded=pruneUnusedEnvMethods(simplify(foldMultiPlatformProbes(envNormalized.source).source)),scopeThis=lowerSloppyThis(typeof probesFolded==='string'?probesFolded:probesFolded.source),nodeRequest=lowerNodeRequestClient(scopeThis.source),dispatch=nodeRequest.source.includes('eval')?lowerFunctionDispatch(nodeRequest.source):{source:nodeRequest.source,transformations:[],rejected:[]};
  if(dispatch.rejected.length)throw Error('无法证明动态 eval 函数分派的目标：'+dispatch.rejected.map(item=>'第 '+item.line+' 行').join('、')+'；仅支持封闭且不可变的函数名集合');
  const evaluation=checkNativeEvaluation(dispatch.source),device=lowerDevice(dispatch.source);
  libraries.source=device.source;libraries.transformations=[];
  return {...compile(functionSource.source,format,{...options,device,allowNoCompletion:!!probesFolded?.completionRemoved,sloppyThis:{global:scopeThis.globalName,helper:scopeThis.helperName}},libraries),native_evaluation:evaluation,
   static_transformations:[...functionSource.transformations,...numbers.transformations,...literalTables.transformations,...obfuscated.transformations,...decoded.transformations,...scopeThis.transformations,...nodeRequest.transformations,...dispatch.transformations,...libraries.transformations]};
 }catch(e){return {errors:[e.message],code:null,libraries:libraries?.blocks??[]};}
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
  const factories=lowerHTTPFactoryFields(lowerHTTPHelpers(lowerSelectedHTTP(lowerAPIObjectAliases(normalizedArgument))),format);
  const messageSource=lowerMessageParameters(factories.source);
  const closedSource=lowerClosedMessageObjects(messageSource);
  const result=emitNative(closedSource,original,format,options,libraries,{pipeline,bundled,device,folded,generatedFunctions,factorySignatures:factories.signatures});
  libraries.transformations.push(...factories.transformations);return result;
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
 const equivalentParameter=(node,fn,position)=>{
  if(node?.type!=='Identifier')return false;
  const expected=fn.params[position];
  if(expected?.type!=='Identifier')return false;
  const binding=bindings.get(node);
  return !!binding&&binding===bindings.get(expected)&&!binding.writes.length;
 };
 // 这些宿主值在直接调用位置都有确定语义。只有转发器被证明恰好执行一次
 // 直接调用时，才能把值参数还原成同一调用位置的直接调用。
 const platformValues=new Set(['$done','$notify','setTimeout']);
 const isPlatformValue=node=>node.type==='Identifier'&&platformValues.has(node.name)&&free(node,node.name);
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
  if(fn.async||fn.generator||fn.params.length!==call.arguments.length)continue;
  const apiParam=fn.params[0];if(apiParam.type!=='Identifier')continue;
  const apiBinding=bindings.get(apiParam);
  if(!apiBinding||apiBinding.writes.length)continue;
  const returned=fn.body.type==='BlockStatement'
   ?fn.body.body.length===1&&fn.body.body[0].type==='ReturnStatement'?fn.body.body[0].argument:null
   :fn.body;
  if(returned?.type!=='CallExpression'||returned.optional)continue;
  if(returned.callee.type!=='Identifier'||bindings.get(returned.callee)!==apiBinding)continue;
  const refs=apiBinding.refs;
  if(refs.length!==1||refs[0]!==returned.callee)continue;
  const forwarded=call.arguments.slice(1);
  if(returned.arguments.length!==forwarded.length)continue;
  if(!returned.arguments.every((arg,index)=>equivalentParameter(arg,fn,index+1)))continue;
  // 转发器只能做这一次直接调用；出现 this/arguments 或其他语句即拒绝。
  if(nodes.some(n=>n.start>=fn.start&&n.end<=fn.end&&(n.type==='ThisExpression'||n.type==='Identifier'&&n.name==='arguments'&&!bindings.has(n))))continue;
  const replacement=api+'('+forwarded.map(arg=>source.slice(arg.start,arg.end)).join(', ')+')';
  edits.push({start:call.start,end:call.end,replacement,api});
 }
 if(!edits.length)return {source,transformations:[]};
 let output=source;
 for(const edit of edits.sort((a,b)=>b.start-a.start))output=output.slice(0,edit.start)+edit.replacement+output.slice(edit.end);
 return {source:output,transformations:edits.map(({api})=>({kind:'direct-platform-value-forwarder',api}))};
}
function emitNative(source,original,format,options,libraries,{pipeline,bundled,device,folded,generatedFunctions,factorySignatures}){
 const compressionFallback=lowerCompressionFallbacks(source);
 source=compressionFallback.source;
 libraries.transformations.push(...compressionFallback.transformations);
 const forwarders=lowerDirectPlatformForwarders(source);
 source=forwarders.source;
 libraries.transformations.push(...forwarders.transformations);
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
 const complete=new Set(),asyncFns=new Set([tree]),lifted=new Set(),httpReplies=new Map(),extraAfter=new WeakMap(),bodyReads=new Map(),bodyWrites=new Set(),prefix=[],dynamicMethods=new WeakMap();
 const generated=new WeakMap(),fieldValues=new WeakMap(),optionalHTTPFields=new WeakSet();
 if(options.sloppyThis?.helper)prefix.push(`const ${options.sloppyThis.global} = globalThis;function ${options.sloppyThis.helper}(value){return value == null ? ${options.sloppyThis.global} : value;}`);
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
 const strictImplicit=new Set();
 if(implicitGroups.size){
  const input=index(parse(libraries.source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}));
  for(const n of input.nodes)if(input.free(n)&&implicitGroups.has(n.name)&&input.parents.get(n)?.type==='AssignmentExpression'&&input.parents.get(n).left===n){
   for(let p=n;p;p=input.parents.get(p))if(['ClassDeclaration','ClassExpression'].includes(p.type)||(p.type==='Program'?p.body:p.body?.body)?.some(s=>s.directive==='use strict')){strictImplicit.add(n.name);break;}
  }
 }
 for(const [name,writes]of implicitGroups){
  if(strictImplicit.has(name))continue; // Preserve strict JavaScript ReferenceError/global-binding semantics verbatim.
  for(const n of writes)for(let scope=owners.get(n);scope;scope=owners.get(parents.get(scope))){
   if((scope.type==='Program'?scope.body:scope.body?.body)?.some(s=>s.directive==='use strict'))fail(n,'严格脚本中的隐式全局赋值不能局部化');
   if(scope===tree)break;
  }
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
  if(guardedImplicit.has(name)&&uses.some(n=>{
   let callee=n;while(parents.get(callee)?.type==='MemberExpression'&&parents.get(callee).object===callee)callee=parents.get(callee);
   return parents.get(callee)?.type==='CallExpression'&&parents.get(callee).callee===callee;
  }))fail(writes[0],'条件初始化的隐式全局调用尚未确定函数与完成结果契约');
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
 function target(n,seen=new Set()){
  if(functions.has(n?.type))return n;
  if(n?.type==='Identifier'){const b=bindings.get(n);if(b&&!b.writes.length&&!seen.has(b)){seen.add(b);if(b.fn||b.init)return b.fn??target(b.init,seen);
   for(const fn of nodes.filter(n=>functions.has(n.type))){const position=fn.params.findIndex(p=>bindings.get(p.type==='AssignmentPattern'?p.left:p)===b);if(position<0)continue;
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
   const cls=classOf(obj);
   if(cls&&!cls.superClass&&immutableClass(cls)){
    const method=cls.body.body.find(m=>m.type==='MethodDefinition'&&key(m)===property(n)&&m.kind==='method'&&m.static===(obj.type!=='NewExpression'&&obj.type!=='ThisExpression'));
    return method?.value??null;
   }
  }
  return null;
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
  if(method?.type!=='MethodDefinition')return null;
  const cls=parents.get(parents.get(method)),name=key(method);
  if(!cls||!immutableClass(cls))return null;
  const calls=nodes.filter(c=>{
   if(c.type!=='CallExpression'||c.optional||c.callee.type!=='MemberExpression'||c.callee.optional||property(c.callee)!==name||c.arguments.some(a=>a.type==='SpreadElement'))return false;
   const receiver=resolve(c.callee.object),classReceiver=['ClassExpression','ClassDeclaration'].includes(receiver?.type);
   if(classOf(receiver)===cls&&method.static===classReceiver)return true;
   if(method.static||c.callee.object.type!=='ThisExpression')return false;
   const owner=owners.get(c.callee.object),ownerMethod=parents.get(owner);
   return ownerMethod?.type==='MethodDefinition'&&!ownerMethod.static&&parents.get(parents.get(ownerMethod))===cls;
  });
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
  if(n?.type==='Identifier'){const b=bindings.get(n);if(b?.init&&!b.writes.length&&!seen.has(b)){seen.add(b);return clientMethod(b.init,seen);}}
  if(n?.type==='LogicalExpression'&&n.operator==='||')return clientMethod(n.left,new Set(seen));
  return null;
 }
 function terminal(n){
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
 let changed=true;while(changed){changed=false;for(const n of nodes)if(n.type==='CallExpression'){
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
  if(functions.has(n.type)&&complete.has(n)){
   const p=parents.get(n);
   if(p?.type==='CallExpression'&&p.callee!==n){const m=p.callee.type==='MemberExpression'?property(p.callee):null;if(!['then','catch'].includes(m)&&!clientMethod(p.callee)&&!closedCompletionCallback(p,n))fail(n,'完成函数作为回调传递，无法证明全局终止流程');}
   if(p?.type==='NewExpression')fail(n,'Promise 执行器中的完成操作不能直接改写为 return');
  }
  if(n.type==='CallExpression'&&terminal(n)){
   const p=parents.get(n);
   if(!['ExpressionStatement','ReturnStatement','ArrowFunctionExpression'].includes(p?.type)&&!(p?.type==='AwaitExpression'&&['ExpressionStatement','ReturnStatement'].includes(parents.get(p)?.type))&&!(p?.type==='MemberExpression'&&['then','catch'].includes(property(p)))&&!(p?.type==='CallExpression'&&free(p.callee,'setTimeout')&&p.arguments[0]===n&&terminal(p))&&!terminalConditional(n))fail(n,'完成操作嵌入表达式，无法证明返回值传播');
  }
  if(isAPI(n,'$task','fetch')){
   const p=parents.get(n),gp=parents.get(p);
   if(!(p?.type==='AwaitExpression'&&(gp?.type==='VariableDeclarator'&&gp.id.type==='Identifier'||gp?.type==='ExpressionStatement'))&&!(p?.type==='MemberExpression'&&property(p)==='then'))fail(n,'HTTP 响应必须保存到局部变量或在 then 回调中读取，不能隐式模拟旧响应对象');
  }
 }
 }
 function resolve(n,seen=new Set()){
  if(fieldValues.has(n))return resolve(fieldValues.get(n),seen);
  if(n?.type!=='Identifier')return n;
  const b=bindings.get(n);if(b?.init&&!b.writes.length&&!seen.has(b)){seen.add(b);return resolve(b.init,seen);}return n;
 }
 function object(n,label){
  const b=n?.type==='Identifier'?bindings.get(n):null;
  if(b)for(const ref of b.refs){const p=parents.get(ref),a=parents.get(p);if(p?.type==='MemberExpression'&&p.object===ref&&(a?.type==='AssignmentExpression'&&a.left===p||a?.type==='UpdateExpression'||a?.type==='UnaryExpression'&&a.operator==='delete'))fail(p,label+' 在声明后被修改，需要先确定字段的数据流');}
  n=resolve(n);if(n?.type!=='ObjectExpression')fail(n??tree,label+' 必须是可静态追溯的对象');
  const fields=new Map();for(const p of n.properties){if(p.type!=='Property'||p.kind!=='init'||p.computed&&key(p)===undefined)fail(p,label+' 含动态字段或展开，无法证明可原生转换');fields.set(String(key(p)),p.value);}return fields;
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
   if(incoming.nullable)fields.nullable=true;
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
   if(!argument||argument.type==='Literal'&&argument.value===null||argument.type==='UnaryExpression'&&argument.operator==='void'){fields.nullable=true;continue;}
   const value=shape(argument,next);
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
  if(!call||call.type!=='CallExpression'||call.callee.type!=='MemberExpression'||!free(call.callee.object,'$httpClient')||!call.arguments.includes(fn))return null;
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
 function shape(n,seen=new Set()){
  if(!n)return new Map();
  if(n.type==='AwaitExpression')return promiseShape(n.argument,seen)??shape(n.argument,seen);
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
   const b=bindings.get(n);if(!b||seen.has(b))fail(n,'无法静态追溯完成结果');seen.add(b);
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
    for(const w of relevantWrites){
     if(w.type!=='AssignmentExpression'||w.operator!=='=')fail(n,'完成结果变量被重新赋值，无法确定字段');
     mergeShape(fields,shape(w.right,new Set(seen)),seen);
    }
    if(fields.nullable){
     if(!completionTruthyGuard(n,b))fail(n,'完成结果可能为空，无法证明完成调用位于同一真值分支');
     fields.nullable=false;
    }
    for(const ref of b.refs){
     if(ref.start>=n.start)continue;
     const p=parents.get(ref),a=parents.get(p);
     // 绑定自身的重新赋值由上面的 relevantWrites 统一求形，不再按逃逸处理。
     if(p?.type==='AssignmentExpression'&&p.left===ref&&p.operator==='=')continue;
     if(p?.type==='MemberExpression'&&p.object===ref){
      if(property(p)===undefined)fail(p,'完成结果包含动态字段');
      if(a?.type==='UnaryExpression'&&a.operator==='delete'&&a.argument===p)fail(p,'完成结果字段被直接删除，需要先确定完成结果的数据流');
      if(a?.type==='AssignmentExpression'&&a.left===p)mergeShape(fields,new Map([[property(p),a.right]]),seen);
     }else if(p?.type==='IfStatement'&&p.test===ref&&b.refs.some(other=>completionTruthyGuard(other,b)===ref))continue;
      else if(p?.type==='UnaryExpression'&&p.operator==='typeof')continue;
     else if(p?.type==='LogicalExpression'&&['||','??'].includes(p.operator)&&p.left===ref&&p.right.type==='AssignmentExpression'&&p.right.left.type==='Identifier'&&bindings.get(p.right.left)===b)continue;
     else if(!(p?.type==='CallExpression'&&isDone(p))&&!(p?.type==='CallExpression'&&target(p.callee)&&complete.has(target(p.callee))))fail(ref,'可变完成结果对象逃逸，无法确定字段');
    }
    return fields;
   }
   if(b.init){
    const fields=shape(b.init,seen);
    if(fields.nullable){
     if(!completionTruthyGuard(n,b))fail(n,'完成结果可能为空，无法证明完成调用位于同一真值分支');
     fields.nullable=false;
    }
    for(const ref of b.refs){
     const p=parents.get(ref),a=parents.get(p);
     if(p?.type==='MemberExpression'&&p.object===ref){
      if(property(p)===undefined)fail(p,'完成结果包含动态字段');
      if(a?.type==='UnaryExpression'&&a.operator==='delete'&&a.argument===p)fail(p,'完成结果字段被直接删除，需要先确定完成结果的数据流');
      if(a?.type==='AssignmentExpression'&&a.left===p)mergeShape(fields,new Map([[property(p),a.right]]),seen);
     }else if(p?.type==='IfStatement'&&p.test===ref&&b.refs.some(other=>completionTruthyGuard(other,b)===ref))continue;
      else if(p?.type==='UnaryExpression'&&p.operator==='typeof')continue;
     else if(!(p?.type==='CallExpression'&&isDone(p))&&!(p?.type==='CallExpression'&&target(p.callee)&&complete.has(target(p.callee))))fail(ref,'完成结果对象逃逸，无法追溯所有字段修改');
    }
    return fields;
   }
   // A forwarding parameter can be resolved from every direct caller.
   let fn=null,param=-1;for(const f of nodes)if(functions.has(f.type)){const i=f.params.findIndex(p=>bindings.get(p.type==='AssignmentPattern'?p.left:p)===b);if(i>=0){fn=f;param=i;break;}}
   if(fn){const calls=nodes.filter(c=>c.type==='CallExpression'&&target(c.callee)===fn);if(calls.length){const all=new Map();for(const c of calls){const argument=c.arguments[param],parameter=fn.params[param],fallback=parameter.type==='AssignmentPattern'?parameter.right:undefined;mergeShape(all,shape(!argument||free(argument,'undefined')?fallback:argument,new Set(seen)),seen);} return all;}}
  }
  if(n.type==='CallExpression'&&n.callee.type==='Identifier'){
   const fn=target(n.callee);
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
  if(!reference&&free(n,'$response')){
   if(bodyWrites.has('response:body'))fail(n,'响应正文重绑后不能整体传递响应对象，无法证明状态与头部更新');
   if(nested)fail(n,'响应对象不能嵌套为请求阶段的合成响应');
   if(format==='qx')fail(n,'QX 整体响应的 statusCode/bodyBytes 字段需要显式映射');
   const body=readBody('$response','body');
   return `(${context}.response ? {status: ${context}.response.status, headers: ${body} === undefined ? ${context}.response.headers : ${cleanHeaders(context+'.response.headers')}, body: ${body}} : {})`;
  }
  const fields=provenFields??shape(n);for(const k of fields.keys())if(!['url','method','headers','body','bodyBytes','status','response','abort'].includes(k))fail(n,'不支持的完成字段：'+k);
  if(fields.nullable){
   // 被调函数返回 null 时，`$done(value())` 等价于不修改消息；只有所有非空
   // 返回分支都具备封闭完成形状时才成立。这里只求值一次，其余可空形态仍拒绝。
   if(reference||!fields.size)fail(n,'完成结果可能为空，不能映射为固定字段');
   const value=fresh('completionValue');
   return `((${value}) => ${value} == null ? {} : ${payload(n,false,value,new Map(fields))})(${render(n)})`;
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
  if(fields.has('body')&&fields.has('bodyBytes'))fail(n,'body 与 bodyBytes 冲突');
  let text,evaluate;
  if(!n)text='{}';
  else if(!reference&&n.type==='ObjectExpression'){
   const out=[];for(const [k,v]of fields){let val=k==='bodyBytes'?bytes(v):k==='body'?bodyValue(v):k==='status'?status(v):render(v);if(k==='headers'&&(fields.has('body')||fields.has('bodyBytes')))val=cleanHeaders(val);out.push(`${k==='bodyBytes'?'body':k}: ${val}`);}text='{'+out.join(', ')+'}';
  }else{
   // Copy only statically proven fields, preserving branches where a field is absent.
   const input=reference??render(n),value=reference||n.type==='Identifier'?input:fresh('completionValue'),out=[];for(const [k,v]of fields){let val=k==='bodyBytes'?bytesText(value+'.bodyBytes'):`${value}.${k}`;if(k==='status')val=nativeStatus(`${value}.status`);if(k==='headers'&&(fields.has('body')||fields.has('bodyBytes')))val=`${value}.body === undefined && ${value}.bodyBytes === undefined ? ${value}.headers : ${cleanHeaders(value+'.headers')}`;out.push(`...(${value}.${k} === undefined ? {} : {${k==='bodyBytes'?'body':k}: ${val}})`);}text='{'+out.join(', ')+'}';
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
    const mutable=returned??notificationFields(a[3])??(scalarNotificationOption(a[3])?{fields:new Map(),optional:new Set(),nullable:true,stringUrl:true}:null);
    if(mutable?.stringUrl)out.push(`...(typeof ${argument(3)} === 'string' ? {action: {type: 'openUrl', url: ${argument(3)}}} : {})`);
    const f=mutable?.fields??object(a[3],'通知参数'),allowed=['url','openUrl','open-url','action','text','update-pasteboard','mediaUrl','media-url','media-base64','media-base64-mime','sound'];
    const value=k=>captured?`${argument(3)}${mutable?.nullable?'?.':''}[${JSON.stringify(k)}]`:render(f.get(k));
    const add=(k,text)=>out.push(`...(${mutable?.nullable?`${argument(3)} != null && `:''}${mutable?.optional.has(k)?`Object.hasOwn(${argument(3)}, ${JSON.stringify(k)}) && `:''}${value(k)} !== undefined ? {${text}} : {})`);
    for(const k of f.keys())if(!allowed.includes(k))fail(a[3],'未适配通知字段：'+k);
    if(mutable?.returnedRecord){
     const optionsName=fresh('notificationSourceOptions'),resultName=fresh('notificationNativeOptions'),urlName=fresh('notificationSourceUrl'),mediaUrlName=fresh('notificationMediaUrl'),base64Name=fresh('notificationMediaBase64'),mimeName=fresh('notificationMediaMime');
     const statements=[`const ${resultName} = {};`,`const ${urlName} = ${optionsName}?.url ?? ${optionsName}?.openUrl ?? ${optionsName}?.["open-url"];`,`if (${optionsName}?.action === "clipboard") { if (${optionsName}?.text !== undefined) ${resultName}.action = {type: "clipboard", text: ${optionsName}.text}; } else if (${urlName} !== undefined) ${resultName}.action = {type: "openUrl", url: ${urlName}};`,`const ${mediaUrlName} = ${optionsName}?.["media-url"] ?? ${optionsName}?.mediaUrl;`,`if (${mediaUrlName} !== undefined) ${resultName}.attachment = {url: ${mediaUrlName}}; else { const ${base64Name} = ${optionsName}?.["media-base64"]; if (${base64Name} !== undefined) { const ${mimeName} = ${optionsName}?.["media-base64-mime"]; if (${mimeName} === undefined) throw new Error("Base64 notification attachment requires MIME type"); ${resultName}.attachment = {base64: ${base64Name}, mimeType: ${mimeName}}; } }`,`if (${optionsName}?.sound !== undefined) { if (typeof ${optionsName}.sound !== "boolean") throw new TypeError("Notification sound must be boolean"); ${resultName}.sound = ${optionsName}.sound; }`,`return ${resultName};`];
     out.push(`...(((${optionsName}) => {${statements.join(' ')}})(${argument(3)}))`);
    }else{
    const urls=['url','openUrl','open-url'].filter(k=>f.has(k));if(urls.length>1)fail(a[3],'通知 URL 字段冲突');
    const url=urls.length?f.get(urls[0]):null,clip=f.get('update-pasteboard')??(resolve(f.get('action'))?.value==='clipboard'?f.get('text'):null);
    if(url&&clip)fail(a[3],'通知操作冲突');
    if(url)add(urls[0],`action: {type: 'openUrl', url: ${value(urls[0])}}`);else if(clip){if(mutable)fail(a[3],'可变剪贴板通知参数尚无确定的操作分支');const k=f.has('update-pasteboard')?'update-pasteboard':'text';add(k,`action: {type: 'clipboard', text: ${value(k)}}`);}else if(f.has('action')||f.has('text'))fail(a[3],'通知操作不完整');
    const media=f.get('mediaUrl')??f.get('media-url');if(media&&f.has('media-base64'))fail(a[3],'通知附件冲突');
    if(media){const k=f.has('mediaUrl')?'mediaUrl':'media-url';add(k,`attachment: {url: ${value(k)}}`);}
    if(f.has('media-base64')){if(!f.has('media-base64-mime'))fail(a[3],'Base64 附件需要 MIME');add('media-base64',`attachment: {base64: ${value('media-base64')}, mimeType: ${value('media-base64-mime')}}`);}
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
  if([...fields.keys()].some(k=>!['url','openUrl','open-url','action','text','update-pasteboard','mediaUrl','media-url','media-base64','media-base64-mime','sound'].includes(k)))return null;
  return {fields,optional:new Set([...fields.keys()].filter(k=>required.some(s=>!s.has(k)))),nullable:true,stringUrl,returnedRecord:true};
 }
 function notificationFields(ref){
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
   if(q?.type==='AssignmentExpression'&&q.left===p&&q.operator==='='){writes.push(p);continue;}
   return null; // No aliases, deletes, accessors, dynamic keys or unknown calls.
  }
  if(!writes.length)return null;
  const fields=new Map();
  for(const p of initial.properties){if(p.type!=='Property'||p.kind!=='init'||key(p)===undefined||key(p)==='__proto__')return null;fields.set(key(p),p.value);}
  const optional=new Set();
  for(const member of writes){const k=property(member);if(k==='__proto__')return null;if(!fields.has(k))optional.add(k);fields.set(k,parents.get(member).right);}
  if([...fields.keys()].some(k=>!['url','openUrl','open-url','mediaUrl','media-url'].includes(k)))return null;
  return {fields,optional};
 }
 function http(input,method,qx){
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
   f=forwardedHTTPFields(input);
   // 闭合的本地请求对象：字段可静态枚举、唯一派发、且只允许"派发前的 url 追加"这一种
   // 变异，其它变异或派发后的写入仍然拒绝。走与 $argument 相同的实时字段路径，发送时
   // 读取更新后的 url，不把 += 折叠成表达式。
   const liveLocalRequest=()=>{
    if(input?.type!=='Identifier')return false;
    const binding=bindings.get(input);
    if(!binding||!binding.init||binding.writes.length)return false;
    const base=resolve(input);
    if(base?.type!=='ObjectExpression')return false;
    const fields=['url','headers','header','body','bodyBytes','timeout','policy','policy-descriptor','node','params','auto-redirect','auto-cookie','insecure','binary-mode','full-header-mode'];
    for(const property of base.properties){
     if(property.type!=='Property'||property.kind!=='init'||property.method||key(property)===undefined||!fields.includes(String(key(property))))return false;
    }
    const dispatches=binding.refs.filter(ref=>{const call=parents.get(ref);return call?.type==='CallExpression'&&call.arguments.includes(ref)&&call.callee.type==='MemberExpression'&&free(call.callee.object,'$httpClient');});
    if(dispatches.length!==1)return false;
    const dispatch=dispatches[0];
    for(const ref of binding.refs){
     const p=parents.get(ref),q=parents.get(p);
     if(p===dispatch)continue;
     if(p?.type!=='MemberExpression'||p.object!==ref||property(p)===undefined)return false;
     const field=String(property(p));
     if(!fields.includes(field))return false;
     if(q?.type==='AssignmentExpression'&&q.left===p){
      if(q.operator!=='+='||field!=='url')return false;
      if(owners.get(q)!==owners.get(dispatch)||!(q.end<dispatch.start))return false;
      continue;
     }
     if(q?.type==='UpdateExpression'||q?.type==='UnaryExpression'&&q.operator==='delete')return false;
     if(q?.type==='AssignmentExpression')return false;
    }
    return true;
   };
   if(!f&&(free(input,'$argument')||liveLocalRequest())&&!qx){
    // 静的可见记录不允许把传输标志留到运行期判断：只能静态证明未启用才放行。
    // $argument 派生记录本身是运行期输入，沿用既有运行期守卫，不在本单元改动范围内。
    if(!free(input,'$argument')){
     const visible=resolve(input);
     if(visible?.type==='ObjectExpression')for(const property of visible.properties){
      const name=String(key(property));
      if(!['binary-mode','full-header-mode'].includes(name))continue;
      const value=resolve(property.value);
      if(!(value?.type==='Literal'&&value.value===false))fail(input,'HTTP 请求的 '+name+' 必须静态证明未启用');
     }
    }
    const request=fresh('httpRequest'),dynamicMethod=!!method?.expression,selector=dynamicMethod?fresh('httpMethod'):null;
    const callee=dynamicMethod?`((${selector}) => {if (!['get','post','put','delete','head','options','patch'].includes(${selector})) throw new TypeError('Unsupported HTTP method');return ${context}.http[${selector}];})(${render(method.expression)}.toLowerCase()).bind(${context}.http)`:`${context}.http.${(method||'GET').toLowerCase()}`;
    const url=`typeof ${request} === 'string' ? ${request} : ${request}.url`;
    const headers=`${request}.headers ?? ${request}.header`,body=`${request}.bodyBytes ?? ${request}.body`,policy=`${request}.policy ?? ${request}.node`;
    const options=`{...(${headers} === undefined ? {} : {headers: ${headers}}), ...(${body} === undefined ? {} : {body: ${body}}), timeout: ${request}.timeout === undefined ? 5000 : ${request}.timeout * ${format==='loon'?1:1000}, ...(${policy} === undefined ? {} : {policy: ${policy}}), ...(${request}["policy-descriptor"] === undefined ? {} : {policyDescriptor: ${request}["policy-descriptor"]}), redirect: ${request}["auto-redirect"] === undefined || ${request}["auto-redirect"] ? 'follow' : 'manual', credentials: ${request}["auto-cookie"] === false ? 'omit' : 'include', ...(${request}.insecure === undefined ? {} : {insecureTls: ${request}.insecure})}`;
    const call=`${callee}(${url}, ${options})`,code=`((${request}) => {if (${request} && typeof ${request} === 'object' && (${request}["binary-mode"] === true || ${request}["full-header-mode"] === true)) throw new Error('Dynamic binary-mode/full-header-mode requires a static HTTP request record');return ${call};})(${render(input)})`;
    return {code,url,options,callee,dynamic:dynamicMethod,binary:false,full:false};
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
  const allowed=qx?['url','method','headers','body','bodyBytes','opts']:['url','headers','body','timeout','policy','policy-descriptor','insecure','auto-redirect','auto-cookie','binary-mode','full-header-mode',...(format==='loon'?['node']:[])];
  for(const k of f.keys())if(!allowed.includes(k))fail(input,'未适配 HTTP 参数：'+k);
  if(!f.has('url'))fail(input,'HTTP 请求缺少 URL');
  const declaredMethod=f.get('method'),dynamicMethod=!!callbackSelector||qx&&!method&&fieldValues.has(declaredMethod)&&resolve(declaredMethod)?.type!=='Literal';
  method=method??resolve(declaredMethod)?.value??'GET';if(!dynamicMethod&&(typeof method!=='string'||!['get','post','put','delete','head','options','patch'].includes(method.toLowerCase())))fail(input,'HTTP 方法必须可静态确定');
  const out=[];if(f.has('headers')){const captured=fresh('httpHeaders');let h=captured;if(f.has('body')||f.has('bodyBytes'))h=cleanHeaders(h,['content-length','transfer-encoding']);out.push(`...((${captured}) => ${captured} == null ? {} : {headers: ${h}})(${render(f.get('headers'))})`);}
  if(f.has('bodyBytes'))out.push(optionalHTTPFields.has(f.get('bodyBytes'))?`...(${render(f.get('bodyBytes'))} === undefined ? {} : {body: ${bytes(f.get('bodyBytes'))}})`:'body: '+bytes(f.get('bodyBytes')));else if(f.has('body'))out.push(optionalHTTPFields.has(f.get('body'))?`...(${render(f.get('body'))} === undefined ? {} : {body: ${bodyValue(f.get('body'))}})`:'body: '+bodyValue(f.get('body')));
  const flag=(m,k,fallback)=>{if(!m.has(k))return fallback;const v=resolve(m.get(k));if(v.type!=='Literal'||typeof v.value!=='boolean')fail(v,'HTTP 布尔参数必须可静态确定：'+k);return v.value;};
  if(qx){const o=f.has('opts')?object(f.get('opts'),'QX HTTP 选项'):new Map();for(const k of o.keys())if(!['redirection','skip-cert-verify','auto-cookie','policy'].includes(k))fail(input,'未适配 HTTP opts：'+k);
   out.push(`redirect: '${flag(o,'redirection',true)?'follow':'manual'}'`,`credentials: '${flag(o,'auto-cookie',false)?'include':'omit'}'`,`insecureTls: ${flag(o,'skip-cert-verify',false)}`);if(o.has('policy'))out.push('policy: '+render(o.get('policy')));
  }else{
   const timeout=fresh('httpTimeout');
   out.push('timeout: '+(f.has('timeout')?`((${timeout}) => ${timeout} === undefined ? 5000 : ${timeout} * ${format==='loon'?1:1000})(${render(f.get('timeout'))})`:5000));
   if(f.has('policy')||f.has('node')){const policy=f.get('policy')??f.get('node');out.push(optionalHTTPFields.has(policy)?`...(${render(policy)} === undefined ? {} : {policy: ${render(policy)}})`:'policy: '+render(policy));}
   if(f.has('policy-descriptor'))out.push('policyDescriptor: '+render(f.get('policy-descriptor')));
   out.push(`redirect: '${flag(f,'auto-redirect',true)?'follow':'manual'}'`,`credentials: '${flag(f,'auto-cookie',true)?'include':'omit'}'`);if(f.has('insecure'))out.push('insecureTls: '+flag(f,'insecure',false));
  }
  const selector=dynamicMethod?fresh('httpMethod'):null;
  const url=render(f.get('url')),options=`{${out.join(', ')}}`,callee=dynamicMethod?`((${selector}) => {if (!['get','post','put','delete','head','options','patch'].includes(${selector})) throw new TypeError('Unsupported HTTP method');return ${context}.http[${selector}];})(${callbackSelector?render(callbackSelector):render(declaredMethod)+'.toLowerCase()'}).bind(${context}.http)`:`${context}.http.${method.toLowerCase()}`;
  const call=`${callee}(${url}, ${options})`,runtime=f.runtimeRequest,guard=runtime?.binaryGuard?`if (${runtime.name} && typeof ${runtime.name} === 'object' && (${runtime.name}["binary-mode"] === true || ${runtime.name}["full-header-mode"] === true)) throw new Error('Dynamic binary-mode/full-header-mode requires a static HTTP request record');`:'',code=runtime?`((${runtime.name}) => {${guard}return ${call};})(${render(runtime.expression)})`:call;
  return {code,url,options,callee,dynamic:dynamicMethod,binary:flag(f,'binary-mode',false),full:flag(f,'full-header-mode',false),runtimeRequest:f.runtimeRequest};
 }
 function forwardedHTTPFields(input){
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
      if(q?.type==='AssignmentExpression'&&q.left===p||q?.type==='UpdateExpression'||q?.type==='UnaryExpression'&&q.operator==='delete')return false;
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
   let hasDispatch=false;
   for(const r of binding.refs){
    const p=parents.get(r),q=parents.get(p);
    if(p?.type==='AssignmentExpression'&&p.left===r){
     if(p.operator!=='='||p.right.type!=='ObjectExpression'||p.right.properties.some(x=>x.type!=='SpreadElement'&&!(x.type==='Property'&&x.kind==='init'&&key(x)!==undefined&&allowed.has(String(key(x))))))return null;
     continue;
    }
    if(p?.type==='SpreadElement'&&q?.type==='ObjectExpression')continue;
    if(p?.type==='Property'&&p.value===r&&key(p)==='url'&&q?.type==='ObjectExpression'&&parents.get(q)?.type==='AssignmentExpression'&&parents.get(q).left.type==='Identifier'&&bindings.get(parents.get(q).left)===binding)continue;
    if(p?.type==='MemberExpression'&&p.object===r&&property(p)!==undefined){
     const field=String(property(p));if(!allowed.has(field))return null;
     if(q?.type==='MemberExpression'&&q.object===p&&!['constructor','headers','method'].includes(field))return null;
     // 允许"发送前对 url 做追加"这一合法形态：它的实际执行被保留，HTTP 请求在发送
     // 时读取更新后的实时字段，因此不需要把 += 折叠成右侧表达式（折叠会丢原始 URL
     // 或让 queryStr 之类的调用重复执行）。其它非 = 的成员写入仍然拒绝。
     const dispatches=binding.refs.flatMap(ref=>{
      const call=parents.get(ref);
      return call?.type==='CallExpression'&&call.arguments.includes(ref)&&call.callee.type==='MemberExpression'&&free(call.callee.object,'$httpClient')?[call]:[];
     });
     if(q?.type==='AssignmentExpression'&&q.left===p&&q.operator!=='='){
      const appendBeforeSend=field==='url'&&q.operator==='+='&&dispatches.length>0&&
       dispatches.every(call=>owners.get(call)===owners.get(q)&&q.end<call.start);
      if(!appendBeforeSend)return null;
     }
     if(q?.type==='UpdateExpression')return null;
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
    const candidates=calls.map(c=>{forwarding.add(c);return fields(c.arguments[position],new Set(seen));});
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
  const projected=new Map([...origin].map(([k,value])=>{if(origin.runtimeRequest){if(origin.optional?.has(k))optionalHTTPFields.add(value);return [k,value];}const node={type:'Identifier',name:'httpField',start:input.start,end:input.end};fieldValues.set(node,value);if(origin.optional?.has(k))optionalHTTPFields.add(node);generated.set(node,`${render(input)}[${JSON.stringify(k)}]`);return [k,node];}));
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
 function reply(binding,fn=null){
  const refs=binding?.refs??[],uses=new Set();for(const ref of refs){const p=parents.get(ref);
   if(p?.type==='VariableDeclarator'&&p.init===ref&&p.id.type==='ObjectPattern'){
    for(const entry of p.id.properties){const name=entry.type==='Property'?key(entry):null;if(!['body','bodyBytes','status','statusCode','headers'].includes(name))fail(entry,'未知 HTTP 响应解构字段');uses.add(name);}continue;
   }
   if(closedWholeResponseUse(ref))continue;
   if(p?.type!=='MemberExpression'||p.object!==ref)fail(ref,'HTTP 响应整体传递无法静态转换');const k=property(p);if(!['body','bodyBytes','status','statusCode','headers'].includes(k))fail(p,'未知 HTTP 响应字段');uses.add(k);}
  const info={uses,body:uses.has('body')?fresh('responseText'):null,bytes:uses.has('bodyBytes')?fresh('responseBytes'):null,fn};if(binding)httpReplies.set(binding,info);if(fn&&(info.body||info.bytes))asyncFns.add(fn);return info;
 }
 function replyPrelude(info,name){const out=[];if(info.bytes)out.push(`const ${info.bytes} = await ${name}.arrayBuffer();`);if(info.body)out.push(`const ${info.body} = ${info.bytes?`new TextDecoder().decode(${info.bytes})`:`await ${name}.text()`};`);return out.join('\n');}
 // Register awaited QX replies and Promise callback parameters before rendering.
 for(const n of nodes){
  if(n.type==='VariableDeclarator'&&n.id.type==='Identifier'&&n.init?.type==='AwaitExpression'&&(isAPI(n.init.argument,'$task','fetch')||bundled&&n.init.argument.type==='CallExpression'&&n.init.argument.callee.type==='MemberExpression'&&n.init.argument.callee.object.type==='MemberExpression'&&free(n.init.argument.callee.object.object,'$native')&&property(n.init.argument.callee.object)==='http')){const b=bindings.get(n.id),info=reply(b);extraAfter.set(n,()=>replyPrelude(info,n.id.name));}
  if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&property(n.callee)==='then'&&isAPI(n.callee.object,'$task','fetch')){
   const fn=target(n.arguments[0]);if(!fn)fail(n,'HTTP 响应处理函数必须可静态追溯');
   if(fn.params[0]&&fn.params[0].type!=='Identifier')fail(fn.params[0],'HTTP 响应参数必须是简单局部变量，不能保留旧响应解构');
   if(fn.params[0])reply(bindings.get(fn.params[0]),fn);
  }
  if(n.type==='CallExpression'&&clientMethod(n.callee)){
   const fn=target(n.arguments[1]),p=fn?.params[1];
   if(p?.type==='Identifier'){
    const binding=bindings.get(p),h=http(n.arguments[0],clientMethod(n.callee),false);
    let snapshot=false;
    for(const ref of binding.refs){const parent=parents.get(ref),use=parents.get(parent);if(parent?.type==='MemberExpression'&&parent.object===ref){const name=property(parent),assigned=use?.type==='AssignmentExpression'&&use.left===parent&&use.operator==='=';const prototypeKey=['__proto__','constructor','prototype','toString','toLocaleString','valueOf','hasOwnProperty','isPrototypeOf','propertyIsEnumerable','__defineGetter__','__defineSetter__','__lookupGetter__','__lookupSetter__'].includes(name);if(!['status','statusCode','headers','body'].includes(name)&&(!assigned||prototypeKey))fail(parent,'未知 HTTP 回调响应字段');if(name==='body'||assigned||use?.operator==='delete')snapshot=true;}
     else if(parent?.type==='TemplateLiteral')snapshot=true;
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
  if(n.type==='CallExpression'&&n.callee.type==='Identifier'&&n.callee.name===device.deviceTypeToken&&!n.arguments.length)return `(${context}.env.EGH_DEVICE_TYPE || 'iPhone')`;
  if(n.type==='CallExpression'&&free(n.callee,'setTimeout')&&n.arguments.length===2&&n.arguments[0]?.type==='CallExpression'&&n.arguments[1].type==='Literal'&&typeof n.arguments[1].value==='number'&&target(n.arguments[0].callee)&&parents.get(n)?.type==='ExpressionStatement')return render(n.arguments[0]);
  if(n.type==='AssignmentExpression'&&n.operator==='='&&free(n.left)&&guardedImplicit.has(n.left.name))return '('+n.left.name+' = ('+render(n.right)+'), '+guardedImplicit.get(n.left.name)+' = true, '+n.left.name+')';
  if(n.type==='AssignmentExpression'&&n.operator!=='='&&free(n.left)&&guardedImplicit.has(n.left.name))return '('+guardedImplicit.get(n.left.name)+' ? ('+n.left.name+' '+n.operator+' ('+render(n.right)+')) : (() => {throw new '+(referenceError??'ReferenceError')+'('+JSON.stringify(n.left.name+' is not defined')+');})())';
  if(n.type==='Property'&&n.shorthand&&free(n.value)&&guardedImplicit.has(n.value.name))return n.value.name+': '+render(n.value);

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
    if(!nullCheck&&!(p?.type==='MemberExpression'&&p.object===n)&&!(p?.type==='UnaryExpression'&&['typeof','!'].includes(p.operator))&&!(p?.type==='LogicalExpression'&&p.left===n)&&!(['IfStatement','ConditionalExpression'].includes(p?.type)&&p.test===n)&&!(p?.type==='ExpressionStatement'&&p.expression===n))fail(n,'请求 / 响应对象整体传递无法证明字段语义，须直接读取具体字段');
   }
   if(map[n.name])return map[n.name];
   if(n.name.startsWith('$'))fail(n,'平台 API 作为值传递，无法直接原生改写：'+n.name);
  }
  if(n.type==='MemberExpression'){
   const k=property(n),o=n.object;
   if(o.type==='MemberExpression'&&free(o.object,'$network')&&['v4','v6'].includes(property(o))){const fields={primaryAddress:'address',primaryInterface:'interface',primaryRouter:'gateway'};if(!fields[k])fail(n,'未知网络地址字段');return `${context}.device.${property(o)==='v4'?'ipv4':'ipv6'}.${fields[k]}`;}
   if(free(o,'$httpClient')){
    const m=clientMethod(n);let alias=n;
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
  if(n.type==='ReturnStatement'&&n.argument?.type==='CallExpression'&&clientMethod(n.argument.callee)){
   const completing=complete.has(target(n.argument.arguments[1]));
   return callback(n.argument)+(completing?'':'\nreturn;');
  }
  if(n.type==='ExpressionStatement'){
   const e=n.expression;
   if(e.type==='SequenceExpression'){
    const flat=x=>x.type==='SequenceExpression'?x.expressions.flatMap(flat):[x],parts=flat(e);
    if(parts.some(x=>x.type==='CallExpression'&&clientMethod(x.callee)))return parts.map(x=>emit({...n,start:x.start,end:x.end,expression:x})).join('\n');
   }
   if(pending?.calls.has(e))return '{'+pendingResult+' = '+patch(source,e,render)+'; if ('+pendingFinished+') return await '+pendingResult+';}';
   if(e.type==='CallExpression'&&clientMethod(e.callee))return callback(e);
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
   if(n.body.type!=='BlockStatement')head=head.slice(0,head.lastIndexOf('=>')+2)+' ';
   const method=parents.get(n)?.type==='MethodDefinition'||parents.get(n)?.type==='Property'&&parents.get(n).method;
   if(asyncFns.has(n)&&!n.async&&!method)head='async '+head;
   const prologue=info?replyPrelude(info,n.params[0].name):'';
   if(n.body.type==='BlockStatement'){
    const body=render(n.body),inner=body.slice(1,-1);
    if(prologue&&n.body.body.some(s=>s.directive))fail(n,'HTTP 回调含 directive，需要先明确正文读取位置');
    return head+'{'+prologue+'\n'+inner+(complete.has(n)?'\nthrow new Error("Script ended without a completion result");':'')+'}';
   }
   return head+'{'+prologue+'\nreturn '+render(n.body)+';}';
  }
  return patch(source,n,render);
 }
 function callback(n,completionGuard,detached){
  const fn=target(n.arguments[1]);if(!fn||fn.params.some(p=>p.type!=='Identifier')||fn.params.length>3)fail(n,'HTTP 回调必须是可追溯的简单函数');
  const h=http(n.arguments[0],clientMethod(n.callee),false),r=fresh('httpResponse'),e=fresh('httpError'),b=fresh('httpBody'),caught=fresh('networkError');
  const response=fn.params[1]&&bindings.get(fn.params[1]),snapshot=httpReplies.get(response)?.snapshot;
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
    ? `const ${handler} = ${render(n.arguments[1])}; const ${url} = ${h.url}; const ${options} = ${h.options};`
    : `const ${url} = ${h.url}; const ${options} = ${h.options}; const ${handler} = ${render(n.arguments[1])};`;
   const requestCall=send?`${send}(${url}, ${options})`:`${h.callee}(${url}, ${options})`;
   const dispatch=`{${requestBody} void (async () => {let ${e} = null, ${r} = null, ${b} = null;try {${r} = await ${requestCall}; ${b} = ${h.binary?`new Uint8Array(await ${r}.arrayBuffer())`:`await ${r}.text()`};} catch (${caught}) {${e} = String(${caught}.message ?? ${caught}); ${r} = null;} ${detached?`if (${detached.completion}) return; await `:''}${handler}(${e}, ${responseValue}, ${b});})()${detached?`.catch(${detached.reject})`:''};}`;
   const callee=send?`const ${send} = ${h.callee}; `:'';
   if(h.runtimeRequest){
    const {name,expression}=h.runtimeRequest;
    return `{${callee}((${name}) => ${dispatch})(${render(expression)});}`;
   }
   return `{${callee}${dispatch.slice(1)}`;
  }
  return `{let ${e} = null, ${r} = null, ${b} = null;\ntry {${r} = await ${h.code}; ${b} = ${h.binary?`new Uint8Array(await ${r}.arrayBuffer())`:`await ${r}.text()`};} catch (${caught}) {${e} = String(${caught}.message ?? ${caught}); ${r} = null;}\n${completionGuard?'':'return '}await (${render(n.arguments[1])})(${e}, ${responseValue}, ${b});${completionGuard??''}}`;
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
 const identity=fn=>{
  if(fn?.type==='ArrowFunctionExpression')return fn.params.length===1&&fn.params[0].type==='Identifier'&&fn.body.type==='Identifier'&&bindings.get(fn.params[0])===bindings.get(fn.body);
  if(fn?.type==='FunctionExpression'&&fn.params.length===1&&fn.params[0].type==='Identifier'&&fn.body.type==='BlockStatement'&&fn.body.body.length===1){const ret=fn.body.body[0];return ret.type==='ReturnStatement'&&ret.argument?.type==='Identifier'&&bindings.get(fn.params[0])===bindings.get(ret.argument);}
  return false;
 };
 const guarded=(test,name)=>{
  if(test?.type!=='BinaryExpression'||!['===','=='].includes(test.operator))return false;
  const type=test.left?.type==='UnaryExpression'&&test.left.operator==='typeof'?test.left:test.right?.type==='UnaryExpression'&&test.right.operator==='typeof'?test.right:null;
  const value=type===test.left?test.right:test.left,argument=type?.argument?.type==='ChainExpression'?type.argument.expression:type?.argument;
  return value?.type==='Literal'&&value.value==='function'&&argument?.type==='MemberExpression'&&free(argument.object,'$utils')&&property(argument)===name;
 };
 for(const n of nodes){
  if(n.type!=='ConditionalExpression'||comments.some(c=>c.start>=n.start&&c.end<=n.end))continue;
  const yes=n.consequent.type==='MemberExpression'&&free(n.consequent.object,'$utils')?property(n.consequent):null;
  const no=n.alternate.type==='MemberExpression'&&free(n.alternate.object,'$utils')?property(n.alternate):null;
  const name=yes??no,fallback=yes?n.alternate:n.consequent;
  if(!['ungzip'].includes(name)||!identity(fallback)||!guarded(n.test,name))continue;
  const declaration=parents.get(n),binding=declaration?.type==='VariableDeclarator'&&declaration.init===n&&declaration.id.type==='Identifier'?bindings.get(declaration.id):null;
  if(!binding||binding.writes.length||!binding.refs.length||binding.refs.some(ref=>{const call=parents.get(ref);return call?.type!=='CallExpression'||call.callee!==ref||call.optional||call.arguments.some(a=>a.type==='SpreadElement');}))continue;
  replace.set(n,`$utils.${name}`);changed=true;
  transformations.push({kind:'native-compression-fallback',line:source.slice(0,n.start).split('\n').length,api:name,reason:'将旧平台可选压缩函数与恒等回退映射为 Egern 原生压缩 API'});
 }
 return {source:changed?renderTree(source,tree,n=>replace.has(n)?{direct:true,value:replace.get(n)}:null):source,transformations};
}
