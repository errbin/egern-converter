import {children,patch,renderTree,property,key,functions,initializedAfter,closedAsyncCompletionRoot,standardGlobals as builtin,index,privateGlobalAssignment} from '../core/ast.mjs';
import {parse} from '../core/syntax.mjs';
import {valueFacts,regeneratorStateMachine} from '../analysis/values.mjs';

// 唯一静态方法定义 + 唯一调用点，且方法体只做原型/属性设置后原样返回参数：
// 该调用对回调值而言是恒等包装。名字在整个封闭程序内必须唯一，避免同名方法
// 来自外部对象或发生重写。
export function closedIdentityMethodCall(ix,call,arg){
 const {nodes,parents,bindings,free}=ix;
 if(call?.type!=='CallExpression'||call.arguments.length!==1||call.arguments[0]!==arg)return false;
 const callee=call.callee;if(callee.type!=='MemberExpression')return false;
 const name=property(callee);if(name===undefined||name==='__proto__'||name==='constructor')return false;
 const definitions=[],uses=[],definitionMembers=new Set();
 for(const n of nodes){
  if(n.type==='AssignmentExpression'&&n.operator==='='&&n.left.type==='MemberExpression'&&property(n.left)===name&&functions.has(n.right?.type)){definitions.push(n.right);definitionMembers.add(n.left);}
  else if(n.type==='Property'&&n.kind==='init'&&key(n)===name&&functions.has(n.value?.type))definitions.push(n.value);
  else if(n.type==='MemberExpression'&&property(n)===name)uses.push(n);
 }
 if(definitions.length!==1||uses.length!==definitionMembers.size+1||uses.find(item=>!definitionMembers.has(item))!==callee)return false;
 const builtin=new Set(['Object','Array','JSON','Math','String','Number','Boolean','Promise','Error','Date','RegExp','Function','Symbol','Reflect','Map','Set','WeakMap','WeakSet','parseInt','parseFloat','isNaN','isFinite','encodeURI','decodeURI','encodeURIComponent','decodeURIComponent']);
 const local=n=>{
  if(!n)return false;
  if(n.type==='Literal')return true;
  if(n.type==='Identifier')return !!bindings.get(n)||builtin.has(n.name);
  if(n.type==='MemberExpression')return local(n.object)&&(!n.computed||n.property.type==='Literal');
  if(n.type==='CallExpression')return local(n.callee)&&!n.optional&&n.arguments.every(local);
  if(n.type==='SequenceExpression')return n.expressions.every(local);
  return false;
 };
 if(!local(callee.object))return false;
 const wrapper=definitions[0];
 if(wrapper.async||wrapper.generator||wrapper.params.length!==1||wrapper.params[0].type!=='Identifier')return false;
 const parameter=bindings.get(wrapper.params[0]);if(!parameter||parameter.writes.length)return false;
 const same=n=>n?.type==='Identifier'&&bindings.get(n)===parameter;
 const objectBuiltin=n=>n?.type==='MemberExpression'&&free(n.object,'Object')&&['setPrototypeOf','create','defineProperty','getPrototypeOf'].includes(property(n));
 const unknown=Symbol('unknown');
 // 闭合字面量表只能通过静态成员读取；整体引用只有在可证死分支里才可忽略，
 // 成员写入、更新或删除都会让谓词求值不再确定。递归校验同一张表时跳过重复
 // 扫描，由外层完成一次完整引用检查。
 const checkingObjects=new Set();
 const closedObject=n=>{
  let object=n;
  if(n?.type==='Identifier'){
   const binding=bindings.get(n);
   if(!binding||binding.writes.length||binding.init?.type!=='ObjectExpression')return null;
   if(!checkingObjects.has(binding)){
    checkingObjects.add(binding);
    for(const ref of binding.refs){
     const use=parents.get(ref);
     if(use?.type==='MemberExpression'&&use.object===ref&&property(use)!==undefined){
      const parent=parents.get(use);
      if(parent?.type==='AssignmentExpression'&&parent.left===use||parent?.type==='UpdateExpression'||parent?.type==='UnaryExpression'&&parent.operator==='delete'){checkingObjects.delete(binding);return null;}
      continue;
     }
     if(deadReference(ref))continue;
     checkingObjects.delete(binding);return null;
    }
    checkingObjects.delete(binding);
   }
   object=binding.init;
  }
  return object?.type==='ObjectExpression'?object:null;
 };
 const closedProperty=n=>{
  if(n?.type!=='MemberExpression')return null;
  const object=closedObject(n.object),name=property(n);
  if(!object||name===undefined)return null;
  const entries=object.properties.filter(entry=>entry.type==='Property'&&entry.kind==='init'&&key(entry)===name);
  return entries.length===1&&entries[0].value.type==='Literal'?{value:entries[0].value.value}:null;
 };
 const closedValue=n=>{
  if(n?.type==='Literal')return n.value;
  if(n?.type==='Identifier'){
   if(n.name==='undefined'&&free(n))return undefined;
   const binding=bindings.get(n);
   if(binding&&!binding.writes.length&&binding.init?.type==='Literal')return binding.init.value;
   return unknown;
  }
  if(n?.type==='MemberExpression'){const value=closedProperty(n);if(value)return value.value;}
  return unknown;
 };
 const constantBoolean=n=>{
  if(!n)return null;
  if(n.type==='Literal')return typeof n.value==='boolean'?n.value:null;
  if(n.type==='UnaryExpression'&&n.operator==='!'){const value=constantBoolean(n.argument);return value===null?null:!value;}
  if(n.type==='BinaryExpression'&&['===','==','!==','!='].includes(n.operator)){
   const left=closedValue(n.left),right=closedValue(n.right);
   if(left===unknown||right===unknown)return null;
   const equal=left===right;
   return ['===','=='].includes(n.operator)?equal:!equal;
  }
  return null;
 };
 const deadReference=ref=>{
  for(let child=ref,parent=parents.get(child);parent;child=parent,parent=parents.get(parent)){
   if(parent.type==='IfStatement'){
    if(child===parent.consequent&&constantBoolean(parent.test)===false)return true;
    if(child===parent.alternate&&constantBoolean(parent.test)===true)return true;
   }
   if(parent.type==='ConditionalExpression'){
    if(child===parent.consequent&&constantBoolean(parent.test)===false)return true;
    if(child===parent.alternate&&constantBoolean(parent.test)===true)return true;
   }
  }
  return false;
 };
 // 只对“单条 return 比较两个形参”的闭合谓词求值；函数来源必须唯一且
 // 不可重绑，实参必须全部是闭合字面量。
 const closedPredicate=n=>{
  if(n?.type!=='CallExpression'||n.optional||n.arguments.some(argument=>argument.type==='SpreadElement'))return null;
  let fn=null;
  if(n.callee.type==='Identifier'){
   const binding=bindings.get(n.callee);
   if(binding&&!binding.writes.length&&functions.has((binding.fn??binding.init)?.type))fn=binding.fn??binding.init;
  }else if(n.callee.type==='MemberExpression'){
   const object=closedObject(n.callee.object),name=property(n.callee);
   if(object&&name!==undefined){
    const entries=object.properties.filter(entry=>entry.type==='Property'&&entry.kind==='init'&&key(entry)===name);
    if(entries.length===1&&functions.has(entries[0].value.type))fn=entries[0].value;
   }
  }
  if(!fn||fn.async||fn.generator||fn.params.length!==2||fn.params.some(parameter=>parameter.type!=='Identifier'))return null;
  const statements=fn.body.type==='BlockStatement'?fn.body.body:[fn.body];
  if(statements.length!==1||statements[0].type!=='ReturnStatement'||!statements[0].argument)return null;
  const value=(node,substitutions)=>{
   if(node.type==='Literal')return node.value;
   if(node.type==='Identifier'){
    const binding=bindings.get(node),position=fn.params.findIndex(parameter=>bindings.get(parameter)===binding);
    if(position>=0)return substitutions[position];
    if(node.name==='undefined'&&free(node))return undefined;
   }
   return unknown;
  };
  const args=n.arguments.map(closedValue);
  if(args.some(value=>value===unknown))return null;
  const returned=statements[0].argument;
  if(returned.type==='Literal'&&typeof returned.value==='boolean')return returned.value;
  if(returned.type==='BinaryExpression'&&['===','!==','==','!='].includes(returned.operator)){
   const left=value(returned.left,args),right=value(returned.right,args);
   if(left===unknown||right===unknown)return null;
   return returned.operator==='==='?left===right:returned.operator==='!=='?left!==right:returned.operator==='=='?left==right:left!=right;
  }
  return null;
 };
 const truth=n=>{
  if(n?.type==='Literal')return typeof n.value==='boolean'?n.value:null;
  if(n?.type==='UnaryExpression'&&n.operator==='!'){const value=truth(n.argument);return value===null?null:!value;}
  if(objectBuiltin(n))return true;
  if(n?.type==='CallExpression')return closedPredicate(n);
  return null;
 };
 const effect=n=>{
  if(n?.type==='AssignmentExpression'&&n.operator==='='&&n.left.type==='MemberExpression'&&same(n.left.object))return true;
  if(n?.type==='CallExpression'&&objectBuiltin(n.callee)&&!n.arguments.some(argument=>argument.type==='SpreadElement'))return property(n.callee)!=='create'||!n.arguments.some(argument=>!local(argument));
  if(n?.type==='SequenceExpression')return n.expressions.every(effect);
  if(n?.type==='ConditionalExpression'){const value=truth(n.test);if(value===true)return effect(n.consequent);if(value===false)return effect(n.alternate);return effect(n.consequent)&&effect(n.alternate);}
  return false;
 };
 const returnsParameter=n=>{
  if(same(n))return true;
  if(n?.type==='SequenceExpression')return n.expressions.slice(0,-1).every(effect)&&returnsParameter(n.expressions.at(-1));
  if(n?.type==='ConditionalExpression'){const value=truth(n.test);if(value===true)return returnsParameter(n.consequent);if(value===false)return returnsParameter(n.alternate);return returnsParameter(n.consequent)&&returnsParameter(n.alternate);}
  return false;
 };
 // 单层 if 只有在条件可静态求值时才允许选择分支；无法求值时必须要求
 // 两个分支都原样返回参数，避免把未知条件当成固定分支。
 const statementReturns=n=>{
  if(n?.type==='ReturnStatement')return !!n.argument&&returnsParameter(n.argument);
  if(n?.type==='BlockStatement')return n.body.length===1&&statementReturns(n.body[0]);
  if(n?.type==='IfStatement'){
   const value=truth(n.test);
   if(value===true)return statementReturns(n.consequent);
   if(value===false)return statementReturns(n.alternate);
   return statementReturns(n.consequent)&&statementReturns(n.alternate);
  }
  return false;
 };
 const statements=wrapper.body.type==='BlockStatement'?wrapper.body.body:[wrapper.body];
 return statements.length===1&&statementReturns(statements[0]);
}

const CLOSED_UNKNOWN=Symbol('closed-unknown');
// 闭表常量只用于状态控制参数的身份证明。表本身必须由单一对象字面量初始化，
// 没有改绑、成员写入、删除、整体别名或未知逃逸；属性键必须静态且唯一。
// 被读取的属性值只接受无插值字符串，其它表项可以保留为函数等运行期值。
function closedStaticStringMember(node,ix){
 if(node?.type!=='MemberExpression')return CLOSED_UNKNOWN;
 const name=property(node);
 if(typeof name!=='string'&&typeof name!=='number')return CLOSED_UNKNOWN;
 let object=node.object;
 if(object.type==='Identifier'){
  const binding=ix.bindings.get(object);
  if(!binding||binding.writes.length||binding.init?.type!=='ObjectExpression')return CLOSED_UNKNOWN;
  for(const ref of binding.refs){
   const member=ix.parents.get(ref);
   if(member?.type!=='MemberExpression'||member.object!==ref)return CLOSED_UNKNOWN;
   let chain=member;
   for(;;){
    const use=ix.parents.get(chain);
    if(use?.type==='MemberExpression'&&use.object===chain){chain=use;continue;}
    if(use?.type==='AssignmentExpression'&&use.left===chain||use?.type==='UpdateExpression'||
       use?.type==='UnaryExpression'&&use.operator==='delete')return CLOSED_UNKNOWN;
    break;
   }
  }
  object=binding.init;
 }else if(object.type!=='ObjectExpression')return CLOSED_UNKNOWN;
 const names=new Set();
 let value=CLOSED_UNKNOWN;
 for(const entry of object.properties){
  if(entry.type!=='Property'||entry.kind!=='init'||entry.method)return CLOSED_UNKNOWN;
  const entryName=key(entry);
  if(entryName===undefined||entryName==='__proto__')return CLOSED_UNKNOWN;
  const canonical=String(entryName);
  if(names.has(canonical))return CLOSED_UNKNOWN;
  names.add(canonical);
  if(canonical===String(name))value=entry.value;
 }
 if(value===CLOSED_UNKNOWN)return CLOSED_UNKNOWN;
 if(value.type==='Literal'&&typeof value.value==='string')return value.value;
 if(value.type==='TemplateLiteral'&&value.expressions.length===0)return value.quasis[0].value.cooked??CLOSED_UNKNOWN;
 return CLOSED_UNKNOWN;
}
const REGENERATOR_LOOPS=new Set(['ForStatement','ForInStatement','ForOfStatement','WhileStatement','DoWhileStatement']);
function regeneratorAbruptReturn(node,param,ix){
 return node?.type==='CallExpression'&&node.callee.type==='MemberExpression'&&property(node.callee)==='abrupt'&&
  (node.arguments[0]?.type==='Literal'?node.arguments[0].value:closedStaticStringMember(node.arguments[0],ix))==='return'&&
  (param?.type!=='Identifier'||ix.bindings.get(node.callee.object)===ix.bindings.get(param));
}
function regeneratorCompletionTerminator(node,fn,param,ix){
 let current=node;
 while(current&&current!==fn){
  const parent=ix.parents.get(current);
  if(!parent)return null;
  if(parent.type==='CallExpression'&&parent.arguments.includes(current)&&regeneratorAbruptReturn(parent,param,ix))return parent;
  if(parent.type==='ReturnStatement'&&parent.argument===current)
   return regeneratorTerminalReturn(parent.argument,param,ix)?parent:null;
  if(parent.type==='SequenceExpression'){
   const index=parent.expressions.indexOf(current);if(index<0)return null;
   if(index===parent.expressions.length-1){current=parent;continue;}
   // 完成调用之后的序列元素必须只是状态控制；其中 abrupt return 本身
   // 就是终止点，其余情况继续沿外壳寻找 return/abrupt。
   const later=parent.expressions.slice(index+1);
   if(!later.every(expression=>regeneratorStateControlExpression(expression,param,ix)))return null;
   const abrupt=later.find(expression=>regeneratorAbruptReturn(expression,param,ix));
   if(abrupt)return abrupt;
   current=parent;continue;
  }
  if(parent.type==='ConditionalExpression'&&(parent.consequent===current||parent.alternate===current)){current=parent;continue;}
  if(parent.type==='LogicalExpression'&&(parent.left===current||parent.right===current)){current=parent;continue;}
  if(parent.type==='ParenthesizedExpression'){current=parent;continue;}
  return null;
 }
 return null;
}
function regeneratorStateControlExpression(node,param,ix){
 if(node?.type==='AssignmentExpression'&&node.operator==='='&&node.left.type==='MemberExpression'&&
    ix.bindings.get(node.left.object)===ix.bindings.get(param)&&['prev','next','sent'].includes(property(node.left)))return true;
 if(node?.type==='CallExpression'&&node.callee.type==='MemberExpression'&&
    ix.bindings.get(node.callee.object)===ix.bindings.get(param)&&['abrupt','finish','stop'].includes(property(node.callee)))return true;
 return false;
}
// return 外壳本身只是挂起点；只有返回表达式的最后一个求值项是
// abrupt/finish/stop 时，状态机才真正终止，后续驱动不可能再进入另一个完成。
function regeneratorTerminalReturn(node,param,ix){
 const value=node?.type==='SequenceExpression'?node.expressions.at(-1):node;
 return value?.type==='CallExpression'&&value.callee.type==='MemberExpression'&&
  ['abrupt','finish','stop'].includes(property(value.callee))&&
  (param?.type!=='Identifier'||ix.bindings.get(value.callee.object)===ix.bindings.get(param));
}
function regeneratorTailSafe(completion,clause,param,ix){
 let current=completion,statement=null;
 while(current&&current!==clause){
  const parent=ix.parents.get(current);
  if(!parent)return false;
  if(parent.type==='SwitchCase'){statement=current;break;}
  if(parent.type==='SequenceExpression'){
   for(const expression of parent.expressions)if(expression.start>current.end&&!regeneratorStateControlExpression(expression,param,ix))return false;
  }else if(parent.type==='ReturnStatement'&&parent.argument===current){
   // 只有返回表达式最终以状态终止控制结束时，return 才是安全外壳。
   if(!regeneratorTerminalReturn(parent.argument,param,ix))return false;
  }else if(parent.type==='ConditionalExpression'||parent.type==='LogicalExpression'||parent.type==='ParenthesizedExpression'||parent.type==='ExpressionStatement'||parent.type==='BlockStatement'){
   // 条件/逻辑分支与语句外壳在完成调用之后不再执行其它分支。
  }else if(parent.type==='IfStatement'){
   if(parent.test===current)return false;
  }else return false;
  current=parent;
 }
 if(!statement)return false;
 const caseNode=ix.parents.get(statement),index=caseNode?.type==='SwitchCase'?caseNode.consequent.indexOf(statement):-1;
 if(index<0)return false;
 for(const later of caseNode.consequent.slice(index+1)){
  if(later.type==='BreakStatement'||later.type==='EmptyStatement')continue;
  if(later.type==='ExpressionStatement'&&regeneratorStateControlExpression(later.expression,param,ix))continue;
  if(later.type==='ReturnStatement'&&regeneratorStateControlExpression(later.argument,param,ix))continue;
  return false;
 }
 return true;
}
function regeneratorInsideLoop(node,fn,machine,ix){
 for(let parent=ix.parents.get(node);parent&&parent!==fn;parent=ix.parents.get(parent)){
  if(!REGENERATOR_LOOPS.has(parent.type))continue;
  // 状态机的驱动 for(;;) 包住分派 switch，不属于正文循环。
  if(parent.start<=machine.dispatchStart&&parent.end>=machine.dispatchEnd)continue;
  return true;
 }
 return false;
}
function regeneratorReachesCompletion(state,completionStates,machine){
 const from='state:'+String(state),seen=new Set([from]),queue=[from];
 while(queue.length){
  const current=queue.shift();
  for(const edge of machine.edges){
   if(edge.from!==current)continue;
   // 完成调用后只允许状态控制；该状态自己的异常出口不可能在完成后触发。
   if(current===from&&(edge.kind==='exception'||edge.kind==='exception-finally'))continue;
   if(edge.to!==from&&completionStates.has(edge.to))return true;
   if(seen.has(edge.to))continue;
   seen.add(edge.to);queue.push(edge.to);
  }
 }
 return false;
}
// 同一状态内的多个完成点只有落在同一条件表达式的互斥分支里，才可能沿
// 任意单条路径至多执行一个。测试表达式与分支之间不构成互斥，顺序表达式
// 或同一分支内的多个调用也不能放行。
function regeneratorConditionallyExclusive(a,b,ix){
 const side=(node,part)=>part&&part.start<=node.start&&part.end>=node.end;
 for(let ancestor=ix.parents.get(a);ancestor;ancestor=ix.parents.get(ancestor)){
  if(ancestor.type!=='ConditionalExpression')continue;
  const left=side(a,ancestor.consequent)?'consequent':side(a,ancestor.alternate)?'alternate':null;
  const right=side(b,ancestor.consequent)?'consequent':side(b,ancestor.alternate)?'alternate':null;
  if(left&&right&&left!==right)return true;
 }
 return false;
}
// 完成回调的 `.wrap` 消费方证明：状态图运行时完整、入口子图无环；唯一阻塞
// 只能是死状态/死终止点。每个可达完成调用必须位于状态分派 case 内且不在
// 循环中。多个完成点时，每个必须由独立的 return/abrupt return 终止，或
// 完成之后只剩状态控制且沿显式边无法到达另一个完成状态；这保证同一路径
// 至多执行一个完成调用。
export function closedRegeneratorConsumer(ix,source,call,fn,isCompletion){
 const reject=()=>null;
 if(call?.type!=='CallExpression'||call.callee.type!=='MemberExpression'||property(call.callee)!=='wrap'||call.arguments[0]!==fn)return reject('shape');
 let proof;
 try{proof=regeneratorStateMachine(ix,source);}catch{return reject('proof');}
 const machine=proof.machines.find(item=>item.wrapStart===call.start&&item.acyclic&&(item.proved||item.deadReachabilityProved));
 if(!machine)return reject('machine '+proof.machines.map(item=>item.wrapStart+':'+item.proved+':'+item.deadReachabilityProved+':'+item.acyclic));
 const completions=ix.nodes.filter(node=>node.start>=fn.start&&node.end<=fn.end&&isCompletion(node));
 if(!completions.length)return reject('no-completions');
 const param=fn.params[0],reachable=[];
 // 机器只因异常处理副作用而无法极简降级时，完成消费方不能越过原有的
 // 极简拒收边界；异步/上下文机器保留其它缺口，仍走通用完成路径。
 if(machine.handlerEffects?.length&&!machine.nonHandlerMinimalGaps?.length)return reject('minimal-handler-only');
 for(const completion of completions){
  if(ix.owners.get(completion)!==fn)return reject('owner');
  const clause=machine.cases.filter(item=>completion.start>=item.start&&completion.end<=item.end)
   .sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];
  if(!clause||clause.state===null)return reject('case '+completion.start);
  if(machine.deadStates.some(state=>state===clause.state))continue;
  reachable.push({node:completion,clause,state:clause.state});
 }
 if(!reachable.length)return reject('dead-completions');
 for(const item of reachable)if(regeneratorInsideLoop(item.node,fn,machine,ix))return reject('loop');
 if(reachable.length===1)return machine;
 const byState=new Map();
 for(const item of reachable){const state=String(item.state);if(!byState.has(state))byState.set(state,[]);byState.get(state).push(item);}
 for(const group of byState.values())for(let i=0;i<group.length;i++)for(let j=i+1;j<group.length;j++)
  if(!regeneratorConditionallyExclusive(group[i].node,group[j].node,ix))return reject('multiple-in-case');
 const completionStates=new Set(reachable.map(item=>'state:'+String(item.state)));
 const nonterminal=[];
 const terminators=new Set();
 for(const item of reachable){
  const terminator=regeneratorCompletionTerminator(item.node,fn,param,ix);
  if(!terminator){nonterminal.push(item);continue;}
  if(terminators.has(terminator))return reject('dup-terminator '+item.node.start);
  terminators.add(terminator);
 }
 for(const item of nonterminal){
  if(!regeneratorTailSafe(item.node,item.clause,param,ix))return reject('nonterminal-tail '+item.node.start);
  if(regeneratorReachesCompletion(item.state,completionStates,machine))return reject('reaches-completion '+item.node.start);
 }
 return machine;
}

// Structured early-return propagation for statically resolved bundled clients.
// Native payloads are stored only while unwinding ordinary JS helper calls;
// there is no legacy API object, thrown sentinel or async polling runtime.

export function structuredFlow({source,tree,ix,context,fresh,api,payload,isDone,compressionMethod,replyPrelude,extraAfter,substitutions,callTarget,isHTTP,httpStatement,isPromiseCall}){
 const {nodes,parents,bindings,owners,free}=ix,completion=fresh('completion'),overrides=new WeakMap();
 const done=new Set(),asyncAdded=new Set();
 const fail=(n,message)=>{throw Error(`结构化原生转换第 ${source.slice(0,n.start).split('\n').length} 行：${message}`);};
 function resolve(n,seen=new Set()){
  if(n?.type==='Identifier'){const b=bindings.get(n);if(b&&!b.writes.length&&!seen.has(b)&&(b.fn||b.init)){seen.add(b);return resolve(b.fn??b.init,seen);}}
  return n;
 }
 // 赋值只有在文本上也必然位于读取之前时才可参与目标解析。写入若位于
 // if/循环/try/条件表达式等容器内，可能被跳过；位置更靠前不等于支配读取。
 function unconditionalWrite(write,common){
  if(!common)return false;
  for(let node=write;node!==common;){
   const parent=parents.get(node);
   if(!parent)return false;
   if(parent===common)return true;
   if(parent.type!=='SequenceExpression'&&parent.type!=='ExpressionStatement')return false;
   node=parent;
  }
  return false;
 }
 // 闭合对象表只允许读取成员或枚举自身键。属性写入、删除、别名复制或把
 // 整表传给未知调用都会让成员值身份不再确定；动态枚举只有在所有成员目标
 // 一致时才能继续按同一完成函数处理。
 function closedTableObject(member,allowDynamic){
  if(member?.type!=='MemberExpression')return null;
  if(member.object.type==='ObjectExpression')return member.object;
  if(member.object.type!=='Identifier')return null;
  const binding=bindings.get(member.object);
  if(!binding||binding.writes.length||binding.init?.type!=='ObjectExpression')return null;
  const writes=nodes.some(node=>{
   const target=node.type==='AssignmentExpression'&&node.operator==='='?node.left:node.type==='UpdateExpression'?node.argument:node.type==='UnaryExpression'&&node.operator==='delete'?node.argument:null;
   if(target?.type!=='MemberExpression')return false;
   let root=target;while(root.type==='MemberExpression')root=root.object;
   return root.type==='Identifier'&&bindings.get(root)===binding;
  });
  if(writes||!binding.refs.every(ref=>{const use=parents.get(ref);if(allowDynamic&&use?.type==='ForInStatement'&&use.right===ref)return true;if(use?.type!=='MemberExpression'||use.object!==ref||!allowDynamic&&property(use)===undefined)return false;let chain=use;while(parents.get(chain)?.type==='MemberExpression'&&parents.get(chain).object===chain)chain=parents.get(chain);const outerUse=parents.get(chain);return !(outerUse?.type==='AssignmentExpression'&&outerUse.left===chain||outerUse?.type==='UpdateExpression'||outerUse?.type==='UnaryExpression'&&outerUse.operator==='delete');}))return null;
  return binding.init;
 }
 function closedTableValue(member){
  const name=property(member);if(name===undefined)return null;
  const object=closedTableObject(member,false);if(!object)return null;
  return object.properties.find(entry=>entry.type==='Property'&&entry.kind==='init'&&key(entry)===name)?.value??null;
 }
 function closedTableValues(member){
  if(property(member)!==undefined)return null;
  const object=closedTableObject(member,true);
  if(!object||!object.properties.length)return null;
  // 展开、访问器、计算键和重复键都会让枚举到的成员集合不确定；动态派发
  // 只接受完整静态表。
  const names=new Set();
  for(const entry of object.properties){
   if(entry.type!=='Property'||entry.kind!=='init')return null;
   const name=key(entry);if(name===undefined||names.has(name))return null;
   names.add(name);
  }
  return object.properties.map(entry=>entry.value);
 }
 function targets(n,seen=new Set()){
  n=resolve(n,seen);if(functions.has(n?.type))return [n];
  if(n?.type==='AssignmentExpression'&&n.operator==='=')return targets(n.right,seen);
  if(n?.type==='SequenceExpression')return targets(n.expressions.at(-1),seen);
  if(n?.type==='Identifier'){
   const binding=bindings.get(n),writes=(binding?.writes??[]).filter(write=>write.type==='AssignmentExpression'&&write.operator==='='&&write.left.type==='Identifier'&&write.right!==n&&write.end<=n.start);
   if(writes.length&&!seen.has(binding)){
    const write=writes.reduce((a,b)=>a.start>b.start?a:b),ancestors=new Set();
    for(let current=write;current;current=parents.get(current))ancestors.add(current);
    let common=null;
    for(let current=n;current;current=parents.get(current))if(ancestors.has(current)){common=current;break;}
    let writeChild=write,referenceChild=n;
    if(common){while(parents.get(writeChild)!==common)writeChild=parents.get(writeChild);while(parents.get(referenceChild)!==common)referenceChild=parents.get(referenceChild);}
    // 必须能证明最后一次赋值在读取之前完成：同一序列、语句块或实参列表中
    // 位于左侧且没有更晚的写入。
    let ordered=false;
    if(common?.type==='SequenceExpression'){const a=common.expressions.indexOf(writeChild),b=common.expressions.indexOf(referenceChild);ordered=a>=0&&b>=0&&a<b;}
    else if(common?.type==='BlockStatement'||common?.type==='Program'){const a=common.body.indexOf(writeChild),b=common.body.indexOf(referenceChild);ordered=a>=0&&b>=0&&a<b;}
    else if(common?.type==='CallExpression'){const a=common.arguments.indexOf(writeChild),b=common.arguments.indexOf(referenceChild);ordered=a>=0&&b>=0&&a<b;}
    if(ordered&&unconditionalWrite(write,common)){const next=new Set(seen);next.add(binding);const result=targets(write.right,next);return result;}
   }
  }
  if(n?.type==='CallExpression'&&n.callee.type==='MemberExpression'&&n.arguments.length===1&&closedIdentityMethodCall(ix,n,n.arguments[0]))return targets(n.arguments[0],seen);
  if(n?.type==='MemberExpression'){
   const value=closedTableValue(n);if(value)return targets(value,new Set(seen));
   const values=closedTableValues(n);
   if(values){
    const resolved=values.map(value=>targets(value,new Set(seen)));
    // 动态键可能命中任一成员；只有每个成员都有确定目标时才能合并候选。
    // 后续完成传播对候选集合使用“任一目标会完成”的保守守卫，不会把
    // 非完成成员误当成必然完成。
    if(resolved.some(list=>!list.length))return [];
    return [...new Set(resolved.flat())];
   }
  }
  const fn=callTarget?.(n);return fn?[fn]:[];
 }
 // 读取标识符在当前位置之前最后一次确定完成的直接赋值。只有同一序列、同一
 // 语句块或同一实参列表中的写入才算支配当前读取；跨分支、循环和未知调用后
 // 的写入保持未知。该证明用于 regenerator runner 的自赋值形态，不放宽普通
 // 逃逸绑定。
 function proofState(seen){
  return seen??{promise:new Set(),callable:new Set(),bindings:new Set()};
 }
 function markProof(seen,mode,n){
  const state=proofState(seen);if(state[mode].has(n))return null;
  const next={promise:state.promise,callable:state.callable,bindings:state.bindings};
  next[mode]=new Set(state[mode]);next[mode].add(n);return next;
 }
 function nonCallableValue(n,seen=new Set()){
  if(!n||seen.has(n))return false;seen=new Set(seen);seen.add(n);
  if(['Literal','ArrayExpression','ObjectExpression','TemplateLiteral','BinaryExpression'].includes(n.type))return true;
  if(n.type==='UnaryExpression')return true;
  if(n.type==='LogicalExpression')return nonCallableValue(n.left,seen)&&nonCallableValue(n.right,seen);
  if(n.type==='ConditionalExpression')return nonCallableValue(n.consequent,seen)&&nonCallableValue(n.alternate,seen);
  if(n.type==='SequenceExpression')return nonCallableValue(n.expressions.at(-1),seen);
  if(n.type==='AssignmentExpression'&&n.operator==='=')return nonCallableValue(n.right,seen);
  if(n.type==='Identifier'){
   const binding=bindings.get(n);
   return !!binding&&!binding.writes.length&&!!binding.init&&nonCallableValue(binding.init,seen);
  }
  return false;
 }
 function priorValue(n,seen){
  if(n?.type!=='Identifier')return null;
  const state=proofState(seen),binding=bindings.get(n);
  if(!binding||state.bindings.has(binding))return null;
  const next={promise:state.promise,callable:state.callable,bindings:new Set(state.bindings)};next.bindings.add(binding);
  const writes=binding.writes.filter(write=>write.type==='AssignmentExpression'&&write.operator==='='&&write.left.type==='Identifier'&&bindings.get(write.left)===binding&&write.right!==n&&write.end<=n.start);
  if(!writes.length){
   if(!binding.writes.length&&(binding.fn||binding.init))return {node:binding.fn??binding.init,seen:next};
   return null;
  }
  const write=writes.reduce((a,b)=>a.start>b.start?a:b),ancestors=new Set();
  // 嵌套函数中的写入不会因为文本位置靠前就自动支配当前读取；只有同一
  // 执行函数体内的直写才能按语句顺序解析。
  if(owners.get(write)!==owners.get(n))return null;
  for(let current=write;current;current=parents.get(current))ancestors.add(current);
  let common=null;
  for(let current=n;current;current=parents.get(current))if(ancestors.has(current)){common=current;break;}
  if(!common)return null;
  let writeChild=write,readChild=n;
  while(parents.get(writeChild)!==common)writeChild=parents.get(writeChild);
  while(parents.get(readChild)!==common)readChild=parents.get(readChild);
  let ordered=false;
  if(common.type==='SequenceExpression'){const a=common.expressions.indexOf(writeChild),b=common.expressions.indexOf(readChild);ordered=a>=0&&b>=0&&a<b;}
  else if(common.type==='BlockStatement'||common.type==='Program'){const a=common.body.indexOf(writeChild),b=common.body.indexOf(readChild);ordered=a>=0&&b>=0&&a<b;}
  else if(common.type==='CallExpression'){const a=common.arguments.indexOf(writeChild),b=common.arguments.indexOf(readChild);ordered=a>=0&&b>=0&&a<b;}
  return ordered&&unconditionalWrite(write,common)?{node:write.right,seen:next}:null;
 }
 // 参数实参环境必须保留调用方的环境，才能在不展开调用的前提下继续证明
 // 二层 runner。复杂参数、展开实参和缺少实际值都保持未知。
 function callEnvironment(fn,call,outer){
  const environment=new Map(outer??[]);
  if(!call||!['CallExpression','NewExpression'].includes(call.type)||call.arguments.some(argument=>argument.type==='SpreadElement'))return environment;
  fn.params.forEach((parameter,index)=>{
   if(parameter.type!=='Identifier')return;
   const argument=call.arguments[index];
   if(!argument)return;
   const binding=bindings.get(parameter);
   if(binding)environment.set(binding,{node:argument,environment:outer??new Map()});
  });
  return environment;
 }
 function environmentValue(name,environment){
  if(name?.type!=='Identifier')return null;
  const binding=bindings.get(name);
  return binding&&environment?.has(binding)?environment.get(binding):null;
 }
 function callTargets(callee,environment,seen){
  const actual=environmentValue(callee,environment);
  if(actual)return callTargets(actual.node,actual.environment,seen);
  if(callee?.type==='MemberExpression'){
   const value=closedTableValue(callee);
   if(value)return targets(value,new Set());
   // 对象表闭合证明失败时不能回退到按名称猜目标；别名到对象字面量也保持
   // 未知，避免属性写入发生在别名一侧而绕过检查。
   if(callee.object.type==='Identifier'){
    const binding=bindings.get(callee.object);
    if(binding?.init?.type==='ObjectExpression'||binding?.init?.type==='Identifier'&&bindings.get(binding.init)?.init?.type==='ObjectExpression')return [];
   }
   const fn=callTarget?.(callee);return fn?[fn]:[];
  }
  const answer=targets(callee);return answer;
 }
 // 函数体的末尾可能被语句块或双分支条件包裹；只有所有分支都必然以 return
 // 结束时，才能把该函数视为返回值契约固定，避免漏掉其中的退出路径。
 function endsWithReturn(node){
  if(node?.type==='ReturnStatement')return true;
  if(node?.type==='BlockStatement')return node.body.length>0&&endsWithReturn(node.body.at(-1));
  if(node?.type==='IfStatement'&&node.alternate)return endsWithReturn(node.consequent)&&endsWithReturn(node.alternate);
  return false;
 }
 function promiseReturns(fn,call,outer,seen){
  if(fn.async)return true;
  if(fn.generator)return false;
  const environment=callEnvironment(fn,call,outer);
  if(fn.body.type!=='BlockStatement')return promiseValue(fn.body,seen,environment);
  if(!endsWithReturn(fn.body))return false;
  const returns=nodes.filter(statement=>statement.type==='ReturnStatement'&&owners.get(statement)===fn);
  return returns.length>0&&returns.every(statement=>promiseValue(statement.argument,seen,environment));
 }
 function callableReturns(fn,call,outer,seen){
  if(fn.async||fn.generator)return false;
  const environment=callEnvironment(fn,call,outer);
  if(fn.body.type!=='BlockStatement')return callableValue(fn.body,seen,environment);
  if(!endsWithReturn(fn.body))return false;
  const returns=nodes.filter(statement=>statement.type==='ReturnStatement'&&owners.get(statement)===fn);
  return returns.length>0&&returns.every(statement=>callableValue(statement.argument,seen,environment));
 }
 function callableValue(n,seen,environment=new Map()){
  if(!n)return false;const state=markProof(seen,'callable',n);if(!state)return false;
  if(functions.has(n.type))return promiseReturns(n,null,environment,state);
  if(n.type==='Identifier'){
   const actual=environmentValue(n,environment);
   if(actual)return callableValue(actual.node,state,actual.environment);
   const resolved=resolve(n);if(resolved!==n)return callableValue(resolved,state,environment);
   const previous=priorValue(n,state);if(previous)return callableValue(previous.node,previous.seen,environment);
   // 自赋值 runner（`m = k(...mark(...)), m.apply(...)`）在首次读取前仍是
   // 提升的函数声明；只接受所有写入都位于该函数自身的形状，避免把外部
   // 条件重绑定误当成初始函数。
   const binding=bindings.get(n);
   const writes=!!binding?.writes.length&&binding.writes.every(write=>write.type==='AssignmentExpression'&&write.operator==='='&&write.left.type==='Identifier'&&bindings.get(write.left)===binding&&nonCallableValue(write.right));
   const selfRewrites=!!binding?.fn&&binding.writes.every(write=>write.start>=binding.fn.start&&write.end<=binding.fn.end);
   return !!binding?.fn&&(writes||selfRewrites)&&callableValue(binding.fn,state,environment);
  }
  if(n.type==='AssignmentExpression'&&n.operator==='=')return callableValue(n.right,state,environment);
  if(n.type==='SequenceExpression')return callableValue(n.expressions.at(-1),state,environment);
  if(n.type==='ConditionalExpression')return callableValue(n.consequent,state,environment)&&callableValue(n.alternate,state,environment);
  if(n.type!=='CallExpression')return false;
  const fns=callTargets(n.callee,environment,state);
  return fns.length>0&&fns.every(fn=>callableReturns(fn,n,environment,state));
 }
 function promiseValue(n,seen,environment=new Map()){
  if(!n)return false;const state=markProof(seen,'promise',n);if(!state)return false;
  if(isPromiseCall?.(n))return true;
  const resolved=resolve(n);if(resolved!==n)return promiseValue(resolved,state,environment);
  if(n.type==='Identifier'){
   const actual=environmentValue(n,environment);
   if(actual)return promiseValue(actual.node,state,actual.environment);
   const previous=priorValue(n,state);return !!previous&&promiseValue(previous.node,previous.seen,environment);
  }
  if(n.type==='AssignmentExpression'&&n.operator==='=')return promiseValue(n.right,state,environment);
  if(n.type==='SequenceExpression')return promiseValue(n.expressions.at(-1),state,environment);
  if(n.type==='ConditionalExpression')return promiseValue(n.consequent,state,environment)&&promiseValue(n.alternate,state,environment);
  if(n.type==='NewExpression'&&free(n.callee,'Promise'))return true;
  if(n.type!=='CallExpression')return false;
  if(n.callee.type==='MemberExpression'&&free(n.callee.object,'$task')&&property(n.callee)==='fetch')return true;
  if(n.callee.type==='MemberExpression'){
   if(free(n.callee.object,'Promise')&&['resolve','reject','all','allSettled','race','any','withResolvers'].includes(property(n.callee)))return true;
   if(['then','catch','finally'].includes(property(n.callee)))return promiseValue(n.callee.object,state,environment);
   // `runner.apply(this, arguments)` 不展开实参；只有目标可调用值在不依赖
   // 形参的情况下仍能证明返回 Promise 时才成立。返回函数若使用未知形参，
   // callableValue 会保持拒绝。
   if(['apply','call'].includes(property(n.callee))&&callableValue(n.callee.object,state,environment))return true;
  }
  const fns=callTargets(n.callee,environment,state);
  if(fns.length)return fns.every(fn=>promiseReturns(fn,n,environment,state));
  // `factory(argument)()`：工厂调用先返回一个闭合函数，再由外层调用消费。
  return callableValue(n.callee,state,environment);
 }
 const executors=new Set(nodes.filter(n=>n.type==='NewExpression'&&free(n.callee,'Promise')&&n.arguments.length===1)
  .flatMap(n=>targets(n.arguments[0])).filter(fn=>!fn.async&&!fn.generator&&fn.params.every(p=>p.type==='Identifier')));
 const timerCallback=n=>n?.type==='CallExpression'&&free(n.callee,'setTimeout')&&[1,2].includes(n.arguments.length)&&targets(n.arguments[0]).length===1?targets(n.arguments[0])[0]:null;
 const executorHelpers=new Set(executors);
 let helpersChanged=true;while(helpersChanged){helpersChanged=false;for(const n of nodes)if(n.type==='CallExpression'&&executorHelpers.has(owners.get(n)))for(const fn of targets(n.callee))if(!fn.async&&!executorHelpers.has(fn)){executorHelpers.add(fn);helpersChanged=true;}}
 for(const n of nodes){if(isDone(n))done.add(owners.get(n));if(n.type==='CallExpression'&&compressionMethod(n.callee)&&!owners.get(n).async)asyncAdded.add(owners.get(n));}
 let changed=true;while(changed){changed=false;for(const n of nodes){
  if(n.type==='NewExpression'&&free(n.callee,'Promise')&&targets(n.arguments[0]).some(fn=>executors.has(fn)&&done.has(fn))&&!done.has(owners.get(n))){done.add(owners.get(n));changed=true;}
  if(n.type!=='CallExpression')continue;
  const candidates=targets(n.callee);
  if(n.callee.type==='MemberExpression'&&['then','catch','finally'].includes(property(n.callee))&&n.arguments.some(a=>targets(a).some(fn=>done.has(fn)))&&!done.has(owners.get(n))){done.add(owners.get(n));changed=true;}
  if(candidates.some(fn=>done.has(fn))&&!done.has(owners.get(n))){done.add(owners.get(n));changed=true;}
  if(isHTTP?.(n)&&targets(n.arguments[1]).some(fn=>done.has(fn))&&!done.has(owners.get(n))){done.add(owners.get(n));changed=true;}
  if(n.callee.type==='MemberExpression'&&property(n.callee)==='wrap'&&closedRegeneratorWrap(n,n.arguments[0])&&!done.has(owners.get(n))){done.add(owners.get(n));changed=true;}
  if(done.has(timerCallback(n))&&!done.has(owners.get(n))){done.add(owners.get(n));changed=true;}
  if(candidates.some(fn=>asyncAdded.has(fn)||fn.async&&done.has(fn))&&!executorHelpers.has(owners.get(n))&&!owners.get(n).async&&!asyncAdded.has(owners.get(n))){asyncAdded.add(owners.get(n));changed=true;}
  if(isHTTP?.(n)&&targets(n.arguments[1]).some(fn=>done.has(fn))&&!executorHelpers.has(owners.get(n))&&!owners.get(n).async&&!asyncAdded.has(owners.get(n))){asyncAdded.add(owners.get(n));changed=true;}
  if(n.callee.type==='MemberExpression'&&['then','catch','finally'].includes(property(n.callee))&&done.has(owners.get(n))&&!executorHelpers.has(owners.get(n))&&!asyncAdded.has(owners.get(n))){asyncAdded.add(owners.get(n));changed=true;}
 }}
 function closedCallback(call,arg,seen=new Set()){
  if(isHTTP?.(call)&&call.arguments[1]===arg)return true;
  if(closedIdentityMethodCall(ix,call,arg))return true;
  if(timerCallback(call)&&call.arguments[0]===arg)return true;
  if(call?.type==='NewExpression'&&free(call.callee,'Promise')&&call.arguments.length===1&&call.arguments[0]===arg)return targets(arg).length===1&&executors.has(targets(arg)[0]);
  const fns=targets(call?.callee),position=call?.arguments.indexOf(arg);
  return fns.length>0&&fns.every(fn=>{
   const param=fn.params[position],b=bindings.get(param?.type==='AssignmentPattern'?param.left:param);
   if(!b||b.writes.length||!b.refs.length||seen.has(b))return false;
   const next=new Set(seen);next.add(b);
   return b.refs.every(ref=>{const p=parents.get(ref);return p?.type==='CallExpression'&&(p.callee===ref||closedCallback(p,ref,next));});
  });
 }
 // `.wrap` 的第一个实参由本文件证明过的状态机消费。
 function closedRegeneratorMachine(call,fn){
  return closedRegeneratorConsumer(ix,source,call,fn,node=>isDone(node)||targets(node.callee).some(target=>done.has(target)));
 }
 function closedRegeneratorWrap(call,fn){
  return !!closedRegeneratorMachine(call,fn);
 }
 // 状态机回调内的完成调用由已证状态图负责终止，不能再用普通 `return` 截断
 // 当前状态函数；否则 regenerator 驱动会停在半途而不再推进。完成传播仍
 // 照常把结果送回脚本顶层。
 const regeneratorMachines=new Map();
 for(const n of nodes){
  if(n.type!=='CallExpression'||n.callee.type!=='MemberExpression'||property(n.callee)!=='wrap')continue;
  const machine=closedRegeneratorMachine(n,targets(n.arguments[0])[0]);
  if(machine)regeneratorMachines.set(n,machine);
 }
 const regeneratorCallbackRanges=[...regeneratorMachines.values()].map(machine=>[machine.callbackStart,machine.callbackEnd]);
 const synchronousRegeneratorCallbacks=new Set([...regeneratorMachines.values()]
  .filter(machine=>!nodes.some(n=>n.type==='AwaitExpression'&&n.start>=machine.callbackStart&&n.end<=machine.callbackEnd))
  .map(machine=>machine.callbackStart));
 const inRegeneratorCallback=owner=>!!owner&&regeneratorCallbackRanges.some(([start,end])=>owner.start>=start&&owner.end<=end);
 const containsRegeneratorCallback=owner=>!!owner&&regeneratorCallbackRanges.some(([start,end])=>start>=owner.start&&end<=owner.end);
 const synchronousRegeneratorCallback=fn=>!!fn&&synchronousRegeneratorCallbacks.has(fn.start);
 // regenerator 的 `wrap(inner, outerFn, self, tryEntries)` 会把生成器函数自身
 // 作为 outerFn 传入；该位置只建立 this/构造语义，不调用回调。仅当调用点
 // 已被本文件的完整状态机证明覆盖，且自引用正是该机器外层函数时放行。
 const regeneratorOuterReference=ref=>{
  const p=parents.get(ref);
  if(p?.type!=='CallExpression'||p.arguments[1]!==ref||p.callee.type!=='MemberExpression'||property(p.callee)!=='wrap'||!regeneratorMachines.has(p))return false;
  return targets(ref).some(fn=>owners.get(p)===fn);
 };
 for(const n of nodes){
  if(n.type==='VariableDeclarator'&&n.id.type==='Identifier'&&(targets(n.init).some(fn=>done.has(fn)||asyncAdded.has(fn))||n.init?.type==='ObjectExpression'&&n.init.properties.some(p=>targets(p.value).some(fn=>done.has(fn)||asyncAdded.has(fn))))){
   const binding=bindings.get(n.id);
   if(binding?.writes.length)fail(n,'完成函数或分发表被重新赋值');
   if(n.init.type==='ObjectExpression'&&binding?.refs.some(r=>{const p=parents.get(r),q=parents.get(p);return !(p?.type==='ForInStatement'&&p.right===r||p?.type==='MemberExpression'&&p.object===r&&q?.type==='CallExpression'&&q.callee===p);}))fail(n,'完成函数分发表发生修改或逃逸');
  }
  if(n.type==='FunctionDeclaration'&&done.has(n)&&bindings.get(n.id)?.writes.length)fail(n,'完成函数被重新赋值');
  // wrap 状态机回调的返回值由 wrap/_invoke 消费，且状态参数可进入完成载荷；
  // “目标函数忽略返回值”不能成立，因此该族继续按未知回调拒绝。
  if(functions.has(n.type)&&(done.has(n)||asyncAdded.has(n))&&n.type!=='FunctionDeclaration'){
   const p=parents.get(n);
   if(!(p?.type==='CallExpression'&&(p.callee===n||closedCallback(p,n)||closedRegeneratorWrap(p,n)||p.callee.type==='MemberExpression'&&['mark','wrap'].includes(property(p.callee))&&containsRegeneratorCallback(n))||p?.type==='NewExpression'&&closedCallback(p,n)||p?.type==='VariableDeclarator'&&p.init===n||p?.type==='Property'&&p.value===n||p?.type==='MethodDefinition'&&p.value===n||p?.type==='SequenceExpression'&&p.expressions.at(-1)===n||p?.type==='CallExpression'&&p.callee.type==='MemberExpression'&&['then','catch','finally'].includes(property(p.callee))))fail(n,'内联完成函数传给未知回调');
  }
  if(free(n,'globalThis')){
   const p=parents.get(n);
   if(privateGlobalAssignment(ix,n))continue;
   if(p?.type==='MemberExpression'&&p.object===n&&builtin.has(property(p)))continue;
   if(p?.type==='CallExpression'&&p.arguments.includes(n)){
    const fns=targets(p.callee),param=p.arguments.indexOf(n);
    if(fns.length===1){const fn=fns[0],b=bindings.get(fn.params[param]);if(b&&b.refs.every(r=>{const q=parents.get(r);return q?.type==='MemberExpression'&&q.object===r&&builtin.has(property(q));}))continue;}
   }
   fail(n,'全局对象访问超出可确认的标准 JavaScript 内建字段');
  }
  if(n.type==='Identifier'&&ix.reference(n)&&targets(n).some(fn=>done.has(fn)||asyncAdded.has(fn))){
   const p=parents.get(n);
   if(p?.type==='UnaryExpression'&&p.operator==='typeof')continue;
   if(p?.type==='CallExpression'&&p.callee===n||p?.type==='VariableDeclarator'&&p.init===n||p?.type==='Property'&&p.value===n)continue;
   if(p?.type==='CallExpression'&&p.callee.type==='MemberExpression'&&['then','catch','finally'].includes(property(p.callee)))continue;
   if(p?.type==='CallExpression'&&closedCallback(p,n))continue;
   if(p?.type==='NewExpression'&&closedCallback(p,n))continue;
   if(regeneratorOuterReference(n))continue;
   fail(n,'完成函数传给未知回调，无法短路调用者');
  }
 }
 // Preserve a root completion chain's launch point while trailing scalar
 // declarations or authored Date methods initialize synchronously.
 const completesChain=n=>n?.type==='CallExpression'&&(targets(n.callee).some(fn=>done.has(fn))||n.callee.type==='MemberExpression'&&['then','catch','finally'].includes(property(n.callee))&&(n.arguments.some(a=>targets(a).some(fn=>done.has(fn)))||completesChain(n.callee.object)));
 const rootChains=nodes.filter(n=>n.type==='CallExpression'&&owners.get(n)===tree&&n.callee.type==='MemberExpression'&&['then','catch','finally'].includes(property(n.callee))&&completesChain(n)&&parents.get(n)?.type==='ExpressionStatement');
 const scalarInitializer=n=>!n||n.type==='Literal'&&!n.regex||n.type==='ArrayExpression'&&n.elements.length===0||n.type==='UnaryExpression'&&['!','void','+','-','~'].includes(n.operator)&&scalarInitializer(n.argument)||['BinaryExpression','LogicalExpression'].includes(n.type)&&scalarInitializer(n.left)&&scalarInitializer(n.right);
 const scalarDeclaration=n=>n.type==='VariableDeclaration'&&n.declarations.every(d=>d.id.type==='Identifier'&&scalarInitializer(d.init));
 const prototypeSetup=n=>{
  const a=n.type==='ExpressionStatement'?n.expression:null,m=a?.left,p=m?.object;
  return a?.type==='AssignmentExpression'&&a.operator==='='&&functions.has(a.right.type)&&!done.has(a.right)&&!asyncAdded.has(a.right)&&m?.type==='MemberExpression'&&!m.computed&&p?.type==='MemberExpression'&&property(p)==='prototype'&&free(p.object,'Date')&&!['constructor','__proto__','toString','valueOf'].includes(property(m));
 };
 const stableDateReference=n=>{
  const p=parents.get(n);
  if(p?.type==='NewExpression'&&p.callee===n)return true;
  if(p?.type!=='MemberExpression'||p.object!==n)return false;
  if(property(p)==='now')return parents.get(p)?.type==='CallExpression'&&parents.get(p).callee===p;
  if(property(p)!=='prototype')return false;
  const member=parents.get(p),use=parents.get(member);
  if(member?.type!=='MemberExpression'||member.object!==p||typeof property(member)!=='string')return false;
  if(use?.type==='AssignmentExpression'&&use.left===member)return prototypeSetup(parents.get(use));
  return !(use?.type==='UpdateExpression'||use?.operator==='delete');
 };
 const setupStable=!nodes.some(n=>n.type==='MemberExpression'&&['getPrototypeOf','setPrototypeOf','defineProperty','defineProperties','__proto__'].includes(property(n))||n.type==='MemberExpression'&&['constructor','__defineGetter__','__defineSetter__','__lookupGetter__','__lookupSetter__'].includes(property(n))||free(n,'Reflect')||free(n,'Date')&&!stableDateReference(n));
 let deferred=null;
 if(rootChains.length===1&&setupStable){
  const call=rootChains[0];let child=parents.get(call),valid=true,setup=false;
  for(let p=parents.get(child);p;child=p,p=parents.get(p)){
   if(['Program','BlockStatement'].includes(p.type))for(const next of p.body.slice(p.body.indexOf(child)+1)){
    if(['FunctionDeclaration','EmptyStatement'].includes(next.type))continue;
    if(prototypeSetup(next)||scalarDeclaration(next))setup=true;else valid=false;
   }else if(p.type!=='IfStatement'){valid=false;break;}
  }
  if(valid&&setup)deferred={call,statement:parents.get(call),promise:fresh('pendingCompletion')};
 }
 function guard(owner){return inRegeneratorCallback(owner)?'':`if (${completion}) ${owner===tree?'return '+completion+'.value;':'return;'}`;}
 function tail(n,asynchronous=false){
  if(deferred?.call===n)return true;
  let p=parents.get(n);
  while(p?.type==='UnaryExpression'&&['!','void'].includes(p.operator)){n=p;p=parents.get(n);}
  while(p?.type==='MemberExpression'&&['then','catch','finally'].includes(property(p))&&p.object===n){
   const call=parents.get(p);if(call?.type!=='CallExpression'||call.callee!==p)break;n=call;p=parents.get(n);
  }
  while(p?.type==='ConditionalExpression'&&p.test!==n||p?.type==='LogicalExpression'&&p.right===n||p?.type==='SequenceExpression'&&p.expressions.at(-1)===n){n=p;p=parents.get(n);}
  if(p?.type==='ReturnStatement')return true;
  if(p?.type!=='ExpressionStatement')return false;
  n=p;
  while((p=parents.get(n))){
   if(p.type==='Program'||p.type==='BlockStatement'){if(p.body.slice(p.body.indexOf(n)+1).some(s=>!['FunctionDeclaration','EmptyStatement'].includes(s.type)))return false;n=p;continue;}
   if(p.type==='TryStatement'&&asynchronous&&p.finalizer&&n!==p.finalizer&&p.finalizer.body.length)return false;
   if(p.type==='IfStatement'||p.type==='TryStatement'||p.type==='CatchClause'){n=p;continue;}
   return functions.has(p.type);
  }
  return true;
 }
 const asyncCompletionReceiver=n=>{let base=n;while(base?.type==='CallExpression'&&base.callee.type==='MemberExpression'&&['then','catch','finally'].includes(property(base.callee)))base=base.callee.object;return base?.type==='CallExpression'&&targets(base.callee).some(fn=>done.has(fn)&&(fn.async||asyncAdded.has(fn)));};
 const detachedCalls=new Set(nodes.filter(n=>n.type==='CallExpression'&&parents.get(n)?.type==='ExpressionStatement'&&(targets(n.callee).some(fn=>done.has(fn)&&(asyncAdded.has(fn)||fn.async))||asyncCompletionReceiver(n)&&promiseValue(n)||closedAsyncCompletionRoot(ix,n,fn=>done.has(fn))&&promiseValue(n))&&!tail(n,true)));
 const detachedHTTP=new Set(nodes.filter(n=>n.type==='CallExpression'&&parents.get(n)?.type==='ExpressionStatement'&&isHTTP?.(n)&&targets(n.arguments[1]).some(fn=>done.has(fn))&&!tail(n,true)));
 const executorCompletion=[...executors].some(fn=>done.has(fn));
 const concurrent=executorCompletion||nodes.some(n=>done.has(timerCallback(n)))||detachedCalls.size>0||detachedHTTP.size>0;
 if(concurrent&&nodes.some(n=>n.type==='Identifier'&&n.name==='Promise'&&bindings.has(n)))fail(tree,'并发完成传播依赖标准 Promise，局部 Promise 绑定尚未证明');
 if(concurrent&&nodes.some(n=>{
  if(!free(n,'Promise'))return false;
  const p=parents.get(n),call=parents.get(p);
  if(p?.type==='NewExpression'&&p.callee===n||p?.type==='UnaryExpression'&&p.operator==='typeof')return false;
  return !(p?.type==='MemberExpression'&&p.object===n&&['resolve','reject','all','allSettled','race','any','withResolvers'].includes(property(p))&&call?.type==='CallExpression'&&call.callee===p);
 }))fail(tree,'并发完成传播依赖标准 Promise，构造器修改或逃逸尚未证明');
 const finish=concurrent?fresh('finishNative'):null,reject=concurrent?fresh('rejectNative'):null,finished=concurrent?fresh('nativeResult'):null;
 const awaitValue=code=>executorCompletion?`await Promise.race([${code}, ${finished}])`:`await ${code}`;
 function raw(n){return substitutions.has(n)?substitutions.get(n):api(n);}
 function render(n){return overrides.has(n)?overrides.get(n):statementTypes.has(n.type)?statement(n):expression(n).code;}
 const result=(code,before=[])=>({code,before});
 const statementTypes=new Set(['Program','BlockStatement','ExpressionStatement','VariableDeclaration','ReturnStatement','ThrowStatement','IfStatement','TryStatement','ForStatement','ForInStatement','ForOfStatement','WhileStatement','DoWhileStatement','SwitchStatement','BreakStatement','ContinueStatement','EmptyStatement','FunctionDeclaration','LabeledStatement']);
 function expression(n,owner=owners.get(n),wait=false,deferPromise=false){
  if(!n)return result('');
  if(functions.has(n.type))return result(functionText(n));
  if(n.type==='AwaitExpression'){const e=expression(n.argument,owner,true);if(!concurrent)return e;const value=fresh('awaitedValue');return result(value,[...e.before,`const ${value} = ${e.code};`,guard(owner)]);}
  if(n.type==='CallExpression'&&isDone(n)){
   // Payload shapes and API fields still go through the same native mapper.
   const v=n.arguments[0],prefix=[];
   if(v){const e=expression(v,owner);prefix.push(...e.before);substitutions.set(v,e.code);}
   const termination=owner===tree?`return ${completion}.value;`:inRegeneratorCallback(owner)?'':'return;';
   return result('undefined',[...prefix,`${completion} = {value: ${payload(v)}};`,...(concurrent?[`${finish}(${completion}.value);`]:[]),termination]);
  }
  if(n.type==='SequenceExpression'){
   const before=[];for(const part of n.expressions.slice(0,-1)){const e=expression(part,owner);before.push(...e.before,'('+e.code+');');}
   const last=expression(n.expressions.at(-1),owner);return result(last.code,[...before,...last.before]);
  }
  if(n.type==='LogicalExpression'){
   const a=expression(n.left,owner),b=expression(n.right,owner);
   if(!b.before.length){substitutions.set(n.left,a.code);substitutions.set(n.right,b.code);return result(raw(n),a.before);}
   const value=fresh('value'),test=n.operator==='&&'?value:n.operator==='||'?'!'+value:`${value} == null`;
   return result(value,[...a.before,`let ${value} = ${a.code};`,`if (${test}) {${b.before.join('\n')}\n${value} = ${b.code};}`]);
  }
  if(n.type==='ConditionalExpression'){
   const test=expression(n.test,owner),yes=expression(n.consequent,owner),no=expression(n.alternate,owner);
   if(!yes.before.length&&!no.before.length){substitutions.set(n.test,test.code);substitutions.set(n.consequent,yes.code);substitutions.set(n.alternate,no.code);return result(raw(n),test.before);}
   const value=fresh('value');return result(value,[...test.before,`let ${value};`,`if (${test.code}) {${yes.before.join('\n')}\n${value}=${yes.code};} else {${no.before.join('\n')}\n${value}=${no.code};}`]);
  }
  if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&['then','catch','finally'].includes(property(n.callee))&&done.has(owner))return promise(n,owner,wait);
  if(n.type==='MemberExpression'&&free(n.object,'$utils'))return result(raw(n));
  const opaqueCallee=n.type==='CallExpression'&&(n.callee.type==='MemberExpression'&&free(n.callee.object)&&['$notification','$utils','$persistentStore','$prefs','$task','$httpClient'].includes(n.callee.object.name)||n.callee.type==='Identifier'&&free(n.callee,'$log'));
  const parts=children(n).filter(([field,c])=>(!opaqueCallee||field!=='callee')&&(!['Property','MethodDefinition'].includes(n.type)||c===n.value||n.computed)).map(([field,c])=>({field,node:c,value:expression(c,owner)}));
  // 纯读取的接收者没有求值顺序副作用，参数中的完成副作用可以先展开。
  const simpleReference=node=>node.type==='Identifier'||node.type==='ThisExpression'||node.type==='MemberExpression'&&!node.optional&&property(node)!==undefined&&simpleReference(node.object);
  const before=[];
  for(let i=0;i<parts.length;i++){
   const p=parts[i];before.push(...p.value.before);
   let code=p.value.code;
   if(parts.slice(i+1).some(x=>x.value.before.length)&&!['Literal','FunctionExpression','ArrowFunctionExpression'].includes(p.node.type)){
    if(n.type==='AssignmentExpression'&&n.operator==='='&&p.field==='left'&&['Identifier','ArrayPattern','ObjectPattern'].includes(p.node.type)){substitutions.set(p.node,code);continue;}
    if(n.type==='CallExpression'&&p.field==='callee'){if(simpleReference(p.node))continue;fail(n,'复杂接收者与完成参数交错，需先确定求值顺序');}
    if(n.type==='AssignmentExpression'&&p.field==='left'){if(p.node.type==='Identifier'||p.node.type==='MemberExpression'&&simpleReference(p.node.object))continue;fail(n,'复杂接收者与完成参数交错，需先确定求值顺序');}
    const saved=fresh('value');before.push(`const ${saved} = ${code};`);code=saved;
   }
   substitutions.set(p.node,code);
  }
  let code=raw(n);
  // Evaluate a Promise receiver before attaching handlers. A synchronous error
  // creating it is not a rejection of that Promise.
  if(deferPromise)return result(code,before);
  if(n.type==='CallExpression'){
   if(done.has(timerCallback(n))){
    const callback=n.arguments[0],args=fresh('timerArguments'),error=fresh('timerError');
    substitutions.set(callback,`(...${args}) => {if (${completion}) return;try {Promise.resolve((${raw(callback)})(...${args})).catch(${reject});} catch (${error}) {${reject}(${error});}}`);
    return result(raw(n),before);
   }
   const candidates=targets(n.callee),completing=candidates.some(fn=>done.has(fn)),newAsync=candidates.some(fn=>asyncAdded.has(fn));
   // Await lifted value calls in-place: JavaScript preserves receiver and
   // assignment-reference evaluation order across await without temporaries.
   if(newAsync&&!completing)return result('('+awaitValue(code)+')',before);
   if(detachedCalls.has(n))return result('void ('+code+').catch('+reject+')',before);
   if(completing||newAsync){
    if(completing&&(newAsync||candidates.some(fn=>fn.async))&&!wait&&!tail(n,true))fail(n,'未等待的异步完成任务后仍有执行路径，不能串行化原有并发');
    const async=wait||newAsync||candidates.some(fn=>fn.async);
    const value=fresh('callResult');before.push(`const ${value} = ${async?awaitValue(code):code};`);
    if(completing)before.push(guard(owner));
    return result(value,before);
   }
  }
  return result(wait?awaitValue(code):code,before);
 }
 function functionText(n){
  if(!(concurrent&&n.async)&&![...done,...asyncAdded].some(fn=>fn&&fn.start>=n.start&&fn.end<=n.end)&&!nodes.some(c=>c.start>=n.start&&c.end<=n.end&&c.type==='CallExpression'&&targets(c.callee).some(fn=>asyncAdded.has(fn))))return api(n);
  const prelude=(concurrent&&(done.has(n)||n.async)?`if (${completion}) return;\n`:'')+replyPrelude(n),body=n.body.type==='BlockStatement'?statement(n.body):'{'+line(expression(n.body,n),true)+'}';
  let head=patch(source,{...n,body:null,end:n.body.start},render);
  if(n.body.type!=='BlockStatement')head=head.slice(0,head.lastIndexOf('=>')+2)+' ';
  if(executorHelpers.has(n)&&(asyncAdded.has(n)||hasPromiseCompletion(n)||prelude.includes('await ')))fail(n,'Promise 执行器需要异步提升，不能改变同步执行器契约');
  const method=parents.get(n)?.type==='MethodDefinition'||parents.get(n)?.type==='Property'&&parents.get(n).method;
  // 已证 wrap 状态函数由同步状态机驱动，不能因为内部完成通道被提升而改成
  // async：wrap 需要立即返回状态对象，Promise 返回值会破坏推进协议。
  if((asyncAdded.has(n)||hasPromiseCompletion(n)||prelude.includes('await '))&&!n.async&&!method&&!synchronousRegeneratorCallback(n))head='async '+head;
  return head+(prelude?'{'+prelude+'\n'+body.slice(1,-1)+'}':body);
 }
 function hasPromiseCompletion(fn){return nodes.some(n=>owners.get(n)===fn&&n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&['then','catch','finally'].includes(property(n.callee))&&done.has(fn));}
 function line(e,ret=false){return e.before.join('\n')+(e.code==='undefined'&&e.before.length?'':'\n'+(ret?'return ':'')+(!ret&&/^\s*(?:function\b|async\s+function\b|class\b|\{)/.test(e.code)?'('+e.code+')':e.code)+';');}
 function asBlock(n){const text=statement(n);return n.type==='BlockStatement'?text:'{'+text+'}';}
 function httpCallStatement(call,owner){
  const callback=call.arguments[1],fn=targets(callback)[0];
  if(done.has(fn)&&!tail(call,true)&&!detachedHTTP.has(call))fail(call,'未等待的 HTTP 完成任务后仍有执行路径，不能串行化原有并发');
  if(fn)substitutions.set(callback,functionText(fn));
  return httpStatement(call,guard(owner),executorCompletion&&executorHelpers.has(owner)||detachedHTTP.has(call)||concurrent&&!done.has(fn)?{completion,reject}:null);
 }
 function statement(n){
  const owner=owners.get(n);
  if(n.type==='Program'||n.type==='BlockStatement'){
   let position=n.type==='Program'?(n.body[0]?.start??n.end):n.start+1,body='';
   for(const child of n.body){body+=source.slice(position,child.start)+'\n'+statement(child);position=child.end;}
   body+=source.slice(position,n.type==='Program'?n.end:n.end-1);return n.type==='Program'?body:'{'+body+'}';
  }
  if(n.type==='FunctionDeclaration')return functionText(n);
  if(n.type==='ExpressionStatement'){
   if(deferred?.statement===n)return `{${deferred.promise} = (async () => {${line(expression(n.expression,owner))}})();${guard(owner)}}`;
   if(n.expression.type==='SequenceExpression'){
    const flatten=node=>node.type==='SequenceExpression'?node.expressions.flatMap(flatten):[node],parts=flatten(n.expression),calls=parts.filter(part=>isHTTP?.(part));
    if(calls.length){
     if(calls.length!==1||parts.at(-1)!==calls[0])fail(n,'HTTP 请求位于有后续求值的逗号表达式中，无法保持完成顺序');
     return parts.map(part=>part===calls[0]?httpCallStatement(part,owner):line(expression(part,owner))).join('\n');
    }
   }
   if(isHTTP?.(n.expression)){
    return httpCallStatement(n.expression,owner);
   }
   return line(expression(n.expression,owner));
  }
  if(n.type==='ReturnStatement'){
   if(isHTTP?.(n.argument)){
    const callback=n.argument.arguments[1],fn=targets(callback)[0];
    if(fn)substitutions.set(callback,functionText(fn));
    return httpStatement(n.argument,guard(owner))+'\nreturn;';
   }
   return n.argument?line(expression(n.argument,owner),true):'return;';
  }
  if(n.type==='ThrowStatement'){const e=expression(n.argument,owner);return e.before.join('\n')+'\nthrow '+e.code+';';}
  if(n.type==='VariableDeclaration'){
   const lines=[];for(const d of n.declarations){const e=expression(d.init,owner);lines.push(...e.before,`${n.kind} ${source.slice(d.id.start,d.id.end)}${d.init?' = '+e.code:''};`);const extra=extraAfter.get(d)?.();if(extra)lines.push(extra);}return lines.join('\n');
  }
  if(n.type==='IfStatement'){const e=expression(n.test,owner);return e.before.join('\n')+`\nif (${e.code}) ${asBlock(n.consequent)}`+(n.alternate?' else '+asBlock(n.alternate):'');}
  if(n.type==='TryStatement'){
   let code='try '+asBlock(n.block);
   if(n.handler)code+=' catch'+(n.handler.param?' ('+source.slice(n.handler.param.start,n.handler.param.end)+')':'')+' '+asBlock(n.handler.body);
   if(n.finalizer)code+=` finally {if (!${completion}) ${asBlock(n.finalizer)}}`;
   return code;
  }
  if(n.type==='ForInStatement'||n.type==='ForOfStatement'){
   const e=expression(n.right,owner),left=n.left.type==='VariableDeclaration'?source.slice(n.left.start,n.left.end):expression(n.left,owner).code;
   return e.before.join('\n')+`\nfor ${n.await?'await ':''}(${left} ${n.type==='ForInStatement'?'in':'of'} ${e.code}) ${asBlock(n.body)}`;
  }
  if(n.type==='ForStatement'||n.type==='WhileStatement'||n.type==='DoWhileStatement'){
   for(const part of [n.init,n.test,n.update])if(part){
    if(nodes.some(x=>x.start>=part.start&&x.end<=part.end&&x.type==='CallExpression'&&(isDone(x)||compressionMethod(x.callee)||targets(x.callee).some(fn=>done.has(fn)))))fail(part,'循环控制表达式含完成操作');
    overrides.set(part,api(part));
   }
   overrides.set(n.body,asBlock(n.body));return patch(source,n,render);
  }
  if(n.type==='SwitchStatement'){
   const e=expression(n.discriminant,owner),cases=n.cases.map(c=>{
    const label=c.test?expression(c.test,owner):null;if(label?.before.length)fail(c,'switch 标签含完成操作');
    return (label?'case '+label.code:'default')+':'+c.consequent.map(statement).join('\n');
   });return e.before.join('\n')+`\nswitch (${e.code}) {${cases.join('\n')}}`;
  }
  if(['BreakStatement','ContinueStatement','EmptyStatement'].includes(n.type))return source.slice(n.start,n.end);
  if(n.type==='LabeledStatement')return n.label.name+':'+statement(n.body);
  return expression(n,owner).code;
 }
 function opaquePromiseCallback(n,seen=new Set()){
  const value=resolve(n);if(value!==n){if(seen.has(value))return false;seen=new Set(seen);seen.add(value);return opaquePromiseCallback(value,seen);}
  if(n?.type==='Literal'||n?.type==='TemplateLiteral'||free(n,'undefined'))return true;
  if(n?.type==='BinaryExpression'&&n.operator==='+'&&(n.left.type==='Literal'&&typeof n.left.value==='string'||n.right.type==='Literal'&&typeof n.right.value==='string'||opaquePromiseCallback(n.left,seen)&&n.left.type==='BinaryExpression'))return true;
  if(n?.type==='MemberExpression'&&free(n.object,'console')&&['log','error','warn','info','debug'].includes(property(n)))return nodes.filter(r=>free(r,'console')).every(r=>{const m=parents.get(r),use=parents.get(m);return m?.type==='MemberExpression'&&property(m)!==undefined&&!(use?.type==='AssignmentExpression'&&use.left===m||use?.type==='UpdateExpression'||use?.operator==='delete');});
  return false;
 }
 function promise(n,owner,wait){
  const chain=[];let base=n;
  while(base.type==='CallExpression'&&base.callee.type==='MemberExpression'&&['then','catch','finally'].includes(property(base.callee))){
   const method=property(base.callee);
   if(base.arguments.length!==1&&!(method==='then'&&base.arguments.length===2))fail(base,'Promise 完成回调必须是一个可解析函数');
   const callbacks=base.arguments.map(argument=>{
    const candidates=targets(argument);
    if(candidates.length!==1){if(!candidates.length&&opaquePromiseCallback(argument))return {fn:null,argument,opaque:true};fail(base,'Promise 完成回调必须是一个可解析函数');}
    if(!functions.has(argument.type)&&!callbackReference(argument))fail(base,'Promise 回调引用必须在注册前完成初始化且不可变');
    return {fn:candidates[0],argument};
   });
   chain.unshift({method,...callbacks[0],rejected:callbacks[1]});base=base.callee.object;
  }
  // Completion elsewhere in a function does not make every ordinary Promise
  // chain a completion chain. Preserve its callbacks, rejection and concurrency.
  const baseCompletes=base.type==='CallExpression'&&targets(base.callee).some(fn=>done.has(fn));
  if(!baseCompletes&&!chain.some(c=>done.has(c.fn)||c.rejected&&done.has(c.rejected.fn))){
   const initial=expression(base,owner),code=chain.reduce((text,c)=>text+'.'+c.method+'('+callbackText(c)+(c.rejected?','+callbackText(c.rejected):'')+')',initial.code);
   return result(wait?awaitValue(code):code,initial.before);
  }
  if(detachedCalls.has(n)){
   const initial=expression(base,owner,false,true);
   const handler=callback=>{const fn=fresh('promiseCallback'),args=fresh('promiseArguments');return `((${fn}) => typeof ${fn} === 'function' ? (...${args}) => {if (${completion}) return;return ${fn}(...${args});} : ${fn})(${callbackText(callback)})`;};
   const code=chain.reduce((text,c)=>text+'.'+c.method+'('+handler(c)+(c.rejected?','+handler(c.rejected):'')+')',initial.code);
   return result('void ('+code+').catch('+reject+')',initial.before);
  }
  if(parents.get(n)?.type!=='AwaitExpression'&&!tail(n,true))fail(n,'未等待的 Promise 完成链后仍有执行路径');
  const order=chain.map(x=>x.method).join(',');
  if(!promiseValue(base))fail(base,'Promise 完成链接收者没有可证明的 Promise 契约');
  if(chain.some(c=>c.opaque||c.rejected?.opaque)||!['then','then,catch','then,finally','then,catch,finally','catch,finally','finally','catch'].includes(order)){
   // Keep arbitrarily repeated native Promise steps in authored order. The
   // guards suppress later handlers only after legacy completion has ended the
   // script; rejection routing and finally's value preservation remain JS.
   const initial=expression(base,owner,false,true),value=fresh('promiseValue');
   const handler=callback=>{const args=fresh('promiseArguments');if(callback.opaque){const fn=fresh('promiseCallback');return `((${fn}) => typeof ${fn} === 'function' ? (...${args}) => {if (${completion}) return;return ${fn}(...${args});} : ${fn})(${callbackText(callback)})`;}return `(...${args}) => {if (${completion}) return;return (${callbackText(callback)})(...${args});}`;};
   const code=chain.reduce((text,c)=>text+'.'+c.method+'('+handler(c)+(c.rejected?','+handler(c.rejected):'')+')',initial.code);
   return result(value,[...initial.before,`const ${value} = ${awaitValue('('+code+')')};`,guard(owner)]);
  }
  const value=fresh('promiseValue'),error=fresh('promiseError');
  function invoke(callback,arg,assign=true){const call=awaitValue(`(${callbackText(callback)})(${arg??''})`);return `${assign?value+' = ':''}${call};\n${guard(owner)}`;}
  const then=chain.find(c=>c.method==='then'),caught=chain.find(c=>c.method==='catch'),final=chain.find(c=>c.method==='finally');
  const rejected=then?.rejected,initial=expression(base,owner,!rejected,!!rejected);
  const start=`${initial.before.join('\n')}\n${value} = ${initial.code};\n${guard(owner)}`;
  // The second then argument handles only rejection of the receiver. Errors
  // thrown by onFulfilled belong to the subsequent catch, never onRejected.
  const failed=rejected?fresh('promiseRejected'):null,pending=rejected?fresh('promiseReceiver'):null;
  const body=rejected?`let ${failed} = false;\ntry {${value} = ${awaitValue(pending)};} catch (${error}) {${failed} = true; ${value} = ${error};}\n${guard(owner)}\nif (${failed}) {${invoke(rejected,value)}} else {${invoke(then,value)}}`:`${start}\n${then?invoke(then,value):''}`;
  const setup=rejected?[...initial.before,`const ${pending} = ${initial.code};`]:[];
  return result(value,[...setup,`let ${value};`,caught||final?`try {${body}}${caught?` catch (${error}) {${invoke(caught,error)}}`:''}${final?` finally {if (!${completion}) {${invoke(final,undefined,false)}}}`:''}`:body]);
 }
 function callbackText(callback){return functions.has(callback.argument.type)?functionText(callback.fn):api(callback.argument);}
 function callbackReference(n,seen=new Set()){
  if(n?.type!=='Identifier')return false;
  const b=bindings.get(n);if(!b||b.writes.length||seen.has(b)||!b.init)return false;
  if(b.init.type==='FunctionDeclaration')return true;
  const d=parents.get(b.init),statement=parents.get(d),block=parents.get(statement);
  if(d?.type!=='VariableDeclarator'||statement?.type!=='VariableDeclaration')return false;
  let at=n;while(parents.get(at)&&parents.get(at)!==block)at=parents.get(at);
  const after=owners.get(n)===owners.get(statement)&&parents.get(at)===block&&at.start>=statement.end||block?.type==='Program'&&initializedAfter(ix,statement,n);
  if(!after)return false;
  return functions.has(b.init.type)||b.init.type==='Identifier'&&callbackReference(b.init,new Set([...seen,b]));
 }
 const rendered=statement(tree);
 // regenerator 驱动可能在 IIFE 内完成并把结果写进 completion，但驱动返回值
 // 已被原脚本丢弃；异步状态链可能还要经过少量微任务才写入完成值。这里只做
 // 有界排空，既覆盖已证的同步/异步完成回调，又不会在缺完成路径上永久等待。
 const regeneratorResult=regeneratorMachines.size?`for (let completionTurn = 0; completionTurn < 20 && !${completion}; completionTurn++) await Promise.resolve();\nif (${completion}) return ${completion}.value;`:'';
 return {body:rendered+(regeneratorResult?`\n${regeneratorResult}`:'')+(deferred?`\nif (${deferred.promise} !== undefined) {await ${deferred.promise};${guard(tree)}}`:'')+(concurrent?`\nreturn await ${finished};`:''),prefix:`let ${completion};${concurrent?`let ${finish}, ${reject};const ${finished} = new Promise((resolve,reject) => {${finish}=resolve;${reject}=reject;});`:''}${deferred?`let ${deferred.promise};`:''}`,render,raw:substitutions,done};
}

// Expand discarded statement expressions before native return propagation.
// Never rewrite completion calls inside arguments, assignments or used values.

export function completionStatements(source){
 const comments=[];
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true,onComment:comments}),ix=index(tree);
 const done=n=>n?.type==='CallExpression'&&ix.free(n.callee,'$done');
 const http=n=>n?.type==='CallExpression'&&n.callee.type==='MemberExpression'&&ix.free(n.callee.object,'$httpClient')&&['get','post','put','delete','head','options','patch'].includes(property(n.callee));
 const containment=new WeakMap();
 function contains(root){
  if(!root)return false;
  const stack=[{node:root,state:0}];
  while(stack.length){
   const frame=stack.at(-1),n=frame.node;
   if(containment.has(n)){stack.pop();continue;}
   if(!frame.state){
    if(done(n)||http(n)){containment.set(n,true);stack.pop();continue;}
    frame.children=n.type==='SequenceExpression'?n.expressions:n.type==='ConditionalExpression'?[n.test,n.consequent,n.alternate]:n.type==='LogicalExpression'&&['&&','||'].includes(n.operator)?[n.left,n.right]:[];
    frame.state=1;
    for(let i=frame.children.length-1;i>=0;i--){const child=frame.children[i];if(child&&!containment.has(child))stack.push({node:child,state:0});}
    continue;
   }
   const has=node=>!!node&&containment.get(node)===true;
   const result=n.type==='SequenceExpression'?n.expressions.some(has):n.type==='ConditionalExpression'?!has(n.test)&&(has(n.consequent)||has(n.alternate)):n.type==='LogicalExpression'&&['&&','||'].includes(n.operator)?!has(n.left)&&has(n.right):false;
   containment.set(n,result);stack.pop();
  }
  return containment.get(root)===true;
 }
 function flowNodes(root,mode){
  const result=[],pending=[root];
  while(pending.length){
   const n=pending.pop();
   if(mode==='statement'&&n.type==='SequenceExpression'){for(let i=n.expressions.length-1;i>=0;i--)pending.push(n.expressions[i]);continue;}
   if(mode==='return'&&n.type==='ConditionalExpression'&&contains(n)||mode==='statement'&&n.type==='ConditionalExpression'&&contains(n)){
    result.push(n.test);pending.push(n.alternate,n.consequent);continue;
   }
   if(mode==='statement'&&n.type==='LogicalExpression'&&contains(n)){result.push(n.left);pending.push(n.right);continue;}
   result.push(n);
  }
  return result;
 }
 function flowText(root,child,mode){
  const output=[],pending=[{kind:'node',node:root}];
  while(pending.length){
   const task=pending.pop();if(task.kind==='text'){output.push(task.value);continue;}
   const n=task.node;
   if(mode==='return'&&n.type==='ConditionalExpression'&&contains(n)){
    pending.push({kind:'text',value:'}'},{kind:'node',node:n.alternate},{kind:'text',value:'} else {'},{kind:'node',node:n.consequent},{kind:'text',value:`if (${child(n.test)}) {`});continue;
   }
   if(mode==='return'){output.push('return '+child(n)+';');continue;}
   if(n.type==='SequenceExpression'){
    for(let i=n.expressions.length-1;i>=0;i--){pending.push({kind:'node',node:n.expressions[i]});if(i)pending.push({kind:'text',value:'\n'});}continue;
   }
   if(n.type==='ConditionalExpression'&&contains(n)){
    pending.push({kind:'text',value:'}'},{kind:'node',node:n.alternate},{kind:'text',value:'} else {'},{kind:'node',node:n.consequent},{kind:'text',value:`if (${child(n.test)}) {`});continue;
   }
   if(n.type==='LogicalExpression'&&contains(n)){
    pending.push({kind:'text',value:'}'},{kind:'node',node:n.right},{kind:'text',value:`if (${n.operator==='||'?'!('+child(n.left)+')':child(n.left)}) {`});continue;
   }
   output.push(child(n)+';');
  }
  return output.join('');
 }
 return renderTree(source,tree,n=>{
  if(n.type==='ReturnStatement'&&n.argument?.type==='ConditionalExpression'&&contains(n.argument)&&!comments.some(c=>c.start>=n.start&&c.end<=n.end)){
   const argument=n.argument;return {children:flowNodes(argument,'return'),render:child=>'{'+flowText(argument,child,'return')+'}'};
  }
  if(n.type==='ExpressionStatement'&&n.expression.type==='UnaryExpression'&&['!','void'].includes(n.expression.operator)&&!comments.some(c=>c.start>=n.start&&c.end<=n.end&&(c.start<n.expression.argument.start||c.end>n.expression.argument.end))){
   const argument=n.expression.argument;return {children:[argument],render:child=>'{('+child(argument)+');}'};
  }
  if(n.type==='ExpressionStatement'&&contains(n.expression)&&!done(n.expression)&&!http(n.expression)&&!comments.some(c=>c.start>=n.start&&c.end<=n.end)){
   const expression=n.expression;return {children:flowNodes(expression,'statement'),render:child=>'{'+flowText(expression,child,'statement')+'}'};
  }
  return null;
 });
}

// A single root task may start before trailing scalar initializers. Awaiting
// at its call site would change what that task observes after its first await.
// Keep the start point and defer only the final join; reject multiple tasks or
// unproved work after launch. Reviewed synchronous tails keep their original
// position; a synchronous completion stops them before the final join.
export function pendingCompletion(ix,complete,asyncFns,target){
 const {nodes,parents,owners}=ix,tree=nodes[0],calls=new Set();
 const pure=n=>!n||n.type==='Literal'&&!n.regex||n.type==='UnaryExpression'&&['!','void','+','-','~'].includes(n.operator)&&pure(n.argument)||['BinaryExpression','LogicalExpression'].includes(n.type)&&pure(n.left)&&pure(n.right);
 const prototypeInitializer=s=>{
  const a=s?.type==='ExpressionStatement'?s.expression:null,l=a?.left,r=a?.right;
  if(a?.type!=='AssignmentExpression'||a.operator!=='='||l?.type!=='MemberExpression'||l.object.type!=='Identifier'||property(l)!=='prototype'||r?.type!=='ObjectExpression'||r.properties.length!==1)return false;
  const b=ix.bindings.get(l.object),p=r.properties[0];
  return b?.init?.type==='FunctionDeclaration'&&!b.writes.length&&p.type==='Property'&&p.kind==='init'&&key(p)==='constructor'&&p.value.type==='Identifier'&&ix.bindings.get(p.value)===b;
 };
 const facts=valueFacts(ix),standard=new Set(['Math','String','Number','console']);
 const ordinaryCalls=new Set(['abs','ceil','floor','round','random','min','max','pow','trunc','fromCharCode','fromCodePoint','log','warn','error','info','debug','toFixed','toPrecision','toExponential','toString']);
 const builtinsModified=nodes.some(n=>{
  if(n.type==='MemberExpression'&&['prototype','__proto__',...ordinaryCalls].includes(property(n))){const p=parents.get(n);if(['prototype','__proto__'].includes(property(n))||p?.type==='AssignmentExpression'&&p.left===n||p?.type==='UpdateExpression'||p?.operator==='delete')return true;}
  return n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&ix.free(n.callee.object,'Object')&&['assign','setPrototypeOf','defineProperty','defineProperties'].includes(property(n.callee));
 });
 const globalsStable=!builtinsModified&&nodes.filter(n=>ix.free(n)&&standard.has(n.name)).every(n=>{let m=n;while(parents.get(m)?.type==='MemberExpression'&&parents.get(m).object===m)m=parents.get(m);const p=parents.get(m);return p?.type==='CallExpression'&&p.callee===m;});
 // ToPrimitive can invoke arbitrary user code, including another async task.
 // Prove operands and arguments are scalars before treating the tail as sync.
 function scalar(n,seen=new Set()){
  if(!n||n.type==='Literal'&&!n.regex||ix.free(n)&&['undefined','NaN','Infinity'].includes(n.name))return true;
  if(seen.has(n))return false;seen=new Set(seen);seen.add(n);
  if(n.type==='Identifier'){
   const b=ix.bindings.get(n);if(!b||seen.has(b))return false;seen.add(b);
   if(b.init)return scalar(b.init,seen)&&b.writes.every(w=>w.type==='UpdateExpression'||w.type==='AssignmentExpression'&&w.left.type==='Identifier'&&ix.bindings.get(w.left)===b&&scalar(w.right,seen));
   const fn=nodes.find(fn=>functions.has(fn.type)&&fn.params.some(p=>ix.bindings.get(p.type==='AssignmentPattern'?p.left:p)===b));
   if(!fn||b.writes.length)return false;
   const pos=fn.params.findIndex(p=>ix.bindings.get(p.type==='AssignmentPattern'?p.left:p)===b),id=fn.id??(parents.get(fn)?.type==='VariableDeclarator'?parents.get(fn).id:null),fb=id?ix.bindings.get(id):null;
   return !!fb&&!fb.writes.length&&fb.refs.length>0&&fb.refs.every(ref=>{const call=parents.get(ref);if(call?.type!=='CallExpression'||call.callee!==ref||call.arguments.some(a=>a.type==='SpreadElement'))return false;const value=call.arguments[pos],fallback=fn.params[pos].type==='AssignmentPattern'?fn.params[pos].right:null;return scalar(!value||ix.free(value,'undefined')?fallback:value,seen);});
  }
  if(n.type==='UnaryExpression')return ['!','void','typeof'].includes(n.operator)||scalar(n.argument,seen);
  if(['BinaryExpression','LogicalExpression'].includes(n.type))return scalar(n.left,seen)&&scalar(n.right,seen);
  if(n.type==='ConditionalExpression')return scalar(n.consequent,seen)&&scalar(n.alternate,seen);
  if(n.type==='TemplateLiteral')return n.expressions.every(x=>scalar(x,seen));
  if(n.type==='MemberExpression')return property(n)==='length'&&scalar(n.object,seen);
  if(n.type==='CallExpression'){
   if(n.optional||n.arguments.some(a=>!scalar(a,seen)))return false;
   const fn=target(n.callee);
   if(fn){if(fn.async||fn.generator||seen.has(fn))return false;const next=new Set(seen);next.add(fn);const results=fn.body.type==='BlockStatement'?nodes.filter(r=>r.type==='ReturnStatement'&&owners.get(r)===fn).map(r=>r.argument):[fn.body];return results.every(r=>scalar(r,next));}
   const m=n.callee;return globalsStable&&m.type==='MemberExpression'&&ordinaryCalls.has(property(m))&&(ix.free(m.object)&&standard.has(m.object.name)||scalar(m.object,seen));
  }
  return false;
 }
 function synchronous(n,seen=new Set()){
  if(!n)return true;
  if(functions.has(n.type))return true;
  if(['AwaitExpression','YieldExpression','NewExpression','WithStatement','TaggedTemplateExpression','SpreadElement'].includes(n.type))return false;
  if(n.type==='BinaryExpression'&&(!scalar(n.left)||!scalar(n.right))||n.type==='UnaryExpression'&&!['!','void','typeof','delete'].includes(n.operator)&&!scalar(n.argument)||n.type==='TemplateLiteral'&&n.expressions.some(x=>!scalar(x))||n.type==='Property'&&n.computed&&!scalar(n.key))return false;
  if(n.type==='CallExpression'){
   if(n.optional||n.arguments.some(a=>a.type==='SpreadElement'||functions.has(a.type)))return false;
   const fn=target(n.callee);
   if(fn){
    if(fn.async||fn.generator||complete.has(fn)||asyncFns.has(fn)||seen.has(fn))return false;
    const next=new Set(seen);next.add(fn);if(!synchronous(fn.body,next))return false;
   }else{
    const m=n.callee;
    if(!globalsStable||m.type!=='MemberExpression'||!ordinaryCalls.has(property(m))||n.arguments.some(a=>!scalar(a)))return false;
    if(!(ix.free(m.object)&&standard.has(m.object.name))&&!scalar(m.object))return false;
   }
  }
  if(n.type==='MemberExpression'&&!(parents.get(n)?.type==='CallExpression'&&parents.get(n).callee===n)){
   if(property(n)!=='length'||!facts.string(n.object))return false;
  }
  if(n.type==='AssignmentExpression'||n.type==='UpdateExpression'){
   const left=n.type==='AssignmentExpression'?n.left:n.argument;
   if(left.type!=='Identifier'||!ix.bindings.has(left)||n.type==='UpdateExpression'&&!scalar(left)||n.type==='AssignmentExpression'&&n.operator!=='='&&(!scalar(left)||!scalar(n.right)))return false;
  }
  return children(n).every(([k,c])=>n.type==='CallExpression'&&k==='callee'||synchronous(c,seen));
 }
 const inert=s=>prototypeInitializer(s)||['FunctionDeclaration','EmptyStatement'].includes(s.type)||s.type==='VariableDeclaration'&&s.declarations.every(d=>d.id.type==='Identifier'&&pure(d.init));
 const candidates=nodes.filter(n=>n.type==='CallExpression'&&owners.get(n)===tree&&complete.has(target(n.callee))&&asyncFns.has(target(n.callee))&&parents.get(n)?.type==='ExpressionStatement');
 let root;
 for(const n of candidates){
  let child=parents.get(n),p=parents.get(child),nonTail=false,valid=true;
  while(p){
   if(p.type==='Program'||p.type==='BlockStatement'){
    const rest=p.body.slice(p.body.indexOf(child)+1);if(rest.some(s=>!inert(s)&&!synchronous(s)))valid=false;
    if(rest.some(s=>!['FunctionDeclaration','EmptyStatement'].includes(s.type)))nonTail=true;
    if(p===tree){if(nonTail){if(root&&root!==child)valid=false;else root=child;}break;}
   }else if(p.type!=='IfStatement'){valid=false;break;}
   child=p;p=parents.get(child);
  }
  if(!valid&&nonTail)return null;
  if(nonTail&&valid)calls.add(n);
 }
 if(!calls.size||!root)return null;
 const count=n=>{
  if(n.type==='ExpressionStatement')return calls.has(n.expression)?1:0;
  if(n.type==='IfStatement')return Math.max(count(n.consequent),n.alternate?count(n.alternate):0);
  if(n.type==='BlockStatement')return n.body.reduce((sum,s)=>sum+count(s),0);
  return 0;
 };
 // A tail completion in another branch of the same launch statement must also
 // join at the epilogue, otherwise it may inadvertently serialize execution.
 for(const n of candidates)if(n.start>=root.start&&n.end<=root.end)calls.add(n);
 if(count(root)>1||[...calls].some(n=>n.start<root.start||n.end>root.end))return null;
 return {calls};
}
