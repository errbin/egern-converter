import {functions,property,key,index,initializedAfter} from '../core/ast.mjs';

// Bounded value provenance for closed local calls. This is not execution of
// input JavaScript: only successful standard string operations are inferred.

export function valueFacts(ix){
 const {nodes,parents,bindings,owners,free}=ix;
 const jsonPatterns=new Map(),regexCaptures=new Set(),memberWrites=new Map();
 for(const n of nodes)if(n.type==='AssignmentExpression'&&n.operator==='='&&n.left.type==='MemberExpression'&&
   n.left.object.type==='Identifier'&&property(n.left)!==undefined){
  const receiver=bindings.get(n.left.object);if(!receiver)continue;
  let fields=memberWrites.get(receiver);if(!fields)memberWrites.set(receiver,fields=new Map());
  const name=String(property(n.left));if(!fields.has(name))fields.set(name,[]);fields.get(name).push(n.right);
 }
 for(const d of nodes)if(d.type==='VariableDeclarator'){
  if(d.id.type==='ObjectPattern')for(const p of d.id.properties){
   const value=p.type==='Property'&&p.kind==='init'&&!p.computed?p.value:null;
   const binding=value?.type==='Identifier'?bindings.get(value):null;
   if(binding){if(!jsonPatterns.has(binding))jsonPatterns.set(binding,[]);jsonPatterns.get(binding).push(d);}
  }
  if(d.id.type==='ArrayPattern'&&d.init?.type==='CallExpression'&&d.init.callee.type==='MemberExpression'&&
    d.init.callee.object.regex&&property(d.init.callee)==='exec')for(const [i,element]of d.id.elements.entries())
     if(i>0&&element?.type==='Identifier')regexCaptures.add(bindings.get(element));
 }
 const counts=new Map(),parameters=new Map();
 const hasDynamicEval=nodes.some(n=>free(n,'eval'));
 for(const fn of nodes.filter(n=>functions.has(n.type)))fn.params.forEach((p,i)=>{if(p.type==='Identifier')parameters.set(bindings.get(p),{fn,position:i});});
 for(const n of nodes)if(n.type==='VariableDeclarator'||n.type==='FunctionDeclaration'){
  const b=bindings.get(n.id);if(b)counts.set(b,(counts.get(b)||0)+1);
 }
 const write=n=>{const p=parents.get(n);return p?.type==='AssignmentExpression'&&p.left===n||p?.type==='UpdateExpression'||p?.operator==='delete';};
 const closedReceiver=b=>!!b&&!b.writes.length&&
  ['NewExpression','ObjectExpression'].includes(b.init?.type)&&b.refs.every(ref=>{
   const p=parents.get(ref);return p?.type==='MemberExpression'&&p.object===ref&&!p.computed&&property(p)!==undefined;
  });
 const stableGlobals=nodes.filter(n=>free(n)&&['String','Object','Array','Boolean','JSON','Math','Number','parseInt','parseFloat','decodeURIComponent','encodeURIComponent','decodeURI','encodeURI'].includes(n.name)).every(n=>{
  let p=n;while(parents.get(p)?.type==='MemberExpression'&&parents.get(p).object===p)p=parents.get(p);
  return !write(p);
 });
 const inheritedJSONNames=new Set([Object.prototype,Array.prototype,String.prototype,Number.prototype,Boolean.prototype].flatMap(p=>Object.getOwnPropertyNames(p)));
 const stringMethods=new Set(['replace','replaceAll','trim','trimStart','trimEnd','toLowerCase','toUpperCase','toLocaleLowerCase','toLocaleUpperCase','normalize','padStart','padEnd','repeat','charAt','substring','substr']);
 function unmodifiedData(b){
  return b.refs.every(r=>{
   if(b.writes.some(w=>w.left===r))return false;
   let m=r;while(parents.get(m)?.type==='MemberExpression'&&parents.get(m).object===m)m=parents.get(m);
   const p=parents.get(m);
   if(write(m))return false;
   if(m===r){
    if(p?.type==='ConditionalExpression'&&p.test===r||p?.type==='IfStatement'&&p.test===r||p?.type==='UnaryExpression'&&['!','typeof'].includes(p.operator))return true;
    // Fresh JSON data may leave its creating helper through a return. A
    // captured/global record or an alias passed to another call stays unknown.
    const declaration=b.init?parents.get(b.init):null;
    if(declaration?.type!=='VariableDeclarator'||!functions.has(owners.get(declaration)?.type)||owners.get(r)!==owners.get(declaration))return false;
    let value=r,parent=parents.get(value);
    while(parent&&(parent.type==='LogicalExpression'||parent.type==='ConditionalExpression'&&parent.test!==value)){value=parent;parent=parents.get(value);}
    return parent?.type==='ReturnStatement'||parent?.type==='IfStatement'&&parent.test===value||parent?.type==='UnaryExpression'&&['typeof','!'].includes(parent.operator)||parent?.type==='BinaryExpression'&&['===','!==','==','!='].includes(parent.operator);
   }
   if(p?.type==='CallExpression'){
    if(p.callee===m)return stringMethods.has(property(m))||['hasOwnProperty','includes','indexOf','match','split','toString'].includes(property(m));
    return p.callee.type==='MemberExpression'&&p.callee.object.regex&&['exec','test'].includes(property(p.callee));
   }
   // A parsed JSON record can be projected into another local binding without
   // changing the record or turning its data into executable functions. Keep
   // computed keys, writes, deletes, and aliases to unknown calls outside this
   // proof; those remain subject to the conservative escape checks below.
   if(m!==r&&m.type==='MemberExpression'&&p?.type==='VariableDeclarator'&&p.init===m){
    for(let access=m;access?.type==='MemberExpression';access=access.object){
     if(property(access)===undefined||access.computed&&access.property.type!=='Literal')return false;
     const use=parents.get(access);
     if(use?.type==='AssignmentExpression'&&use.left===access||use?.type==='UpdateExpression'||use?.type==='UnaryExpression'&&use.operator==='delete')return false;
    }
    return true;
   }
   return ['BinaryExpression','LogicalExpression','ConditionalExpression','TemplateLiteral','UnaryExpression','IfStatement','SwitchStatement'].includes(p?.type);
  });
 }
 function initialized(d,ref){
  const declaration=parents.get(d),owner=owners.get(d);
  if(owners.get(ref)===owner)return ref.start>=declaration.end;
  let closure=owners.get(ref),entry=ref;
  while(closure&&closure!==owner){
   if(!functions.has(closure.type)||closure.type==='FunctionDeclaration'||['MethodDefinition','Property'].includes(parents.get(closure)?.type))break;
   entry=closure;closure=owners.get(parents.get(closure));
  }
  if(closure===owner){const block=parents.get(declaration);let use=entry;while(parents.get(use)&&parents.get(use)!==block)use=parents.get(use);if(parents.get(use)===block&&use.start>=declaration.end)return true;}

  if(parents.get(declaration)===nodes[0]&&initializedAfter(ix,declaration,ref))return true;
  // A captured value in an IIFE (including its nested callbacks) is available
  // when that IIFE is directly entered after the declaration in the same scope.
  for(let fn=owners.get(ref);functions.has(fn?.type);fn=owners.get(parents.get(fn))){
   const p=parents.get(fn);
   if(p?.type==='CallExpression'&&p.callee===fn&&owners.get(p)===owner&&p.start>=declaration.end)return true;
  }
  return false;
 }
 function constructedMethodCalls(fn){
  if(fn.type!=='ArrowFunctionExpression'&&nodes.some(n=>free(n,'arguments')&&owners.get(n)===fn))return null;
  const assignment=parents.get(fn),member=assignment?.left;
  if(assignment?.type!=='AssignmentExpression'||assignment.operator!=='='||assignment.right!==fn||member?.type!=='MemberExpression'||member.object.type!=='ThisExpression'||typeof property(member)!=='string')return null;
  const ctor=owners.get(assignment),binding=ctor?.type==='FunctionDeclaration'?bindings.get(ctor.id):null;
  if(!binding||binding.writes.length||counts.get(binding)!==1||!binding.refs.length)return null;
  const name=property(member),calls=[];
  for(const ref of binding.refs){
   const create=parents.get(ref),declaration=parents.get(create);
   if(create?.type!=='NewExpression'||create.callee!==ref||declaration?.type!=='VariableDeclarator'||declaration.init!==create||declaration.id.type!=='Identifier')return null;
   const instance=bindings.get(declaration.id);
   if(!instance||instance.writes.length||!instance.refs.length)return null;
   for(const use of instance.refs){
    const m=parents.get(use),call=parents.get(m);
    if(m?.type!=='MemberExpression'||m.object!==use||typeof property(m)!=='string'||call?.type!=='CallExpression'||call.callee!==m||call.optional||call.arguments.some(a=>a.type==='SpreadElement'))return null;
    if(property(m)===name)calls.push(call);
   }
  }
  const definitions=nodes.filter(n=>n.type==='MemberExpression'&&n.object.type==='ThisExpression'&&owners.get(n)===ctor&&property(n)===name);
  if(definitions.length!==1||definitions[0]!==member)return null;
  for(const n of nodes){
   if(n.type==='ReturnStatement'&&owners.get(n)===ctor&&n.argument)return null;
   if(n.type==='ThisExpression'){let owner=owners.get(n);while(owner?.type==='ArrowFunctionExpression')owner=owners.get(parents.get(owner));if(owner!==ctor)continue;const m=parents.get(n),a=parents.get(m);if(owners.get(n)!==ctor||m?.type!=='MemberExpression'||typeof property(m)!=='string'||a?.type!=='AssignmentExpression'||a.left!==m||a.operator!=='=')return null;}
  }
  return calls.length?calls:null;
 }
 // A direct local assignment dominates later reads in the same statement
 // block even when the variable's earlier value has an unknown JSON shape.
 // Captured bindings and eval stay outside this proof: a call/getter could
 // otherwise change the binding without a visible write at the read site.
 function assignedValue(ref){
  const b=bindings.get(ref),owner=owners.get(ref);
  if(!b||!functions.has(owner?.type)||b.refs.some(r=>owners.get(r)!==owner)||nodes.some(n=>free(n,'eval')&&owners.get(n)===owner))return null;
  let child=ref;
  for(let block=parents.get(child);block&&owners.get(block)===owner;child=block,block=parents.get(block)){
   if(block.type!=='BlockStatement')continue;
   const position=block.body.indexOf(child);if(position<0)continue;
   for(const statement of block.body.slice(0,position).reverse()){
    const assignment=statement.type==='ExpressionStatement'?statement.expression:null;
    if(assignment?.type!=='AssignmentExpression'||assignment.operator!=='='||assignment.left.type!=='Identifier'||bindings.get(assignment.left)!==b)continue;
    // An intervening conditional write or a write in the read's expression
    // can supersede this assignment. Retain the original unknown provenance.
    if(b.writes.some(w=>w!==assignment&&w.start>=statement.end&&w.start<ref.start))return null;
    return assignment.right;
   }
  }
  return null;
 }
 function type(n,seen=new Set()){
  if(!n||!stableGlobals||seen.has(n))return null;
  seen=new Set(seen);seen.add(n);
  if(n.type==='Literal')return typeof n.value==='string'?'string':typeof n.value==='number'?'number':typeof n.value==='boolean'?'boolean':null;
  if(n.type==='UnaryExpression'&&n.operator==='!')return 'boolean';
  if(n.type==='LogicalExpression'){const a=type(n.left,seen),b=type(n.right,seen);if(a&&a===b)return a;if(a==='json'&&b==='boolean'||a==='boolean'&&b==='json')return 'json';}
  if(n.type==='TemplateLiteral')return 'string';
  if(n.type==='ConditionalExpression'){const a=type(n.consequent,seen);return a&&a===type(n.alternate,seen)?a:null;}
  if(n.type==='BinaryExpression'&&n.operator==='+'&&(type(n.left,seen)==='string'||type(n.right,seen)==='string'))return 'string';
  if(n.type==='BinaryExpression'&&n.operator==='+'&&type(n.left,seen)==='number'&&type(n.right,seen)==='number')return 'number';
  if(n.type==='BinaryExpression'&&['-','*','/','%','**','<<','>>','>>>','&','|','^'].includes(n.operator)||n.type==='UnaryExpression'&&['+','-','~'].includes(n.operator))return 'number';
  if(n.type==='MemberExpression'){
   if(free(n.object,'$request')&&['url','method'].includes(property(n)))return 'string';
   if(type(n.object,seen)==='json'&&property(n)!==undefined&&!inheritedJSONNames.has(String(property(n))))return 'json';
   if(n.object.type==='Identifier'&&property(n)!==undefined){
    const binding=bindings.get(n.object),writes=memberWrites.get(binding)?.get(String(property(n)));
    if(closedReceiver(binding)&&writes?.length){
     const result=type(writes[0],seen);
     if(['string','number','boolean','json'].includes(result)&&writes.every(value=>type(value,seen)===result))return result;
    }
   }
   return null;
  }
  if(n.type==='CallExpression'&&!n.optional){
   if(['Number','parseInt','parseFloat'].some(name=>free(n.callee,name)))return 'number';
   if(['String','decodeURIComponent','encodeURIComponent','decodeURI','encodeURI'].some(name=>free(n.callee,name)))return 'string';
   const m=n.callee;
   if(m.type==='MemberExpression'&&free(m.object,'Math')&&['abs','acos','acosh','asin','asinh','atan','atanh','atan2','cbrt','ceil','clz32','cos','cosh','exp','expm1','floor','fround','hypot','imul','log','log1p','log2','log10','max','min','pow','random','round','sign','sin','sinh','sqrt','tan','tanh','trunc'].includes(property(m)))return 'number';
   if(m.type==='MemberExpression'&&['toFixed','toExponential','toPrecision'].includes(property(m))&&type(m.object,seen)==='number')return 'string';
   if(m.type==='MemberExpression'&&(free(m.object,'$persistentStore')&&property(m)==='read'||free(m.object,'$prefs')&&property(m)==='valueForKey'))return 'string';
   if(!changedStringMethods&&m.type==='MemberExpression'&&property(m)==='split'&&type(m.object,seen)==='string')return 'array';
   if(!changedStringMethods&&m.type==='MemberExpression'&&['filter','map','slice','concat'].includes(property(m))&&type(m.object,seen)==='array')return 'array';
   if(m.type==='MemberExpression'&&free(m.object,'JSON')&&property(m)==='parse'&&n.arguments.length===1)return 'json';
   if(m.type==='MemberExpression'&&free(m.object,'JSON')&&property(m)==='stringify')return null; // undefined is a possible result.
   if(m.type==='Identifier'){
    const b=bindings.get(m),fn=b?.init;
    if(b&&!b.writes.length&&counts.get(b)===1&&functions.has(fn?.type)&&!fn.async&&!fn.generator&&b.refs.length&&b.refs.every(r=>parents.get(r)?.type==='CallExpression'&&parents.get(r).callee===r)){
     const returns=fn.body.type==='BlockStatement'?nodes.filter(r=>r.type==='ReturnStatement'&&owners.get(r)===fn).map(r=>r.argument):[fn.body];
     const types=returns.map(r=>type(r,seen));
     if(types.length&&types[0]&&types.every(t=>t===types[0]))return types[0];
     if(types.includes('json')&&types.every(t=>['json','boolean'].includes(t)))return 'json';
    }
   }
   if(m.type==='MemberExpression'&&stringMethods.has(property(m))&&['string','json'].includes(type(m.object,seen)))return 'string';
   return null;
  }
  if(n.type!=='Identifier')return null;
  const b=bindings.get(n);if(!b)return null;
  // A property extracted from a parsed JSON object remains JSON data. In
  // particular, it cannot be a function whose toString() inspects its source.
  // Keep this proof to direct, non-computed object-pattern properties and an
  // immutable binding; aliases and mutated records continue through the
  // ordinary provenance checks below.
  if(!b.writes.length&&(jsonPatterns.get(b)??[]).some(d=>type(d.init,seen)==='json'))return 'json';
  const assigned=assignedValue(n);if(assigned){const result=type(assigned,seen);if(result)return result;}
  // A root-local binding may be assigned once inside an awaited callback and
  // read later in another function. Preserve the JSON provenance across that
  // closure boundary only when there is one plain assignment and no eval can
  // mutate the lexical binding by name.
  if(!b.init&&!hasDynamicEval&&b.writes.length===1){
   const write=b.writes[0];
   if(write.type==='AssignmentExpression'&&write.operator==='='&&write.left.type==='Identifier'&&bindings.get(write.left)===b){
    const result=type(write.right,seen);if(['string','number','boolean','json'].includes(result))return result;
   }
  }
  // Captures from a direct RegExp.exec array destructuring are strings.
  if(regexCaptures.has(b))return 'string';
  if(b.init&&counts.get(b)===1){
   const d=parents.get(b.init),declaration=parents.get(d);
   if(d?.type!=='VariableDeclarator'||!initialized(d,n))return null;
   const initial=type(b.init,seen);if(!initial)return null;
   if(initial==='json'&&!unmodifiedData(b))return null;
   if(b.writes.every(w=>w.type==='AssignmentExpression'&&w.left.type==='Identifier'&&bindings.get(w.left)===b&&
      (w.operator==='='&&type(w.right,seen)===initial||w.operator==='+='&&initial==='string')))return initial;
   return null;
  }
  // A parameter is inferred only when every reference to its local function
  // is a direct call with an actual argument. Escapes/defaults/rest are unknown.
  const {fn,position} = parameters.get(b)??{};
  if(!functions.has(fn?.type)||position<0||b.writes.length)return null;
  const p=parents.get(fn),id=fn.id??(p?.type==='VariableDeclarator'?p.id:null),fb=id?.type==='Identifier'?bindings.get(id):null;
  if(!fb){const sites=constructedMethodCalls(fn);if(!sites)return null;const types=sites.map(call=>type(call.arguments[position],seen));return types[0]&&types.every(t=>t===types[0])?types[0]:null;}
  if(fb.writes.length||counts.get(fb)!==1||!fb.refs.length)return null;
  const values=[];
  for(const ref of fb.refs){const call=parents.get(ref);if(call?.type!=='CallExpression'||call.callee!==ref||call.optional||call.arguments.some(a=>a.type==='SpreadElement'))return null;values.push(type(call.arguments[position],seen));}
  return values[0]&&values.every(v=>v===values[0])?values[0]:null;
 }
 const ordinaryActive=new Set(),standardActive=new Set();
 const changedStringMethods=nodes.some(n=>n.type==='MemberExpression'&&['toString','toFixed','toExponential','toPrecision','match','split','filter','map','slice','concat'].includes(property(n))&&write(n));
 function nonCallable(n,seen=new Set(),standard=false){
  const active=standard?standardActive:ordinaryActive;
  if(n?.type==='Identifier'&&active.has(bindings.get(n)))return true;
  if(!n||seen.has(n))return false;seen=new Set(seen);seen.add(n);
  if(['string','json','number','array'].includes(type(n)))return true;
  if(['Literal','ArrayExpression','TemplateLiteral'].includes(n.type)||!standard&&n.type==='ObjectExpression')return true;
  if(n.type==='MemberExpression'&&['$request','$response'].some(name=>free(n.object,name))&&['body','bodyBytes','url','method','status','statusCode'].includes(property(n)))return true;
  if(n.type==='BinaryExpression'||n.type==='UnaryExpression')return true;
  if(n.type==='LogicalExpression')return nonCallable(n.left,seen,standard)&&nonCallable(n.right,seen,standard);
  if(n.type==='ConditionalExpression')return nonCallable(n.consequent,seen,standard)&&nonCallable(n.alternate,seen,standard);
  if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'){
   const m=n.callee;
   if(free(m.object,'$persistentStore')&&property(m)==='read'||free(m.object,'$prefs')&&property(m)==='valueForKey')return true;
   if(m.object.regex&&['exec','test'].includes(property(m)))return true;
   // An arbitrary object's custom toString/match/split may return a function.
   // Only standard string receivers establish a non-callable return value.
   if(!changedStringMethods&&['match','split','toString','filter','map','slice'].includes(property(m))&&nonCallable(m.object,standard?seen:new Set(),true))return true;
  }
  if(n.type==='CallExpression'&&n.callee.type==='Identifier'){
   const b=bindings.get(n.callee),fn=b?.init;
   if(b&&!b.writes.length&&functions.has(fn?.type)&&!fn.async&&!fn.generator&&!seen.has(fn)&&b.refs.every(r=>parents.get(r)?.type==='CallExpression'&&parents.get(r).callee===r)){
    const next=new Set(seen);next.add(fn);
    const returns=fn.body.type==='BlockStatement'?nodes.filter(r=>r.type==='ReturnStatement'&&owners.get(r)===fn).map(r=>r.argument):[fn.body];
    if(returns.length&&returns.every(r=>nonCallable(r,next,standard)))return true;
   }
  }
  if(n.type!=='Identifier')return false;
  const b=bindings.get(n);if(!b)return false;
  if(active.has(b))return true;
  if(standard&&b.refs.some(r=>{let m=r;while(parents.get(m)?.type==='MemberExpression'&&parents.get(m).object===m)m=parents.get(m);return m!==r&&write(m);}))return false;
  let initial=b.init?nonCallable(b.init,seen,standard):false;
  if(!b.init){
   initial=nodes.some(d=>d.type==='VariableDeclarator'&&d.id.type==='ArrayPattern'&&d.id.elements.some(e=>e?.type==='Identifier'&&bindings.get(e)===b)&&d.init?.type==='CallExpression'&&d.init.callee.type==='MemberExpression'&&d.init.callee.object.regex&&property(d.init.callee)==='exec');
   if(!initial){
    const p=parameters.get(b);if(!p)return false;
    const fn=p.fn,parent=parents.get(fn),id=fn.id??(parent?.type==='VariableDeclarator'?parent.id:null),fb=id?bindings.get(id):null;
    if(parent?.type==='CallExpression'&&parent.callee.type==='MemberExpression'&&free(parent.callee.object,'$httpClient')&&['get','post','put','delete','head','options','patch'].includes(property(parent.callee))&&parent.arguments[1]===fn&&p.position===2)initial=true;
    else if(fb)initial=!fb.writes.length&&fb.refs.length>0&&fb.refs.every(r=>{const call=parents.get(r);return call?.type==='CallExpression'&&call.callee===r&&!call.optional&&nonCallable(call.arguments[p.position],seen,standard);});
    else if(parent?.type==='MethodDefinition'){
     const cls=parents.get(parent),methodName=key(parent),scope=index(cls),sites=scope.nodes.filter(c=>c.type==='CallExpression'&&c.callee.type==='MemberExpression'&&c.callee.object.type==='ThisExpression'&&property(c.callee)===methodName&&c.arguments[p.position]);
     initial=sites.length>0&&sites.every(c=>nonCallable(c.arguments[p.position],seen,standard));
    }
   }
  }
  if(!initial)return false;
  active.add(b);
  try{return b.writes.every(w=>w.type==='AssignmentExpression'&&w.operator==='='&&w.left.type==='Identifier'&&bindings.get(w.left)===b&&nonCallable(w.right,new Set(),standard));}
  finally{active.delete(b);}
 }
 return {string:n=>type(n)==='string',type:n=>type(n),nonCallable,
  safeToStringReceiver:n=>!changedStringMethods&&['string','number','boolean','json'].includes(type(n))};
}

// Bound a primitive field read from a closed literal record table. This keeps
// every authored lookup and branch; only the type of a successful read is used.
export function finiteLiteralMember(ix,input){
 const {nodes,parents,bindings,owners,free}=ix;
 if(input?.type!=='MemberExpression'||property(input)===undefined)return null;
 const field=String(property(input));
 if(nodes.some(n=>free(n,'eval')||free(n,'Function')||free(n,'Reflect')||n.type==='MemberExpression'&&['__proto__','prototype','defineProperty','defineProperties','setPrototypeOf'].includes(property(n))))return null;
 const closedFunction=callee=>{const b=bindings.get(callee),fn=b?.fn??b?.init;return b&&!b.writes.length&&functions.has(fn?.type)&&b.refs.length&&b.refs.every(r=>{const c=parents.get(r);return c?.type==='CallExpression'&&c.callee===r&&!c.optional&&!c.arguments.some(a=>a.type==='SpreadElement');})?fn:null;};
 const scalarPredicate=fn=>functions.has(fn?.type)&&!fn.async&&!fn.generator&&fn.params.length===1&&fn.params[0].type==='Identifier'&&fn.body.type!=='BlockStatement'&&nodes.filter(n=>n.start>=fn.body.start&&n.end<=fn.body.end).every(n=>['Identifier','Literal','MemberExpression','BinaryExpression','LogicalExpression','UnaryExpression','TemplateLiteral','TemplateElement'].includes(n.type)&&!(n.type==='UnaryExpression'&&n.operator==='delete'));
 function records(n,seen=new Set()){
  if(!n||seen.has(n))return null;seen=new Set(seen);seen.add(n);
  if(n.type==='ObjectExpression')return n.properties.every(p=>p.type==='Property'&&p.kind==='init'&&key(p)!==undefined&&key(p)!=='__proto__')?[n]:null;
  if(n.type==='Identifier'){
   const b=bindings.get(n);if(!b||seen.has(b))return null;seen.add(b);
   if(b.writes.length){
    if(owners.get(n)?.params?.some(p=>bindings.get(p)===b))return null;
    const values=[b.init,...b.writes.map(w=>w.type==='AssignmentExpression'&&w.operator==='='&&w.left.type==='Identifier'&&bindings.get(w.left)===b?w.right:null)].filter(Boolean);
    if(b.writes.some(w=>w.type!=='AssignmentExpression'||w.operator!=='='||owners.get(w)!==owners.get(n)))return null;
    const branches=values.map(v=>records(v,new Set(seen)));return branches.length&&branches.every(Boolean)?branches.flat():null;
   }
   if(b.init)return records(b.init,seen);
   const fn=owners.get(n),position=fn?.params?.findIndex(p=>bindings.get(p)===b),p=parents.get(fn),binding=bindings.get(fn?.id??(p?.type==='VariableDeclarator'?p.id:null));
   if(position<0||!binding||closedFunction(binding.refs[0])!==fn)return null;
   const branches=binding.refs.map(r=>records(parents.get(r).arguments[position],new Set(seen)));
   return branches.length&&branches.every(Boolean)?branches.flat():null;
  }
  let array;
  if(n.type==='MemberExpression'&&n.computed)array=n.object;
  if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&property(n.callee)==='find'&&n.arguments.length===1&&scalarPredicate(n.arguments[0]))array=n.callee.object;
  if(array?.type!=='Identifier')return null;
  const b=bindings.get(array),data=b?.init;
  if(!b||b.writes.length||data?.type!=='ArrayExpression'||!data.elements.length||data.elements.length>100||data.elements.some(e=>e?.type!=='ObjectExpression'))return null;
  const rows=data.elements;
  const recordBinding=(binding,visited=new Set())=>{
   if(!binding)return false;if(visited.has(binding))return true;visited=new Set(visited);visited.add(binding);
   return binding.refs.every(r=>{
    const p=parents.get(r),u=parents.get(p);
    if(p?.type==='AssignmentExpression'&&p.left===r&&p.operator==='=')return true;
    if(p?.type==='UnaryExpression'&&['!','typeof'].includes(p.operator)||p?.type==='IfStatement'&&p.test===r)return true;
    if(p?.type==='MemberExpression'&&p.object===r){
     if(property(p)===undefined||u?.type==='AssignmentExpression'&&u.left===p||u?.type==='UpdateExpression'||u?.operator==='delete')return false;
     if(u?.type==='CallExpression'&&u.callee===p)return rows.every(row=>{const v=row.properties.find(p=>key(p)===property(u.callee))?.value;return !v||v.type==='ArrowFunctionExpression';});
     return true;
    }
    if(p?.type==='VariableDeclarator'&&p.init===r)return recordBinding(bindings.get(p.id),visited);
    if(p?.type==='CallExpression'&&p.arguments.includes(r)){const fn=closedFunction(p.callee),param=fn?.params[p.arguments.indexOf(r)];return param?.type==='Identifier'&&recordBinding(bindings.get(param),visited);}
    return false;
   });
  };
  const recordUse=n=>{
   const p=parents.get(n);
   if(p?.type==='MemberExpression'&&p.object===n){const u=parents.get(p);return property(p)!==undefined&&!(u?.type==='AssignmentExpression'&&u.left===p||u?.type==='UpdateExpression'||u?.operator==='delete')&&!(u?.type==='CallExpression'&&u.callee===p&&!rows.every(row=>{const v=row.properties.find(q=>key(q)===property(p))?.value;return !v||v.type==='ArrowFunctionExpression';}));}
   if(p?.type==='VariableDeclarator'&&p.init===n)return recordBinding(bindings.get(p.id));
   if(p?.type==='AssignmentExpression'&&p.right===n&&p.operator==='=')return recordBinding(bindings.get(p.left));
   return false;
  };
  for(const ref of b.refs){
   const member=parents.get(ref),call=parents.get(member);
   if(member?.type!=='MemberExpression'||member.object!==ref)return null;
   if(member.computed&&property(member)===undefined||member.computed&&typeof property(member)==='number'){if(!recordUse(member))return null;continue;}
   const method=property(member);
   if(!['find','map'].includes(method)||call?.type!=='CallExpression'||call.callee!==member||call.arguments.length!==1||!scalarPredicate(call.arguments[0])||method==='find'&&!recordUse(call))return null;
  }
  return rows;
 }
 const rows=records(input.object);
 if(!rows?.length)return null;
 const values=rows.map(row=>row.properties.find(p=>String(key(p))===field)?.value);
 if(values.some(v=>v?.type!=='Literal'&&v?.type!=='TemplateLiteral'||v?.type==='TemplateLiteral'&&v.expressions.length))return null;
 return values;
}

// Result shapes belong to exact reviewed library contracts, never to familiar
// variable names. Prove the public namespace and all of its aliases stay closed
// before using those shapes to distinguish data.toString from source inspection.
export function libraryValues(ix,contracts=[]){
 const {nodes,parents,bindings,free}=ix,results=new Set(),memberAliases=[];
 const rootIds=new WeakMap();let nextRootId=0;
 const rootToken=root=>{
  if(typeof root==='string')return root;
  if(!rootIds.has(root))rootIds.set(root,++nextRootId);
  return 'binding:'+rootIds.get(root);
 };
 const parts=n=>{
  if(n?.type==='Identifier')return {root:bindings.get(n)??'free:'+n.name,segments:[]};
  if(n?.type!=='MemberExpression'||n.optional||typeof property(n)!=='string')return null;
  const base=parts(n.object);return base&&{root:base.root,segments:[...base.segments,property(n)]};
 };
 const pathKey=p=>p?rootToken(p.root)+'/'+p.segments.map(x=>JSON.stringify(x)).join('/') : null;
 const samePath=(a,b)=>pathKey(parts(a))===pathKey(b);
 for(const {global,nonCallableCalls=[],resultFormatters=[]} of contracts){
  const aliases=new Set(),roots=nodes.filter(n=>free(n,global));
  if(!roots.length||nodes.some(n=>n.type==='Identifier'&&n.name===global&&bindings.has(n)))continue;
  const root=n=>free(n,global)||n?.type==='Identifier'&&aliases.has(bindings.get(n))||memberAliases.some(alias=>samePath(n,alias));
  const definitions=new Map();
  for(const n of nodes)if(n.type==='VariableDeclarator'&&n.id.type==='Identifier'){
   const b=bindings.get(n.id);if(b)definitions.set(b,[...(definitions.get(b)??[]),n]);
  }
  // An alias may be initialized by a lowered state assignment rather than a
  // declaration. Every possible assignment must retain the same namespace.
  for(let pass=0;pass<8;pass++){
   let changed=false;
   for(const [b,ds] of definitions){
    if(aliases.has(b)||ds.length!==1)continue;
    const inputs=[b.init,...b.writes.map(w=>w.type==='AssignmentExpression'&&w.operator==='='&&w.left.type==='Identifier'&&bindings.get(w.left)===b?w.right:false)].filter(n=>n!==null&&n!==undefined);
    if(inputs.length&&inputs.every(n=>n&&root(n))){aliases.add(b);changed=true;}
   }
   if(!changed)break;
  }
  // Closed object properties can hold an exact library namespace too (for
  // example, $.CryptoJS = CryptoJS). Admit only a stable object binding and
  // only when every write to that same static property keeps the namespace.
  // Reads are checked below just like direct global and local aliases.
  for(let pass=0;pass<8;pass++){
   let changed=false;
   for(const n of nodes)if(n.type==='AssignmentExpression'&&n.operator==='='&&n.left.type==='MemberExpression'&&root(n.right)){
    const candidate=parts(n.left),base=candidate?.root;
    if(!candidate?.segments.length||!base||typeof base==='string'||base.writes?.length)continue;
    if(memberAliases.some(alias=>pathKey(alias)===pathKey(candidate)))continue;
    const writes=nodes.filter(x=>x.type==='AssignmentExpression'&&x.left.type==='MemberExpression'&&samePath(x.left,candidate));
    const invalidWrite=nodes.some(x=>x.type==='UpdateExpression'&&x.argument.type==='MemberExpression'&&samePath(x.argument,candidate)||
      x.type==='UnaryExpression'&&x.operator==='delete'&&x.argument.type==='MemberExpression'&&samePath(x.argument,candidate));
    if(invalidWrite||!writes.length||writes.some(write=>write.operator!=='='||!root(write.right)))continue;
    // Reject obvious whole-object escape / bulk mutation paths that could
    // replace the aliased library property without a direct property write.
    const objectRoot=candidate.root;
    const baseBinding=objectRoot;
    const escapes=nodes.some(x=>x.type==='CallExpression'&&x.arguments.some(arg=>arg.type==='Identifier'&&bindings.get(arg)===baseBinding))||
      nodes.some(x=>x.type==='CallExpression'&&x.callee.type==='MemberExpression'&&free(x.callee.object,'Object')&&property(x.callee)==='assign'&&x.arguments[0]?.type==='Identifier'&&bindings.get(x.arguments[0])===baseBinding)||
      !baseBinding.refs.every(ref=>{const use=parents.get(ref);return use?.type==='MemberExpression'&&use.object===ref&&typeof property(use)==='string';});
    if(escapes)continue;
    memberAliases.push(candidate);changed=true;
   }
   if(!changed)break;
  }
  // A property alias may seed ordinary local aliases. Resolve those after the
  // property proof, then compile calls through either spelling uniformly.
  for(let pass=0;pass<8;pass++){
   let changed=false;
   for(const [b,ds] of definitions){
    if(aliases.has(b)||ds.length!==1)continue;
    const inputs=[b.init,...b.writes.map(w=>w.type==='AssignmentExpression'&&w.operator==='='&&w.left.type==='Identifier'&&bindings.get(w.left)===b?w.right:false)].filter(n=>n!==null&&n!==undefined);
    if(inputs.length&&inputs.every(n=>n&&root(n))){aliases.add(b);changed=true;}
   }
   if(!changed)break;
  }
  const path=n=>{
   if(root(n))return '';
   if(n?.type!=='MemberExpression'||n.optional||typeof property(n)!=='string')return null;
   const base=path(n.object);return base===null?null:(base?base+'.':'')+property(n);
  };
  const allowed=new Set(nonCallableCalls),calls=new Set(nodes.filter(n=>n.type==='CallExpression'&&!n.optional&&allowed.has(path(n.callee))));
  const formatterCalls=new Set(resultFormatters);
  const formattedResult=(n,seen=new Set())=>{
   if(!n||seen.has(n))return false;seen=new Set(seen);seen.add(n);
   if(n.type==='CallExpression'&&!n.optional&&formatterCalls.has(path(n.callee)))return true;
   if(n.type==='Identifier'){
    const b=bindings.get(n);return !!b&&!!b.init&&!b.writes.length&&formattedResult(b.init,seen);
   }
   return false;
  };
  const formatterUse=call=>call?.type==='CallExpression'&&call.callee.type==='MemberExpression'&&property(call.callee)==='toString'&&formattedResult(call.callee.object);
  const allowedValueArgument=(call,value)=>call?.type==='CallExpression'&&call.arguments.includes(value)&&(calls.has(call)||formatterUse(call));
  const isAliasAssignment=n=>{
   const p=parents.get(n);
   if(p?.type==='VariableDeclarator'&&p.init===n)return aliases.has(bindings.get(p.id));
   return p?.type==='AssignmentExpression'&&p.operator==='='&&p.right===n&&(
    p.left.type==='Identifier'&&aliases.has(bindings.get(p.left))||p.left.type==='MemberExpression'&&memberAliases.some(alias=>samePath(p.left,alias))
   );
  };
  let closed=true;
  for(const ref of [...roots,...[...aliases].flatMap(b=>b.refs)]){
   if(isAliasAssignment(ref))continue;
   const p=parents.get(ref);
   if(aliases.has(bindings.get(ref))&&p?.type==='AssignmentExpression'&&p.operator==='='&&p.left===ref&&root(p.right))continue;
   let value=ref;
   while(parents.get(value)?.type==='MemberExpression'&&parents.get(value).object===value&&path(parents.get(value))!==null)value=parents.get(value);
   const use=parents.get(value);
   if(value===ref||use?.type==='AssignmentExpression'&&use.left===value||use?.type==='UpdateExpression'||use?.operator==='delete'){closed=false;break;}
   if(use?.type==='CallExpression'&&use.callee===value&&calls.has(use))continue;
   // Read-only algorithm/padding constants can occur inside a literal options
   // object passed to the same reviewed library. They cannot escape to a helper.
   let arg=value,parent=use;
   while(parent?.type==='Property'&&parent.value===arg&&!parent.computed&&parent.kind==='init'||parent?.type==='ObjectExpression'){
    arg=parent;parent=parents.get(arg);
   }
   if(allowedValueArgument(parent,arg))continue;
   closed=false;break;
  }
  // A namespace property must be read only through reviewed calls or their
  // immutable options objects; never let it escape as an arbitrary value.
  if(closed)for(const alias of memberAliases){
   for(const n of nodes.filter(x=>x.type==='MemberExpression'&&samePath(x,alias))){
    const assignment=parents.get(n);
    if(assignment?.type==='AssignmentExpression'&&assignment.left===n&&root(assignment.right))continue;
    let outer=n,parent=parents.get(outer);
    while(parent?.type==='MemberExpression'&&parent.object===outer){outer=parent;parent=parents.get(outer);}
    if(parent?.type==='CallExpression'&&parent.callee===outer&&calls.has(parent))continue;
    let value=outer,use=parent;
    while(use?.type==='Property'&&use.value===value||use?.type==='ObjectExpression'){
     value=use;use=parents.get(value);
    }
    if(allowedValueArgument(use,value))continue;
    closed=false;break;
   }
   if(!closed)break;
  }
  if(closed)for(const call of calls)results.add(call);
 }
 return {nonCallable(n,seen=new Set()){
  if(results.has(n))return true;
  if(n?.type!=='Identifier')return false;
  const b=bindings.get(n);if(!b||b.writes.length||!b.init||seen.has(b))return false;
  seen=new Set(seen);seen.add(b);return this.nonCallable(b.init,seen);
 }};
}

// Prove ordinary receivers without treating function source inspection as safe.

export function ordinaryReceivers(tree,libraryContracts=[]){
 const ix=index(tree),{parents,bindings,free}=ix;
 const values=valueFacts(ix),libraries=libraryValues(ix,libraryContracts);
 const writtenThrough=node=>{
  for(let child=node,parent=parents.get(child);parent;child=parent,parent=parents.get(parent)){
   if(parent.type==='AssignmentExpression'&&parent.left===child||parent.type==='UpdateExpression'||parent.type==='UnaryExpression'&&parent.operator==='delete')return true;
   if(parent.type==='MemberExpression'&&parent.object===child)continue;
   break;
  }
  return false;
 };
 const ordinaryObject=n=>{
  const p=parents.get(n),q=parents.get(p);
  const alias=q?.type==='VariableDeclarator'&&q.init===p&&q.id.type==='Identifier'?bindings.get(q.id):null;
  return p?.type==='MemberExpression'&&p.object===n&&!writtenThrough(p)&&
   (q?.type==='CallExpression'&&q.callee===p||property(p)==='prototype'&&q?.type==='MemberExpression'&&property(q)==='toString'||
    alias&&!alias.writes.length&&alias.refs.every(r=>{const c=parents.get(r);return c?.type==='CallExpression'&&c.callee===r;}));
 };
 const stableObject=ix.nodes.filter(n=>free(n,'Object')).every(ordinaryObject)&&
  ix.nodes.filter(n=>n.type==='MemberExpression'&&free(n.object,'globalThis')&&property(n)==='Object').every(ordinaryObject);
 const stableBinding=(n,identityOnly=false)=>bindings.has(n)&&!bindings.get(n).writes.length&&bindings.get(n).refs.every(ref=>{
  if(identityOnly&&parents.get(ref)?.type==='MemberExpression'&&parents.get(ref).object===ref)return true;
  for(let p=parents.get(ref);p;p=parents.get(p)){
   if(p.type==='AssignmentExpression'&&ref.start>=p.left.start&&ref.end<=p.left.end)return false;
   if(['ForInStatement','ForOfStatement'].includes(p.type)&&ref.start>=p.left.start&&ref.end<=p.left.end)return false;
   if(functions.has(p.type))break;
  }return true;
 });
 const same=(a,b)=>a?.type==='Identifier'&&b?.type==='Identifier'&&a.name===b.name&&bindings.get(a)===bindings.get(b);
 function ordinaryClass(cls,seen=new Set()){
  if(!['ClassDeclaration','ClassExpression'].includes(cls?.type)||seen.has(cls))return false;
  if(!cls.superClass)return true;
  seen.add(cls);
  const parent=cls.superClass,b=bindings.get(parent);
  if(b&&!b.writes.length)return ordinaryClass(b.init,seen);
  return ['Error','TypeError','RangeError'].some(name=>free(parent,name));
 }
 function errorConstructor(n){
  if(['Error','TypeError','RangeError'].some(name=>free(n,name)))return !ix.nodes.some(r=>free(r,n.name)&&writtenThrough(r));
  const b=bindings.get(n),cls=b?.init;
  return !!b&&!b.writes.length&&ordinaryClass(cls)&&!!cls.superClass&&
   !cls.body.body.some(m=>m.static&&m.computed)&&
   b.refs.every(r=>{const p=parents.get(r);return p?.type==='NewExpression'&&p.callee===r||p?.type==='BinaryExpression'&&p.operator==='instanceof'&&p.right===r;});
 }
 function instanceThis(n){
  let fn=parents.get(n);while(fn&&(!functions.has(fn.type)||fn.type==='ArrowFunctionExpression'))fn=parents.get(fn);
  const method=parents.get(fn);if(method?.type!=='MethodDefinition'||method.static)return false;
  let cls=parents.get(method);while(cls&&!['ClassDeclaration','ClassExpression'].includes(cls.type))cls=parents.get(cls);
  // Unknown inheritance may produce a callable instance (e.g. extends Function).
  return ordinaryClass(cls);
 }
 function constructedThis(n,fn){
  const b=fn?.type==='FunctionDeclaration'?bindings.get(fn.id):null;
  const member=parents.get(n);
  if(!b||b.writes.length||!b.refs.length||member?.type!=='MemberExpression'||member.object!==n||typeof property(member)!=='string'||property(member).startsWith('$'))return false;
  // Indirect constructor reflection could recover this function as a plain
  // call. Keep that case outside the closed-new proof.
  if(ix.nodes.some(r=>free(r,'Reflect')||r.type==='MemberExpression'&&(property(r)===undefined||property(r)==='constructor')))return false;
  let constructions=0;
  for(const ref of b.refs){
   const p=parents.get(ref),q=parents.get(p);
   if(p?.type==='NewExpression'&&p.callee===ref){
    const d=parents.get(p),instance=d?.type==='VariableDeclarator'&&d.init===p&&d.id.type==='Identifier'?bindings.get(d.id):null;
    if(instance&&(instance.writes.length||instance.refs.some(r=>{const m=parents.get(r);return m?.type!=='MemberExpression'||m.object!==r||typeof property(m)!=='string';})))return false;
    constructions++;continue;
   }
   if(p?.type==='MemberExpression'&&p.object===ref&&property(p)==='prototype'&&q?.type==='AssignmentExpression'&&q.operator==='='&&q.left===p&&q.right.type==='ObjectExpression')continue;
   if(p?.type==='Property'&&key(p)==='constructor'&&p.value===ref){
    const object=parents.get(p),assignment=parents.get(object),left=assignment?.left;
    if(assignment?.type==='AssignmentExpression'&&assignment.operator==='='&&assignment.right===object&&left?.type==='MemberExpression'&&property(left)==='prototype'&&bindings.get(left.object)===b)continue;
   }
   return false;
  }
  return constructions>0;
 }
 function staticFieldThis(n){
  const member=parents.get(n);
  if(member?.type!=='MemberExpression'||member.object!==n||typeof property(member)!=='string')return false;
  let field=null;
  for(let p=parents.get(member);p;p=parents.get(p)){
   if(p.type==='PropertyDefinition'){field=p;break;}
   // Arrow functions preserve the class-field initializer receiver. A nested
   // ordinary function would bind a new receiver and therefore cannot pass.
   if(functions.has(p.type)&&p.type!=='ArrowFunctionExpression')return false;
  }
  if(!field?.static)return false;
  let cls=parents.get(field);while(cls&&!['ClassDeclaration','ClassExpression'].includes(cls.type))cls=parents.get(cls);
  return !!cls&&cls.body.body.some(m=>m.type==='PropertyDefinition'&&m.static&&!m.computed&&key(m)===property(member));
 }
 function descriptorThis(n){
  if(staticFieldThis(n))return true;
  let fn=parents.get(n);while(fn&&(!functions.has(fn.type)||fn.type==='ArrowFunctionExpression'))fn=parents.get(fn);
  if(constructedThis(n,fn))return true;
  const assignment=parents.get(fn),left=assignment?.left;
  if(fn?.type==='FunctionExpression'&&assignment?.type==='AssignmentExpression'&&assignment.operator==='='&&assignment.right===fn&&left?.type==='MemberExpression'&&left.object.type==='MemberExpression'&&free(left.object.object,'Promise')&&property(left.object)==='prototype'&&property(left)==='delay'){const member=parents.get(n);return member?.type==='MemberExpression'&&member.object===n&&property(member)==='then';}
  if(fn?.type==='FunctionExpression'&&assignment?.type==='AssignmentExpression'&&assignment.operator==='='&&assignment.right===fn&&left?.type==='MemberExpression'&&left.object.type==='MemberExpression'&&free(left.object.object,'Object')&&property(left.object)==='prototype'&&typeof property(left)==='string'&&!['constructor','__proto__','toString','valueOf'].includes(property(left))){
   let strict=fn.body.body.some(s=>s.directive==='use strict');for(let p=parents.get(fn);p;p=parents.get(p))if(['ClassExpression','ClassDeclaration'].includes(p.type)||p.type==='Program'&&p.body.some(s=>s.directive==='use strict'))strict=true;
   const m=parents.get(n);return strict&&!(m?.type==='MemberExpression'&&m.object===n&&(typeof property(m)!=='string'||property(m).startsWith('$')));
  }
  const p=parents.get(fn),descriptor=parents.get(p),field=parents.get(descriptor),fields=parents.get(field),call=parents.get(fields);
  return stableObject&&p?.type==='Property'&&['get','set'].includes(key(p))&&descriptor?.type==='ObjectExpression'&&field?.type==='Property'&&fields?.type==='ObjectExpression'&&call?.type==='CallExpression'&&call.arguments[1]===fields&&call.callee.type==='MemberExpression'&&free(call.callee.object,'Object')&&property(call.callee)==='create';
 }
 function fact(test,receiver,truth){
  if(test.type==='SequenceExpression')return fact(test.expressions.at(-1),receiver,truth);
  if(truth&&test.type==='BinaryExpression'&&test.operator==='instanceof'&&same(test.left,receiver)&&errorConstructor(test.right))return true;
  if(test.type==='UnaryExpression'&&test.operator==='!')return fact(test.argument,receiver,!truth);
  if(test.type==='LogicalExpression'){
   // Both operands must hold on a true && / false || path.
   if(test.operator==='&&'&&truth||test.operator==='||'&&!truth)return fact(test.left,receiver,truth)||fact(test.right,receiver,truth);
   return false;
  }
  if(test.type==='BinaryExpression'&&['===','!==','==','!='].includes(test.operator)){
   const equal=['===','=='].includes(test.operator)===truth;
   for(const [a,b]of [[test.left,test.right],[test.right,test.left]])
    if(a.type==='UnaryExpression'&&a.operator==='typeof'&&same(a.argument,receiver)&&b.type==='Literal'&&equal&&['object','string','number','boolean','bigint','symbol','undefined'].includes(b.value))return true;
  }
  return false;
 }
 function safeToString(call){
  const receiver=call.callee.object;
  if(values.safeToStringReceiver(receiver))return true;
  if(receiver.type==='Identifier'&&bindings.has(receiver)){
   for(let p=parents.get(call);p;p=parents.get(p))if(p.type==='SwitchCase'){
    const sw=parents.get(p),t=sw?.type==='SwitchStatement'?sw.discriminant:null;
    const cases=sw?.cases??[],at=cases.indexOf(p),labels=[];
    for(let i=at;i>=0;i--){const c=cases[i];if(c.test?.type!=='Literal'||!['bigint','number','boolean','string'].includes(c.test.value))break;labels.push(c.test.value);if(i===at)continue;if(c.consequent.length)break;}
    if(t?.type==='UnaryExpression'&&t.operator==='typeof'&&t.argument.type==='Identifier'&&bindings.get(t.argument)===bindings.get(receiver)&&labels.includes('string'))return true;
    break;
   }
  }
  if(values.nonCallable(receiver)||libraries.nonCallable(receiver))return true;
  if(receiver.type==='Literal'||receiver.type==='ArrayExpression'||receiver.type==='ObjectExpression')return true;
  if(receiver.type==='ThisExpression')return instanceThis(receiver);
  if(receiver.type==='Identifier'&&stableBinding(receiver,true)){
   const init=bindings.get(receiver).init;
   const constructors=['URL','Date','Map','Set','WeakMap','WeakSet','RegExp','Array','Object','Error','TypeError','RangeError','ArrayBuffer','DataView','Uint8Array','Uint16Array','Uint32Array'];
   if(init?.type==='NewExpression'&&constructors.some(name=>free(init.callee,name))&&
      !ix.nodes.some(n=>free(n,init.callee.name)&&writtenThrough(n)))return true;
  }
  if(receiver.type==='Identifier'&&stableBinding(receiver)){
   for(let child=call,p=parents.get(child);p;child=p,p=parents.get(p)){
    if(functions.has(p.type))break;
    if(p.type==='ConditionalExpression'&&child!==p.test&&fact(p.test,receiver,child===p.consequent))return true;
    if(p.type==='IfStatement'&&child!==p.test&&fact(p.test,receiver,child===p.consequent))return true;
    if(p.type==='LogicalExpression'&&child===p.right&&fact(p.left,receiver,p.operator==='&&'))return true;
   }
  }
  return false;
 }
 function methodReceiver(n){
  let fn=parents.get(n);while(fn&&(!functions.has(fn.type)||fn.type==='ArrowFunctionExpression'))fn=parents.get(fn);
  if(!fn)return false;
  const syntax=parents.get(fn);
  if(syntax?.type==='MethodDefinition'||syntax?.type==='Property'&&syntax.method)return true;
  const id=fn.id??(syntax?.type==='VariableDeclarator'&&syntax.init===fn?syntax.id:null),binding=id&&bindings.get(id);
  if(!binding||binding.writes.length)return false;
  const refs=binding.refs.filter(ref=>!(ref.start>=fn.start&&ref.end<=fn.end));
  if(!refs.length)return false;
  for(const ref of refs){
   const propertyNode=parents.get(ref),object=parents.get(propertyNode);
   if(propertyNode?.type!=='Property'||propertyNode.value!==ref||object?.type!=='ObjectExpression')return false;
   const name=key(propertyNode),declaration=parents.get(object);
   if(typeof name!=='string'||declaration?.type!=='VariableDeclarator'||declaration.init!==object||declaration.id.type!=='Identifier')return false;
   if(object.properties.filter(p=>p.type==='Property'&&String(key(p))===name).length!==1)return false;
   const receiver=bindings.get(declaration.id);
   if(!receiver||receiver.writes.length||!receiver.refs.length)return false;
   for(const use of receiver.refs){
    const member=parents.get(use),call=parents.get(member),operation=parents.get(call),memberName=property(member);
    if(member?.type!=='MemberExpression'||member.object!==use||member.computed||typeof memberName!=='string')return false;
    if(memberName===name&&(call?.type!=='CallExpression'||call.callee!==member||call.optional||call.arguments.some(arg=>arg.type==='SpreadElement')))return false;
    if(operation?.type==='AssignmentExpression'&&operation.left===member||operation?.type==='UpdateExpression'||operation?.type==='UnaryExpression'&&operation.operator==='delete'){
     if(memberName===name)return false;
    }
   }
  }
  return true;
 }
 return {safeToString,descriptorThis,methodReceiver};
}
