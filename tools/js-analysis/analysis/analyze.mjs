import {parse} from '../core/syntax.mjs';
import {ordinaryReceivers} from './values.mjs';
import {standardGlobals,privateGlobalAssignment} from '../core/ast.mjs';

// Static parsing only. No upstream code or decoder is evaluated.
export function analyze(source, sourceFormat='surge', options={}) {
const nodes = [], reasons = new Set(), bindings = new WeakSet(), scopes = new WeakMap(), parents = new WeakMap();
let tree;
try {tree = parse(source, {ecmaVersion:'latest', sourceType:'script', allowReturnOutsideFunction:true, allowAwaitOutsideFunction:true});}
catch(error) {
  let message = `原脚本语法错误：${error.message}`;
  try { parse(source, {ecmaVersion:'latest', sourceType:'module'}); message='ES 模块包含 import/export 依赖，需要先打包为独立 HTTP 脚本'; } catch {}
  return {errors:[message]};
}
const root={parent:null,names:new Set(),fn:true};
function bind(pattern, scope) {
  if(!pattern)return;
  if(pattern.type==='Identifier'){scope.names.add(pattern.name);bindings.add(pattern);return;}
  if(pattern.type==='RestElement')return bind(pattern.argument,scope);
  if(pattern.type==='AssignmentPattern')return bind(pattern.left,scope);
  if(pattern.type==='ArrayPattern')return pattern.elements.forEach(x=>bind(x,scope));
  if(pattern.type==='ObjectPattern')return pattern.properties.forEach(x=>bind(x.type==='RestElement'?x.argument:x.value,scope));
}
const pending=[{node:tree,scope:root,parent:null,key:''}];
while(pending.length) {
  let {node,scope,parent,key}=pending.pop();
  parents.set(node,parent);
  if(node.type==='FunctionDeclaration')bind(node.id,scope);
  if(/^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(node.type)) {
    scope={parent:scope,names:new Set(),fn:true}; bind(node.id,scope);node.params.forEach(x=>bind(x,scope));
  } else if(['BlockStatement','CatchClause','ForStatement','ForInStatement','ForOfStatement','SwitchStatement'].includes(node.type))scope={parent:scope,names:new Set(),fn:false};
  scopes.set(node,scope);nodes.push({node,parent,key});
  if(node.type==='CatchClause')bind(node.param,scope);
  if(node.type==='ClassDeclaration')bind(node.id,scope);
  if(node.type==='ClassExpression'){scope={parent:scope,names:new Set(),fn:false};bind(node.id,scope);scopes.set(node,scope);}
  if(node.type==='VariableDeclaration') {
    let target=scope;if(node.kind==='var')while(!target.fn)target=target.parent;
    node.declarations.forEach(x=>bind(x.id,target));
  }
  for(const [name,value] of Object.entries(node)) {
    if(['start','end','loc'].includes(name))continue;
    if(Array.isArray(value)) {for(let i=value.length-1;i>=0;i--)if(value[i]?.type)pending.push({node:value[i],scope,parent:node,key:name});}
    else if(value?.type)pending.push({node:value,scope,parent:node,key:name});
  }
}

function bound(name,scope){for(let s=scope;s;s=s.parent)if(s.names.has(name))return true;return false;}
const allowed=new Set(['$request','$response','$done','$notification','$argument','$notify','$log','$task','$httpClient','$persistentStore','$prefs','$utils','$script','$network','$cronexp','$environment',...(options.nativeBundle?['$native']:[])]);
const forbidden=new Set(['eval','Function','require','setTimeout','setInterval','fetch','globalThis','global','window','module','exports','process']);
let done=false, asynchronous=false;
const apis=new Set();
const members={
  $notification:new Set(['post']),
  $environment:new Set(['language','variables']),
  $task:new Set(['fetch']),
  $httpClient:new Set(['get','post','put','delete','head','options','patch']),
  $persistentStore:new Set(['read','write']),
  $prefs:new Set(['valueForKey','setValueForKey','removeValueForKey']),
  $utils:new Set(['geoip','ipasn','ipaso','ungzip']),
  $script:new Set(['name','startTime','binaryBodyMode']),
  $network:new Set(['wifi','v4','v6','dns','cellular-data'])
};
const staticProperty=n=>n.computed?(n.property.type==='Literal'?n.property.value:undefined):n.property.name;
const standardPrototypes=new Set(['Object','Date','String','Number','Boolean','Array','RegExp','Map','Set','Promise','Error','TypeError','RangeError','ArrayBuffer','DataView','Uint8Array','Uint16Array','Uint32Array','Int8Array','Int16Array','Int32Array','Float32Array','Float64Array']);
const ordinary=options.nativeMethods?ordinaryReceivers(tree,options.nativeLibraryValues):null;
const boundNames=new Set(nodes.filter(({node})=>node.type==='Identifier'&&bindings.has(node)).map(({node})=>node.name));
const freeReadUse=node=>{
 const use=parents.get(node);
 return !(use?.type==='AssignmentExpression'&&use.left===node||use?.type==='UpdateExpression'||
  use?.type==='UnaryExpression'&&use.operator==='delete'||['ForInStatement','ForOfStatement'].includes(use?.type)&&use.left===node);
};
const freeReadNames=new Set(nodes.filter(({node,parent,key})=>node.type==='Identifier'&&!bindings.has(node)&&!bound(node.name,scopes.get(node))&&
 !(parent?.type==='MemberExpression'&&key==='property'&&!parent.computed)&&
 !((parent?.type==='Property'||parent?.type==='MethodDefinition')&&key==='key'&&!parent.computed)&&
 !(['LabeledStatement','BreakStatement','ContinueStatement'].includes(parent?.type)&&key==='label')&&
 freeReadUse(node)&&/^[A-Za-z_$][\w$]*$/.test(node.name)).map(({node})=>node.name));
const deniedGlobalAliases=new Set(['window','global','process','require','module','exports','document','self','navigator','location','fetch','crypto','console','setTimeout','setInterval','setImmediate','queueMicrotask','structuredClone','performance','WebSocket','XMLHttpRequest','localStorage','sessionStorage','Egern','Cloudflare','__proto__','prototype','constructor']);
for(const {node:n,parent:p,key} of nodes) {
  if(n.type==='Identifier') {
    if(n.name.startsWith('__egern'))reasons.add('与转换器保留标识符冲突');
    if(bindings.has(n))continue;
    if(p?.type==='MemberExpression' && key==='property'&&!p.computed)continue;
    if((p?.type==='Property'||p?.type==='MethodDefinition')&&key==='key'&&!p.computed)continue;
    if(['LabeledStatement','BreakStatement','ContinueStatement'].includes(p?.type)&&key==='label')continue;
    if(bound(n.name,scopes.get(n)))continue;
    if(p?.type==='UnaryExpression' && p.operator==='typeof')continue;
    if(n.name.startsWith('$'))apis.add(n.name);
    // $log 是纯日志观察，返回值不参与业务。只允许它作为独立语句直接调用，
    // 以免把无法观察的返回值误当成可确定的结果。
    if(n.name==='$log'&&!(p?.type==='CallExpression'&&p.callee===n&&parents.get(p)?.type==='ExpressionStatement'&&parents.get(p).expression===p))
      reasons.add('$log 仅支持作为独立语句直接调用');
    if(n.name==='Promise')asynchronous=true;
    if(n.name.startsWith('$')&&!allowed.has(n.name))reasons.add('未适配 API：'+n.name);
    const standardGlobal=options.nativeStandardGlobals&&n.name==='globalThis'&&p?.type==='MemberExpression'&&p.object===n&&standardGlobals.has(staticProperty(p));
    const privateGlobalWrite=privateGlobalAssignment({parents,free:item=>!bound(item.name,scopes.get(item))},n);
    // 动态 UMD 安装器会让同一脚本混用裸标识符与 globalThis 限定读取。
    // 只有全程序无同名词法绑定、脚本自身另有同名自由读取且这里是纯读取时，
    // 二者才都指向同一个全局记录；原表达式保持不变，因此缺失属性仍安全。
    const globalReadName=p?.type==='MemberExpression'&&p.object===n?staticProperty(p):undefined;
    const installedGlobalRead=options.nativeStandardGlobals&&n.name==='globalThis'&&typeof globalReadName==='string'&&
      !globalReadName.startsWith('$')&&!deniedGlobalAliases.has(globalReadName)&&!boundNames.has(globalReadName)&&
      freeReadNames.has(globalReadName)&&freeReadUse(p);
    // 动态安装器把真实全局对象作为 Function 构造函数的 thisArg；保留的是
    // 原样对象而不是新的宿主能力。仅接受直接 `Function(...).call(globalThis)`。
    const dynamicFunctionThis=options.nativeStandardGlobals&&n.name==='globalThis'&&p?.type==='CallExpression'&&
      p.arguments.length===1&&p.arguments[0]===n&&p.callee.type==='MemberExpression'&&staticProperty(p.callee)==='call'&&
      p.callee.object?.type==='CallExpression'&&p.callee.object.arguments.every(a=>a.type!=='SpreadElement')&&
      p.callee.object.callee.type==='Identifier'&&p.callee.object.callee.name==='Function'&&!bound('Function',scopes.get(p.callee.object.callee));
    if(standardGlobal){const q=parents.get(p);if(q?.type==='AssignmentExpression'&&q.left===p||q?.type==='UpdateExpression'||q?.operator==='delete')reasons.add('不能覆写标准 JavaScript 全局字段');}
    const callback=p?.arguments?.[0];
    const boundCallback=callback?.type==='CallExpression'&&callback.callee.type==='MemberExpression'&&callback.callee.object.type==='Identifier'&&staticProperty(callback.callee)==='bind'&&callback.arguments[0]?.type==='Literal'&&callback.arguments[0].value===null;
    // Keep the standard timer call and its argument evaluation exactly as
    // authored. A call expression may intentionally produce a callback (or
    // may expose an upstream bug); rewriting it into a deferred call changes
    // observable ordering. String callbacks still imply dynamic code.
    const nativeTimer=options.nativeStandardGlobals&&n.name==='setTimeout'&&p?.type==='CallExpression'&&p.callee===n&&[1,2].includes(p.arguments.length)&&callback?.type!=='Literal'&&(['Identifier','ArrowFunctionExpression','FunctionExpression','CallExpression','MemberExpression','ConditionalExpression','LogicalExpression','SequenceExpression'].includes(callback?.type)||boundCallback);
    const nativeEvaluation=options.nativeStandardGlobals&&['eval','Function'].includes(n.name);
    if(forbidden.has(n.name)&&!(options.nativeBundle&&n.name==='globalThis')&&!standardGlobal&&!installedGlobalRead&&!dynamicFunctionThis&&!privateGlobalWrite&&!nativeTimer&&!nativeEvaluation)reasons.add('运行环境或动态/异步依赖：'+n.name);
    if(n.name==='$done')done=true;
    if(n.name==='$task'||n.name==='$httpClient')asynchronous=true;
    if(members[n.name]) {
      if(p?.type!=='MemberExpression'||key!=='object')reasons.add('平台对象整体传递需独立审查：'+n.name);
      else {
        const member=staticProperty(p);
        if((member===undefined&&n.name!=='$httpClient')||(member!==undefined&&!members[n.name].has(member)))reasons.add('未适配 API 成员：'+n.name+'.'+(member??'[动态属性]'));
      }
    }
  }
  if(n.type==='AwaitExpression'||n.async)asynchronous=true;
  if(n.type==='ThisExpression'){
    let owner=parents.get(n);while(owner&&(!/^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(owner.type)||owner.type==='ArrowFunctionExpression'))owner=parents.get(owner);
    const assignment=parents.get(owner),left=assignment?.left;
    const standardPrototype=owner?.type==='FunctionExpression'&&assignment?.type==='AssignmentExpression'&&assignment.operator==='='&&assignment.right===owner&&left?.type==='MemberExpression'&&left.object?.type==='MemberExpression'&&staticProperty(left.object)==='prototype'&&left.object.object?.type==='Identifier'&&standardPrototypes.has(left.object.object.name)&&!bound(left.object.object.name,scopes.get(left.object.object));
    const nativeReceiver=options.nativeMethods&&(parents.get(owner)?.type==='MethodDefinition'||ordinary?.methodReceiver(n));
    // this 本身是标准 JavaScript：被注入的 sloppy 语义包装调用包住的 this 直接放行，
    // 运行时由该包装把 null/undefined 还原成全局对象，不需要静态证明接收者。
    const sloppyWrapped=!!options.sloppyThisHelper&&p?.type==='CallExpression'&&p.callee?.type==='Identifier'&&p.callee.name===options.sloppyThisHelper&&p.arguments.length===1&&p.arguments[0]===n;
    // this 是标准 JavaScript：接收者已证明的保持原样，无法证明接收者的位置已由
    // 转换阶段包成 sloppy 语义包装（运行时把 null/undefined 还原成全局对象），
    // 两者都不需要在这里再拦。仍要拦的只有 sloppy 语境下 this.$xxx 这类读取旧平台
    // 全局对象的写法，它的等价性无法静态证明。
    if(!options.nativeBundle&&!sloppyWrapped&&!nativeReceiver&&!ordinary?.descriptorThis(n)&&!standardPrototype){
      const platformReceiver=p?.type==='MemberExpression'&&p.object===n&&typeof staticProperty(p)==='string'&&staticProperty(p).startsWith('$');
      if(platformReceiver)reasons.add('this 读取旧平台全局对象：'+staticProperty(p));
    }
    if(options.nativeBundle&&p?.type==='MemberExpression'&&typeof staticProperty(p)==='string'&&staticProperty(p).startsWith('$'))reasons.add('this 访问旧平台全局对象');
  }
  if(n.type==='MemberExpression'&&['then','catch','finally'].includes(staticProperty(n)))asynchronous=true;
  if(!options.nativeStandardGlobals&&!options.nativeBundle&&n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&n.arguments.length===0&&
      ((!n.callee.computed&&n.callee.property.name==='toString')||(n.callee.computed&&n.callee.property.value==='toString'))&&!ordinary?.safeToString(n)){
    const context=source.slice(Math.max(0,n.start-72),Math.min(source.length,n.end+32)).replace(/\s+/g,' ').slice(0,180);
    reasons.add('零参数 toString 可能涉及源码自检，需独立审查：第 '+source.slice(0,n.start).split('\n').length+' 行；接收者 '+source.slice(n.callee.object.start,n.callee.object.end).slice(0,120)+'；代码 '+context);
  }
}
if(!options.nativeStandardGlobals&&/jsjiami\.com|javascript-obfuscator|selfDefending/.test(source))reasons.add('混淆/自防御代码尚未完成等价性审查');
const scheduledOnly=Array.isArray(options.entry_types)&&options.entry_types.length>0&&options.entry_types.every(type=>type==='schedule');
if(!done&&!options.nativeEntry&&!scheduledOnly&&!options.allowNoCompletion)reasons.add('没有可识别的 $done 完成入口');
// Check literal options during conversion as well as dynamic values at runtime.
// Scope-aware: an author's local $task/$httpClient is not a platform API.
const checkOptions=(object,allowed,label)=>{
  if(object?.type!=='ObjectExpression')return;
  for(const property of object.properties) {
    if(property.type==='SpreadElement')continue;
    const name=property.computed?(property.key.type==='Literal'?property.key.value:undefined):(property.key.name??property.key.value);
    if(name!==undefined&&!allowed.includes(name))reasons.add('未适配 HTTP 参数：'+label+'.'+name);
  }
};
for(const {node:n} of nodes) {
  if(n.type!=='CallExpression'||n.callee.type!=='MemberExpression')continue;
  const api=n.callee.object;
  if(api.type!=='Identifier'||bound(api.name,scopes.get(api)))continue;
  const input=n.arguments[0];
  if(api.name==='$task'&&staticProperty(n.callee)==='fetch') {
    checkOptions(input,['url','method','headers','body','bodyBytes','timeout','opts'],'$task.fetch');
    for(const p of input?.properties??[])if(p.type==='Property'&&(p.key.name??p.key.value)==='opts')
      checkOptions(p.value,['redirection','skip-cert-verify','auto-cookie','policy'],'$task.fetch.opts');
  } else if(api.name==='$httpClient') {
  checkOptions(input,['url','headers',...(options.nativeMethods?['header']:[]),'body','timeout','policy','policy-descriptor','insecure','auto-redirect','auto-cookie','binary-mode','full-header-mode',...(sourceFormat==='loon'?['node']:[])],'$httpClient');
  }
}
// A text-only rewrite can retain its explicitly documented QX completion ABI
// even when another platform's module happens to reference the same file.
// Include typeof references and escaped identifiers; raw-text API searches are
// insufficient for deciding whether selecting a platform changes behavior.
const bodyAPIs={
 $request:new Set(['url','method','headers','body']),
 $response:new Set(['headers','body'])
};
const textBodyOnly=nodes.every(({node:n,parent:p,key})=>{
 if(n.type!=='Identifier'||!n.name.startsWith('$')||bindings.has(n)||bound(n.name,scopes.get(n)))return true;
 if(p?.type==='MemberExpression'&&key==='property'&&!p.computed||['Property','MethodDefinition'].includes(p?.type)&&key==='key'&&!p.computed)return true;
 if(n.name==='$done')return p?.type==='CallExpression'&&p.callee===n;
 return p?.type==='MemberExpression'&&p.object===n&&bodyAPIs[n.name]?.has(staticProperty(p));
});
const scalarCompletion=nodes.some(({node:n})=>n.type==='CallExpression'&&n.callee.type==='Identifier'&&n.callee.name==='$done'&&!bound('$done',scopes.get(n.callee))&&n.arguments.length===1&&
 (n.arguments[0].type==='Literal'&&typeof n.arguments[0].value==='string'||n.arguments[0].type==='TemplateLiteral'||
 n.arguments[0].type==='CallExpression'&&n.arguments[0].callee.type==='MemberExpression'&&n.arguments[0].callee.object.name==='JSON'&&!bound('JSON',scopes.get(n.arguments[0].callee.object))&&staticProperty(n.arguments[0].callee)==='stringify'));
return {errors:[...reasons].sort(),code:source,asynchronous,apis:[...apis].sort(),comments_ignored:true,text_body_only:!!textBodyOnly,scalar_completion:scalarCompletion};
}
