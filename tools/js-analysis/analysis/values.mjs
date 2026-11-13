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
 function constructorBinding(fn){
  if(!fn)return null;
  const syntax=parents.get(fn);
  const id=fn.type==='FunctionDeclaration'?fn.id
   :fn.type==='FunctionExpression'&&syntax?.type==='VariableDeclarator'&&syntax.init===fn&&syntax.id.type==='Identifier'?syntax.id
   :fn.type==='FunctionExpression'&&syntax?.type==='AssignmentExpression'&&syntax.operator==='='&&syntax.right===fn&&syntax.left.type==='Identifier'?syntax.left
   :null;
  return id?bindings.get(id)??null:null;
 }
 function prototypeInstall(ref){
  // 构造函数原型上的成员安装：Ctor.prototype = {...} 或 Ctor.prototype.name = ...
  const p=parents.get(ref),q=parents.get(p);
  if(p?.type!=='MemberExpression'||p.object!==ref||property(p)!=='prototype')return false;
  if(q?.type==='AssignmentExpression'&&q.operator==='='&&q.left===p&&q.right.type==='ObjectExpression')return true;
  if(q?.type!=='MemberExpression'||q.object!==p||typeof property(q)!=='string')return false;
  const assignment=parents.get(q);
  return assignment?.type==='AssignmentExpression'&&assignment.operator==='='&&assignment.left===q;
 }
 function closedConstructor(b,instances=true){
  if(!b||b.writes.length||!b.refs.length)return false;
  let constructions=0;
  for(const ref of b.refs){
   const p=parents.get(ref),q=parents.get(p);
   if(p?.type==='NewExpression'&&p.callee===ref){
    if(instances){
     const d=parents.get(p),instance=d?.type==='VariableDeclarator'&&d.init===p&&d.id.type==='Identifier'?bindings.get(d.id):null;
     if(instance&&(instance.writes.length||instance.refs.some(r=>{const m=parents.get(r);return m?.type!=='MemberExpression'||m.object!==r||typeof property(m)!=='string';})))return false;
    }
    constructions++;continue;
   }
   if(prototypeInstall(ref))continue;
   if(p?.type==='Property'&&key(p)==='constructor'&&p.value===ref){
    const object=parents.get(p),assignment=parents.get(object),left=assignment?.left;
    if(assignment?.type==='AssignmentExpression'&&assignment.operator==='='&&assignment.right===object&&left?.type==='MemberExpression'&&property(left)==='prototype'&&bindings.get(left.object)===b)continue;
   }
   return false;
  }
  return constructions>0;
 }
 function constructedThis(n,fn){
  const b=constructorBinding(fn),member=parents.get(n);
  if(!b||member?.type!=='MemberExpression'||member.object!==n||typeof property(member)!=='string'||property(member).startsWith('$'))return false;
  // 间接的构造器反射可能把该函数当普通调用取回，因此显式使用 constructor
  // 或 Reflect 时否定这条证明。文件别处的动态成员键与当前绑定无关，而上面的
  // 引用集合已验证构造器没有其他逃逸路径。
  if(ix.nodes.some(r=>free(r,'Reflect')||r.type==='MemberExpression'&&property(r)==='constructor'))return false;
  return closedConstructor(b);
 }
 function prototypeMethodThis(n,fn){
  // Ctor.prototype.name = function(){...} 里的 this 是本地构造出的实例。
  const assignment=parents.get(fn);
  if(fn?.type!=='FunctionExpression'||assignment?.type!=='AssignmentExpression'||assignment.operator!=='='||assignment.right!==fn)return false;
  const left=assignment.left;
  if(left.type!=='MemberExpression'||typeof property(left)!=='string'||property(left)==='prototype'||property(left).startsWith('$'))return false;
  const prototype=left.object;
  if(prototype?.type!=='MemberExpression'||property(prototype)!=='prototype'||prototype.object.type!=='Identifier')return false;
  return closedConstructor(bindings.get(prototype.object),false);
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
  if(prototypeMethodThis(n,fn))return true;
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

// 从 regenerator `.wrap` 正文还原有限状态图。这里只做语法证明，不执行输入，
// 也不把“出现过 wrap 字符串”当作放行依据；阶段一只产出证明报告，不改变转换判定。
export function regeneratorStateMachine(ix,source){
 const {nodes,parents,bindings,owners,free}=ix;
 const UNKNOWN=Symbol('unknown');
 const controls=new Set(['prev','next','sent','method','arg','rval','delegate','done','tryEntries']);
 const abruptly=new Set(['return','throw','continue','break']);
 const lineOf=node=>source.slice(0,node.start).split('\n').length;
 const sameBinding=(a,b)=>!!a&&!!b&&bindings.get(a)===bindings.get(b);
 const unwrap=n=>n?.type==='ChainExpression'?n.expression:n;
 const staticName=n=>n?.type==='MemberExpression'?property(n):undefined;

 function objectLiteral(n,seen=new Set()){
  n=unwrap(n);
  if(!n||seen.has(n))return null;
  if(n.type==='ObjectExpression')return n;
  if(n.type!=='Identifier')return null;
  const binding=bindings.get(n);
  if(!binding||binding.writes.length||!binding.init||seen.has(binding))return null;
  const next=new Set(seen);next.add(binding);
  return objectLiteral(binding.init,next);
 }
 function objectProperty(object,name){
  if(!object)return UNKNOWN;
  let value;
  for(const entry of object.properties){
   if(entry.type!=='Property'||entry.kind!=='init'||key(entry)!==name)continue;
   if(value!==undefined)return UNKNOWN;
   value=entry.value;
  }
  return value??UNKNOWN;
 }
 function scalar(n,seen=new Set()){
  n=unwrap(n);
  if(!n||seen.has(n))return UNKNOWN;
  if(n.type==='Literal')return ['string','number','boolean'].includes(typeof n.value)?n.value:UNKNOWN;
  if(n.type==='TemplateLiteral'&&n.expressions.length===0)return n.quasis[0].value.cooked??UNKNOWN;
  if(n.type==='UnaryExpression'&&['+','-','~','!'].includes(n.operator)){
   const value=scalar(n.argument,new Set([...seen,n]));
   if(value===UNKNOWN)return UNKNOWN;
   return n.operator==='+' ? +value : n.operator==='-' ? -value : n.operator==='~' ? ~value : !value;
  }
  if(n.type==='BinaryExpression'&&n.operator==='+'){
   const left=scalar(n.left,new Set([...seen,n])),right=scalar(n.right,new Set([...seen,n]));
   return left===UNKNOWN||right===UNKNOWN?UNKNOWN:left+right;
  }
  if(n.type==='MemberExpression'){
   const name=staticName(n);if(name===undefined)return UNKNOWN;
   const value=objectProperty(objectLiteral(n.object,new Set([...seen,n])),name);
   return value===UNKNOWN?UNKNOWN:scalar(value,new Set([...seen,n]));
  }
  if(n.type==='Identifier'){
   const binding=bindings.get(n);
   if(!binding||binding.writes.length||!binding.init||seen.has(binding))return UNKNOWN;
   const next=new Set(seen);next.add(binding);
   return scalar(binding.init,next);
  }
  return UNKNOWN;
 }
 function stateValue(n){const value=scalar(n);return Number.isSafeInteger(value)&&value>=0||typeof value==='string'?value:null;}
 // 条件分支的测试值未知时，仍可枚举每个分支产生的状态常量。状态图只需要
 // 可能目标集合，不需要断言运行时选择；并集只会增加保守边，不会漏掉目标。
 // 只有所有可能返回值都是合法状态时才返回集合；未知对象、动态成员或含
 // 非状态分支的表达式保持不可证明。
 function stateTargets(n,seen=new Set()){
  n=unwrap(n);
  if(!n||seen.has(n))return null;
  const next=new Set([...seen,n]);
  if(n.type==='SequenceExpression')return stateTargets(n.expressions.at(-1),next);
  if(n.type==='ConditionalExpression'){
   const consequent=stateTargets(n.consequent,next),alternate=stateTargets(n.alternate,next);
   return consequent&&alternate?new Set([...consequent,...alternate]):null;
  }
  if(n.type==='LogicalExpression'){
   const left=stateTargets(n.left,next),right=stateTargets(n.right,next);
   return left&&right?new Set([...left,...right]):null;
  }
  const value=stateValue(n);
  return value===null?null:new Set([value]);
 }
 const stateId=state=>'state:'+String(state);
 function isThisLike(n){
  if(n?.type==='ThisExpression')return true;
  return n?.type==='CallExpression'&&n.arguments.length===1&&n.arguments[0].type==='ThisExpression'&&
   n.callee.type==='Identifier'&&free(n.callee,'sloppyThis');
 }
 function contextMember(n,param,name){
  if(n?.type!=='MemberExpression'||n.object.type!=='Identifier'||!sameBinding(n.object,param))return false;
  return name===undefined||property(n)===name;
 }
 function dispatchTest(n,param){
  n=unwrap(n);
  return n?.type==='AssignmentExpression'&&n.operator==='='&&contextMember(n.left,param,'prev')&&contextMember(n.right,param,'next');
 }
 function own(node,fn){return owners.get(node)===fn;}
 function functionTarget(callee,call){
  callee=unwrap(callee);
  if(callee?.type==='Identifier'){
   const binding=bindings.get(callee);
   if(!binding||binding.writes.length)return null;
   const fn=binding.fn??binding.init;
   if(!functions.has(fn?.type)||fn.async||fn.generator)return null;
   if(binding.refs.some(ref=>parents.get(ref)?.type!=='CallExpression'||parents.get(ref).callee!==ref))return null;
   return fn;
  }
  if(callee?.type==='MemberExpression'&&callee.object.type==='ObjectExpression'&&property(callee)!==undefined){
   const values=callee.object.properties.filter(p=>p.type==='Property'&&p.kind==='init'&&key(p)===property(callee));
   return values.length===1&&functions.has(values[0].value.type)?values[0].value:null;
  }
  return null;
 }
 function completionFunction(fn){
  if(!functions.has(fn?.type))return false;
  return nodes.some(n=>n.start>=fn.start&&n.end<=fn.end&&n.type==='CallExpression'&&free(n.callee,'$done'));
 }
 function finallyEffect(n,param){
  if(n.type==='CallExpression'){
   const callee=unwrap(n.callee);
   return !(callee?.type==='MemberExpression'&&contextMember(callee,param)&&['abrupt','finish','stop'].includes(property(callee)));
  }
  if(n.type==='AssignmentExpression')return !(n.left.type==='MemberExpression'&&contextMember(n.left,param));
  return ['UpdateExpression','AwaitExpression','YieldExpression','NewExpression','TaggedTemplateExpression'].includes(n.type)||
   n.type==='UnaryExpression'&&n.operator==='delete';
 }
 // finally 里的唯一直接完成调用是脚本退出动作，不是业务副作用。只有完成
 // 之后只剩状态控制（尤其 `finish(本 finally)`）时，它和普通 try/finally
 // 的退出语义等价；完成条件化、重复完成或后接业务调用都继续拒绝。
 const finallyStateControl=(n,param)=>n?.type==='AssignmentExpression'&&contextMember(n.left,param)&&['prev','next','sent'].includes(property(n.left))||
  n?.type==='CallExpression'&&n.callee.type==='MemberExpression'&&contextMember(n.callee,param)&&['abrupt','finish','stop'].includes(property(n.callee));
 const isCompletionCall=node=>{
  if(node?.type!=='CallExpression')return false;
  if(free(node.callee,'$done'))return true;
  if(node.callee.type!=='MemberExpression'||property(node.callee)!=='done'||node.callee.object.type!=='Identifier')return false;
  const receiver=bindings.get(node.callee.object);
  if(!receiver||receiver.writes.length||receiver.init?.type!=='NewExpression'||receiver.init.callee.type!=='Identifier')return false;
  const constructor=bindings.get(receiver.init.callee),fn=constructor?.fn??constructor?.init;
  if(!functions.has(fn?.type)||fn.async||fn.generator)return false;
  return nodes.some(n=>n.start>=fn.start&&n.end<=fn.end&&(n.type==='MethodDefinition'||n.type==='Property')&&key(n)==='done'&&
   (n.value.type==='FunctionExpression'||n.value.type==='FunctionDeclaration'||n.value.type==='ArrowFunctionExpression')&&
   nodes.some(call=>call.type==='CallExpression'&&free(call.callee,'$done')&&call.start>=n.value.start&&call.end<=n.value.end));
 };
 function safeFinallyCompletion(node,clause,param,ownerFn){
  if(!isCompletionCall(node)||owners.get(node)!==ownerFn)return false;
  if(node.arguments.length>1||node.arguments.some(argument=>argument.type!=='ObjectExpression'))return false;
  const completions=nodes.filter(n=>n.start>=clause.start&&n.end<=clause.end&&owners.get(n)===ownerFn&&isCompletionCall(n));
  if(completions.length!==1)return false;
  let current=node;
  for(;;){
   const parent=parents.get(current);
   if(!parent)return false;
   if(parent.type==='SequenceExpression'){
    const index=parent.expressions.indexOf(current);
    if(index<0||!parent.expressions.slice(index+1).every(expression=>finallyStateControl(expression,param)))return false;
    current=parent;continue;
   }
   if(parent.type==='ReturnStatement'&&parent.argument===current)return finallyStateControl(parent.argument.type==='SequenceExpression'?parent.argument.expressions.at(-1):parent.argument,param);
   if(parent.type==='ParenthesizedExpression'||parent.type==='ExpressionStatement'){current=parent;continue;}
   return false;
  }
 }
 function handlerEffect(n,param){
  // 异常处理区域只允许状态控制；业务调用、完成调用、对象写入、
  // 异常抛出和异步挂起都保持拒绝。
  if(n.type==='CallExpression'){
   const callee=unwrap(n.callee);
   return !(callee?.type==='MemberExpression'&&contextMember(callee,param)&&['abrupt','stop'].includes(property(callee)));
  }
  if(n.type==='AssignmentExpression')return !(n.left.type==='MemberExpression'&&contextMember(n.left,param)&&['prev','next','sent'].includes(property(n.left)));
  if(n.type==='UpdateExpression')return true;
  return ['AwaitExpression','YieldExpression','NewExpression','TaggedTemplateExpression','ThrowStatement'].includes(n.type)||
   n.type==='UnaryExpression'&&n.operator==='delete';
 }
 function mayCompleteNormally(statement){
  if(!statement)return true;
  if(['ReturnStatement','ThrowStatement','BreakStatement','ContinueStatement'].includes(statement.type))return false;
  if(statement.type==='BlockStatement')return mayCompleteNormally(statement.body.at(-1));
  if(statement.type==='IfStatement')return mayCompleteNormally(statement.consequent)||mayCompleteNormally(statement.alternate);
  if(statement.type==='LabeledStatement')return mayCompleteNormally(statement.body);
  if(statement.type==='TryStatement')return !statement.finalizer||mayCompleteNormally(statement.finalizer);
  return true;
 }

 const runtimeInfo=(()=>{
  const required=new Set(['wrap','_invoke','abrupt','tryEntries','prev','next','mark','stop']);
  const containers=nodes.filter(n=>functions.has(n.type));
  let best=null;
  for(const container of containers){
   const found=new Set();
   for(const n of nodes){
    if(n.start<container.start||n.end>container.end)continue;
    const name=n.type==='MemberExpression'?property(n):(n.type==='Property'||n.type==='MethodDefinition')?key(n):undefined;
    if(required.has(name))found.add(name);
   }
   if(found.size!==required.size)continue;
   const size=container.end-container.start;
   if(!best||size<best.size)best={container,size};
  }
  if(!best)return {proved:false,gaps:['未识别完整的 regenerator 运行时契约'],driveCount:0};
  const container=best.container,gaps=[];
  const ranged=node=>node.start>=container.start&&node.end<=container.end;
  const stateFunctions=nodes.filter(n=>ranged(n)&&functions.has(n.type)&&nodes.some(c=>c.start>=n.start&&c.end<=n.end&&c.type==='MemberExpression'&&isThisLike(c.object)&&controls.has(String(property(c)))));
  const invokeNodes=nodes.filter(n=>ranged(n)&&(n.type==='MemberExpression'&&property(n)==='_invoke'||(n.type==='Property'||n.type==='MethodDefinition')&&key(n)==='_invoke'));
  if(!stateFunctions.length)gaps.push('运行时没有可识别的上下文状态函数');
  if(!invokeNodes.length)gaps.push('运行时缺少 _invoke 分派链接');
  const driveCalls=nodes.filter(n=>n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&['next','throw','return'].includes(property(n.callee)));
  const internal=driveCalls.filter(ranged),external=driveCalls.filter(n=>!ranged(n));
  if(!driveCalls.length)gaps.push('状态机没有 next/step 驱动点');
  // 标准 for-of 降级会先把可迭代对象取成 iterator 方法，再调用该方法得到
  // 一个封闭的 iterator。该 iterator 的 next/return 仍属于局部循环驱动，
  // 不是状态机生成器逃逸。只有初始化/赋值始终来自迭代器协议、全部引用都
  // 留在同一闭包内，且没有把绑定改成 wrap 生成结果时才放行。
  const iteratorLookup=node=>{
   if(node?.type!=='MemberExpression')return null;
   if(!node.computed&&node.property?.name==='@@iterator')return node.object;
   if(node.computed&&node.property?.type==='Literal'&&node.property.value==='@@iterator')return node.object;
   if(node.computed&&node.property?.type==='MemberExpression'&&free(node.property.object,'Symbol')&&property(node.property)==='iterator')return node.object;
   return null;
  };
  const iteratorSources=node=>{
   if(!node)return [];
   if(iteratorLookup(node))return [iteratorLookup(node)];
   if(node.type==='LogicalExpression')return [...iteratorSources(node.left),...iteratorSources(node.right)];
   if(node.type==='ConditionalExpression')return [...iteratorSources(node.consequent),...iteratorSources(node.alternate)];
   return [];
  };
  const sameValue=(a,b)=>{
   a=unwrap(a);b=unwrap(b);
   if(!a||!b)return false;
   if(a.type==='Identifier'&&b.type==='Identifier')return bindings.get(a)===bindings.get(b);
   return a.start===b.start&&a.end===b.end;
  };
  const iteratorProtocolBinding=binding=>{
   if(!binding?.init)return false;
   const sources=iteratorSources(binding.init);
   if(!sources.length||!sources.every(source=>sameValue(source,sources[0])))return false;
   const owner=owners.get(binding.init);
   if(!functions.has(owner?.type))return false;
   const insideOwner=node=>{const current=owners.get(node);return current===owner||functions.has(current?.type)&&current.start>=owner.start&&current.end<=owner.end;};
   // wrap 调用或生成器函数的结果不是迭代器协议对象；重新赋成这类值会
   // 把外部驱动重新变成状态机逃逸，必须继续拒绝。
   const generatorValue=node=>nodes.some(n=>n.start>=node.start&&n.end<=node.end&&
    (n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&property(n.callee)==='wrap'||
     functions.has(n.type)&&n.generator));
   for(const write of binding.writes){
    if(write.type!=='AssignmentExpression'||write.operator!=='='||write.left.type!=='Identifier'||bindings.get(write.left)!==binding)return false;
    if(!insideOwner(write)||write.right.type!=='CallExpression'||generatorValue(write.right))return false;
   }
   for(const ref of binding.refs){
    const parent=parents.get(ref),use=parents.get(parent);
    if(parent?.type==='AssignmentExpression'&&parent.left===ref||!insideOwner(ref))continue;
    if(parent?.type==='MemberExpression'&&parent.object===ref){
     if(['call','next','throw','return'].includes(String(property(parent))))continue;
     return false;
    }
    if(parent?.type==='UnaryExpression'&&['!','typeof'].includes(parent.operator))continue;
    if(parent?.type==='BinaryExpression'||parent?.type==='LogicalExpression')continue;
    if(['IfStatement','WhileStatement','DoWhileStatement','ConditionalExpression'].includes(parent?.type)&&parent.test===ref)continue;
    // for-of 降级在数组回退分支里执行 `source = iterator`。仅允许写入同一
    // 闭包内的局部绑定；一旦写进外层、返回或作为参数传给未知函数仍拒绝。
    if(parent?.type==='AssignmentExpression'&&parent.right===ref&&parent.left.type==='Identifier') {
     const target=bindings.get(parent.left);
     if(target&&insideOwner(parent.left)&&target.refs.every(insideOwner))continue;
    }
    if(use?.type==='ExpressionStatement'&&use.expression===ref)continue;
    return false;
   }
   return true;
  };
  for(const call of external){
   const object=unwrap(call.callee.object);
   if(object.type==='Identifier'){
    const binding=bindings.get(object);
    const protocol=!!binding&&iteratorProtocolBinding(binding);
    const escaped=!binding||!protocol&&(binding.writes.length||binding.refs.some(ref=>{
     const parent=parents.get(ref);
     if(parent?.type==='MemberExpression'&&parent.object===ref)return !['next','throw','return'].includes(property(parent));
     if(parent?.type==='ConditionalExpression'||parent?.type==='LogicalExpression'||parent?.type==='IfStatement')return false;
     return true;
    }));
    if(escaped){
     gaps.push('generator 对象逃逸或被外部驱动：第 '+lineOf(call)+' 行');continue;
    }
   }else if(!(object.type==='CallExpression'&&object.callee.type==='MemberExpression'&&property(object.callee)==='wrap')){
    gaps.push('generator 对象以不可证明形状被外部驱动：第 '+lineOf(call)+' 行');
   }
  }
  return {proved:gaps.length===0,gaps,container,driveCount:driveCalls.length,internalDrives:internal.length,externalDrives:external.length};
 })();

 const wrapCalls=nodes.filter(n=>n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&property(n.callee)==='wrap'&&n.arguments.length>=2&&functions.has(n.arguments[0]?.type));
 const machines=[];
 for(const call of wrapCalls){
  const fn=call.arguments[0],param=fn.params[0];
  const gaps=[];
  if(param?.type!=='Identifier')gaps.push('状态机正文首参数不是可追踪上下文');
  const switches=param?.type==='Identifier'?nodes.filter(n=>own(n,fn)&&n.type==='SwitchStatement'&&dispatchTest(n.discriminant,param)):[];
  if(switches.length!==1)gaps.push('状态机有 '+switches.length+' 个分派入口');
  const dispatch=switches[0];
  const cases=dispatch?.cases??[];
  const labels=[],caseByState=new Map();
  for(const clause of cases){
   if(!clause.test){gaps.push('状态分派含 default 分支');continue;}
   const state=stateValue(clause.test);
   if(state===null){gaps.push('状态分派含非有限 case 标签：第 '+lineOf(clause)+' 行');continue;}
   if(caseByState.has(state)){gaps.push('状态 '+state+' 有多个 case 标签');continue;}
   caseByState.set(state,clause);labels.push(state);
  }
  const states=new Set(labels),edges=[],terminals=[];
  const addEdge=(from,to,kind,node,value)=>edges.push({from,to,kind,line:node?lineOf(node):undefined,...(value!==undefined?{value}:{})});
  const addTerminal=(id,kind,node)=>terminals.push({id,kind,line:node?lineOf(node):undefined});
  if(!states.has(0))gaps.push('状态图没有唯一入口状态 0');
  addEdge('invoke',stateId(0),'next',call,'undefined');
  const prevOwners=new Map();
  for(const [state,clause] of caseByState){
   for(const n of nodes){
    if(n.start<clause.start||n.end>clause.end||owners.get(n)!==fn||n.type!=='AssignmentExpression'||n.operator!=='='||!contextMember(n.left,param,'prev'))continue;
    const saved=stateValue(n.right);
    if(saved===null){gaps.push('状态 '+state+' 的 prev 保存值不可证明：第 '+lineOf(n)+' 行');continue;}
    if(!prevOwners.has(saved))prevOwners.set(saved,new Set());
    prevOwners.get(saved).add(state);
   }
  }

  const contextOwners=new Set(),checkedContextBindings=new Set();
  function checkContextBinding(contextParam,ownerFn){
   const binding=contextParam?.type==='Identifier'?bindings.get(contextParam):null;
   if(!binding||checkedContextBindings.has(binding))return;
   checkedContextBindings.add(binding);
   for(const ref of binding.refs){
    if(ref.start<fn.start||ref.end>fn.end){gaps.push('状态上下文逃逸出状态机正文：第 '+lineOf(ref)+' 行');continue;}
    const parent=parents.get(ref);
    if(parent?.type==='MemberExpression'&&parent.object===ref&&property(parent)!==undefined){
     const owner=owners.get(ref);if(owner&&owner!==ownerFn)contextOwners.add(owner);continue;
    }
    if(parent?.type==='CallExpression'&&parent.arguments.includes(ref)){
     const target=functionTarget(parent.callee,parent);
     if(target)continue;
    }
    gaps.push('状态上下文存在别名或未知逃逸：第 '+lineOf(ref)+' 行');
   }
  }
  checkContextBinding(param,fn);

  const transitionSeen=new Set(),visitedFunctions=new Set();
  function collectTransitions(state,start,end,ownerFn,contextParam,seenFunctions=new Set()){
   const key=state+':'+start+':'+ownerFn.start;
   if(transitionSeen.has(key))return;transitionSeen.add(key);
   const nextWrites=[],controlCalls=[],returns=[],throws=[],calls=[];
   for(const n of nodes){
    if(n.start<start||n.end>end||owners.get(n)!==ownerFn)continue;
    if(n.type==='AssignmentExpression'&&n.left.type==='MemberExpression'&&contextMember(n.left,contextParam)){
     const name=property(n.left);
     if(name==='next')nextWrites.push(n);
    }
    if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&contextMember(n.callee,contextParam)&&['abrupt','finish','stop'].includes(property(n.callee)))controlCalls.push(n);
    if(n.type==='CallExpression')calls.push(n);
    if(n.type==='ReturnStatement')returns.push(n);
    if(n.type==='ThrowStatement')throws.push(n);
   }
   for(const write of nextWrites){
    const targets=stateTargets(write.right);
    if(targets===null||[...targets].some(target=>!states.has(target)))gaps.push('状态 '+state+' 的 next 目标不可证明：第 '+lineOf(write)+' 行');
    else for(const target of targets)addEdge(stateId(state),stateId(target),'next',write,source.slice(write.right.start,write.right.end));
   }
   for(const control of controlCalls){
    const name=property(control.callee);
    if(name==='stop'){const id='stop:'+control.start;addTerminal(id,'return',control);addEdge(stateId(state),id,'return',control);continue;}
    if(name==='finish'){
     const target=control.arguments[0]?stateValue(control.arguments[0]):null;
     if(target===null||!states.has(target))gaps.push('状态 '+state+' 的 finish 目标不可证明：第 '+lineOf(control)+' 行');
     else addEdge(stateId(state),stateId(target),'finish',control,String(target));
     continue;
    }
    const type=control.arguments[0]?scalar(control.arguments[0]):'return';
    if(!abruptly.has(type)){gaps.push('状态 '+state+' 的 abrupt 类型不可证明：第 '+lineOf(control)+' 行');continue;}
    if(type==='continue'||type==='break'){
     const target=control.arguments[1]?stateValue(control.arguments[1]):null;
     if(target===null||!states.has(target))gaps.push('状态 '+state+' 的 abrupt '+type+' 目标不可证明：第 '+lineOf(control)+' 行');
     else addEdge(stateId(state),stateId(target),'abrupt-'+type,control,String(target));
    }else{
     const id=type+':'+control.start;addTerminal(id,type,control);addEdge(stateId(state),id,type,control);
    }
   }
   if(ownerFn===fn)for(const ret of returns){
    if(ret.argument?.type==='CallExpression'&&ret.argument.callee.type==='MemberExpression'&&contextMember(ret.argument.callee,param)&&['abrupt','stop','finish'].includes(property(ret.argument.callee)))continue;
    const id='return:'+ret.start;addTerminal(id,'return',ret);addEdge(stateId(state),id,'return',ret);
   }
   if(ownerFn===fn)for(const thrown of throws){const id='throw:'+thrown.start;addTerminal(id,'throw',thrown);addEdge(stateId(state),id,'throw',thrown);}
   for(const n of calls){
    const target=functionTarget(n.callee,n);
    // 原生完成调用会终止入口；状态内直接调用 `$done` 后不需要再为同一
    // 状态虚构 next 边。完成点仍由消费方单独校验，这里只补一个显式终止
    // 边，避免把合法的完成后 break 误判为缺口。闭合包装函数可能只在部分
    // 分支完成，不能仅凭函数体出现过 `$done` 就视为无条件终止。
    if(free(n.callee,'$done')){
     const id='completion:'+n.start;addTerminal(id,'completion',n);addEdge(stateId(state),id,'completion',n);continue;
    }
    const contextArgs=n.arguments.map((arg,index)=>sameBinding(unwrap(arg),contextParam)?index:-1).filter(index=>index>=0);
    if(contextArgs.length>1)gaps.push('状态上下文通过多个实参传入调用：第 '+lineOf(n)+' 行');
    if(!target&&contextArgs.length)gaps.push('状态上下文传入未知调用：第 '+lineOf(n)+' 行');
    if(!target||seenFunctions.has(target))continue;
    visitedFunctions.add(target);
    const nested=new Set(seenFunctions);nested.add(target);
    let targetContext=contextParam;
    if(contextArgs.length===1){
     targetContext=target.params[contextArgs[0]];
     if(targetContext?.type!=='Identifier'){gaps.push('状态上下文传入的形参不是可追踪标识符：第 '+lineOf(n)+' 行');targetContext=null;}
     else checkContextBinding(targetContext,target);
    }
    collectTransitions(state,target.start,target.end,target,targetContext,nested);
   }
  }
  for(let i=0;i<cases.length;i++){
   const clause=cases[i],state=stateValue(clause.test);
   if(state===null)continue;
   collectTransitions(state,clause.start,clause.end,fn,param);
   if(i>0&&mayCompleteNormally(cases[i-1].consequent.at(-1))){const previous=stateValue(cases[i-1].test);if(previous!==null)addEdge(stateId(previous),stateId(state),'fallthrough',clause);}
  }
  for(const captured of contextOwners)if(!visitedFunctions.has(captured))gaps.push('访问状态上下文的函数未证明为封闭调用：第 '+lineOf(captured)+' 行');

  for(const n of nodes){
   if(n.start<fn.start||n.end>fn.end||n.type!=='AssignmentExpression'||n.left.type!=='MemberExpression')continue;
   if(n.left.object.type==='Identifier'&&sameBinding(n.left.object,param)&&property(n.left)===undefined)gaps.push('状态上下文存在动态属性写入：第 '+lineOf(n)+' 行');
  }

  const tryNode=call.arguments[3];
  const exceptionEntries=[];
  let exceptionFinally=false;
  if(tryNode){
   let table=unwrap(tryNode);
   if(table.type==='Identifier'){
    const binding=bindings.get(table);table=binding&&!binding.writes.length?unwrap(binding.init):null;
   }
   if(table?.type==='Literal'&&table.value===null)table=null;
   if(table&&table.type!=='ArrayExpression')gaps.push('异常表不是有限数组');
   const entries=table?.elements??[];
   // 条目数超过状态数必然存在无法映射的 try/handler 状态。
   if(table?.type==='ArrayExpression'&&entries.length>states.size)gaps.push('异常表条目数与状态数不一致：'+entries.length+' > '+states.size);
   const seenTryLocs=new Set();
   for(const entry of entries){
    if(entry?.type!=='ArrayExpression'||entry.elements.length<2||entry.elements.length===3||entry.elements.length>4){gaps.push('异常表条目形状未知：第 '+lineOf(entry??table)+' 行');continue;}
    const values=entry.elements.map(stateValue);
    if(values.some(value=>value===null)){gaps.push('异常表含非有限状态：第 '+lineOf(entry)+' 行');continue;}
    const [tryLoc,catchLoc,finallyLoc,afterLoc]=values;
    if(seenTryLocs.has(tryLoc))gaps.push('异常表 try 保存点重复：'+tryLoc);
    else seenTryLocs.add(tryLoc);
    const tryOwners=prevOwners.get(tryLoc),tryOrigin=tryOwners?.size===1?[...tryOwners][0]:null;
    if(tryOwners?.size>1)gaps.push('异常表 try 保存点对应多个状态：'+tryLoc);
    else if(tryOrigin===null)gaps.push('异常表 try 保存点不在状态图中：'+tryLoc);
    for(const [name,target] of [['catch',catchLoc],['finally',finallyLoc],['after',afterLoc]])if(target!==undefined&&target!==null&&!states.has(target))gaps.push('异常表 '+name+' 目标不在状态图中：'+target);
    if(tryOrigin!==null&&catchLoc!==undefined&&catchLoc!==null){
     addEdge(stateId(tryOrigin),stateId(catchLoc),'exception',entry,String(catchLoc));
     exceptionEntries.push({tryLoc,catchLoc,finallyLoc,afterLoc,line:lineOf(entry)});
    }
    if(finallyLoc!==undefined&&finallyLoc!==null){
     exceptionFinally=true;
     if(afterLoc===undefined||afterLoc===null)gapFinally();
     else{
      if(tryOrigin!==null)addEdge(stateId(tryOrigin),stateId(finallyLoc),'exception-finally',entry,String(finallyLoc));
      addEdge(stateId(finallyLoc),stateId(afterLoc),'finally-resume',entry,String(afterLoc));
      for(const [state,clause] of caseByState)if(state>=finallyLoc&&state<afterLoc){
       for(const n of nodes)if(n.start>=clause.start&&n.end<=clause.end&&finallyEffect(n,param)&&!safeFinallyCompletion(n,clause,param,fn))gaps.push('finally 区域含可观察副作用：状态 '+state+'，第 '+lineOf(n)+' 行');
      }
     }
    }
   }
   // 标准 regenerator 的 `finish(finallyLoc)` 会完成 finally 并恢复到
   // afterLoc，而不是跳回 finally 状态本身。按异常表修正该控制边，避免把
   // 每个 finally 都误判成自环。
   const finallyAfter=new Map(exceptionEntries.filter(entry=>entry.finallyLoc!==undefined&&entry.finallyLoc!==null&&entry.afterLoc!==undefined&&entry.afterLoc!==null).map(entry=>[entry.finallyLoc,entry.afterLoc]));
   for(const edge of edges)if(edge.kind==='finish'){
    const after=finallyAfter.get(Number(edge.value));
    if(after!==undefined){edge.to=stateId(after);edge.kind='finally-finish';edge.value=String(after);}
   }
  }
  function gapFinally(){gaps.push('finally 条目缺少 afterLoc');}

  const slots=new Map();
  const addSlot=(name,kind,writes)=>{const previous=slots.get(name);if(previous)previous.writes.push(...writes);else slots.set(name,{name,kind,writes:[...writes]});};
  for(const name of controls){
   const writes=nodes.filter(n=>n.start>=fn.start&&n.end<=fn.end&&n.type==='AssignmentExpression'&&n.left.type==='MemberExpression'&&contextMember(n.left,param,name));
   if(writes.length)addSlot('ctx.'+name,'control',writes.map(n=>({line:lineOf(n),offset:n.start})));
  }
  for(const n of nodes){
   if(n.start<fn.start||n.end>fn.end)continue;
   let name=null,writes=[],fnValue=null,slotBinding=null;
   if(n.type==='VariableDeclarator'&&n.id.type==='Identifier'&&completionFunction(n.init)){
    name=n.id.name;fnValue=n.init;slotBinding=bindings.get(n.id);writes=[n];if(slotBinding)writes.push(...slotBinding.writes);
   }else if(n.type==='AssignmentExpression'&&n.left.type==='Identifier'&&completionFunction(n.right)){
    name=n.left.name;fnValue=n.right;slotBinding=bindings.get(n.left);writes=[n];if(slotBinding)writes.push(...slotBinding.writes);
   }
   if(!name)continue;
   addSlot(name,'completion',writes.map(w=>({line:lineOf(w),offset:w.start})));
   if(writes.length!==1)gaps.push('保存槽 '+name+' 有多个写入点');
   if(slotBinding&&slotBinding.refs.some(ref=>{
    if(ref.start>=fnValue.start&&ref.end<=fnValue.end)return false;
    const parent=parents.get(ref);
    if(parent?.type==='CallExpression'&&parent.callee===ref)return false;
    return true;
   }))gaps.push('保存槽 '+name+' 逃逸出封闭调用位置');
  }

  // 极简模式允许无 finally 的 catch 边，但要求 try 范围数值有序、
  // handler 目标可达且 handler 区域没有业务副作用。
  // 这里只产出可放行判据；真正的源码改写由 transforms/specialization.mjs 完成。
  const minimalGaps=[];
  const innerNodes=nodes.filter(n=>n.start>=fn.start&&n.end<=fn.end);
  if(exceptionFinally||edges.some(edge=>['exception-finally','finally-resume'].includes(edge.kind)))minimalGaps.push('极简模式不支持 finally 块');
  if(exceptionEntries.some(entry=>typeof entry.tryLoc!=='number'||typeof entry.catchLoc!=='number'))minimalGaps.push('极简模式异常表要求数值状态');
  if(exceptionEntries.some(entry=>entry.tryLoc>=entry.catchLoc))minimalGaps.push('极简模式异常表 try 范围顺序不成立');
  if(terminals.some(terminal=>terminal.kind==='throw'))minimalGaps.push('极简模式包含显式抛出终止');
  if(innerNodes.some(n=>n.type==='TryStatement'||n.type==='AwaitExpression'||n.type==='YieldExpression'))minimalGaps.push('极简模式包含异常或异步挂起点');
  if(innerNodes.some(n=>n.type==='ThisExpression'))minimalGaps.push('极简模式正文读取 this');
  if(innerNodes.some(n=>n.type==='Identifier'&&n.name==='arguments'&&free(n,'arguments')))minimalGaps.push('极简模式正文读取 arguments');
  for(const n of innerNodes){
   if(n.type==='MemberExpression'&&contextMember(n,param)&&!['prev','next','sent','stop','abrupt'].includes(String(property(n)))){
    minimalGaps.push('极简模式包含未支持的上下文成员：'+String(property(n)));
    break;
   }
   if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&contextMember(n.callee,param)){
    const name=property(n.callee);
    if(name==='abrupt'){
     const type=n.arguments[0]?scalar(n.arguments[0]):null;
     if(type!=='return'){minimalGaps.push('极简模式仅支持 abrupt return');break;}
    }else if(name!=='stop'){
     minimalGaps.push('极简模式包含未支持的上下文调用：'+String(name));
     break;
    }
   }
  }
  for(const n of innerNodes){
   if(n.type!=='ReturnStatement'||owners.get(n)!==fn||!n.argument)continue;
   const arg=n.argument;
   if(arg.type==='CallExpression'&&arg.callee.type==='MemberExpression'&&contextMember(arg.callee,param)&&['stop','abrupt'].includes(property(arg.callee)))continue;
   minimalGaps.push('极简模式包含异步挂起返回：第 '+lineOf(n)+' 行');
   break;
  }
  const minimalDoneRefs=innerNodes.filter(n=>n.type==='Identifier'&&n.name==='$done'&&free(n,'$done'));
  if(minimalDoneRefs.length!==1){
   minimalGaps.push('极简模式要求恰好一个完成调用');
  }else{
   const ref=minimalDoneRefs[0],parent=parents.get(ref);
   if(!(parent?.type==='CallExpression'&&parent.callee===ref)){
    let slot=null,write=null,assignment=false;
    if(parent?.type==='VariableDeclarator'&&parent.init===ref&&parent.id.type==='Identifier'){
     slot=parent.id;write=parent;
    }else if(parent?.type==='AssignmentExpression'&&parent.operator==='='&&parent.right===ref&&parent.left.type==='Identifier'){
     slot=parent.left;write=parent;assignment=true;
    }
    if(!slot){
     minimalGaps.push('极简模式完成函数必须直接调用或保存到单一标识符');
    }else{
     const binding=bindings.get(slot);
     if(!binding||(assignment?(binding.writes.length!==1||binding.writes[0]!==write):binding.writes.length!==0))minimalGaps.push('极简模式保存槽有多个写入点');
     else if(binding.refs.length!==1)minimalGaps.push('极简模式保存槽逃逸出封闭调用位置');
     else{
      const use=parents.get(binding.refs[0]);
      if(!(use?.type==='CallExpression'&&use.callee===binding.refs[0]))minimalGaps.push('极简模式保存槽不是直接调用');
     }
    }
   }
  }
  for(const slot of slots.values())if(slot.kind==='completion'&&slot.writes.length!==1)minimalGaps.push('极简模式保存槽 '+slot.name+' 有多个写入点');

  const stateNodes=[...states].sort((a,b)=>typeof a===typeof b?(a<b?-1:a>b?1:0):typeof a==='number'?-1:1).map(state=>({id:stateId(state),kind:'restore',state,line:lineOf(caseByState.get(state))}));
  const graphNodes=[{id:'invoke',kind:'dispatch',line:runtimeInfo.container?lineOf(runtimeInfo.container):lineOf(fn)},...stateNodes,...terminals];
  const adjacency=new Map();
  for(const edge of edges){if(!adjacency.has(edge.from))adjacency.set(edge.from,[]);adjacency.get(edge.from).push(edge.to);}
  const queue=['invoke'],seen=new Set(queue);
  while(queue.length){const from=queue.shift();for(const to of adjacency.get(from)??[]){if(!seen.has(to)){seen.add(to);queue.push(to);}}}
  const deadStates=[...states].filter(state=>!seen.has(stateId(state)));
  const deadTerminals=terminals.filter(terminal=>!seen.has(terminal.id)).map(terminal=>terminal.id);
  // 不可达状态/终止节点只影响“整图都必须可达”的严格放行；完成消费方另用
  // deadReachabilityProved 证明它们确实是死代码，不把消息文本当放行依据。
  const reachabilityGaps=[];
  if(deadStates.length){const gap='状态从单一入口不可达：'+deadStates.join('、');gaps.push(gap);reachabilityGaps.push(gap);}
  if(deadTerminals.length){const gap='终止节点从单一入口不可达：'+deadTerminals.length+' 个';gaps.push(gap);reachabilityGaps.push(gap);}
  for(const state of states)if(!(adjacency.get(stateId(state))?.length))gaps.push('状态 '+state+' 没有可证明的出边');
  if(!terminals.length)gaps.push('状态图没有返回点或异常终止点');
  const stateByNodeId=new Map([...states].map(state=>[stateId(state),state]));
  const handlerStates=new Set();
  for(const entry of exceptionEntries){
   if(!seen.has(stateId(entry.catchLoc))){minimalGaps.push('极简模式异常处理目标状态不可达：'+entry.catchLoc);continue;}
   // catch 区域的边界按 switch case 的 fallthrough 链计算；显式 next 跳转属于恢复流程。
   const region=new Set([entry.catchLoc]),pending=[entry.catchLoc];
   while(pending.length){
    const state=pending.shift();
    for(const edge of edges)if(edge.from===stateId(state)&&edge.kind==='fallthrough'){
     const target=stateByNodeId.get(edge.to);
     if(target!==undefined&&!region.has(target)){region.add(target);pending.push(target);}
    }
   }
   for(const state of region)handlerStates.add(state);
  }
  const handlerEffects=[],handlerMinimalGaps=[];
  for(const state of handlerStates){
   const clause=caseByState.get(state);if(!clause)continue;
   for(const n of nodes)if(n.start>=clause.start&&n.end<=clause.end&&own(n,fn)&&handlerEffect(n,param)){
    const gap='极简模式异常处理区域含业务副作用：状态 '+state+'，第 '+lineOf(n)+' 行';
    minimalGaps.push(gap);handlerMinimalGaps.push(gap);
    handlerEffects.push({state,line:lineOf(n)});
    break;
   }
  }
  const uniqueMinimalGaps=[...new Set(minimalGaps)];
  const uniqueHandlerMinimalGaps=new Set(handlerMinimalGaps);
  // 除异常处理副作用之外仍存在的极简缺口；为空表示该机器只因 handler
  // 副作用而无法走极简降级，完成消费方不能越过这条既有拒收边界。
  const nonHandlerMinimalGaps=uniqueMinimalGaps.filter(gap=>!uniqueHandlerMinimalGaps.has(gap));
  const uniqueGaps=[...new Set([...gaps,...runtimeInfo.gaps])];
  const uniqueReachabilityGaps=[...new Set(reachabilityGaps)];
  // 完成回调只有在状态图无环时才能保证单个静态完成点至多执行一次。
  // 终止节点不参与环检测；未可达状态已由 gaps 拒绝。
  const terminalIds=new Set(terminals.map(terminal=>terminal.id));
  let cyclic=false;const active=new Set(),finished=new Set();
  const visitState=id=>{
   if(finished.has(id))return;
   if(active.has(id)){cyclic=true;return;}
   active.add(id);
   for(const target of adjacency.get(id)??[])if(!terminalIds.has(target))visitState(target);
   active.delete(id);finished.add(id);
  };
  visitState('invoke');
  // 仅当运行时契约完整、唯一阻塞是死状态/死终止点且入口子图无环时，
  // 完成消费方才能把不可达节点视为真正死代码。
  const deadReachabilityProved=runtimeInfo.proved&&!cyclic&&terminals.length>0&&
   uniqueGaps.length===uniqueReachabilityGaps.length;
  machines.push({line:lineOf(call),entryState:0,wrapStart:call.start,wrapEnd:call.end,callbackStart:fn.start,callbackEnd:fn.end,dispatchStart:dispatch?.start,dispatchEnd:dispatch?.end,acyclic:!cyclic,proved:uniqueGaps.length===0,deadReachabilityProved,handlerEffects,nonHandlerMinimalGaps,gaps:uniqueGaps,nodes:graphNodes,edges,
   cases:cases.map(clause=>({state:stateValue(clause.test),start:clause.start,end:clause.end,line:lineOf(clause)})),
   states:states.size,reachableStates:stateNodes.filter(node=>seen.has(node.id)).length,deadStates,deadTerminals,edges_count:edges.length,saveSlots:[...slots.values()],exceptions:exceptionEntries.map(({tryLoc,catchLoc,line})=>({tryLoc,catchLoc,line})),handlerStates:[...handlerStates],runtime:{driveCount:runtimeInfo.driveCount,internalDrives:runtimeInfo.internalDrives,externalDrives:runtimeInfo.externalDrives},
   minimal:uniqueGaps.length===0&&uniqueMinimalGaps.length===0,minimalGaps:uniqueMinimalGaps,release:false});
 }
 const gaps=[...new Set([...runtimeInfo.gaps,...machines.flatMap(machine=>machine.gaps)])];
 return {detected:machines.length,proved:machines.length>0&&gaps.length===0,machines,gaps,release:false,
  summary:{machines:machines.length,proved:machines.filter(machine=>machine.proved).length,states:machines.reduce((sum,machine)=>sum+machine.states,0),reachableStates:machines.reduce((sum,machine)=>sum+machine.reachableStates,0),edges:machines.reduce((sum,machine)=>sum+machine.edges_count,0),saveSlots:machines.reduce((sum,machine)=>sum+machine.saveSlots.length,0),driveCount:runtimeInfo.driveCount??0,externalDrives:runtimeInfo.externalDrives??0}};
}
