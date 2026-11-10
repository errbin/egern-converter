

// Shared scope-aware, static-only AST operations.
export const functions=new Set(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression']);
export const property=n=>n?.computed?(n.property?.type==='Literal'?n.property.value:undefined):n?.property?.name;
export const key=p=>p.computed?(p.key.type==='Literal'?p.key.value:undefined):(p.key.name??p.key.value);
export function children(n){
 const out=[];
 for(const k of Object.keys(n)){
  if(k==='loc')continue;const value=n[k];
  if(Array.isArray(value)){for(const child of value)if(child?.type)out.push([k,child]);}
  else if(value?.type)out.push([k,value]);
 }
 return out;
}
const indices=new WeakMap();
export function index(tree){
 if(indices.has(tree))return indices.get(tree);
 const nodes=[],parents=new WeakMap(),scopes=new WeakMap(),bindings=new WeakMap(),owners=new WeakMap(),declarations=new WeakSet();
 const root={parent:null,names:new Map(),fn:true};
 function bind(n,s,init=null,fn=null){
  if(!n)return;
  if(n.type==='Identifier'){let b=s.names.get(n.name);if(!b){b={name:n.name,init,fn,refs:[],writes:[]};s.names.set(n.name,b);}declarations.add(n);bindings.set(n,b);return;}
  if(n.type==='RestElement')return bind(n.argument,s);
  if(n.type==='AssignmentPattern')return bind(n.left,s);
  if(n.type==='ArrayPattern')return n.elements.forEach(c=>bind(c,s));
  if(n.type==='ObjectPattern')return n.properties.forEach(c=>bind(c.type==='RestElement'?c.argument:c.value,s));
 }
 function visit(rootNode,rootScope,rootOwner=tree,p=null,k=''){
  // Real-world bundled scripts can contain very deep expression and block
  // trees. Keep the pre-order indexing and switch-scope rules while avoiding
  // a JavaScript call frame for every AST level.
  const pending=[{kind:'node',n:rootNode,s:rootScope,owner:rootOwner,p,k}];
  while(pending.length){
   const frame=pending.pop();
   if(frame.kind==='case'){
    const {n,c,s,owner,switchParent}=frame;
    parents.set(c,n);nodes.push(c);scopes.set(c,s);owners.set(c,owner);
    const next=[];
    if(c.test)next.push({kind:'node',n:c.test,s:switchParent,owner,p:c,k:'test'});
    for(const statement of c.consequent)next.push({kind:'node',n:statement,s,owner,p:c,k:'consequent'});
    for(let i=next.length-1;i>=0;i--)pending.push(next[i]);
    continue;
   }
   const {n,p:parent,k:key}=frame;let {s,owner}=frame;
   parents.set(n,parent);nodes.push(n);
   const switchParent=n.type==='SwitchStatement'?s:null;
   if(n.type==='FunctionDeclaration')bind(n.id,s,n,n);
   if(n.type==='ClassDeclaration')bind(n.id,s,n);
   if(n.type==='ClassExpression'){s={parent:s,names:new Map(),fn:false};bind(n.id,s,n);}
   if(functions.has(n.type)){owner=n;s={parent:s,names:new Map(),fn:true};if(n.type!=='FunctionDeclaration')bind(n.id,s,n,n);n.params.forEach(x=>bind(x,s));}
   else if(['BlockStatement','CatchClause','ForStatement','ForInStatement','ForOfStatement','SwitchStatement'].includes(n.type))s={parent:s,names:new Map(),fn:false};
   scopes.set(n,s);owners.set(n,owner);
   if(n.type==='CatchClause')bind(n.param,s);
   if(n.type==='VariableDeclaration'){let target=s;if(n.kind==='var')while(!target.fn)target=target.parent;for(const d of n.declarations)bind(d.id,target,d.init,functions.has(d.init?.type)?d.init:null);}
   const next=[];
   if(n.type==='SwitchStatement'){
    // The discriminant and case tests run outside the switch's lexical case
    // scope; only case consequents see declarations from the switch.
    for(const [ck,c]of children(n)){
     if(ck==='discriminant')next.push({kind:'node',n:c,s:switchParent,owner,p:n,k:ck});
     else if(ck==='cases')next.push({kind:'case',n,c,s,owner,switchParent});
    }
   }else for(const [ck,c]of children(n))next.push({kind:'node',n:c,s,owner,p:n,k:ck});
   for(let i=next.length-1;i>=0;i--)pending.push(next[i]);
  }
 }
 visit(tree,root);
 function reference(n){
  if(n.type!=='Identifier'||declarations.has(n))return false;
  const p=parents.get(n);
  if(p?.type==='MemberExpression'&&p.property===n&&!p.computed)return false;
  if(['Property','MethodDefinition'].includes(p?.type)&&p.key===n&&!p.computed&&p.value!==n)return false;
  if(['LabeledStatement','BreakStatement','ContinueStatement'].includes(p?.type)&&p.label===n)return false;
  return true;
 }
 for(const n of nodes)if(reference(n)){
  let b;for(let s=scopes.get(n);s;s=s.parent)if(s.names.has(n.name)){b=s.names.get(n.name);break;}
  if(b){
   bindings.set(n,b);b.refs.push(n);
   let target=n,p=parents.get(target);
   while(p&&(p.type==='RestElement'&&p.argument===target||p.type==='AssignmentPattern'&&p.left===target||p.type==='ArrayPattern'||p.type==='ObjectPattern'||p.type==='Property'&&p.value===target&&parents.get(p)?.type==='ObjectPattern')){target=p;p=parents.get(target);}
   if(p?.type==='AssignmentExpression'&&p.left===target||p?.type==='UpdateExpression'&&p.argument===target||['ForInStatement','ForOfStatement'].includes(p?.type)&&p.left===target)if(!b.writes.includes(p))b.writes.push(p);
  }
 }
 // A declared for-in/of target is written by the loop even though its
 // identifier is a declaration node rather than a reference. Record that
 // mutation so static folds cannot mistake `for (var key in record)` for an
 // uninitialized binding whose value is always undefined.
 for(const loop of nodes)if(['ForInStatement','ForOfStatement'].includes(loop.type)&&loop.left.type==='VariableDeclaration'){
  const addPattern=pattern=>{
   if(!pattern)return;
   if(pattern.type==='Identifier'){const b=bindings.get(pattern);if(b&&!b.writes.includes(loop))b.writes.push(loop);}
   else if(pattern.type==='RestElement')addPattern(pattern.argument);
   else if(pattern.type==='AssignmentPattern')addPattern(pattern.left);
   else if(pattern.type==='ArrayPattern')pattern.elements.forEach(addPattern);
   else if(pattern.type==='ObjectPattern')pattern.properties.forEach(p=>addPattern(p.type==='RestElement'?p.argument:p.value));
  };
  for(const declaration of loop.left.declarations)addPattern(declaration.id);
 }
 const free=(n,name)=>n?.type==='Identifier'&&reference(n)&&!bindings.has(n)&&(name===undefined||n.name===name);
 const classDeclarations=new Map(),functionAndVariableDeclarations=new Map();
 for(const n of nodes){
  const id=['ClassDeclaration','FunctionDeclaration','VariableDeclarator'].includes(n.type)?n.id:null,b=id&&bindings.get(id);
  if(!b)continue;
  if(n.type==='ClassDeclaration')classDeclarations.set(b,(classDeclarations.get(b)||0)+1);
  if(['FunctionDeclaration','VariableDeclarator'].includes(n.type))functionAndVariableDeclarations.set(b,(functionAndVariableDeclarations.get(b)||0)+1);
 }
 const result={nodes,parents,bindings,owners,scopes,free,reference,classDeclarations,functionAndVariableDeclarations};indices.set(tree,result);return result;
}
export function patch(source,n,render){
 let cs=children(n).map(([,c])=>c);
 if(!cs.length)return source.slice(n.start,n.end);
 if(cs.length>1){const spans=new Set();cs=cs.filter(c=>{const span=c.start+':'+c.end;if(spans.has(span))return false;spans.add(span);return true;}).sort((a,b)=>a.start-b.start);}
 const chunks=[];let pos=n.start,last='',integerTail=false;
 const word=/[\p{L}\p{N}_$]/u;
 const join=right=>{
  if(!right)return;
  // Replacements can remove the punctuation separating lexical tokens:
  // return!flag -> returnfalse, or !flag.toString -> 0.toString.
  const first=right[0]||'';
  if(n.type!=='TemplateLiteral'&&(word.test(last)&&word.test(first)||first==='.'&&integerTail)){chunks.push(' ');last=' ';integerTail=false;}
  chunks.push(right);
  const digits=/\d+$/u.exec(right),before=digits?(digits.index?right[digits.index-1]:last):'';
  integerTail=!!digits&&(!before||!word.test(before));
  last=right.at(-1)||last;
 };
 for(const c of cs){if(c.start<pos)continue;join(source.slice(pos,c.start));join(render(c));pos=c.end;}
 join(source.slice(pos,n.end));
 return chunks.join('');
}
export function renderTree(source,root,resolve=()=>null){
 const values=new WeakMap(),stack=[{node:root,state:0}];
 while(stack.length){
  const frame=stack.at(-1),n=frame.node;
  if(!frame.state){
   const rule=resolve(n);
   if(rule?.direct){values.set(n,rule.value);stack.pop();continue;}
   frame.rule=rule;frame.children=rule?.children??children(n).map(([,child])=>child);frame.state=1;
   for(let i=frame.children.length-1;i>=0;i--)stack.push({node:frame.children[i],state:0});
   continue;
  }
  stack.pop();const rendered=child=>values.get(child);
  values.set(n,frame.rule?.render?frame.rule.render(rendered):patch(source,n,rendered));
 }
 return values.get(root);
}

// Prove that entering a closed function/reference cannot precede a root
// initializer. Function expressions exist only after their creation point;
// hoisted declarations require every incoming reference to be dominated.
// 同一作用域内重复的 function 声明在实例化时由最后一个覆盖，绑定仍从作用域
// 入口起可用。只有所有声明都是 hoisted function 时才能沿共同调用点继续证明；
// 混入变量声明或写入时仍保持未知。
const hoistedFunctionBindings=new WeakMap();
function hoistedFunctionBinding(ix,binding){
 let answer=hoistedFunctionBindings.get(binding);
 if(answer!==undefined)return answer;
 const declarations=ix.nodes.filter(n=>(n.type==='FunctionDeclaration'||n.type==='VariableDeclarator')&&ix.bindings.get(n.id)===binding);
 answer=!!declarations.length&&declarations.every(n=>n.type==='FunctionDeclaration'&&(ix.parents.get(n)?.type==='Program'||ix.parents.get(n)?.type==='BlockStatement'&&functions.has(ix.parents.get(ix.parents.get(n))?.type)));
 hoistedFunctionBindings.set(binding,answer);
 return answer;
}
export function initializedAfter(ix,statement,ref){
 const {parents,owners,bindings,nodes}=ix,tree=nodes[0];
 function followsInContainingBlock(n){
  const block=parents.get(statement);
  if(!['Program','BlockStatement'].includes(block?.type))return false;
  let child=n;
  while(child&&parents.get(child)!==block)child=parents.get(child);
  return !!child&&child!==statement&&child.start>=statement.end;
 }
 function functionReferences(fn,parent){
  const id=fn.id??(parent?.type==='VariableDeclarator'?parent.id:null),b=bindings.get(id);
  if(!b||b.writes.length)return null;
  const refs=[...b.refs,...(ix.evaluationReferences?.get(b)??[])];
  if(!refs.length||ix.functionAndVariableDeclarations.get(b)!==1&&!hoistedFunctionBinding(ix,b))return null;
  return refs;
 }
 // Follow the closed call graph with explicit frames. Large bundled scripts
 // can contain thousands of chained helpers; recursive proof traversal must
 // not turn a valid dominance check into a JavaScript call-stack failure.
 const active=new Set(),stack=[{kind:'after',node:ref,state:'start'}];let answer=false;
 function complete(value){
  const done=stack.pop();if(done.kind==='entered'&&done.active)active.delete(done.fn);
  const parent=stack.at(-1);if(parent){parent.childValue=value;parent.hasChildValue=true;}else answer=value;
 }
 while(stack.length){
  const frame=stack.at(-1);
  if(frame.kind==='after'){
   if(frame.state==='waiting'){
    const value=frame.childValue;complete(value);continue;
   }
   const owner=owners.get(frame.node);
   if(owner!==tree){frame.state='waiting';stack.push({kind:'entered',fn:owner,state:'start'});continue;}
   let n=frame.node;
   if(followsInContainingBlock(n)){complete(true);continue;}
   while(parents.get(n)&&parents.get(n)!==tree)n=parents.get(n);
   complete(parents.get(n)===tree&&n.start>=statement.end);continue;
  }
  if(frame.state==='start'){
   const fn=frame.fn;
   if(!functions.has(fn?.type)){complete(false);continue;}
   // A recursion edge adds no earlier entry. Incoming edges outside the
   // active component still have to be dominated by the initializer.
   if(active.has(fn)){complete(true);continue;}
   active.add(fn);frame.active=true;
   const parent=parents.get(fn);
   // A method of a closed root class cannot run before a reference creating
   // its receiver. Prototype/static escapes are deliberately not admitted.
   if(parent?.type==='MethodDefinition'){
    if(parent.static){complete(false);continue;}
    const cls=parents.get(parents.get(parent)),b=cls?.type==='ClassDeclaration'?bindings.get(cls.id):null;
    if(!b||b.writes.length||!b.refs.length||ix.classDeclarations.get(b)!==1||
       !b.refs.every(r=>{const use=parents.get(r);return use?.type==='NewExpression'&&use.callee===r;})){
     complete(false);continue;
    }
    frame.children=b.refs;frame.next=0;frame.state='all';continue;
   }
   if(fn.type!=='FunctionDeclaration'){
    frame.state='expression';stack.push({kind:'after',node:parent,state:'start'});continue;
   }
   const refs=functionReferences(fn,parent);
   if(!refs){complete(false);continue;}
   frame.children=refs;frame.next=0;frame.state='all';continue;
  }
  if(frame.state==='expression'){
   const afterCreation=frame.childValue;delete frame.childValue;frame.hasChildValue=false;
   if(afterCreation){complete(true);continue;}
   const refs=functionReferences(frame.fn,parents.get(frame.fn));
   if(!refs){complete(false);continue;}
   frame.children=refs;frame.next=0;frame.state='all';continue;
  }
  if(frame.state==='all'){
   if(frame.hasChildValue){const value=frame.childValue;delete frame.childValue;frame.hasChildValue=false;
    if(!value){complete(false);continue;}frame.next++;
   }
   if(frame.next>=frame.children.length){complete(true);continue;}
   stack.push({kind:'after',node:frame.children[frame.next],state:'start'});continue;
  }
 }
 return answer;
}

// 证明一个未等待的 Promise 完成链是封闭的根任务。证明只沿静态调用图展开：
// 基座必须是立即执行的异步函数、可追溯的 Promise 工厂，或引用全部为直接调用
// 且声明支配调用点的本地异步函数；完成回调必须是内联函数或同样闭合的命名
// 函数。条件/循环/异常边界、绑定写入、回调别名逃逸，以及根之后出现无法证明
// 的普通语句，都会否决整条链。后续如果还有完成根，也必须是同样可证的根。
export function closedAsyncCompletionRoot(ix,call,completes,seen=new Set()){
 const {parents,bindings,free}=ix;
 const methods=new Set(['then','catch','finally']);
 if(call?.type!=='CallExpression'||seen.has(call))return false;
 const statement=parents.get(call);
 if(statement?.type!=='ExpressionStatement'||statement.expression!==call)return false;
 const block=parents.get(statement);
 if(!block||!['Program','BlockStatement'].includes(block.type))return false;
 const chain=[];let base=call;
 while(base.type==='CallExpression'&&base.callee.type==='MemberExpression'&&methods.has(property(base.callee))){
  const method=property(base.callee);
  if(base.optional||base.callee.optional||base.arguments.some(argument=>argument.type==='SpreadElement'))return false;
  if(base.arguments.length<1||base.arguments.length>(method==='then'?2:1))return false;
  chain.unshift({method,arguments:base.arguments});
  base=base.callee.object;
 }
 if(!chain.length)return false;
 const declarationStatement=fn=>{
  if(fn?.type==='FunctionDeclaration')return fn;
  const declarator=parents.get(fn),declaration=parents.get(declarator);
  return declarator?.type==='VariableDeclarator'&&declarator.init===fn&&declaration?.type==='VariableDeclaration'?declaration:null;
 };
 const callbackRegistration=ref=>{
  const argument=parents.get(ref),method=parents.get(argument);
  return method?.type==='CallExpression'&&argument.type!=='SpreadElement'&&
   method.callee.type==='MemberExpression'&&methods.has(property(method.callee))&&method.arguments.includes(argument);
 };
 // 完成回调只允许内联函数或初始化后未改绑、且只出现在已知 Promise 回调位置的
 // 命名函数。这同时排除提前注册、闭包逃逸和回调身份被替换。
 const callback=argument=>{
  if(functions.has(argument?.type))return argument;
  if(argument?.type!=='Identifier')return null;
  const binding=bindings.get(argument);
  if(!binding||binding.writes.length)return null;
  const fn=binding.fn??(functions.has(binding.init?.type)?binding.init:null);
  if(!fn||!binding.refs.length||binding.refs.some(ref=>!callbackRegistration(ref)))return null;
  const declaration=declarationStatement(fn);
  if(!declaration||!initializedAfter(ix,declaration,argument))return null;
  return fn;
 };
 let hasCompletion=false;
 for(const step of chain)for(const argument of step.arguments){
  const fn=callback(argument);
  if(!fn)return false;
  if(completes(fn))hasCompletion=true;
 }
 if(!hasCompletion)return false;
 // 基座只能是闭合异步函数的一次直接调用，或标准 Promise 的已知工厂。
 const directAsync=fn=>{
  const parent=parents.get(fn);
  if(parent!==base||base.callee!==fn)return false;
  if(!fn.async&&!ix.nodes.some(node=>ix.owners.get(node)===fn&&node.type==='AwaitExpression'))return false;
  if(fn.id?.name){const binding=bindings.get(fn.id);if(binding&&binding.refs.some(ref=>ref!==fn.id))return false;}
  return true;
 };
 if(base.type==='NewExpression'){
  if(!free(base.callee,'Promise')||base.arguments.length!==1||!callback(base.arguments[0]))return false;
 }else if(base.type==='CallExpression'){
  if(functions.has(base.callee.type)){if(!directAsync(base.callee))return false;}
  else if(base.callee.type==='Identifier'){
   const binding=bindings.get(base.callee),fn=binding?.fn??(functions.has(binding?.init?.type)?binding.init:null);
   if(!binding||binding.writes.length||!fn||!binding.refs.length)return false;
   if(binding.refs.some(ref=>{const use=parents.get(ref);return use?.type!=='CallExpression'||use.callee!==ref||use.optional||use.arguments.some(argument=>argument.type==='SpreadElement');}))return false;
   const declaration=declarationStatement(fn);
   if(!declaration||binding.refs.some(ref=>!initializedAfter(ix,declaration,ref)))return false;
  }else if(base.callee.type==='MemberExpression'){
   const knownPromise=free(base.callee.object,'Promise')&&['resolve','reject','all','allSettled','race','any'].includes(property(base.callee));
   const closedFetch=free(base.callee.object,'$task')&&property(base.callee)==='fetch';
   if(!knownPromise&&!closedFetch)return false;
  }else return false;
 }else return false;
 // 根任务之前不能处于条件、循环或异常处理分支，否则原生 Promise 的启动和
 // 拒绝路径会与作者代码不同。透明的 BlockStatement 只承载作用域，不构成旁路。
 for(let child=statement,parent=parents.get(child);parent;child=parent,parent=parents.get(child)){
  if(parent.type==='Program'||functions.has(parent.type))break;
  if(['IfStatement','ConditionalExpression','LogicalExpression','SwitchStatement','SwitchCase','ForStatement','ForInStatement','ForOfStatement','WhileStatement','DoWhileStatement','TryStatement','CatchClause'].includes(parent.type))return false;
  if(!['BlockStatement','LabeledStatement'].includes(parent.type))return false;
 }
 // 根之后只能有声明或另一个可证完成根；普通语句会在原生汇合后产生无法证明
 // 的额外执行路径。逐层越过透明块，直到函数/程序边界。
 const nextSeen=new Set(seen);nextSeen.add(call);
 for(let child=statement,parent=parents.get(child);parent;child=parent,parent=parents.get(child)){
  if(parent.type==='Program'||parent.type==='BlockStatement'){
   for(const next of parent.body.slice(parent.body.indexOf(child)+1)){
    if(['FunctionDeclaration','EmptyStatement'].includes(next.type))continue;
    if(next.type==='ExpressionStatement'&&closedAsyncCompletionRoot(ix,next.expression,completes,nextSeen))continue;
    return false;
   }
  }
  if(parent.type==='Program'||functions.has(parent.type))break;
 }
 return true;
}

// 证明类实例方法的全部引用都是已确认闭合接收者上的直接调用：同类内部的
// `this.name()`，或由 `new` 创建、从未逃逸或改绑的实例上的 `obj.name()`。
// 这是调用图闭合证明，不是对任意对象方法的近似推断。封闭工厂返回的匿名类只有
// 在工厂的每个引用都是直接 `new`、每个实例绑定不可变且实例只做静态成员访问时
// 才成立；动态键、原型访问、别名、条件逃逸或写入都会否决整份证明。
export function closedMethodCallers(ix,method){
 const {nodes,parents,bindings,owners}=ix;
 if(method?.type!=='MethodDefinition'||method.kind!=='method'||method.static||method.computed)return false;
 const name=key(method);
 if(typeof name!=='string'||name==='__proto__')return false;
 const classBody=parents.get(method),classNode=parents.get(classBody);
 if(!classBody||!classNode||!['ClassDeclaration','ClassExpression'].includes(classNode.type)||classNode.superClass)return false;
 let ownerBinding=null;
 if(classNode.id?.name){
  ownerBinding=bindings.get(classNode.id);
 }else{
  const construction=parents.get(classNode);
  if(construction?.type!=='NewExpression'||construction.callee!==classNode)return false;
  const returned=parents.get(construction);
  if(returned?.type!=='ReturnStatement')return false;
  const factory=parents.get(returned);
  if(!factory||!functions.has(factory.type))return false;
  const syntax=parents.get(factory);
  const id=factory.type==='FunctionDeclaration'?factory.id
   :syntax?.type==='VariableDeclarator'&&syntax.init===factory&&syntax.id.type==='Identifier'?syntax.id:null;
  ownerBinding=id?bindings.get(id):null;
 }
 if(!ownerBinding||ownerBinding.writes.length||!ownerBinding.refs.length)return false;
 const constructions=[];
 for(const ref of ownerBinding.refs){
  const construction=parents.get(ref);
  if(construction?.type!=='NewExpression'||construction.callee!==ref)return false;
  constructions.push(construction);
 }
 if(!constructions.length)return false;
 const instances=new Set();
 for(const construction of constructions){
  const declarator=parents.get(construction),declaration=parents.get(declarator);
  if(declarator?.type!=='VariableDeclarator'||declarator.init!==construction||declarator.id.type!=='Identifier'||declaration?.type!=='VariableDeclaration'||declaration.declarations.length!==1)return false;
  const instance=bindings.get(declarator.id);
  if(!instance||!instance.refs.length||instance.writes.length)return false;
  for(const ref of instance.refs){
   const member=parents.get(ref);
   if(member?.type!=='MemberExpression'||member.object!==ref||member.optional)return false;
   const field=property(member);
   if(typeof field!=='string'||['constructor','prototype','__proto__'].includes(field))return false;
   const use=parents.get(member);
   if(use?.type==='AssignmentExpression'&&use.left===member){
    if(use.operator!=='='||field===name)return false;
    continue;
   }
   if(use?.type==='UpdateExpression'||use?.type==='UnaryExpression'&&use.operator==='delete')return false;
  }
  instances.add(instance);
 }
 let calls=0;
 for(const n of nodes){
  if(n.type!=='MemberExpression'||property(n)!==name)continue;
  const use=parents.get(n),direct=use?.type==='CallExpression'&&use.callee===n&&!use.optional;
  if(n.object.type==='ThisExpression'){
   let owner=owners.get(n);
   while(owner?.type==='ArrowFunctionExpression')owner=owners.get(parents.get(owner));
   if(!owner||parents.get(owner)?.type!=='MethodDefinition'||parents.get(parents.get(owner))!==classBody||!direct)return false;
   calls++;
   continue;
  }
  if(n.object.type==='Identifier'&&instances.has(bindings.get(n.object))){
   if(!direct)return false;
   calls++;
   continue;
  }
  return false;
 }
 return calls>0;
}

// A case label only constrains its body when earlier cases cannot fall through.
export function isolatedSwitchCase(ix,clause){
 const statement=ix.parents.get(clause);if(statement?.type!=='SwitchStatement')return false;
 const exits=n=>n?.type==='ReturnStatement'||n?.type==='ThrowStatement'||n?.type==='BlockStatement'&&exits(n.body.at(-1))||n?.type==='IfStatement'&&exits(n.consequent)&&exits(n.alternate);
 return statement.cases.slice(0,statement.cases.indexOf(clause)).every(c=>exits(c.consequent.at(-1)));
}

// Follow a class constructor argument through its closed factory invocation.
// Defaults belong to both parameter lists; absence alone cannot prove that
// Object.assign(this, options) is inert.
export function factoryArgument(ix,factory,call,constructed,ctor,position){
 const missing=n=>!n||ix.free(n,'undefined')||n.type==='UnaryExpression'&&n.operator==='void';
 const supplied=(params,args,i)=>{let n=args[i];if(missing(n))n=params[i]?.type==='AssignmentPattern'?params[i].right:null;return n;};
 let value=supplied(ctor.params,constructed.arguments,position);
 if(value?.type==='Identifier'){
  const outer=factory.params.findIndex(p=>ix.bindings.get(p.type==='AssignmentPattern'?p.left:p)===ix.bindings.get(value));
  if(outer>=0)value=supplied(factory.params,call.arguments,outer);
  if(missing(value)&&ctor.params[position]?.type==='AssignmentPattern')value=ctor.params[position].right;
 }
 return value;
}

export function literalExpression(n){
 if(!n)return false;
 if(n.type==='Literal')return true;
 if(n.type==='UnaryExpression')return literalExpression(n.argument);
 if(n.type==='BinaryExpression'||n.type==='LogicalExpression')return literalExpression(n.left)&&literalExpression(n.right);
 if(n.type==='SequenceExpression')return n.expressions.every(literalExpression);
 return false;
}

// Standard ECMAScript globals and the Web primitives already used directly by
// the native compiler. Reading a qualified name needs no proxy API adaptation.
export const standardGlobals=new Set([
 'undefined','NaN','Infinity','globalThis','eval','Function','Object','Array',
 'Boolean','Number','BigInt','String','Symbol','Date','RegExp','Math','JSON',
 'Error','AggregateError','EvalError','RangeError','ReferenceError','SyntaxError','TypeError','URIError',
 'Promise','Map','Set','WeakMap','WeakSet','WeakRef','FinalizationRegistry',
 'ArrayBuffer','SharedArrayBuffer','DataView','Int8Array','Uint8Array','Uint8ClampedArray',
 'Int16Array','Uint16Array','Int32Array','Uint32Array','Float32Array','Float64Array','BigInt64Array','BigUint64Array',
 'Reflect','Proxy','Atomics','Intl','parseInt','parseFloat','isNaN','isFinite',
 'encodeURI','decodeURI','encodeURIComponent','decodeURIComponent','escape','unescape',
 'TextEncoder','TextDecoder','URL','URLSearchParams','Request','Response','Headers',
 'atob','btoa',
]);
