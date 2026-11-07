import {parse} from '../core/syntax.mjs';
import {index,property,patch,key,functions,initializedAfter} from '../core/ast.mjs';
import {methodContract} from '../platform/clients.mjs';

// Inline only identity callback forwarders; retain all request/callback code.
export function lowerHTTPHelpers(source){
 const comments=[],tree=parse(source,{ecmaVersion:'latest',allowAwaitOutsideFunction:true,allowReturnOutsideFunction:true,onComment:comments}),ix=index(tree),replacements=new WeakMap();
 const callbackCall=n=>n?.type==='CallExpression'&&n.callee.type==='MemberExpression'&&ix.free(n.callee.object,'$httpClient')&&['get','post','put','delete','head','options','patch'].includes(property(n.callee))&&n.arguments.length===2;
 for(const fn of ix.nodes.filter(n=>['FunctionDeclaration','ArrowFunctionExpression','FunctionExpression'].includes(n.type)&&!n.async&&!n.generator)){
  const parent=ix.parents.get(fn),id=fn.id??(parent?.type==='VariableDeclarator'?parent.id:null),b=ix.bindings.get(id);
  // The caller discards this helper's return value. Preserve its early exit,
  // while exposing the callback API as a statement to the native HTTP mapper.
  if(!b||b.writes.length||!b.refs.length||!b.refs.every(r=>{const c=ix.parents.get(r),p=ix.parents.get(c),outer=ix.parents.get(p);return c?.type==='CallExpression'&&c.callee===r&&(p?.type==='ExpressionStatement'||p?.type==='ArrowFunctionExpression'&&p.body===c&&!p.async&&outer?.type==='NewExpression'&&ix.free(outer.callee,'Promise')&&outer.arguments[0]===p);}))continue;
  if(callbackCall(fn.body))replacements.set(fn.body,'{'+source.slice(fn.body.start,fn.body.end)+';}');
  else for(const n of ix.nodes)if(n.type==='ReturnStatement'&&ix.owners.get(n)===fn&&callbackCall(n.argument))replacements.set(n,'{'+source.slice(n.argument.start,n.argument.end)+';return;}');
 }
 const statements=body=>body.flatMap(s=>s.type==='BlockStatement'?statements(s.body):s.type==='EmptyStatement'?[]:[s]);
 for(const fn of ix.nodes.filter(n=>['FunctionDeclaration','ArrowFunctionExpression','FunctionExpression'].includes(n.type)&&!n.async&&!n.generator&&n.params.length===2&&n.params.every(p=>p.type==='Identifier'))){
  if(fn.body.type!=='BlockStatement')continue;
  const container=ix.parents.get(fn),declaration=fn.type==='FunctionDeclaration'?fn:container?.type==='VariableDeclarator'&&ix.parents.get(container)?.declarations?.length===1?ix.parents.get(container):null;
  if(!declaration)continue;
  const body=statements(fn.body.body),call=body[0]?.expression;
  if(body.length!==1||body[0].type!=='ExpressionStatement'||call?.type!=='CallExpression'||call.callee.type!=='MemberExpression'||!ix.free(call.callee.object,'$httpClient')||!['get','post','put','delete','head','options','patch'].includes(property(call.callee))||call.arguments.length!==2||call.arguments.some((a,i)=>a.type!=='Identifier'||ix.bindings.get(a)!==ix.bindings.get(fn.params[i])))continue;
  const b=ix.bindings.get(fn.id??container.id);if(!b||b.writes.length||!b.refs.every(r=>{const p=ix.parents.get(r);return p?.type==='CallExpression'&&p.callee===r&&p.arguments.length===2&&ix.parents.get(p)?.type==='ExpressionStatement';}))continue;
  for(const ref of b.refs)replacements.set(ref,source.slice(call.callee.start,call.callee.end));
  replacements.set(declaration,comments.filter(c=>c.start>=fn.start&&c.end<=fn.end).map(c=>source.slice(c.start,c.end)).join('\n')+'\n');
 }
 // An immutable message alias used solely for explicit field reads does not
 // require materializing an old-platform message object in the native output.
 for(const d of ix.nodes.filter(n=>n.type==='VariableDeclarator'&&n.id.type==='ArrayPattern'&&n.init?.type==='ArrayExpression'&&n.id.elements.length===n.init.elements.length)){
  for(let i=0;i<d.id.elements.length;i++){
   const id=d.id.elements[i],value=d.init.elements[i],b=id?.type==='Identifier'?ix.bindings.get(id):null;
   if(!b||b.writes.length||b.refs.some(r=>r.start<d.end)||!['$request','$response'].some(name=>ix.free(value,name)))continue;
   // A reference in a hoisted function can run before its textual position.
   // Only admit closures when initialization is the first live root statement.
   const declaration=ix.parents.get(d);
   if(b.refs.some(r=>ix.owners.get(r)!==ix.owners.get(d))&&
      (ix.parents.get(declaration)!==tree||tree.body.slice(0,tree.body.indexOf(declaration)).some(s=>!['FunctionDeclaration','EmptyStatement'].includes(s.type))))continue;
   if(!b.refs.every(r=>{const p=ix.parents.get(r),q=ix.parents.get(p);return p?.type==='MemberExpression'&&p.object===r&&['url','method','headers','body','status'].includes(property(p))&&!(q?.type==='AssignmentExpression'&&q.left===p||q?.type==='UpdateExpression'||q?.operator==='delete');}))continue;
   for(const r of b.refs)replacements.set(r,value.name);
   replacements.set(id,'');replacements.set(value,'void 0');
  }
 }
 const render=n=>replacements.has(n)?replacements.get(n):patch(source,n,render);
 return render(tree);
}

// Reviewed allocation-only Request facade: its GET method borrows the owning
// SDK's callback client. Expand that delegation before scalar replacement so
// the existing native HTTP compiler sees the Promise executor and callbacks.
const delegates=new Set(['10746ae1864777553a0e4030e78d492ff3450c4d1bcb6cf5d342c11920006687']);
// Older Env HTTP facade resolves the response itself and rejects the error
// string, rather than wrapping {error, resp, data}. Keep that separate contract.
const responseDelegates=new Set([
 // Literal table decoding exposes the same response facade with bracket keys.
 '90cc46a1c27ca6b7a668077c63af12fb5479ae125899a13318c1fbb30f8776cd',
 '0a24ccd83fe221d55927bc5a2188a7a71284eccc70fa1f19866ab7545cad109a',
 // Statement-form selection/resolve branches in the older response facade.
 // The constructor only retains env; get/post borrow its callback transport.
 '31588730892c6ab2c7fcdc933cc0c8c33500424df637dc44a613c1845025891c',
]);
// This variant has its own timeout race. Its receiver retention is reviewed,
// but it must keep that ordinary JavaScript instead of using the simpler lift.
const allocationDelegates=new Set(['e2a69f681038235af33ec4fbc219c9e05e65d131edee5dd8e993725a5f1f9335']);
export function reviewedHTTPDelegate(helper){
 const signature=methodContract(helper);
 return delegates.has(signature)||responseDelegates.has(signature)||allocationDelegates.has(signature);
}
export function lowerHTTPDelegates(source){
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree),replace=new WeakMap();
 const {nodes,bindings,parents}=ix,names=new Set(nodes.filter(n=>n.type==='Identifier').map(n=>n.name));
 const fresh=base=>{let n=base,i=2;while(names.has(n))n=base+i++;names.add(n);return n;};
 for(const assignment of nodes)if(assignment.type==='AssignmentExpression'&&assignment.operator==='='&&assignment.left.type==='MemberExpression'&&assignment.left.object.type==='ThisExpression'&&assignment.right.type==='NewExpression'&&assignment.right.arguments.length===1&&assignment.right.arguments[0].type==='ThisExpression'){
  const binding=bindings.get(assignment.right.callee),helper=binding?.init;if(helper?.type!=='ClassDeclaration'||binding.writes.length||binding.refs.length!==1)continue;
  const signature=methodContract(helper),timed=allocationDelegates.has(signature),responseOnly=responseDelegates.has(signature)||timed;if(!responseOnly&&!delegates.has(signature))continue;
  const ctor=ix.owners.get(assignment),method=parents.get(ctor),cls=parents.get(parents.get(method)),field=property(assignment.left);
  if(method?.type!=='MethodDefinition'||key(method)!=='constructor'||!['ClassExpression','ClassDeclaration'].includes(cls?.type))continue;
  if(nodes.some(n=>n!==assignment&&n.type==='AssignmentExpression'&&n.left.type==='MemberExpression'&&property(n.left)===field||n.type==='UpdateExpression'&&n.argument.type==='MemberExpression'&&property(n.argument)===field||n.type==='UnaryExpression'&&n.operator==='delete'&&n.argument.type==='MemberExpression'&&property(n.argument)===field))continue;
  if(ix.nodes.some(n=>n.type==='CallExpression'&&n.start>=cls.start&&n.end<=cls.end&&n.arguments[0]?.type==='ThisExpression'&&parents.get(ix.owners.get(n))?.type==='MethodDefinition'&&!(responseOnly&&key(parents.get(ix.owners.get(n)))==='constructor'&&n.callee.type==='MemberExpression'&&ix.free(n.callee.object,'Object')&&property(n.callee)==='assign')))continue;
  if(responseOnly||delegates.has(signature)){
   const constructed=parents.get(cls),ret=parents.get(constructed),factory=parents.get(parents.get(ret)),fb=factory?.type==='FunctionDeclaration'?bindings.get(factory.id):null;
   if(!fb||fb.writes.length||fb.refs.length!==1)continue;
   const creation=parents.get(fb.refs[0]),d=parents.get(creation),receiver=d?.type==='VariableDeclarator'?bindings.get(d.id):null;
   if(!receiver||receiver.writes.length)continue;
   for(const n of nodes)if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&['get','post'].includes(property(n.callee))&&n.arguments.length===1){
    const facade=n.callee.object,owner=facade?.object;
    if(facade?.type!=='MemberExpression'||property(facade)!==field||!(owner?.type==='Identifier'&&bindings.get(owner)===receiver||owner?.type==='ThisExpression'&&n.start>=cls.start&&n.end<=cls.end))continue;
    const options=fresh('requestOptions'),error=fresh('requestError'),response=fresh('requestResponse'),body=fresh('requestBody'),request=fresh('requestPromise');
    replace.set(n,()=>{
     const wrapped=delegates.has(signature),result=`{error: ${error}, resp: ${response}, data: ${body}}`;
     const promise=`new Promise((resolve, reject) => ${render(owner)}.${property(n.callee)}(${options}, (${error}, ${response}${wrapped?', '+body:''}) => ${error} ? reject(${wrapped?result:error}) : resolve(${wrapped?result:response})))`;
     if(!timed&&!wrapped)return `((${options}) => ${promise})(${render(n.arguments[0])})`;
     // Preserve the reviewed helper's own deadline race, including its error
     // and uncancelled timer. This is source control flow, not a host API shim.
     return `((${options}) => {${options}=typeof ${options}==='string'?{url:${options}}:${options};const ${request}=${promise};return ${options}.timeout${delegates.has(signature)?'>0':''}?((value,delay=${delegates.has(signature)?5000:1000})=>Promise.race([value,new Promise((resolve,reject)=>{setTimeout(()=>{reject(new Error('请求超时'))},delay)})]))(${request},${options}.timeout):${request};})(${render(n.arguments[0])})`;
    });
   }
   continue;
  }
  for(const n of nodes)if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&property(n.callee)==='get'&&n.callee.object.type==='MemberExpression'&&n.callee.object.object.type==='ThisExpression'&&property(n.callee.object)===field&&n.arguments.length===1&&n.start>=cls.start&&n.end<=cls.end){
   const input=n.arguments[0];if(input.type!=='ObjectExpression'||input.properties.length!==1||input.properties[0].type!=='Property'||input.properties[0].kind!=='init'||key(input.properties[0])!=='url')continue;
   const options=fresh('requestOptions'),error=fresh('requestError'),response=fresh('requestResponse'),body=fresh('requestBody');
   replace.set(n,`((${options}) => new Promise((resolve, reject) => this.get(${options}, (${error}, ${response}, ${body}) => ${error} ? reject({error: ${error}, resp: ${response}, data: ${body}}) : resolve({error: ${error}, resp: ${response}, data: ${body}}))))(${source.slice(input.start,input.end)})`);
  }
 }
 const render=n=>replace.has(n)?typeof replace.get(n)==='function'?replace.get(n)():replace.get(n):patch(source,n,render);return render(tree);
}

// Expose request fields of reviewed OpenAPI factories without replacing their
// hooks, option evaluation, URL normalization, or authored timeout race.

const reviewed=new Set([
 // Folded host branch keeps onRequest in a sequence before callback transport.
 'bc75bad9b6af4f1017b1f744fec9181afb91d5b894d80d6207227ba3678825c9',
 'bcf162af6a60c12217174da2ae5c93a3a3e15bd8bfa9e0e86907750c2d2c39d0',
 'e06545ccef5bf146accaa28a1452079f8605622ec395240d7de69ca4c135b294',
 '939afe5ca8e15d2ca4b205eb733450192ab1e0e2fbbc1236febf11b6518e9bbd',
 'cf2212c81309fbf274545b4d7512908c1b374c898ecc09e7a5153314a4ccec98',
 // Callback transport plus authored default-header and timeout handling.
 '4b956e72d71c6c5acbc71c6979d74560e59deeabe3ca54ccf165ebf648b4eb13',
 // Independently authored reduced factory used for behavioral regression tests.
 '058843073ebc5fa4b23174592fc97df0c79522fc09db7de106bf10eaf717df2b',
]);
const methods=new Set(['get','post','put','delete','head','options','patch']);
const data=new Set(['url','headers','body','timeout','policy','policy-descriptor','node']);
const candidate=n=>n.type==='FunctionDeclaration'&&n.params.length===1&&n.params[0].type==='AssignmentPattern'&&n.params[0].right.type==='ObjectExpression';

export function lowerHTTPFactoryFields(source,format){
 const ix=index(parse(source,{ecmaVersion:'latest',allowAwaitOutsideFunction:true,allowReturnOutsideFunction:true}));
 const {nodes,parents,bindings,owners,free}=ix,replace=new WeakMap(),factories=[],safeCalls=new Set(),transformations=[];
 function resolveShapeValue(n,env,seen=new Set()){
  if(n?.type!=='Identifier')return n;
  const binding=bindings.get(n);if(!binding||seen.has(binding))return n;
  for(let scope=env;scope;scope=scope.parent)if(scope.values.has(binding)){
   const entry=scope.values.get(binding),next=new Set(seen);next.add(binding);
   return resolveShapeValue(entry.value,entry.kind==='argument'?scope.parent:env,next);
  }
  if(binding.init&&!binding.writes.length){const next=new Set(seen);next.add(binding);return resolveShapeValue(binding.init,env,next);}
  return n;
 }
 function callable(n,env){
  n=resolveShapeValue(n,env);if(functions.has(n?.type))return n;
  if(n?.type!=='MemberExpression'||property(n)===undefined)return null;
  const receiver=n.object,receiverBinding=receiver?.type==='Identifier'?bindings.get(receiver):null;
  if(receiverBinding){
   if(receiverBinding.writes.length||receiverBinding.refs.some(ref=>{
    const member=parents.get(ref),use=parents.get(member);
    return member?.type!=='MemberExpression'||member.object!==ref||use?.type==='AssignmentExpression'&&use.left===member||use?.type==='UpdateExpression'||use?.operator==='delete';
   }))return null;
  }
  const object=resolveShapeValue(receiver,env);if(object?.type!=='ObjectExpression')return null;
  const entry=object.properties.find(p=>p.type==='Property'&&p.kind==='init'&&key(p)===property(n));
  const value=entry&&resolveShapeValue(entry.value,env);
  return functions.has(value?.type)?value:null;
 }
 function pureShapeValue(n){
  if(!n)return false;
  if(n.type==='Literal')return !n.regex;
  if(n.type==='Identifier')return true;
  if(n.type==='MemberExpression')return property(n)!==undefined&&pureShapeValue(n.object);
  if(n.type==='TemplateLiteral')return n.expressions.every(pureShapeValue);
  if(n.type==='ArrayExpression')return n.elements.every(e=>e&&e.type!=='SpreadElement'&&pureShapeValue(e));
  if(n.type==='ObjectExpression')return n.properties.every(p=>p.type==='Property'&&p.kind==='init'&&!p.method&&key(p)!==undefined&&key(p)!=='__proto__'&&pureShapeValue(p.value));
  if(n.type==='UnaryExpression')return pureShapeValue(n.argument);
  if(['BinaryExpression','LogicalExpression'].includes(n.type))return pureShapeValue(n.left)&&pureShapeValue(n.right);
  if(n.type==='ConditionalExpression')return pureShapeValue(n.test)&&pureShapeValue(n.consequent)&&pureShapeValue(n.alternate);
  return false;
 }
 function forwardedShapeCall(fn,n){
  if(n?.type!=='CallExpression'||n.optional||n.callee.type!=='Identifier'||n.arguments.some(a=>a.type==='SpreadElement'))return false;
  const callee=bindings.get(n.callee);if(!fn.params.some(p=>bindings.get(p)===callee))return false;
  const parameters=new Set(fn.params.map(p=>bindings.get(p)));
  return n.arguments.every(a=>a.type==='Identifier'?parameters.has(bindings.get(a)):pureShapeValue(a));
 }
 function returnedShape(node,seen,env){
  const fn=callable(node.callee,env);
  if(!fn||fn.async||fn.generator||fn.params.some(p=>p.type!=='Identifier')||node.arguments.some(a=>a.type==='SpreadElement')||node.arguments.length!==fn.params.length||seen.has(fn))return null;
  const values=new Map();
  for(let i=0;i<fn.params.length;i++){
   const binding=bindings.get(fn.params[i]);if(!binding||binding.writes.length)return null;
   values.set(binding,{kind:'argument',value:node.arguments[i]});
  }
  const statements=fn.body.type==='BlockStatement'?fn.body.body:[];
  if(fn.body.type!=='BlockStatement'||!statements.length||statements.at(-1)?.type!=='ReturnStatement')return null;
  for(const statement of statements.slice(0,-1)){
   if(statement.type!=='VariableDeclaration')return null;
   for(const declaration of statement.declarations){
    if(declaration.id.type!=='Identifier'||!declaration.init||!pureShapeValue(declaration.init))return null;
    const binding=bindings.get(declaration.id);if(!binding||binding.writes.length)return null;
    values.set(binding,{kind:'local',value:declaration.init});
   }
  }
  const result=statements.at(-1).argument;if(!result||result.type==='CallExpression'&&!forwardedShapeCall(fn,result))return null;
  const next=new Set(seen);next.add(fn);
  return shape(result,next,{values,parent:env});
 }
 function shape(n,seen=new Set(),env={values:new Map(),parent:null}){
  if(n?.type==='Literal'&&typeof n.value==='string'||n?.type==='TemplateLiteral'){
   const result=new Map([['url',n]]);result.string=true;return result;
  }
  if(n?.type==='Identifier'){
   const b=bindings.get(n);if(!b||seen.has(b))return null;
   if(b.writes.some(w=>w.type!=='AssignmentExpression'||w.operator!=='='||w.left.type!=='Identifier'||bindings.get(w.left)!==b))return null;
   for(let scope=env;scope;scope=scope.parent)if(scope.values.has(b)){
    const entry=scope.values.get(b),next=new Set(seen);next.add(b);
    return shape(entry.value,next,entry.kind==='argument'?scope.parent:env);
   }
   const next=new Set(seen);next.add(b);let initial=b.init;
   if(!initial&&!b.writes.length){
    // Finite method dispatch introduces an immediately invoked arrow. Its
    // parameters retain the original request record; do not lose that shape.
    const fn=owners.get(n),call=parents.get(fn),position=fn?.params?.findIndex(p=>bindings.get(p)===b);
    if(fn?.type!=='ArrowFunctionExpression'||call?.type!=='CallExpression'||call.callee!==fn||call.optional||position<0||call.arguments.some(a=>a.type==='SpreadElement'))return null;
    initial=call.arguments[position];safeCalls.add(call);
   }
   const candidates=[initial,...b.writes.map(w=>w.right)].filter(Boolean).map(value=>shape(value,new Set(next),env));
   if(!candidates.length||candidates.some(value=>!value))return null;
   const sameKeys=(a,c)=>a.string===c.string&&a.size===c.size&&[...a.keys()].every(k=>c.has(k));
   const sameLiteral=(a,c)=>a?.type==='Literal'&&c?.type==='Literal'&&Object.is(a.value,c.value);
   const first=candidates[0];
   for(const other of candidates.slice(1)){
    if(!sameKeys(first,other))return null;
    for(const k of first.keys())if(!data.has(k)&&!sameLiteral(first.get(k),other.get(k)))return null;
    if(String([...(first.headerNames??[])])!==String([...(other.headerNames??[])]))return null;
   }
   const result=first;
   for(const r of b.refs){const p=parents.get(r),u=parents.get(p);
    if(p?.type==='AssignmentExpression'&&p.left===r&&p.operator==='='&&bindings.get(r)===b)continue;
    if(p?.type==='MemberExpression'&&p.object===r){
     if(property(p)===undefined)return null;
     if(u?.type==='AssignmentExpression'&&u.left===p){
      if(u.operator!=='='||!data.has(String(property(p)))||owners.get(u)!==owners.get(n)||u.end>n.start)return null;
      result.set(String(property(p)),u.right);
     }else if(u?.type==='UpdateExpression'||u?.operator==='delete')return null;
     continue;
    }
    if(p?.type==='CallExpression'&&p.arguments.includes(r)){
     const c=p.callee;
     if(safeCalls.has(p))continue;
     if(c.type==='MemberExpression'&&free(c.object,'JSON')&&property(c)==='stringify')continue;
    }
    return null;
   }
   return result;
  }
  n=resolveShapeValue(n,env);
  if(n?.type==='CallExpression')return returnedShape(n,seen,env);
  if(n?.type==='ObjectExpression'){
   const result=new Map();
   for(const p of n.properties){
    if(p.type==='SpreadElement'){const more=shape(p.argument,new Set(seen),env);if(!more||more.string)return null;for(const [k,v]of more)result.set(k,v);}
    else if(p.type==='Property'&&p.kind==='init'&&key(p)!==undefined&&key(p)!=='__proto__')result.set(String(key(p)),resolveShapeValue(p.value,env));
    else return null;
   }
   return result;
  }
  return null;
 }
 for(const fn of nodes){
  if(!candidate(fn)||!reviewed.has(methodContract(fn)))continue;
  if(nodes.some(n=>n.start>=fn.start&&n.end<=fn.end&&n.type==='Identifier'&&ix.reference(n)&&
   ['Promise','setTimeout','clearTimeout','$httpClient'].includes(n.name)&&!free(n,n.name)))continue;
  const fb=bindings.get(fn.id);if(!fb||fb.writes.length||!fb.refs.length)continue;
  const inputs=[],sites=[];let valid=true;
  for(const ref of fb.refs){
   const call=parents.get(ref),holder=parents.get(call);
   if(!['CallExpression','NewExpression'].includes(call?.type)||call.callee!==ref||call.arguments.length>1||call.arguments.some(a=>a.type==='SpreadElement')){valid=false;break;}
   safeCalls.add(call);
   const direct=holder?.type==='MemberExpression'&&holder.object===call&&methods.has(property(holder))?parents.get(holder):null;
   if(direct?.type==='CallExpression'&&direct.callee===holder&&direct.arguments.length===1){safeCalls.add(direct);sites.push([call,direct]);continue;}
   const id=holder?.type==='VariableDeclarator'&&holder.init===call?holder.id:holder?.type==='AssignmentExpression'&&holder.operator==='='&&holder.right===call?holder.left:null;
   const receiver=id?.type==='Identifier'?bindings.get(id):null;
   const construction=n=>['CallExpression','NewExpression'].includes(n?.type)&&bindings.get(n.callee)===fb;
   if(!receiver||receiver.init&&!construction(receiver.init)||receiver.writes.some(w=>w.type!=='AssignmentExpression'||w.operator!=='='||!construction(w.right))){valid=false;break;}
   for(const r of receiver.refs){
    if(r===id)continue;
    const parent=parents.get(r);
    if(parent?.type==='AssignmentExpression'&&parent.left===r&&parent.operator==='='&&construction(parent.right))continue;
    const member=parents.get(r),use=parents.get(member);
    if(member?.type!=='MemberExpression'||member.object!==r||!methods.has(property(member))||use?.type!=='CallExpression'||use.callee!==member||use.arguments.length!==1){valid=false;break;}
    safeCalls.add(use);sites.push([call,use]);
   }
   if(!valid)break;
  }
  if(!valid)continue;
  for(const [call,use]of sites){
   const defaults=call.arguments.length?shape(call.arguments[0]):shape(fn.params[0]?.right),own=shape(use.arguments[0]);
   if(!defaults||defaults.string||!own){valid=false;break;}
   inputs.push(new Map([...defaults,...own]));
  }
  if(!valid||!inputs.length||inputs.some(m=>!m.has('url')))continue;
  const keys=new Set(inputs.flatMap(m=>[...m.keys()]));
  // These two fields belong to the reviewed factory, never the native client.
  // Unknown request hooks could add unsupported transport fields dynamically.
  if(keys.has('events')||keys.has('method'))continue;
  keys.delete('baseURL');
  // Loon's request contract reads HTTP headers from options.headers. A
  // top-level accept in an otherwise closed reviewed factory is inert data;
  // preserve its evaluation/merging, without inventing an Accept header.
  const ignored=[];
  if(format==='loon'&&keys.delete('accept'))ignored.push('accept');
  const flags=new Map(),defaults={'auto-redirect':true,'auto-cookie':true,insecure:false,'binary-mode':false,'full-header-mode':false};
  for(const k of keys){
   if(data.has(k)&&!(k==='node'&&format!=='loon'))continue;
   if(!Object.hasOwn(defaults,k)){valid=false;break;}
   const values=inputs.map(m=>m.has(k)&&m.get(k)?.type==='Literal'?m.get(k).value:m.has(k)?null:defaults[k]);
   if(typeof values[0]!=='boolean'||values.some(v=>v!==values[0])){valid=false;break;}
   flags.set(k,values[0]);
  }
  if(!valid)continue;
  const requests=nodes.filter(n=>n.start>=fn.start&&n.end<=fn.end&&n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&free(n.callee.object,'$httpClient'));
  if(requests.length!==1||requests[0].arguments.length!==2||requests[0].arguments[0].type!=='Identifier')continue;
  const request=requests[0],input=request.arguments[0],text=source.slice(input.start,input.end);
  const fields=[...keys].map(k=>{
   if(flags.has(k))return JSON.stringify(k)+': '+String(flags.get(k));
   const live=text+'['+JSON.stringify(k)+']';
   // The source client default applies when this individual invocation omitted
   // timeout, even if another invocation supplied it.
   return JSON.stringify(k)+': '+(k==='timeout'?`(${live} === undefined ? ${format==='loon'?5000:5} : ${live})`:live);
  });
  replace.set(input,'{'+fields.join(', ')+'}');
  factories.push(fn);
  transformations.push({kind:'closed-http-factory-fields',factory_sha256:methodContract(fn),
   source_line:source.slice(0,fn.start).split('\n').length,call_sites:sites.length,fields:[...keys],ignored_request_fields:ignored,
   reason:'封闭调用点证明请求字段；保留原有合并、URL 处理、回调钩子与超时竞争'});
 }
 const render=n=>replace.has(n)?replace.get(n):patch(source,n,render);
 const signatures=new Set(factories.map(fn=>methodContract(parse(render(fn),{ecmaVersion:'latest'}).body[0])));
 return {source:render(ix.nodes[0]),signatures,transformations};
}

export function httpFactoryPromiseCalls(ix,signatures){
 const calls=new WeakSet(),{nodes,bindings,parents}=ix;
 if(!signatures?.size)return calls;
 for(const fn of nodes)if(candidate(fn)&&signatures.has(methodContract(fn))){
  const fb=bindings.get(fn.id);if(!fb||fb.writes.length)continue;
  for(const ref of fb.refs){
   const call=parents.get(ref),holder=parents.get(call);
   if(!['CallExpression','NewExpression'].includes(call?.type)||call.callee!==ref)continue;
   const direct=holder?.type==='MemberExpression'&&holder.object===call&&methods.has(property(holder))?parents.get(holder):null;
   if(direct?.type==='CallExpression'&&direct.callee===holder)calls.add(direct);
   const id=holder?.type==='VariableDeclarator'?holder.id:holder?.type==='AssignmentExpression'&&holder.right===call?holder.left:null;
   const b=id?.type==='Identifier'?bindings.get(id):null;
   if(!b||b.writes.some(w=>w.type!=='AssignmentExpression'||w.operator!=='='||!['CallExpression','NewExpression'].includes(w.right.type)||bindings.get(w.right.callee)!==fb))continue;
   for(const r of b.refs){const m=parents.get(r),use=parents.get(m);
    if(m?.type==='MemberExpression'&&m.object===r&&methods.has(property(m))&&use?.type==='CallExpression'&&use.callee===m)calls.add(use);
   }
  }
 }
 return calls;
}

// Expose closed callback delegates at their call sites. Arguments/defaults and
// the original callback body remain JavaScript; no platform client is emitted.
export function lowerClosedHTTP(source){
 source=lowerSelectedHTTP(source);
 for(let pass=0;pass<16;pass++){
  const next=lowerOne(source);if(next===source)break;source=next;
 }
 return source;
}
export function lowerSelectedHTTP(source){
 const ix=index(parse(source,{ecmaVersion:'latest',allowAwaitOutsideFunction:true,allowReturnOutsideFunction:true})),replace=new WeakMap();
 const {nodes,parents,bindings,free}=ix,methods=new Set(['get','post','put','delete','head','options','patch']);
 for(const d of nodes)if(d.type==='VariableDeclarator'&&d.id.type==='Identifier'&&['ConditionalExpression','MemberExpression'].includes(d.init?.type)){
  const binding=bindings.get(d.id),declaration=parents.get(d),choices=new Set();
  const selector=n=>{
   if(n.type==='ConditionalExpression'){
    const yes=selector(n.consequent),no=selector(n.alternate);
    return yes&&no?`(${source.slice(n.test.start,n.test.end)} ? ${yes} : ${no})`:null;
   }
   if(n.type==='Identifier'){
    const b=bindings.get(n),fn=b?.fn??b?.init;
    if(!b||b.writes.length||!functions.has(fn?.type)||fn.async||fn.generator||fn.params.length!==2||fn.params.some(p=>p.type!=='Identifier'))return null;
    const flatten=n=>n?.type==='BlockStatement'?n.body.flatMap(flatten):n?.type==='EmptyStatement'?[]:[n];
    const statements=fn.body.type==='BlockStatement'?flatten(fn.body):[];
    const call=fn.body.type==='CallExpression'?fn.body:statements.length===1&&statements[0].type==='ExpressionStatement'?statements[0].expression:null;
    if(call?.type!=='CallExpression'||call.arguments.length!==2||!call.arguments.every((a,i)=>a.type==='Identifier'&&bindings.get(a)===bindings.get(fn.params[i])))return null;
    return selector(call.callee);
   }
   const method=property(n);
   if(n.type!=='MemberExpression'||!free(n.object,'$httpClient')||!methods.has(method))return null;
   choices.add(method);return JSON.stringify(method);
  };
  const selected=selector(d.init);
  if(!selected||!binding?.refs.length||binding.writes.length||declaration.declarations.length!==1)continue;
  const calls=binding.refs.map(ref=>parents.get(ref));
  const dominated=call=>{const block=parents.get(declaration);let statement=call;while(parents.get(statement)&&parents.get(statement)!==block)statement=parents.get(statement);return ['Program','BlockStatement'].includes(block?.type)&&parents.get(statement)===block&&statement.start>=declaration.end&&ix.owners.get(call)===ix.owners.get(declaration)||initializedAfter(ix,declaration,call);};
  if(calls.some((call,i)=>call?.type!=='CallExpression'||call.callee!==binding.refs[i]||call.optional||call.arguments.length!==2||call.arguments.some(a=>a.type==='SpreadElement')||!['ExpressionStatement','ReturnStatement'].includes(parents.get(call)?.type)||!dominated(call)))continue;
  replace.set(d.init,selected);
  for(const call of calls){
   const args=call.arguments.map(a=>source.slice(a.start,a.end)).join(', '),names=[...choices];
   const returned=parents.get(call).type==='ReturnStatement'?'return ':'';
   replace.set(parents.get(call),names.length===1?`${returned}$httpClient.${names[0]}(${args});`:names.map((method,i)=>`${i?i===names.length-1?'else ':'else if ':'if '}${i===names.length-1&&i?'':`(${d.id.name} === ${JSON.stringify(method)}) `}{ ${returned}$httpClient.${method}(${args}); }`).join(' '));
  }
 }
 const render=n=>replace.has(n)?replace.get(n):patch(source,n,render);return render(ix.nodes[0]);
}
function lowerOne(source){
 const ix=index(parse(source,{ecmaVersion:'latest',allowAwaitOutsideFunction:true,allowReturnOutsideFunction:true})),replace=new WeakMap();
 const {nodes,parents,bindings,free}=ix;
 const flatten=n=>n?.type==='BlockStatement'?n.body.flatMap(flatten):!n||n.type==='EmptyStatement'?[]:[n];
 for(const fn of nodes.filter(n=>functions.has(n.type)&&!n.async&&!n.generator)){
  const p=parents.get(fn),d=p?.type==='VariableDeclarator'?p:null,b=bindings.get(fn.id??d?.id),declaration=d?parents.get(d):fn;
  if(!b||b.writes.length||!b.refs.length||d&&declaration.declarations.length!==1||fn.type!=='FunctionDeclaration'&&fn.id||b.refs.some(r=>r.start>=fn.start&&r.end<=fn.end))continue;
  const calls=b.refs.map(r=>parents.get(r));
  if(calls.some((c,i)=>c?.type!=='CallExpression'||c.callee!==b.refs[i]||c.optional||c.arguments.some(a=>a.type==='SpreadElement')))continue;
  const ordered=(d,c)=>{
   if(initializedAfter(ix,declaration,c))return true;
   const block=parents.get(declaration);if(!['Program','BlockStatement'].includes(block?.type)||!block.body.includes(declaration)||c.start<declaration.end)return false;
   let entry=c;while(parents.get(entry)&&parents.get(entry)!==block)entry=parents.get(entry);
   return parents.get(entry)===block&&entry.start>=declaration.end;
  };
  if(d&&!calls.every(c=>ordered(d,c)))continue;
  const local=index(fn);
  if(local.nodes.some(n=>n.type==='ThisExpression'||local.free(n,'arguments')))continue;
  // Getter adapters sometimes copy status/statusCode before returning the same
  // legacy message. Admit only field-only consumers and exact reciprocal copies.
  const statements=fn.body.type==='BlockStatement'?flatten(fn.body):[],last=statements.at(-1),message=last?.type==='ReturnStatement'?last.argument:null;
  if(fn.params.length===0&&['$request','$response'].some(name=>free(message,name))&&calls.every(c=>!c.arguments.length&&parents.get(c)?.type==='MemberExpression'&&parents.get(c).object===c&&['url','method','status','statusCode','headers','body','bodyBytes'].includes(property(parents.get(c))))){
   const valid=statements.slice(0,-1).every(s=>{
    const call=s.test,target=flatten(s.consequent??{}),a=target.length===1&&target[0].type==='ExpressionStatement'?target[0].expression:null;
    if(s.type!=='IfStatement'||s.alternate||call?.type!=='CallExpression'||call.callee.type!=='MemberExpression'||!free(call.callee.object,message.name)||property(call.callee)!=='hasOwnProperty'||call.arguments.length!==1||call.arguments[0].type!=='Literal'||!['status','statusCode'].includes(call.arguments[0].value))return false;
    const from=call.arguments[0].value,to=from==='status'?'statusCode':'status';return a?.type==='AssignmentExpression'&&a.operator==='='&&a.left.type==='MemberExpression'&&free(a.left.object,message.name)&&property(a.left)===to&&a.right.type==='MemberExpression'&&free(a.right.object,message.name)&&property(a.right)===from;
   });
   if(valid){for(const c of calls)replace.set(c,message.name);replace.set(declaration,'');break;}
  }
  // A closed response adapter returns its object argument after ordinary field
  // normalization. Expose it at each call site; the later IIFE parameter pass
  // can then prove the reply fields without moving callers' lexical values.
  const adapterReturn=statements.at(-1)?.type==='ReturnStatement'&&statements.at(-1).argument;
  const adapterParam=fn.params.length===1&&fn.params[0].type==='Identifier'?bindings.get(fn.params[0]):null;
  if(adapterParam&&!adapterParam.writes.length&&adapterReturn?.type==='Identifier'&&bindings.get(adapterReturn)===adapterParam&&calls.every(c=>c.arguments.length===1&&c.arguments[0].type==='Identifier')){
   const text=fn.type==='FunctionDeclaration'?'function'+source.slice(fn.id.end,fn.end):source.slice(fn.start,fn.end);
   for(const c of calls)replace.set(c,'('+text+')('+source.slice(c.arguments[0].start,c.arguments[0].end)+')');
   replace.set(declaration,'');break;
  }
  if(!local.nodes.some(n=>n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&free(n.callee.object,'$httpClient')))continue;
  const callbackParameter=(parameter,seen=new Set())=>{
   const id=parameter?.type==='AssignmentPattern'?parameter.left:parameter,pb=id?.type==='Identifier'?bindings.get(id):null;
   if(!pb||pb.writes.length||seen.has(pb))return false;seen=new Set(seen);seen.add(pb);
   return pb.refs.some(r=>{
    const call=parents.get(r);if(call?.type!=='CallExpression')return false;
    if(call.callee===r||call.callee.type==='MemberExpression'&&free(call.callee.object,'$httpClient')&&call.arguments.includes(r))return true;
    // Expanding one delegate exposes a direct IIFE. Follow the callback into
    // its own parameter so outer forwarding delegates can be expanded next.
    return functions.has(call.callee.type)&&call.arguments.includes(r)&&callbackParameter(call.callee.params[call.arguments.indexOf(r)],seen);
   });
  };
  const callback=fn.params.some(p=>callbackParameter(p));
  if(!callback)continue;
  let text=fn.type==='FunctionDeclaration'?'function'+source.slice(fn.id.end,fn.end):source.slice(fn.start,fn.end);
  if(fn.body.type==='CallExpression'&&fn.body.callee.type==='MemberExpression'&&free(fn.body.callee.object,'$httpClient')){
   if(!calls.every(c=>{const p=parents.get(c),use=parents.get(p);return p?.type==='ExpressionStatement'||p?.type==='ArrowFunctionExpression'&&p.body===c&&use?.type==='NewExpression'&&free(use.callee,'Promise');}))continue;
   text=source.slice(fn.start,fn.body.start)+'{'+source.slice(fn.body.start,fn.body.end)+';}';
  }
  for(const c of calls)replace.set(c,'('+text+')('+c.arguments.map(a=>source.slice(a.start,a.end)).join(', ')+')');
  replace.set(declaration,'');
  // One delegate per pass prevents an outer call's original callback argument
  // from hiding a nested replacement whose declaration was already removed.
  break;
 }
 const render=n=>{if(n.type==='ExpressionStatement'&&replace.has(n.expression))return ';'+render(n.expression)+';';return replace.has(n)?replace.get(n):patch(source,n,render);};return render(ix.nodes[0]);
}

// Translate only the callback surface of an external Node `request` package
// when the package binding is a closed receiver. The normal client compiler
// then proves the method, request fields and callback result mapping to ctx.http.

export function lowerNodeRequestClient(source){
 const tree=parse(source,{ecmaVersion:'latest',allowAwaitOutsideFunction:true,allowReturnOutsideFunction:true}),ix=index(tree);
 const {nodes,parents,bindings,free}=ix,remove=new WeakSet(),replace=new WeakMap(),transformations=[];
 for(const declaration of nodes.filter(n=>n.type==='VariableDeclarator'&&n.id.type==='Identifier')){
  const init=declaration.init,binding=bindings.get(declaration.id),statement=parents.get(declaration);
  if(!binding||binding.writes.length||!free(init?.callee,'require')||init?.type!=='CallExpression'||init.arguments.length!==1||init.arguments[0].type!=='Literal'||init.arguments[0].value!=='request'||statement?.type!=='VariableDeclaration'||statement.declarations.length!==1)continue;
  const refs=binding.refs;
  if(!refs.length)continue;
  const members=[];let valid=true;
  for(const ref of refs){
   const member=parents.get(ref),call=parents.get(member);
   if(member?.type!=='MemberExpression'||member.object!==ref||member.optional||call?.type!=='CallExpression'||call.callee!==member||call.optional||call.arguments.length!==2||call.arguments.some(a=>a.type==='SpreadElement')){valid=false;break;}
   // The external client is used only as a callback HTTP receiver. Any
   // property read, export, alias or non-call use keeps the original failure.
   members.push(member);
  }
  if(!valid)continue;
  for(const member of members)replace.set(member.object,'$httpClient');
  remove.add(statement);
  transformations.push({kind:'node-request-client',calls:members.length,reason:'封闭 require("request") 回调调用进入既有 ctx.http 字段与响应映射证明'});
 }
 if(!transformations.length)return {source,transformations};
 const render=n=>remove.has(n)?'':replace.has(n)?replace.get(n):patch(source,n,render);
 return {source:render(tree),transformations};
}

// Recognize a closed dotted-path setter by its complete function contract.
// The authored setter still runs; this describes its sole request-field effect.

const SETTER='8a0108968eb5199b8cb9dc5b917196f3e45d34153ef79c17f1dce6ebf47b14ba';
const contracts=new WeakMap();
export function pathSetterField(ix,call,argument){
 if(call?.type!=='CallExpression'||call.optional||call.arguments.length!==3||call.arguments[0]!==argument||call.arguments.some(a=>a.type==='SpreadElement'))return null;
 const path=call.arguments[1];
 if(path?.type!=='Literal'||typeof path.value!=='string'||!/^headers(?:\.[A-Za-z0-9_-]+)+$/.test(path.value)||path.value.split('.').some(k=>['__proto__','prototype','constructor'].includes(k)))return null;
 const b=ix.bindings.get(call.callee),fn=b?.fn??b?.init;
 if(!b||b.writes.length||!functions.has(fn?.type)||fn.async||fn.generator||fn.params.length!==3||fn.params.some(p=>p.type!=='Identifier'))return null;
 if(!b.refs.every(r=>{const c=ix.parents.get(r);return c?.type==='CallExpression'&&c.callee===r&&!c.optional;}))return null;
 if(!contracts.has(fn)){
  const globals=ix.nodes.filter(n=>n.start>=fn.start&&n.end<=fn.end&&n.type==='Identifier'&&['Object','Array','Math'].includes(n.name)&&ix.reference(n));
  let writes=0,valid=globals.every(n=>ix.free(n,n.name));
  function normalize(n){
   if(!n||typeof n!=='object')return n;
   if(Array.isArray(n))return n.map(normalize);
   const result=Object.fromEntries(Object.entries(n).map(([k,v])=>[k,normalize(v)]));
   if(n.type==='AssignmentExpression'&&n.left.type==='MemberExpression'&&n.left.object.type==='CallExpression'&&property(n.left.object.callee)==='reduce'){
    writes++;
    const v=n.right;
    if(!(v.type==='Identifier'&&ix.bindings.get(v)===ix.bindings.get(fn.params[2])||v.type==='Literal'&&!v.regex||v.type==='TemplateLiteral'&&!v.expressions.length))valid=false;
    result.right={type:'Identifier',name:fn.params[2].name,start:v.start,end:v.end};
   }
   return result;
  }
  const normalized=normalize(fn);
  contracts.set(fn,valid&&writes===1&&methodContract(normalized)===SETTER);
 }
 return contracts.get(fn)?'headers':null;
}
