import {parse} from '../core/syntax.mjs';
import {index,patch,initializedAfter} from '../core/ast.mjs';
import {evaluationBindings} from './evaluation.mjs';

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
  function constant(n){
   if(!n)return UNKNOWN;
   if(n.type==='Literal')return n.value;
   if(n.type==='Identifier'&&n.name==='undefined'&&ix.free(n))return undefined;
   if(n.type==='Identifier'){
    const binding=ix.bindings.get(n),initializer=binding?.init,declarator=initializer&&ix.parents.get(initializer),statement=declarator&&ix.parents.get(declarator);
    if(binding&&!evaluated.has(binding)&&!binding.writes.length&&initializer&&statement?.type==='VariableDeclaration'&&
      ['const','let','var'].includes(statement.kind)&&initializedAfter(ix,statement,n)){
     const value=constant(initializer);if(value!==UNKNOWN)return value;
    }
   }
   if(n.type==='UnaryExpression'){
    const value=constant(n.argument);if(value===UNKNOWN)return UNKNOWN;
    if(n.operator==='!')return !value;if(n.operator==='void')return undefined;
    if(n.operator==='typeof')return typeof value;if(n.operator==='+'&&['number','string','boolean'].includes(typeof value))return +value;
    if(n.operator==='-'&&['number','string','boolean'].includes(typeof value))return -value;
   }
   if(n.type==='BinaryExpression'){
    const left=constant(n.left),right=constant(n.right);if(left===UNKNOWN||right===UNKNOWN)return UNKNOWN;
    switch(n.operator){case '===':return left===right;case '!==':return left!==right;case '==':return left==right;case '!=':return left!=right;case '<':return left<right;case '<=':return left<=right;case '>':return left>right;case '>=':return left>=right;case '+':return left+right;}
   }
   if(n.type==='LogicalExpression'){
    const left=constant(n.left);if(left===UNKNOWN)return UNKNOWN;
    if(n.operator==='&&')return left?constant(n.right):left;
    if(n.operator==='||')return left?left:constant(n.right);
    if(n.operator==='??')return left===null||left===undefined?constant(n.right):left;
   }
   if(n.type==='ConditionalExpression'){
    const test=constant(n.test);return test===UNKNOWN?UNKNOWN:constant(test?n.consequent:n.alternate);
   }
   return UNKNOWN;
  }
  function render(n){
   if(removed.has(n))return '';
   if(n.type==='Property'&&n.shorthand&&replace.has(n.value))return `${source.slice(n.key.start,n.key.end)}: ${render(n.value)}`;
   if(replace.has(n))return replace.get(n);
   if(n.type==='IfStatement'){
    const test=constant(n.test);if(test!==UNKNOWN){
     const branch=test?n.consequent:n.alternate,result=branch?render(branch):'';
     const parent=ix.parents.get(n),required=parent&&(
      parent.type==='IfStatement'&&parent.alternate===n
      ||parent.type==='LabeledStatement'&&parent.body===n
      ||parent.type==='WithStatement'&&parent.body===n
      ||['DoWhileStatement','ForInStatement','ForOfStatement','ForStatement','WhileStatement'].includes(parent.type)&&parent.body===n
     );
     // A consequent/alternate may be deleted inside a block, but JavaScript
     // requires a Statement after `else`, a loop header, or a label. Preserve
     // the equivalent empty statement so nested `else if` chains stay valid.
     return result||required?result||';':'';
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
       const body='{'+statements.map(render).join('\n')+'}';
       // Switch discriminants evaluate before the switch's lexical case scope.
       // Keep comma-expression effects in that outer scope so a case binding
       // cannot shadow a name read by the discriminant.
       if(prefix.length)return '{'+prefix.map(expression=>render(expression)+';').join('\n')+'\n'+body+'}';
       return body;
      }
     }
    }
   }
   if(n.type==='ConditionalExpression'){
    const test=constant(n.test);if(test!==UNKNOWN)return render(test?n.consequent:n.alternate);
   }
   if(n.type==='LogicalExpression'){
    const left=constant(n.left);if(left!==UNKNOWN){
     if(n.operator==='&&')return left?render(n.right):render(n.left);
     if(n.operator==='||')return left?render(n.left):render(n.right);
     if(n.operator==='??')return left===null||left===undefined?render(n.right):render(n.left);
    }
   }
   if(n.type==='VariableDeclaration'&&!hasCommentBetween(n.start,n.end)){
    const keep=n.declarations.filter(d=>{const b=d.id.type==='Identifier'?ix.bindings.get(d.id):null;return !(b&&!evaluated.has(b)&&!b.refs.length&&!b.writes.length&&(pure(d.init)||/^(?:FunctionExpression|ArrowFunctionExpression)$/.test(d.init?.type||'')));});
    if(keep.length!==n.declarations.length){
     const parent=ix.parents.get(n);
     if(['ForStatement','ForInStatement','ForOfStatement'].includes(parent?.type))return patch(source,n,render);
     return keep.length?n.kind+' '+keep.map(render).join(', ')+';':'';
    }
   }
   return patch(source,n,render);
  }
  const next=render(tree);if(next===source)break;source=next;
 }
 return source;
}
