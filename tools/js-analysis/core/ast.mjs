

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
 function visit(n,s,owner=tree,p=null,k=''){
  parents.set(n,p);nodes.push(n);
  const switchParent=n.type==='SwitchStatement'?s:null;
  if(n.type==='FunctionDeclaration')bind(n.id,s,n,n);
  if(n.type==='ClassDeclaration')bind(n.id,s,n);
  if(n.type==='ClassExpression'){s={parent:s,names:new Map(),fn:false};bind(n.id,s,n);}
  if(functions.has(n.type)){owner=n;s={parent:s,names:new Map(),fn:true};if(n.type!=='FunctionDeclaration')bind(n.id,s,n,n);n.params.forEach(x=>bind(x,s));}
  else if(['BlockStatement','CatchClause','ForStatement','ForInStatement','ForOfStatement','SwitchStatement'].includes(n.type))s={parent:s,names:new Map(),fn:false};
  scopes.set(n,s);owners.set(n,owner);
  if(n.type==='CatchClause')bind(n.param,s);
  if(n.type==='VariableDeclaration'){let target=s;if(n.kind==='var')while(!target.fn)target=target.parent;for(const d of n.declarations)bind(d.id,target,d.init,functions.has(d.init?.type)?d.init:null);}
  if(n.type==='SwitchStatement'){
   // The discriminant and case tests run outside the switch's lexical case
   // scope; only case consequents see lexical declarations from the switch.
   for(const [ck,c]of children(n)){
    if(ck==='discriminant')visit(c,switchParent,owner,n,ck);
    else if(ck==='cases'){
     parents.set(c,n);nodes.push(c);scopes.set(c,s);owners.set(c,owner);
     if(c.test)visit(c.test,switchParent,owner,c,'test');
     for(const statement of c.consequent)visit(statement,s,owner,c,'consequent');
    }
   }
  }else for(const [ck,c]of children(n))visit(c,s,owner,n,ck);
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

// Prove that entering a closed function/reference cannot precede a root
// initializer. Function expressions exist only after their creation point;
// hoisted declarations require every incoming reference to be dominated.
export function initializedAfter(ix,statement,ref){
 const {parents,owners,bindings,nodes}=ix,tree=nodes[0];
 function followsInContainingBlock(n){
  const block=parents.get(statement);
  if(!['Program','BlockStatement'].includes(block?.type))return false;
  let child=n;
  while(child&&parents.get(child)!==block)child=parents.get(child);
  return !!child&&child!==statement&&child.start>=statement.end;
 }
 function after(n,seen){
  const owner=owners.get(n);if(owner!==tree)return entered(owner,seen);
  if(followsInContainingBlock(n))return true;
  while(parents.get(n)&&parents.get(n)!==tree)n=parents.get(n);
  return parents.get(n)===tree&&n.start>=statement.end;
 }
 function entered(fn,seen){
  if(!functions.has(fn?.type))return false;
  // A recursion edge adds no earlier entry. Every incoming edge outside the
  // current component must still be dominated by the initializer.
  if(seen.has(fn))return true;
  const next=new Set(seen);next.add(fn);const p=parents.get(fn);
  // A method of a closed root class cannot run before any reference creating
  // its receiver. Prototype/static escapes are deliberately not admitted.
  if(p?.type==='MethodDefinition'){
   if(p.static)return false;
   const cls=parents.get(parents.get(p)),b=cls?.type==='ClassDeclaration'?bindings.get(cls.id):null;
   if(!b||b.writes.length||!b.refs.length||ix.classDeclarations.get(b)!==1)return false;
   return b.refs.every(r=>{const use=parents.get(r);return use?.type==='NewExpression'&&use.callee===r&&after(r,next);});
  }
  if(fn.type!=='FunctionDeclaration'&&after(p,next))return true;
  const id=fn.id??(p?.type==='VariableDeclarator'?p.id:null),b=bindings.get(id);if(!b||b.writes.length)return false;
  const refs=[...b.refs,...(ix.evaluationReferences?.get(b)??[])];if(!refs.length)return false;
  if(ix.functionAndVariableDeclarations.get(b)!==1)return false;
  return refs.every(r=>after(r,next));
 }
 return after(ref,new Set());
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
