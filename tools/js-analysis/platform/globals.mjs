import {parse} from '../core/syntax.mjs';
import {index,patch,renderTree,property,key,children,functions,initializedAfter,factoryArgument,literalExpression} from '../core/ast.mjs';

// Fold proven source-platform probes, preserving unknown device/version data.
const UNKNOWN=Symbol('not statically known');
const PRESENT_VERSION=Symbol('platform version exists; exact value unknown');
const PRESENT_GLOBALS=new Map();
const safeProbeCallees=new Set(['Boolean','String','Number','parseInt','parseFloat','isNaN','isFinite']);
// 探测结果只能流入可证明不改变语义的消费点：条件、比较、布尔/字符串
// 转换、已知完成调用，或经单次绑定继续流向前述位置。传入未知函数、
// 直接逃逸或动态写入时返回 false。
export function probeResultSafeAt(ix,start){
 const seen=new Set();
 // 混淆脚本常把平台探测作为局部比较对象方法的实参。只有对象本身封闭、
 // 每个方法只由参数/字面量组成且没有外部写入，并且调用结果只决定条件时，
 // 才能证明探测值只参与条件比较，没有进入业务数据。
 const closedConditionalCall=call=>{
  if(call.type!=='CallExpression'||call.arguments.length===0||call.callee.type!=='MemberExpression')return false;
  const object=call.callee.object;
  let literal=object,binding=null;
  const tableBindings=new Set();
  for(let depth=0;literal?.type==='Identifier'&&depth<4;depth++){
   binding=ix.bindings.get(literal);
   if(!binding||binding.writes.length)return false;
   tableBindings.add(binding);
   literal=binding.init;
  }
  if(literal?.type!=='ObjectExpression')return false;
  const entries=literal.properties.filter(p=>p.type==='Property'&&p.kind==='init');
  if(entries.length!==literal.properties.length)return false;
  const writes=binding?ix.nodes.filter(n=>n.type==='AssignmentExpression'&&n.operator==='='&&n.left.type==='MemberExpression'&&n.left.object.type==='Identifier'&&tableBindings.has(ix.bindings.get(n.left.object))):[];
  if(writes.some(n=>n.start>=call.start))return false;
  const values=[...entries.map(p=>p.value),...writes.map(n=>n.right)];
  const methods=values.filter(v=>functions.has(v?.type));
  if(!methods.length)return false;
  const closedFunction=fn=>{
   if(!functions.has(fn?.type)||fn.async||fn.generator)return false;
   const params=new Set(fn.params.filter(p=>p.type==='Identifier').map(p=>ix.bindings.get(p)).filter(Boolean));
   if(params.size!==fn.params.length)return false;
   let safe=true;
   for(const node of ix.nodes){
    if(node.start<fn.start||node.end>fn.end)continue;
    if(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(node.type)&&node!==fn)return false;
    if(['AssignmentExpression','UpdateExpression','DeleteExpression'].includes(node.type)||node.type==='UnaryExpression'&&node.operator==='delete'){safe=false;break;}
    if(node.type!=='Identifier'||!ix.reference(node))continue;
    if(params.has(ix.bindings.get(node))||ix.free(node,'undefined'))continue;
    safe=false;break;
   }
   return safe;
  };
  // 字符串解码等非函数成员不会成为可调用方法；只证明函数成员本身封闭。
  return methods.every(closedFunction);
 };
 function walk(node){
  if(seen.has(node))return true;seen.add(node);
  const parent=ix.parents.get(node);if(!parent)return true;
  if(parent.type==='ChainExpression'&&parent.expression===node)return walk(parent);
  if(parent.type==='UnaryExpression'&&parent.argument===node)return ['!','void','typeof'].includes(parent.operator)&&walk(parent);
  if(parent.type==='BinaryExpression'&&(parent.left===node||parent.right===node))return ['==','!=','===','!==','<','>','<=','>=','+'].includes(parent.operator)&&walk(parent);
  if(parent.type==='LogicalExpression'&&(parent.left===node||parent.right===node))return walk(parent);
  if(parent.type==='SequenceExpression'){
   // 逗号表达式只把最后一个值传出去；前面的值只保留求值副作用。
   return parent.expressions.at(-1)!==node||walk(parent);
  }
  if(parent.type==='ConditionalExpression'){
   // 条件测试只决定执行哪个分支，探测值本身不会成为条件表达式的值。
   // 分支结果仍需在后续使用点单独证明；这里不能把测试值误当成分支值追踪。
   if(parent.test===node)return true;
   return false;
  }
  if(['IfStatement','WhileStatement','DoWhileStatement','ForStatement'].includes(parent.type)&&parent.test===node)return true;
  if(parent.type==='SwitchCase'&&parent.test===node)return true;
  if(parent.type==='CallExpression'&&parent.arguments.includes(node)){
   if(parent.callee.type==='Identifier'&&safeProbeCallees.has(parent.callee.name))return walk(parent);
   if(closedConditionalCall(parent)&&walk(parent))return true;
   return parent.callee.type==='Identifier'&&ix.free(parent.callee,'$done');
  }
  if(parent.type==='Property'&&parent.value===node){const object=ix.parents.get(parent);return object?.type==='ObjectExpression'&&walk(object);}
  if(parent.type==='ObjectExpression'&&parent.properties.includes(node))return walk(parent);
  if(parent.type==='ArrayExpression'&&parent.elements.includes(node))return walk(parent);
  if(parent.type==='TemplateLiteral'&&parent.expressions.includes(node))return walk(parent);
  if(parent.type==='VariableDeclarator'&&parent.init===node&&parent.id.type==='Identifier'){
   const binding=ix.bindings.get(parent.id);if(!binding||binding.writes.length)return false;
   const refs=binding.refs.filter(ref=>ref!==parent.id);return !!refs.length&&refs.every(ref=>walk(ref));
  }
  if(parent.type==='AssignmentExpression'&&parent.right===node&&parent.left.type==='Identifier'){
   const binding=ix.bindings.get(parent.left);if(!binding||binding.writes.length!==1||binding.writes[0]!==parent)return false;
   return binding.refs.filter(ref=>ref!==parent.left).every(ref=>walk(ref));
  }
  if(parent.type==='ReturnStatement'&&parent.argument===node)return true;
  if(parent.type==='ExpressionStatement'&&parent.expression===node)return true;
  if(parent.type==='ArrowFunctionExpression'&&parent.body===node)return true;
  return false;
 }
 return walk(start);
}
export function platformFold(source,format,options={}){
 let qx;
 for(let pass=0;pass<3;pass++){
  const literalCalls=foldClosedLiteralMethodCalls(source);
  const folded=fold(literalCalls,format,options,qx);qx=folded.qx;
  if(folded.source===source)return folded;
  source=folded.source;
 }
 return {source,qx};
}

// 折叠闭合对象字面量表上的纯谓词/转换方法。判据要求表绑定只被静态成员
// 访问、被调用方法从未被写入，且方法体只读取参数、字面量和未被写入的表
// 字段。这样可以安全移除与当前调用无关的其它字段写入，而不把表当成整体
// 不可变对象；任何动态键、别名逃逸、方法重绑或未知调用都保持原样。
export function foldClosedLiteralMethodCalls(source){
 let tree,ix;
 try{tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true});ix=index(tree);}
 catch{return source;}
 const {nodes,parents,bindings}=ix,UNKNOWN=Symbol('unknown'),infos=new Map(),edits=[];
 const declarators=new Map();
 for(const n of nodes)if(n.type==='VariableDeclarator'){
  const b=bindings.get(n.id);if(b){if(!declarators.has(b))declarators.set(b,[]);declarators.get(b).push(n);}
 }
 const staticKey=member=>property(member);
 function infoFor(binding){
  if(infos.has(binding))return infos.get(binding);
  const declarations=declarators.get(binding)??[];
  const init=declarations.length===1&&declarations[0].init;
  if(!binding||binding.writes.length||declarations.length!==1||init?.type!=='ObjectExpression'){
   infos.set(binding,null);return null;
  }
  const fields=new Map();
  for(const p of init.properties){
   const name=p.type==='Property'?key(p):undefined;
   if(p.type!=='Property'||p.kind!=='init'||name===undefined||name==='__proto__'||fields.has(name)){
    infos.set(binding,null);return null;
   }
   fields.set(name,p.value);
  }
  const written=new Set();
  for(const ref of binding.refs){
   const member=parents.get(ref),use=parents.get(member);
   if(member?.type==='MemberExpression'&&member.object===ref&&staticKey(member)!==undefined){
    if(use?.type==='AssignmentExpression'&&use.left===member||use?.type==='UpdateExpression'||use?.type==='UnaryExpression'&&use.operator==='delete')written.add(staticKey(member));
    continue;
   }
   // 整体值只允许出现在不会修改对象的纯观察位置。字符串拼接、String/
   // JSON 序列化和 truthiness/typeof 检查都不会写入表字段或替换方法。
   const pureObservation=member?.type==='CallExpression'&&member.arguments.includes(ref)&&(
    member.callee.type==='Identifier'&&ix.free(member.callee,'String')||
    member.callee.type==='MemberExpression'&&property(member.callee)==='concat'&&
     (member.callee.object.type==='Literal'&&typeof member.callee.object.value==='string'||ix.free(member.callee.object,'String'))||
    member.callee.type==='MemberExpression'&&property(member.callee)==='stringify'&&ix.free(member.callee.object,'JSON'))||
    member?.type==='UnaryExpression'&&['!','typeof','void'].includes(member.operator)||
    member?.type==='BinaryExpression'||member?.type==='LogicalExpression'||
    ['IfStatement','WhileStatement','DoWhileStatement','ConditionalExpression'].includes(member?.type)&&member.test===ref;
   if(!pureObservation){infos.set(binding,null);return null;}
   if(member.type==='CallExpression'&&member.callee.type==='Identifier')continue;
   if(use?.type==='AssignmentExpression'&&use.left===member||use?.type==='UpdateExpression'||use?.type==='UnaryExpression'&&use.operator==='delete')written.add(staticKey(member));
  }
  // 调用点必须位于唯一初始化声明之后；否则折叠会吞掉 TDZ 或 undefined
  // 读取异常。嵌套函数仍按源码顺序保守处理，不做跨调用图推断。
  const info={fields,written,end:declarations[0].end};
  infos.set(binding,info);return info;
 }
 function fieldValue(binding,name,seen=new Set()){
  const info=infoFor(binding);if(!info||!info.fields.has(name)||info.written.has(name))return UNKNOWN;
  return constantValue(info.fields.get(name),binding,new Map(),seen);
 }
 function primitive(value){return value===undefined||value===null||['string','number','boolean'].includes(typeof value);}
 function constantValue(n,binding,env,seen){
  if(!n||seen.has(n))return UNKNOWN;seen=new Set(seen);seen.add(n);
  if(n.type==='Literal')return n.regex?UNKNOWN:n.value;
  if(n.type==='Identifier'){
   if(ix.free(n,'undefined'))return undefined;
   const b=bindings.get(n);return b&&env.has(b)?env.get(b):UNKNOWN;
  }
  if(n.type==='MemberExpression'&&n.object.type==='Identifier'&&bindings.get(n.object)===binding){
   const name=staticKey(n);return name===undefined?UNKNOWN:fieldValue(binding,name,seen);
  }
  if(n.type==='UnaryExpression'){
   if(n.operator==='typeof'&&n.argument.type==='Identifier'&&ix.free(n.argument,'undefined'))return 'undefined';
   const value=constantValue(n.argument,binding,env,seen);if(value===UNKNOWN)return UNKNOWN;
   if(n.operator==='!')return !value;
   if(n.operator==='void')return undefined;
   if(n.operator==='typeof')return typeof value;
   if(n.operator==='+')return +value;
   if(n.operator==='-')return -value;
   return UNKNOWN;
  }
  if(n.type==='BinaryExpression'){
   const a=constantValue(n.left,binding,env,seen),b=constantValue(n.right,binding,env,seen);
   if(a===UNKNOWN||b===UNKNOWN)return UNKNOWN;
   switch(n.operator){
    case '===':return a===b;
    case '!==':return a!==b;
    case '==':return primitive(a)&&primitive(b)&&typeof a===typeof b?a===b:UNKNOWN;
    case '!=':return primitive(a)&&primitive(b)&&typeof a===typeof b?a!==b:UNKNOWN;
    case '<':return a<b;case '<=':return a<=b;case '>':return a>b;case '>=':return a>=b;
    case '+':return primitive(a)&&primitive(b)&&(typeof a==='string'||typeof b==='string')?String(a)+String(b):a+b;
    case '-':return a-b;case '*':return a*b;case '/':return a/b;case '%':return a%b;
    default:return UNKNOWN;
   }
  }
  if(n.type==='LogicalExpression'){
   const a=constantValue(n.left,binding,env,seen);if(a===UNKNOWN)return UNKNOWN;
   if(n.operator==='&&')return a?constantValue(n.right,binding,env,seen):a;
   if(n.operator==='||')return a?a:constantValue(n.right,binding,env,seen);
   if(n.operator==='??')return a==null?constantValue(n.right,binding,env,seen):a;
   return UNKNOWN;
  }
  if(n.type==='ConditionalExpression'){
   const test=constantValue(n.test,binding,env,seen);if(test===UNKNOWN)return UNKNOWN;
   return constantValue(test?n.consequent:n.alternate,binding,env,seen);
  }
  return UNKNOWN;
 }
 function literal(value){
  if(value===undefined)return 'undefined';
  if(value===null)return 'null';
  if(typeof value==='string')return JSON.stringify(value);
  if(typeof value==='boolean')return String(value);
  if(typeof value==='number'&&!Number.isNaN(value))return Object.is(value,-0)?'-0':String(value);
  return null;
 }
 for(const call of nodes){
  if(call.type!=='CallExpression'||call.optional||call.callee.type!=='MemberExpression'||call.arguments.some(a=>a.type==='SpreadElement'))continue;
  const object=call.callee.object,name=staticKey(call.callee);
  if(object.type!=='Identifier'||name===undefined)continue;
  const binding=bindings.get(object),info=infoFor(binding),method=info?.fields.get(name);
  if(!info||call.start<info.end||info.written.has(name)||!functions.has(method?.type)||method.async||method.generator||method.body.type==='BlockStatement'&&method.body.body.length!==1)continue;
  if(method.params.some(p=>p.type!=='Identifier'||bindings.get(p)?.writes.length)||call.arguments.length!==method.params.length)continue;
  if(index(method).nodes.some(n=>n.type==='ThisExpression'||n.type==='Identifier'&&n.name==='arguments'&&!bindings.has(n)))continue;
  const expression=method.body.type==='BlockStatement'?method.body.body[0]?.type==='ReturnStatement'?method.body.body[0].argument:null:method.body;
  if(!expression)continue;
  const env=new Map();
  let valid=true;
  for(let i=0;i<method.params.length;i++){
   const value=constantValue(call.arguments[i],binding,new Map(),new Set());
   if(value===UNKNOWN){valid=false;break;}
   env.set(bindings.get(method.params[i]),value);
  }
  if(!valid)continue;
  const value=constantValue(expression,binding,env,new Set()),replacement=literal(value);
  if(replacement!==null)edits.push({start:call.start,end:call.end,replacement});
 }
 if(!edits.length)return source;
 let output=source;
 for(const edit of edits.sort((a,b)=>b.start-a.start))output=output.slice(0,edit.start)+edit.replacement+output.slice(edit.end);
 return output;
}
// 最终产物里若仍有缺失的 Node/浏览器全局探测，且探测结果流入未知函数，
// 就不能用“目标宿主缺失”解释它的用途。保留拒绝，避免把探针结果交给
// 未解析代码后产生与宿主能力相关的分支。
export function assertSafeMissingGlobalProbes(source){
 const ix=index(parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}));
 const missing=new Set(['window','global','module','exports','process','require','importModule','document','$drive']);
 for(const n of ix.nodes)if(n.type==='UnaryExpression'&&n.operator==='typeof'&&n.argument.type==='Identifier'&&missing.has(n.argument.name)&&ix.free(n.argument)&&!probeResultSafeAt(ix,n))throw Error('Node/浏览器全局缺失探测结果传入了未知代码，无法证明可折叠：'+n.argument.name);
}
function fold(source,format,options,qxHint){
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree);
 const declarationCounts=new Map(),variableDeclarators=new Map(),thisExpressions=[];
 for(const n of ix.nodes){
  if(n.type==='VariableDeclarator'){
   const b=ix.bindings.get(n.id);
   if(b){
    declarationCounts.set(b,(declarationCounts.get(b)??0)+1);
    if(!variableDeclarators.has(b))variableDeclarators.set(b,[]);
    variableDeclarators.get(b).push(n);
   }
  }else if(n.type==='FunctionDeclaration'){
   const b=ix.bindings.get(n.id);if(b)declarationCounts.set(b,(declarationCounts.get(b)??0)+1);
  }
  if(n.type==='ThisExpression')thisExpressions.push(n);
 }
 thisExpressions.sort((a,b)=>a.start-b.start);
 function containsThis(fn){
  let low=0,high=thisExpressions.length;
  while(low<high){const middle=(low+high)>>1;if(thisExpressions[middle].start<fn.start)low=middle+1;else high=middle;}
  return low<thisExpressions.length&&thisExpressions[low].start>=fn.start&&thisExpressions[low].end<=fn.end;
 }
 const used=name=>ix.nodes.some(n=>ix.free(n,name)&&!(ix.parents.get(n)?.operator==='typeof')||n.type==='MemberExpression'&&ix.free(n.object,'globalThis')&&property(n)===name);
 const qx=qxHint??(format==='qx'||(used('$task')&&!used('$httpClient')));
 const records=new WeakSet();
 // 只由字面量和函数 AST 构成的表不依赖调用参数或当前递归路径。同一 AST
 // 可能被大量成员访问反复求值；复用同一个记录可以避免反复构造数千字段，
 // 记录本身只读，身份也不参与任何运行时语义。
 const staticObjectRecords=new WeakMap(),staticObjectKeys=new WeakMap();
 const staticObjectRecord=n=>{
  if(staticObjectKeys.has(n))return staticObjectKeys.get(n);
  const valid=n.properties.every(p=>p.type==='Property'&&p.kind==='init'&&key(p)!==undefined&&key(p)!=='__proto__'&&(functions.has(p.value?.type)||p.value?.type==='Literal'&&!p.value.regex));
  staticObjectKeys.set(n,valid);return valid;
 };
 const stableRegexTest=!ix.nodes.some(n=>ix.free(n,'RegExp')||n.type==='MemberExpression'&&(['constructor','prototype'].includes(property(n))||property(n)==='test'&&(ix.parents.get(n)?.type==='AssignmentExpression'||ix.parents.get(n)?.type==='UpdateExpression'||ix.parents.get(n)?.operator==='delete')));
 const readonlyRecords=new Map();
 function readonlyRecord(b){
  if(readonlyRecords.has(b))return readonlyRecords.get(b);
  const safe=b.refs.filter(r=>!b.writes.some(w=>w.left===r)).every(r=>{const p=ix.parents.get(r),q=ix.parents.get(p);
   if(p?.type==='MemberExpression'&&p.object===r)return property(p)!==undefined&&!(q?.type==='AssignmentExpression'&&q.left===p||q?.type==='UpdateExpression'||q?.operator==='delete'||['ForInStatement','ForOfStatement'].includes(q?.type)&&q.left===p);
   // 真值判断、typeof/void 观察和纯表达式语句只读取对象值，不会让对象或
   // 方法逃逸；成员写入仍由上面的分支拒绝。
   if(p?.type==='ConditionalExpression'&&p.test===r||
      ['IfStatement','WhileStatement','DoWhileStatement'].includes(p?.type)&&p.test===r||
      p?.type==='UnaryExpression'&&['!','typeof','void'].includes(p.operator)||
      p?.type==='ExpressionStatement'&&p.expression===r)return true;
   return p?.type==='VariableDeclarator'&&p.init===r&&p.id.type==='ObjectPattern'&&p.id.properties.every(v=>v.type==='Property'&&!v.computed&&v.value.type==='Identifier');
  });readonlyRecords.set(b,safe);return safe;
 }
 let parameters=new Map();
 const rootParameters=parameters,rootValueCache=new WeakMap();
 const assignedInitializers=new Map();
 for(const n of ix.nodes)if(n.type==='VariableDeclarator'&&n.id.type==='Identifier'&&!n.init){
  const b=ix.bindings.get(n.id),write=b?.writes[0],fn=ix.owners.get(write),parent=ix.parents.get(fn),id=fn?.id??(parent?.type==='VariableDeclarator'?parent.id:null),callee=id?ix.bindings.get(id):null;
  if(declarationCounts.get(b)!==1||b?.writes.length!==1||write.type!=='AssignmentExpression'||write.operator!=='='||write.left.type!=='Identifier'||ix.bindings.get(write.left)!==b||!callee||fn.async||fn.generator||callee.writes.length||callee.refs.length!==1||declarationCounts.get(callee)!==1||fn.body.type!=='BlockStatement')continue;
  let enclosing=write;while(ix.parents.get(enclosing)?.type==='SequenceExpression')enclosing=ix.parents.get(enclosing);
  const container=ix.parents.get(enclosing);
  if(!(container?.type==='ExpressionStatement'||container?.type==='IfStatement'&&container.test===enclosing)||ix.parents.get(container)!==fn.body)continue;
  const call=ix.parents.get(callee.refs[0]),statement=ix.parents.get(call);
  if(call?.type==='CallExpression'&&call.callee===callee.refs[0]&&statement?.type==='ExpressionStatement'&&ix.parents.get(statement)===tree)assignedInitializers.set(b,{value:write.right,statement,write,fn});
 }
 function insideInitializer(assigned,ref){
  let entry=ref;
  while(ix.owners.get(entry)!==assigned.fn){const fn=ix.owners.get(entry),call=ix.parents.get(fn);if(call?.type!=='CallExpression'||call.callee!==fn||fn.async||fn.generator)return false;entry=call;}
  return entry.start>=assigned.write.end;
 }
 const pureProbe=n=>!!n&&(n.type==='Literal'||n.type==='Identifier'&&ix.free(n,'undefined')||n.type==='UnaryExpression'&&(n.operator==='typeof'&&n.argument.type==='Identifier'||pureProbe(n.argument))||['BinaryExpression','LogicalExpression'].includes(n.type)&&pureProbe(n.left)&&pureProbe(n.right));
 // Object arguments may be omitted on another rule sharing the same script.
 // Keep typeof at runtime; presence is a rule input, not a platform constant.
 const entries=options.entry_types;
 const stages=Array.isArray(entries)&&entries.length&&entries.every(s=>['http_request','http_response','schedule','generic','network'].includes(s))?new Set(entries):null;
 const stageType=(present)=>stages&&[...stages].every(s=>present.includes(s))?'object':stages&&[...stages].every(s=>!present.includes(s))?'undefined':UNKNOWN;
 const types={Egern:'object',$request:stageType(['http_request','http_response']),$response:stageType(['http_response']),$task:qx?'object':'undefined',$httpClient:qx?'undefined':'object',$notification:qx?'undefined':'object',$notify:qx?'function':'undefined',$done:'function',$argument:options.argument_object?UNKNOWN:'string',$prefs:qx?'object':'undefined',$persistentStore:qx?'undefined':'object',$utils:'object',$script:'object',$network:'object',$environment:['surge','stash'].includes(format)?'object':'undefined',$cronexp:'string',$loon:format==='loon'?'string':'undefined',$rocket:format==='shadowrocket'?'string':'undefined',$native:'undefined',$app:'undefined',$http:'undefined',$push:'undefined',$context:'undefined',
  // Egern's native script runtime is neither Node.js nor a browser. These
  // free host globals therefore cannot select compatibility-only branches;
  // lexical declarations with the same names remain untouched by ix.free.
  module:'undefined',process:'undefined',require:'undefined',global:'undefined'};
 for(const [name,type] of Object.entries(types))if((type==='object'||type==='function')&&!PRESENT_GLOBALS.has(name))PRESENT_GLOBALS.set(name,Symbol('present:'+name));
 const presentGlobalNames=new Map([...PRESENT_GLOBALS].map(([name,marker])=>[marker,name]));
 // Some bundled SDKs detect their host through an isolated enumerable-key
 // snapshot. Fold only closed membership probes; never fabricate a complete
 // global object or discard an escaped/mutated array.
 const globalMembership=new WeakMap(),keySnapshots=new WeakSet();
 const markers=new Map(['$task','$loon','$rocket','$environment'].map(name=>[name,false]));markers.set('Egern',true);
 // 目标宿主确定没有的 Node/浏览器全局。只有直接读取 `globalThis` 上这些
 // 静态成员时才折叠；动态成员、裸值和任何可能改写成员关系的写入仍拒绝。
 const absentMembers=new Set(['process','require','module','global','window']);
 const probeResultSafe=start=>probeResultSafeAt(ix,start);
 function absentMemberProbeResult(n){
  let current=n;
  for(let parent=ix.parents.get(current);parent;current=parent,parent=ix.parents.get(current)){
   if(parent.type==='MemberExpression'&&parent.object===current){if(parent.computed)return false;continue;}
   if(parent.type==='ChainExpression'&&parent.expression===current)continue;
   if(parent.type==='CallExpression'&&parent.callee.type==='Identifier'&&ix.free(parent.callee,'Boolean')&&parent.arguments.length===1&&parent.arguments[0]===current)return probeResultSafe(parent)?true:null;
   if(parent.type==='UnaryExpression'&&parent.argument===current)return ['!','typeof'].includes(parent.operator)&&probeResultSafe(parent)?true:null;
   if(parent.type==='BinaryExpression'&&(parent.left===current||parent.right===current)){
    const other=parent.left===current?parent.right:parent.left;
    if(['==','!=','===','!=='].includes(parent.operator)&&(ix.free(other,'undefined')||other?.type==='Literal'&&other.value===null))return probeResultSafe(parent)?true:null;
    return null;
   }
   if(parent.type==='LogicalExpression'&&(parent.left===current||parent.right===current))return probeResultSafe(parent)?true:null;
   if(parent.type==='ConditionalExpression'&&parent.test===current)return true;
   if(['IfStatement','WhileStatement','DoWhileStatement','ForStatement'].includes(parent.type)&&parent.test===current)return true;
   if(parent.type==='SwitchCase'&&parent.test===current)return true;
   return null;
  }
  return null;
 }
 // 只有可能改变 globalThis 成员关系（自身属性、原型链或 Object.keys/Array.includes
  // 契约）的写入才否定探针。普通库函数改写自己的 prototype 不影响宿主全局。
 const written=n=>{const p=ix.parents.get(n);return p?.type==='AssignmentExpression'&&p.left===n||p?.type==='UpdateExpression'||p?.operator==='delete';};
 const prototypeChain=n=>{
  for(let o=n;o?.type==='MemberExpression';o=o.object)if(property(o)==='prototype'&&(ix.free(o.object,'Object')||ix.free(o.object,'Array')))return true;
  return false;
 };
 const probeBuiltinsStable=!ix.nodes.some(n=>{
  if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&ix.free(n.callee.object,'Object')&&['assign','defineProperty','defineProperties','setPrototypeOf'].includes(property(n.callee))){
   const target=n.arguments[0];
   return n.arguments.some(a=>ix.free(a,'globalThis'))||target&&(ix.free(target,'globalThis')||prototypeChain(target));
  }
  if(n.type==='MemberExpression'&&written(n)){
   if(property(n)==='keys'&&ix.free(n.object,'Object'))return true;
   if(property(n)==='includes'&&n.object.type==='MemberExpression'&&property(n.object)==='prototype'&&ix.free(n.object.object,'Array'))return true;
   if(prototypeChain(n))return true;
  }
  if(n.type==='Identifier'&&markers.has(n.name)&&ix.free(n)&&written(n))return true;
  if(n.type==='Identifier'&&ix.free(n,'globalThis')&&written(n))return true;
  if(n.type==='MemberExpression'&&ix.free(n.object,'globalThis')&&(property(n)===undefined||markers.has(property(n))||absentMembers.has(property(n)))&&written(n))return true;
  return false;
 });
 // 只折叠对已知平台标记的 `'name' in globalThis` 查询。未知名称仍保持未知，
 // 避免把“当前没有观测到”误当成宿主全局一定不存在。
 function membershipProbe(n,seen){
  if(!probeBuiltinsStable||n?.type!=='BinaryExpression'||n.operator!=='in')return UNKNOWN;
  if(!ix.free(n.right,'globalThis'))return UNKNOWN;
  const name=value(n.left,new Set(seen));
  if(typeof name!=='string')return UNKNOWN;
  return markers.has(name)?markers.get(name):UNKNOWN;
 }
 if(probeBuiltinsStable)for(const d of ix.nodes)if(d.type==='VariableDeclarator'&&d.id.type==='Identifier'){
  const call=d.init,b=ix.bindings.get(d.id);
  if(call?.type!=='CallExpression'||call.optional||call.arguments.length!==1||!ix.free(call.arguments[0],'globalThis')||call.callee.type!=='MemberExpression'||!ix.free(call.callee.object,'Object')||property(call.callee)!=='keys'||!b?.refs.length||b.writes.length||declarationCounts.get(b)!==1)continue;
  const queries=b.refs.map(r=>{const m=ix.parents.get(r),c=ix.parents.get(m);return m?.type==='MemberExpression'&&m.object===r&&property(m)==='includes'&&c?.type==='CallExpression'&&c.callee===m&&!c.optional&&c.arguments.length===1&&c.arguments[0].type==='Literal'&&markers.has(c.arguments[0].value)?c:null;});
  if(queries.some(c=>!c)||b.refs.some(r=>!dominates(b,r)))continue;
  keySnapshots.add(call);for(const query of queries)globalMembership.set(query,markers.get(query.arguments[0].value));
 }
 // 平台版本成员的存在性只保证宿主给出了版本字符串，具体版本值仍然未知。
 // 脚本常以字符串 "undefined" 作为缺失哨兵；存在性已证时，该哨兵不可能等于
 // 版本值。除此之外的任何字符串比较都必须继续保持未知，不能按名称猜测。
 function presentVersionComparison(operator,a,b){
  if(!['===','!==','==','!='].includes(operator)||a!==PRESENT_VERSION&&b!==PRESENT_VERSION||a===PRESENT_VERSION&&b===PRESENT_VERSION)return undefined;
  const other=a===PRESENT_VERSION?b:a;
  if(other!=='undefined')return undefined;
  return ['===','=='].includes(operator)?false:true;
 }
 function valueExpression(root,seen){
  const stack=[{node:root,state:'start'}];let result=UNKNOWN;
  function complete(value){const frame=stack.pop(),parent=stack.at(-1);if(parent){parent.child=value;parent.hasChild=true;}else result=value;}
  while(stack.length){
   const frame=stack.at(-1),n=frame.node;
   if(frame.state==='start'){
    if(n.type==='UnaryExpression'){
     if(n.operator==='typeof'&&['window','global','module','exports','process','require','importModule','document','$drive'].some(name=>ix.free(n.argument,name))){complete(probeResultSafe(n)?'undefined':UNKNOWN);continue;}
     if(n.operator==='typeof'&&ix.free(n.argument,'globalThis')){complete('object');continue;}
     if(n.operator==='typeof'&&n.argument.type==='ChainExpression'){frame.argument=n.argument.expression;}
     else if(n.operator==='typeof'&&n.argument.type==='MemberExpression'&&ix.free(n.argument.object,'$utils')&&property(n.argument)==='ungzip'){complete('function');continue;}
     else if(n.operator==='typeof'&&n.argument.type==='MemberExpression'&&ix.free(n.argument.object,'$task')&&property(n.argument)==='fetch'&&types.$task==='object'){complete('function');continue;}
     else if(n.operator==='typeof'&&ix.free(n.argument)&&n.argument.name.startsWith('$')){complete(Object.hasOwn(types,n.argument.name)?types[n.argument.name]:UNKNOWN);continue;}
     frame.state='unary';stack.push({node:frame.argument??n.argument,state:'start'});continue;
    }
    if(n.type==='BinaryExpression'){
     const membership=membershipProbe(n,seen);
     if(membership!==UNKNOWN){complete(membership);continue;}
     frame.state='binary-left';stack.push({node:n.left,state:'start'});continue;
    }
    if(n.type==='LogicalExpression'){frame.state='logical-left';stack.push({node:n.left,state:'start'});continue;}
    if(n.type==='ConditionalExpression'){frame.state='conditional-test';stack.push({node:n.test,state:'start'});continue;}
    complete(valueImpl(n,seen));continue;
   }
   if(frame.state==='unary'){
    const v=frame.child;if(v===UNKNOWN){complete(UNKNOWN);continue;}
    if(v&&records.has(v)&&!['typeof','!','void'].includes(n.operator)){complete(UNKNOWN);continue;}
    if(v===PRESENT_VERSION){complete(n.operator==='!'?false:UNKNOWN);continue;}
    if(n.operator==='!'){complete(!v);continue;}if(n.operator==='typeof'){complete(typeof v);continue;}
    if(n.operator==='+'){complete(+v);continue;}if(n.operator==='-'){complete(-v);continue;}if(n.operator==='void'){complete(undefined);continue;}
    complete(UNKNOWN);continue;
   }
   if(frame.state==='binary-left'){
    frame.left=frame.child;frame.state='binary-right';stack.push({node:n.right,state:'start'});continue;
   }
   if(frame.state==='binary-right'){
    const a=frame.left,b=frame.child,presence=presentVersionComparison(n.operator,a,b);
    if(presence!==undefined){complete(presence);continue;}
    if(a===UNKNOWN||b===UNKNOWN||a===PRESENT_VERSION||b===PRESENT_VERSION){complete(UNKNOWN);continue;}
    const presentA=presentGlobalNames.get(a),presentB=presentGlobalNames.get(b);
    if(presentA||presentB){
     if(['===','!==','==','!='].includes(n.operator)){
      let equal;
      if(presentA&&presentB)equal=presentA===presentB?true:undefined;
      else{const other=presentA?b:a;if(other===undefined||other===null||['string','number','boolean','bigint'].includes(typeof other))equal=false;}
      if(equal!==undefined){complete(['===','=='].includes(n.operator)?equal:!equal);continue;}
     }
     complete(UNKNOWN);continue;
    }
    if(a&&records.has(a)||b&&records.has(b)){complete(UNKNOWN);continue;}
    switch(n.operator){case '===':complete(a===b);break;case '!==':complete(a!==b);break;case '==':complete(a==b);break;case '!=':complete(a!=b);break;case '+':complete(a+b);break;case '*':complete(a*b);break;case '/':complete(a/b);break;case '<':complete(a<b);break;case '>':complete(a>b);break;default:complete(UNKNOWN);}
    continue;
   }
   if(frame.state==='logical-left'){
    const a=frame.child;if(a===UNKNOWN){complete(UNKNOWN);continue;}
    if(n.operator==='&&'&&!a||n.operator==='||'&&a||n.operator==='??'&&a!==null&&a!==undefined){complete(a);continue;}
    frame.state='logical-right';stack.push({node:n.right,state:'start'});continue;
   }
   if(frame.state==='logical-right'){complete(frame.child);continue;}
   if(frame.state==='conditional-test'){
    const test=frame.child;if(test===UNKNOWN){complete(UNKNOWN);continue;}
    frame.state='conditional-branch';stack.push({node:test?n.consequent:n.alternate,state:'start'});continue;
   }
   if(frame.state==='conditional-branch'){complete(frame.child);continue;}
  }
  return result;
 }
 function value(n,seen){
  const rootContext=parameters===rootParameters&&(!seen||seen.size===0);
  if(n&&rootContext&&rootValueCache.has(n))return rootValueCache.get(n);
  const expression=['UnaryExpression','BinaryExpression','LogicalExpression','ConditionalExpression'].includes(n?.type);
  const result=expression?valueExpression(n,seen??new Set()):valueImpl(n,seen??new Set());
  if(n&&rootContext)rootValueCache.set(n,result);
  return result;
 }
 function valueImpl(n,seen){
  if(!n)return UNKNOWN;
  if(globalMembership.has(n))return globalMembership.get(n);
  if(keySnapshots.has(n)){const snapshot=[];records.add(snapshot);return snapshot;}
  if(n.type==='Literal')return n.value;
  if(n.type==='MemberExpression'&&ix.free(n.object,'$task')&&property(n)==='fetch'&&types.$task==='object')return PRESENT_VERSION;
  if(n.type==='Identifier'&&ix.free(n)){
   if(Object.hasOwn(types,n.name)&&types[n.name]==='undefined')return undefined;
   if((types[n.name]==='object'||types[n.name]==='function')&&PRESENT_GLOBALS.has(n.name))return PRESENT_GLOBALS.get(n.name);
  }
  if(n.type==='TemplateLiteral'&&!n.expressions.length)return n.quasis[0].value.cooked;
  if(n.type==='ObjectExpression'){
   const cacheable=staticObjectRecord(n);
   if(cacheable&&staticObjectRecords.has(n))return staticObjectRecords.get(n);
   const out=Object.create(null);for(const p of n.properties){if(p.type!=='Property'||p.kind!=='init'||key(p)===undefined||key(p)==='__proto__')return UNKNOWN;
    // Closed Env factories often expose platform predicates as object methods.
    // Retain the function AST as data so a direct call can be folded below;
    // no callback, alias or escaped method reference is admitted.
    if(functions.has(p.value?.type)){out[key(p)]=p.value;continue;}
    const v=value(p.value,new Set(seen));if(v===UNKNOWN&&!pureProbe(p.value)||v===PRESENT_VERSION||v!==null&&typeof v==='object')return UNKNOWN;out[key(p)]=v;
   }records.add(out);if(cacheable)staticObjectRecords.set(n,out);return out;
  }
  if(n.type==='MemberExpression'&&ix.free(n.object,'$environment')){
   const name=property(n);
   if(name==='surge-version')return format==='surge'?PRESENT_VERSION:undefined;
   if(name==='stash-version')return format==='stash'?PRESENT_VERSION:undefined;
  }
  if(n.type==='MemberExpression'&&!n.computed&&ix.free(n.object,'globalThis')&&absentMembers.has(property(n))&&probeBuiltinsStable&&absentMemberProbeResult(n))return undefined;
  if(n.type==='MemberExpression'){const object=value(n.object,new Set(seen));if(object&&records.has(object)&&Object.hasOwn(object,property(n)))return object[property(n)];}
  if(n.type==='Identifier'){
   if(ix.free(n,'undefined'))return undefined;
   if(parameters.has(ix.bindings.get(n)))return parameters.get(ix.bindings.get(n));
   const b=ix.bindings.get(n);
   if(b&&!b.init&&!b.writes.length){
    const declarations=variableDeclarators.get(b)??[];
    if(declarations.length===1){const declaration=declarations[0],statement=ix.parents.get(declaration),owner=ix.parents.get(statement);
     if(statement?.type==='VariableDeclaration'&&owner&&(['var'].includes(statement.kind)||initializedAfter(ix,statement,n)))return undefined;
    }
   }
   if(b?.init&&!b.writes.length&&!seen.has(b)&&dominates(b,n)){const next=new Set(seen);next.add(b);const v=value(b.init,next);return v&&records.has(v)&&!readonlyRecord(b)?UNKNOWN:v;}
   const assigned=assignedInitializers.get(b);if(assigned&&!seen.has(b)&&(initializedAfter(ix,assigned.statement,n)||insideInitializer(assigned,n))){const next=new Set(seen);next.add(b);const v=value(assigned.value,next);return v&&records.has(v)&&!readonlyRecord(b)?UNKNOWN:v;}return UNKNOWN;
  }
  if(stableRegexTest&&n.type==='CallExpression'&&!n.optional&&n.arguments.length===1&&n.callee.type==='MemberExpression'&&property(n.callee)==='test'&&n.callee.object.regex){
   const {pattern,flags}=n.callee.object.regex,match=/^\^([A-Za-z0-9_@:/-]+)(\$?)$/.exec(pattern),text=value(n.arguments[0],new Set(seen));
   if(!flags&&match){
    const test=text=>match[2]?text===match[1]:text.startsWith(match[1]);
    if(typeof text==='string')return test(text);
    const b=n.arguments[0].type==='Identifier'?ix.bindings.get(n.arguments[0]):null;
    if(b&&!b.writes.length){
     const fn=ix.owners.get(n),position=fn.params?.findIndex(p=>p.type==='Identifier'&&ix.bindings.get(p)===b),parent=ix.parents.get(fn),fb=ix.bindings.get(fn.id??(parent?.type==='VariableDeclarator'?parent.id:null));
     if(position>=0&&fb&&!fb.writes.length&&fb.refs.length&&fb.refs.every(r=>ix.parents.get(r)?.type==='CallExpression'&&ix.parents.get(r).callee===r)){
      const actual=fb.refs.map(r=>value(ix.parents.get(r).arguments[position],new Set([...seen,fb])));
      if(actual.every(v=>typeof v==='string')&&actual.every(v=>test(v)===test(actual[0])))return test(actual[0]);
     }
    }
   }
  }
  if(n.type==='CallExpression'&&!n.optional&&(n.callee.type==='Identifier'||functions.has(n.callee.type)||n.callee.type==='MemberExpression')&&n.arguments.every(a=>a.type!=='SpreadElement'&&value(a,new Set(seen))!==UNKNOWN)){
   const direct=functions.has(n.callee.type),b=n.callee.type==='Identifier'?ix.bindings.get(n.callee):null;
   const fn=direct?n.callee:b?b.init:value(n.callee,new Set(seen));
   const methodCall=n.callee.type==='MemberExpression'&&functions.has(fn?.type);
   const methodObject=n.callee.object;
   const methodBinding=methodObject?.type==='Identifier'?ix.bindings.get(methodObject):null;
   const closedMethod=methodCall&&(!methodBinding||methodBinding.init&&!methodBinding.writes.length&&methodBinding.refs.every(r=>{
    const m=ix.parents.get(r),call=ix.parents.get(m);
    return m?.type==='MemberExpression'&&m.object===r&&property(m)!==undefined&&call?.type==='CallExpression'&&call.callee===m&&!call.optional;
   }))&&!containsThis(fn);
   if((direct||b&&!b.writes.length&&!seen.has(b)||closedMethod)&&!seen.has(fn)&&functions.has(fn?.type)&&!fn.async&&!fn.generator&&fn.params.every(p=>(p.type==='Identifier'||p.type==='AssignmentPattern'&&p.left.type==='Identifier')&&!ix.bindings.get(p.type==='AssignmentPattern'?p.left:p)?.writes.length)&&
     (direct||closedMethod||((fn.type==='FunctionDeclaration'||dominates(b,n.callee))&&
     declarationCounts.get(b)===1&&
     b.refs.every(r=>{const p=ix.parents.get(r);return p?.type==='CallExpression'&&p.callee===r&&!p.optional;})))){
    const next=new Set(seen);next.add(fn);if(b)next.add(b);const actual=n.arguments.map(a=>value(a,new Set(seen))),previous=parameters;parameters=new Map(parameters);
    try{
     for(let i=0;i<fn.params.length;i++){const p=fn.params[i],v=actual[i]===undefined&&p.type==='AssignmentPattern'?value(p.right,new Set(next)):actual[i];if(v===UNKNOWN)return UNKNOWN;parameters.set(ix.bindings.get(p.type==='AssignmentPattern'?p.left:p),v);}
     const result=fn.body.type==='BlockStatement'?returned(fn.body,next):value(fn.body,next);
     return ['boolean','string'].includes(typeof result)||result===undefined||result===PRESENT_VERSION||result&&records.has(result)?result:UNKNOWN;
    }finally{parameters=previous;}
   }
  }
  if(n.type==='UnaryExpression'){
   if(n.operator==='typeof'&&['window','global','module','exports','process','require','importModule','document','$drive'].some(name=>ix.free(n.argument,name)))return probeResultSafe(n)?'undefined':UNKNOWN;
   if(n.operator==='typeof'&&ix.free(n.argument,'globalThis'))return 'object';
   if(n.operator==='typeof'&&n.argument.type==='ChainExpression')return value({...n,argument:n.argument.expression},seen);
   if(n.operator==='typeof'&&n.argument.type==='MemberExpression'&&ix.free(n.argument.object,'$utils')&&property(n.argument)==='ungzip')return 'function';
   if(n.operator==='typeof'&&ix.free(n.argument)&&n.argument.name.startsWith('$'))return Object.hasOwn(types,n.argument.name)?types[n.argument.name]:UNKNOWN;
   const v=value(n.argument,seen);if(v===UNKNOWN)return UNKNOWN;
   if(v&&records.has(v)&&!['typeof','!','void'].includes(n.operator))return UNKNOWN;
   if(v===PRESENT_VERSION)return n.operator==='!'?false:UNKNOWN;
   if(n.operator==='!')return !v;if(n.operator==='typeof')return typeof v;if(n.operator==='+')return +v;if(n.operator==='-')return -v;if(n.operator==='void')return undefined;
  }
  if(n.type==='BinaryExpression'){
   const membership=membershipProbe(n,seen);if(membership!==UNKNOWN)return membership;
   const a=value(n.left,seen),b=value(n.right,seen),presence=presentVersionComparison(n.operator,a,b);
   if(presence!==undefined)return presence;
   if(a===UNKNOWN||b===UNKNOWN||a===PRESENT_VERSION||b===PRESENT_VERSION)return UNKNOWN;
   const presentA=presentGlobalNames.get(a),presentB=presentGlobalNames.get(b);
   if(presentA||presentB){
    if(['===','!==','==','!='].includes(n.operator)){
     let equal;
     if(presentA&&presentB)equal=presentA===presentB?true:undefined;
     else {const other=presentA?b:a;if(other===undefined||other===null||['string','number','boolean','bigint'].includes(typeof other))equal=false;}
     if(equal!==undefined)return ['===','=='].includes(n.operator)?equal:!equal;
    }
    return UNKNOWN;
   }
   if(a&&records.has(a)||b&&records.has(b))return UNKNOWN;
   switch(n.operator){case '===':return a===b;case '!==':return a!==b;case '==':return a==b;case '!=':return a!=b;case '+':return a+b;case '*':return a*b;case '/':return a/b;case '<':return a<b;case '>':return a>b;}
  }
  if(n.type==='ConditionalExpression'){const t=value(n.test,seen);return t===UNKNOWN?UNKNOWN:value(t?n.consequent:n.alternate,seen);}
  if(n.type==='LogicalExpression'){const a=value(n.left,seen);if(a===UNKNOWN)return UNKNOWN;return n.operator==='&&'?(a?value(n.right,seen):a):n.operator==='||'?(a?a:value(n.right,seen)):(a??value(n.right,seen));}
  return UNKNOWN;
 }
 const NO_RETURN=Symbol('no return');
 function returned(n,seen){
  if(!n)return NO_RETURN;
  if(n.type==='ReturnStatement')return n.argument?value(n.argument,seen):undefined;
  if(n.type==='BlockStatement'){for(const s of n.body){const v=returned(s,seen);if(v!==NO_RETURN)return v;}return NO_RETURN;}
  if(n.type==='IfStatement'){const t=value(n.test,seen);return t===UNKNOWN?UNKNOWN:returned(t?n.consequent:n.alternate,seen);}
  if(n.type==='SwitchStatement'){
   const subject=value(n.discriminant,seen);if(subject===UNKNOWN)return UNKNOWN;
   let start=-1,fallback=-1;
   for(let i=0;i<n.cases.length;i++){
    const branch=n.cases[i];
    if(!branch.test){fallback=i;continue;}
    const test=value(branch.test,seen);if(test===UNKNOWN)return UNKNOWN;
    if(subject===test){start=i;break;}
   }
   if(start<0)start=fallback;if(start<0)return NO_RETURN;
   for(let i=start;i<n.cases.length;i++)for(const statement of n.cases[i].consequent){
    if(statement.type==='ReturnStatement')return statement.argument?value(statement.argument,seen):undefined;
    if(statement.type==='BreakStatement')return NO_RETURN;
    if(statement.type==='EmptyStatement'||statement.type==='FunctionDeclaration')continue;
    if(statement.type==='VariableDeclaration'&&statement.declarations.every(d=>d.id.type==='Identifier'&&d.init&&(functions.has(d.init.type)||value(d.init,new Set(seen))!==UNKNOWN)))continue;
    return UNKNOWN;
   }
   return NO_RETURN;
  }
  if(n.type==='EmptyStatement'||n.type==='FunctionDeclaration')return NO_RETURN;
  if(n.type==='VariableDeclaration'&&n.declarations.every(d=>d.id.type==='Identifier'&&d.init&&(functions.has(d.init.type)||value(d.init,new Set(seen))!==UNKNOWN)))return NO_RETURN;
  return UNKNOWN;
 }
 // A captured program constant is safe only when the entire prefix before its
 // initializer cannot execute user code. No call can enter a closure early.
 const inertCache=new WeakMap();
 function inert(n){
  if(!n)return true;
  if(inertCache.has(n))return inertCache.get(n);
  let result;
  if(['Literal','Identifier','FunctionDeclaration','FunctionExpression','ArrowFunctionExpression','EmptyStatement'].includes(n.type))result=n.type!=='Identifier';
  else if(n.type==='UnaryExpression')result=n.operator==='typeof'&&n.argument.type==='Identifier'||['!','void','+','-'].includes(n.operator)&&inert(n.argument);
  else if(['BinaryExpression','LogicalExpression'].includes(n.type))result=inert(n.left)&&inert(n.right);
  else if(n.type==='ConditionalExpression')result=inert(n.test)&&inert(n.consequent)&&inert(n.alternate);
  else if(n.type==='ObjectExpression')result=n.properties.every(p=>p.type==='Property'&&p.kind==='init'&&!p.computed&&(functions.has(p.value?.type)||inert(p.value)));
  else if(n.type==='ArrayExpression')result=n.elements.every(element=>element&&element.type!=='SpreadElement'&&inert(element));
  else if(n.type==='VariableDeclaration')result=n.declarations.every(d=>d.id.type==='Identifier'&&inert(d.init));
  else result=false;
  inertCache.set(n,result);return result;
 }
 // 仅用于折叠 `左值 && false` / `左值 || true`：左侧读取不得触发用户代码。
 // 裸 window 不进入 types，只有 typeof 探测可按目标宿主缺少该全局折叠。
 function safeBindingRead(n){
  const b=ix.bindings.get(n);
  if(!b||ix.free(n))return false;
  const owner=ix.owners.get(n);
  if(functions.has(owner?.type)&&owner.params.some(p=>p.type==='Identifier'&&ix.bindings.get(p)===b))return true;
  for(const declaration of ix.nodes){
   if(declaration.type==='FunctionDeclaration'&&ix.bindings.get(declaration.id)===b)return true;
   if(declaration.type==='CatchClause'&&declaration.param?.type==='Identifier'&&ix.bindings.get(declaration.param)===b)return true;
   if(declaration.type!=='VariableDeclarator'||ix.bindings.get(declaration.id)!==b)continue;
   const statement=ix.parents.get(declaration);
   return statement?.kind==='var'||!!statement&&initializedAfter(ix,statement,n);
  }
  return false;
 }
 function pureRead(n){
  if(!n)return true;
  if(n.type==='Literal'||functions.has(n.type))return true;
  if(n.type==='Identifier')return safeBindingRead(n);
  if(n.type==='UnaryExpression')return n.operator==='typeof'&&(n.argument.type==='Identifier'||pureRead(n.argument))||['!','void'].includes(n.operator)&&pureRead(n.argument);
  if(n.type==='BinaryExpression')return ['===','!=='].includes(n.operator)&&pureRead(n.left)&&pureRead(n.right);
  if(n.type==='LogicalExpression')return pureRead(n.left)&&pureRead(n.right);
  if(n.type==='ConditionalExpression')return pureRead(n.test)&&pureRead(n.consequent)&&pureRead(n.alternate);
  return false;
 }
 function dominates(binding,ref){
  const declaration=ix.parents.get(binding.init),statement=ix.parents.get(declaration),block=ix.parents.get(statement);
  if(declaration?.type!=='VariableDeclarator'||statement?.type!=='VariableDeclaration'||!['Program','BlockStatement'].includes(block?.type))return false;
  if(declarationCounts.get(binding)!==1)return false;
  // `var` 与 `const` 的差别只在初始化前读取；绑定没有任何写入时，嵌套函数
  // 若只会在声明之后进入，读到的同样是这个已初始化的对象字面量。
  if(ix.owners.get(ref)!==ix.owners.get(statement)){
   const index=statement.declarations.indexOf(declaration);
   const prefix=index>=0&&statement.declarations.slice(0,index+1).every(d=>d.id.type==='Identifier'&&inert(d.init));
   return prefix&&block.body.slice(0,block.body.indexOf(statement)).every(inert)||enteredAfter(ix.owners.get(ref),statement);
  }
  if(ref.start>=binding.init.end&&ref.end<=statement.end)return true;
  let enclosing=ref;while(ix.parents.get(enclosing)&&ix.parents.get(enclosing)!==block)enclosing=ix.parents.get(enclosing);
  return ix.parents.get(enclosing)===block&&enclosing.start>=statement.end;
 }
 // Calls unrelated to a captured constant need not invalidate its proof. Walk
 // every entry to a closed function instead: none may run before initialization
 // or escape to a callback whose invocation time we cannot establish.
 function enteredAfter(fn,statement,seen=new Set()){
  if(!functions.has(fn?.type)||seen.has(fn))return false;
  const next=new Set(seen);next.add(fn);
  const parent=ix.parents.get(fn);
  if(fn.type!=='FunctionDeclaration'&&ix.owners.get(parent)===ix.owners.get(statement)&&callAfter(parent,statement,new Set(seen)))return true;
  if(parent?.type==='CallExpression'&&parent.callee===fn)return callAfter(parent,statement,next);
  // A nested closure cannot be created (or escape) before its enclosing
  // function is entered, even when a host invokes that closure as a callback.
  const enclosing=ix.owners.get(parent);
  if(enclosing!==tree&&enclosing!==ix.owners.get(statement)&&enteredAfter(enclosing,statement,next))return true;
  const b=fn.id?ix.bindings.get(fn.id):ix.parents.get(fn)?.type==='VariableDeclarator'?ix.bindings.get(ix.parents.get(fn).id):null;
  if(!b||b.writes.length||declarationCounts.get(b)!==1||!b.refs.length)return false;
  return b.refs.every(ref=>{
   const call=ix.parents.get(ref);
   if(call?.type!=='CallExpression'||call.callee!==ref||call.optional)return false;
   return callAfter(call,statement,next);
  });
 }
 function callAfter(call,statement,seen){
  const owner=ix.owners.get(call);
  if(owner!==ix.owners.get(statement))return enteredAfter(owner,statement,seen);
  const block=ix.parents.get(statement);
  let enclosing=call;while(ix.parents.get(enclosing)&&ix.parents.get(enclosing)!==block)enclosing=ix.parents.get(enclosing);
  return ix.parents.get(enclosing)===block&&enclosing.start>=statement.end;
 }
 const render=root=>renderTree(source,root,n=>{
  if(keySnapshots.has(n))return {direct:true,value:'[]'};
  if(n.type==='FunctionDeclaration'&&!n.params.length&&!n.async&&!n.generator){
   const b=ix.bindings.get(n.id),block=ix.parents.get(n),owner=ix.parents.get(block),body=n.body.body;
   // Only statically pure, unused predicates can disappear here. Preserve
   // general unused functions: the compiler must still diagnose unsafe APIs
   // and missing completion paths rather than suppressing those diagnostics.
   if(b&&!b.refs.length&&!b.writes.length&&declarationCounts.get(b)===1&&
     (block?.type==='Program'||block?.type==='BlockStatement'&&functions.has(owner?.type)&&owner.body===block)&&
     body.length===1&&body[0].type==='ReturnStatement'&&[true,false,undefined,PRESENT_VERSION].includes(value(body[0].argument)))return {direct:true,value:''};
  }
  if(n.type==='VariableDeclarator'&&n.id.type==='Identifier'&&n.init){const v=value(n.init);if(typeof v==='boolean'||v===undefined)return {children:[n.id],render:child=>child(n.id)+' = '+(v===undefined?'void 0':String(v))};}
  if(n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id.type==='ObjectPattern'&&d.init)){
   const values=n.declarations.map(d=>value(d.init));
   const valid=(d,i)=>d.id.type==='ObjectPattern'&&values[i]&&records.has(values[i])&&d.id.properties.every(p=>p.type==='Property'&&!p.computed&&p.value.type==='Identifier'&&Object.hasOwn(values[i],key(p))&&values[i][key(p)]!==UNKNOWN);
   if(n.declarations.some(valid)){
    const items=n.declarations.flatMap((d,i)=>valid(d,i)?d.id.properties.map(p=>({node:p.value,value:values[i][key(p)],assignment:true})): [{node:d,assignment:false}]);
    return {children:items.map(item=>item.node),render:child=>n.kind+' '+items.map(item=>item.assignment?child(item.node)+' = '+(item.value===undefined?'void 0':JSON.stringify(item.value)):child(item.node)).join(', ')+';'};
   }
  }
  if(n.type==='CallExpression'){
   const v=value(n);
   if(v!==UNKNOWN&&v!==PRESENT_VERSION&&(v===undefined||v===null||['boolean','string'].includes(typeof v)||typeof v==='number'&&Number.isFinite(v)))return {direct:true,value:v===undefined?'(void 0)':JSON.stringify(v)};
  }
  if(n.type==='MemberExpression'){const v=value(n);if(v!==UNKNOWN&&v!==PRESENT_VERSION&&(v===undefined||v===null||['boolean','string'].includes(typeof v)))return {direct:true,value:v===undefined?'(void 0)':JSON.stringify(v)};}
  if(n.type==='BinaryExpression'){const v=value(n);if(v!==UNKNOWN&&v!==PRESENT_VERSION&&(v===undefined||v===null||['boolean','string','number'].includes(typeof v)))return {direct:true,value:v===undefined?'(void 0)':JSON.stringify(v)};}
  if(n.type==='LogicalExpression'){
   const a=value(n.left);
   const b=value(n.right);
   if(n.operator==='&&'&&b===false&&pureRead(n.left))return {direct:true,value:'false'};
   if(n.operator==='||'&&b===true&&pureRead(n.left))return {direct:true,value:'true'};
   if(a===PRESENT_VERSION&&n.operator==='&&')return {children:[n.right],render:child=>'('+child(n.right)+')'};
   if(a!==UNKNOWN&&a!==PRESENT_VERSION){
    const branch=n.operator==='&&'?a?n.right:n.left:n.operator==='||'?a?n.left:n.right:n.operator==='??'?a==null?n.right:n.left:null;
    if(branch)return {children:[branch],render:child=>'('+child(branch)+')'};
   }
  }
  if(n.type==='UnaryExpression'&&n.operator==='typeof'){const v=value(n);if(v!==UNKNOWN)return {direct:true,value:JSON.stringify(v)};}
  if(n.type==='ConditionalExpression'){const v=value(n.test);if(v!==UNKNOWN){const branch=v?n.consequent:n.alternate;return {children:[branch],render:child=>'('+child(branch)+')'};}}
  if(n.type==='SwitchStatement'){
   const sequence=n.discriminant.type==='SequenceExpression'?n.discriminant.expressions:[n.discriminant],v=value(sequence.at(-1));
   if(v!==UNKNOWN&&v!==PRESENT_VERSION){
    const cases=n.cases.map(c=>c.test?value(c.test):null);
    if(cases.every(c=>c!==UNKNOWN&&c!==PRESENT_VERSION)){
     let start=n.cases.findIndex(c=>c.test&&value(c.test)===v);if(start<0)start=n.cases.findIndex(c=>!c.test);
     const selected=[];let stopped=false;
     for(const c of n.cases.slice(start<0?n.cases.length:start))for(const s of c.consequent){
      if(stopped)break;
      // 选中的 case 在首个中断语句处结束；越过它继续拼接后续 case，
      // 会把平台 switch 刚刚证明不可达的 Node/浏览器死分支重新带回。
      if(s.type==='BreakStatement'||s.type==='ContinueStatement'||s.type==='ReturnStatement'||s.type==='ThrowStatement'){stopped=true;if(s.type!=='BreakStatement'&&s.type!=='ContinueStatement')selected.push(s);break;}
      selected.push(s);
     }
     const patternBindings=n=>!n?[]:n.type==='Identifier'?[ix.bindings.get(n)]:n.type==='RestElement'?patternBindings(n.argument):n.type==='AssignmentPattern'?patternBindings(n.left):n.type==='ArrayPattern'?n.elements.flatMap(patternBindings):n.type==='ObjectPattern'?n.properties.flatMap(p=>patternBindings(p.type==='RestElement'?p.argument:p.value)):[];
     const selectedStatements=new Set(selected),excludedBindings=new Set();
     const collectExcludedBindings=root=>{
      const pending=[root];
      while(pending.length){
       const node=pending.pop();
       if(['VariableDeclarator','ClassDeclaration','FunctionDeclaration'].includes(node.type))for(const binding of patternBindings(node.id))if(binding)excludedBindings.add(binding);
       for(const [,child] of children(node))pending.push(child);
      }
     };
     for(const branch of n.cases)for(const statement of branch.consequent)if(!selectedStatements.has(statement))collectExcludedBindings(statement);
     const insideExcludedCode=ref=>ref.start>=n.start&&ref.end<=n.end&&!selected.some(s=>ref.start>=s.start&&ref.end<=s.end);
     const excludedReferences=[...excludedBindings].some(binding=>binding.refs.some(ref=>!insideExcludedCode(ref)));
     // 选中语句里嵌套的 break 通常属于内层循环或 switch；只有最近的可中断
     // 祖先就是当前 switch 的无标签 break 才会直接退出它，不能随裁剪保留。
     const exitsThisSwitch=root=>{
      const pending=[root];
      while(pending.length){
       const node=pending.pop();
       if(node.type==='BreakStatement'&&!node.label){
        let owner=ix.parents.get(node);
        while(owner&&!['ForStatement','ForInStatement','ForOfStatement','WhileStatement','DoWhileStatement','SwitchStatement'].includes(owner.type)&&!functions.has(owner.type))owner=ix.parents.get(owner);
        if(owner===n)return true;
       }
       for(const [,child] of children(node))pending.push(child);
      }
      return false;
     };
     const nestedSwitchBreak=selected.some(exitsThisSwitch);
     if(!excludedReferences&&!nestedSwitchBreak){const prefix=sequence.slice(0,-1),selectedNodes=selected;return {children:[...prefix,...selectedNodes],render:child=>'{'+prefix.map(e=>child(e)+';').join('')+selectedNodes.map(child).join('\n')+'}'};}
    }
   }
  }
  if(n.type==='IfStatement'){
   if(n.test.type==='SequenceExpression'){const v=value(n.test.expressions.at(-1));if(v!==UNKNOWN&&v!==PRESENT_VERSION){const branch=v?n.consequent:n.alternate,children=[n.test,...(branch?[branch]:[])];return {children,render:child=>'{'+child(n.test)+';'+(branch?child(branch):'')+'}'};}}
   if(n.test.type==='AssignmentExpression'&&n.test.operator==='='&&n.test.left.type==='Identifier'){const v=value(n.test.right);if(v!==UNKNOWN&&v!==PRESENT_VERSION){const branch=v?n.consequent:n.alternate,children=[n.test,...(branch?[branch]:[])];return {children,render:child=>'{'+child(n.test)+';'+(branch?child(branch):'')+'}'};}}
   const v=value(n.test);if(v!==UNKNOWN){const branch=v?n.consequent:n.alternate;return branch?{children:[branch],render:child=>'{'+child(branch)+'}'}:{direct:true,value:'{}'};}
  }
  return null;
 });
 return {source:render(tree),qx};
}

// Inline immutable aliases of host API objects before native API mapping.
// No runtime object is constructed, and a shadowed global is never introduced.

export function lowerAPIObjectAliases(source){
 for(let pass=0;pass<4;pass++){
  const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree);
  const {nodes,parents,bindings,scopes,owners,free}=ix,replace=new WeakMap(),removed=new WeakSet();let changed=false;
  for(const d of nodes)if(d.type==='VariableDeclarator'&&d.id.type==='Identifier'&&
    ['$httpClient','$task','$prefs','$persistentStore','$notification','$utils'].some(name=>free(d.init,name))){
   const b=bindings.get(d.id),declaration=parents.get(d),block=parents.get(declaration),name=d.init.name;
   if(!['Program','BlockStatement'].includes(block?.type))continue;
   if(!b||b.writes.length||!b.refs.length||nodes.filter(n=>n.type==='VariableDeclarator'&&bindings.get(n.id)===b).length!==1)continue;
   if(!b.refs.every(ref=>{
    const m=parents.get(ref),call=parents.get(m);
    let entry=ref;while(parents.get(entry)&&parents.get(entry)!==block)entry=parents.get(entry);
    const local=owners.get(ref)===owners.get(declaration)&&parents.get(entry)===block&&entry.start>=declaration.end;
    if(!(local||block===tree&&initializedAfter(ix,declaration,ref))||m?.type!=='MemberExpression'||m.object!==ref||call?.type!=='CallExpression'||call.callee!==m)return false;
    for(let s=scopes.get(ref);s;s=s.parent)if(s.names.has(name))return false;
    return true;
   }))continue;
   for(const ref of b.refs)replace.set(ref,name);
   removed.add(d);changed=true;
  }
  if(!changed)break;
  function render(n){
   if(replace.has(n))return replace.get(n);
   if(n.type==='VariableDeclaration'&&n.declarations.some(d=>removed.has(d))){
    const kept=n.declarations.filter(d=>!removed.has(d));
    return kept.length?n.kind+' '+kept.map(render).join(', ')+';':';';
   }
   return patch(source,n,render);
  }
  source=render(tree);
 }
 return source;
}

// A read of globalThis.$argument is the same selected host input as the bare
// identifier only when no lexical binding or global-object mutation intervenes.
export function lowerQualifiedPlatformGlobals(source,format){
 if(!['surge','loon','qx','stash','shadowrocket'].includes(format))return source;
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree);
 const {nodes,parents,bindings,scopes,free}=ix,replace=new WeakMap();
 const api=new Set(['$request','$response','$argument','$httpClient','$task','$prefs','$persistentStore','$notification','$notify','$done','$utils','$script','$network','$environment','$cronexp','$loon','$rocket']);
 const globals=nodes.filter(n=>free(n,'globalThis'));
 const writable=n=>{const p=parents.get(n);return p?.type==='AssignmentExpression'&&p.left===n||p?.type==='UpdateExpression'||p?.operator==='delete'||['ForInStatement','ForOfStatement'].includes(p?.type)&&p.left===n;};
 if(globals.some(n=>{const p=parents.get(n);return p?.type!=='MemberExpression'||p.object!==n||property(p)===undefined||writable(p);} ))return source;
 for(const n of globals){
  const member=parents.get(n),name=property(member);
  if(!api.has(name)&&name!=='$intent')continue;
  // Top-level var/function declarations can also populate the original global
  // object. Locally shadowed names must not acquire bare-identifier semantics.
  let shadowed=false;for(let scope=scopes.get(member);scope;scope=scope.parent)if(scope.names.has(name))shadowed=true;
  if(shadowed||nodes.some(n=>n.type==='Identifier'&&n.name===name&&bindings.has(n)))continue;
  replace.set(member,name==='$intent'?'(void 0)':name);
 }
 return renderTree(source,tree,n=>replace.has(n)?{direct:true,value:replace.get(n)}:null);
}

// 将顶层一次性的 `globalThis.$argument = parse(globalThis.$argument)` 归一化
// 为局部变量。只有写回无条件执行、之后仅读取同一成员、且没有裸 `$argument`
// 与其它 `globalThis` 用法时才成立；否则保留原文让分析层继续拒绝。
export function lowerSelfNormalizedArgument(source,format){
 if(!['surge','loon','qx','stash','shadowrocket'].includes(format))return source;
 let tree,ix;
 try{tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true});ix=index(tree);}catch{return source;}
 const {nodes,parents,bindings,free}=ix;
 const member=n=>n?.type==='MemberExpression'&&!n.computed&&n.object?.type==='Identifier'&&free(n.object,'globalThis')&&property(n)==='$argument';
 const bare=n=>n?.type==='Identifier'&&n.name==='$argument'&&free(n,'$argument');
 const reference=n=>member(n)?n:bare(n)?n:null;
 const globals=nodes.filter(n=>free(n,'globalThis'));
 // 归一化只依赖 `$argument` 成员；同一脚本中其它 globalThis 静态成员读取
 // 不改变这个值，可以留给后续成员映射。裸 globalThis 或动态成员仍然拒绝。
 if(globals.some(n=>{const p=parents.get(n);return p?.type!=='MemberExpression'||p.object!==n||property(p)===undefined;}))return source;
 // 输入侧需要改写成裸 `$argument` 交给后续原生映射；存在同名绑定时会被词法遮蔽。
 if(nodes.some(n=>n.type==='Identifier'&&n.name==='$argument'&&bindings.has(n)))return source;
 const references=nodes.filter(n=>reference(n));
 // qualified lowering 可能已把 `globalThis.$argument` 改成裸 `$argument`；
 // 两种写法都表示同一个宿主输入，归一化判据保持一致。
 const assignments=nodes.filter(n=>n.type==='AssignmentExpression'&&n.operator==='='&&reference(n.left));
 if(assignments.length!==1)return source;
 const assignment=assignments[0];
 // 同一处归一化不能把两种访问形态混在一起：写回后出现的另一形态读取
 // 仍是宿主原值，而不是归一化后的局部值，必须继续拒绝。
 const assignedMember=!!member(assignment.left);
 for(const item of references){
  if(item===assignment.left||item.start<=assignment.end)continue;
  if(!!member(item)!==assignedMember)return source;
 }
 // 只接受顶层表达式中的无条件写回；函数、条件、循环或 try 内的写回不传播。
 let child=assignment;
 while(parents.get(child)?.type==='SequenceExpression')child=parents.get(child);
 if(parents.get(child)?.type!=='ExpressionStatement'||parents.get(parents.get(child))!==tree)return source;
 const input=references.filter(n=>n.start>=assignment.right.start&&n.end<=assignment.right.end);
 if(!input.length)return source;
 for(const item of references){
  if(item===assignment.left||input.includes(item))continue;
  if(item.start<=assignment.end)return source;
  const p=parents.get(item),use=parents.get(p);
  if(p?.type==='AssignmentExpression'&&p.left===item||p?.type==='UpdateExpression'||p?.type==='UnaryExpression'&&p.operator==='delete')return source;
  if(p?.type==='MemberExpression'&&p.object===item&&(use?.type==='AssignmentExpression'&&use.left===p||use?.type==='UpdateExpression'||use?.type==='UnaryExpression'&&use.operator==='delete'))return source;
 }
 const names=new Set(nodes.filter(n=>n.type==='Identifier').map(n=>n.name));
 let local='selfNormalizedArgument',suffix=2;
 while(names.has(local))local='selfNormalizedArgument'+(suffix++);
 const replace=new WeakMap();
 replace.set(assignment.left,local);
 for(const item of input)replace.set(item,'$argument');
 for(const item of references)if(item!==assignment.left&&!input.includes(item))replace.set(item,local);
 let output=renderTree(source,tree,n=>replace.has(n)?{direct:true,value:replace.get(n)}:null);
 let insert=tree.body[0]?.start??0;
 for(const statement of tree.body){if(statement.type!=='ExpressionStatement'||typeof statement.directive!=='string')break;insert=statement.end;}
 output=output.slice(0,insert)+`\nlet ${local};\n`+output.slice(insert);
 return output;
}

// In a classic non-strict script, a plain call to a function gives it the
// global object as `this`; arrows nested in that function capture the same
// receiver. Once emitted as an Egern module, make only explicit proxy-global
// reads direct identifiers, and only when every callable reference proves a
// plain invocation. Method receivers, strict functions and escaped functions
// retain `this` and are rejected by the normal API analysis.
export function lowerDirectGlobalPlatformReceivers(source,format){
 if(!['surge','loon','qx','stash','shadowrocket'].includes(format))return source;
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree);
 if(tree.body.some(n=>n.directive==='use strict'))return source;
 const {nodes,parents,bindings}=ix,replace=new WeakMap();
 const apis=new Set(['$request','$response','$argument','$httpClient','$task','$prefs','$persistentStore','$notification','$notify','$done','$utils','$script','$network','$environment','$cronexp','$loon','$rocket']);
 function plainCall(fn){
  if(!functions.has(fn?.type)||fn.type==='ArrowFunctionExpression'||fn.generator)return false;
  if(fn.body?.type==='BlockStatement'&&fn.body.body[0]?.directive==='use strict')return false;
  const parent=parents.get(fn);
  if(parent?.type==='CallExpression'&&parent.callee===fn&&!parent.optional)return true;
  const id=fn.id??(parent?.type==='VariableDeclarator'&&parent.init===fn?parent.id:null),binding=id?bindings.get(id):null;
  if(!binding||binding.writes.length||!binding.refs.length)return false;
  return binding.refs.every(ref=>{const call=parents.get(ref);return call?.type==='CallExpression'&&call.callee===ref&&!call.optional;});
 }
 for(const n of nodes){
  if(n.type!=='ThisExpression')continue;
  const member=parents.get(n),api=property(member),use=parents.get(member);
  if(member?.type!=='MemberExpression'||member.object!==n||!apis.has(api)||
     use?.type==='AssignmentExpression'&&use.left===member||use?.type==='UpdateExpression'||use?.operator==='delete')continue;
  let owner=parents.get(n);
  while(owner&&(!functions.has(owner.type)||owner.type==='ArrowFunctionExpression'))owner=parents.get(owner);
  if(owner&&(!plainCall(owner)||parents.get(owner)?.type==='MethodDefinition'))continue;
  replace.set(member,api);
 }
 return renderTree(source,tree,n=>replace.has(n)?{direct:true,value:replace.get(n)}:null);
}

// Resolve only side-effect-free platform predicates on a closed SDK receiver.
// Keep constructors and methods intact; this enables ordinary dead-branch analysis
// before scalar replacement, including scripts sharing request/schedule entries.
const UNKNOWN_PROBE=Symbol('unknown'),NONE=Symbol('no return');
export function foldFactoryProbes(source,format,options){
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree),replace=new WeakMap();
 const {nodes,parents,bindings,free}=ix;
 function target(n){const b=n?.type==='Identifier'?bindings.get(n):null;return b&&!b.writes.length&&(b.fn??(functions.has(b.init?.type)?b.init:null));}
 function localCall(call){return call?.type==='CallExpression'&&target(call.callee);}
 function safe(binding,protectedNames,seen=new Set()){
  if(!binding||binding.writes.length)return false;if(seen.has(binding))return true;seen=new Set(seen);seen.add(binding);
  return binding.refs.every(r=>{
   const p=parents.get(r),use=parents.get(p);
   if(p?.type==='MemberExpression'&&p.object===r){
    const name=property(p),write=use?.type==='AssignmentExpression'&&use.left===p||use?.type==='UpdateExpression'||use?.operator==='delete';
    return name!==undefined&&(!write||!protectedNames.has(name));
   }
   if(p?.type==='CallExpression'&&p.arguments.includes(r)){
    const fn=localCall(p),i=p.arguments.indexOf(r),param=fn?.params[i];
    return param?.type==='Identifier'&&safe(bindings.get(param),protectedNames,seen);
   }
   return false;
  });
 }
 const contextFor=instance=>{
  const b=bindings.get(instance),construction=b?.init,fn=['CallExpression','NewExpression'].includes(construction?.type)?target(construction.callee):null;
  if(!fn||fn.async||fn.generator||fn.body.body.slice(0,-1).some(n=>!['VariableDeclaration','FunctionDeclaration','ClassDeclaration'].includes(n.type)&&!(n.type==='ExpressionStatement'&&literalExpression(n.expression))))return null;
  if(nodes.filter(n=>n.type==='VariableDeclarator'&&bindings.get(n.id)===b).length!==1||nodes.filter(n=>n.type==='FunctionDeclaration'&&bindings.get(n.id)===bindings.get(fn.id)).length!==1)return null;
  const ret=fn.body.body.at(-1),value=ret?.type==='ReturnStatement'?ret.argument:null,object=value?.type==='ObjectExpression'?value:null,cls=value?.type==='NewExpression'&&value.callee.type==='ClassExpression'?value.callee:null;
  const entries=new Map();
  if(object){for(const p of object.properties){if(p.type!=='Property'||p.computed||p.kind!=='init'||key(p)==='__proto__'||entries.has(key(p)))return null;entries.set(key(p),p.value);}}
  else if(cls&&!cls.superClass){for(const m of cls.body.body){if(!['MethodDefinition','PropertyDefinition'].includes(m.type)||m.static||m.computed||m.type==='MethodDefinition'&&!['method','constructor'].includes(m.kind)||entries.has(key(m)))return null;if(m.kind!=='constructor')entries.set(key(m),m.value);}}
  else return null;
  if(!safe(b,new Set(entries.keys())))return null;
  if(object&&index(object).nodes.some(n=>n.type==='ThisExpression'))return null;
  // No indirect receiver mutation. Object.assign may only receive an omitted,
  // null or literal object with no protected keys; other this escapes fail.
  if(cls)for(const n of nodes)if(n.type==='ThisExpression'&&n.start>=cls.start&&n.end<=cls.end){
   let receiver=parents.get(n);while(receiver&&(!functions.has(receiver.type)||receiver.type==='ArrowFunctionExpression'))receiver=parents.get(receiver);
   if(receiver&&parents.get(receiver)?.type!=='MethodDefinition')continue;
   const p=parents.get(n);
   if(p?.type==='MemberExpression'&&p.object===n){const use=parents.get(p);if(property(p)===undefined||entries.has(property(p))&&(use?.type==='AssignmentExpression'&&use.left===p||use?.type==='UpdateExpression'||use?.operator==='delete'))return null;continue;}
   if(p?.type==='CallExpression'&&p.arguments[0]===n&&p.callee.type==='MemberExpression'&&free(p.callee.object,'Object')&&property(p.callee)==='assign'){
    const ctor=ix.owners.get(n),params=ctor.params,i=params.findIndex(a=>bindings.get(a.type==='AssignmentPattern'?a.left:a)===bindings.get(p.arguments[1])),actual=factoryArgument(ix,fn,construction,value,ctor,i);
    if(i>=0&&(!actual||actual.type==='Literal'&&actual.value===null||actual.type==='ObjectExpression'&&actual.properties.every(p=>p.type==='Property'&&!p.computed&&!entries.has(key(p)))))continue;
   }
   if(p?.type==='NewExpression'&&p.arguments.includes(n)){
    const helper=bindings.get(p.callee)?.init,ctor=helper?.type==='ClassDeclaration'?helper.body.body.find(m=>m.kind==='constructor'):null;
    if(helper&&!helper.superClass&&helper.body.body.every(m=>m.type==='MethodDefinition'&&!m.computed&&!m.static&&['constructor','method'].includes(m.kind))&&ctor&&ctor.value.params.every(p=>p.type==='Identifier')&&ctor.value.body.body.every(s=>s.type==='ExpressionStatement'&&s.expression.type==='AssignmentExpression'&&s.expression.operator==='='&&s.expression.left.type==='MemberExpression'&&s.expression.left.object.type==='ThisExpression'&&s.expression.right.type==='Identifier'&&ctor.value.params.some(p=>bindings.get(p)===bindings.get(s.expression.right))))continue;
   }
   return null;
  }
  return {fn,entries,cls};
 };
 function constant(n,ctx,seen=new Set()){
  if(!n||seen.has(n))return UNKNOWN_PROBE;seen=new Set(seen);seen.add(n);
  if(n.type==='Literal')return n.value;
  if(free(n,'undefined'))return undefined;
  if(n.type==='Identifier'){
   const b=bindings.get(n);return b?.init&&!b.writes.length&&b.init.start>=ctx.fn.start&&b.init.end<=ctx.fn.end?constant(b.init,ctx,seen):UNKNOWN_PROBE;
  }
  if(n.type==='UnaryExpression'&&n.operator==='typeof'&&free(n.argument)){
   const folded=platformFold('const probeValue = '+source.slice(n.start,n.end)+';',format,options).source;
   const expr=parse(folded,{ecmaVersion:'latest'}).body[0].declarations[0].init;return expr.type==='Literal'?expr.value:UNKNOWN_PROBE;
  }
  if(n.type==='MemberExpression'&&free(n.object,'$environment')){
   if(property(n)==='surge-version'&&format!=='surge'||property(n)==='stash-version'&&format!=='stash')return undefined;
   return UNKNOWN_PROBE;
  }
  if(n.type==='UnaryExpression'){
   const v=constant(n.argument,ctx,seen);if(v===UNKNOWN_PROBE)return UNKNOWN_PROBE;
   if(n.operator==='!')return !v;if(n.operator==='typeof')return typeof v;if(n.operator==='void')return undefined;
  }
  if(n.type==='BinaryExpression'){
   const a=constant(n.left,ctx,seen),b=constant(n.right,ctx,seen);if(a===UNKNOWN_PROBE||b===UNKNOWN_PROBE)return UNKNOWN_PROBE;
   if(n.operator==='===')return a===b;if(n.operator==='!==')return a!==b;if(n.operator==='==')return a==b;if(n.operator==='!=')return a!=b;
  }
  if(n.type==='ConditionalExpression'){const t=constant(n.test,ctx,seen);return t===UNKNOWN_PROBE?UNKNOWN_PROBE:constant(t?n.consequent:n.alternate,ctx,seen);}
  if(n.type==='LogicalExpression'){
   const a=constant(n.left,ctx,seen);if(a===UNKNOWN_PROBE)return UNKNOWN_PROBE;return n.operator==='&&'?(a?constant(n.right,ctx,seen):a):n.operator==='||'?(a?a:constant(n.right,ctx,seen)):(a??constant(n.right,ctx,seen));
  }
  if(n.type==='CallExpression'&&!n.arguments.length&&!n.optional){
   const fn=n.callee.type==='MemberExpression'&&n.callee.object.type==='ThisExpression'?ctx.entries.get(property(n.callee)):target(n.callee);
   return predicate(fn,ctx,seen);
  }
  return UNKNOWN_PROBE;
 }
 function predicate(fn,ctx,seen){
  if(!functions.has(fn?.type)||fn.params.length||fn.async||fn.generator||seen.has(fn))return UNKNOWN_PROBE;
  seen=new Set(seen);seen.add(fn);
  function returned(n){
   if(!n)return NONE;
   if(n.type==='ReturnStatement')return n.argument?constant(n.argument,ctx,seen):undefined;
   if(n.type==='IfStatement'){const t=constant(n.test,ctx,seen);return t===UNKNOWN_PROBE?UNKNOWN_PROBE:returned(t?n.consequent:n.alternate);}
   if(n.type==='BlockStatement'){for(const s of n.body){const v=returned(s);if(v!==NONE)return v;}return NONE;}
   if(n.type==='EmptyStatement')return NONE;
   return UNKNOWN_PROBE;
  }
  return fn.body.type==='BlockStatement'?returned(fn.body):constant(fn.body,ctx,seen);
 }
 const cache=new WeakMap();
 const contexts=[];
 for(const n of nodes)if(n.type==='MemberExpression'&&n.object.type==='Identifier'){
  const binding=bindings.get(n.object);if(!binding)continue;
  const declaration=parents.get(parents.get(binding.init));
  if(declaration?.type!=='VariableDeclaration')continue;
  if(!cache.has(binding)){const context=contextFor(n.object);cache.set(binding,context);if(context)contexts.push(context);}const ctx=cache.get(binding);if(!ctx)continue;
  // 类方法的封闭常量谓词不依赖实例属性初始化时机；普通成员读取仍须由
  // 声明支配，避免把构造器尚未赋值的字段当成已知值。
  if(!initializedAfter(ix,declaration,n))continue;
  const expr=ctx.entries.get(property(n));if(!expr)continue;
  const use=parents.get(n),fn=expr.type==='Identifier'?target(expr):expr;
  const call=use?.type==='CallExpression'&&use.callee===n&&!use.arguments.length&&!use.optional;
  const result=call?predicate(fn,ctx,new Set()):!functions.has(fn?.type)?constant(expr,ctx):UNKNOWN_PROBE;
  if(result!==UNKNOWN_PROBE&&result!==NONE&&(result===undefined||['boolean','string'].includes(typeof result)))replace.set(call?use:n,result===undefined?'void 0':JSON.stringify(result));
 }
 for(const ctx of contexts)if(ctx.cls)for(const n of nodes)if(n.type==='CallExpression'&&!n.arguments.length&&!n.optional&&n.callee.type==='MemberExpression'&&n.callee.object.type==='ThisExpression'&&n.start>=ctx.cls.start&&n.end<=ctx.cls.end){
  let receiver=parents.get(n);while(receiver&&(!functions.has(receiver.type)||receiver.type==='ArrowFunctionExpression'))receiver=parents.get(receiver);
  if(parents.get(receiver)?.type!=='MethodDefinition')continue;
  const result=predicate(ctx.entries.get(property(n.callee)),ctx,new Set());
  if(result!==UNKNOWN_PROBE&&result!==NONE&&(result===undefined||['boolean','string'].includes(typeof result)))replace.set(n,result===undefined?'void 0':JSON.stringify(result));
 }
 const render=n=>replace.has(n)?replace.get(n):patch(source,n,render);return render(tree);
}
