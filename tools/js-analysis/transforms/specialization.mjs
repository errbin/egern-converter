import {pathSetterField} from '../http/requests.mjs';
import {finiteLiteralMember,ordinaryReceivers,regeneratorStateMachine} from '../analysis/values.mjs';
import {parse} from '../core/syntax.mjs';
import {index,patch,renderTree,functions,initializedAfter,property,key,isolatedSwitchCase} from '../core/ast.mjs';
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
