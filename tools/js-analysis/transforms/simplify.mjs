import {parse} from '../core/syntax.mjs';
import {index,patch,renderTree,initializedAfter} from '../core/ast.mjs';
import {evaluationBindings} from './evaluation.mjs';
import {CONSTANT_UNKNOWN,constantValue} from '../analysis/values.mjs';

// Scope-aware static simplification. Input code is never executed.

export function simplify(source){
 const UNKNOWN=Symbol('unknown constant');
 for(let pass=0;pass<4;pass++){
  const comments=[],tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true,onComment:comments}),ix=index(tree);
  const evaluated=evaluationBindings(ix,source);
  const removed=new WeakSet(),replace=new WeakMap(),declarations=new Map(),tables=new Map();
  const freeReferences=new Map(),switchDeclarations=new Map(),switchBreakStatements=new Map();
  const varDeclarations=[];
  const firstAtOrAfter=(items,value,selector=x=>x)=>{let low=0,high=items.length;while(low<high){const middle=(low+high)>>>1;if(selector(items[middle])<value)low=middle+1;else high=middle;}return low;};
  const hasCommentBetween=(start,end)=>{const i=firstAtOrAfter(comments,start,comment=>comment.start);return i<comments.length&&comments[i].start<end&&comments[i].end<=end;};
  // Index repeated global-read queries once. Large minified bundles often
  // contain many legacy loops that share names; rescanning every AST node for
  // each loop made simplification quadratic.
  for(const node of ix.nodes){
   if(node.type==='VariableDeclaration'&&node.kind==='var')varDeclarations.push(node);
   if(ix.free(node)){
    let refs=freeReferences.get(node.name);if(!refs)freeReferences.set(node.name,refs=[]);refs.push(node);
   }
   if(node.type==='VariableDeclarator'){
    const declaration=ix.parents.get(node);if(!['let','const'].includes(declaration?.kind))continue;
    for(let parent=ix.parents.get(declaration);parent;parent=ix.parents.get(parent))if(parent.type==='SwitchCase'){
     let refs=switchDeclarations.get(parent);if(!refs)switchDeclarations.set(parent,refs=[]);refs.push(node);
    }
   }
   if(node.type==='BreakStatement'&&!node.label){
    let owner=ix.parents.get(node);while(owner&&!['ForStatement','ForInStatement','ForOfStatement','WhileStatement','DoWhileStatement','SwitchStatement'].includes(owner.type))owner=ix.parents.get(owner);
    if(owner?.type==='SwitchStatement'){
     let statement=node,parent=ix.parents.get(statement);while(parent&&parent.type!=='SwitchCase'&&parent!==owner){statement=parent;parent=ix.parents.get(parent);}
     if(parent?.type==='SwitchCase'){let breaks=switchBreakStatements.get(owner);if(!breaks)switchBreakStatements.set(owner,breaks=[]);breaks.push(statement);}
    }
   }
  }
  const varsInside=(statement,owner)=>{
   const vars=[];for(let i=firstAtOrAfter(varDeclarations,statement.start,node=>node.start);i<varDeclarations.length&&varDeclarations[i].start<statement.end;i++){
    const declaration=varDeclarations[i];if(declaration.end<=statement.end&&ix.owners.get(declaration)===owner)vars.push(declaration);
   }return vars;
  };
  const strict=n=>{for(let p=n;p;p=ix.parents.get(p))if(['ClassDeclaration','ClassExpression'].includes(p.type)||(p.type==='Program'?p.body:p.body?.body)?.some(s=>s.directive==='use strict'))return true;return false;};
  for(const loop of ix.nodes)if(['ForInStatement','ForOfStatement'].includes(loop.type)&&loop.left.type==='Identifier'&&ix.free(loop.left)){
   if(strict(loop))continue;
   const name=loop.left.name,refs=freeReferences.get(name)??[];
   if(!name.startsWith('$')&&!/^(?:globalThis|global|window|module|exports|process|console|undefined|NaN|Infinity|eval|fetch|setTimeout|setInterval|clearTimeout|clearInterval|[A-Z]\w*)$/.test(name)&&refs.every(n=>n===loop.left||n.start>=loop.body.start&&n.end<=loop.body.end&&ix.owners.get(n)===ix.owners.get(loop)))replace.set(loop.left,'let '+name);
  }
  for(const loop of ix.nodes)if(loop.type==='ForStatement'&&loop.init?.type==='AssignmentExpression'&&loop.init.operator==='='&&ix.free(loop.init.left)){
   if(strict(loop))continue;
   const name=loop.init.left.name,refs=freeReferences.get(name)??[];
   const host=/^(?:globalThis|global|window|module|exports|process|console|undefined|NaN|Infinity|eval|fetch|setTimeout|setInterval|clearTimeout|clearInterval)$|^(?:Object|Array|JSON|Date|Math|Reflect|Proxy|Promise|Symbol|Function|Number|String|Boolean|RegExp|BigInt|Map|Set|WeakMap|WeakSet|Error|TypeError|RangeError|ArrayBuffer|DataView|[A-Z]\w*Array|TextEncoder|TextDecoder|URL|URLSearchParams|Request|Response|Headers)$/;
   if(!name.startsWith('$')&&!host.test(name)&&refs.every(n=>n===loop.init.left||n.start>=loop.init.end&&n.end<=loop.end&&ix.owners.get(n)===ix.owners.get(loop)))replace.set(loop.init,'let '+source.slice(loop.init.start,loop.init.end));
  }
  for(const d of ix.nodes)if(d.type==='VariableDeclarator'&&d.id.type==='Identifier'){
   const b=ix.bindings.get(d.id);if(!declarations.has(b))declarations.set(b,[]);declarations.get(b).push(d);
  }
  const abrupt=n=>{
   // An absent alternate branch is the ordinary fall-through path.
   if(!n)return false;
   if(n.type==='ReturnStatement'||n.type==='ThrowStatement')return true;
   if(n.type==='BlockStatement')return n.body.some(abrupt);
   if(n.type==='IfStatement'){
    const test=constant(n.test);
    if(test!==UNKNOWN)return abrupt(test?n.consequent:n.alternate);
    return !!n.alternate&&abrupt(n.consequent)&&abrupt(n.alternate);
   }
   return false;
  };
  const patternNames=n=>!n?[]:n.type==='Identifier'?[n.name]:n.type==='RestElement'?patternNames(n.argument):n.type==='AssignmentPattern'?patternNames(n.left):n.type==='ArrayPattern'?n.elements.flatMap(patternNames):n.type==='ObjectPattern'?n.properties.flatMap(p=>patternNames(p.type==='RestElement'?p.argument:p.value)):[];
  for(const n of ix.nodes)if(['Program','BlockStatement'].includes(n.type)){
   let stopped=false,returned=false;
   for(const s of n.body){
    if(returned&&s.type!=='FunctionDeclaration'&&!(n.type==='Program'&&s.type==='ExpressionStatement'&&s.expression.type==='CallExpression'&&ix.free(s.expression.callee,'$done'))){
     // Keep hoisted var and lexical TDZ bindings. Their unreachable initializers
     // cannot have effects, but deleting the bindings can change earlier reads.
     if(s.type==='VariableDeclaration'){
      const names=s.declarations.flatMap(d=>patternNames(d.id));
      replace.set(s,names.length?(s.kind==='const'?'let':s.kind)+' '+names.join(', ')+';':'');
     }
     else if(s.type==='ClassDeclaration')replace.set(s,'let '+s.id.name+';');
     else{const vars=varsInside(s,ix.owners.get(s));if(vars.some(d=>d.declarations.some(x=>x.id.type!=='Identifier')))continue;if(vars.length)replace.set(s,vars.map(d=>'var '+d.declarations.map(x=>source.slice(x.id.start,x.id.end)).join(', ')+';').join('\n'));else removed.add(s);}
    }else if(stopped&&['ExpressionStatement','EmptyStatement'].includes(s.type))removed.add(s);
    if(abrupt(s))returned=true;
    if(s.type==='ExpressionStatement'&&s.expression.type==='CallExpression'&&ix.free(s.expression.callee,'$done'))stopped=true;
   }
  }

  function table(n){
   const b=ix.bindings.get(n);if(!b||evaluated.has(b))return null;
   if(tables.has(b))return tables.get(b);tables.set(b,null);
   if(!b.init||b.writes.length||b.init.type!=='ArrayExpression'||b.init.elements.some(e=>e?.type!=='Literal'))return null;
   const ds=declarations.get(b);if(ds?.length!==1)return null;
   const declaration=ix.parents.get(ds[0]),block=ix.parents.get(declaration);
   if(!['Program','BlockStatement'].includes(block?.type))return null;
   // An initialized table must dominate each read. Do not fold a closed-over
   // table or a read in the declaration itself (TDZ/var hoisting matters).
   const dominated=r=>{let s=r;while(ix.parents.get(s)&&ix.parents.get(s)!==block)s=ix.parents.get(s);return ix.parents.get(s)===block&&s.start>=declaration.end&&ix.owners.get(r)===ix.owners.get(declaration);};
   if(!b.refs.every(dominated))return null;
   if(!b.refs.every(r=>{const p=ix.parents.get(r),q=ix.parents.get(p);return p?.type==='MemberExpression'&&p.object===r&&p.computed&&p.property.type==='Literal'&&Number.isInteger(p.property.value)&&!(q?.type==='AssignmentExpression'&&q.left===p||q?.type==='UpdateExpression'||q?.type==='UnaryExpression'&&q.operator==='delete');}))return null;
   tables.set(b,b.init.elements);return b.init.elements;
  }
  // Closed primitive configuration facts are ordinary JavaScript constants.
  // Replace reads only after their declaration, including nested callbacks.
  for(const d of ix.nodes)if(d.type==='VariableDeclarator'&&d.id.type==='Identifier'&&d.init?.type==='Literal'&&['boolean','string','number'].includes(typeof d.init.value)){
   const b=ix.bindings.get(d.id);if(!b||b.writes.length||evaluated.has(b))continue;
   const declaration=ix.parents.get(d),block=ix.parents.get(declaration),owner=ix.owners.get(d);
   if(!declaration||!['Program','BlockStatement'].includes(block?.type))continue;
   const nested=ref=>{const o=ix.owners.get(ref);for(let scope=o;scope;scope=ix.parents.get(scope))if(scope===owner)return true;return false;};
   // An immutable primitive binding is safe to substitute in every dominated
   // read, including values captured by a later callback. Restricting this to
   // predicate expressions left platform constants inside switch helpers and
   // prevented their unreachable branches from being pruned.
   if(b.refs.every(ref=>ref.start>declaration.end&&nested(ref)&&!hasCommentBetween(declaration.start,ref.start)))
    for(const ref of b.refs)replace.set(ref,JSON.stringify(d.init.value));
  }
  for(const n of ix.nodes)if(n.type==='MemberExpression'&&n.object.type==='Identifier'){
   const values=table(n.object),v=values?.[n.property.value];
   if(v&&typeof v.value!=='bigint'&&!v.regex&&!(typeof v.value==='number'&&!Number.isFinite(v.value)))replace.set(n,JSON.stringify(v.value));
  }
  const pure=n=>n&&(n.type==='Literal'||n.type==='ArrayExpression'&&n.elements.every(pure));
  function constant(root){
   // Constant aliases and generated predicates can be thousands of nodes deep.
   // Evaluate them with explicit frames so valid input depth cannot exhaust the
   // JavaScript call stack. Active bindings also make cyclic initializers
   // conservatively unknown instead of recursing forever.
   const active=new Set(),stack=[{node:root,state:'start'}];let result=UNKNOWN;
   function complete(value){
    const done=stack.pop();if(done.binding)active.delete(done.binding);
    const parent=stack.at(-1);if(parent){parent.child=value;parent.hasChild=true;}else result=value;
   }
   while(stack.length){
    const frame=stack.at(-1),n=frame.node;
    if(frame.state==='start'){
     if(!n){complete(UNKNOWN);continue;}
     // 闭合对象表成员与单条 return 的闭合谓词可以静态求值；只接受原始值，
     // 对象/函数描述符仍交给后续规则，避免把可变引用当成常量。
     if(n.type==='MemberExpression'||n.type==='CallExpression'||n.type==='TemplateLiteral'&&!n.expressions.length){
      const value=constantValue(ix,n);
      if(value!==CONSTANT_UNKNOWN&&(value===null||!['object','function'].includes(typeof value))){complete(value);continue;}
     }
     if(n.type==='Literal'){complete(n.value);continue;}
     if(n.type==='Identifier'&&n.name==='undefined'&&ix.free(n)){complete(undefined);continue;}
     if(n.type==='Identifier'){
      const binding=ix.bindings.get(n),initializer=binding?.init,declarator=initializer&&ix.parents.get(initializer),statement=declarator&&ix.parents.get(declarator);
      if(binding&&!evaluated.has(binding)&&!binding.writes.length&&initializer&&statement?.type==='VariableDeclaration'&&
        ['const','let','var'].includes(statement.kind)&&initializedAfter(ix,statement,n)){
       if(active.has(binding)){complete(UNKNOWN);continue;}
       active.add(binding);frame.binding=binding;frame.state='child';stack.push({node:initializer,state:'start'});continue;
      }
      complete(UNKNOWN);continue;
     }
     if(n.type==='UnaryExpression'){frame.state='unary';stack.push({node:n.argument,state:'start'});continue;}
     if(n.type==='BinaryExpression'){frame.state='binary-left';stack.push({node:n.left,state:'start'});continue;}
     if(n.type==='LogicalExpression'){frame.state='logical-left';stack.push({node:n.left,state:'start'});continue;}
     if(n.type==='ConditionalExpression'){frame.state='conditional-test';stack.push({node:n.test,state:'start'});continue;}
     complete(UNKNOWN);continue;
    }
    if(frame.state==='child'){
     const value=frame.child;complete(value);continue;
    }
    if(frame.state==='unary'){
     const value=frame.child;if(value===UNKNOWN){complete(UNKNOWN);continue;}
     if(n.operator==='!'){complete(!value);continue;}if(n.operator==='void'){complete(undefined);continue;}
     if(n.operator==='typeof'){complete(typeof value);continue;}
     if(n.operator==='+'&&['number','string','boolean'].includes(typeof value)){complete(+value);continue;}
     if(n.operator==='-'&&['number','string','boolean'].includes(typeof value)){complete(-value);continue;}
     complete(UNKNOWN);continue;
    }
    if(frame.state==='binary-left'){
     const left=frame.child;if(left===UNKNOWN){complete(UNKNOWN);continue;}
     frame.left=left;frame.state='binary-right';stack.push({node:n.right,state:'start'});continue;
    }
    if(frame.state==='binary-right'){
     const left=frame.left,right=frame.child;if(right===UNKNOWN){complete(UNKNOWN);continue;}
     switch(n.operator){
      case '===':complete(left===right);break;case '!==':complete(left!==right);break;
      case '==':complete(left==right);break;case '!=':complete(left!=right);break;
      case '<':complete(left<right);break;case '<=':complete(left<=right);break;
      case '>':complete(left>right);break;case '>=':complete(left>=right);break;
      case '+':complete(left+right);break;default:complete(UNKNOWN);
     }
     continue;
    }
    if(frame.state==='logical-left'){
     const left=frame.child;if(left===UNKNOWN){complete(UNKNOWN);continue;}
     if(n.operator==='&&'&&!left||n.operator==='||'&&left||n.operator==='??'&&left!==null&&left!==undefined){complete(left);continue;}
     if(!['&&','||','??'].includes(n.operator)){complete(UNKNOWN);continue;}
     frame.state='logical-right';stack.push({node:n.right,state:'start'});continue;
    }
    if(frame.state==='logical-right'){complete(frame.child);continue;}
    if(frame.state==='conditional-test'){
     const test=frame.child;if(test===UNKNOWN){complete(UNKNOWN);continue;}
     frame.state='conditional-branch';stack.push({node:test?n.consequent:n.alternate,state:'start'});continue;
    }
    if(frame.state==='conditional-branch'){complete(frame.child);continue;}
   }
   return result;
  }
  function render(root){
   return renderTree(source,root,n=>{
    if(removed.has(n))return {direct:true,value:''};
    if(n.type==='Property'&&n.shorthand&&replace.has(n.value))return {children:[n.value],render:child=>`${source.slice(n.key.start,n.key.end)}: ${child(n.value)}`};
    if(replace.has(n))return {direct:true,value:replace.get(n)};
    if(n.type==='IfStatement'){
     const test=constant(n.test);if(test!==UNKNOWN){
      const branch=test?n.consequent:n.alternate,parent=ix.parents.get(n),required=parent&&(
       parent.type==='IfStatement'&&parent.alternate===n
       ||parent.type==='LabeledStatement'&&parent.body===n
       ||parent.type==='WithStatement'&&parent.body===n
       ||['DoWhileStatement','ForInStatement','ForOfStatement','ForStatement','WhileStatement'].includes(parent.type)&&parent.body===n
      );
      return {children:branch?[branch]:[],render:child=>{const result=branch?child(branch):'';return result||required?result||';':'';}};
     }
    }
    if(n.type==='SwitchStatement'){
     const discriminant=n.discriminant.type==='SequenceExpression'?n.discriminant.expressions.at(-1):n.discriminant;
     const prefix=n.discriminant.type==='SequenceExpression'?n.discriminant.expressions.slice(0,-1):[];
     const subject=constant(discriminant);if(subject!==UNKNOWN){
      let selected=-1,fallback=-1,labelsKnown=true;
      for(let i=0;i<n.cases.length;i++){
       const clause=n.cases[i];if(!clause.test){fallback=i;continue;}
       const test=constant(clause.test);if(test===UNKNOWN){labelsKnown=false;break;}
       if(subject===test){selected=i;break;}
      }
      if(labelsKnown){
       if(selected<0)selected=fallback;
       const clauses=selected<0?[]:n.cases.slice(selected),statements=[];let stopped=false,safe=true;
       for(const clause of clauses){
        for(const statement of clause.consequent){
         if(statement.type==='BreakStatement'&&!statement.label){stopped=true;break;}
         if(statement.type==='VariableDeclaration'&&statement.kind==='var'){safe=false;break;}
         statements.push(statement);
        }
        if(!safe||stopped)break;
       }
       const inside=(node,root)=>node.start>=root.start&&node.end<=root.end;
       if(safe)for(let i=0;i<n.cases.length;i++)if(i<selected||i>selected&&stopped){
        const clause=n.cases[i];
        for(const declaration of switchDeclarations.get(clause)??[]){
         const binding=ix.bindings.get(declaration.id);
         if(binding?.refs.some(ref=>!inside(ref,clause))){safe=false;break;}
        }
        if(!safe)break;
       }
       // A nested break that targets this switch would change its control flow
       // when the selected case is moved into a plain block.
       if(safe){const moved=new Set(statements);if((switchBreakStatements.get(n)??[]).some(statement=>moved.has(statement)))safe=false;}
       if(safe){
        const children=[...prefix,...statements];
        return {children,render:child=>{
         const renderedBody='{'+statements.map(child).join('\n')+'}';
         // Switch discriminants evaluate before the switch's lexical case scope.
         // Keep comma-expression effects in that outer scope so a case binding
         // cannot shadow a name read by the discriminant.
         return prefix.length?'{'+prefix.map(expression=>child(expression)+';').join('\n')+'\n'+renderedBody+'}':renderedBody;
        }};
       }
      }
     }
    }
    if(n.type==='ConditionalExpression'){
     const test=constant(n.test);if(test!==UNKNOWN){const branch=test?n.consequent:n.alternate;return {children:[branch],render:child=>child(branch)};}
    }
    if(n.type==='LogicalExpression'){
     const left=constant(n.left);if(left!==UNKNOWN){
      const branch=n.operator==='&&'?left?n.right:n.left:n.operator==='||'?left?n.left:n.right:n.operator==='??'?left===null||left===undefined?n.right:n.left:null;
      if(branch)return {children:[branch],render:child=>child(branch)};
     }
    }
    if(n.type==='VariableDeclaration'&&!hasCommentBetween(n.start,n.end)){
     const keep=n.declarations.filter(d=>{const b=d.id.type==='Identifier'?ix.bindings.get(d.id):null;return !(b&&!evaluated.has(b)&&!b.refs.length&&!b.writes.length&&(pure(d.init)||/^(?:FunctionExpression|ArrowFunctionExpression)$/.test(d.init?.type||'')));});
     if(keep.length!==n.declarations.length){
      const parent=ix.parents.get(n);
      if(!['ForStatement','ForInStatement','ForOfStatement'].includes(parent?.type))return keep.length?{children:keep,render:child=>n.kind+' '+keep.map(child).join(', ')+';'}:{direct:true,value:''};
     }
    }
    return null;
   });
  }
  const next=render(tree);if(next===source)break;source=next;
 }
 return source;
}
