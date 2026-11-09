import {parse} from '../core/syntax.mjs';
import {index,patch,property,key,children,functions,initializedAfter,factoryArgument,literalExpression} from '../core/ast.mjs';

// Fold proven source-platform probes, preserving unknown device/version data.
const UNKNOWN=Symbol('not statically known');
const PRESENT_VERSION=Symbol('platform version exists; exact value unknown');
const PRESENT_GLOBALS=new Map();
export function platformFold(source,format,options={}){
 let qx;
 for(let pass=0;pass<3;pass++){
  const folded=fold(source,format,options,qx);qx=folded.qx;
  if(folded.source===source)return folded;
  source=folded.source;
 }
 return {source,qx};
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
 const used=name=>ix.nodes.some(n=>ix.free(n,name)&&!(ix.parents.get(n)?.operator==='typeof'));
 const qx=qxHint??(format==='qx'||(used('$task')&&!used('$httpClient')));
 const records=new WeakSet();
 const stableRegexTest=!ix.nodes.some(n=>ix.free(n,'RegExp')||n.type==='MemberExpression'&&(['constructor','prototype'].includes(property(n))||property(n)==='test'&&(ix.parents.get(n)?.type==='AssignmentExpression'||ix.parents.get(n)?.type==='UpdateExpression'||ix.parents.get(n)?.operator==='delete')));
 const readonlyRecords=new Map();
 function readonlyRecord(b){
  if(readonlyRecords.has(b))return readonlyRecords.get(b);
  const safe=b.refs.filter(r=>!b.writes.some(w=>w.left===r)).every(r=>{const p=ix.parents.get(r),q=ix.parents.get(p);
   if(p?.type==='MemberExpression'&&p.object===r)return property(p)!==undefined&&!(q?.type==='AssignmentExpression'&&q.left===p||q?.type==='UpdateExpression'||q?.operator==='delete'||['ForInStatement','ForOfStatement'].includes(q?.type)&&q.left===p);
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
  module:'undefined',process:'undefined',require:'undefined',global:'undefined',window:'undefined'};
 for(const [name,type] of Object.entries(types))if((type==='object'||type==='function')&&!PRESENT_GLOBALS.has(name))PRESENT_GLOBALS.set(name,Symbol('present:'+name));
 const presentGlobalNames=new Map([...PRESENT_GLOBALS].map(([name,marker])=>[marker,name]));
 // Some bundled SDKs detect their host through an isolated enumerable-key
 // snapshot. Fold only closed membership probes; never fabricate a complete
 // global object or discard an escaped/mutated array.
 const globalMembership=new WeakMap(),keySnapshots=new WeakSet();
 const markers=new Map(['$task','$loon','$rocket','$environment'].map(name=>[name,false]));markers.set('Egern',true);
 const probeBuiltinsStable=!ix.nodes.some(n=>{
  if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&ix.free(n.callee.object,'Object')&&['assign','defineProperty','defineProperties','setPrototypeOf'].includes(property(n.callee)))return n.arguments.some(a=>ix.free(a,'globalThis'))||['defineProperty','defineProperties','setPrototypeOf'].includes(property(n.callee));
  if(n.type==='MemberExpression'&&['keys','includes','prototype'].includes(property(n))){const p=ix.parents.get(n);if(p?.type==='AssignmentExpression'&&p.left===n||p?.type==='UpdateExpression'||p?.operator==='delete')return true;}
  if(n.type==='Identifier'&&markers.has(n.name)&&ix.free(n)){const p=ix.parents.get(n);if(p?.type==='AssignmentExpression'&&p.left===n||p?.type==='UpdateExpression'||p?.operator==='delete')return true;}
  if(n.type==='MemberExpression'&&ix.free(n.object,'globalThis')&&(property(n)===undefined||markers.has(property(n)))){const p=ix.parents.get(n);if(p?.type==='AssignmentExpression'&&p.left===n||p?.type==='UpdateExpression'||p?.operator==='delete')return true;}
  return false;
 });
 if(probeBuiltinsStable)for(const d of ix.nodes)if(d.type==='VariableDeclarator'&&d.id.type==='Identifier'){
  const call=d.init,b=ix.bindings.get(d.id);
  if(call?.type!=='CallExpression'||call.optional||call.arguments.length!==1||!ix.free(call.arguments[0],'globalThis')||call.callee.type!=='MemberExpression'||!ix.free(call.callee.object,'Object')||property(call.callee)!=='keys'||!b?.refs.length||b.writes.length||declarationCounts.get(b)!==1)continue;
  const queries=b.refs.map(r=>{const m=ix.parents.get(r),c=ix.parents.get(m);return m?.type==='MemberExpression'&&m.object===r&&property(m)==='includes'&&c?.type==='CallExpression'&&c.callee===m&&!c.optional&&c.arguments.length===1&&c.arguments[0].type==='Literal'&&markers.has(c.arguments[0].value)?c:null;});
  if(queries.some(c=>!c)||b.refs.some(r=>!dominates(b,r)))continue;
  keySnapshots.add(call);for(const query of queries)globalMembership.set(query,markers.get(query.arguments[0].value));
 }
 function value(n,seen){
  const rootContext=parameters===rootParameters&&(!seen||seen.size===0);
  if(n&&rootContext&&rootValueCache.has(n))return rootValueCache.get(n);
  const result=valueImpl(n,seen??new Set());
  if(n&&rootContext)rootValueCache.set(n,result);
  return result;
 }
 function valueImpl(n,seen){
  if(!n)return UNKNOWN;
  if(globalMembership.has(n))return globalMembership.get(n);
  if(keySnapshots.has(n)){const snapshot=[];records.add(snapshot);return snapshot;}
  if(n.type==='Literal')return n.value;
  if(n.type==='Identifier'&&ix.free(n)){
   if(Object.hasOwn(types,n.name)&&types[n.name]==='undefined')return undefined;
   if((types[n.name]==='object'||types[n.name]==='function')&&PRESENT_GLOBALS.has(n.name))return PRESENT_GLOBALS.get(n.name);
  }
  if(n.type==='TemplateLiteral'&&!n.expressions.length)return n.quasis[0].value.cooked;
  if(n.type==='ObjectExpression'){
   const out=Object.create(null);for(const p of n.properties){if(p.type!=='Property'||p.kind!=='init'||key(p)===undefined||key(p)==='__proto__')return UNKNOWN;
    // Closed Env factories often expose platform predicates as object methods.
    // Retain the function AST as data so a direct call can be folded below;
    // no callback, alias or escaped method reference is admitted.
    if(functions.has(p.value?.type)){out[key(p)]=p.value;continue;}
    const v=value(p.value,new Set(seen));if(v===UNKNOWN&&!pureProbe(p.value)||v===PRESENT_VERSION||v!==null&&typeof v==='object')return UNKNOWN;out[key(p)]=v;
   }records.add(out);return out;
  }
  if(n.type==='MemberExpression'&&ix.free(n.object,'$environment')){
   const name=property(n);
   if(name==='surge-version')return format==='surge'?PRESENT_VERSION:undefined;
   if(name==='stash-version')return format==='stash'?PRESENT_VERSION:undefined;
  }
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
   if(n.operator==='typeof'&&['global','module','exports','process','require','importModule','document','$drive'].some(name=>ix.free(n.argument,name)))return 'undefined';
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
   const a=value(n.left,seen),b=value(n.right,seen);if(a===UNKNOWN||b===UNKNOWN||a===PRESENT_VERSION||b===PRESENT_VERSION)return UNKNOWN;
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
    if(statement.type==='EmptyStatement')continue;
    if(statement.type==='VariableDeclaration'&&statement.declarations.every(d=>d.id.type==='Identifier'&&d.init&&value(d.init,new Set(seen))!==UNKNOWN))continue;
    return UNKNOWN;
   }
   return NO_RETURN;
  }
  if(n.type==='EmptyStatement')return NO_RETURN;
  if(n.type==='VariableDeclaration'&&n.declarations.every(d=>d.id.type==='Identifier'&&d.init&&value(d.init,new Set(seen))!==UNKNOWN))return NO_RETURN;
  return UNKNOWN;
 }
 // A captured program constant is safe only when the entire prefix before its
 // initializer cannot execute user code. No call can enter a closure early.
 function inert(n){
  if(!n)return true;
  if(['Literal','Identifier','FunctionDeclaration','FunctionExpression','ArrowFunctionExpression','EmptyStatement'].includes(n.type))return n.type!=='Identifier';
  if(n.type==='UnaryExpression')return n.operator==='typeof'&&n.argument.type==='Identifier'||['!','void','+','-'].includes(n.operator)&&inert(n.argument);
  if(['BinaryExpression','LogicalExpression'].includes(n.type))return inert(n.left)&&inert(n.right);
  if(n.type==='ConditionalExpression')return inert(n.test)&&inert(n.consequent)&&inert(n.alternate);
  if(n.type==='VariableDeclaration')return n.declarations.every(d=>d.id.type==='Identifier'&&inert(d.init));
  return false;
 }
 function dominates(binding,ref){
  const declaration=ix.parents.get(binding.init),statement=ix.parents.get(declaration),block=ix.parents.get(statement);
  if(declaration?.type!=='VariableDeclarator'||statement?.type!=='VariableDeclaration'||!['Program','BlockStatement'].includes(block?.type))return false;
  if(declarationCounts.get(binding)!==1)return false;
  if(ix.owners.get(ref)!==ix.owners.get(statement))return statement.kind==='const'&&
   (block.body.slice(0,block.body.indexOf(statement)+1).every(inert)||enteredAfter(ix.owners.get(ref),statement));
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
 const rendered=new WeakMap();
 function render(n){
  if(keySnapshots.has(n))return "[]";
  if(!n)return '';
  if(rendered.has(n))return rendered.get(n);
  const text=emit(n);rendered.set(n,text);return text;
 }
 function emit(n){
  if(n.type==='FunctionDeclaration'&&!n.params.length&&!n.async&&!n.generator){
   const b=ix.bindings.get(n.id),block=ix.parents.get(n),owner=ix.parents.get(block),body=n.body.body;
   // Only statically pure, unused predicates can disappear here. Preserve
   // general unused functions: the compiler must still diagnose unsafe APIs
   // and missing completion paths rather than suppressing those diagnostics.
   if(b&&!b.refs.length&&!b.writes.length&&declarationCounts.get(b)===1&&
     (block?.type==='Program'||block?.type==='BlockStatement'&&functions.has(owner?.type)&&owner.body===block)&&
     body.length===1&&body[0].type==='ReturnStatement'&&[true,false,undefined,PRESENT_VERSION].includes(value(body[0].argument)))return '';
  }
  if(n.type==='VariableDeclarator'&&n.id.type==='Identifier'&&n.init){const v=value(n.init);if(typeof v==='boolean'||v===undefined)return render(n.id)+' = '+(v===undefined?'void 0':String(v));}
  if(n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id.type==='ObjectPattern'&&d.init)){
   const values=n.declarations.map(d=>value(d.init));
   const valid=(d,i)=>d.id.type==='ObjectPattern'&&values[i]&&records.has(values[i])&&d.id.properties.every(p=>p.type==='Property'&&!p.computed&&p.value.type==='Identifier'&&Object.hasOwn(values[i],key(p))&&values[i][key(p)]!==UNKNOWN);
   if(n.declarations.some(valid))return n.kind+' '+n.declarations.flatMap((d,i)=>valid(d,i)?d.id.properties.map(p=>render(p.value)+' = '+(values[i][key(p)]===undefined?'void 0':JSON.stringify(values[i][key(p)]))):[render(d)]).join(', ')+';';
  }
  if(n.type==='CallExpression'){
   const v=value(n);
   if(v!==UNKNOWN&&v!==PRESENT_VERSION&&(v===undefined||v===null||['boolean','string'].includes(typeof v)||typeof v==='number'&&Number.isFinite(v)))return v===undefined?'(void 0)':JSON.stringify(v);
  }
  if(n.type==='MemberExpression'){const v=value(n);if(v!==UNKNOWN&&v!==PRESENT_VERSION&&(v===undefined||v===null||['boolean','string'].includes(typeof v)))return v===undefined?'(void 0)':JSON.stringify(v);}
  if(n.type==='BinaryExpression'){const v=value(n);if(v!==UNKNOWN&&v!==PRESENT_VERSION&&(v===undefined||v===null||['boolean','string','number'].includes(typeof v)))return v===undefined?'(void 0)':JSON.stringify(v);}
  if(n.type==='LogicalExpression'){
   const a=value(n.left);
   if(a===PRESENT_VERSION&&n.operator==='&&')return '('+render(n.right)+')';
   if(a!==UNKNOWN&&a!==PRESENT_VERSION){
    if(n.operator==='&&')return '('+render(a?n.right:n.left)+')';
    if(n.operator==='||')return '('+render(a?n.left:n.right)+')';
    if(n.operator==='??')return '('+render(a==null?n.right:n.left)+')';
   }
  }
  if(n.type==='UnaryExpression'&&n.operator==='typeof'){const v=value(n);if(v!==UNKNOWN)return JSON.stringify(v);}
  if(n.type==='ConditionalExpression'){const v=value(n.test);if(v!==UNKNOWN)return '('+render(v?n.consequent:n.alternate)+')';}
  if(n.type==='SwitchStatement'){
   const sequence=n.discriminant.type==='SequenceExpression'?n.discriminant.expressions:[n.discriminant],v=value(sequence.at(-1));
   if(v!==UNKNOWN&&v!==PRESENT_VERSION){
    const cases=n.cases.map(c=>c.test?value(c.test):null);
    if(cases.every(c=>c!==UNKNOWN&&c!==PRESENT_VERSION)){
     let start=n.cases.findIndex(c=>c.test&&value(c.test)===v);if(start<0)start=n.cases.findIndex(c=>!c.test);
     const selected=[];let stopped=false;
     for(const c of n.cases.slice(start<0?n.cases.length:start))for(const s of c.consequent){if(stopped)break;if(s.type==='BreakStatement'&&!s.label){stopped=true;break;}selected.push(s);}
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
     const containsBreak=root=>{
      const pending=[root];
      while(pending.length){
       const node=pending.pop();if(node.type==='BreakStatement')return true;
       for(const [,child] of children(node))pending.push(child);
      }
      return false;
     };
     const nestedBreak=selected.some(containsBreak);
     if(!excludedReferences&&!nestedBreak)return '{'+sequence.slice(0,-1).map(e=>render(e)+';').join('')+selected.map(render).join('\n')+'}';
    }
   }
  }
  if(n.type==='IfStatement'){
   if(n.test.type==='SequenceExpression'){const v=value(n.test.expressions.at(-1));if(v!==UNKNOWN&&v!==PRESENT_VERSION)return '{'+render(n.test)+';'+(v?render(n.consequent):n.alternate?render(n.alternate):'')+'}';}
   if(n.test.type==='AssignmentExpression'&&n.test.operator==='='&&n.test.left.type==='Identifier'){const v=value(n.test.right);if(v!==UNKNOWN&&v!==PRESENT_VERSION)return '{'+render(n.test)+';'+(v?render(n.consequent):n.alternate?render(n.alternate):'')+'}';}
   const v=value(n.test);if(v!==UNKNOWN)return v?'{'+render(n.consequent)+'}':n.alternate?'{'+render(n.alternate)+'}':'{}';
  }
  return patch(source,n,render);
 }
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
 const render=n=>replace.has(n)?replace.get(n):patch(source,n,render);
 return render(tree);
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
 const render=n=>replace.has(n)?replace.get(n):patch(source,n,render);
 return render(tree);
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
  if(declaration?.type!=='VariableDeclaration'||parents.get(declaration)!==tree||!initializedAfter(ix,declaration,n))continue;
  if(!cache.has(binding)){const context=contextFor(n.object);cache.set(binding,context);if(context)contexts.push(context);}const ctx=cache.get(binding);if(!ctx)continue;
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
