import {functions,property,key,index,patch,renderTree,initializedAfter,factoryArgument,literalExpression} from '../core/ast.mjs';
import {parse} from '../core/syntax.mjs';
import {evaluationBindings} from './evaluation.mjs';

// An unused SDK field may lose its initializer only when that initializer is a
// closed allocation with no effects outside its fresh local data. In particular,
// constructing a table of HTTP closures does not execute those HTTP requests.
export function inertFactoryCall(ix,call){
 const {nodes,parents,bindings,free}=ix;
 const declarations=b=>nodes.filter(n=>['VariableDeclarator','FunctionDeclaration'].includes(n.type)&&bindings.get(n.id)===b).length;
 function primitive(n,seen){
  if(!n||seen.has(n))return false;seen=new Set(seen);seen.add(n);
  if(n.type==='Literal')return !n.regex;
  if(n.type==='Identifier'){
   if(free(n,'undefined'))return true;const b=bindings.get(n);
   return !!b?.init&&!b.writes.length&&declarations(b)===1&&b.init.end<n.start&&primitive(b.init,seen);
  }
  if(n.type==='UnaryExpression')return ['!','void','+','-','~','typeof'].includes(n.operator)&&primitive(n.argument,seen);
  return ['BinaryExpression','LogicalExpression'].includes(n.type)&&primitive(n.left,seen)&&primitive(n.right,seen);
 }
 function data(n,seen){
  if(!n)return true;if(seen.has(n))return false;seen=new Set(seen);seen.add(n);
  if(n.type==='Literal'||functions.has(n.type))return true;
  if(n.type==='ArrayExpression')return n.elements.every(e=>e&&data(e,seen));
  if(n.type==='ObjectExpression')return n.properties.every(p=>p.type==='Property'&&p.kind==='init'&&!p.computed&&key(p)!=='__proto__'&&data(p.value,seen));
  if(n.type==='UnaryExpression')return n.operator==='typeof'&&n.argument.type==='Identifier'&&!bindings.has(n.argument)||primitive(n,new Set());
  if(n.type==='BinaryExpression'||n.type==='LogicalExpression')return primitive(n,new Set());
  if(n.type==='Identifier'){
   if(free(n,'undefined'))return true;
   const b=bindings.get(n);return !!b?.init&&!b.writes.length&&declarations(b)===1&&b.init.end<n.start&&data(b.init,seen);
  }
  if(n.type==='CallExpression')return factory(n,seen);
  return false;
 }
 function factory(n,seen){
  if(n?.type!=='CallExpression'||n.arguments.length||n.callee.type!=='Identifier')return false;
  const b=bindings.get(n.callee),fn=b?.fn;
  if(!fn||fn.async||fn.generator||b.writes.length||declarations(b)!==1||seen.has(fn)||fn.params.some(p=>p.type!=='Identifier'&&(p.type!=='AssignmentPattern'||!data(p.right,seen))))return false;
  seen=new Set(seen);seen.add(fn);
  const body=fn.body.body,ret=body.at(-1);
  if(ret?.type!=='ReturnStatement')return false;
  const effects=body.slice(0,-1).filter(s=>s.type!=='FunctionDeclaration'&&!(s.type==='VariableDeclaration'&&s.declarations.every(d=>d.id.type==='Identifier'&&data(d.init,seen))));
  if(!effects.length&&data(ret.argument,seen))return true;
  // Fresh closure tables: [literal strings].forEach(k => table[k.lower()] =
  // function ...) followed by returning the same unescaped empty table.
  const sequence=ret.argument;
  if(effects.length>1||effects.length&&effects[0].type!=='ExpressionStatement'||!effects.length&&(sequence?.type!=='SequenceExpression'||sequence.expressions.length!==2))return false;
  const [loop,result]=effects.length?[effects[0].expression,sequence]:sequence.expressions,table=bindings.get(result),initial=table?.init;
  if(result.type!=='Identifier'||initial?.type!=='ObjectExpression'||initial.properties.length||table.writes.length||initial.start<fn.start)return false;
  const array=loop.callee?.object?.type==='Identifier'?bindings.get(loop.callee.object)?.init:loop.callee?.object;
  if(loop.type!=='CallExpression'||loop.callee.type!=='MemberExpression'||property(loop.callee)!=='forEach'||array?.type!=='ArrayExpression'||!array.elements.every(e=>e?.type==='Literal'&&typeof e.value==='string')||loop.arguments.length!==1)return false;
  const callback=loop.arguments[0],assignment=callback.body;
  if(callback.type!=='ArrowFunctionExpression'||callback.async||callback.params.length!==1||callback.params[0].type!=='Identifier'||assignment.type!=='AssignmentExpression'||assignment.operator!=='='||assignment.left.type!=='MemberExpression'||bindings.get(assignment.left.object)!==table||!functions.has(assignment.right.type))return false;
  const selector=assignment.left.property;
  if(!assignment.left.computed||selector.type!=='CallExpression'||selector.arguments.length||selector.callee.type!=='MemberExpression'||!['toLowerCase','toUpperCase'].includes(property(selector.callee))||bindings.get(selector.callee.object)!==bindings.get(callback.params[0]))return false;
  if(table.refs.some(r=>r!==result&&r!==assignment.left.object))return false;
  return !nodes.some(x=>x.type==='AssignmentExpression'&&x.left.type==='MemberExpression'&&property(x.left)==='forEach');
 }
 return factory(call,new Set());
}

// Flatten closed init() closures, retaining initialization order and captured
// state. Reachability and binding identity, never SDK/author names, select code.

export function lowerLegacyFactories(source,generated=new Set()){
 source=nameClosedFactoryExpressions(source);
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree);
 const {nodes,parents,bindings,free,owners}=ix,replace=new WeakMap(),removed=new WeakSet();
 evaluationBindings(ix,source);
 if(tree.body.some(n=>n.directive==='use strict'))return source;
 const names=new Set(nodes.filter(n=>n.type==='Identifier').map(n=>n.name));
 const fresh=base=>{let n=base,i=2;while(names.has(n))n=base+i++;names.add(n);return n;};
 for(const factory of nodes.filter(n=>n.type==='FunctionDeclaration'&&!n.async&&!n.generator&&n.params.every(p=>p.type==='Identifier'))){
  const body=factory.body.body,ret=body.at(-1);
  if(ret?.type!=='ReturnStatement'||ret.argument?.type!=='ObjectExpression'||body.length<2)continue;
  const members=new Map(),initializers=[],probes=[],external=[];let valid=true;
  for(const id of factory.params){const value={type:'Identifier',name:'omittedParameter',start:id.start,end:id.end};replace.set(value,'(void 0)');members.set(id.name,{value,id,kind:'const'});initializers.push(id.name);}
  for(const statement of body.slice(0,-1)){
   const assignment=statement.type==='ExpressionStatement'?statement.expression:null;
   const entries=statement.type==='VariableDeclaration'?statement.declarations.map(d=>[d.id,d.init,statement.kind]):statement.type==='FunctionDeclaration'?[[statement.id,statement,'function']]:assignment?.type==='AssignmentExpression'&&assignment.operator==='='?[[assignment.left,assignment.right,'implicit']]:[];
   if(!entries.length){valid=false;break;}
   for(const [id,value,kind]of entries){
    if(id?.type!=='Identifier'||!value||members.has(id.name)||kind==='implicit'&&(!functions.has(value.type)||bindings.has(id))){valid=false;break;}
    members.set(id.name,{value,id,kind});initializers.push(id.name);
   }
  }
  if(!valid)continue;
  const fields=new Map();
  for(const p of ret.argument.properties){
   if(p.type!=='Property'||p.computed||p.kind!=='init'||fields.has(key(p))||key(p)==='__proto__'){valid=false;break;}
   if(p.value.type==='Literal'){
    const name=fresh('literalField');
    members.set(name,{value:p.value,id:{type:'Identifier',name},kind:'const'});
    initializers.push(name);fields.set(key(p),name);
   }else if(p.value.type==='Identifier'&&members.has(p.value.name))fields.set(key(p),p.value.name);
   else {valid=false;break;}
  }
  const binding=bindings.get(factory.id);
  if(!valid||!binding||binding.writes.length||binding.refs.length!==1||nodes.filter(n=>n.type==='FunctionDeclaration'&&bindings.get(n.id)===binding).length!==1)continue;
  const call=parents.get(binding.refs[0]),d=parents.get(call),decl=parents.get(d);
  if(!['CallExpression','NewExpression'].includes(call?.type)||call.optional||call.callee!==binding.refs[0]||call.arguments.length||d?.type!=='VariableDeclarator'||d.id.type!=='Identifier'||d.init!==call||decl?.type!=='VariableDeclaration'||decl.declarations.length!==1||parents.get(decl)!==tree)continue;
  const instance=bindings.get(d.id),outside=[],used=new Set(),dataOutside=[],dataFields=new Set();
  if(!instance?.refs.length||instance.writes.length||nodes.filter(n=>n.type==='VariableDeclarator'&&bindings.get(n.id)===instance).length!==1)continue;
  const first=tree.body.filter(n=>!['FunctionDeclaration','EmptyStatement'].includes(n.type))[0]===decl;
  const selectedFunction=member=>{
   let node=member,p=parents.get(node);while(p?.type==='ConditionalExpression'&&(p.consequent===node||p.alternate===node)){node=p;p=parents.get(node);}
   if(p?.type!=='VariableDeclarator'||p.init!==node||p.id.type!=='Identifier')return false;
   const b=bindings.get(p.id);return !!b&&!b.writes.length&&b.refs.length>0&&b.refs.every(r=>{const c=parents.get(r);return c?.type==='CallExpression'&&c.callee===r&&!c.optional;});
  };
  for(const r of instance.refs){
   const member=parents.get(r),use=parents.get(member),name=fields.get(property(member)),value=members.get(name)?.value;
   if(member?.type==='MemberExpression'&&member.object===r&&!member.optional&&!name&&typeof property(member)==='string'&&
      !['__proto__','prototype','constructor',...Object.getOwnPropertyNames(Object.prototype)].includes(property(member))&&
      r.start>=decl.end&&initializedAfter(ix,decl,r)&&!(use?.operator==='delete')&&!(use?.type==='CallExpression'&&use.callee===member)){
    dataFields.add(property(member));dataOutside.push([member,property(member)]);continue;
   }
   if(member?.type!=='MemberExpression'||member.object!==r||member.optional||!name||functions.has(value.type)&&!selectedFunction(member)&&(use?.type!=='CallExpression'||use.callee!==member||use.optional)||r.start<decl.end||!initializedAfter(ix,decl,r)||use?.type==='AssignmentExpression'&&use.left===member||use?.type==='UpdateExpression'||use?.operator==='delete'){valid=false;break;}
   outside.push([member,name]);used.add(name);
  }
  // Extra own data slots start as undefined only while Object.prototype is
  // unobserved. Native eval itself is not a platform API or an incompatibility.
  if(dataFields.size&&nodes.some(n=>n.type==='MemberExpression'&&free(n.object,'Object')&&property(n)==='prototype'))valid=false;
  // Implicit function assignments are observable globals. Admit only direct
  // calls proven to follow initialization; never erase external writes/aliases.
  for(const [name,{kind}]of members)if(kind==='implicit')for(const n of nodes)if(free(n,name)&&(n.start<factory.start||n.end>factory.end)){
   const p=parents.get(n);if(p?.type!=='CallExpression'||p.callee!==n||n.start<decl.end||!initializedAfter(ix,decl,n)){valid=false;break;}
   used.add(name);external.push([n,name]);
  }
  // Preserve all non-function initializers, including their side effects. Only
  // function creation is inert and may disappear when no live member needs it.
  for(const [name,{value}]of members)if(!functions.has(value.type))used.add(name);
  const queue=[...used];
  while(valid&&queue.length){
   const name=queue.shift(),{value}=members.get(name),local=index(value);
   for(const n of local.nodes){
    const dependency=n.type==='Identifier'&&local.free(n)&&members.get(n.name);
    if(dependency&&bindings.get(n)===bindings.get(dependency.id)&&!used.has(n.name)){used.add(n.name);queue.push(n.name);}
    if(local.free(n,'arguments')||n.type==='Super'||n.type==='MetaProperty'){valid=false;break;}
    if(n.type==='ThisExpression'){
     const m=local.parents.get(n),p=local.parents.get(m),api=property(m);
     let receiver=local.parents.get(n);while(receiver&&(!functions.has(receiver.type)||receiver.type==='ArrowFunctionExpression'))receiver=local.parents.get(receiver);
     if(receiver||value.type!=='ArrowFunctionExpression'||m?.type!=='MemberExpression'||m.object!==n||!['$httpClient','$task'].includes(api)){valid=false;break;}
     if(p?.type==='UnaryExpression'&&p.operator==='typeof')probes.push([m,api]);
     else if(p?.type==='BinaryExpression'&&['===','!==','==','!='].includes(p.operator)){
      const other=p.left===m?p.right:p.left;
      if(other.type!=='Identifier'||other.name!=='undefined'||!local.free(other)){valid=false;break;}
      probes.push([p,`typeof ${api} ${p.operator} "undefined"`]);
     }else{valid=false;break;}
    }
   }
  }
  if(!valid)continue;
  const ids=new Map([...used].map(name=>[name,fresh('env_'+name)]));
  const stateIds=new Map([...dataFields].map(name=>[name,fresh('env_'+name)]));
  for(const [name,id]of ids)if(functions.has(members.get(name).value.type))generated.add(id);
  for(const [node,text]of probes)replace.set(node,text);
  for(const name of used){const {value}=members.get(name),local=index(value);for(const n of local.nodes)if(n.type==='Identifier'&&ix.reference(n)&&ids.has(n.name)&&bindings.get(n)===bindings.get(members.get(n.name).id))replace.set(n,ids.get(n.name));}
  for(const [n,name]of [...outside,...external])replace.set(n,ids.get(name));
  for(const [n,name]of dataOutside)replace.set(n,stateIds.get(name));
  removed.add(factory);
  replace.set(decl,()=>(stateIds.size?'let '+[...stateIds.values()].join(', ')+';\n':'')+initializers.filter(name=>used.has(name)).map(name=>{
   const {value,kind}=members.get(name);
   if(kind==='function'){replace.set(value.id,ids.get(name));return render(value);}
   return `${kind==='implicit'?'const':kind} ${ids.get(name)} = (${render(value)});`;
  }).join('\n'));
 }
 function render(root){return renderTree(source,root,n=>{if(removed.has(n))return {direct:true,value:''};const r=replace.get(n);return r===undefined?null:{direct:true,value:typeof r==='function'?r():r};});}
 return render(tree);
}

// An immediately invoked, anonymous closure has the same closed construction
// contract as the named factory handled above. Give only that unobservable
// allocation a fresh name; preserve its scope and the original invocation point.
function nameClosedFactoryExpressions(source){
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree),replace=new WeakMap();
 if(tree.body.some(n=>n.directive==='use strict'))return source;
 const names=new Set(ix.nodes.filter(n=>n.type==='Identifier').map(n=>n.name));
 const fresh=()=>{let name='createClosedEnv',i=2;while(names.has(name))name='createClosedEnv'+i++;names.add(name);return name;};
 for(const declaration of tree.body){
  if(declaration.type!=='VariableDeclaration'||declaration.declarations.length!==1)continue;
  const d=declaration.declarations[0],call=d.init,fn=call?.callee;
  if(d.id.type!=='Identifier'||call?.type!=='CallExpression'||call.optional||call.arguments.length||!['ArrowFunctionExpression','FunctionExpression'].includes(fn?.type)||fn.id||fn.async||fn.generator||fn.params.length||fn.body.type!=='BlockStatement')continue;
  const last=fn.body.body.at(-1);if(fn.body.body.length<2||last?.type!=='ReturnStatement'||last.argument?.type!=='ObjectExpression')continue;
  const local=index(fn);
  if(local.nodes.some(n=>n.type==='ThisExpression'||n.type==='Super'||n.type==='MetaProperty'||local.free(n,'arguments')||local.free(n,'eval')))continue;
  const name=fresh(),start=source.slice(declaration.start,d.init.start),end=source.slice(d.init.end,declaration.end);
  replace.set(declaration,`function ${name}() ${source.slice(fn.body.start,fn.body.end)}\n${start}${name}()${end}`);
 }
 return renderTree(source,tree,n=>replace.has(n)?{direct:true,value:replace.get(n)}:null);
}

// Classic script top-level/arrow this is the host global. Only explicit message
// property reads qualify; normal function receivers and strict scripts do not.
export function lowerGlobalMessages(source){
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree);
 if(tree.body.some(n=>n.directive==='use strict'))return source;
 const replace=new WeakMap();
 for(const n of ix.nodes)if(n.type==='ThisExpression'){
  let owner=ix.parents.get(n);while(owner&&(!functions.has(owner.type)||owner.type==='ArrowFunctionExpression'))owner=ix.parents.get(owner);
  const m=ix.parents.get(n),use=ix.parents.get(m),name=property(m);
  if(owner||m?.type!=='MemberExpression'||m.object!==n||!['$request','$response'].includes(name)||use?.type==='AssignmentExpression'&&use.left===m||use?.type==='UpdateExpression'||use?.operator==='delete')continue;
  if(ix.nodes.some(x=>ix.free(x,name)&&ix.parents.get(x)?.type==='AssignmentExpression'&&ix.parents.get(x).left===x))continue;
  replace.set(m,name);
 }
 return renderTree(source,tree,n=>replace.has(n)?{direct:true,value:replace.get(n)}:null);
}

// Localize an authored singleton installed by one sloppy root assignment. This
// never declares a proxy-platform API, and all consumers must follow the write.
export function lowerImplicitInstances(source){
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree),replace=new WeakMap();
 if(tree.body.some(n=>n.directive==='use strict'))return source;
 for(const statement of tree.body){
  const a=statement.type==='ExpressionStatement'?statement.expression:null;
  if(a?.type!=='AssignmentExpression'||a.operator!=='='||!ix.free(a.left)||!['CallExpression','NewExpression'].includes(a.right.type)||a.right.callee.type!=='Identifier')continue;
  const name=a.left.name,factory=ix.bindings.get(a.right.callee),fn=factory?.fn;
  if(name!=='$'&&!/^[a-zA-Z_]\w*$/.test(name)||['globalThis','global','window','Object','Array','JSON','Date','Math','console','undefined','NaN','Infinity','module','exports','process'].includes(name)||!fn||factory.writes.length||fn.body.body.at(-1)?.type!=='ReturnStatement')continue;
  const refs=ix.nodes.filter(n=>ix.free(n,name)&&n!==a.left);
  if(refs.some(r=>{const p=ix.parents.get(r);return p?.type!=='MemberExpression'||p.object!==r||!initializedAfter(ix,statement,r);}))continue;
  replace.set(statement,'const '+name+' = '+source.slice(a.right.start,a.right.end)+';');
 }
 return renderTree(source,tree,n=>replace.has(n)?{direct:true,value:replace.get(n)}:null);
}

// 折叠封闭本地实例上“只写一次且写入无条件先于全部读取”的字面量字段。
// 目的只是暴露由该常量决定的不可达分支，让后续原生证明可以删除与目标宿主
// 无关的代码（例如 `if (instance.merge) instance.msg = ...`）。实例必须由
// 本地构造函数创建且从不整体逃逸；构造函数不能安装同名访问器、改写原型或
// 返回对象，否则字段写入不一定是普通数据属性。任何额外写入、条件写入或
// 读取先于写入都保持原样，继续走失败关闭路径。
export function lowerClosedInstanceLiteralFields(source){
 let tree,ix;
 try{tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true});ix=index(tree);}
 catch{return source;}
 const {nodes,parents,bindings}=ix,replace=new WeakMap(),UNKNOWN=Symbol('not a closed literal');let changed=false;
 const staticField=n=>n?.type==='MemberExpression'?!n.computed&&n.property.type==='Identifier'?n.property.name:n.computed&&n.property.type==='Literal'&&typeof n.property.value==='string'?n.property.value:undefined:undefined;
 const inertLiteral=n=>{
  if(!n)return UNKNOWN;
  if(n.type==='Literal')return n.regex?UNKNOWN:{value:n.value};
  if(n.type==='TemplateLiteral'&&!n.expressions.length&&n.quasis.length===1)return {value:n.quasis[0].value.cooked};
  if(n.type==='Identifier'&&ix.free(n,'undefined'))return {value:undefined};
  if(n.type==='UnaryExpression'){
   const inner=inertLiteral(n.argument);if(inner===UNKNOWN)return UNKNOWN;
   if(n.operator==='void')return {value:undefined};
   if(['!','+','-','~'].includes(n.operator)&&(['string','number','boolean'].includes(typeof inner.value)||inner.value===null)){
    try{return {value:n.operator==='!'?!inner.value:n.operator==='+'?+inner.value:n.operator==='-'?-inner.value:~inner.value};}catch{return UNKNOWN;}
   }
  }
  return UNKNOWN;
 };
 const written=member=>{const use=parents.get(member);return use?.type==='AssignmentExpression'&&use.left===member||use?.type==='UpdateExpression'||use?.type==='UnaryExpression'&&use.operator==='delete'&&use.argument===member;};
 const unsafeInstanceMember=new Set(['__proto__','prototype','constructor','__defineGetter__','__defineSetter__']);
 const constructorRegions=ctor=>ctor.type==='ClassDeclaration'||ctor.type==='ClassExpression'
  ?ctor.body.body.map(member=>member.value).filter(Boolean)
  :[ctor];
 // 构造过程不得把 this 整体交给未知代码，也不得通过原型/访问器机制改变字段属性；
 // 实例方法同样在区域内，任何 `this.<field>` 写入都会在字段级检查中否决折叠。
 const constructorSafe=ctor=>{
  if(!ctor)return false;
  let constructorMethod=null;
  if(ctor.type==='ClassDeclaration'||ctor.type==='ClassExpression'){
   if(ctor.superClass)return false;
   if(!ctor.body.body.every(member=>member.type==='MethodDefinition'&&!member.static&&!member.computed&&member.kind==='method'||member.type==='PropertyDefinition'&&!member.static&&!member.computed&&(member.value==null||inertLiteral(member.value)!==UNKNOWN)))return false;
   constructorMethod=ctor.body.body.find(member=>member.type==='MethodDefinition'&&member.kind==='constructor')?.value??null;
  }else{
   if(ctor.type!=='FunctionDeclaration'&&ctor.type!=='FunctionExpression')return false;
   if(ctor.async||ctor.generator||ctor.body.type!=='BlockStatement')return false;
   constructorMethod=ctor;
  }
  for(const region of constructorRegions(ctor)){
   for(const n of index(region).nodes){
    if(n.type==='ReturnStatement'&&n.argument&&ix.owners.get(n)===constructorMethod)return false;
    if(n.type==='MemberExpression'&&unsafeInstanceMember.has(staticField(n)))return false;
    if(n.type==='ThisExpression'){
     const use=parents.get(n);
     if(use?.type!=='MemberExpression'||use.object!==n||use.optional||staticField(use)===undefined||unsafeInstanceMember.has(staticField(use)))return false;
    }
   }
  }
  return true;
 };
 const constructionSafe=binding=>binding.refs.length>0&&binding.refs.every(ref=>{
  const use=parents.get(ref);
  return use?.type==='NewExpression'&&use.callee===ref&&!use.optional;
 });
 const methodWritesField=(ctor,name)=>constructorRegions(ctor).some(region=>index(region).nodes.some(n=>
  n.type==='MemberExpression'&&n.object.type==='ThisExpression'&&!n.optional&&staticField(n)===name&&written(n)));
 for(const declaration of nodes){
  if(declaration.type!=='VariableDeclarator'||declaration.id.type!=='Identifier'||declaration.init?.type!=='NewExpression'||declaration.init.callee.type!=='Identifier')continue;
  const callee=bindings.get(declaration.init.callee),ctor=callee?.fn??callee?.init;
  if(!callee||callee.writes.length||!constructionSafe(callee)||!constructorSafe(ctor))continue;
  const instance=bindings.get(declaration.id);
  if(!instance||instance.writes.length||nodes.filter(n=>n.type==='VariableDeclarator'&&bindings.get(n.id)===instance).length!==1)continue;
  const statement=parents.get(declaration),block=parents.get(statement),owner=ix.owners.get(statement);
  if(!statement||!['Program','BlockStatement'].includes(block?.type))continue;
  const members=[];let closed=true;
  for(const ref of instance.refs){
   const member=parents.get(ref);
   if(member?.type!=='MemberExpression'||member.object!==ref||member.optional||staticField(member)===undefined){closed=false;break;}
   members.push(member);
  }
  if(!closed)continue;
  const fields=new Map();
  for(const member of members){const name=staticField(member);if(!fields.has(name))fields.set(name,[]);fields.get(name).push(member);}
  for(const [name,accesses] of fields){
   const writes=accesses.filter(written);
   if(writes.length!==1)continue;
   const write=writes[0],assignment=parents.get(write),writeStatement=parents.get(assignment);
   if(assignment?.type!=='AssignmentExpression'||assignment.operator!=='='||assignment.left!==write)continue;
   if(writeStatement?.type!=='ExpressionStatement'||parents.get(writeStatement)!==block||writeStatement.start<statement.end)continue;
   if(ix.owners.get(write)!==owner)continue;
   if(methodWritesField(ctor,name))continue;
   const literal=inertLiteral(assignment.right);
   if(literal===UNKNOWN)continue;
   const reads=accesses.filter(member=>member!==write);
   if(!reads.length||reads.some(member=>member.start<assignment.end||ix.owners.get(member)!==owner))continue;
   const replacement=source.slice(assignment.right.start,assignment.right.end);
   for(const member of reads){
    const use=parents.get(member);
    if(use?.type==='IfStatement'&&use.test===member){
     const branch=literal.value?use.consequent:use.alternate;
     replace.set(use,branch?{children:[branch],render:child=>child(branch)}:{direct:true,value:';'});changed=true;
    }else if(use?.type==='ConditionalExpression'&&use.test===member){
     const branch=literal.value?use.consequent:use.alternate;
     replace.set(use,{children:[branch],render:child=>child(branch)});changed=true;
    }else{replace.set(member,replacement);changed=true;}
   }
  }
 }
 if(!changed)return source;
 return renderTree(source,tree,n=>{
  if(!replace.has(n))return null;
  const value=replace.get(n);
  return typeof value==='string'?{direct:true,value}:value;
 });
}

// Scalar replacement of a closed SDK instance. Ordinary captured state stays
// ordinary JS; only reachable methods are retained for native API compilation.
export function lowerStatefulFactories(source,generated=new Set()){
 // Retain initializer order and lexical scope while exposing each allocation
 // in a multi-declarator statement to the existing closed-instance proof.
 {
  const initial=index(parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}));
  source=renderTree(source,initial.nodes[0],n=>n.type==='VariableDeclaration'&&n.declarations.length>1&&n.declarations.some(d=>d.init?.type==='NewExpression')&&['Program','BlockStatement'].includes(initial.parents.get(n)?.type)?{children:n.declarations,render:child=>n.declarations.map(d=>n.kind+' '+child(d)+';').join('\n')}:null);
 }
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree),replace=new WeakMap(),removed=new WeakSet();
 const {nodes,parents,bindings,owners}=ix,names=new Set(nodes.filter(n=>n.type==='Identifier').map(n=>n.name));
 const fresh=base=>{let n=base,i=2;while(names.has(n))n=base+i++;names.add(n);return n;};
 for(const factory of nodes.filter(n=>n.type==='FunctionDeclaration'&&!n.async&&!n.generator)){
  const returned=factory.body.body.at(-1),constructed=returned?.type==='ReturnStatement'?returned.argument:null;
  const cls=constructed?.type==='NewExpression'&&constructed.callee.type==='ClassExpression'?constructed.callee:null;
  // Class factories may contain helper declarations. They are kept inside the
  // constructor initializer and only admitted when no method captures them.
  if(cls&&(cls.superClass||cls.body.body.some(m=>!['MethodDefinition','PropertyDefinition'].includes(m.type)||m.static||m.computed||m.type==='MethodDefinition'&&!['method','constructor'].includes(m.kind))))continue;
  const helpers=cls?factory.body.body.slice(0,-1):[];
  if(helpers.some(n=>!['VariableDeclaration','FunctionDeclaration','ClassDeclaration'].includes(n.type)&&!(n.type==='ExpressionStatement'&&literalExpression(n.expression))))continue;
  const ctor=cls?.body.body.find(m=>m.kind==='constructor')?.value??(!cls?factory:null);
  if(!ctor)continue;
  const methods=new Map(),initials=[];
  let valid=true;
  if(cls){for(const m of cls.body.body)if(m.kind==='method')methods.set(key(m),m.value);
   if(new Set(cls.body.body.map(key)).size!==cls.body.body.length||cls.body.body.some(m=>m.type==='PropertyDefinition'&&(!m.value||index(m.value).nodes.some(n=>n.type==='ThisExpression'||n.type==='Super'||n.type==='MetaProperty'))))continue;
  }
  else{
   // Old Env constructors install arrow methods through assignments. No
   // prototype, return override, getter or dynamic installation is permitted.
   const expressions=ctor.body.body.flatMap(s=>s.type==='ExpressionStatement'?(s.expression.type==='SequenceExpression'?s.expression.expressions:[s.expression]):[]);
   if(ctor.body.body.some(s=>s.type!=='ExpressionStatement'))continue;
   for(const e of expressions){
    if(e.type!=='AssignmentExpression'||e.operator!=='='||e.left.type!=='MemberExpression'||e.left.object.type!=='ThisExpression'||property(e.left)===undefined){valid=false;break;}
    if(functions.has(e.right.type)){if(e.right.type!=='ArrowFunctionExpression'||methods.has(property(e.left))){valid=false;break;}methods.set(property(e.left),e.right);}
    else initials.push(e);
   }
   if(!methods.size)continue;
   const installed=[...methods.keys(),...initials.map(e=>property(e.left))];
   if(installed.some(k=>['__proto__','prototype','constructor'].includes(k))||new Set(installed).size!==installed.length)continue;
  }
  const binding=bindings.get(factory.id);
  if(!valid||!binding||binding.writes.length||binding.refs.length!==1||nodes.filter(n=>n.type==='FunctionDeclaration'&&bindings.get(n.id)===binding).length!==1)continue;
  const call=parents.get(binding.refs[0]),d=parents.get(call),decl=parents.get(d);
  if(!(call?.type==='NewExpression'||cls&&call?.type==='CallExpression')||call.callee!==binding.refs[0]||call.arguments.some(a=>a.type==='SpreadElement')||d?.type!=='VariableDeclarator'||d.id.type!=='Identifier'||d.init!==call||decl?.type!=='VariableDeclaration'||decl.declarations.length!==1||parents.get(decl)!==tree)continue;
  const instance=bindings.get(d.id),outside=[],used=new Set(),fields=new Set();
  if(!instance?.refs.length||instance.writes.length||nodes.filter(n=>n.type==='VariableDeclarator'&&bindings.get(n.id)===instance).length!==1)continue;
  const first=tree.body.filter(n=>!['FunctionDeclaration','EmptyStatement'].includes(n.type))[0]===decl;
  for(const r of instance.refs){
   if(r.start>=factory.start&&r.end<=factory.end)continue;
   const m=parents.get(r),use=parents.get(m),name=property(m);
   if(m?.type!=='MemberExpression'||m.object!==r||m.optional||name===undefined||name==='__proto__'||r.start<decl.end||!initializedAfter(ix,decl,r)){valid=false;break;}
   if(methods.has(name)){
    if(use?.type!=='CallExpression'||use.callee!==m||use.optional){valid=false;break;}
    used.add(name);
   }else fields.add(name);
   outside.push([m,name]);
  }
  if(cls)for(const m of cls.body.body)if(m.type==='PropertyDefinition')fields.add(key(m));
  const rewrites=[],skipped=new WeakSet(),queue=[...used,ctor].map(n=>typeof n==='string'?methods.get(n):n),visited=new Set();
  while(valid&&queue.length){
   const fn=queue.shift();if(visited.has(fn))continue;if(fn===ctor&&queue.length){queue.push(fn);continue;}visited.add(fn);
   const local=index(fn);
   if(instance.refs.some(r=>r.start>=fn.start&&r.end<=fn.end)){valid=false;break;}
   if(cls&&fn===ctor){
    const usedFields=new Set(fields);
    for(const method of [...used].map(name=>methods.get(name)))for(const n of index(method).nodes)if(n.type==='MemberExpression'&&n.object.type==='ThisExpression')usedFields.add(property(n));
    for(const e of local.nodes)if(e.type==='AssignmentExpression'&&e.operator==='='&&e.left.type==='MemberExpression'&&e.left.object.type==='ThisExpression'&&!usedFields.has(property(e.left))&&inertFactoryCall(ix,e.right))skipped.add(e);
    for(const e of local.nodes)if(e.type==='AssignmentExpression'&&e.operator==='='&&e.left.type==='MemberExpression'&&e.left.object.type==='ThisExpression'&&!usedFields.has(property(e.left))&&e.right.type==='NewExpression'&&e.right.callee.type==='Identifier'){
     const helper=helpers.find(h=>h.type==='ClassDeclaration'&&bindings.get(h.id)===bindings.get(e.right.callee));
     const construction=helper?.body.body.find(m=>m.kind==='constructor');
     if(helper&&!helper.superClass&&helper.body.body.every(m=>m.type==='MethodDefinition'&&!m.computed&&!m.static&&['method','constructor'].includes(m.kind))&&construction&&construction.value.params.every(p=>p.type==='Identifier')&&construction.value.body.body.every(s=>s.type==='ExpressionStatement'&&s.expression.type==='AssignmentExpression'&&s.expression.operator==='='&&s.expression.left.type==='MemberExpression'&&s.expression.left.object.type==='ThisExpression'&&property(s.expression.left)!==undefined&&!['__proto__','prototype','constructor'].includes(property(s.expression.left))&&s.expression.right.type==='Identifier'&&construction.value.params.some(p=>bindings.get(p)===bindings.get(s.expression.right)))&&e.right.arguments.every(a=>a.type==='ThisExpression'))skipped.add(e);
    }
    // Object.assign(this, options) is inert for omitted/nullish options. Other
    // options may override methods, so they require a separate field proof.
    for(const e of local.nodes)if(e.type==='CallExpression'&&e.callee.type==='MemberExpression'&&ix.free(e.callee.object,'Object')&&property(e.callee)==='assign'&&e.arguments.length===2&&e.arguments[0].type==='ThisExpression'){
     const arg=e.arguments[1],position=ctor.params.findIndex(p=>bindings.get(p.type==='AssignmentPattern'?p.left:p)===bindings.get(arg)),actual=factoryArgument(ix,factory,call,constructed,ctor,position);
     if(position>=0&&(!actual||actual.type==='Literal'&&actual.value===null||actual.type==='ObjectExpression'&&!actual.properties.length))skipped.add(e);
     else valid=false;
    }
   }
   for(const n of local.nodes){
    let skip=n;while(skip&&!skipped.has(skip))skip=local.parents.get(skip);if(skip)continue;
    if(local.free(n,'arguments')||n.type==='Super'||n.type==='MetaProperty'){valid=false;break;}
    if(n.type!=='ThisExpression')continue;
    // Ignore installed unused arrow bodies while scanning an old constructor.
    if(!cls&&fn===ctor){let parent=n;while(parent&&parent!==ctor&&!functions.has(parent.type))parent=local.parents.get(parent);if(parent!==ctor)continue;}
    let receiver=local.parents.get(n);while(receiver&&(!functions.has(receiver.type)||receiver.type==='ArrowFunctionExpression'))receiver=local.parents.get(receiver);
    if(cls&&receiver&&receiver!==fn&&local.parents.get(receiver)?.type!=='MethodDefinition')continue;
    const m=local.parents.get(n),use=local.parents.get(m),name=property(m);
    if(receiver!==fn&&!(fn.type==='ArrowFunctionExpression'&&receiver===null)||m?.type!=='MemberExpression'||m.object!==n||m.optional||name===undefined||name==='__proto__'){valid=false;break;}
    if(methods.has(name)){
     // Installing methods is constructor bookkeeping, removed after proof.
     if(!cls&&fn===ctor&&use?.type==='AssignmentExpression'&&use.left===m)continue;
     if(use?.type!=='CallExpression'||use.callee!==m||use.optional){valid=false;break;}
     if(!used.has(name)){used.add(name);queue.push(methods.get(name));}
    }else fields.add(name);
    rewrites.push([m,name]);
   }
  }
  if(!valid)continue;
  if(factory.params.some(p=>p.type!=='Identifier'&&!(p.type==='AssignmentPattern'&&p.left.type==='Identifier')))continue;
  const captures=factory.params.map(p=>p.type==='AssignmentPattern'?p.left:p);
  const patternIds=p=>p?.type==='Identifier'?[p]:p?.type==='AssignmentPattern'?patternIds(p.left):p?.type==='ObjectPattern'?p.properties.flatMap(v=>patternIds(v.type==='RestElement'?v.argument:v.value)):p?.type==='ArrayPattern'?p.elements.flatMap(patternIds):p?.type==='RestElement'?patternIds(p.argument):[];
  const helperIds=helpers.flatMap(h=>h.type==='VariableDeclaration'?h.declarations.flatMap(d=>patternIds(d.id)):h.type==='ExpressionStatement'?[]:[h.id]);
  if(helperIds.some(id=>id?.type!=='Identifier'))continue;
  if(cls)for(const fn of nodes)if(fn.type==='FunctionExpression'&&fn.start>=cls.start&&fn.end<=cls.end&&fn.params.every(p=>p.type==='Identifier')){
   const assignment=parents.get(fn),left=assignment?.left;
   if(assignment?.type==='AssignmentExpression'&&assignment.right===fn&&left?.type==='MemberExpression'&&left.object.type==='MemberExpression'&&ix.free(left.object.object,'Object')&&property(left.object)==='prototype'&&!fn.body.body.some(s=>s.directive==='use strict'))replace.set(fn.body,()=>'{"use strict";'+patch(source,fn.body,render).slice(1));
  }
  for(const id of [...captures,...helperIds]){const b=bindings.get(id),name=fresh('factory_'+id.name);replace.set(id,name);for(const r of b.refs)replace.set(r,name);}
  const ids=new Map([...new Set([...fields,...used])].map(n=>[n,fresh('state_'+String(n).replace(/\W/g,'_'))])),init=fresh('initializeState');
  for(const id of ids.values())generated.add(id);
  for(const [m,name]of [...outside,...rewrites])replace.set(m,ids.get(name));
  generated.add(init);
  for(const e of index(ctor).nodes)if(skipped.has(e))replace.set(e,'void 0');
  removed.add(factory);
  replace.set(decl,()=>{
   const captureCode=captures.length?`let [${factory.params.map(render).join(', ')}] = [${call.arguments.map(render).join(', ')}];\n`:'';
   const helperCode=helpers.filter(h=>h.type!=='ClassDeclaration'||nodes.some(n=>ix.reference(n)&&bindings.get(n)===bindings.get(h.id)&&n.start>=cls.start&&n.end<=cls.end&&!([...index(ctor).nodes].some(e=>skipped.has(e)&&n.start>=e.start&&n.end<=e.end)))) .map(render).join('\n');
   const declarations=fields.size?'let '+[...fields].map(n=>ids.get(n)).join(', ')+';\n':'';
   const methodCode=[...used].map(name=>{const fn=methods.get(name);return `const ${ids.get(name)} = ${fn.async?'async ':''}(${fn.params.map(render).join(', ')}) => ${render(fn.body)};`;}).join('\n');
   const fieldCode=cls?cls.body.body.filter(m=>m.type==='PropertyDefinition').map(m=>ids.get(key(m))+' = '+render(m.value)+';').join('\n'):'';
   const body=cls?'{'+fieldCode+render(ctor.body).slice(1):'{'+initials.map(e=>render(e)+';').join('\n')+'}';
   const args=cls?constructed.arguments.map(render).join(', '):'';
   return captureCode+helperCode+'\n'+declarations+methodCode+`\nconst ${init} = (${cls?ctor.params.map(render).join(', '):''}) => ${body};\n${init}(${args});`;
  });

 }
 function render(root){return renderTree(source,root,n=>{if(removed.has(n))return {direct:true,value:''};if(!replace.has(n))return null;const value=replace.get(n);return {direct:true,value:typeof value==='function'?value():value};});}
 return render(tree);
}

// Remove only compiler-generated, inert function declarations whose closed
// call graph has no live incoming reference. Upstream functions stay diagnosed.
export function pruneGeneratedFunctions(source,names,entrySpecialized=false){
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree),defs=new Map(),byFunction=new Map();
 const counts=new Map();for(const n of ix.nodes)if(['VariableDeclarator','FunctionDeclaration','ClassDeclaration'].includes(n.type)){const b=ix.bindings.get(n.id);if(b)counts.set(b,(counts.get(b)??0)+1);}
 for(const n of ix.nodes){
  const inertClass=entrySpecialized&&n.type==='ClassDeclaration'&&!n.superClass&&n.body.body.every(m=>m.type==='MethodDefinition'&&!m.computed);
  const id=n.type==='FunctionDeclaration'||inertClass?n.id:n.type==='VariableDeclarator'&&functions.has(n.init?.type)?n.id:null;
  if(id?.type!=='Identifier'||!(names.has(id.name)||entrySpecialized))continue;
  const b=ix.bindings.get(id),fn=n.type==='FunctionDeclaration'||inertClass?n:n.init;
  if(!b||b.writes.length||counts.get(b)!==1)continue;
  defs.set(b,{node:n,fn});byFunction.set(fn,b);
 }
 const evaluated=evaluationBindings(ix,source),live=new Set([...evaluated].filter(b=>defs.has(b)&&!names.has(b.name))),edges=new Map();
 for(const [b]of defs)for(const r of b.refs){
  let owner=ix.parents.get(r);while(owner&&owner!==tree&&!byFunction.has(owner))owner=ix.parents.get(owner);
  if(owner===tree)live.add(b);
  else{const parent=byFunction.get(owner);if(!edges.has(parent))edges.set(parent,new Set());edges.get(parent).add(b);}
 }
 const queue=[...live];while(queue.length)for(const b of edges.get(queue.shift())??[])if(!live.has(b)){live.add(b);queue.push(b);}
 const removed=new WeakSet([...defs].filter(([b])=>!live.has(b)).map(([,d])=>d.node)),inertWrites=new WeakSet();
 for(const n of ix.nodes)if(n.type==='VariableDeclarator'&&n.id.type==='Identifier'&&!n.init&&names.has(n.id.name)){
  const b=ix.bindings.get(n.id),w=b?.writes[0];
  if(evaluated.has(b)||counts.get(b)!==1||b.writes.length!==1||b.refs.length!==1||w.type!=='AssignmentExpression'||w.operator!=='='||w.left!==b.refs[0]||!inertFactoryCall(ix,w.right))continue;
  // Removing an assignment value is safe only where its result is discarded.
  let parent=w,discarded=false;
  while(ix.parents.get(parent)?.type==='SequenceExpression'){const sequence=ix.parents.get(parent);if(sequence.expressions.at(-1)!==parent){discarded=true;break;}parent=sequence;}
  if(!discarded&&ix.parents.get(parent)?.type!=='ExpressionStatement')continue;
  inertWrites.add(w);removed.add(n);
 }
 function render(root){return renderTree(source,root,n=>{
  if(removed.has(n))return {direct:true,value:''};
  if(inertWrites.has(n))return {direct:true,value:'void 0'};
  if(n.type==='VariableDeclaration'&&n.declarations.some(d=>removed.has(d))){const keep=n.declarations.filter(d=>!removed.has(d));return keep.length?{children:keep,render:child=>n.kind+' '+keep.map(child).join(', ')+';'}:{direct:true,value:''};}
  return null;
 });}
 return render(tree);
}
