import {pathSetterField} from '../http/requests.mjs';
import {finiteLiteralMember,ordinaryReceivers,regeneratorStateMachine} from '../analysis/values.mjs';
import {parse} from '../core/syntax.mjs';
import {index,patch,renderTree,functions,initializedAfter,property,key,isolatedSwitchCase,children} from '../core/ast.mjs';
import {evaluationBindings} from './evaluation.mjs';

// Specialize immutable primitive parameters only when every call is closed and
// supplies the same literal (including omitted/defaulted undefined). The calls
// and their argument evaluation remain in place; no object identity is copied.
const UNKNOWN=Symbol('unknown');
export function specializeParameters(source){
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree),replace=new WeakMap();
 const {nodes,parents,bindings,free}=ix;
 const evaluated=evaluationBindings(ix,source);
 const primitive=n=>!n?undefined:n.type==='Literal'&&!n.regex&&typeof n.value!=='bigint'&&(typeof n.value!=='number'||Number.isFinite(n.value))?n.value:free(n,'undefined')||n.type==='UnaryExpression'&&n.operator==='void'&&n.argument.type==='Literal'?undefined:UNKNOWN;
 const closedCalls=new Map(),parameters=new Map(),declarationCounts=new Map(),usesArguments=new WeakSet();
 // Build these once: rescanning every node and re-indexing nested function
 // bodies for each function made bundled SDKs quadratic in source size.
 for(const n of nodes){
  if(n.type==='FunctionDeclaration'||n.type==='VariableDeclarator'){
   const b=bindings.get(n.id);if(b)declarationCounts.set(b,(declarationCounts.get(b)||0)+1);
  }
  if(free(n,'arguments'))for(let p=parents.get(n);p;p=parents.get(p))if(functions.has(p.type))usesArguments.add(p);
 }
 const initialized=(b,n)=>{
  const d=parents.get(b.init),s=parents.get(d),block=parents.get(s);if(d?.type!=='VariableDeclarator'||s?.type!=='VariableDeclaration')return false;
  let entry=n,owner=ix.owners.get(n),declarationOwner=ix.owners.get(s);
  while(owner!==declarationOwner&&functions.has(owner?.type)&&owner.type!=='FunctionDeclaration'&&!['MethodDefinition','Property'].includes(parents.get(owner)?.type)){entry=owner;owner=ix.owners.get(parents.get(owner));}
  if(owner===declarationOwner){let p=entry;while(parents.get(p)&&parents.get(p)!==block)p=parents.get(p);return parents.get(p)===block&&(p.start>=s.end||entry===n&&n.start>=b.init.end&&n.end<=s.end);}
  return block===tree&&initializedAfter(ix,s,n);
 };
 for(const fn of nodes.filter(n=>functions.has(n.type))){
  const p=parents.get(fn),id=fn.id??(p?.type==='VariableDeclarator'?p.id:null),binding=id?.type==='Identifier'?bindings.get(id):null;
  const direct=p?.type==='CallExpression'&&p.callee===fn&&!p.optional;
  if(evaluated.has(binding)||!direct&&(!binding||binding.writes.length||!binding.refs.length||declarationCounts.get(binding)!==1)||usesArguments.has(fn))continue;
  const calls=direct?[p]:binding.refs.map(r=>parents.get(r));
  if(calls.some((c,i)=>c?.type!=='CallExpression'||!direct&&c.callee!==binding.refs[i]||c.optional||c.arguments.some(a=>a.type==='SpreadElement')))continue;
  closedCalls.set(fn,calls);
  fn.params.forEach((p,i)=>{const id=p.type==='AssignmentPattern'?p.left:p;if(id.type==='Identifier')parameters.set(bindings.get(id),{fn,p,i});});
  fn.params.forEach((parameter,i)=>{
   const id=parameter.type==='AssignmentPattern'?parameter.left:parameter,b=id.type==='Identifier'?bindings.get(id):null;
   if(!b||b.writes.length||evaluated.has(b))return;
   const values=calls.map(c=>{const v=primitive(c.arguments[i]);return v===undefined&&parameter.type==='AssignmentPattern'?primitive(parameter.right):v;});
   const value=values[0];if(value===UNKNOWN||!values.every(v=>Object.is(v,value)))return;
   const literal=value===undefined?'(void 0)':JSON.stringify(value);
   for(const ref of b.refs)if(ref.start>=fn.body.start)replace.set(ref,literal);
  });
 }
 // An absent request option stays absent through a closed forwarding helper
 // when neither the helper nor any caller writes/escapes that property.
 const fieldFacts=new WeakMap();
 function fieldUnmodified(b,field,seen=new Set()){
  if(!b)return false;
  if(!seen.size&&fieldFacts.get(b)?.has(field))return fieldFacts.get(b).get(field);
  const result=checkFieldUnmodified(b,field,seen);
  if(!seen.size){if(!fieldFacts.has(b))fieldFacts.set(b,new Map());fieldFacts.get(b).set(field,result);}
  return result;
 }
 function checkFieldUnmodified(b,field,seen=new Set()){
  if(!b||b.writes.length||evaluated.has(b))return false;if(seen.has(b))return true;seen=new Set(seen);seen.add(b);
  for(const ref of b.refs){const p=parents.get(ref),use=parents.get(p);
   if(p?.type==='UnaryExpression'&&p.operator==='typeof')continue;
   if(p?.type==='MemberExpression'&&p.object===ref){const k=property(p);if(k!==undefined&&k!==field)continue;}
   let nonObject=false;
   for(let guard=parents.get(ref);guard;guard=parents.get(guard))if(guard.type==='SwitchCase'&&guard.test&&isolatedSwitchCase(ix,guard)){const test=parents.get(guard)?.discriminant;if(test?.type==='UnaryExpression'&&test.operator==='typeof'&&bindings.get(test.argument)===b&&(guard.test.type==='Literal'&&guard.test.value!=='object'||guard.test.type==='UnaryExpression'&&guard.test.operator==='void'))nonObject=true;}
   if(nonObject)continue;
   if(p?.type==='MemberExpression'&&p.object===ref){const k=property(p);if(k===undefined||k===field&&(use?.type==='AssignmentExpression'&&use.left===p||use?.type==='UpdateExpression'))return false;continue;}
   if(p?.type==='BinaryExpression'&&p.operator==='in'&&p.right===ref&&p.left.type==='Literal')continue;
   if(p?.type==='VariableDeclarator'&&p.init===ref&&p.id.type==='ObjectPattern'&&p.id.properties.every(p=>p.type==='Property'&&p.kind==='init'&&key(p)!==undefined&&p.value.type==='Identifier'&&!bindings.get(p.value)?.writes.length))continue;
   if(p?.type==='CallExpression'&&p.arguments.includes(ref)){
    const mutation=pathSetterField(ix,p,ref);if(mutation&&mutation!==field)continue;
    if(p.arguments[0]===ref&&p.callee.type==='MemberExpression'&&(free(p.callee.object,'$httpClient')||free(p.callee.object,'$task')))continue;
    const callee=bindings.get(p.callee)?.fn;if(closedCalls.has(callee)){const param=callee.params[p.arguments.indexOf(ref)],id=param?.type==='AssignmentPattern'?param.left:param,pb=id?.type==='Identifier'?bindings.get(id):null;if(fieldUnmodified(pb,field,seen))continue;}
   }
   return false;
  }
  return true;
 }
 function absent(n,field,seen=new Set(),allowMissing=false){
  if(allowMissing&&(!n||free(n,'undefined')||n.type==='UnaryExpression'&&n.operator==='void'))return true;
  if(n?.type==='ObjectExpression')return n.properties.every(p=>p.type==='Property'&&p.kind==='init'&&key(p)!==undefined&&key(p)!=='__proto__'&&key(p)!==field);
  if(n?.type!=='Identifier')return false;const b=bindings.get(n);if(!b||!fieldUnmodified(b,field)||seen.has(b))return false;seen=new Set(seen);seen.add(b);
  if(b.init)return initialized(b,n)&&absent(b.init,field,seen,allowMissing);
  const entry=parameters.get(b);return !!entry&&n.start>=entry.fn.body.start&&closedCalls.get(entry.fn).every(c=>{
   const supplied=c.arguments[entry.i],actual=primitive(supplied)===undefined&&entry.p.type==='AssignmentPattern'?entry.p.right:supplied;
   return absent(actual,field,new Set(seen),allowMissing);
  });
 }
 const objectGuarded=n=>{for(let p=parents.get(n);p;p=parents.get(p))if(p.type==='SwitchCase'&&p.test?.type==='Literal'&&p.test.value==='object'&&isolatedSwitchCase(ix,p)){const s=parents.get(p),v=s?.discriminant;if(v?.type==='UnaryExpression'&&v.operator==='typeof'&&v.argument.type==='Identifier'&&bindings.get(v.argument)===bindings.get(n.object))return true;}return false;};
 const unstablePrototype=new Set(Object.getOwnPropertyNames(Object.prototype));
 // A fresh literal still inherits properties. Reflection or escaped constructors
 // can expose/mutate its prototype without spelling Object.prototype directly.
 let unknownPrototype=nodes.some(n=>{
  if(n.type==='MemberExpression'&&['__proto__','constructor','getPrototypeOf','getOwnPropertyDescriptor','getOwnPropertyDescriptors','__defineGetter__','__defineSetter__','__lookupGetter__','__lookupSetter__'].includes(property(n)))return true;
  if(free(n,'Object')||free(n,'Reflect')){const p=parents.get(n);return p?.type==='MemberExpression'&&p.object===n?property(p)===undefined:p?.type!=='CallExpression'||p.callee!==n;}
  return false;
 });
 for(const n of nodes)if(n.type==='MemberExpression'&&free(n.object,'Object')&&property(n)==='prototype'){
  const p=parents.get(n),use=parents.get(p);
  if(p?.type==='MemberExpression'&&p.object===n){
   const field=property(p);if(field===undefined){unknownPrototype=true;continue;}
   if(use?.type==='AssignmentExpression'&&use.left===p||use?.type==='UpdateExpression'||use?.operator==='delete'||['ForInStatement','ForOfStatement'].includes(use?.type)&&use.left===p)unstablePrototype.add(field);
   else if(!(use?.type==='CallExpression'&&use.callee===p&&field==='hasOwnProperty'))unknownPrototype=true;
  }else if(p?.type==='CallExpression'&&p.arguments[0]===n&&p.callee.type==='MemberExpression'&&free(p.callee.object,'Object')&&property(p.callee)==='defineProperty'&&p.arguments[1]?.type==='Literal')unstablePrototype.add(p.arguments[1].value);
  else unknownPrototype=true;
 }
 for(const n of nodes)if(!unknownPrototype){
  if(n.type==='MemberExpression'&&n.object.type==='Identifier'&&typeof property(n)==='string'&&!unstablePrototype.has(property(n))){const p=parents.get(n),q=p?.type==='MemberExpression'&&p.object===n?parents.get(p):null;if(p?.type==='AssignmentExpression'&&p.left===n||p?.type==='UpdateExpression'||p?.operator==='delete'||q?.type==='AssignmentExpression'&&q.left===p||q?.type==='UpdateExpression'||q?.operator==='delete')continue;if(absent(n.object,property(n),new Set(),objectGuarded(n)))replace.set(n,'(void 0)');}
  if(n.type==='BinaryExpression'&&n.operator==='in'&&n.left.type==='Literal'&&typeof n.left.value==='string'&&!unstablePrototype.has(n.left.value)&&absent(n.right,n.left.value))replace.set(n,'false');
  if(n.type==='VariableDeclarator'&&n.id.type==='ObjectPattern'&&n.init?.type==='Identifier')for(const p of n.id.properties){
   const b=p.type==='Property'&&p.value.type==='Identifier'?bindings.get(p.value):null;
   if(b&&!b.writes.length&&key(p)!==undefined&&!unstablePrototype.has(key(p))&&absent(n.init,key(p)))for(const ref of b.refs)replace.set(ref,'(void 0)');
  }
 }
 function knownType(n,seen=new Set()){
  if(!n)return 'undefined';if(seen.has(n))return null;seen=new Set(seen);seen.add(n);
  const value=primitive(n);if(value!==UNKNOWN)return typeof value;
  if(n.type==='ObjectExpression'||n.type==='ArrayExpression')return 'object';
  if(n.type==='TemplateLiteral')return 'string';
  if(n.type!=='Identifier')return null;
  const b=bindings.get(n);if(!b||evaluated.has(b))return null;
  const written=b.writes.map(w=>w.type==='AssignmentExpression'&&w.operator==='='&&w.left.type==='Identifier'&&bindings.get(w.left)===b?knownType(w.right,new Set(seen)):null);
  if(written.some(t=>!t))return null;
  if(b.init){
   let t=initialized(b,n)?knownType(b.init,seen):null;
   if(!t&&initialized(b,n)&&b.init.type==='MemberExpression'){
    const candidates=finiteLiteralMember(ix,b.init),types=candidates?.map(v=>v.type==='TemplateLiteral'?'string':typeof v.value);
    if(types?.length&&types.every(v=>v===types[0]))t=types[0];
   }
   return t&&written.every(v=>v===t)?t:null;
  }
  const entry=parameters.get(b);if(!entry||n.start<entry.fn.body.start)return null;
  const all=closedCalls.get(entry.fn).map(c=>{const arg=c.arguments[entry.i],t=knownType(arg,new Set(seen));return t==='undefined'&&entry.p.type==='AssignmentPattern'?knownType(entry.p.right,new Set(seen)):t;});
  return all[0]&&[...all,...written].every(t=>t===all[0])?all[0]:null;
 }
 function possibleTypes(n,seen=new Set()){
  const known=knownType(n);if(known)return new Set([known]);
  if(n?.type!=='Identifier'||seen.has(n))return null;seen=new Set(seen);seen.add(n);
  const b=bindings.get(n),entry=parameters.get(b);if(!b||b.writes.length||!entry)return null;
  const result=new Set();
  for(const c of closedCalls.get(entry.fn)){
   let actual=c.arguments[entry.i];if(knownType(actual)==='undefined'&&entry.p.type==='AssignmentPattern')actual=entry.p.right;
   const types=possibleTypes(actual,new Set(seen));if(!types)return null;for(const type of types)result.add(type);
  }
  return result;
 }
 for(const clause of nodes)if(clause.type==='SwitchCase'&&clause.test?.type==='Literal'&&isolatedSwitchCase(ix,clause)){
  const test=parents.get(clause).discriminant;
  if(test.type==='UnaryExpression'&&test.operator==='typeof'){
   const types=possibleTypes(test.argument);
   if(types&&!types.has(clause.test.value)&&!nodes.some(n=>n.type==='Identifier'&&n.start>=clause.start&&n.end<=clause.end&&!ix.reference(n)&&bindings.get(n)?.refs.some(r=>r.start<clause.start||r.end>clause.end)))replace.set(clause,'');
  }
 }
 function emptyRecord(n,seen=new Set()){
  if(n?.type==='ObjectExpression')return !n.properties.length;
  if(n?.type!=='Identifier')return false;const b=bindings.get(n);if(!b||b.writes.length||evaluated.has(b)||seen.has(b))return false;
  if(b.refs.some(r=>{const p=parents.get(r),q=parents.get(p);return !(p?.type==='UnaryExpression'&&p.operator==='typeof'||p?.type==='MemberExpression'&&p.object===r&&property(p)!==undefined&&!(q?.type==='AssignmentExpression'&&q.left===p||q?.type==='UpdateExpression'||q?.operator==='delete')||p?.type==='CallExpression'&&p.arguments.length===1&&p.arguments[0]===r&&p.callee.type==='MemberExpression'&&free(p.callee.object,'Object')&&property(p.callee)==='keys');}))return false;
  seen=new Set(seen);seen.add(b);
  if(b.init)return initialized(b,n)&&emptyRecord(b.init,seen);
  const entry=parameters.get(b);return !!entry&&closedCalls.get(entry.fn).every(c=>{const arg=c.arguments[entry.i];return emptyRecord(!arg||free(arg,'undefined')?entry.p.type==='AssignmentPattern'?entry.p.right:null:arg,new Set(seen));});
 }
 function knownTruth(n,seen=new Set()){
  if(!n)return false;if(seen.has(n))return UNKNOWN;seen=new Set(seen);seen.add(n);
  const value=primitive(n);if(value!==UNKNOWN)return !!value;
  if(['ObjectExpression','ArrayExpression'].includes(n.type))return true;
  if(n.type!=='Identifier')return UNKNOWN;
  const b=bindings.get(n);if(!b||b.writes.length||evaluated.has(b))return UNKNOWN;
  if(b.init)return initialized(b,n)?knownTruth(b.init,seen):UNKNOWN;
  const entry=parameters.get(b);if(!entry||n.start<entry.fn.body.start)return UNKNOWN;
  const all=closedCalls.get(entry.fn).map(c=>{const arg=c.arguments[entry.i],missing=knownType(arg,new Set(seen))==='undefined';return knownTruth(missing&&entry.p.type==='AssignmentPattern'?entry.p.right:arg,new Set(seen));});
  return all.length&&all.every(v=>v===all[0])?all[0]:UNKNOWN;
 }
 for(const n of nodes)if(n.type==='UnaryExpression'&&n.operator==='typeof'){const type=knownType(n.argument);if(type)replace.set(n,JSON.stringify(type));}
 else if(n.type==='UnaryExpression'&&n.operator==='!'&&n.argument.type==='Identifier'){const truth=knownTruth(n.argument);if(truth!==UNKNOWN)replace.set(n,JSON.stringify(!truth));}
 else if(n.type==='MemberExpression'&&property(n)==='length'&&n.object.type==='CallExpression'&&n.object.arguments.length===1&&n.object.callee.type==='MemberExpression'&&free(n.object.callee.object,'Object')&&property(n.object.callee)==='keys'&&emptyRecord(n.object.arguments[0]))replace.set(n,'0');
 return renderTree(source,tree,n=>{
  if(replace.has(n))return {direct:true,value:replace.get(n)};
  if(n.type==='Property'&&n.shorthand&&replace.has(n.value))return {children:[n.value],render:child=>`${source.slice(n.key.start,n.key.end)}: ${child(n.value)}`};
  return null;
 });
}

// Give an unconditional input-normalization assignment its own binding. This
// keeps evaluation and identity intact while allowing closed-call field facts.
export function normalizeRecordParameters(source){
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree),changes=new WeakMap(),names=new Set(ix.nodes.filter(n=>n.type==='Identifier').map(n=>n.name));
 const evaluated=evaluationBindings(ix,source);
 for(const fn of ix.nodes.filter(n=>functions.has(n.type)&&ix.parents.get(n)?.type!=='MethodDefinition'))for(const id of fn.params){
  if(id.type!=='Identifier')continue;const b=ix.bindings.get(id),write=b?.writes[0],stmt=ix.parents.get(write),block=ix.parents.get(stmt);
  if(!b||evaluated.has(b)||b.init||b.writes.length!==1||write.type!=='AssignmentExpression'||write.operator!=='='||write.left!==id&&ix.bindings.get(write.left)!==b||stmt?.type!=='ExpressionStatement'||block?.type!=='BlockStatement'||ix.owners.get(write)!==fn||block.body[0]!==stmt||write.right.type!=='ConditionalExpression')continue;
  if(!b.refs.every(r=>r===write.left||r.start>=write.right.start&&r.end<=write.right.end||r.start>stmt.end&&r.end<block.end))continue;
  // The declaration remains in its original block. No catch/finally reference
  // may depend on the old parameter after its normalization.
  let name='input_'+id.name,i=2;while(names.has(name))name='input_'+id.name+i++;names.add(name);
  changes.set(id,name);for(const r of b.refs)if(r.start>=write.right.start&&r.end<=write.right.end)changes.set(r,name);
  changes.set(stmt,()=>`const ${id.name} = ${render(write.right)};`);
 }
 // The same normalization also occurs immediately after a local input
 // declaration. Preserve that initializer once, then bind the selected record.
 for(const d of ix.nodes.filter(n=>n.type==='VariableDeclarator'&&n.id.type==='Identifier'&&n.init)){
  const b=ix.bindings.get(d.id),decl=ix.parents.get(d),block=ix.parents.get(decl),write=b?.writes[0],stmt=ix.parents.get(write);
  if(!b||evaluated.has(b)||b.writes.length!==1||decl?.type!=='VariableDeclaration'||decl.kind!=='let'||decl.declarations.length!==1||!['Program','BlockStatement'].includes(block?.type)||stmt?.type!=='ExpressionStatement'||ix.parents.get(stmt)!==block||block.body.indexOf(stmt)!==block.body.indexOf(decl)+1||write.type!=='AssignmentExpression'||write.operator!=='='||write.right.type!=='ConditionalExpression'||ix.bindings.get(write.left)!==b)continue;
  if(!b.refs.every(r=>r===write.left||r.start>=write.right.start&&r.end<=write.right.end||r.start>stmt.end))continue;
  let name='input_'+d.id.name,i=2;while(names.has(name))name='input_'+d.id.name+i++;names.add(name);
  changes.set(d.id,name);for(const r of b.refs)if(r.start>=write.right.start&&r.end<=write.right.end)changes.set(r,name);
  changes.set(stmt,()=>`const ${d.id.name} = ${render(write.right)};`);
 }
 function render(root){return renderTree(source,root,n=>{if(!changes.has(n))return null;const value=changes.get(n);return {direct:true,value:typeof value==='function'?value():value};});}
 return render(tree);
}

// Project a single closed message consumer onto the fields it actually uses.
// This is a local data object, never an injected proxy-platform API/runtime.
export function lowerMessageParameters(source){
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree),replace=new WeakMap();
 const {nodes,parents,bindings,free}=ix;
 for(const kind of ['$request','$response']){
  const refs=nodes.filter(n=>free(n,kind)&&!(parents.get(n)?.type==='UnaryExpression'&&parents.get(n).operator==='typeof'));
  if(refs.length!==1)continue;
  const ref=refs[0],call=parents.get(ref),binding=bindings.get(call?.callee),fn=binding?.fn;
  if(call?.type!=='CallExpression'||call.arguments.some(n=>n.type==='SpreadElement')||!functions.has(fn?.type)||binding.writes.length||binding.refs.length!==1||parents.get(binding.refs[0])!==call)continue;
  const p=fn.params[call.arguments.indexOf(ref)],parameter=p?.type==='Identifier'?bindings.get(p):null;
  if(!parameter?.refs.length||parameter.writes.length)continue;
  const fields=new Set();let valid=true;
  for(const r of parameter.refs){const member=parents.get(r),key=property(member);if(member?.type!=='MemberExpression'||member.object!==r||!['url','method','headers','body','bodyBytes','status','statusCode'].includes(key)){valid=false;break;}fields.add(key);}
  if(valid)replace.set(ref,'{'+[...fields].map(key=>{
   const value=key==='headers'?`Object.fromEntries([...${kind}["headers"].entries()].map(([name, value]) => [name, ${kind}["headers"].getAll(name).length > 1 ? ${kind}["headers"].getAll(name) : value]))`:`${kind}[${JSON.stringify(key)}]`;
   return JSON.stringify(key)+':'+value;
  }).join(', ')+'}');
 }
 return renderTree(source,tree,n=>replace.has(n)?{direct:true,value:replace.get(n)}:null);
}

// Project only wholly observed message objects whose complete local data flow is
// a closed set of known fields. This keeps native messages out of unknown code
// while preserving ordinary object mutation and return semantics for adapters.
export function lowerClosedMessageObjects(source){
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree),replace=new WeakMap();
 const {nodes,parents,bindings,free}=ix;
 const fieldsByKind={$request:new Set(['url','method','headers','body','bodyBytes']),$response:new Set(['status','statusCode','headers','body','bodyBytes'])};
 const nullish=n=>free(n,'undefined')||n?.type==='UnaryExpression'&&n.operator==='void';
 function target(callee){
  if(functions.has(callee?.type))return callee;
  if(callee?.type!=='Identifier')return null;
  const binding=bindings.get(callee);return binding?.fn&&functions.has(binding.fn.type)?binding.fn:null;
 }
 function directCalls(fn){
  const parent=parents.get(fn),id=fn.id??(parent?.type==='VariableDeclarator'?parent.id:null),binding=id?.type==='Identifier'?bindings.get(id):null;
  if(parent?.type==='CallExpression'&&parent.callee===fn&&!parent.optional&&parent.arguments.every(a=>a.type!=='SpreadElement'))return [parent];
  if(!binding||binding.writes.length||!binding.refs.length)return null;
  const calls=[];for(const ref of binding.refs){const call=parents.get(ref);if(call?.type!=='CallExpression'||call.callee!==ref||call.optional||call.arguments.some(a=>a.type==='SpreadElement'))return null;calls.push(call);}
  return calls;
 }
 function headerValue(kind){const value=`${kind}["headers"]`;return `Object.fromEntries([...${value}.entries()].map(([name, value]) => [name, ${value}.getAll(name).length > 1 ? ${value}.getAll(name) : value]))`;}
 function objectLiteral(kind,fields){
  return '{'+[...fields].map(field=>JSON.stringify(field)+': '+(field==='headers'?headerValue(kind):`${kind}[${JSON.stringify(field)}]`)).join(', ')+'}';
 }
 function fieldUse(kind,ref,fields,state,local=false){
  const member=parents.get(ref),key=property(member);if(member?.type!=='MemberExpression'||member.object!==ref||key===undefined||!fieldsByKind[kind].has(String(key)))return null;
  fields.add(String(key));
  const outer=parents.get(member);
  if(outer?.type==='MemberExpression'&&outer.object===member&&String(key)==='headers'){
   // 投影副本的 headers 是普通对象；只放行静态键的普通读取与就地写入，
   // 方法调用和动态键仍可能依赖原始 Headers 语义，必须拒绝。
   if(!local||property(outer)===undefined)return null;
   const nestedUse=parents.get(outer);
   if(nestedUse?.type==='CallExpression'&&nestedUse.callee===outer)return null;
   if(nestedUse?.type==='AssignmentExpression'&&nestedUse.left===outer||nestedUse?.type==='UpdateExpression'||nestedUse?.type==='UnaryExpression'&&nestedUse.operator==='delete')state.write=true;
   return 'used';
  }
  if(outer?.type==='CallExpression'&&outer.callee===member)return null;
  const write=outer?.type==='AssignmentExpression'&&outer.left===member&&outer.operator==='='||outer?.type==='UpdateExpression'||outer?.type==='UnaryExpression'&&outer.operator==='delete';
  // `statusCode` 是旧平台别名，写回后与 `status` 的同步关系无法证明；
  // 直接写宿主消息对象也会丢失宿主语义。只有 helper 参数上的普通快照
  // `status` 字段可以按本地对象语义保留。
  if(write&&String(key)==='statusCode'||write&&String(key)==='status'&&!local)return null;
  if(write)state.write=true;
  return 'used';
 }
 function proveBinding(binding,kind,fields,state,seen=new Set()){
  if(!binding||seen.has(binding))return false;seen=new Set(seen);seen.add(binding);
  const before=state.write;
  for(const ref of binding.refs){
   const parent=parents.get(ref);
   if(parent?.type==='AssignmentExpression'&&parent.left===ref&&parent.operator==='='&&binding.writes.includes(parent))continue;
   if(parent?.type==='UnaryExpression'&&parent.operator==='typeof')continue;
   const other=parent?.left===ref?parent.right:parent?.right===ref?parent.left:null;
   if(parent?.type==='BinaryExpression'&&['==','!=','===','!=='].includes(parent.operator)&&(other?.type==='Literal'&&other.value===null||nullish(other)))continue;
   if(fieldUse(kind,ref,fields,state))continue;
   return false;
  }
  return state.write===before;
 }
 function proveReturnedValue(fn,kind,fields,state,seen=new Set()){
  const calls=directCalls(fn);if(!calls||!calls.length||seen.has(fn))return false;seen=new Set(seen);seen.add(fn);
  return calls.every(call=>proveValue(call,kind,fields,state,seen));
 }
 function proveParameter(fn,parameter,kind,fields,state,seen=new Set()){
  const binding=bindings.get(parameter);if(!binding||seen.has(binding))return false;seen=new Set(seen);seen.add(binding);
  let returned=false;
  for(const ref of binding.refs){
   const parent=parents.get(ref);
   if(parent?.type==='ReturnStatement'&&parent.argument===ref||parent?.type==='SequenceExpression'&&parent.expressions.at(-1)===ref&&parents.get(parent)?.type==='ReturnStatement'){returned=true;continue;}
   // 消息对象可以继续传给另一个已静态定位的 helper；只有该 helper 的对应
   // 参数也能完成同样的字段封闭证明时才放行，未知 callee 仍然拒绝。
   if(parent?.type==='CallExpression'&&parent.arguments.includes(ref)){
    const next=target(parent.callee),parameter=next?.params[parent.arguments.indexOf(ref)];
    if(next&&parameter?.type==='Identifier'&&proveParameter(next,parameter,kind,fields,state,seen))continue;
   }
   if(!fieldUse(kind,ref,fields,state,true))return false;
  }
  return !returned||proveReturnedValue(fn,kind,fields,state,seen);
 }
 function proveValue(node,kind,fields,state,seen=new Set()){
  let current=node;
  while(current&&(current.type==='AwaitExpression'||current.type==='ChainExpression'))current=current.argument??current.expression;
  while(parents.get(current)?.type==='AwaitExpression'&&parents.get(current).argument===current||parents.get(current)?.type==='ChainExpression'&&parents.get(current).expression===current)current=parents.get(current);
  while(parents.get(current)?.type==='SequenceExpression'&&parents.get(current).expressions.at(-1)===current&&parents.get(parents.get(current))?.type!=='ReturnStatement')current=parents.get(current);
  const parent=parents.get(current);if(!parent)return true;
  if(parent.type==='ExpressionStatement'||parent.type==='SequenceExpression'&&parent.expressions.at(-1)!==current)return true;
  if(parent.type==='CallExpression'&&parent.arguments.includes(current)){
   const fn=target(parent.callee),parameter=fn?.params[parent.arguments.indexOf(current)];
   return !!parameter&&parameter.type==='Identifier'&&proveParameter(fn,parameter,kind,fields,state,seen);
  }
  if(parent.type==='VariableDeclarator'&&parent.init===current&&parent.id.type==='Identifier')return proveBinding(bindings.get(parent.id),kind,fields,state,seen);
  if(parent.type==='AssignmentExpression'&&parent.right===current&&parent.left.type==='Identifier')return proveBinding(bindings.get(parent.left),kind,fields,state,seen);
  if(parent.type==='MemberExpression'&&parent.object===current){
   const key=property(parent);if(key===undefined||!fieldsByKind[kind].has(String(key)))return false;fields.add(String(key));
   const outer=parents.get(parent);if(outer?.type==='MemberExpression'&&outer.object===parent&&parents.get(outer)?.type==='CallExpression'&&parents.get(outer).callee===outer)return false;
   if(outer?.type==='CallExpression'&&outer.callee===parent)return false;
   return true;
  }
  return false;
 }
 const ignored=n=>{const p=parents.get(n),other=p?.left===n?p.right:p?.left;return p?.type==='UnaryExpression'&&p.operator==='typeof'||p?.type==='BinaryExpression'&&['==','!=','===','!=='].includes(p.operator)&&(other?.type==='Literal'&&other.value===null||nullish(other))||p?.type==='ExpressionStatement'&&p.expression===n;};
 for(const kind of ['$request','$response']){
  const refs=nodes.filter(n=>free(n,kind));
  if(!refs.length)continue;
  const plans=[];let valid=true,directRefs=0,directWrites=0;
  for(const ref of refs){
   if(ignored(ref))continue;
   const parent=parents.get(ref);
   if(parent?.type==='MemberExpression'&&parent.object===ref){
    directRefs++;
    const outer=parents.get(parent);if(outer?.type==='UpdateExpression'||outer?.type==='UnaryExpression'&&outer.operator==='delete'||outer?.type==='AssignmentExpression'&&outer.left===parent)directWrites++;
    continue;
   }
   if(parent?.type==='VariableDeclarator'&&parent.init===ref&&parent.id.type==='Identifier'){
    const binding=bindings.get(parent.id);if(!binding||binding.writes.length){valid=false;break;}plans.push({ref,fields:new Set(),state:{write:false},binding});continue;
   }
   if(parent?.type==='AssignmentExpression'&&parent.right===ref&&parent.operator==='='&&parent.left.type==='Identifier'){
    const binding=bindings.get(parent.left);if(!binding||binding.writes.length!==1||binding.writes[0]!==parent){valid=false;break;}plans.push({ref,fields:new Set(),state:{write:false},binding});continue;
   }
   if(parent?.type==='CallExpression'&&parent.arguments.includes(ref)){
    const fn=target(parent.callee),parameter=fn?.params[parent.arguments.indexOf(ref)];
    if(!fn||parameter?.type!=='Identifier'){valid=false;break;}plans.push({ref,fields:new Set(),state:{write:false},fn,parameter});continue;
   }
   valid=false;break;
  }
  if(!valid||!plans.length)continue;
  const fields=new Set();
  if(!plans.every(plan=>plan.binding?proveBinding(plan.binding,kind,plan.fields,plan.state):proveParameter(plan.fn,plan.parameter,kind,plan.fields,plan.state)))continue;
  for(const plan of plans)for(const field of plan.fields)fields.add(field);
  if(directRefs&&plans.some(plan=>plan.state.write)||directWrites||plans.length>1&&plans.some(plan=>plan.state.write))continue;
  for(const plan of plans)replace.set(plan.ref,objectLiteral(kind,fields));
 }
 return renderTree(source,tree,n=>replace.has(n)?{direct:true,value:replace.get(n)}:null);
}

// 旧响应脚本有时会把修改后的回复重新写回宿主 `$response`。这里只本地化唯一
// 一次无条件写入：被该写入支配的读取看到本地结果，而写入之前求值的读取
// （包括赋值右侧）仍保留宿主全局。
export function lowerReboundHostGlobals(source){
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree);
 const {nodes,parents,free,owners}=ix,changes=new Map(),declarations=[],rebindings=[],names=new Set(nodes.filter(n=>n.type==='Identifier').map(n=>n.name));
 const fresh=base=>{let name=base,i=2;while(names.has(name))name=base+i++;names.add(name);return name;};
 for(const kind of ['$request','$response']){
  const writes=nodes.filter(n=>n.type==='Identifier'&&free(n,kind)&&parents.get(n)?.type==='AssignmentExpression'&&parents.get(n).left===n);
  if(writes.length!==1)continue;
  const write=writes[0],assignment=parents.get(write),statement=parents.get(assignment);
  if(assignment.operator!=='='||statement?.type!=='ExpressionStatement')continue;
  const reads=nodes.filter(n=>n!==write&&n.type==='Identifier'&&free(n,kind));
  const base=owners.get(statement);
  // 赋值之后创建的非提升闭包不可能提前运行；同一作用域的读取也必须位于赋值
  // 语句之后。提升函数声明和赋值右侧创建的闭包仍按宿主读取处理。
  const follows=read=>{
   let owner=owners.get(read);
   while(owner&&owner!==base&&owner!==tree){
    if(!owner||owner.type==='FunctionDeclaration'||owner.start<statement.end)return false;
    owner=owners.get(parents.get(owner));
   }
   return read.start>=statement.end;
  };
  const dominated=reads.filter(read=>initializedAfter(ix,statement,read)||follows(read));
  if(!dominated.length)continue;
  const local=fresh(kind.slice(1)+'Result');
  changes.set(write,local);for(const read of dominated)changes.set(read,local);declarations.push(local);rebindings.push({kind,name:local});
 }
 if(!changes.size)return {source,rebindings};
 const prefix=declarations.map(name=>`let ${name};`).join('\n')+'\n';
 return {source:prefix+renderTree(source,tree,n=>changes.has(n)?{direct:true,value:changes.get(n)}:null),rebindings};
}

// 旧脚本常在入口覆盖 `$done`，先保存原函数，再包一层只改字段的同步函数。
// 只有当 QX 折叠已经把包装器压成“纯丢弃平台对象 + 一次原样委托”时，这层
// 包装才是恒等函数：保存点唯一且不逃逸，参数不重绑、不保存、不传播，
// 所有完成调用都保持一参契约。默认值 `{}` 由无参调用和显式 undefined
// 调用改写补回；其它可能为 undefined 的实参形状继续拒绝。
export function lowerClosedCompletionWrappers(source,format){
 if(format!=='qx'||!source.includes('$done'))return {source,transformations:[]};
 let tree,ix;
 try{tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true});ix=index(tree);}catch{return {source,transformations:[]};}
 const {nodes,parents,bindings,free}=ix,replace=new WeakMap(),remove=new Set();
 const doneRefs=nodes.filter(n=>n.type==='Identifier'&&free(n,'$done'));
 const writes=doneRefs.filter(ref=>parents.get(ref)?.type==='AssignmentExpression'&&parents.get(ref).left===ref);
 if(writes.length!==1)return {source,transformations:[]};
 const write=writes[0],assignment=parents.get(write),wrapper=assignment.right;
 const assignmentStatement=parents.get(assignment);
 if(assignment.operator!=='='||assignmentStatement?.type!=='ExpressionStatement'||parents.get(assignmentStatement)!==tree)return {source,transformations:[]};
 if(wrapper?.type!=='ArrowFunctionExpression'||wrapper.async||wrapper.generator||wrapper.params.length!==1)return {source,transformations:[]};
 const parameter=wrapper.params[0],id=parameter.type==='AssignmentPattern'?parameter.left:parameter;
 if(id.type!=='Identifier'||parameter.type==='AssignmentPattern'&&(parameter.right.type!=='ObjectExpression'||parameter.right.properties.length))return {source,transformations:[]};
 const parameterBinding=bindings.get(id);
 if(!parameterBinding||parameterBinding.writes.length||parameterBinding.refs.length!==1)return {source,transformations:[]};
 // 保存原始完成函数的声明必须位于顶层、恰好一个声明符，且只被包装器
 // 的委托调用读取。读取点同时决定包装器唯一返回路径的位置。
 const snapshots=doneRefs.filter(ref=>{
  const d=parents.get(ref);return ref!==write&&d?.type==='VariableDeclarator'&&d.init===ref;
 });
 if(snapshots.length!==1)return {source,transformations:[]};
 const snapshot=snapshots[0],declarator=parents.get(snapshot),declaration=parents.get(declarator),snapshotBinding=bindings.get(declarator.id);
 if(declarator.id.type!=='Identifier'||!snapshotBinding||snapshotBinding.writes.length||snapshotBinding.refs.length!==1)return {source,transformations:[]};
 if(declaration?.type!=='VariableDeclaration'||declaration.declarations.length!==1||parents.get(declaration)!==tree||declaration.start>=assignmentStatement.start)return {source,transformations:[]};
 // 除保存点和唯一重绑定外，剩余 `$done` 引用只能是直接调用；作为值保存、
 // 传参、返回、typeof 探测或成员接收者都会改变消除后的语义，保持拒绝。
 const calls=doneRefs.filter(ref=>{
  const p=parents.get(ref);return ref!==write&&ref!==snapshot&&p?.type==='CallExpression'&&p.callee===ref;
 }).map(ref=>parents.get(ref));
 if(doneRefs.some(ref=>ref!==write&&ref!==snapshot&&!calls.includes(parents.get(ref))))return {source,transformations:[]};
 const delegation=parents.get(snapshotBinding.refs[0]);
 if(delegation?.type!=='CallExpression'||delegation.callee!==snapshotBinding.refs[0]||delegation.arguments.length!==1||delegation.arguments[0]!==parameterBinding.refs[0])return {source,transformations:[]};
 if(wrapper.body.type!=='BlockStatement'||wrapper.body.body.length<1)return {source,transformations:[]};
 const last=wrapper.body.body.at(-1);
 if(last.type!=='ExpressionStatement'||last.expression!==delegation||parents.get(last)!==wrapper.body)return {source,transformations:[]};
 // 包装器只允许在委托前读取并丢弃 QX 平台对象。读取本身无副作用，删除
 // 不会改变完成结果；任何业务表达式、调用或字段访问仍需进一步证明。
 for(const statement of wrapper.body.body.slice(0,-1))if(statement.type!=='ExpressionStatement'||statement.expression.type!=='Identifier'||!free(statement.expression,'$prefs'))return {source,transformations:[]};
 const hasDefault=parameter.type==='AssignmentPattern';
 const definitelyNotUndefined=n=>n?.type==='Literal'&&!n.regex||['ObjectExpression','ArrayExpression','FunctionExpression','ArrowFunctionExpression','ClassExpression','NewExpression','TemplateLiteral'].includes(n?.type)||n?.type==='UnaryExpression'&&['!','typeof','+','-','~'].includes(n.operator)||n?.type==='BinaryExpression'||n?.type==='SequenceExpression'&&definitelyNotUndefined(n.expressions.at(-1));
 for(const call of calls){
  if(call.optional||call.arguments.length>1||call.arguments.some(argument=>argument.type==='SpreadElement'))return {source,transformations:[]};
  const argument=call.arguments[0];
  if(!hasDefault)continue;
  if(!argument){replace.set(call,`$done({})`);continue;}
  const undefinedArgument=free(argument,'undefined')||argument.type==='UnaryExpression'&&argument.operator==='void'&&argument.argument.type==='Literal';
  if(undefinedArgument){replace.set(call,`$done({})`);continue;}
  if(!definitelyNotUndefined(argument))return {source,transformations:[]};
 }
 remove.add(declaration);remove.add(assignmentStatement);
 const output=renderTree(source,tree,n=>remove.has(n)?{direct:true,value:''}:replace.has(n)?{direct:true,value:replace.get(n)}:null);
 return {source:output,transformations:[{kind:'closed-completion-wrapper',line:source.slice(0,assignment.start).split('\n').length,reason:'QX 折叠后包装器只丢弃平台对象并原样委托唯一完成快照'}]};
}

// QX 兼容层常把 `$prefs` / `$persistentStore` 的选择封装成局部 store 门面。
// 只有门面对象是顶层唯一声明、没有别名或写入，且每个引用都是 `get(key)` /
// `set(value,key)` 直接调用时，才能把请求参数按原顺序投影到 QX 存储方法。
// 这样不需要把平台对象本身作为值传出，也不会遗漏动态成员或方法别名。
export function lowerClosedStorageFacades(source,format){
 if(format!=='qx'||!source.includes('$prefs'))return {source,transformations:[]};
 let tree,ix;
 try{tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true});ix=index(tree);}catch{return {source,transformations:[]};}
 const {nodes,parents,bindings,free}=ix,replace=new WeakMap(),remove=new Set();
 const storageMember=(node,name)=>{
  if(node?.type!=='ChainExpression')return node?.type==='MemberExpression'&&free(node.object,'$prefs')&&property(node)===name?node:null;
  const member=node.expression;
  return member?.type==='MemberExpression'&&member.optional&&free(member.object,'$prefs')&&property(member)===name?member:null;
 };
 const selector=(node,memberName,persistentName)=>node?.type==='LogicalExpression'&&node.operator==='??'&&storageMember(node.left,memberName)&&node.right?.type==='MemberExpression'&&free(node.right.object,'$persistentStore')&&property(node.right)===persistentName;
 const propertyValue=(object,name)=>object.properties.filter(p=>p.type==='Property'&&!p.computed&&p.kind==='init'&&(p.key.name??p.key.value)===name);
 for(const statement of tree.body){
  if(statement.type!=='VariableDeclaration'||statement.kind!=='const'||statement.declarations.length!==1)continue;
  const declarator=statement.declarations[0],binding=declarator.id.type==='Identifier'?bindings.get(declarator.id):null,object=declarator.init;
  if(!binding||binding.writes.length||object?.type!=='ObjectExpression')continue;
  const get=propertyValue(object,'get'),set=propertyValue(object,'set');
  if(get.length!==1||set.length!==1||object.properties.length!==2||set[0].value.type!=='ArrowFunctionExpression')continue;
  if(!selector(get[0].value,'valueForKey','read'))continue;
  const setter=set[0].value;
  if(setter.async||setter.generator||setter.params.length!==2||setter.params.some(param=>param.type!=='Identifier')||setter.body.type!=='CallExpression'||setter.body.arguments.length!==2||!selector(setter.body.callee,'setValueForKey','write'))continue;
  const sameParameter=(argument,parameter)=>argument?.type==='Identifier'&&parameter?.type==='Identifier'&&bindings.get(argument)===bindings.get(parameter);
  if(!sameParameter(setter.body.arguments[0],setter.params[1])||!sameParameter(setter.body.arguments[1],setter.params[0]))continue;
  const calls=[];
  if(!binding.refs.length||binding.refs.some(ref=>{
   const member=parents.get(ref);
   if(member?.type!=='MemberExpression'||member.object!==ref||member.computed||!['get','set'].includes(property(member)))return true;
   const call=parents.get(member);
   if(call?.type!=='CallExpression'||call.callee!==member||call.optional||call.arguments.some(argument=>argument.type==='SpreadElement'))return true;
   if(property(member)==='get'&&call.arguments.length!==1||property(member)==='set'&&call.arguments.length!==2)return true;
   calls.push({call,kind:property(member)});return false;
  }))continue;
  for(const {call,kind} of calls){
   const args=call.arguments.map(argument=>source.slice(argument.start,argument.end));
   // 门面 setter 已证明把调用参数 `(key,value)` 转成存储 API 的
   // `(value,key)`；改写时必须保持同一顺序，不能直接照搬实参列表。
   replace.set(call,kind==='get'?`$prefs.valueForKey(${args[0]})`:`$prefs.setValueForKey(${args[1]}, ${args[0]})`);
  }
  remove.add(statement);
  const output=renderTree(source,tree,n=>remove.has(n)?{direct:true,value:''}:replace.has(n)?{direct:true,value:replace.get(n)}:null);
  return {source:output,transformations:[{kind:'closed-storage-facade',line:source.slice(0,statement.start).split('\n').length,reason:'存储门面只被闭合的 get/set 调用消费'}]};
 }
 return {source,transformations:[]};
}

// A closed callback helper can have different completion contracts at different
// call sites. Clone its declaration, not its arguments: evaluation, closures and
// defaults still belong to the original calls. No callback runtime is injected.
export function specializeCallbacks(source,generated){
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree),replace=new WeakMap(),names=new Set(ix.nodes.filter(n=>n.type==='Identifier').map(n=>n.name));
 const declarationCounts=new Map(),usesArguments=new WeakSet();
 for(const n of ix.nodes){
  if(n.type==='VariableDeclarator'||n.type==='FunctionDeclaration'){
   const b=ix.bindings.get(n.id);if(b)declarationCounts.set(b,(declarationCounts.get(b)||0)+1);
  }
  if(ix.free(n,'arguments'))for(let p=ix.parents.get(n);p;p=ix.parents.get(p))if(functions.has(p.type))usesArguments.add(p);
 }
 const fresh=base=>{let n=base,i=2;while(names.has(n))n=base+i++;names.add(n);return n;};
 for(const fn of ix.nodes.filter(n=>functions.has(n.type)&&!n.generator)){
  const parent=ix.parents.get(fn),d=parent?.type==='VariableDeclarator'?parent:null,id=fn.type==='FunctionDeclaration'?fn.id:d?.id;
  if(id?.type!=='Identifier'||fn.type!=='FunctionDeclaration'&&fn.id||d&&ix.parents.get(d).declarations.length!==1)continue;
  const b=ix.bindings.get(id),statement=d?ix.parents.get(d):fn;
  if(!b||b.writes.length||b.refs.length<2||b.refs.length>16||declarationCounts.get(b)!==1)continue;
  const calls=b.refs.map(r=>ix.parents.get(r));if(calls.some((c,i)=>c?.type!=='CallExpression'||c.callee!==b.refs[i]||c.optional||c.arguments.some(a=>a.type==='SpreadElement')||c.start>=fn.start&&c.end<=fn.end))continue;
  if(usesArguments.has(fn))continue;
  const positions=fn.params.map((p,i)=>{const id=p.type==='AssignmentPattern'?p.left:p,pb=ix.bindings.get(id);return id.type==='Identifier'&&pb&&!pb.writes.length&&pb.refs.some(r=>{const c=ix.parents.get(r);return c?.type==='CallExpression'&&c.callee===r;})?i:-1;}).filter(i=>i>=0);
  if(!positions.some(i=>calls.every(c=>functions.has(c.arguments[i]?.type))&&new Set(calls.map(c=>c.arguments[i])).size>1))continue;
  const copies=[];
  for(let i=0;i<calls.length;i++){
   const name=fresh(id.name+'Callback'+(i+1));generated.add(name);replace.set(b.refs[i],name);
   copies.push(fn.type==='FunctionDeclaration'?source.slice(fn.start,id.start)+name+source.slice(id.end,fn.end):ix.parents.get(d).kind+' '+name+' = '+source.slice(fn.start,fn.end)+';');
  }
  replace.set(statement,copies.join('\n'));
 }
 return renderTree(source,tree,n=>replace.has(n)?{direct:true,value:replace.get(n)}:null);
}

// Specialize closed receiver arguments and finite method selectors. No SDK
// receiver escapes, selector evaluation or argument side effects are discarded.
export function lowerClosedReceiverArguments(source, objectOnly=false){
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree),replace=new WeakMap();
 const {nodes,parents,bindings}=ix;
 const receivers=new Set();
 for(const d of nodes)if(d.type==='VariableDeclarator'&&parents.get(parents.get(d))===tree){
  const b=bindings.get(d.id),c=d.init,f=bindings.get(c?.callee)?.fn,last=f?.body.type==='BlockStatement'?f.body.body.at(-1):null;
  const returnedClass=last?.type==='ReturnStatement'&&last.argument?.type==='NewExpression'&&last.argument.callee.type==='ClassExpression';
  const returnedObject=last?.type==='ReturnStatement'&&last.argument?.type==='ObjectExpression'&&f.body.body.length>1;
  if(b&&!b.writes.length&&['CallExpression','NewExpression'].includes(c?.type)&&f&&(returnedObject||!objectOnly&&returnedClass))receivers.add(b);
 }
 if(!receivers.size)return source;
 const definitions=new Map();for(const n of nodes)if(n.type==='FunctionDeclaration'){const b=bindings.get(n.id);definitions.set(b,(definitions.get(b)??0)+1);}
 for(const fn of nodes.filter(n=>n.type==='FunctionDeclaration'&&!n.generator)){
  const b=bindings.get(fn.id);if(!b||b.writes.length||!b.refs.length||definitions.get(b)!==1)continue;
  const calls=b.refs.map(r=>parents.get(r));if(calls.some((c,i)=>c?.type!=='CallExpression'||c.callee!==b.refs[i]||c.optional||c.arguments.some(a=>a.type==='SpreadElement')))continue;
  if(!fn.params.some((p,i)=>p.type==='Identifier'&&calls.every(c=>c.arguments[i]?.type==='Identifier'&&receivers.has(bindings.get(c.arguments[i]))))||index(fn).nodes.some(n=>ix.free(n,'arguments')))continue;
  for(let i=0;i<fn.params.length;i++){
   const p=fn.params[i],param=p.type==='Identifier'?bindings.get(p):null;if(!param||param.writes.length||!param.refs.length)continue;
   const actual=calls.map(c=>c.arguments[i]);if(actual.some(a=>a?.type!=='Identifier'))continue;
   const receiver=bindings.get(actual[0]);if(!receivers.has(receiver)||actual.some(a=>bindings.get(a)!==receiver))continue;
   const d=parents.get(receiver.init),declaration=parents.get(d);if(d?.type!=='VariableDeclarator'||parents.get(declaration)!==tree||calls.some(c=>!initializedAfter(ix,declaration,c)))continue;
   if(nodes.some(n=>n.type==='Identifier'&&n.name===actual[0].name&&n.start>=fn.start&&n.end<=fn.end&&bindings.has(n)&&bindings.get(n)!==receiver))continue;
   if(param.refs.some(r=>{const m=parents.get(r);return m?.type!=='MemberExpression'||m.object!==r||m.optional||property(m)===undefined;}))continue;
   for(const r of param.refs)replace.set(r,actual[0].name);
   // The discarded argument is an initialized immutable local read. Keeping
   // its unused formal avoids shifting later argument/default evaluation.
   for(const a of actual)replace.set(a,'void 0');
  }
 }
 const render=n=>replace.has(n)?replace.get(n):patch(source,n,render);return render(tree);
}

export function lowerFiniteMethodCalls(source){
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree),replace=new WeakMap();
 const {nodes,parents,bindings,owners}=ix,UNKNOWN=Symbol('unknown'),parameters=new Map(),names=new Set(nodes.filter(n=>n.type==='Identifier').map(n=>n.name));
 const fresh=base=>{let value=base,i=2;while(names.has(value))value=base+i++;names.add(value);return value;};
 const factory=b=>{const c=b?.init,f=bindings.get(c?.callee)?.fn;return !b?.writes.length&&['NewExpression','CallExpression'].includes(c?.type)&&f?.body.type==='BlockStatement'&&f.body.body.at(-1)?.argument?.callee?.type==='ClassExpression'?f:null;};
 const calls=nodes.filter(call=>{
  if(call.type!=='CallExpression'||call.optional||call.callee.type!=='MemberExpression'||!call.callee.computed||property(call.callee)!==undefined||call.arguments.some(a=>a.type==='SpreadElement'))return false;
  let receiver=call.callee.object;if(receiver.type==='MemberExpression'&&property(receiver)!==undefined)receiver=receiver.object;
  return receiver.type==='Identifier'&&!!factory(bindings.get(receiver));
 });
 if(!calls.length)return source;
 const definitions=new Map(),parameterOwners=new Map();
 for(const n of nodes){if(['FunctionDeclaration','VariableDeclarator'].includes(n.type)){const b=bindings.get(n.id);definitions.set(b,(definitions.get(b)??0)+1);}if(functions.has(n.type))n.params.forEach((p,i)=>{const id=p.type==='AssignmentPattern'?p.left:p;if(id.type==='Identifier')parameterOwners.set(bindings.get(id),{fn:n,i,defaultValue:p.type==='AssignmentPattern'?p.right:null});});}
 function closedCalls(fn){
  const parent=parents.get(fn),id=fn.id??(parent?.type==='VariableDeclarator'?parent.id:null),b=bindings.get(id);
  if(b&&!b.writes.length&&b.refs.length&&definitions.get(b)===1){
   const calls=b.refs.map(r=>parents.get(r));
   if(calls.every((c,i)=>c?.type==='CallExpression'&&c.callee===b.refs[i]&&!c.optional&&!c.arguments.some(a=>a.type==='SpreadElement')))return calls;
   // A closed array callback is also a finite call site. Resolve each literal
   // element as the callback's first argument; this is analysis only, so the
   // original map/forEach call and its evaluation order remain intact.
   const callbackInputs=[];
   for(let i=0;i<calls.length;i++){
    const call=calls[i],ref=b.refs[i],callee=call?.callee;
    if(call?.type!=='CallExpression'||call.optional||callee?.type!=='MemberExpression'||!['map','forEach'].includes(property(callee))||
       call.arguments[0]!==ref||call.arguments.length>2||call.arguments.some(a=>a.type==='SpreadElement')||
       index(fn).nodes.some(n=>n.type==='ThisExpression'&&n.start>=fn.start&&n.end<=fn.end))return null;
    const elements=arrayElements(callee.object);if(!elements)return null;
    callbackInputs.push(...elements.map(value=>({arguments:[value]})));
   }
   if(callbackInputs.length)return callbackInputs;
  }
  if(parent?.type!=='MethodDefinition'||parent.static||parent.computed||parent.kind!=='method')return null;
  const cls=parents.get(parents.get(parent)),cb=cls?.type==='ClassDeclaration'?bindings.get(cls.id):null;
  if(!cb||cb.writes.length||!cb.refs.length||cb.refs.some(r=>parents.get(r)?.type!=='NewExpression'||parents.get(r).callee!==r))return null;
  const members=nodes.filter(n=>n.type==='MemberExpression'&&property(n)===key(parent));
  if(!members.length||members.some(m=>m.object.type!=='ThisExpression'||m.start<cls.start||m.end>cls.end||parents.get(m)?.type!=='CallExpression'||parents.get(m).callee!==m||parents.get(m).arguments.some(a=>a.type==='SpreadElement')))return null;
  return members.map(m=>parents.get(m));
 }
 function arrayElements(n,seen=new Set()){
  if(!n||seen.has(n))return null;seen=new Set(seen);seen.add(n);
  if(n.type==='ChainExpression')return arrayElements(n.expression,seen);
  if(n.type==='ArrayExpression')return n.elements.every(e=>e?.type!=='SpreadElement')?n.elements.filter(Boolean):null;
  if(n.type==='ConditionalExpression'||n.type==='LogicalExpression'){
   const a=arrayElements(n.consequent??n.left,new Set(seen)),b=arrayElements(n.alternate??n.right,new Set(seen));return a&&b?[...a,...b]:null;
  }
  if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&['find','filter'].includes(property(n.callee))&&n.arguments.length===1&&functions.has(n.arguments[0]?.type))return arrayElements(n.callee.object,seen);
  if(n.type==='MemberExpression'&&n.computed){
   const values=arrayElements(n.object,seen);if(!values)return null;
   const indexValue=n.property.type==='Literal'&&Number.isInteger(n.property.value)?n.property.value:null;
   return indexValue===null?values:values[indexValue]?[values[indexValue]]:[];
  }
  if(n.type==='Identifier'){
   const b=bindings.get(n);if(!b)return null;
   const writes=b.writes.filter(w=>!(w.type==='AssignmentExpression'&&w.operator==='='&&w.left.type==='Identifier'&&bindings.get(w.left)===b));
   if(writes.some(w=>w.type!=='AssignmentExpression'||w.operator!=='='||w.left.type!=='Identifier'||bindings.get(w.left)!==b))return null;
   const inputs=[b.init,...writes.map(w=>w.right)].filter(Boolean);
   if(inputs.length)return inputs.flatMap(value=>arrayElements(value,new Set(seen))??[]);
   const entry=parameterOwners.get(b),sites=entry&&closedCalls(entry.fn);if(!sites)return null;
   const sets=sites.map(c=>arrayElements(c.arguments[entry.i]??entry.defaultValue,new Set(seen)));return sets.every(Boolean)?sets.flat():null;
  }
  return null;
 }
 function objectRecords(n,seen=new Set(),at=Infinity){
  if(!n||seen.has(n))return null;seen=new Set(seen);seen.add(n);
  if(n.type==='ChainExpression')return objectRecords(n.expression,seen,at);
  if(n.type==='ObjectExpression')return [n];
  // Primitive request shorthand (for example, a URL string) has no own
  // method/body fields. Retain it as a closed record so optional property
  // reads can be proven absent without treating the string as an object.
  if(n.type==='Literal'&&['string','number','boolean'].includes(typeof n.value))return [n];
  if(n.type==='ConditionalExpression'||n.type==='LogicalExpression'){
   const a=objectRecords(n.consequent??n.left,new Set(seen),at),b=objectRecords(n.alternate??n.right,new Set(seen),at);return a&&b?[...a,...b]:null;
  }
  if(n.type==='MemberExpression'&&n.computed)return arrayElements(n.object,seen)?.flatMap(value=>objectRecords(value,new Set(seen),at)??[])??null;
  if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&['find','filter'].includes(property(n.callee))&&n.arguments.length===1&&functions.has(n.arguments[0]?.type))return arrayElements(n.callee.object,seen)?.flatMap(value=>objectRecords(value,new Set(seen),at)??[])??null;
  if(n.type==='MemberExpression'&&property(n)!==undefined){
   const records=objectRecords(n.object,seen,at);if(!records)return null;
   const values=records.map(record=>{
    if(record.type!=='ObjectExpression'||record.properties.some(p=>p.type!=='Property'||p.kind!=='init'||key(p)===undefined||key(p)==='__proto__'))return undefined;
    return record.properties.findLast(p=>String(key(p))===String(property(n)))?.value??null;
   });return values.every(value=>value!==undefined)?values.flatMap(value=>value?objectRecords(value,new Set(seen),at)??[value]:[]):null;
  }
  if(n.type==='Identifier'){
   const b=bindings.get(n);if(!b)return null;
   const writes=b.writes.filter(w=>w.start<at);
   if(writes.some(w=>w.type!=='AssignmentExpression'||w.operator!=='='||w.left.type!=='Identifier'||bindings.get(w.left)!==b))return null;
   // Reassigned record variables are safe only when every read is a static
   // field access or a direct call into a closed local function.
   const stable=b.refs.every(ref=>{
    const p=parents.get(ref),q=parents.get(p);
    if(p?.type==='MemberExpression'&&p.object===ref){
     const mutation=q?.type==='AssignmentExpression'&&q.left===p||q?.type==='UpdateExpression'||q?.type==='UnaryExpression'&&q.operator==='delete';
     return property(p)!==undefined&&(!mutation||q.start>=at);
    }
    if(p?.type==='AssignmentExpression'&&p.left===ref&&p.operator==='=')return true;
    if(p?.type==='Property'&&p.value===ref&&q?.type==='ObjectExpression')return p.kind==='init';
    if(p?.type==='ConditionalExpression'&&(p.test===ref||p.consequent===ref||p.alternate===ref)||p?.type==='IfStatement'&&p.test===ref||p?.type==='LogicalExpression'&&(p.left===ref||p.right===ref)||p?.type==='BinaryExpression'||p?.type==='UnaryExpression')return true;
    if(p?.type==='CallExpression'&&p.arguments.includes(ref)){
     if(p.start>=at)return true;
     if(calls.includes(p)||ix.free(p.callee,'console'))return true;
     const fn=bindings.get(p.callee)?.fn;return !!fn&&!!closedCalls(fn);
    }
    return false;
   });
   if(!stable)return null;
   const selfBranches=(value)=>{
    if(value?.type==='Identifier'&&bindings.get(value)===b)return {values:[],self:true};
    if(value?.type==='ConditionalExpression'){
     const a=selfBranches(value.consequent),c=selfBranches(value.alternate);return {values:[...a.values,...c.values],self:a.self||c.self};
    }
    if(value?.type==='LogicalExpression'&&['&&','||','??'].includes(value.operator)){
     const a=selfBranches(value.left),c=selfBranches(value.right);return {values:[...a.values,...c.values],self:a.self||c.self};
    }
    return {values:[value],self:false};
   };
   const branches=writes.map(w=>selfBranches(w.right));if(branches.some(x=>x.self)&&!b.init)return null;
   const inputs=[b.init,...branches.flatMap(x=>x.values)].filter(Boolean);
   if(inputs.length)return inputs.flatMap(value=>objectRecords(value,new Set(seen),at)??[]);
   const entry=parameterOwners.get(b),sites=entry&&closedCalls(entry.fn);if(!sites)return null;
   const sets=sites.map(c=>objectRecords(c.arguments[entry.i]??entry.defaultValue,new Set(seen),at));return sets.every(Boolean)?sets.flat():null;
  }
  return null;
 }
 function recordValues(n,field,seen=new Set(),at=Infinity){
  if(!n||seen.has(n))return null;seen=new Set(seen);
  if(n.type==='ChainExpression')return recordValues(n.expression,field,seen,at);
  const records=objectRecords(n,seen,at);if(!records)return null;
  return records.map(record=>{
   if(record.type==='Literal'&&['string','number','boolean'].includes(typeof record.value))return null;
   if(record.type!=='ObjectExpression'||record.properties.some(p=>p.type!=='Property'||p.kind!=='init'||key(p)===undefined||key(p)==='__proto__'))return undefined;
   return record.properties.findLast(p=>String(key(p))===field)?.value??null;
  }).every(value=>value!==undefined)?records.map(record=>record.properties.findLast(p=>String(key(p))===field)?.value??null):null;
 }
 function values(n,seen=new Set()){
  if(!n)return new Set([undefined]);if(seen.has(n))return UNKNOWN;seen=new Set(seen);seen.add(n);
  if(n.type==='Literal'&&(typeof n.value==='string'||n.value===null))return new Set([n.value]);
  if(n.type==='ChainExpression')return values(n.expression,seen);
  if(n.type==='MemberExpression'&&property(n)!==undefined){const inputs=recordValues(n.object,String(property(n)),new Set(seen),n.start);if(!inputs)return UNKNOWN;const sets=inputs.map(v=>values(v,new Set(seen)));return sets.some(v=>v===UNKNOWN)?UNKNOWN:new Set(sets.flatMap(v=>[...v]));}
  if(n.type==='LogicalExpression'&&['||','??'].includes(n.operator)){const a=values(n.left,seen),b=values(n.right,seen);return a===UNKNOWN||b===UNKNOWN?UNKNOWN:new Set([...a].filter(v=>n.operator==='||'?v:v!=null).concat([...b]));}
  if(n.type==='ConditionalExpression'){
   const test=values(n.test,new Set(seen));
   const truthy=test===UNKNOWN?null:[...test].map(Boolean);
   if(truthy?.every(Boolean))return values(n.consequent,seen);
   if(truthy?.every(value=>!value))return values(n.alternate,seen);
   const a=values(n.consequent,seen),b=values(n.alternate,seen);return a===UNKNOWN||b===UNKNOWN?UNKNOWN:new Set([...a,...b]);
  }
  if(n.type==='UnaryExpression'&&['!','void','typeof','+','-'].includes(n.operator)){
   const input=values(n.argument,new Set(seen));if(input===UNKNOWN)return UNKNOWN;const result=new Set();
   for(const value of input){
    if(n.operator==='!')result.add(!value);
    else if(n.operator==='void')result.add(undefined);
    else if(n.operator==='typeof')result.add(typeof value);
    else if(['number','string','boolean'].includes(typeof value))result.add(n.operator==='+'?+value:-value);
    else return UNKNOWN;
   }
   return result.size<=8?result:UNKNOWN;
  }
  if(n.type==='CallExpression'&&!n.arguments.length&&n.callee.type==='MemberExpression'&&['toLowerCase','toUpperCase'].includes(property(n.callee))){const a=values(n.callee.object,seen);return a===UNKNOWN||[...a].some(v=>v!==undefined&&typeof v!=='string')?UNKNOWN:new Set([...a].filter(v=>v!==undefined).map(v=>property(n.callee)==='toLowerCase'?v.toLowerCase():v.toUpperCase()));}
  if(n.type!=='Identifier')return UNKNOWN;
  const b=bindings.get(n);if(!b)return UNKNOWN;
  if(!b.init&&!parameters.has(b)){const entry=parameterOwners.get(b),sites=entry&&closedCalls(entry.fn);parameters.set(b,sites?.flatMap(c=>{const actual=c.arguments[entry.i];return !actual||ix.free(actual,'undefined')?[entry.defaultValue]:[actual,...(entry.defaultValue?[entry.defaultValue]:[])];})??null);}
  let inputs=b.init?[b.init]:parameters.get(b);if(!inputs)return UNKNOWN;
  const writes=b.writes.filter(w=>!(w.type==='AssignmentExpression'&&w.operator==='='&&w.right.type==='Identifier'&&bindings.get(w.right)===b));
  if(writes.some(w=>w.type!=='AssignmentExpression'||w.operator!=='='||w.left.type!=='Identifier'||bindings.get(w.left)!==b))return UNKNOWN;
  inputs=[...inputs,...writes.map(w=>w.right)];const result=new Set();
  for(const v of inputs){const candidate=values(v,seen);if(candidate===UNKNOWN)return UNKNOWN;for(const value of candidate)result.add(value);}
  return result.size<=8?result:UNKNOWN;
 }
 for(const call of calls){
  const m=call.callee;
  const candidates=values(m.property);if(candidates===UNKNOWN)continue;
  const methods=[...candidates].filter(v=>v!==undefined);
  if(!methods.length||methods.some(v=>!['get','post','put','delete','head','options','patch'].includes(v)))continue;
  const selector=fresh('selectedMethod'),args=call.arguments.map(()=>fresh('selectedArgument'));
  replace.set(call,()=>`((${[selector,...args].join(', ')}) => {${methods.map(method=>`if (${selector} === ${JSON.stringify(method)}) return ${render(m.object)}.${method}(${args.join(', ')});`).join('')}throw new TypeError('Unknown HTTP method');})(${[m.property,...call.arguments].map(n=>'('+render(n)+')').join(', ')})`);
 }
 function render(root){return renderTree(source,root,n=>replace.has(n)?{direct:true,value:replace.get(n)()}:null);}
 return render(tree);
}

// Resolve a closed table of function names without evaluating input JavaScript.
// The compiler rejects unknown or mutable names when the result is invoked.

export function lowerFunctionDispatch(source){
 const ix=index(parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}));
 const {nodes,bindings,parents,owners,free}=ix,replace=new WeakMap(),transformations=[],rejected=[];
 const declarations=new Map();for(const n of nodes)if(['VariableDeclarator','FunctionDeclaration'].includes(n.type)){const b=bindings.get(n.id);if(b)declarations.set(b,(declarations.get(b)??0)+1);}
 const stableObject=!nodes.some(n=>n.type==='MemberExpression'&&['prototype','__proto__','constructor'].includes(property(n)))&&nodes.filter(n=>free(n,'Object')).every(n=>{const p=parents.get(n),use=parents.get(p);return p?.type==='CallExpression'&&p.callee===n||p?.type==='MemberExpression'&&p.object===n&&['keys','entries','assign'].includes(property(p))&&use?.type==='CallExpression'&&use.callee===p;});
 const table=n=>{
  const b=n?.type==='Identifier'?bindings.get(n):null;
  if(!stableObject||!b||b.writes.length||declarations.get(b)!==1||b.init?.type!=='ObjectExpression')return null;
  if(!b.refs.every(r=>{const p=parents.get(r);if(p?.type==='MemberExpression'&&p.object===r){const use=parents.get(p);return !(use?.type==='AssignmentExpression'&&use.left===p||use?.type==='UpdateExpression'||use?.operator==='delete')&&!(use?.type==='CallExpression'&&use.arguments.includes(p));}return p?.type==='CallExpression'&&p.arguments.length===1&&p.arguments[0]===r&&p.callee.type==='MemberExpression'&&free(p.callee.object,'Object')&&['keys','entries'].includes(property(p.callee));}))return null;
  return b.init.properties.every(p=>p.type==='Property'&&p.kind==='init'&&!p.method&&key(p)!==undefined&&key(p)!=='__proto__'&&p.value.type==='Literal'&&typeof p.value.value==='string')?b.init:null;
 };
 function values(n,seen=new Set()){
  if(!n||free(n,'undefined'))return new Set([undefined]);
  if(n.type==='Literal'&&!n.regex)return new Set([n.value]);
  if(n.type==='ConditionalExpression'){const a=values(n.consequent,new Set(seen)),b=values(n.alternate,new Set(seen));return a&&b?new Set([...a,...b]):null;}
  if(n.type==='Identifier'){
   const b=bindings.get(n);if(!b||seen.has(b))return null;seen.add(b);
   if(!b.init){
    const declaration=nodes.find(d=>d.type==='VariableDeclarator'&&d.id.type==='ArrayPattern'&&d.id.elements[1]?.type==='Identifier'&&bindings.get(d.id.elements[1])===b),loop=parents.get(parents.get(declaration));
    const call=loop?.type==='ForOfStatement'?loop.right:null;
    if(b.writes.length!==1||b.writes[0]!==loop||call?.type!=='CallExpression'||call.arguments.length!==1||call.callee.type!=='MemberExpression'||!free(call.callee.object,'Object')||property(call.callee)!=='entries')return null;
    const object=table(call.arguments[0]);return object?new Set(object.properties.map(p=>p.value.value)):null;
   }
   if(b.writes.length)return null;
   return values(b.init,seen);
  }
  if(n.type==='MemberExpression'){
   const object=table(n.object);if(!object)return null;
   const k=property(n),entries=k===undefined?object.properties:object.properties.filter(p=>String(key(p))===String(k));
   return new Set([undefined,...entries.map(p=>p.value.value)]);
  }
  if(n.type==='CallExpression'&&n.callee.type==='Identifier'){
   const b=bindings.get(n.callee),fn=b?.init;
   if(!b||b.writes.length||!functions.has(fn?.type)||fn.async||fn.generator||seen.has(b)||!b.refs.every(r=>parents.get(r)?.type==='CallExpression'&&parents.get(r).callee===r))return null;
   seen.add(b);const returns=fn.body.type==='BlockStatement'?nodes.filter(r=>r.type==='ReturnStatement'&&owners.get(r)===fn).map(r=>r.argument):[fn.body];
   const out=new Set([undefined]);for(const r of returns){const v=values(r,new Set(seen));if(!v)return null;for(const x of v)out.add(x);}return out;
  }
  return null;
 }
 for(const n of nodes)if(n.type==='CallExpression'&&free(n.callee,'eval')&&!n.optional&&n.arguments.length===1){
  const parent=parents.get(n),binding=parent?.type==='VariableDeclarator'&&parent.init===n&&parent.id.type==='Identifier'?bindings.get(parent.id):null;
  const invoked=(parent?.type==='CallExpression'||parent?.type==='NewExpression')&&parent.callee===n||
   !!binding?.refs.some(ref=>{const use=parents.get(ref);return (use?.type==='CallExpression'||use?.type==='NewExpression')&&use.callee===ref;});
  const candidates=values(n.arguments[0]);if(!candidates){if(invoked)rejected.push({line:source.slice(0,n.start).split('\n').length});continue;}
  const names=[...candidates].filter(v=>typeof v==='string');if(!names.length||names.length>128){if(invoked)rejected.push({line:source.slice(0,n.start).split('\n').length});continue;}
  let valid=true;
  for(const name of names){
   if(!/^[A-Za-z_$][\w$]*$/.test(name)){valid=false;break;}
   let b;for(let s=ix.scopes.get(n);s;s=s.parent)if(s.names.has(name)){b=s.names.get(name);break;}
   if(!b||b.writes.length||declarations.get(b)!==1||!functions.has(b.init?.type)||b.init.type!=='FunctionDeclaration'&&!initializedAfter(ix,parents.get(b.init),n)){valid=false;break;}
  }
  if(!valid){if(invoked)rejected.push({line:source.slice(0,n.start).split('\n').length});continue;}
  replace.set(n,`(value => typeof value === 'string' ? ({${names.map(name=>JSON.stringify(name)+': '+name).join(', ')}})[value] : value)(${source.slice(n.arguments[0].start,n.arguments[0].end)})`);
  transformations.push({kind:'finite-function-dispatch',line:source.slice(0,n.start).split('\n').length,functions:names});
 }
 const render=n=>replace.has(n)?replace.get(n):patch(source,n,render);
 return {source:render(ix.nodes[0]),transformations,rejected};
}

// 旧平台脚本运行在 sloppy 模式：普通调用时 this 被强制成全局对象；Egern 产物是 ES
// 模块（严格模式），普通调用得到 undefined。this 本身是标准 JavaScript，不改写它，
// 只把"接收者已被证明"之外的位置包成运行时保持的 sloppy 语义：
//   this  ->  sloppyThis(this)
// 方法/构造器/原型方法/类体/严格模式函数里的 this 保持原样，避免打乱既有数据流；
// 类体与 'use strict' 函数本来就是严格语义，无需处理。this.$xxx 表示读取旧平台对象，
// 留给平台对象降级或分析器处理，不在这里自动改写。
export function lowerSloppyThis(source){
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree),parents=ix.parents,edits=[];
 const ordinary=ordinaryReceivers(tree,[]);
 const strictContext=n=>{
  for(let p=parents.get(n);p;p=parents.get(p)){
   if(p.type==='Program')return false;
   if(p.type==='ClassBody'||p.type==='ClassDeclaration'||p.type==='ClassExpression'||p.type==='PropertyDefinition'||p.type==='StaticBlock')return true;
   if(/^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(p.type)&&p.body?.body?.some(s=>s.directive==='use strict'))return true;
  }
  return false;
 };
 const receiverProven=n=>{
  try{return !!(ordinary.descriptorThis(n)||ordinary.methodReceiver(n));}catch{return false;}
 };
 const platformReceiver=n=>{
  const p=parents.get(n);
  if(p?.type!=='MemberExpression'||p.object!==n)return false;
  const name=p.computed?(p.property?.type==='Literal'?p.property.value:undefined):p.property?.name;
  return typeof name==='string'&&name.startsWith('$');
 };
 for(const n of ix.nodes){
  if(n.type!=='ThisExpression'||strictContext(n)||receiverProven(n)||platformReceiver(n))continue;
  edits.push({start:n.start,end:n.end,line:source.slice(0,n.start).split('\n').length});
 }
 if(!edits.length)return {source,transformations:[],globalName:null,helperName:null};
 const taken=new Set(ix.nodes.filter(n=>n.type==='Identifier').map(n=>n.name));
 const fresh=base=>{let name=base,n=2;while(taken.has(name))name=base+n++;taken.add(name);return name;};
 const globalName=fresh('scriptGlobalThis'),helperName=fresh('sloppyThis');
 let output=source;
 for(const edit of edits.sort((a,b)=>b.start-a.start))output=output.slice(0,edit.start)+helperName+'(this)'+output.slice(edit.end);
 return {source:output,globalName,helperName,transformations:edits.map(({line})=>({kind:'sloppy-this',to:helperName+'(this)',line,reason:'sloppy 模式下 this 为 null/undefined 时取全局对象，ES 模块严格模式需要显式保留'}))};
}

// Lower accessors on a single closed factory instance to ordinary local calls.
// No property descriptor, receiver alias, reflection or prototype escapes qualify.
export function lowerClosedAccessors(source){
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree),replace=new WeakMap();
 const {nodes,parents,bindings,owners}=ix,names=new Set(nodes.filter(n=>n.type==='Identifier').map(n=>n.name));
 const fresh=base=>{let name=base,i=2;while(names.has(name))name=base+i++;names.add(name);return name;};
 for(const factory of nodes.filter(n=>n.type==='FunctionDeclaration')){
  const returned=factory.body.body.at(-1),construction=returned?.type==='ReturnStatement'?returned.argument:null,cls=construction?.type==='NewExpression'?construction.callee:null;
  if(cls?.type!=='ClassExpression'||cls.superClass||cls.body.body.some(m=>m.type!=='MethodDefinition'||m.static||m.computed))continue;
  const accessors=new Map();let valid=true;
  for(const m of cls.body.body)if(['get','set'].includes(m.kind)){
   const name=key(m);if(['__proto__','constructor','prototype'].includes(name)){valid=false;break;}
   if(!accessors.has(name))accessors.set(name,{});const pair=accessors.get(name);if(pair[m.kind]){valid=false;break;}pair[m.kind]=m;pair[m.kind+'Name']=fresh('accessor_'+m.kind+'_'+name);
  }
  if(!valid||!accessors.size||cls.body.body.some(m=>m.kind==='method'&&accessors.has(key(m))))continue;
  const fb=bindings.get(factory.id),ref=fb?.refs[0],call=parents.get(ref),d=parents.get(call),decl=parents.get(d);
  if(!fb||fb.writes.length||fb.refs.length!==1||!['CallExpression','NewExpression'].includes(call?.type)||call.callee!==ref||d?.type!=='VariableDeclarator'||d.id.type!=='Identifier'||decl?.type!=='VariableDeclaration'||decl.declarations.length!==1||parents.get(decl)!==tree)continue;
  const instance=bindings.get(d.id);if(!instance||instance.writes.length)continue;
  if(instance.refs.some(r=>{const m=parents.get(r);return m?.type!=='MemberExpression'||m.object!==r||m.optional||property(m)===undefined||!(r.start>=factory.start&&r.end<=factory.end)&&!initializedAfter(ix,decl,r);}))continue;
  const thisReceiver=n=>{let owner=owners.get(n);while(owner?.type==='ArrowFunctionExpression')owner=owners.get(parents.get(owner));return parents.get(owner)?.type==='MethodDefinition'&&parents.get(parents.get(parents.get(owner)))===cls;};
  const members=new Map();for(const m of cls.body.body){if(!members.has(key(m)))members.set(key(m),[]);members.get(key(m)).push(m);}
  const live=new Set(['constructor',...instance.refs.filter(r=>r.start<factory.start||r.end>factory.end).map(r=>property(parents.get(r)))]),queue=[...live];
  while(queue.length)for(const m of members.get(queue.shift())??[])for(const n of index(m.value).nodes)if(n.type==='MemberExpression'&&(bindings.get(n.object)===instance||n.object.type==='ThisExpression'&&thisReceiver(n))){const name=property(n);if(name!==undefined&&!live.has(name)){live.add(name);queue.push(name);}}
  const unused=cls.body.body.filter(m=>!live.has(key(m))),dead=n=>unused.some(m=>n.start>=m.start&&n.end<=m.end);
  // Passing this or an alias could observe getters/descriptors or mutate them.
  if(nodes.some(n=>!dead(n)&&n.type==='ThisExpression'&&n.start>=cls.start&&n.end<=cls.end&&thisReceiver(n)&&(parents.get(n)?.type!=='MemberExpression'||parents.get(n).object!==n||property(parents.get(n))===undefined)))continue;
  const reads=[];
  for(const n of nodes)if(!dead(n)&&n.type==='MemberExpression'&&(bindings.get(n.object)===instance||n.object.type==='ThisExpression'&&thisReceiver(n))&&accessors.has(property(n))){
   const pair=accessors.get(property(n)),p=parents.get(n),write=p?.type==='AssignmentExpression'&&p.left===n;
   if(p?.type==='UpdateExpression'||p?.operator==='delete'||['ForInStatement','ForOfStatement'].includes(p?.type)&&p.left===n||write&&(p.operator!=='='||!pair.set)){valid=false;break;}
   reads.push({n,p,pair,write});
  }
  if(!valid)continue;
  const argumentMethods=[];
  for(const m of cls.body.body.filter(m=>!dead(m)&&m.kind==='method')){
   const fn=m.value,local=index(fn),refs=local.nodes.filter(n=>local.free(n,'arguments')&&(()=>{let owner=owners.get(n);while(owner?.type==='ArrowFunctionExpression')owner=owners.get(parents.get(owner));return owner===fn;})());
   if(!refs.length)continue;
   const ids=fn.params.map(p=>p.type==='AssignmentPattern'?p.left:p);
   if(ids.some(p=>p.type!=='Identifier')||fn.params.some(p=>p.type==='AssignmentPattern'&&index(p.right).nodes.some(n=>n.type==='Identifier'&&bindings.has(n)&&local.nodes.some(d=>['VariableDeclarator','FunctionDeclaration'].includes(d.type)&&bindings.get(d.id)===bindings.get(n))))||refs.some(r=>{const p=parents.get(r),u=parents.get(p);return r.start<fn.body.start||p?.type!=='MemberExpression'||p.object!==r||!(property(p)==='length'||Number.isInteger(property(p))&&property(p)>=0)||u?.type==='AssignmentExpression'&&u.left===p||u?.type==='UpdateExpression'||u?.operator==='delete';})||ids.some(id=>local.nodes.some(n=>['VariableDeclarator','FunctionDeclaration'].includes(n.type)&&bindings.get(n.id)===bindings.get(id)))){valid=false;break;}
   const args=fresh('methodArguments');argumentMethods.push({m,fn,args});for(const ref of refs)replace.set(ref,()=>args);
  }
  if(!valid)continue;
  for(const m of unused)replace.set(m,()=> '');
  for(const {n,p,pair,write}of reads){
   if(write){const value=fresh('assignedValue');replace.set(p,()=>`((${value}) => {${render(n.object)}.${pair.setName}(${value}); return ${value};})(${render(p.right)})`);}
   else{
    const body=pair.get?.value.body.body,expr=body?.length===1&&body[0].type==='ReturnStatement'?body[0].argument:null;
    const local=expr?index(expr):null;
    const inline=local&&local.nodes.every(v=>['Identifier','Literal','UnaryExpression','BinaryExpression','LogicalExpression','ConditionalExpression'].includes(v.type))&&local.nodes.filter(v=>local.free(v)).every(v=>['$request','$response','undefined'].includes(v.name)&&!nodes.some(id=>id.type==='Identifier'&&id.name===v.name&&bindings.has(id)));
    replace.set(n,()=>inline?'('+source.slice(expr.start,expr.end)+')':pair.get?`${render(n.object)}.${pair.getName}()`:'(void 0)');
   }
  }
  for(const pair of accessors.values())for(const kind of ['get','set'])if(pair[kind]&&!dead(pair[kind])){const m=pair[kind];replace.set(m,()=>`${pair[kind+'Name']}(${m.value.params.map(render).join(', ')}) ${render(m.value.body)}`);}
  for(const {m,fn,args}of argumentMethods)replace.set(m,()=>`${fn.async?'async ':''}${fn.generator?'*':''}${source.slice(m.key.start,m.key.end)}(...${args}) {let [${fn.params.map(render).join(', ')}] = ${args};${render(fn.body).slice(1,-1)}}`);
 }
 function render(root){return renderTree(source,root,n=>replace.has(n)?{direct:true,value:replace.get(n)()}:null);}
 return render(tree);
}

// 极简 regenerator 只接受同步、单入口、无异常/finally、完成槽单写不逃逸的
// `.wrap` 机器。改写限定在“外层函数只返回该机器，且生成器只在单一 `.next()`
// driver 上消费”的闭合形状；其他形状继续沿原有拒收路径失败。
export function lowerMinimalRegenerator(source){
 if(!source.includes('wrap')||!source.includes('$done'))return {source,transformations:[],released:[]};
 let tree,ix,proof;
 try{
  tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true});
  ix=index(tree);
  proof=regeneratorStateMachine(ix,source);
 }catch{return {source,transformations:[],released:[]};}
 if(!proof.machines.some(machine=>machine.minimal))return {source,transformations:[],released:[]};
 const wraps=ix.nodes.filter(n=>n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&property(n.callee)==='wrap'&&n.arguments.length>=2&&functions.has(n.arguments[0]?.type));
 const edits=[],released=[];
 for(let i=0;i<proof.machines.length;i++){
  const machine=proof.machines[i];
  if(!machine.minimal||!wraps[i])continue;
  const plan=planLowering(wraps[i],ix,source,machine);
  if(plan.error){released.push({line:machine.line,released:false,reason:plan.error});continue;}
  edits.push(...plan.edits);
  released.push({line:machine.line,released:true});
 }
 if(!edits.length)return {source,transformations:[],released};
 const unique=[];
 for(const edit of edits.sort((a,b)=>a.start-b.start)){
  if(unique.length&&edit.start<unique.at(-1).end)return {source,transformations:[],released:[...released,{released:false,reason:'极简状态机改写区间重叠'}]};
  unique.push(edit);
 }
 let output=source;
 for(const edit of unique.sort((a,b)=>b.start-a.start))output=output.slice(0,edit.start)+edit.replacement+output.slice(edit.end);
 return {source:output,transformations:released.filter(item=>item.released).map(item=>({kind:'minimal-regenerator',line:item.line})),released};
}

function planLowering(call,ix,source,machine){
 const {parents,bindings,free}=ix;
 const ret=parents.get(call);
 if(ret?.type!=='ReturnStatement'||ret.argument!==call)return {error:'极简状态机必须由外层函数直接返回'};
 const block=parents.get(ret),outer=parents.get(block);
 if(block?.type!=='BlockStatement'||block.body.length!==1||!functions.has(outer?.type)||outer.body!==block)return {error:'外层函数必须只包含机器返回'};
 if(outer.async||outer.generator||outer.params.length||outer.id?.type!=='Identifier')return {error:'外层函数必须是同步无参具名函数'};
 if(call.callee.type!=='MemberExpression'||call.callee.computed||property(call.callee)!=='wrap')return {error:'极简状态机必须使用静态 wrap 成员'};
 const receiver=call.callee.object;
 if(receiver.type!=='Identifier')return {error:'wrap 接收者必须是稳定局部绑定'};
 const receiverBinding=bindings.get(receiver);
 if(!receiverBinding||receiverBinding.writes.length)return {error:'wrap 接收者不是稳定局部绑定'};
 const inner=call.arguments[0];
 if(inner.type!=='FunctionExpression'||inner.async||inner.generator||inner.id||inner.params.length!==1||inner.params[0].type!=='Identifier'||inner.body.type!=='BlockStatement')return {error:'极简状态机正文形状未知'};
 const tryNode=call.arguments[3];
 const exceptions=machine?.exceptions??[];
 if(tryNode&&!(tryNode.type==='Literal'&&tryNode.value===null)&&!exceptions.length)return {error:'极简状态机异常表未通过证明'};
 if(exceptions.some(entry=>typeof entry.tryLoc!=='number'||typeof entry.catchLoc!=='number'||entry.tryLoc>=entry.catchLoc))return {error:'极简状态机异常表范围不可用'};
 if(call.arguments.slice(1,3).some(argument=>!argument||!['Identifier','Literal','ThisExpression'].includes(argument.type)))return {error:'wrap 辅助参数必须是静态值'};
 const forbidden=ix.nodes.filter(n=>n.start>=inner.start&&n.end<=inner.end&&(n.type==='TryStatement'||n.type==='AwaitExpression'||n.type==='YieldExpression'||n.type==='ThisExpression'||n.type==='Super'||n.type==='MetaProperty'||n.type==='WithStatement'));
 if(forbidden.length)return {error:'极简状态机正文含未支持的执行语义'};
 if(ix.nodes.some(n=>n.start>=inner.start&&n.end<=inner.end&&n.type==='Identifier'&&n.name==='arguments'&&free(n,'arguments')))return {error:'极简状态机正文读取 arguments'};
 if(ix.nodes.some(n=>n.start>=inner.start&&n.end<=inner.end&&n.type==='ExpressionStatement'&&typeof n.directive==='string'))return {error:'极简状态机正文包含指令序言'};

 const doneRefs=ix.nodes.filter(n=>n.start>=inner.start&&n.end<=inner.end&&n.type==='Identifier'&&n.name==='$done'&&free(n,'$done'));
 if(doneRefs.length!==1)return {error:'极简状态机要求恰好一个完成调用'};
 const doneRef=doneRefs[0];
 const doneParent=parents.get(doneRef);
 const innerStart=inner.body.start+1;
 let innerText=source.slice(innerStart,inner.body.end-1),slotEdits=[];
 if(!(doneParent?.type==='CallExpression'&&doneParent.callee===doneRef)){
  let slot,write,assignment=false;
  if(doneParent?.type==='VariableDeclarator'&&doneParent.init===doneRef&&doneParent.id.type==='Identifier'){
   slot=doneParent.id;write=doneParent;
  }else if(doneParent?.type==='AssignmentExpression'&&doneParent.operator==='='&&doneParent.right===doneRef&&doneParent.left.type==='Identifier'){
   slot=doneParent.left;write=doneParent;assignment=true;
  }
  if(!slot)return {error:'极简状态机完成函数必须直接调用或保存到单一标识符'};
  const binding=bindings.get(slot);
  if(!binding||(assignment?(binding.writes.length!==1||binding.writes[0]!==write):binding.writes.length!==0)||binding.refs.length!==1)return {error:'极简状态机完成槽必须单写且不逃逸'};
  const use=parents.get(binding.refs[0]);
  if(!(use?.type==='CallExpression'&&use.callee===binding.refs[0]))return {error:'极简状态机完成槽必须直接调用'};
  slotEdits.push({start:binding.refs[0].start,end:binding.refs[0].end,replacement:'$done'});
  let declaration;
  if(assignment){
   const statement=parents.get(write);
   if(statement?.type!=='ExpressionStatement'||statement.expression!==write)return {error:'极简状态机完成槽必须由独立语句写入'};
   declaration=statement;
  }else{
   const variable=parents.get(write);
   if(variable?.type!=='VariableDeclaration'||variable.declarations.length!==1)return {error:'极简状态机完成槽必须由单一声明写入'};
   declaration=variable;
  }
  slotEdits.push({start:declaration.start,end:declaration.end,replacement:''});
 }
 innerText=applyLocalEdits(innerText,slotEdits.map(edit=>({...edit,start:edit.start-innerStart,end:edit.end-innerStart})));

 const outerBinding=bindings.get(outer.id);
 if(!outerBinding||outerBinding.writes.length)return {error:'外层函数绑定已重写'};
 const refs=outerBinding.refs.filter(ref=>ref.start<outer.start||ref.end>outer.end);
 if(refs.length!==1)return {error:'外层函数必须只有一个生成器 driver'};
 const ref=refs[0],driverCall=parents.get(ref);
 if(driverCall?.type!=='CallExpression'||driverCall.callee!==ref||driverCall.arguments.length||driverCall.optional)return {error:'外层函数必须由无参直接调用驱动'};
 const driverParent=parents.get(driverCall);
 let driverEdit=null;
 if(driverParent?.type==='MemberExpression'&&driverParent.object===driverCall&&!driverParent.computed&&property(driverParent)==='next'){
  const nextCall=parents.get(driverParent),statement=parents.get(nextCall);
  if(nextCall?.type!=='CallExpression'||nextCall.callee!==driverParent||nextCall.arguments.length||statement?.type!=='ExpressionStatement'||statement.expression!==nextCall)return {error:'生成器 driver 必须直接丢弃 next 结果'};
  driverEdit={start:statement.start,end:statement.end,replacement:source.slice(driverCall.start,driverCall.end)+';'};
 }else if(driverParent?.type==='VariableDeclarator'&&driverParent.init===driverCall&&driverParent.id.type==='Identifier'){
  const binding=bindings.get(driverParent.id);
  if(!binding||binding.writes.length||binding.refs.length!==1)return {error:'生成器 driver 绑定必须单读'};
  const member=parents.get(binding.refs[0]),nextCall=parents.get(member),statement=parents.get(nextCall);
  if(member?.type!=='MemberExpression'||member.object!==binding.refs[0]||member.computed||property(member)!=='next'||nextCall?.type!=='CallExpression'||nextCall.callee!==member||nextCall.arguments.length||statement?.type!=='ExpressionStatement'||statement.expression!==nextCall)return {error:'生成器 driver 必须直接丢弃 next 结果'};
  driverEdit={start:statement.start,end:statement.end,replacement:''};
 }else return {error:'生成器 driver 形状未知'};

 const contextName=inner.params[0].name;
 const context='var '+contextName+' = {prev: 0, next: 0, sent: void 0, method: "next", arg: void 0, done: false, stop() { return {done: true}; }, abrupt(type, arg) { this.done = type === "return"; return {done: true, type: type, arg: arg}; }};';
 let replacement=context+'\n'+innerText;
 if(exceptions.length){
  // 把 tryEntries 的 catch 边改写为同步循环中的异常重定向；finally 已在证明阶段拒绝。
  const errorName=freshErrorName(ix);
  const route=exceptions.map((entry,index)=>(index?'else ':'')+'if('+contextName+'.prev>='+entry.tryLoc+'&&'+contextName+'.prev<'+entry.catchLoc+')'+contextName+'.next='+entry.catchLoc+';').join('')+'else throw '+errorName+';';
  replacement=context+'\nfor(;;){try{\n'+innerText+'\n}catch('+errorName+'){'+route+'}}';
 }
 return {edits:[{start:ret.start,end:ret.end,replacement},driverEdit]};
}

function freshErrorName(ix){
 const used=new Set(ix.nodes.filter(node=>node.type==='Identifier').map(node=>node.name));
 let name='regeneratorError',index=2;
 while(used.has(name))name='regeneratorError'+index++;
 return name;
}

function applyLocalEdits(source,edits){
 let output=source;
 for(const edit of edits.sort((a,b)=>b.start-a.start))output=output.slice(0,edit.start)+edit.replacement+output.slice(edit.end);
 return output;
}

// 封闭转发器只做一次原序转交：直接 `return first(second)`，或经闭合字面量
// 表逐层转发到同样的纯函数。参数不得重写、函数体不得有其它语句。
function completionForwarderContext(ix){
 const {nodes,parents,bindings,free}=ix;
 // 闭合字面量表只能通过静态成员读取；条件求值期间遇到自身引用时跳过重复
 // 校验，由外层完整遍历所有引用，避免死分支判断递归回环。
 const checkingTables=new Set();
 const closedValue=node=>{
  if(node?.type==='Literal')return {value:node.value};
  if(node?.type!=='MemberExpression'||node.object.type!=='Identifier'||property(node)===undefined)return null;
  const binding=bindings.get(node.object);
  if(!binding||binding.writes.length||binding.init?.type!=='ObjectExpression')return null;
  if(!checkingTables.has(binding)){
   checkingTables.add(binding);
   for(const ref of binding.refs){
    const use=parents.get(ref);
    if(use?.type==='MemberExpression'&&use.object===ref){
     const parent=parents.get(use);
     if(parent?.type==='AssignmentExpression'&&parent.left===use||parent?.type==='UpdateExpression'||parent?.type==='UnaryExpression'&&parent.operator==='delete'){checkingTables.delete(binding);return null;}
     continue;
    }
    if(deadReference(ref))continue;
    checkingTables.delete(binding);return null;
   }
   checkingTables.delete(binding);
  }
  const name=property(node),entries=binding.init.properties.filter(entry=>entry.type==='Property'&&entry.kind==='init'&&key(entry)===name);
  if(entries.length!==1||entries[0].value.type!=='Literal')return null;
  return {value:entries[0].value.value};
 };
 const testValue=node=>{
  if(!node)return null;
  if(node.type==='Literal')return typeof node.value==='boolean'?node.value:null;
  if(node.type==='UnaryExpression'&&node.operator==='!'){const value=testValue(node.argument);return value===null?null:!value;}
  if(node.type==='BinaryExpression'&&['===','==','!==','!='].includes(node.operator)){
   const left=closedValue(node.left),right=closedValue(node.right);
   if(!left||!right)return null;
   const equal=left.value===right.value;
   return ['===','=='].includes(node.operator)?equal:!equal;
  }
  return null;
 };
 const deadReference=ref=>{
  for(let child=ref,parent=parents.get(child);parent;child=parent,parent=parents.get(parent)){
   if(parent.type==='IfStatement'){
    if(child===parent.consequent&&testValue(parent.test)===false)return true;
    if(child===parent.alternate&&testValue(parent.test)===true)return true;
   }
   if(parent.type==='ConditionalExpression'){
    if(child===parent.consequent&&testValue(parent.test)===false)return true;
    if(child===parent.alternate&&testValue(parent.test)===true)return true;
   }
  }
  return false;
 };
 const functionAt=(callee,seen=new Set())=>{
  if(callee?.type==='Identifier'){
   const binding=bindings.get(callee);
   if(!binding||binding.writes.length||seen.has(binding))return null;
   const value=binding.fn??binding.init;
   return functions.has(value?.type)?value:null;
  }
  if(callee?.type==='MemberExpression'){
   const name=property(callee);
   if(name===undefined||callee.computed&&callee.property.type!=='Literal')return null;
   let object=callee.object;
   if(object.type==='Identifier'){
    const binding=bindings.get(object);
    if(!binding||binding.writes.length||seen.has(binding))return null;
    // 查表对象必须是完全闭合的字面量：只允许通过静态属性读取，不能再写入
    // 任何成员，也不能作为整体传给其它代码。
    for(const ref of binding.refs){
     if(deadReference(ref))continue;
     const use=parents.get(ref);
     if(use?.type!=='MemberExpression'||use.object!==ref||property(use)===undefined||use.computed&&use.property.type!=='Literal')return null;
     const parent=parents.get(use);
     if(parent?.type==='AssignmentExpression'&&parent.left===use||parent?.type==='UpdateExpression'||parent?.type==='UnaryExpression'&&parent.operator==='delete')return null;
    }
    object=binding.init;
   }
   if(object?.type!=='ObjectExpression')return null;
   const entries=object.properties.filter(entry=>entry.type==='Property'&&entry.kind==='init'&&key(entry)===name);
   if(entries.length!==1||entries[0].computed&&entries[0].key.type!=='Literal'||!functions.has(entries[0].value.type))return null;
   return entries[0].value;
  }
  return null;
 };
 const sameParameter=(node,parameter,binding)=>node?.type==='Identifier'&&bindings.get(node)===bindings.get(parameter)&&!!binding;
 const forwarder=(fn,seen=new Set())=>{
  if(!functions.has(fn?.type)||fn.async||fn.generator||seen.has(fn))return false;
  seen=new Set(seen);seen.add(fn);
  if(fn.params.length!==2||fn.params.some(parameter=>parameter.type!=='Identifier'))return false;
  const [first,second]=fn.params,firstBinding=bindings.get(first),secondBinding=bindings.get(second);
  if(!firstBinding||!secondBinding||firstBinding.writes.length||secondBinding.writes.length)return false;
  const statements=fn.body.type==='BlockStatement'?fn.body.body:[fn.body];
  if(statements.length!==1||statements[0].type!=='ReturnStatement'||!statements[0].argument)return false;
  const call=statements[0].argument;
  if(call.type!=='CallExpression'||call.optional||call.arguments.some(argument=>argument.type==='SpreadElement'))return false;
  if(call.arguments.length===1&&sameParameter(call.callee,first,firstBinding)&&sameParameter(call.arguments[0],second,secondBinding))return true;
  if(call.arguments.length!==2)return false;
  const target=functionAt(call.callee,seen);
  if(!target||!forwarder(target,seen))return false;
  return sameParameter(call.arguments[0],first,firstBinding)&&sameParameter(call.arguments[1],second,secondBinding);
 };
 return call=>{
  if(call?.type!=='CallExpression'||call.optional||call.arguments.length!==2||call.arguments.some(argument=>argument.type==='SpreadElement'))return false;
  if(!free(call.arguments[0],'$done'))return false;
  const fn=functionAt(call.callee);
  return !!fn&&forwarder(fn);
 };
}

// 只有需要异步降级的机器区域才把转发器还原成直接完成调用；其它区域的
// 转发器保持原样，避免把原本不可证的嵌入式完成路径带进原生终止分析。
export function closedCompletionForwarderCall(ix,call){
 try{return completionForwarderContext(ix)(call);}catch{return false;}
}

export function lowerCompletionForwarders(source,ranges=null){
 if(!source.includes('$done'))return {source,transformations:[],edits:[]};
 let tree,ix;
 try{tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true});ix=index(tree);}
 catch{return {source,transformations:[],edits:[]};}
 const {nodes,parents}=ix,isForwarder=completionForwarderContext(ix),edits=[];
 for(const call of nodes){
  const inside=ranges?.some(([start,end])=>call.start>=start&&call.end<=end);
  const parent=parents.get(call);
  const standalone=parent?.type==='ExpressionStatement'&&parent.expression===call||
   parent?.type==='ReturnStatement'&&parent.argument===call||
   parent?.type==='ArrowFunctionExpression'&&parent.body===call;
  if(ranges&&!inside&&!standalone)continue;
  if(!isForwarder(call))continue;
  edits.push({start:call.start,end:call.end,replacement:'$done('+source.slice(call.arguments[1].start,call.arguments[1].end)+')',line:source.slice(0,call.start).split('\n').length});
 }
 if(!edits.length)return {source,transformations:[],edits:[]};
 let output=source;
 for(const edit of edits.sort((a,b)=>b.start-a.start))output=output.slice(0,edit.start)+edit.replacement+output.slice(edit.end);
 return {source:output,edits,transformations:edits.map(({line})=>({kind:'completion-forwarder',line,reason:'封闭转发函数只把完成函数与载荷按原顺序转交，改写为直接完成调用'}))};
}

// 将已通过状态图证明、且只含顺序 await 恢复的 regenerator 异步机器降为普通
// async 函数。放行条件同时要求：单 catch 边、无 finally、无 yield/try、所有
// 挂起返回都静态指定下一个状态、等待值是本地可证明的 Promise 调用、上下文
// 只使用 prev/next/sent/stop/abrupt/catch/t0、驱动只在该机器的封闭 IIFE 内。
export function lowerAsyncRegenerator(source){
 if(!source.includes('wrap')||!source.includes('$done'))return {source,transformations:[],released:[]};
 let tree,ix,proof;
 try{tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true});ix=index(tree);proof=regeneratorStateMachine(ix,source);}
 catch{return {source,transformations:[],released:[]};}
 if(!proof.machines.some(machine=>!machine.minimal&&machine.proved))return {source,transformations:[],released:[]};
 const {nodes,parents,bindings,owners,free}=ix;
 const edits=[],released=[];
 const wraps=nodes.filter(n=>n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&property(n.callee)==='wrap'&&n.arguments.length>=2&&functions.has(n.arguments[0]?.type));
 const resolveFunction=callee=>{
  if(callee?.type!=='Identifier')return null;
  const binding=bindings.get(callee);
  if(!binding||binding.writes.length)return null;
  const value=binding.fn??binding.init;
  return functions.has(value?.type)?value:null;
 };
 const promiseLike=(n,seen=new Set())=>{
  if(!n||seen.has(n))return false;seen=new Set(seen);seen.add(n);
  if(n.type==='NewExpression'&&free(n.callee,'Promise'))return true;
  if(n.type==='CallExpression'){
   if(n.callee.type==='MemberExpression'&&free(n.callee.object,'$task')&&property(n.callee)==='fetch')return true;
   if(n.callee.type==='MemberExpression'&&free(n.callee.object,'Promise')&&['resolve','reject','all','allSettled','race','any'].includes(property(n.callee)))return true;
   const fn=resolveFunction(n.callee);
   if(fn?.async)return true;
   if(fn?.body.type==='BlockStatement'&&fn.body.body.at(-1)?.type==='ReturnStatement'){
    const returns=nodes.filter(r=>r.type==='ReturnStatement'&&owners.get(r)===fn);
    return returns.length>0&&returns.every(r=>promiseLike(r.argument,seen));
   }
  }
  return false;
 };
 // 日志只作为保序观察保留；console 本身必须没有重绑定、整体逃逸或动态读取，
 // 否则参数求值仍可能进入未知代码，不能把该调用当作纯观察。
 const consoleMethods=new Set(['log','warn','error','info','debug']);
 const badConsole=nodes.filter(n=>free(n,'console')).find(ref=>{
  const member=parents.get(ref),call=parents.get(member);
  return !(member?.type==='MemberExpression'&&member.object===ref&&consoleMethods.has(property(member))&&call?.type==='CallExpression'&&call.callee===member);
 });
 const closedConsole=!badConsole;
 const logObservation=n=>n?.type==='CallExpression'&&(free(n.callee,'$log')||closedConsole&&n.callee.type==='MemberExpression'&&free(n.callee.object,'console')&&consoleMethods.has(property(n.callee)));
 for(let index=0;index<proof.machines.length;index++){
  const machine=proof.machines[index],call=wraps[index];
  if(!call||machine.minimal||!machine.proved)continue;
  const reject=reason=>released.push({line:machine.line,released:false,reason});
  const ret=parents.get(call);
  if(ret?.type!=='ReturnStatement'||ret.argument!==call){reject('异步状态机必须由外层函数直接返回');continue;}
  const block=parents.get(ret),outer=parents.get(block);
  if(block?.type!=='BlockStatement'||block.body.at(-1)!==ret||block.body.slice(0,-1).some(statement=>statement.type!=='VariableDeclaration')||!functions.has(outer?.type)||outer.body!==block){reject('异步状态机外层函数形状未知');continue;}
  if(outer.async||outer.generator||outer.params.length||outer.id?.type!=='Identifier'){reject('异步状态机外层函数必须是同步无参具名函数');continue;}
  const inner=call.arguments[0];
  if(inner.type!=='FunctionExpression'||inner.async||inner.generator||inner.id||inner.params.length!==1||inner.params[0].type!=='Identifier'||inner.body.type!=='BlockStatement'){reject('异步状态机正文形状未知');continue;}
  const exceptions=machine.exceptions??[];
  if(exceptions.length!==1||exceptions.some(entry=>typeof entry.tryLoc!=='number'||typeof entry.catchLoc!=='number'||entry.tryLoc>=entry.catchLoc)){reject('异步状态机要求恰好一条有序 catch 边');continue;}
  const exception=exceptions[0];
  const innerNodes=nodes.filter(n=>n.start>=inner.start&&n.end<=inner.end);
  if(innerNodes.some(n=>n.type==='TryStatement'||n.type==='YieldExpression'||n.type==='AwaitExpression'||n.type==='ThisExpression'||n.type==='Super'||n.type==='MetaProperty'||n.type==='WithStatement')){reject('异步状态机正文含未支持的执行语义');continue;}
  if(innerNodes.some(n=>n.type==='Identifier'&&n.name==='arguments'&&free(n,'arguments'))){reject('异步状态机正文读取 arguments');continue;}
  const context=inner.params[0],contextBinding=bindings.get(context);
  if(!contextBinding){reject('异步状态机上下文绑定未知');continue;}
  const mentionsContext=node=>!!node&&(node.type==='Identifier'&&bindings.get(node)===contextBinding||children(node).some(([,child])=>mentionsContext(child)));
  if(contextBinding.refs.some(ref=>ref.start<inner.start||ref.end>inner.end)){reject('异步状态机上下文逃逸出正文');continue;}
  const allowedMembers=new Set(['prev','next','sent','stop','abrupt','catch','t0']);
  let invalid=null;
  for(const n of innerNodes){
   if(n.type==='MemberExpression'&&n.object.type==='Identifier'&&bindings.get(n.object)===contextBinding&&!allowedMembers.has(String(property(n)))){invalid='异步状态机上下文成员未知：'+String(property(n));break;}
   if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&n.callee.object.type==='Identifier'&&bindings.get(n.callee.object)===contextBinding){
    const name=property(n.callee);
    if(!['stop','abrupt','catch'].includes(name)){invalid='异步状态机上下文调用未知：'+String(name);break;}
    if(name==='abrupt'&&n.arguments[0]?.type==='Literal'&&n.arguments[0].value!=='return'){invalid='异步状态机仅支持 abrupt return';break;}
    if(name==='catch'){
     const value=n.arguments[0];
     if(value?.type!=='Literal'||typeof value.value!=='number'||value.value!==exception.tryLoc){invalid='异步状态机 catch 保存点不可证明';break;}
    }
   }
  }
  if(invalid){reject(invalid);continue;}
  const dispatch=nodes.find(n=>owners.get(n)===inner&&n.type==='SwitchStatement'&&n.discriminant.type==='AssignmentExpression'&&n.discriminant.left.type==='MemberExpression'&&property(n.discriminant.left)==='prev'&&bindings.get(n.discriminant.left.object)===contextBinding&&n.discriminant.right.type==='MemberExpression'&&property(n.discriminant.right)==='next'&&bindings.get(n.discriminant.right.object)===contextBinding);
  if(!dispatch){reject('异步状态机缺少单一分派入口');continue;}
  let loop=dispatch;
  while(loop&&parents.get(loop)!==inner&&!(loop.type==='ForStatement'&&owners.get(loop)===inner))loop=parents.get(loop);
  if(loop?.type!=='ForStatement'||loop.body!==dispatch||owners.get(loop)!==inner){reject('异步状态机分派循环形状未知');continue;}
  const returnEdits=[];
  let returnError=null;
  for(const n of innerNodes){
   if(n.type!=='ReturnStatement'||owners.get(n)!==inner||!n.argument)continue;
   const argument=n.argument;
   const parts=argument.type==='SequenceExpression'?argument.expressions:[argument];
   const tail=parts.at(-1);
   // 终止返回只要求序列尾部是状态机的 stop/abrupt/catch；前缀保持原文执行，
   // 因此日志或完成副作用仍按原顺序发生，不能丢弃也不能重排。
   if(tail?.type==='CallExpression'&&tail.callee.type==='MemberExpression'&&bindings.get(tail.callee.object)===contextBinding&&['stop','abrupt','catch'].includes(property(tail.callee)))continue;
   const awaited=parts.at(-1);
   let target=null;
   const prefix=[];
   for(const part of parts.slice(0,-1)){
    if(part.type==='AssignmentExpression'&&part.operator==='='&&part.left.type==='MemberExpression'&&bindings.get(part.left.object)===contextBinding&&property(part.left)==='next'&&part.right.type==='Literal'&&typeof part.right.value==='number'){
     target=part.right.value;continue;
    }
    if(part.type==='AssignmentExpression'&&part.operator==='='&&part.left.type==='MemberExpression'&&bindings.get(part.left.object)===contextBinding&&property(part.left)==='prev'&&part.right.type==='Literal'&&typeof part.right.value==='number'){
     prefix.push(source.slice(part.start,part.end)+';');continue;
    }
    // 状态上下文之外的普通赋值和日志观察按原顺序保留；任何读取或写入状态
    // 槽的前缀都拒绝，避免降低后的 next/sent 控制流被原文改写。
    if(part.type==='AssignmentExpression'&&part.operator==='='&&!mentionsContext(part)){prefix.push(source.slice(part.start,part.end)+';');continue;}
    if(logObservation(part)){prefix.push(source.slice(part.start,part.end)+';');continue;}
    returnError='异步挂起返回含未知前置表达式：第 '+(source.slice(0,part.start).split('\n').length)+' 行';break;
   }
   if(returnError)break;
   if(target===null||!machine.nodes.some(node=>node.id==='state:'+target)){returnError='异步挂起返回没有可证明的下一个状态';break;}
   if(!promiseLike(awaited)){returnError='异步挂起返回不是本地可证明的 Promise 调用';break;}
   returnEdits.push({start:n.start,end:n.end,replacement:[...prefix,context.name+'.next = '+target+';',context.name+'.sent = await ('+source.slice(awaited.start,awaited.end)+');','continue;'].join('\n')});
  }
  if(returnError){reject(returnError);continue;}
  const mark=parents.get(outer);
  const assigned=mark?.type==='CallExpression'&&mark.callee.type==='MemberExpression'&&property(mark.callee)==='mark'?parents.get(mark):null;
  if(assigned?.type!=='AssignmentExpression'||assigned.operator!=='='||assigned.right!==mark||assigned.left.type!=='Identifier'){reject('异步状态机 mark 赋值形状未知');continue;}
  const sequence=parents.get(assigned),driverCall=parents.get(sequence),driver=sequence?.type==='SequenceExpression'&&sequence.expressions.length===2&&sequence.expressions[0]===assigned?sequence.expressions[1]:null;
  if(driverCall?.type!=='CallExpression'||driverCall.callee!==sequence||driverCall.arguments.length||!functions.has(driver?.type)||driver.params.length){reject('异步状态机驱动 IIFE 形状未知');continue;}
  const generatorRefs=ix.nodes.filter(n=>n.type==='Identifier'&&bindings.get(n)===bindings.get(assigned.left)&&n.start>=driver.start&&n.end<=driver.end);
  if(!generatorRefs.some(ref=>parents.get(ref)?.type==='MemberExpression'&&property(parents.get(ref))==='apply')){reject('异步状态机驱动没有消费生成器对象');continue;}
  // 生成器绑定只允许在驱动内被消费；机器外的旧重置必须是空值字面量且在
  // 本次赋值之前，其它读取或写入都视为逃逸。
  const generatorBinding=bindings.get(assigned.left);
  const inertReset=node=>node?.type==='Literal'&&node.value===null||free(node,'undefined')||node?.type==='UnaryExpression'&&node.operator==='void'&&node.argument.type==='Literal';
  let generatorEscape=null;
  for(const ref of generatorBinding?.refs??[]){
   if(ref===assigned.left||ref.start>=driver.start&&ref.end<=driver.end)continue;
   // 赋值之前的读取只能看到旧值，赋值之后的驱动外读取才可能观察降低后的生成器。
   if(ref.start<assigned.start)continue;
   generatorEscape='异步状态机生成器对象在驱动外逃逸';break;
  }
  for(const write of generatorBinding?.writes??[]){
   if(write===assigned||write.start<assigned.start)continue;
   generatorEscape='异步状态机生成器对象在驱动外被重新赋值';break;
  }
  if(generatorEscape){reject(generatorEscape);continue;}
  // t0 是 catch 保存点的专用槽：只允许由匹配 tryLoc 的 ctx.catch 调用赋值，
  // 不允许读出、动态访问或其它来源写入。
  let t0Assignments=0,t0Error=null,t0Assignment=null;
  const catchCall=node=>node?.type==='CallExpression'&&node.callee.type==='MemberExpression'&&bindings.get(node.callee.object)===contextBinding&&property(node.callee)==='catch'&&node.arguments.length===1&&node.arguments[0].type==='Literal'&&node.arguments[0].value===exception.tryLoc;
  for(const n of innerNodes){
   if(n.type!=='MemberExpression'||bindings.get(n.object)!==contextBinding||property(n)!=='t0')continue;
   const parent=parents.get(n);
   if(parent?.type==='AssignmentExpression'&&parent.left===n&&parent.operator==='='&&catchCall(parent.right)){t0Assignments++;if(t0Assignments>1){t0Error='异步状态机 t0 有多个保存点写入';break;}t0Assignment=parent;continue;}
   // 保存值只能在同一处理区域内、赋值之后读取；跨 case 或赋值前读取仍拒绝。
   if(!t0Assignment||n.start<=t0Assignment.end){t0Error='异步状态机 t0 只允许由 catch 保存点赋值';break;}
   let clause=n;while(clause&&clause.type!=='SwitchCase')clause=parents.get(clause);
   let savedClause=t0Assignment;while(savedClause&&savedClause.type!=='SwitchCase')savedClause=parents.get(savedClause);
   if(!clause||clause!==savedClause){t0Error='异步状态机 t0 读取必须位于同一保存处理区域';break;}
  }
  if(t0Error){reject(t0Error);continue;}
  // catch 区域只允许状态控制与完成；业务调用、对象写入、抛出和挂起都拒绝。
  // handler 区域最多完成一次，避免异常路径产生多个脚本结果。
  const handlerClauses=[];
  for(const state of machine.handlerStates??[]){
   const clause=innerNodes.find(n=>n.type==='SwitchCase'&&n.test?.type==='Literal'&&n.test.value===state);
   // "end" 是 regenerator 约定的终止状态，不一定有独立 case；终止分支本身
   // 只返回 stop，交给正常控制流检查。
   if(!clause){if(state==='end')continue;t0Error='异步状态机异常处理状态缺少可证明的 case';break;}
   handlerClauses.push(clause);
  }
  if(t0Error){reject(t0Error);continue;}
  let handlerCompletions=0,handlerError=null;
  const insideObservation=(n,clause)=>{for(let p=parents.get(n);p;p=parents.get(p)){if(p.type==='SwitchCase'||p.start<clause.start)break;if(p.type==='CallExpression'&&logObservation(p))return true;}return false;};
  for(const clause of handlerClauses){
   for(const n of innerNodes){
    if(n.start<clause.start||n.end>clause.end)continue;
    if(n.type==='CallExpression'){
     if(insideObservation(n,clause))continue;
     if(free(n.callee,'$done')||closedCompletionForwarderCall(ix,n)){handlerCompletions++;continue;}
     if(logObservation(n))continue;
     if(n.callee.type==='MemberExpression'&&bindings.get(n.callee.object)===contextBinding&&['abrupt','stop'].includes(property(n.callee)))continue;
     if(catchCall(n))continue;
     handlerError='异步状态机异常处理区域含业务调用：第 '+source.slice(0,n.start).split('\n').length+' 行';break;
    }
    if(n.type==='AssignmentExpression'){
     if(n.left.type==='MemberExpression'&&bindings.get(n.left.object)===contextBinding&&(['prev','next','sent'].includes(property(n.left))||property(n.left)==='t0'&&catchCall(n.right)))continue;
     handlerError='异步状态机异常处理区域含对象写入：第 '+source.slice(0,n.start).split('\n').length+' 行';break;
    }
    if(n.type==='UpdateExpression'||n.type==='AwaitExpression'||n.type==='YieldExpression'||n.type==='NewExpression'||n.type==='TaggedTemplateExpression'||n.type==='ThrowStatement'||n.type==='UnaryExpression'&&n.operator==='delete'){
     handlerError='异步状态机异常处理区域含未支持副作用：第 '+source.slice(0,n.start).split('\n').length+' 行';break;
    }
   }
   if(handlerError)break;
  }
  if(handlerError){reject(handlerError);continue;}
  if(handlerCompletions>1){reject('异步状态机异常处理区域包含多个完成调用');continue;}
  const contextName=inner.params[0].name;
  const errorName=freshErrorName(ix);
  const switchText=applyLocalEdits(source.slice(dispatch.start,dispatch.end),returnEdits.map(edit=>({...edit,start:edit.start-dispatch.start,end:edit.end-dispatch.start})));
  const loopText='for(;;){try{'+switchText+'}catch('+errorName+'){if('+contextName+'.prev >= '+exception.tryLoc+' && '+contextName+'.prev < '+exception.catchLoc+'){'+contextName+'.t0 = '+errorName+';'+contextName+'.next = '+exception.catchLoc+';continue;}throw '+errorName+';}}';
  const contextText='var '+contextName+' = {prev: 0, next: 0, sent: void 0, t0: void 0, stop() { return {done: true}; }, abrupt(type, arg) { return {done: true, type: type, arg: arg}; }, catch() { return this.t0; }};';
  const innerStart=inner.body.start+1,innerEnd=inner.body.end-1;
  const bodyEdits=[{start:loop.start-innerStart,end:loop.end-innerStart,replacement:loopText}];
  const bodyText=applyLocalEdits(source.slice(innerStart,innerEnd),bodyEdits);
  edits.push({start:ret.start,end:ret.end,replacement:contextText+'\n'+bodyText});
  edits.push({start:driver.start,end:driver.end,replacement:'async function(){await '+assigned.left.name+'();}'});
  edits.push({start:outer.start,end:outer.start,replacement:'async '});
  released.push({line:machine.line,released:true,start:outer.start,end:outer.end});
 }
 if(!edits.length)return {source,transformations:[],released};
 const unique=[];
 for(const edit of edits.sort((a,b)=>a.start-b.start)){
  if(unique.length&&edit.start<unique.at(-1).end)return {source,transformations:[],released:[...released,{released:false,reason:'异步状态机改写区间重叠'}]};
  unique.push(edit);
 }
 let output=source;
 for(const edit of unique.sort((a,b)=>b.start-a.start))output=output.slice(0,edit.start)+edit.replacement+output.slice(edit.end);
 return {source:output,transformations:released.filter(item=>item.released).map(item=>({kind:'async-regenerator',line:item.line})),released};
}
