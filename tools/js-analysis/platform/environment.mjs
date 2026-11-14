import {parse} from '../core/syntax.mjs';
import {index,patch,renderTree,property,key,children,functions,initializedAfter,factoryArgument} from '../core/ast.mjs';
import {provablyDead} from '../analysis/values.mjs';
import {methodContract} from './clients.mjs';
import {platformFold} from './globals.mjs';
import {simplify} from '../transforms/simplify.mjs';
import {reviewedHTTPDelegate} from '../http/requests.mjs';

// Specialize closed, reviewed Env factories for completion or plain-key storage.
// Constructors and completion retain their original logging/time expressions.
// No Env object or unused storage/HTTP/Node implementation is emitted.

const loggingFactory='6223927216aa9cf3b5c62c458e0671173d029bfca0e1eb74db808e5e40e1986f';
const storageFactory='694d53adc2d0165bc78820fdf1ffbe2bb47da163ff61c665f20c0cf02481096b';
// Reviewed older Env: same constructor/plain-key storage; done logs elapsed
// time before the authored Surge/Loon/QX completion branch. No dynamic eval or
// Node method is reachable from this closed, combined entry contract.
const storageCompletionFactory='a09db6912dfa6bc7afb42c6d23330f816b666ee88d1e1687054d95c252fdef58';

// Retain the complete constructor/helper closure, but omit unreachable instance
// methods before contract matching. A new unused platform method cannot change
// the reviewed completion/storage semantics; constructor/used edits still do.
export function envMethodContract(fn,entries){
 const root=fn.body.body.find(n=>n.type==='ReturnStatement'&&n.argument?.type==='NewExpression'&&n.argument.callee.type==='ClassExpression')?.argument.callee;
 if(!root||root.superClass||root.body.body.some(m=>m.type!=='MethodDefinition'||m.static||m.computed||!['method','constructor'].includes(m.kind)))return null;
 const methods=new Map(root.body.body.map(m=>[key(m),m]));
 if(methods.size!==root.body.body.length||entries.some(name=>!methods.has(name)))return null;
 const reachable=new Set(['constructor',...entries]),queue=[...reachable];
 while(queue.length){
  const method=methods.get(queue.shift());if(!method)continue;
  for(const n of index(method.value).nodes)if(n.type==='MemberExpression'&&n.object.type==='ThisExpression'){
   const name=property(n);if(name===undefined)return null;
   if(methods.has(name)&&!reachable.has(name)){reachable.add(name);queue.push(name);}
  }
 }
 function reduce(n){
  if(n===root)return {...n,body:{...n.body,body:n.body.body.filter(m=>reachable.has(key(m)))}};
  const result={...n};for(const [k,c]of children(n)){
   if(Array.isArray(n[k])){if(result[k]===n[k])result[k]=[...n[k]];result[k][n[k].indexOf(c)]=reduce(c);}
   else result[k]=reduce(c);
  }return result;
 }
 return methodContract(reduce(fn));
}

export function lowerEnv(source,format){
 if(!['surge','loon','qx','stash','shadowrocket'].includes(format))return source;
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree);
 const {nodes,parents,bindings}=ix,replace=new WeakMap(),removed=new WeakSet();
 const names=new Set(nodes.filter(n=>n.type==='Identifier').map(n=>n.name));
 const fresh=base=>{let value=base,i=2;while(names.has(value))value=base+i++;names.add(value);return value;};
 for(const fn of nodes.filter(n=>n.type==='FunctionDeclaration')){
  if(!fn.body.body.some(n=>n.type==='ReturnStatement'&&n.argument?.type==='NewExpression'&&n.argument.callee.type==='ClassExpression'))continue;
  const binding=bindings.get(fn.id);
  if(!binding?.refs.length||binding.writes.length)continue;
  const storageOnly=envMethodContract(fn,['getdata','setdata'])===storageFactory;
  const storageCompletion=envMethodContract(fn,['getdata','done'])===storageCompletionFactory;
  if(!storageOnly&&!storageCompletion&&envMethodContract(fn,['done'])!==loggingFactory)continue;
  if(nodes.filter(n=>n.type==='FunctionDeclaration'&&bindings.get(n.id)===binding).length!==1)continue;
  const local=index(fn);
  if(local.nodes.some(n=>local.free(n)&&!ix.free(n)))continue;
  const constructors=binding.refs.map(ref=>parents.get(ref));
  if(constructors.some(n=>n?.type!=='NewExpression'||n.callee.type!=='Identifier'||bindings.get(n.callee)!==binding||n.arguments.length!==1||n.arguments[0].type!=='Literal'||typeof n.arguments[0].value!=='string'))continue;
  const plans=[];
  for(const call of constructors){
   const d=parents.get(call),declaration=parents.get(d),block=parents.get(declaration);
   if(d?.type!=='VariableDeclarator'||d.init!==call||d.id.type!=='Identifier'||declaration?.type!=='VariableDeclaration'||declaration.declarations.length!==1||!['Program','BlockStatement'].includes(block?.type)){plans.length=0;break;}
   const instance=bindings.get(d.id);
   if(!instance?.refs.length||instance.writes.length){plans.length=0;break;}
   const calls=[];
   for(const ref of instance.refs){
    const member=parents.get(ref),use=parents.get(member);
    const method=property(member);
    const allowed=storageOnly&&['getdata','setdata'].includes(method)||storageCompletion&&method==='done'||!storageOnly&&!storageCompletion&&method==='done';
    if(member?.type!=='MemberExpression'||member.object!==ref||!allowed||use?.type!=='CallExpression'||use.callee!==member||use.arguments.some(a=>a.type==='SpreadElement')){calls.length=0;break;}
    const storage=method!=='done';
    if(storage){
     const key=use.arguments[method==='getdata'?0:1];
     if(use.arguments.length!==(method==='getdata'?1:2)||key?.type!=='Literal'||typeof key.value!=='string'||key.value.startsWith('@')){calls.length=0;break;}
    }else if(use.arguments.length>1||parents.get(use)?.type!=='ExpressionStatement'){calls.length=0;break;}
    let statement=use;while(parents.get(statement)&&parents.get(statement)!==block)statement=parents.get(statement);
    const nested=ix.owners.get(ref)!==ix.owners.get(declaration);
    if(parents.get(statement)!==block||statement.start<declaration.end||nested&&(!storage||block.type!=='Program'||block.body[0]!==declaration)){calls.length=0;break;}
    calls.push(use);
   }
   if(!calls.length){plans.length=0;break;}
   plans.push({declaration,calls,name:JSON.stringify(call.arguments[0].value),started:fresh('envStarted'),storageOnly});
  }
  if(!plans.length)continue;
  removed.add(fn);
  for(const {declaration,calls,name,started,storageOnly} of plans){
   replace.set(declaration,`const ${started} = new Date().getTime();console.log('\\n🔔' + ${name} + ', 开始!');`);
   for(const call of calls){
    if(property(call.callee)!=='done'){replace.set(call,()=>property(call.callee)==='getdata'?`$persistentStore.read(${render(call.arguments[0])})`:`$persistentStore.write(${call.arguments.map(render).join(', ')})`);continue;}
    const value=fresh('completionValue');
    replace.set(parents.get(call),()=>`{const ${value} = ${call.arguments[0]?render(call.arguments[0]):'{}'};console.log('\\n🔔' + ${name} + ', 结束! 🕛 ' + ((new Date().getTime() - ${started}) / 1000) + ' 秒');console.log('');$done(${value});}`);
   }
  }
 }
 function render(root){return renderTree(source,root,n=>{if(removed.has(n))return {direct:true,value:''};const value=replace.get(n);return value===undefined?null:{direct:true,value:typeof value==='function'?value():value};});}
 return render(tree);
}

// Erase stateless, closed Env object factories. Reachability is derived from
// local calls, never author/file names. Unused platform/Node methods disappear;
// used bodies proceed through the ordinary direct-native compiler.

export function lowerClosedEnv(source){
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree);
 const {nodes,parents,bindings,owners}=ix,replacements=new WeakMap(),removed=new WeakSet();
 const names=new Set(nodes.filter(n=>n.type==='Identifier').map(n=>n.name));
 const fresh=base=>{let s=base,i=2;while(names.has(s))s=base+i++;names.add(s);return s;};
 for(const factory of nodes.filter(n=>n.type==='FunctionDeclaration'&&!n.async&&!n.generator&&!n.params.length)){
  if(factory.body.body.length!==1||factory.body.body[0].type!=='ReturnStatement')continue;
  const object=factory.body.body[0].argument;
  if(object?.type!=='ObjectExpression'||!object.properties.length)continue;
  const methods=new Map();let valid=true;
  for(const p of object.properties){
   if(p.type!=='Property'){valid=false;break;}
   const fn=p.value,name=key(p);
   if(p.type!=='Property'||p.computed||p.kind!=='init'||typeof name!=='string'||name==='__proto__'||methods.has(name)||!functions.has(fn?.type)||fn.id||fn.generator){valid=false;break;}
   methods.set(name,{fn,dependencies:new Set(),calls:[]});
  }
  if(!valid)continue;
  const binding=bindings.get(factory.id);
  if(!binding?.refs.length||binding.writes.length||binding.init!==factory||nodes.some(n=>n.type==='VariableDeclarator'&&bindings.get(n.id)===binding)||nodes.filter(n=>n.type==='FunctionDeclaration'&&bindings.get(n.id)===binding).length!==1)continue;
  const instances=[],used=new Set(),outside=[];
  for(const ref of binding.refs){
   const call=parents.get(ref),d=parents.get(call),decl=parents.get(d),block=parents.get(decl);
   if(!['CallExpression','NewExpression'].includes(call?.type)||call.callee!==ref||call.arguments.length||d?.type!=='VariableDeclarator'||d.id.type!=='Identifier'||d.init!==call||decl?.type!=='VariableDeclaration'||!['Program','BlockStatement'].includes(block?.type)){valid=false;break;}
   const b=bindings.get(d.id);if(!b?.refs.length||b.writes.length||nodes.filter(n=>n.type==='VariableDeclarator'&&bindings.get(n.id)===b).length!==1){valid=false;break;}
   for(const r of b.refs){
    const m=parents.get(r),use=parents.get(m),name=property(m);
    if(m?.type!=='MemberExpression'||m.object!==r||m.optional||use?.type!=='CallExpression'||use.callee!==m||use.optional||!methods.has(name)){valid=false;break;}
    let statement=r;while(parents.get(statement)&&parents.get(statement)!==block)statement=parents.get(statement);
    const first=block.type==='Program'&&block.body.filter(n=>!['FunctionDeclaration','EmptyStatement'].includes(n.type))[0]===decl&&decl.declarations[0]===d;
    if(parents.get(statement)!==block||statement.start<decl.end||owners.get(r)!==owners.get(decl)&&!first){valid=false;break;}
    used.add(name);outside.push([m,name]);
   }
   if(!valid)break;instances.push(d);
  }
  if(!valid)continue;
  // No dynamic receiver, mutation, alias, this capture or object escape. A
  // direct this.other(...) edge is the only supported internal dependency.
  const queue=[...used];
  while(queue.length&&valid){
   const name=queue.shift(),info=methods.get(name),local=index(info.fn);
   for(const n of local.nodes){
    if(local.free(n,'arguments')||n.type==='Super'||n.type==='MetaProperty'){valid=false;break;}
    if(n.type!=='ThisExpression')continue;
    let owner=local.parents.get(n);while(owner&&!functions.has(owner.type))owner=local.parents.get(owner);
    const member=local.parents.get(n),call=local.parents.get(member),dependency=property(member);
    if(info.fn.type==='ArrowFunctionExpression'||owner!==info.fn||member?.type!=='MemberExpression'||member.object!==n||member.optional||call?.type!=='CallExpression'||call.callee!==member||call.optional||!methods.has(dependency)){valid=false;break;}
    info.calls.push([member,dependency]);
    if(!used.has(dependency)){used.add(dependency);queue.push(dependency);}
   }
  }
  if(!valid)continue;
  const identifiers=new Map([...used].map(n=>[n,fresh('env_'+n.replace(/\W/g,'_'))]));
  for(const name of used)for(const [member,dependency]of methods.get(name).calls)replacements.set(member,()=>identifiers.get(dependency));
  for(const [member,name]of outside)replacements.set(member,()=>identifiers.get(name));
  for(const d of instances)removed.add(d);
  replacements.set(factory,()=>[...used].map(name=>{
   const fn=methods.get(name).fn,params=fn.params.map(render).join(', '),body=fn.body.type==='BlockStatement'?render(fn.body):'{return '+render(fn.body)+';}';
   return `${fn.async?'async ':''}function ${identifiers.get(name)}(${params}) ${body}`;
  }).join('\n'));
 }
 function render(root){return renderTree(source,root,n=>{
  if(removed.has(n))return {direct:true,value:''};
  const r=replacements.get(n);if(r)return {direct:true,value:r()};
  if(n.type==='VariableDeclaration'){
   const keep=n.declarations.filter(d=>!removed.has(d));
   if(keep.length!==n.declarations.length)return keep.length?{children:keep,render:child=>n.kind+' '+keep.map(child).join(', ')+';'}:{direct:true,value:''};
  }
  return null;
 });}
 return render(tree);
}

// Erase stateless, closed environment/clients whose factory returns an object.
// Reachability is derived from local member calls, never author or file names.

export function lowerExtendedClosedEnv(source){
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree);
 const {nodes,parents,bindings,owners}=ix,replacements=new WeakMap(),removed=new WeakSet();
 const names=new Set(nodes.filter(n=>n.type==='Identifier').map(n=>n.name));
 const fresh=base=>{let s=base,i=2;while(names.has(s))s=base+i++;names.add(s);return s;};
 for(const factory of nodes.filter(n=>n.type==='FunctionDeclaration'&&!n.async&&!n.generator&&!n.params.length)){
  const statements=factory.body?.body||[],last=statements.at(-1);
  if(last?.type!=='ReturnStatement'||last.argument?.type!=='ObjectExpression'||!last.argument.properties.length||statements.length===1)continue;
  const localDeclarations=new Map();let valid=true;
  for(const statement of statements.slice(0,-1)){
   if(statement.type==='EmptyStatement')continue;
   if(statement.type==='VariableDeclaration'){
    for(const d of statement.declarations){if(d.id.type!=='Identifier'||!d.init){valid=false;break;}const b=bindings.get(d.id);if(!b||b.writes.length||localDeclarations.has(b)){valid=false;break;}localDeclarations.set(b,d);}
   }else if(statement.type==='FunctionDeclaration'&&statement.id){const b=bindings.get(statement.id);if(!b||b.writes.length||localDeclarations.has(b)){valid=false;break;}localDeclarations.set(b,statement);}
   else{valid=false;break;}
   if(!valid)break;
  }
  if(!valid)continue;
  const local=index(factory);
  const resolveFunction=value=>{
   if(functions.has(value?.type)&&!value.id&&!value.generator)return {fn:value,binding:null};
   if(value?.type==='Identifier'){
    const b=bindings.get(value),d=localDeclarations.get(b);
    if(d?.type==='VariableDeclarator'&&functions.has(d.init?.type)&&!d.init.id&&!d.init.generator)return {fn:d.init,binding:b};
    if(d?.type==='FunctionDeclaration'&&!d.async&&!d.generator)return {fn:d,binding:b};
   }
   return null;
  };
  const entries=new Map();
  for(const p of last.argument.properties){
   if(p.type!=='Property'||p.computed||p.kind!=='init'){valid=false;break;}
   const name=key(p);if(typeof name!=='string'||name==='__proto__'||entries.has(name)){valid=false;break;}
   const resolved=resolveFunction(p.value);
   entries.set(name,resolved?{name,kind:'function',fn:resolved.fn,binding:resolved.binding,dependencies:new Set(),calls:[]}:{name,kind:'field',value:p.value,dependencies:new Set()});
  }
  if(!valid)continue;
  const binding=bindings.get(factory.id);
  if(!binding?.refs.length||binding.writes.length||binding.init!==factory||nodes.some(n=>n.type==='VariableDeclarator'&&bindings.get(n.id)===binding)||nodes.filter(n=>n.type==='FunctionDeclaration'&&bindings.get(n.id)===binding).length!==1)continue;
  const inert=value=>!value||value.type==='Literal'||value.type==='ArrayExpression'&&value.elements.every(inert);
  const safePrefix=declaration=>{
   const block=parents.get(declaration);
   return block.body.slice(0,block.body.indexOf(declaration)).every(s=>s.type==='EmptyStatement'||s.type==='FunctionDeclaration'||s.type==='VariableDeclaration'&&s.declarations.every(d=>d.id.type==='Identifier'&&inert(d.init)));
  };
  const instances=[],used=new Set(),outside=[];
  for(const ref of binding.refs){
   const call=parents.get(ref),d=parents.get(call),decl=parents.get(d),block=parents.get(decl);
   if(!['CallExpression','NewExpression'].includes(call?.type)||call.callee!==ref||call.arguments.length||d?.type!=='VariableDeclarator'||d.id.type!=='Identifier'||d.init!==call||decl?.type!=='VariableDeclaration'||decl.declarations.length!==1||!['Program','BlockStatement'].includes(block?.type)){valid=false;break;}
   const b=bindings.get(d.id);if(!b?.refs.length||b.writes.length||nodes.filter(n=>n.type==='VariableDeclarator'&&bindings.get(n.id)===b).length!==1){valid=false;break;}
   for(const r of b.refs){
    const m=parents.get(r),use=parents.get(m),name=property(m);
    if(m?.type!=='MemberExpression'||m.object!==r||m.optional||name===undefined){valid=false;break;}
    if(!entries.has(name))continue;
    const entry=entries.get(name);
    if(entry.kind==='function'&&(use?.type!=='CallExpression'||use.callee!==m||use.optional)){valid=false;break;}
    if(entry.kind==='field'&&(use?.type==='AssignmentExpression'&&use.left===m||use?.type==='UpdateExpression'||use?.type==='UnaryExpression'&&use.operator==='delete')){valid=false;break;}
    let statement=r;while(parents.get(statement)&&parents.get(statement)!==block)statement=parents.get(statement);
    const safeBefore=safePrefix(decl);
    if(parents.get(statement)!==block||statement.start<decl.end||owners.get(r)!==owners.get(decl)&&!safeBefore){valid=false;break;}
    if(entry.kind==='function')used.add(name);
    outside.push([m,entry]);
   }
   if(!valid)break;instances.push({d,declaration:decl,block});
  }
  if(!valid||instances.length!==1)continue;
  if([...entries.values()].some(entry=>entry.kind==='function'&&index(entry.fn).nodes.some(n=>n.type==='ThisExpression'||n.type==='Super'||n.type==='MetaProperty'||ix.free(n,'arguments'))))continue;
  // Map scope-local binding objects back to the outer index, then retain only
  // locals reachable from selected methods and fields.
  const localToOuter=new Map();
  for(const [outer,d]of localDeclarations){const id=d.type==='VariableDeclarator'?d.id:d.id,lb=local.bindings.get(id);if(lb)localToOuter.set(lb,outer);}
  const needed=new Set(),queue=[];
  // Initializers can have effects even when their value is never read.
  for(const [b,d]of localDeclarations)if(d.type==='VariableDeclarator'&&!functions.has(d.init?.type)){needed.add(b);queue.push(b);}
  const addDependencies=range=>{
   for(const n of local.nodes)if(n.start>=range.start&&n.end<=range.end){
    const b=local.bindings.get(n),outer=localToOuter.get(b);
    if(outer&&localDeclarations.has(outer)&&!needed.has(outer)){needed.add(outer);queue.push(outer);}
   }
  };
  for(const name of used){
   const entry=entries.get(name);if(entry.binding&&!needed.has(entry.binding)){needed.add(entry.binding);queue.push(entry.binding);}
   addDependencies(entry.fn);
  }
  for(const [_,entry]of outside)if(entry.kind==='field')addDependencies(entry.value);
  while(queue.length){
   const b=queue.shift(),d=localDeclarations.get(b),expr=d.type==='VariableDeclarator'?d.init:d;
   addDependencies(expr);
  }
  if(!valid)continue;
  const identifiers=new Map([...needed].map(b=>[b,fresh('env_'+String(b.name||'local').replace(/\W/g,'_'))]));
  const fieldIdentifiers=new Map(),inlineFunctions=new Map();
  function entryName(entry){
   if(entry.kind==='function'){
    const direct=[...localDeclarations.entries()].find(([b,d])=>d?.type==='VariableDeclarator'&&d.init===entry.fn||d===entry.fn);
    if(direct)return identifiers.get(direct[0]);
    if(!inlineFunctions.has(entry))inlineFunctions.set(entry,fresh('env_'+String(entry.name).replace(/\W/g,'_')));
    return inlineFunctions.get(entry);
   }
   const direct=[...localDeclarations.entries()].find(([b,d])=>d?.type==='VariableDeclarator'&&d.init===entry.value);
   if(direct)return identifiers.get(direct[0]);
   if(!fieldIdentifiers.has(entry))fieldIdentifiers.set(entry,fresh('env_'+String(entry.name).replace(/\W/g,'_')));
   return fieldIdentifiers.get(entry);
  }
  // Scope objects from a nested index are distinct; bridge by declaration node.
  const localNames=new Map();
  for(const [b,d]of localDeclarations){const id=d.type==='VariableDeclarator'?d.id:d.id,lb=local.bindings.get(id);if(lb&&identifiers.has(b))localNames.set(lb,identifiers.get(b));}
  for(const n of local.nodes){const b=local.bindings.get(n);if(b&&localNames.has(b))replacements.set(n,localNames.get(b));}
  for(const name of used)for(const [member,dependency]of entries.get(name).calls)replacements.set(member,()=>entryName(entries.get(dependency)));
  for(const [member,entry]of outside)replacements.set(member,()=>entryName(entry));
  for(const entry of entries.values())if(entry.kind==='field')entryName(entry);
  const definitions=[];
  for(const [b,d]of localDeclarations){
   if(!needed.has(b))continue;
   const name=identifiers.get(b);
   if(d.type==='FunctionDeclaration'){const fn=d,params=fn.params.map(render).join(', '),body=fn.body.type==='BlockStatement'?render(fn.body):'{return '+render(fn.body)+';}';definitions.push(`${fn.async?'async ':''}function ${name}(${params}) ${body}`);}
   else{
    const init=d.init;
    if(functions.has(init?.type)&&!init.id){const params=init.params.map(render).join(', '),body=init.body.type==='BlockStatement'?render(init.body):'{return '+render(init.body)+';}';definitions.push(`${init.async?'async ':''}function ${name}(${params}) ${body}`);}
    else definitions.push(`const ${name} = (${render(init)});`);
   }
  }
  for(const [entry,name]of inlineFunctions){const fn=entry.fn,params=fn.params.map(render).join(', '),body=fn.body.type==='BlockStatement'?render(fn.body):'{return '+render(fn.body)+';}';definitions.push(`${fn.async?'async ':''}function ${name}(${params}) ${body}`);}
  for(const [entry,name]of fieldIdentifiers)if(!([...localDeclarations.values()].some(d=>d?.init===entry.value)))definitions.push(`const ${name} = ${render(entry.value)};`);
  for(const {d,declaration}of instances)replacements.set(declaration,()=>definitions.join('\n')+'\nconst '+d.id.name+' = {};');
  removed.add(factory);
 }
 function render(root){return renderTree(source,root,n=>{
  if(removed.has(n))return {direct:true,value:''};
  const r=replacements.get(n);if(r)return {direct:true,value:typeof r==='function'?r():r};
  if(n.type==='VariableDeclaration'){
   const keep=n.declarations.filter(d=>!removed.has(d));if(keep.length!==n.declarations.length)return keep.length?{children:keep,render:child=>n.kind+' '+keep.map(child).join(', ')+';'}:{direct:true,value:''};
  }
  return null;
 });}
 return render(tree);
}

// Fold pure platform probes of closed local Env instances and prune methods
// unreachable from those instances. No name alone establishes an API contract.

function targetMethodValues(source,cls,methods,format){
 const known=new Map();
 for(let pass=0;pass<3;pass++)for(const [name,method] of methods){
  if(method.value.params.length||method.value.async||method.value.generator||method.value.body.type!=='BlockStatement')continue;
  const body=renderTree(source,method.value.body,n=>n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&n.callee.object.type==='ThisExpression'&&!n.arguments.length&&known.has(property(n.callee))?{direct:true,value:JSON.stringify(known.get(property(n.callee)))}:null);
  const text=platformFold(simplify('(function()'+body+')'),format).source;
  const result=parse(text,{ecmaVersion:'latest'}).body[0]?.expression.body.body;
  if(result?.length===1&&result[0].type==='ReturnStatement'&&result[0].argument?.type==='Literal'&&['string','boolean'].includes(typeof result[0].argument.value))known.set(name,result[0].argument.value);
 }
 return known;
}

function falseNodeTest(node,known){
 const call=node?.type==='UnaryExpression'&&node.operator==='!'?node.argument:node;
 const negative=node!==call;
 return known.get('isNode')===false&&call?.type==='CallExpression'&&call.callee.type==='MemberExpression'&&call.callee.object.type==='ThisExpression'&&property(call.callee)==='isNode'&&!call.arguments.length&&!negative;
}
function trueNodeTest(node,known){
 return node?.type==='UnaryExpression'&&node.operator==='!'&&known.get('isNode')===false&&node.argument?.type==='CallExpression'&&node.argument.callee.type==='MemberExpression'&&node.argument.callee.object.type==='ThisExpression'&&property(node.argument.callee)==='isNode'&&!node.argument.arguments.length;
}
function unreachableNodeGuard(ix,ref,cls,known){
 if(known.get('isNode')!==false)return false;
 const {parents}=ix;let child=ref;
 for(let parent=parents.get(child);parent&&parent!==cls;child=parent,parent=parents.get(parent)){
  if(parent.type!=='IfStatement')continue;
  let arm=null;for(let node=child;node&&node!==parent;node=parents.get(node)){if(node===parent.consequent){arm='consequent';break;}if(node===parent.alternate){arm='alternate';break;}}
  if(arm==='consequent'&&falseNodeTest(parent.test,known)||arm==='alternate'&&trueNodeTest(parent.test,known))return true;
 }
 let method=parents.get(ref);while(method&&method.type!=='MethodDefinition'&&method!==cls)method=parents.get(method);
 if(method?.type!=='MethodDefinition'||parents.get(parents.get(method))!==cls)return false;
 const body=method.value.body;if(body?.type!=='BlockStatement')return false;
 let statement=ref;while(parents.get(statement)&&parents.get(statement)!==body)statement=parents.get(statement);
 const index=body.body.indexOf(statement);if(index<0)return false;
 return body.body.slice(0,index).some(node=>node.type==='IfStatement'&&trueNodeTest(node.test,known)&&node.consequent.type==='ReturnStatement'&&!node.alternate);
}

function plans(ix,source,format){
 const {nodes,parents,bindings}=ix,output=[];
 const covered=new Set();
 function classShape(cls){
  if(!cls||cls.superClass)return null;
  const methods=new Map(),members=new Set();
  for(const member of cls.body.body){
   const name=key(member);
   if(typeof name!=='string'||member.computed||members.has(name))return null;
   members.add(name);
   if(member.type==='MethodDefinition'&&!member.static&&['method','constructor'].includes(member.kind)){
    methods.set(name,member);
    continue;
   }
   // Ordinary instance fields are allowed only when their initializers are
   // inert data. Static/computed fields and effectful initializers can run
   // before the environment predicates and are outside this specialization.
   if(member.type!=='PropertyDefinition'||member.static||!inertField(member.value))return null;
  }
  return methods;
 }
 function inertField(node){
  if(!node)return true;
  if(['Literal','FunctionExpression','ArrowFunctionExpression'].includes(node.type))return true;
  if(node.type==='Identifier')return ['undefined','NaN','Infinity'].includes(node.name)&&ix.free(node,node.name);
  if(node.type==='ArrayExpression')return node.elements.every(e=>!e||e.type!=='SpreadElement'&&inertField(e));
  if(node.type==='ObjectExpression')return node.properties.every(p=>p.type==='Property'&&p.kind==='init'&&!p.computed&&p.key.type!=='PrivateIdentifier'&&inertField(p.value));
  if(node.type==='TemplateLiteral')return node.expressions.every(inertField);
  if(node.type==='UnaryExpression')return ['!','void','+','-','~','typeof'].includes(node.operator)&&inertField(node.argument);
  if(['BinaryExpression','LogicalExpression'].includes(node.type))return inertField(node.left)&&inertField(node.right);
  if(node.type==='ConditionalExpression')return inertField(node.test)&&inertField(node.consequent)&&inertField(node.alternate);
  return false;
 }
 function classReceiverThis(node,cls){
  let owner=parents.get(node);
  while(owner&&owner!==cls){
   if(owner.type==='ArrowFunctionExpression'){owner=parents.get(owner);continue;}
   if(functions.has(owner.type)){
    const method=parents.get(owner);
    return method?.type==='MethodDefinition'&&parents.get(parents.get(method))===cls;
   }
   owner=parents.get(owner);
  }
  return owner===cls;
 }
 function finiteStrings(node,seen=new Set()){
  if(node?.type==='Literal'&&typeof node.value==='string')return new Set([node.value]);
  if(node?.type==='TemplateLiteral'&&!node.expressions.length)return new Set([node.quasis[0].value.cooked]);
  if(node?.type==='Identifier'){
   const binding=bindings.get(node);if(!binding?.init||binding.writes.length||seen.has(binding))return null;
   const next=new Set(seen);next.add(binding);return finiteStrings(binding.init,next);
  }
  if(node?.type==='ConditionalExpression'){
   const left=finiteStrings(node.consequent,new Set(seen)),right=finiteStrings(node.alternate,new Set(seen));
   return left&&right?new Set([...left,...right]):null;
  }
  return null;
 }
 function constructorLiteralFields(factory,returned,cls,methods,constructions,instances,constructorReachable){
  const ctor=methods.get('constructor');if(!ctor)return new Map();
  const fn=ctor.value,classNodes=index(cls).nodes,writes=new Map(),invalid=new Set();
  const literal=node=>{
   if(node?.type==='Literal'&&(node.value===null||['boolean','number','string'].includes(typeof node.value)))return {known:true,value:node.value};
   if(node?.type==='UnaryExpression'){
    const inner=literal(node.argument);if(!inner.known)return null;
    if(node.operator==='!')return {known:true,value:!inner.value};
    if(node.operator==='+'&&typeof inner.value==='number'||node.operator==='-'&&typeof inner.value==='number')return {known:true,value:node.operator==='-'?-inner.value:+inner.value};
   }
   return null;
  };
  const ownerMethod=node=>{
   const owner=ix.owners.get(node);
   return methods.get('constructor')?.value===owner?ctor:null;
  };
  const unconditionalWrite=node=>{
   const statement=parents.get(node);
   if(statement?.type!=='ExpressionStatement'||parents.get(statement)!==fn.body)return false;
   return !classNodes.some(exit=>['ReturnStatement','ThrowStatement'].includes(exit.type)&&ix.owners.get(exit)===fn&&exit.start<node.start);
  };
  const writeUse=member=>{
   const use=parents.get(member);
   if(use?.type==='AssignmentExpression'&&use.left===member||use?.type==='UpdateExpression'&&use.argument===member||use?.type==='UnaryExpression'&&use.operator==='delete'&&use.argument===member)return true;
   if(use?.type==='MemberExpression'&&use.object===member){const nested=parents.get(use);return nested?.type==='AssignmentExpression'&&nested.left===use||nested?.type==='UpdateExpression'&&nested.argument===use||nested?.type==='UnaryExpression'&&nested.operator==='delete'&&nested.argument===use;}
   return false;
  };
  for(const node of classNodes)if(node.type==='AssignmentExpression'&&node.left.type==='MemberExpression'&&node.left.object.type==='ThisExpression'){
   const name=property(node.left),value=literal(node.right);
   if(typeof name!=='string')continue;
   if(ownerMethod(node)!==ctor||node.operator!=='='||!value||writes.has(name)||!unconditionalWrite(node))invalid.add(name);
   else writes.set(name,{value:value.value,member:node.left,assignment:node});
  }
  for(const call of classNodes)if(call.type==='CallExpression'&&call.callee.type==='MemberExpression'&&ix.free(call.callee.object,'Object')&&property(call.callee)==='assign'&&call.arguments[0]?.type==='ThisExpression'){
   if(ix.owners.get(call)!==fn){for(const name of writes.keys())invalid.add(name);continue;}
   const value=call.arguments[1],position=fn.params.findIndex(param=>ix.bindings.get(param?.type==='AssignmentPattern'?param.left:param)===ix.bindings.get(value));
   const actuals=position<0?[value]:constructions.map(construction=>factoryArgument(ix,factory,construction,returned,fn,position));
   if(!actuals.length){for(const name of writes.keys())invalid.add(name);continue;}
   for(const actual of actuals){
    if(!actual||actual.type==='Literal'&&actual.value===null||ix.free(actual,'undefined'))continue;
    if(actual.type==='ObjectExpression'&&actual.properties.every(p=>p.type==='Property'&&p.kind==='init'&&!p.method&&!p.computed&&key(p)!=='__proto__')){
     for(const name of writes.keys())if(actual.properties.some(p=>String(key(p))===name))invalid.add(name);
     continue;
    }
    for(const name of writes.keys())invalid.add(name);
   }
  }
  for(const [name,entry]of writes){
   if(invalid.has(name)||classNodes.some(node=>node.type==='MemberExpression'&&node.object.type==='ThisExpression'&&property(node)===name&&writeUse(node)&&node!==entry.member))continue;
   let externallyWritten=false;
   for(const instance of instances)for(const ref of instance.refs){
    const member=parents.get(ref);if(member?.type==='MemberExpression'&&member.object===ref&&property(member)===name&&writeUse(member))externallyWritten=true;
   }
   if(!externallyWritten)writes.set(name,entry.value);
  }
  for(const [name,value]of writes)if(typeof value!=='boolean'&&typeof value!=='number'&&typeof value!=='string'&&value!==null)writes.delete(name);
  return writes;
 }
 for(const factory of nodes.filter(n=>n.type==='FunctionDeclaration'&&!n.async&&!n.generator)){
  const returned=factory.body.body.find(n=>n.type==='ReturnStatement')?.argument;
  let cls=returned?.type==='NewExpression'&&returned.callee.type==='ClassExpression'?returned.callee:null;
  if(!cls&&returned?.type==='NewExpression'&&returned.callee.type==='Identifier'){
   const classBinding=bindings.get(returned.callee),candidate=classBinding?.init;
   // Some classic Env factories name the local class before returning its
   // instance. Admit that equivalent shape only when the class binding is
   // immutable and this return is its sole reference.
   if(candidate?.type==='ClassDeclaration'&&!classBinding.writes.length&&classBinding.refs.length===1&&classBinding.refs[0]===returned.callee)cls=candidate;
  }
  if(!cls)continue;
  const methods=classShape(cls),classNodes=index(cls).nodes;
  if(!methods||!methods.has('isNode'))continue;
  const known=targetMethodValues(source,cls,methods,format);
  // Some compatibility Env implementations expose only getEnv()/isNode(),
  // rather than one predicate per proxy app. Admit them only when the full
  // isNode method has been statically reduced to a boolean for this target.
  // This keeps the specialization tied to proven host facts, not method names.
  if(typeof known.get('isNode')!=='boolean')continue;
  // Captured outer bindings inside ordinary instance methods are evaluated
  // only after construction unless the constructor can reach that method.
  // Follow direct this.method calls from the constructor, skipping calls in
  // branches already proven impossible for the selected native runtime.
  const constructorReachable=new Set(['constructor']),constructorQueue=['constructor'];
  while(constructorQueue.length){
   const method=methods.get(constructorQueue.shift());if(!method)continue;
   for(const call of classNodes){
    if(call.type!=='CallExpression'||call.start<method.start||call.end>method.end||call.callee.type!=='MemberExpression'||call.callee.object.type!=='ThisExpression')continue;
    const name=property(call.callee);if(name===undefined){for(const candidate of methods.keys())if(!constructorReachable.has(candidate)){constructorReachable.add(candidate);constructorQueue.push(candidate);}continue;}
    if(methods.has(name)&&!constructorReachable.has(name)&&!unreachableNodeGuard(ix,call,cls,known)){constructorReachable.add(name);constructorQueue.push(name);}
   }
  }
  const binding=bindings.get(factory.id);if(!binding?.refs.length||binding.writes.length)continue;
  const used=new Set(),usedHelpers=new Set(),instances=new Set(),constructions=[],helpers=new Map();let valid=true;
  for(const n of classNodes)if(n.type==='AssignmentExpression'&&n.operator==='='&&n.left.type==='MemberExpression'&&n.left.object.type==='ThisExpression'&&n.right.type==='NewExpression'&&n.right.arguments.length===1&&n.right.arguments[0].type==='ThisExpression'){
   const b=bindings.get(n.right.callee),helper=b?.init,field=property(n.left);
   if(typeof field!=='string'||methods.has(field)||!b||b.writes.length||b.refs.length!==1||helper?.type!=='ClassDeclaration'||!reviewedHTTPDelegate(helper)||!safeReceiverRetention(helper))continue;
   const dependencies=index(helper).nodes.filter(r=>r.type==='Identifier'&&['Promise','Error','setTimeout'].includes(r.name));
   if(dependencies.some(r=>!ix.free(r,r.name)))continue;
   helpers.set(field,{allocation:n.right,methods:new Set(helper.body.body.map(key))});
  }
  for(const ref of binding.refs){
   const call=parents.get(ref),d=parents.get(call),decl=parents.get(d);
   if(!['NewExpression','CallExpression'].includes(call?.type)||call.callee!==ref||call.arguments.length>Math.max(1,factory.params.length)||call.arguments.some(a=>a.type==='SpreadElement')||d?.type!=='VariableDeclarator'||d.id.type!=='Identifier'||d.init!==call||decl?.type!=='VariableDeclaration'){valid=false;break;}
   const b=bindings.get(d.id);if(!b||b.writes.length){valid=false;break;}
   const shadowed=new Set();
   for(const name of methods.keys()){
    // A script may use a method name as an own data field (e.g. a delay
    // named time). The prototype method is unobservable only after a closed,
    // unconditional own-property assignment and with no internal lookup.
    if(classNodes.some(n=>n.type==='MemberExpression'&&n.object.type==='ThisExpression'&&property(n)===name))continue;
    const refs=b.refs.filter(r=>{const m=parents.get(r);return m?.type==='MemberExpression'&&m.object===r&&property(m)===name;});
    const first=refs.find(r=>{const m=parents.get(r),write=parents.get(m),statement=parents.get(write);return write?.type==='AssignmentExpression'&&write.operator==='='&&write.left===m&&statement?.type==='ExpressionStatement'&&parents.get(statement)===nodes[0];});
    if(!first)continue;
    const statement=parents.get(parents.get(parents.get(first)));
    if(refs.every(r=>{const m=parents.get(r),use=parents.get(m);return r===first||initializedAfter(ix,statement,r)&&!(use?.type==='CallExpression'&&use.callee===m||use?.operator==='delete');}))shadowed.add(name);
   }
   for(const r of b.refs){
    const m=parents.get(r),u=parents.get(m),name=property(m);
    const ownerMethod=classNodes.find(node=>node.type==='MethodDefinition'&&r.start>=node.start&&r.end<=node.end),ownerName=ownerMethod&&key(ownerMethod);
    const deferredInstanceMethod=ownerMethod?.kind==='method'&&!constructorReachable.has(ownerName);
    if(!initializedAfter(ix,decl,r)&&!unreachableNodeGuard(ix,r,cls,known)&&!deferredInstanceMethod||m?.type!=='MemberExpression'||m.object!==r){valid=false;break;}
    if(name===undefined){
     // A dynamic call cannot overwrite a probe, but may invoke any method.
     // Prune to a finite, immutable string set when the selector proves one;
     // otherwise retain every possible target.
     if(u?.type!=='CallExpression'||u.callee!==m){valid=false;break;}
     const selected=finiteStrings(m.property);
     if(selected&&[...selected].every(value=>methods.has(value)))for(const value of selected)used.add(value);
     else for(const value of methods.keys())used.add(value);
    }
    if(methods.has(name)){
     if(shadowed.has(name))continue;
     if(u?.type!=='CallExpression'||u.callee!==m){valid=false;break;}
     used.add(name);
    }else if(helpers.has(name)){
     const call=parents.get(u),helper=helpers.get(name);
     if(u?.type!=='MemberExpression'||u.object!==m||!helper.methods.has(property(u))||call?.type!=='CallExpression'||call.callee!==u){valid=false;break;}
     usedHelpers.add(name);
    }
   }
   if(!valid)break;constructions.push(call);instances.add(b);
  }
  if(!valid)continue;
  // Probe folding is invalid if a constructor/method overwrites a method or
  // exposes its receiver to an unreviewed callback.
  for(const n of classNodes){
   if(n.type!=='ThisExpression'||!classReceiverThis(n,cls))continue;
   const p=parents.get(n),u=parents.get(p),name=property(p);
   if(p?.type==='MemberExpression'&&p.object===n&&name!==undefined){
    if(methods.has(name)&&(u?.type==='AssignmentExpression'&&u.left===p||u?.type==='UpdateExpression'||u?.operator==='delete'))valid=false;
    if(helpers.has(name)){
     const helper=helpers.get(name),call=parents.get(u);
     if(!(u?.type==='AssignmentExpression'&&u.operator==='='&&u.left===p&&u.right===helper.allocation||u?.type==='MemberExpression'&&u.object===p&&helper.methods.has(property(u))&&call?.type==='CallExpression'&&call.callee===u))valid=false;
    }
   }else if(p?.type==='CallExpression'&&p.callee.type==='MemberExpression'&&ix.free(p.callee.object,'Object')&&property(p.callee)==='assign'&&p.arguments[0]===n){
    // Omitted optional factory options cannot shadow the selected methods.
    const ctor=ix.owners.get(n),value=p.arguments[1],position=ctor.params.findIndex(param=>bindings.get(param.type==='AssignmentPattern'?param.left:param)===bindings.get(value));
    if(parents.get(ctor)?.kind!=='constructor'||position<0||p.arguments.length!==2)valid=false;
    else for(const call of constructions){
     const actual=factoryArgument(ix,factory,call,returned,ctor,position);
     if(actual&&!(actual.type==='Literal'&&actual.value===null)&&!(actual.type==='ObjectExpression'&&actual.properties.every(p=>p.type==='Property'&&p.kind==='init'&&!p.computed&&key(p)!=='__proto__'&&!methods.has(String(key(p))))))valid=false;
    }
   }else if(p?.type==='NewExpression'&&[...helpers.values()].some(h=>h.allocation===p)&&p.arguments[0]===n){
    // Reviewed allocation-only HTTP delegates retain this solely to call its
    // get/post methods. Keep both targets only when the helper field itself
    // is reached from a closed instance call site.
    const field=[...helpers].find(([,helper])=>helper.allocation===p)?.[0];
    if(field&&usedHelpers.has(field)){used.add('get');used.add('post');}
   // An unknown helper may mutate methods or expose the receiver elsewhere.
   }else valid=false;
  }
  if(valid){const fields=constructorLiteralFields(factory,returned,cls,methods,constructions,instances,constructorReachable);output.push({factory,cls,methods,used,instances,known,fields,constructorReachable});covered.add(cls);}
 }
 // Some compatibility environments instantiate an anonymous class directly
 // instead of returning it from a factory. Admit only a closed local instance:
 // every outside reference must be a static property access, and method values
 // may be used only as direct calls. This lets the same platform proof remove
 // Node-only branches without relying on a class or variable name.
 for(const declaration of nodes.filter(n=>n.type==='VariableDeclarator'&&n.id.type==='Identifier'&&n.init?.type==='NewExpression'&&n.init.callee.type==='ClassExpression')){
  const cls=declaration.init.callee;
  if(covered.has(cls))continue;
  const methods=classShape(cls),instance=bindings.get(declaration.id),classNodes=index(cls).nodes;
  if(!methods||!methods.has('isNode')||!instance?.refs.length||instance.writes.length)continue;
  const used=new Set(['constructor']),instances=new Set([instance]),known=targetMethodValues(source,cls,methods,format);let valid=true;
  if(typeof known.get('isNode')!=='boolean')continue;
  for(const ref of instance.refs){
   const member=parents.get(ref),use=parents.get(member),name=property(member);
   if(member?.type!=='MemberExpression'||member.object!==ref||member.optional||typeof name!=='string'||
      use?.type==='AssignmentExpression'&&use.left===member||use?.type==='UpdateExpression'&&use.argument===member||
      use?.type==='UnaryExpression'&&use.operator==='delete'&&use.argument===member){valid=false;break;}
   if(methods.has(name)){
    if(use?.type!=='CallExpression'||use.callee!==member||use.optional){valid=false;break;}
    used.add(name);
   }
  }
  // The class may keep ordinary data fields, but it cannot let its receiver
  // escape or overwrite a predicate that the specialization folds.
  for(const n of classNodes){
   if(n.type!=='ThisExpression'||!classReceiverThis(n,cls))continue;
   const member=parents.get(n),use=parents.get(member),name=property(member);
   if(member?.type==='MemberExpression'&&member.object===n&&typeof name==='string'){
    if(methods.has(name)&&(use?.type==='AssignmentExpression'&&use.left===member||use?.type==='UpdateExpression'&&use.argument===member||use?.type==='UnaryExpression'&&use.operator==='delete'&&use.argument===member))valid=false;
    continue;
   }
   // Passing this to any call could mutate the methods after the static proof.
   valid=false;
  }
  if(valid)output.push({cls,methods,used,instances,known});
 }
 return output;
 function safeReceiverRetention(helper){
  const constructor=helper.body.body.find(method=>method.type==='MethodDefinition'&&method.kind==='constructor');
  if(!constructor)return false;
  const receiver=constructor.value.params[0];if(receiver?.type!=='Identifier')return false;
  const binding=bindings.get(receiver);if(!binding||!binding.refs.length)return false;
  return binding.refs.every(ref=>{
   const assignment=parents.get(ref);
   return assignment?.type==='AssignmentExpression'&&assignment.operator==='='&&assignment.right===ref&&
    assignment.left.type==='MemberExpression'&&assignment.left.object.type==='ThisExpression'&&property(assignment.left)!==undefined;
  });
 }
}

export function foldTargetEnvironments(source,format){
 const ix=index(parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true})),replace=new WeakMap();
 const {parents}=ix;
 const classReceiverThis=(node,cls)=>{
  let owner=parents.get(node);
  while(owner&&owner!==cls){
   if(owner.type==='ArrowFunctionExpression'){owner=parents.get(owner);continue;}
   if(functions.has(owner.type)){
    const method=parents.get(owner);
    return method?.type==='MethodDefinition'&&method.value===owner&&parents.get(parents.get(method))===cls;
   }
   owner=parents.get(owner);
  }
  return owner===cls;
 };
 for(const {cls,methods,instances,known,fields,constructorReachable} of plans(ix,source,format)){
  const classNodes=index(cls).nodes;
  for(const n of classNodes)if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&!n.arguments.length&&known.has(property(n.callee))&&
    n.callee.object.type==='ThisExpression'&&classReceiverThis(n.callee.object,cls))replace.set(n,JSON.stringify(known.get(property(n.callee))));
  for(const instance of instances)for(const ref of instance.refs){
   const member=parents.get(ref),call=parents.get(member),name=property(member);
   if(member?.type==='MemberExpression'&&member.object===ref&&call?.type==='CallExpression'&&call.callee===member&&!call.arguments.length&&known.has(name))replace.set(call,JSON.stringify(known.get(name)));
  }
  for(const n of classNodes)if(n.type==='MemberExpression'&&n.object.type==='ThisExpression'&&classReceiverThis(n.object,cls)&&fields?.has(property(n))&&!(parents.get(n)?.type==='AssignmentExpression'&&parents.get(n).left===n)){
   let method=parents.get(n);while(method&&method.type!=='MethodDefinition'&&method!==cls)method=parents.get(method);
   if(method?.type==='MethodDefinition'&&method.kind==='method'&&!constructorReachable.has(key(method)))replace.set(n,JSON.stringify(fields.get(property(n))));
  }
 }
 return renderTree(source,ix.nodes[0],n=>replace.has(n)?{direct:true,value:replace.get(n)}:null);
}

export function pruneTargetEnvironments(source,format){
 const ix=index(parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true})),remove=new WeakSet();
 for(const {methods,used} of plans(ix,source,format)){
  const reachable=new Set(['constructor',...used]),queue=[...reachable];let valid=true;
  while(queue.length&&valid){
   const method=methods.get(queue.shift());if(!method)continue;
   for(const n of index(method.value).nodes)if(n.type==='MemberExpression'&&n.object.type==='ThisExpression'){
    const name=property(n);if(name===undefined){valid=false;break;}
    if(methods.has(name)&&!reachable.has(name)){reachable.add(name);queue.push(name);}
   }
  }
  if(valid)for(const [name,method]of methods)if(!reachable.has(name))remove.add(method);
 }
 const rendered=renderTree(source,ix.nodes[0],n=>remove.has(n)?{direct:true,value:''}:null);
 return pruneUnusedClosedClassMethods(rendered);
}

// A closed environment can contain platform-only methods whose only callers
// were removed when a platform switch folded. Remove those methods as well so
// dead Node branches do not leave free `require` references in the Egern file.
// Every instance and method edge must be statically closed; unknown/computed
// dispatch or receiver escape keeps the original class intact.
function pruneUnusedClosedClassMethods(source){
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree);
 const {nodes,parents,bindings}=ix,remove=new WeakSet();
 function returnedClass(fn){
  const statements=fn?.body?.body;
  const returned=Array.isArray(statements)?statements.find(statement=>statement.type==='ReturnStatement')?.argument:null;
  return returned?.type==='NewExpression'&&returned.callee.type==='ClassExpression'?returned.callee:null;
 }
 function classForCall(call){
  if(call?.type==='NewExpression'&&call.callee.type==='ClassExpression')return call.callee;
  if(['CallExpression','NewExpression'].includes(call?.type)&&call.callee.type==='Identifier')return returnedClass(bindings.get(call.callee)?.fn);
  return null;
 }
 const groups=new Map();
 for(const call of nodes.filter(node=>['CallExpression','NewExpression'].includes(node.type))){
  const cls=classForCall(call);if(!cls)continue;
  const declaration=parents.get(parents.get(call));
  if(parents.get(call)?.type!=='VariableDeclarator'||parents.get(call).init!==call||parents.get(call).id.type!=='Identifier'||declaration?.type!=='VariableDeclaration')continue;
  const binding=bindings.get(parents.get(call).id);if(!binding||binding.writes.length)continue;
  if(!groups.has(cls))groups.set(cls,{instances:[],factories:new Set(),calls:new Set()});
  const group=groups.get(cls);group.instances.push(binding);group.calls.add(call);
  if(call.callee.type==='Identifier')group.factories.add(bindings.get(call.callee));
 }
 for(const [cls,group] of groups){
  if(cls.superClass)continue;
  const {instances}=group;
  if([...group.factories].some(factory=>!factory||factory.writes.length||factory.refs.length!==group.calls.size||factory.refs.some(ref=>!group.calls.has(parents.get(ref)))))continue;
  const methods=cls.body.body.filter(member=>member.type==='MethodDefinition'&&!member.static&&member.kind==='method');
  const constructor=cls.body.body.find(member=>member.type==='MethodDefinition'&&member.kind==='constructor');
  if(methods.length+Number(!!constructor)!==cls.body.body.length||methods.some(member=>member.computed||typeof key(member)!=='string')||new Set(methods.map(key)).size!==methods.length)continue;
  const methodNames=new Set(methods.map(key)),used=new Set(),edges=new Map([...methods.map(member=>[key(member),new Set()]),['constructor',new Set()]]);
  let valid=true;
  for(const instance of instances)for(const ref of instance.refs){
   const member=parents.get(ref),use=parents.get(member),name=property(member);
   if(member?.type!=='MemberExpression'||member.object!==ref||member.optional||typeof name!=='string'||['constructor','__proto__'].includes(name)){valid=false;break;}
   if(methodNames.has(name)){
    const mutation=use?.type==='AssignmentExpression'&&use.left===member||use?.type==='UpdateExpression'&&use.argument===member||use?.type==='UnaryExpression'&&use.operator==='delete'&&use.argument===member;
    if(mutation||use?.type!=='CallExpression'||use.callee!==member||use.optional){valid=false;break;}used.add(name);
   }
  }
  if(!valid)continue;
  const classOwner=node=>{let owner=parents.get(node);while(owner&&owner!==cls){if(owner.type==='ArrowFunctionExpression'){owner=parents.get(owner);continue;}if(functions.has(owner.type)){const method=parents.get(owner);if(method?.type!=='MethodDefinition'||method.value!==owner||parents.get(parents.get(method))!==cls)return false;}owner=parents.get(owner);}return owner===cls;};
  for(const node of nodes)if(node.type==='ThisExpression'&&node.start>=cls.start&&node.end<=cls.end&&classOwner(node)){
   const member=parents.get(node),use=parents.get(member),name=property(member),owner=parents.get(node);
   if(member?.type!=='MemberExpression'||member.object!==node||member.optional||typeof name!=='string'||['constructor','__proto__'].includes(name)){valid=false;break;}
   if(methodNames.has(name)){
    if(use?.type!=='CallExpression'||use.callee!==member||use.optional||
       use.type==='AssignmentExpression'||use.type==='UpdateExpression'){valid=false;break;}
    let method=owner;while(method&&!(method.type==='MethodDefinition'&&method.value&&node.start>=method.start&&node.end<=method.end))method=parents.get(method);
    if(!method||!['method','constructor'].includes(method.kind)||method.static){valid=false;break;}
    edges.get(key(method))?.add(name);
   }
  }
  if(!valid)continue;
  const reachable=new Set(['constructor',...used]),queue=[...reachable];
  while(queue.length){
   const name=queue.shift();for(const dependency of edges.get(name)??[])if(!reachable.has(dependency)){reachable.add(dependency);queue.push(dependency);}
  }
  for(const method of methods)if(!reachable.has(key(method)))remove.add(method);
 }
 return renderTree(source,tree,node=>remove.has(node)?{direct:true,value:''}:null);
}

// 多平台 Env 有两种常见形态：工厂返回 class，或"构造器 + 原型方法赋值"。后者与
// class 语义等价（构造器体 = constructor，原型方法 = 实例方法），先把这种形态归一
// 化成 class，让已有的 isNode/getEnv 折叠与不可达分支裁剪对两种写法同时生效。
// 只处理能证明封闭的情形：构造器绑定的全部引用要么是 new，要么是
// Env.prototype.name = function(){} 安装；出现箭头函数方法、原型被整体传递/枚举、
// 重复方法名或 constructor 覆盖时整份跳过，保持原样。
export function normalizePrototypeEnv(source){
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree);
 const {nodes,parents,bindings,owners}=ix,edits=[];
 const slice=n=>source.slice(n.start,n.end);
 for(const fn of nodes){
  if(fn.type!=='FunctionDeclaration'&&fn.type!=='FunctionExpression')continue;
  if(fn.async||fn.generator||fn.body?.type!=='BlockStatement')continue;
  const syntax=parents.get(fn);
  const id=fn.type==='FunctionDeclaration'?fn.id
   :syntax?.type==='VariableDeclarator'&&syntax.init===fn&&syntax.id.type==='Identifier'?syntax.id:null;
  if(!id?.name)continue;
  const binding=bindings.get(id);
  if(!binding||binding.writes.length||!binding.refs.length)continue;
  const methods=[],removals=[],constructions=[];let valid=true;
  for(const ref of binding.refs){
   const p=parents.get(ref),q=parents.get(p);
   if(p?.type==='NewExpression'&&p.callee===ref){constructions.push(p);continue;}
   if(p?.type==='MemberExpression'&&p.object===ref&&property(p)==='prototype'&&q?.type==='MemberExpression'&&q.object===p){
    const name=property(q),assignment=parents.get(q);
    if(typeof name!=='string'||name==='constructor'||assignment?.type!=='AssignmentExpression'||assignment.operator!=='='||assignment.left!==q)  {valid=false;break;}
    const method=assignment.right;
    if(!method||method.type!=='FunctionExpression'||method.async||method.generator||method.body?.type!=='BlockStatement'){valid=false;break;}
    if(methods.some(item=>item.name===name)){valid=false;break;}
    const statement=parents.get(assignment);
    if(statement?.type!=='ExpressionStatement'){valid=false;break;}
    methods.push({name,method});removals.push(statement);continue;
   }
   valid=false;break;
  }
  if(!valid||!constructions.length||!methods.length)continue;
  const methodNames=new Set(methods.map(item=>item.name));
  for(const construction of constructions){
   const declarator=parents.get(construction),declaration=parents.get(declarator);
   // 同一 var/let 语句可以同时声明普通响应字段等无关变量；实例引用仍由下面
   // 的逐项封闭检查约束，因此不必要求目标声明器独占整条声明。
   if(declarator?.type!=='VariableDeclarator'||declarator.init!==construction||declarator.id.type!=='Identifier'||declaration?.type!=='VariableDeclaration'){valid=false;break;}
   const instance=bindings.get(declarator.id);
   if(!instance||!instance.refs.length||instance.writes.length){valid=false;break;}
   for(const ref of instance.refs){
    const member=parents.get(ref);
    if(member?.type!=='MemberExpression'||member.object!==ref||member.optional){valid=false;break;}
    const name=property(member);
    if(typeof name!=='string'||['constructor','prototype','__proto__'].includes(name)){valid=false;break;}
    const use=parents.get(member);
    if(methodNames.has(name)){
     if(use?.type!=='CallExpression'||use.callee!==member||use.optional){valid=false;break;}
     continue;
    }
    if(use?.type==='UpdateExpression'||use?.type==='UnaryExpression'&&use.operator==='delete'){valid=false;break;}
   }
   if(!valid)break;
  }
  if(!valid)continue;
  const params=n=>n.params.map(slice).join(', ');
  if(nodes.some(n=>(n.start>=fn.start&&n.end<=fn.end&&owners.get(n)===fn&&n.type==='ReturnStatement')||
    ((n.start>=fn.start&&n.end<=fn.end)&&n.type==='MemberExpression'&&n.object.type==='Identifier'&&n.object.name==='arguments'&&['callee','caller'].includes(property(n)))))continue;
  const methodsText=methods.map(item=>item.name+'('+params(item.method)+')'+slice(item.method.body)).join('');
  // 保持原函数作为工厂：类构造器接收同一组参数，并继续由原调用点 new。
  // 外层不再重复声明参数，避免默认值在两层各求值一次。
  const factoryText='function '+id.name+'(){return new class{constructor('+params(fn)+')'+slice(fn.body)+methodsText+'}(...arguments);}';
  edits.push({start:fn.start,end:fn.end,text:factoryText});
  for(const statement of removals)edits.push({start:statement.start,end:statement.end,text:''});
 }
 if(!edits.length)return {source,normalized:0};
 let output=source;
 for(const edit of edits.sort((a,b)=>b.start-a.start))output=output.slice(0,edit.start)+edit.text+output.slice(edit.end);
 try{parse(output,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true});}
 catch{return {source,normalized:0};}
 return {source:output,normalized:edits.filter(edit=>edit.text).length};
}

// 多平台 Env 的平台探测方法（getEnv/isNode/isSurge/...）在 Egern 产物里不能折成
// "哪个旧平台都不是"：那样会落到 default 分支，存储读回 null 等静默错误。这里按
// 结构识别"纯平台探测"的 Env，把它折到本项目能原生降级的那一支（Surge 风格的
// $persistentStore/$notification/$httpClient），折叠后由常量 if/switch 裁剪删除
// 不可达的 Node/其它平台分支。识别只看方法体结构，不依赖实现哈希，也不按作者或
// 文件名放行；实例引用必须封闭（只能是 new 与方法调用）。
const PLATFORM_NAMES=new Set(['Surge','Loon','Quantumult X','Stash','Shadowrocket','Node.js','Worker','Egern']);
const FOLDED_PLATFORM='Surge';
const PLATFORM_ROOTS=new Set(['$environment','$task','$loon','$rocket','$prefs','$persistentStore','$notification','$httpClient','module','globalThis','global','window','process','require']);
const PROBE_BINARY=new Set(['===','==','!==','!=']);
// 平台探测体只能是 typeof、平台根对象成员和字符串字面量的组合。返回值必须包含
// 目标平台 Surge，不能调用任何函数，也不能读取任意本地绑定。这样折叠只依赖探测
// 表达式本身，不需要执行原文。
function platformProbe(method,ix){
 if(!method||method.kind!=='method'||method.value.params.length||method.value.async||method.value.generator)return false;
 const body=method.value.body?.body;
 if(body?.length!==1||body[0].type!=='ReturnStatement'||!body[0].argument)return false;
 let valid=true,sawTypeof=false,sawTarget=false;
 const walk=(n,parent)=>{
  if(!valid||!n)return;
  if(Array.isArray(n)){for(const child of n)walk(child,parent);return;}
  switch(n.type){
   case 'ConditionalExpression':walk(n.test,n);walk(n.consequent,n);walk(n.alternate,n);return;
   case 'LogicalExpression':
    if(!['&&','||'].includes(n.operator)){valid=false;return;}
    walk(n.left,n);walk(n.right,n);return;
   case 'BinaryExpression':
    if(!PROBE_BINARY.has(n.operator)){valid=false;return;}
    walk(n.left,n);walk(n.right,n);return;
   case 'UnaryExpression':
    if(!['typeof','!','void'].includes(n.operator)){valid=false;return;}
    if(n.operator==='void'&&n.argument?.type!=='Literal'){valid=false;return;}
    if(n.operator==='typeof')sawTypeof=true;
    walk(n.argument,n);return;
   case 'MemberExpression':
    if(n.optional){valid=false;return;}
    if(n.computed){
     if(n.property?.type!=='Literal'||typeof n.property.value!=='string'){valid=false;return;}
    }else if(!n.property?.name){valid=false;return;}
    walk(n.object,n);return;
   case 'Literal':
    if(typeof n.value==='string'){
     if(!PLATFORM_NAMES.has(n.value)&&n.value!=='undefined'){valid=false;return;}
     if(n.value===FOLDED_PLATFORM)sawTarget=true;
    }else if(typeof n.value!=='boolean'&&typeof n.value!=='number'&&n.value!==null){valid=false;}
    return;
   case 'Identifier':
    if(parent?.type==='UnaryExpression'&&parent.operator==='typeof'&&parent.argument===n)return;
    if(parent?.type==='MemberExpression'&&parent.object===n&&PLATFORM_ROOTS.has(n.name))return;
    if(n.name==='undefined'&&ix.free(n))return;
    valid=false;return;
   default:valid=false;
  }
 };
 walk(body[0].argument,null);
 return valid&&sawTypeof&&sawTarget;
}
// 部分 Env 把平台直接写死为常量，例如 getEnv(){return "Surge"}。这种情况下
// 探测结果本身已经是目标平台，不依赖任何宿主能力；只接受无表达式模板或字符串
// 字面量且必须等于折叠目标，避免把写死其它平台或动态拼接的脚本误折到 Surge。
function constantPlatformProbe(method){
 if(!method||method.kind!=='method'||method.value.params.length||method.value.async||method.value.generator)return false;
 const body=method.value.body?.body;
 if(body?.length!==1||body[0].type!=='ReturnStatement')return false;
 const expression=body[0].argument;
 const value=expression?.type==='Literal'&&typeof expression.value==='string'?expression.value
  :expression?.type==='TemplateLiteral'&&!expression.expressions.length&&expression.quasis.length===1?expression.quasis[0].value.cooked:null;
 return value===FOLDED_PLATFORM;
}
// 识别"工厂返回封闭 class 实例"的多平台 Env：实例只能通过静态成员访问，不能整体
// 传递、枚举或改绑；平台探测方法必须唯一且可静态验证；class 内不允许动态 this 成员。
// 任一条件不成立即跳过整个候选，保持原文并让后续分析继续拒绝。
function multiPlatformEnv(ix,source){
 const {nodes,parents,bindings,owners}=ix,candidates=[];
 const deadCache=new WeakMap();
 // 打包器偶尔把实例临时存进局部别名，仅用于在后续 `.call` 中保留接收者。
 // 别名必须只有这一次写入、没有初始化，并且所有读取都只是静态成员或 `.call`
 // 的第一个参数；任何重绑、动态成员、方法写入或其它逃逸都让整个候选失效。
 function aliasMembers(assignment){
  const aliasNode=assignment.left;
  if(aliasNode?.type!=='Identifier')return null;
  const alias=bindings.get(aliasNode);
  if(!alias||alias.init||alias.writes.length!==1||alias.writes[0]!==assignment)return null;
  const members=new Set();
  for(const ref of alias.refs){
   if(ref===aliasNode)continue;
   const member=parents.get(ref),use=parents.get(member),name=property(member);
   if(member?.type==='MemberExpression'&&member.object===ref&&typeof name==='string'&&!member.optional){
    if(use?.type==='AssignmentExpression'&&use.left===member||use?.type==='UpdateExpression'||use?.type==='UnaryExpression'&&use.operator==='delete')return null;
    members.add(name);continue;
   }
   const call=parents.get(ref);
   if(call?.type==='CallExpression'&&call.arguments[0]===ref&&!call.optional&&
      call.callee.type==='MemberExpression'&&property(call.callee)==='call'&&!call.arguments.some(argument=>argument.type==='SpreadElement'))continue;
   return null;
  }
  return members;
 }
 function receiverMember(ref){
  const direct=parents.get(ref);
  if(direct?.type==='MemberExpression'&&direct.object===ref)return {member:direct,aliased:null};
  if(direct?.type==='AssignmentExpression'&&direct.operator==='='&&direct.right===ref){
   const member=parents.get(direct);
   if(member?.type==='MemberExpression'&&member.object===direct){
    const aliased=aliasMembers(direct);if(aliased)return {member,aliased};
   }
  }
  return null;
 }
 for(const factory of nodes){
  if(factory.type!=='FunctionDeclaration'&&factory.type!=='FunctionExpression')continue;
  const body=factory.body?.body;
  if(!Array.isArray(body)||body.at(-1)?.type!=='ReturnStatement')continue;
  const returns=body.filter(n=>n.type==='ReturnStatement');
  if(returns.length!==1)continue;
  const returned=returns[0].argument;
  if(returned?.type!=='NewExpression'||returned.callee.type!=='ClassExpression')continue;
  const cls=returned.callee;
  if(cls.superClass)continue;
  let valid=true;const methods=new Map(),methodList=[];
  for(const element of cls.body.body){
   if(element.type!=='MethodDefinition'||element.static||element.computed||element.key?.type==='PrivateIdentifier'||!['method','constructor'].includes(element.kind)){valid=false;break;}
   const name=key(element);
   if(typeof name!=='string'||name==='__proto__'){valid=false;break;}
   if(element.kind==='method'){
    if(methods.has(name)){valid=false;break;}
    methods.set(name,element);
   }
   methodList.push(element);
  }
  if(!valid||!methodList.length)continue;
  const probes=[...methods].filter(([,method])=>platformProbe(method,ix)||constantPlatformProbe(method));
  if(probes.length!==1)continue;
  const [probeName,probeMethod]=probes[0];
  const predicates=new Map();
  for(const [name,method] of methods){
   if(method===probeMethod)continue;
   const statements=method.value.body?.body;
   if(statements?.length!==1||statements[0].type!=='ReturnStatement')continue;
   const expression=statements[0].argument;
   if(expression?.type!=='BinaryExpression'||!PROBE_BINARY.has(expression.operator))continue;
   for(const [literalSide,callSide] of [[expression.left,expression.right],[expression.right,expression.left]]){
    const platform=literalSide?.type==='Literal'&&typeof literalSide.value==='string'?literalSide.value:null;
    if(!platform||!PLATFORM_NAMES.has(platform))continue;
    if(callSide?.type!=='CallExpression'||callSide.arguments.length||callSide.callee?.type!=='MemberExpression'||callSide.callee.object.type!=='ThisExpression'||property(callSide.callee)!==probeName)continue;
    const positive=expression.operator==='==='||expression.operator==='==';
    predicates.set(name,positive?platform===FOLDED_PLATFORM:platform!==FOLDED_PLATFORM);
   }
  }
  for(const method of methodList)for(const n of nodes){
   if(n.start<method.value.start||n.end>method.value.end)continue;
   if(n.type==='MemberExpression'&&n.object.type==='ThisExpression'&&(n.computed||property(n)===undefined)){valid=false;break;}
   if(!valid)break;
  }
  if(!valid)continue;
  const syntax=parents.get(factory);
  const id=factory.type==='FunctionDeclaration'?factory.id
   :syntax?.type==='VariableDeclarator'&&syntax.init===factory&&syntax.id.type==='Identifier'?syntax.id:null;
  if(!id?.name)continue;
  const binding=bindings.get(id);
  if(!binding||binding.writes.length||!binding.refs.length)continue;
  const roots=new Set(),instances=[];
  for(const ref of binding.refs){
   const construction=parents.get(ref);
   if(construction?.type!=='NewExpression'||construction.callee!==ref){valid=false;break;}
   const declarator=parents.get(construction),declaration=parents.get(declarator);
   // 旧脚本常把 Env 实例和正文临时变量写在同一条 var 声明里。实例封闭性
   // 只取决于该 declarator 自己的初始化与后续读取，兄弟声明不参与证明。
   if(declarator?.type!=='VariableDeclarator'||declarator.init!==construction||declarator.id.type!=='Identifier'||declaration?.type!=='VariableDeclaration'){valid=false;break;}
   const instance=bindings.get(declarator.id);
   if(!instance||!instance.refs.length){valid=false;break;}
   const liveWrites=instance.writes.filter(write=>!provablyDead(ix,write,deadCache));
   if(liveWrites.length){valid=false;break;}
   for(const use of instance.refs){
    if(provablyDead(ix,use,deadCache))continue;
    const receiver=receiverMember(use);
    if(!receiver){valid=false;break;}
    const {member,aliased}=receiver;
    const name=property(member);
    if(typeof name!=='string'||['constructor','prototype','__proto__'].includes(name)){valid=false;break;}
    const useParent=parents.get(member);
    if(useParent?.type==='AssignmentExpression'&&useParent.left===member){
     if(useParent.operator!=='='||methods.has(name)){valid=false;break;}
     continue;
    }
    if(useParent?.type==='UpdateExpression'||useParent?.type==='UnaryExpression'&&useParent.operator==='delete'){valid=false;break;}
    if(methods.has(name))roots.add(name);
    if(aliased)for(const aliasName of aliased)if(methods.has(aliasName))roots.add(aliasName);
   }
   if(!valid)break;
   instances.push(declarator);
  }
  if(!valid||!instances.length)continue;
  // 旧 Env 常把 this 交给内部 HTTP helper；helper 可能再以 this.env 调用
  // 同一批方法。只保留从 Env 实例的 helper 字段实际可达、且确实会以 Env
  // 作为 this 执行的方法；仅按同名保留会把 mdsq2 一类死方法也当成活代码。
  const helpers=new Map();
  for(const n of nodes)if(n.type==='ClassDeclaration'&&n.start>=factory.start&&n.end<=factory.end){const b=bindings.get(n.id);if(b)helpers.set(b,n);}
  const instanceBindings=new Set(instances.map(d=>bindings.get(d.id)).filter(Boolean));
  const conservativeHelperRoots=helper=>{
   for(const m of helper.body.body)if(m.type==='MethodDefinition'&&m.kind==='method'){
    if(methods.has(key(m)))roots.add(key(m));
    for(const x of index(m.value).nodes)if(x.type==='MemberExpression'&&x.object.type==='ThisExpression'&&methods.has(property(x)))roots.add(property(x));
   }
  };
  const helperRoots=(helper,construction)=>{
   const helperMethods=new Map(helper.body.body.filter(m=>m.type==='MethodDefinition'&&m.kind==='method'&&typeof key(m)==='string').map(m=>[key(m),m]));
   const ctor=helper.body.body.find(m=>m.type==='MethodDefinition'&&m.kind==='constructor');
   const position=construction.arguments.findIndex(a=>a.type==='ThisExpression');
   const parameter=ctor?.value.params[position],parameterBinding=parameter?.type==='Identifier'?bindings.get(parameter):null;
   const envFields=new Set();
   if(parameterBinding&&!parameterBinding.writes.length&&parameterBinding.refs.length===1){
    const ref=parameterBinding.refs[0],use=parents.get(ref);
    if(use?.type==='AssignmentExpression'&&use.operator==='='&&use.right===ref&&use.left.type==='MemberExpression'&&use.left.object.type==='ThisExpression'&&typeof property(use.left)==='string')envFields.add(property(use.left));
   }
   const assignment=parents.get(construction);
   const helperField=assignment?.type==='AssignmentExpression'&&assignment.operator==='='&&assignment.right===construction&&assignment.left.type==='MemberExpression'&&assignment.left.object.type==='ThisExpression'&&typeof property(assignment.left)==='string'?property(assignment.left):null;
   // 无法证明字段映射时保留旧的保守根集合，避免误删仍可能被调用的方法。
   if(!helperField||!envFields.size)return false;
   const normal=new Set(),bound=new Set(),queue=[],boundCalls=new Map(),boundMembers=[];
   const add=(name,isBound,args=null)=>{
    if(!helperMethods.has(name))return;
    if(isBound&&Array.isArray(args)){
     const calls=boundCalls.get(name)??[];calls.push(args);boundCalls.set(name,calls);
    }
    const set=isBound?bound:normal;
    if(set.has(name))return;
    set.add(name);queue.push({name,isBound});
   };
   for(const member of nodes){
    if(member.type!=='MemberExpression'||property(member)!==helperField)continue;
    const owner=member.object.type==='Identifier'?bindings.get(member.object):null;
    const ownThis=member.object.type==='ThisExpression'&&member.start>=cls.start&&member.end<=cls.end;
    if(!(owner&&instanceBindings.has(owner)||ownThis))continue;
    const use=parents.get(member);
    if(use?.type==='AssignmentExpression'&&use.left===member&&use.right===construction)continue;
    if(use?.type==='MemberExpression'&&use.object===member&&typeof property(use)==='string'){add(property(use),false);continue;}
    // helper 实例作为值逃逸或直接调用时，无法证明具体方法，回退保守根集合。
    return false;
   }
   const lexicalOwner=n=>{
    let owner=owners.get(n);
    while(owner?.type==='ArrowFunctionExpression')owner=owners.get(parents.get(owner));
    return owner;
   };
   while(queue.length){
    const {name,isBound}=queue.shift(),method=helperMethods.get(name);
    if(!method)continue;
    for(const n of nodes){
     if(n.start<method.value.start||n.end>method.value.end||lexicalOwner(n)!==method.value)continue;
     if(n.type!=='MemberExpression'||n.object.type!=='ThisExpression'||typeof property(n)!=='string')continue;
     const member=property(n),use=parents.get(n);
     if(envFields.has(member)){
      if(use?.type==='MemberExpression'&&use.object===n&&typeof property(use)==='string'){
       if(methods.has(property(use)))roots.add(property(use));
       else return false;
       continue;
      }
      if(use?.type==='CallExpression'&&use.callee.type==='MemberExpression'&&['call','apply'].includes(property(use.callee))&&use.arguments[0]===n){
       const target=use.callee.object;
       if(target?.type==='MemberExpression'&&target.object.type==='ThisExpression'&&helperMethods.has(property(target)))continue;
       return false;
      }
      return false;
     }
     // 以 Env 为 this 执行的方法里，this.<name> 只能解析到 Env 方法。
     // 但同名 helper 方法也可能是条件分支里的自身引用；先记录候选，
     // 等全部可达 helper 调用实参收集完再判断该分支是否可能执行。
     if(isBound&&methods.has(member)){boundMembers.push({member,method,node:n});continue;}
     if(!helperMethods.has(member))continue;
     if(use?.type==='CallExpression'&&use.callee===n){add(member,false);continue;}
     if(use?.type==='MemberExpression'&&use.object===n&&['call','apply'].includes(property(use))){
      const call=parents.get(use),args=call?.type==='CallExpression'&&call.callee===use?call.arguments:[],thisArg=args[0]??null;
      if(thisArg?.type==='MemberExpression'&&thisArg.object.type==='ThisExpression'&&envFields.has(property(thisArg))){
       add(member,true,property(use)==='call'?args.slice(1):null);continue;
      }
      if(thisArg?.type==='ThisExpression'){add(member,false);continue;}
      return false;
     }
     if(use?.type==='MemberExpression'&&use.object===n){add(member,false);continue;}
     return false;
    }
   }
   // helper 方法的形参值只能来自已证明的 `.call(this.env, ...)` 调用点；
   // 如果条件明确排除了某个方法名的分支，就不再把它当作 Env 方法根。
   const boundParamValues=(method,param)=>{
    const position=method.value.params.findIndex(p=>bindings.get(p.type==='AssignmentPattern'?p.left:p)===bindings.get(param));
    const values=new Set(),calls=boundCalls.get(key(method))??[];
    if(position<0||!calls.length)return {values,unknown:true};
    let unknown=false;
    for(const args of calls){
     let actual=args[position],formal=method.value.params[position];
     if(!actual)actual=formal?.type==='AssignmentPattern'?formal.right:null;
     if(!actual){unknown=true;continue;}
     if(actual.type==='Literal')values.add(actual.value);else unknown=true;
    }
    return {values,unknown};
   };
   const literalGuard=(test,method)=>{
    if(test?.type!=='BinaryExpression'||!['===','==','!==','!='].includes(test.operator))return undefined;
    for(const [value,name] of [[test.left,test.right],[test.right,test.left]]){
     if(name.type!=='Identifier'||value.type!=='Literal')continue;
     const binding=bindings.get(name);
     if(!binding||!method.value.params.some(p=>bindings.get(p.type==='AssignmentPattern'?p.left:p)===binding))continue;
     const {values,unknown}=boundParamValues(method,name);
     if(unknown)return undefined;
     const equal=[...values].some(item=>item===value.value||test.operator==='=='&&item==value.value);
     return test.operator.startsWith('!')?!equal:equal;
    }
    return undefined;
   };
   const guardAllows=(node,method)=>{
    for(let child=node,parent=parents.get(child);parent&&parent!==method.value;child=parent,parent=parents.get(child)){
     if(parent.type==='LogicalExpression'&&parent.operator==='&&'&&parent.right===child&&literalGuard(parent.left,method)===false)return false;
     if(parent.type==='IfStatement'&&parent.consequent===child&&literalGuard(parent.test,method)===false)return false;
     if(parent.type==='ConditionalExpression'&&parent.consequent===child&&literalGuard(parent.test,method)===false)return false;
    }
    return true;
   };
   for(const candidate of boundMembers)if(guardAllows(candidate.node,candidate.method))roots.add(candidate.member);
   return true;
  };
  for(const n of nodes)if(n.start>=cls.start&&n.end<=cls.end&&n.type==='NewExpression'&&n.callee.type==='Identifier'&&n.arguments.some(a=>a.type==='ThisExpression')){
   const helper=helpers.get(bindings.get(n.callee));if(!helper)continue;
   if(!helperRoots(helper,n))conservativeHelperRoots(helper);
  }
  candidates.push({factory,cls,methods,methodList,probeName,probeMethod,predicates,roots,instances});
 }
 return candidates;
}
export function foldMultiPlatformProbes(source){
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree);
 const {nodes,owners,parents}=ix,edits=[];
 for(const candidate of multiPlatformEnv(ix,source)){
  const local=[];
  let valid=true;
  for(const method of candidate.methodList){
   const fn=method.value;
   for(const n of nodes){
    if(n.start<fn.start||n.end>fn.end||n.type!=='CallExpression'||n.optional)continue;
    const callee=n.callee;
    if(callee?.type!=='MemberExpression'||callee.object.type!=='ThisExpression'||callee.optional)continue;
    const name=property(callee);
    if(name!==candidate.probeName&&!candidate.predicates.has(name))continue;
    if(n.arguments.length){valid=false;break;}
    // 只处理词法 this 仍属于当前方法的调用；普通嵌套函数里的 this 不是 Env 实例。
    let owner=owners.get(n);
    while(owner?.type==='ArrowFunctionExpression')owner=owners.get(parents.get(owner));
    if(owner!==fn){valid=false;break;}
    if(name===candidate.probeName)local.push({start:n.start,end:n.end,text:JSON.stringify(FOLDED_PLATFORM)});
    else local.push({start:n.start,end:n.end,text:String(candidate.predicates.get(name))});
   }
   if(!valid)break;
  }
  if(valid)edits.push(...local);
 }
 if(!edits.length)return {source,folded:0};
 let output=source;
 const unique=[...new Map(edits.map(edit=>[edit.start+':'+edit.end,edit])).values()];
 for(const edit of unique.sort((a,b)=>b.start-a.start))output=output.slice(0,edit.start)+edit.text+output.slice(edit.end);
 try{parse(output,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true});}
 catch{return {source,folded:0};}
 return {source:output,folded:unique.length};
}

// 折叠与常量裁剪之后，多平台 Env 里只剩 Node 用法的实例方法（如 initGotEnv）已经
// 没有任何调用点。这里按结构识别的 Env 类删除这些不可达方法，避免残留 require 等
// Node 宿主引用；constructor 恒保留，仍被任何成员访问引用的方法也保留。
export function pruneUnusedEnvMethods(source){
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree);
 const {nodes,parents}=ix,edits=[];
 let removedCompletion=false;
 for(const candidate of multiPlatformEnv(ix,source)){
  const methods=candidate.methods;
  const reachable=new Set(['constructor']),queue=['constructor'];
  // toString/valueOf/toJSON 可能被隐式调用，不能按静态成员引用判定为死代码。
  for(const implicit of ['toString','valueOf','toJSON'])if(methods.has(implicit)){reachable.add(implicit);queue.push(implicit);}
  for(const name of candidate.roots)if(!reachable.has(name)){reachable.add(name);queue.push(name);}
  const calls=new Map([...methods.keys(),'constructor'].map(name=>[name,new Set()]));
  for(const method of candidate.methodList){
   for(const n of nodes){
    if(n.start<method.value.start||n.end>method.value.end||n.type!=='MemberExpression'||n.object.type!=='ThisExpression')continue;
    const name=property(n);
    if(typeof name==='string'&&calls.has(name))calls.get(key(method)).add(name);
   }
  }
  while(queue.length){
   const name=queue.shift();
   for(const next of calls.get(name)??[])if(!reachable.has(next)){reachable.add(next);queue.push(next);}
  }
  for(const [name,method] of methods){
   if(reachable.has(name))continue;
   const body=source.slice(method.value.start,method.value.end);
   if(/\$done\b/.test(body))removedCompletion=true;
   edits.push({start:method.start,end:method.end,text:''});
  }
 }
 if(!edits.length)return {source,pruned:0,completionRemoved:false};
 let output=source;
 for(const edit of edits.sort((a,b)=>b.start-a.start))output=output.slice(0,edit.start)+edit.text+output.slice(edit.end);
 try{parse(output,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true});}
 catch{return {source,pruned:0,completionRemoved:false};}
 return {source:output,pruned:edits.length,completionRemoved:removedCompletion&&!/\$done\b/.test(output)};
}
