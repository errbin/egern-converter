import {parse} from '../core/syntax.mjs';
import {index,patch,renderTree,property,functions,key,children} from '../core/ast.mjs';
import {methodContract} from '../platform/clients.mjs';
import {evaluationBindings} from './evaluation.mjs';

// Decode a reviewed jsjiami RC4 string-table grammar without eval, VM execution,
// or calling an input function. Only literal data and bounded scalar arithmetic
// are reduced. The self-defence shell has a separate, complete AST contract;
// business statements are always read from the input, never supplied by a hash.

const DECODER='629ca9bdabf16b86b1774598a5e4b79b73a23475b5f7f3e55a45a2f5c749ea88';
const ROTATION='d96102ed6e98958565af115ed722aabefb2805cbc0f545c64cbf9473eaf9fd41';
const SHELLS=new Set(['2fb24a457e18d87859569d483f1081ed0eaa651a1d4734d4328bb7e51d6c142c']);
const options={ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true};
const stop=why=>{throw Error('静态字符串表解码：'+why);};

// Reduce closed Function-constructor shells without executing authored code.
// This is intentionally an abstract interpreter for data-only expressions:
// Function bodies are parsed; single static return expressions are reduced,
// while invoked statement bodies are returned to the native compiler. No
// input statements, host calls, or effects are run. Unsupported input falls
// through to the normal compiler.
const shellFunction=Object.freeze({kind:'function-constructor'});
const shellCtor=name=>Object.freeze({kind:'constructor',name});
const shellIntrinsic=name=>Object.freeze({kind:'intrinsic',name});
const shellObject=()=>({kind:'object',properties:new Map()});
const shellArray=values=>({kind:'array',values});
const shellBoxed=(type,value)=>({kind:'boxed',type,value});
const shellGenerated=(params,argument,code)=>({kind:'generated-function',params,argument,code});
const shellProgram=code=>({kind:'source-program',code});
const shellUnsupported=()=>{throw Error('not a closed static expression');};
const shellMaxSteps=120000,shellMaxDepth=192,shellMaxSource=1048576;
const shellArrayIndex=name=>/^(0|[1-9]\d*)$/.test(name)&&Number(name)<4294967295?Number(name):null;

function shellPrimitive(value){
 if(value===null||value===undefined||['string','number','boolean'].includes(typeof value))return value;
 if(value?.kind==='boxed')return value.value;
 if(value?.kind==='array')return value.values.map(shellPrimitive).map(v=>v==null?'':String(v)).join(',');
 if(value?.kind==='object'){
  if(value.properties.has('toString')||value.properties.has('valueOf'))shellUnsupported();
  return '[object Object]';
 }
 shellUnsupported();
}
function shellString(value){const v=shellPrimitive(value);return v===null?'null':v===undefined?'undefined':String(v);}
function shellNumber(value){
 const v=shellPrimitive(value);
 if(v===undefined)return NaN;if(v===null)return 0;if(typeof v==='boolean')return v?1:0;
 if(typeof v==='number')return v;if(typeof v==='string')return v.trim()===''?0:Number(v);
 return NaN;
}
function shellTruthy(value){return !!value;}
function shellTypeof(value){
 if(value===undefined)return 'undefined';
 if(value===null)return 'object';
 if(['function-constructor','constructor','generated-function','intrinsic'].includes(value?.kind))return 'function';
 if(['object','array','boxed'].includes(value?.kind))return 'object';
 return typeof value;
}
function shellObjectLike(value){return ['object','array','boxed','function-constructor','constructor','generated-function','intrinsic'].includes(value?.kind);}
function shellLooseEqual(a,b){
 if(a===b||a==null&&b==null)return true;
 if(typeof a==='boolean')return shellLooseEqual(Number(a),b);
 if(typeof b==='boolean')return shellLooseEqual(a,Number(b));
 if(shellObjectLike(a)){if(shellObjectLike(b))return false;return shellLooseEqual(shellPrimitive(a),b);}
 if(shellObjectLike(b))return shellLooseEqual(a,shellPrimitive(b));
 if(typeof a==='string'&&typeof b==='number')return Number(a)===b;
 if(typeof b==='string'&&typeof a==='number')return a===Number(b);
 return false;
}
function shellPropertyKey(value){return shellString(value);}
function shellGet(base,name){
 if(base===null||base===undefined)shellUnsupported();
 if(name==='__proto__')shellUnsupported();
 if(base?.kind==='boxed')return name==='constructor'?shellCtor(base.type):shellGet(base.value,name);
 if(base?.kind==='object')return base.properties.get(name);
 if(base?.kind==='array'){
  if(name==='length')return base.values.length;
  if(name==='constructor')return shellCtor('Array');
  const arrayIndex=shellArrayIndex(name);if(arrayIndex!==null)return base.values[arrayIndex];
  if(['join','push','pop','shift','unshift','reverse','slice','concat','filter','map','forEach'].includes(name))return shellIntrinsic('Array.'+name);
  return undefined;
 }
 if(typeof base==='string'){
  if(name==='length')return base.length;
  if(name==='constructor')return shellCtor('String');
  const stringIndex=shellArrayIndex(name);if(stringIndex!==null)return base[stringIndex];
  if(['charAt','charCodeAt','codePointAt','slice','substring','substr','indexOf','lastIndexOf','split','toLowerCase','toUpperCase','trim','replace'].includes(name))return shellIntrinsic('String.'+name);
  return undefined;
 }
 if(typeof base==='number'||typeof base==='boolean'){
  if(name==='constructor')return shellCtor(typeof base==='number'?'Number':'Boolean');
  return undefined;
 }
 if(base?.kind==='constructor')return name==='constructor'?shellFunction:base.name==='String'&&['fromCharCode','fromCodePoint'].includes(name)?shellIntrinsic('String.'+name):undefined;
 if(base===shellFunction)return name==='constructor'?shellFunction:undefined;
 if(base?.kind==='intrinsic')return name==='constructor'?shellFunction:undefined;
 if(base?.kind==='generated-function')return name==='constructor'?shellFunction:undefined;
 return undefined;
}
function shellSet(base,name,value){
 if(base?.kind==='object'){base.properties.set(name,value);return value;}
 if(base?.kind==='array'){
  if(name==='length'&&Number.isInteger(value)&&value>=0&&value<=100000){base.values.length=value;return value;}
  const arrayIndex=shellArrayIndex(name);if(arrayIndex!==null&&arrayIndex<100000){base.values[arrayIndex]=value;return value;}
 }
 shellUnsupported();
}
function shellCall(fn,args,state,depth,isNew=false){
 if(fn===shellFunction||fn?.kind==='constructor'&&fn.name==='Function'){
  state.usedFunction=true;
  const body=args.length?shellString(args.at(-1)):'';
  if(body.length>shellMaxSource) shellUnsupported();
  const params=args.slice(0,-1).map(shellString);
  if(params.some(p=>!/^[$A-Z_a-z][$\w]*$/.test(p)))shellUnsupported();
  const ast=parse(body,options);
  return shellGenerated(params,ast.body.length===1&&ast.body[0].type==='ReturnStatement'?ast.body[0].argument:null,body);
 }
 if(fn?.kind==='generated-function'){
  if(!fn.argument)return shellProgram(fn.code);
  const local=new Map(state.env);fn.params.forEach((p,i)=>local.set(p,args[i]));
  try{return shellEvaluate(fn.argument,{...state,env:local},depth+1);}
  catch{return shellProgram(fn.code);}
 }
 if(fn?.kind==='constructor'){
  if(fn.name==='String'){const value=args.length?shellString(args[0]):'';return isNew?shellBoxed('String',value):value;}
  if(fn.name==='Number'){const value=args.length?shellNumber(args[0]):0;return isNew?shellBoxed('Number',value):value;}
  if(fn.name==='Boolean'){const value=args.length?shellTruthy(args[0]):false;return isNew?shellBoxed('Boolean',value):value;}
  if(fn.name==='Array'){
   if(args.length===1&&typeof args[0]==='number'){
    if(!Number.isInteger(args[0])||args[0]<0||args[0]>100000)shellUnsupported();
    return shellArray(Array(args[0]));
   }
   return shellArray(args);
  }
  if(fn.name==='Object'){
   const value=args[0];if(value===null||value===undefined)return shellObject();
   if(value?.kind==='object'||value?.kind==='array'||value?.kind==='boxed')return value;
   if(typeof value==='string'||typeof value==='number'||typeof value==='boolean')return shellBoxed(typeof value==='string'?'String':typeof value==='number'?'Number':'Boolean',value);
   shellUnsupported();
  }
 }
 if(fn?.kind==='intrinsic'){
  const [a,b]=args;
  if(fn.name==='String.fromCharCode')return String.fromCharCode(...args.map(shellNumber));
  if(fn.name==='String.fromCodePoint')return String.fromCodePoint(...args.map(shellNumber));
  if(fn.name==='Array.join')return fn.receiver.values.map(shellPrimitive).map(v=>v==null?'':String(v)).join(a===undefined?',':shellString(a));
  if(fn.name==='Array.push'){fn.receiver.values.push(...args);return fn.receiver.values.length;}
  if(fn.name==='Array.pop')return fn.receiver.values.pop();
  if(fn.name==='Array.shift')return fn.receiver.values.shift();
  if(fn.name==='Array.unshift'){fn.receiver.values.unshift(...args);return fn.receiver.values.length;}
  if(fn.name==='Array.reverse'){fn.receiver.values.reverse();return fn.receiver;}
  if(fn.name==='Array.slice')return shellArray(fn.receiver.values.slice(shellNumber(a)||0,b===undefined?undefined:shellNumber(b)));
  if(fn.name==='Array.concat')return shellArray(fn.receiver.values.concat(...args.map(x=>x?.kind==='array'?x.values:x)));
  if(fn.name==='String.charAt')return shellString(fn.receiver).charAt(shellNumber(a));
  if(fn.name==='String.charCodeAt')return shellString(fn.receiver).charCodeAt(shellNumber(a));
  if(fn.name==='String.codePointAt')return shellString(fn.receiver).codePointAt(shellNumber(a));
  if(fn.name==='String.slice')return shellString(fn.receiver).slice(a===undefined?0:shellNumber(a),b===undefined?undefined:shellNumber(b));
  if(fn.name==='String.substring')return shellString(fn.receiver).substring(a===undefined?0:shellNumber(a),b===undefined?undefined:shellNumber(b));
  if(fn.name==='String.substr')return shellString(fn.receiver).substr(a===undefined?0:shellNumber(a),b===undefined?undefined:shellNumber(b));
  if(fn.name==='String.indexOf')return shellString(fn.receiver).indexOf(shellString(a),b===undefined?0:shellNumber(b));
  if(fn.name==='String.lastIndexOf')return shellString(fn.receiver).lastIndexOf(shellString(a),b===undefined?undefined:shellNumber(b));
  if(fn.name==='String.split')return shellArray(shellString(fn.receiver).split(a===undefined?undefined:shellString(a),b===undefined?undefined:shellNumber(b)));
  if(fn.name==='String.toLowerCase')return shellString(fn.receiver).toLowerCase();
  if(fn.name==='String.toUpperCase')return shellString(fn.receiver).toUpperCase();
  if(fn.name==='String.trim')return shellString(fn.receiver).trim();
  if(fn.name==='String.replace'&&typeof a==='string')return shellString(fn.receiver).replace(a,b===undefined?'undefined':shellString(b));
 }
 if(fn?.kind==='intrinsic'&&fn.name==='parseInt')return Number.parseInt(shellString(args[0]),args.length>1?shellNumber(args[1]):undefined);
 shellUnsupported();
}
function shellEvaluate(node,state,depth=0){
 if(!node||depth>shellMaxDepth||++state.steps>shellMaxSteps)shellUnsupported();
 const {env}=state;
 if(node.type==='Literal')return node.value;
 if(node.type==='Identifier'){
  if(env.has(node.name))return env.get(node.name);
  if(node.name==='undefined')return undefined;if(node.name==='NaN')return NaN;if(node.name==='Infinity')return Infinity;
  if(node.name==='Function')return shellFunction;
  if(['String','Number','Boolean','Object','Array'].includes(node.name))return shellCtor(node.name);
  if(node.name==='parseInt')return shellIntrinsic('parseInt');
  shellUnsupported();
 }
 if(node.type==='ArrayExpression')return shellArray(node.elements.map(e=>e?e.type==='SpreadElement'?shellUnsupported():shellEvaluate(e,state,depth+1):undefined));
 if(node.type==='ObjectExpression'){
  const result=shellObject();
  for(const p of node.properties){if(p.type!=='Property'||p.kind!=='init'||p.method)shellUnsupported();const name=p.computed?shellPropertyKey(shellEvaluate(p.key,state,depth+1)):String(key(p));result.properties.set(name,shellEvaluate(p.value,state,depth+1));}
  return result;
 }
 if(node.type==='MemberExpression'){
  const base=shellEvaluate(node.object,state,depth+1),name=shellPropertyKey(node.computed?shellEvaluate(node.property,state,depth+1):property(node));
  const value=shellGet(base,name);return value?.kind==='intrinsic'?{...value,receiver:base}:value;
 }
 if(node.type==='UnaryExpression'){
  const value=shellEvaluate(node.argument,state,depth+1);
  if(node.operator==='!')return !shellTruthy(value);if(node.operator==='~')return ~shellNumber(value);
  if(node.operator==='+')return shellNumber(value);if(node.operator==='-')return -shellNumber(value);
  if(node.operator==='void')return undefined;if(node.operator==='typeof')return shellTypeof(value);
  shellUnsupported();
 }
 if(node.type==='BinaryExpression'&&node.operator==='+'){
  const parts=[];let current=node;
  while(current?.type==='BinaryExpression'&&current.operator==='+'){parts.push(current.right);current=current.left;}
  let result=shellEvaluate(current,state,depth+1);
  for(let i=parts.length-1;i>=0;i--){const right=shellEvaluate(parts[i],state,depth+1),left=shellPrimitive(result),r=shellPrimitive(right);result=typeof left==='string'||typeof r==='string'?shellString(left)+shellString(r):shellNumber(left)+shellNumber(r);}
  return result;
 }
 if(node.type==='BinaryExpression'){
  const a=shellEvaluate(node.left,state,depth+1),b=shellEvaluate(node.right,state,depth+1),x=shellPrimitive(a),y=shellPrimitive(b);
  switch(node.operator){case '-':return shellNumber(x)-shellNumber(y);case '*':return shellNumber(x)*shellNumber(y);case '/':return shellNumber(x)/shellNumber(y);case '%':return shellNumber(x)%shellNumber(y);case '**':return shellNumber(x)**shellNumber(y);case '<<':return shellNumber(x)<<shellNumber(y);case '>>':return shellNumber(x)>>shellNumber(y);case '>>>':return shellNumber(x)>>>shellNumber(y);case '|':return shellNumber(x)|shellNumber(y);case '&':return shellNumber(x)&shellNumber(y);case '^':return shellNumber(x)^shellNumber(y);case '===':return a===b;case '!==':return a!==b;case '==':return shellLooseEqual(a,b);case '!=':return !shellLooseEqual(a,b);case '<':return x<y;case '<=':return x<=y;case '>':return x>y;case '>=':return x>=y;}
  shellUnsupported();
 }
 if(node.type==='LogicalExpression'){
  const left=shellEvaluate(node.left,state,depth+1);
  if(node.operator==='&&')return shellTruthy(left)?shellEvaluate(node.right,state,depth+1):left;
  if(node.operator==='||')return shellTruthy(left)?left:shellEvaluate(node.right,state,depth+1);
  if(node.operator==='??')return left==null?shellEvaluate(node.right,state,depth+1):left;
  shellUnsupported();
 }
 if(node.type==='ConditionalExpression')return shellEvaluate(shellTruthy(shellEvaluate(node.test,state,depth+1))?node.consequent:node.alternate,state,depth+1);
 if(node.type==='SequenceExpression'){let result;for(const item of node.expressions)result=shellEvaluate(item,state,depth+1);return result;}
 if(node.type==='UpdateExpression'){
  let old;
  if(node.argument.type==='Identifier'){old=env.get(node.argument.name);if(!env.has(node.argument.name))shellUnsupported();const next=shellNumber(old)+(node.operator==='++'?1:-1);env.set(node.argument.name,next);return node.prefix?next:old;}
  if(node.argument.type==='MemberExpression'){const base=shellEvaluate(node.argument.object,state,depth+1),name=shellPropertyKey(node.argument.computed?shellEvaluate(node.argument.property,state,depth+1):property(node.argument));old=shellGet(base,name);const next=shellNumber(old)+(node.operator==='++'?1:-1);shellSet(base,name,next);return node.prefix?next:old;}
  shellUnsupported();
 }
 if(node.type==='AssignmentExpression'){
  let target,name;
  if(node.left.type==='Identifier')target={kind:'identifier',name:node.left.name};
  else if(node.left.type==='MemberExpression'){
   target={kind:'member',base:shellEvaluate(node.left.object,state,depth+1),name:shellPropertyKey(node.left.computed?shellEvaluate(node.left.property,state,depth+1):property(node.left))};
  }else shellUnsupported();
  const old=node.operator==='='?undefined:target.kind==='identifier'?env.get(target.name):shellGet(target.base,target.name);
  const right=shellEvaluate(node.right,state,depth+1);let value=right;
  if(node.operator!=='='){
   const a=shellPrimitive(old),b=shellPrimitive(right);
   if(node.operator==='+=' )value=typeof a==='string'||typeof b==='string'?shellString(a)+shellString(b):shellNumber(a)+shellNumber(b);
   else if(node.operator==='-=')value=shellNumber(a)-shellNumber(b);else if(node.operator==='*=')value=shellNumber(a)*shellNumber(b);else if(node.operator==='/=')value=shellNumber(a)/shellNumber(b);else shellUnsupported();
  }
  if(target.kind==='identifier')env.set(target.name,value);else shellSet(target.base,target.name,value);
  return value;
 }
 if(node.type==='CallExpression'||node.type==='NewExpression'){
  const fn=shellEvaluate(node.callee,state,depth+1),args=node.arguments.map(a=>a.type==='SpreadElement'?shellUnsupported():shellEvaluate(a,state,depth+1));
  return shellCall(fn,args,state,depth,node.type==='NewExpression');
 }
 if(node.type==='TemplateLiteral'){
  let value=node.quasis[0].value.cooked??node.quasis[0].value.raw;
  for(let i=0;i<node.expressions.length;i++)value+=shellString(shellEvaluate(node.expressions[i],state,depth+1))+(node.quasis[i+1].value.cooked??node.quasis[i+1].value.raw);
  return value;
 }
 shellUnsupported();
}

function decodeFunctionConstructorLayer(source){
 if(source.length>shellMaxSource)return null;
 let tree;try{tree=parse(source,options);}catch{return null;}
 if(!tree.body.length||tree.body.length>64||tree.body.some(n=>n.type!=='ExpressionStatement'))return null;
 const state={env:new Map(),steps:0,usedFunction:false};let result;
 try{for(const statement of tree.body)result=shellEvaluate(statement.expression,state);}
 catch{return null;}
 if(!state.usedFunction||result?.kind!=='source-program'||result.code===source||result.code.length>shellMaxSource)return null;
 const payload=result.code;
 if(!payload.trim())return null;
 try{
  const decoded=parse(payload,options),decodedIndex=index(decoded);
  if(!decoded.body.length||decodedIndex.nodes.some(n=>n.type==='Identifier'&&decodedIndex.free(n)&&state.env.has(n.name)))return null;
 }
 catch{return null;}
 return source.slice(0,tree.body[0].start)+payload;
}

export function lowerFunctionConstructorSource(source){
 let output=source,layers=0;
 while(layers<8){const next=decodeFunctionConstructorLayer(output);if(next===null||next===output)break;output=next;layers++;}
 return {source:output,transformations:layers?[{kind:'closed-function-constructor-static-source',layers,
  reason:'reduced bounded literal expressions and extracted generated function bodies; no input JavaScript was executed'}]:[]};
}

function rc4(encoded,key){
 const alphabet='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';
 if(typeof encoded!=='string'||typeof key!=='string'||!key.length||encoded.length>65536||key.length>256)stop('字符串或密钥超出有界输入范围');
 const decoded=[];let count=0,accumulator;
 for(const char of encoded){const value=alphabet.indexOf(char);if(value<0)stop('密文包含未知字符');accumulator=count%4?accumulator*64+value:value;if(count++%4)decoded.push(255&accumulator>>(-2*count&6));}
 const input=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Uint8Array.from(decoded));
 const box=Array.from({length:256},(_,i)=>i);let j=0,out='',i=0;
 for(let k=0;k<256;k++){j=(j+box[k]+key.charCodeAt(k%key.length))%256;[box[k],box[j]]=[box[j],box[k]];}
 j=0;
 for(let k=0;k<input.length;k++){i=(i+1)%256;j=(j+box[i])%256;[box[i],box[j]]=[box[j],box[i]];out+=String.fromCharCode(input.charCodeAt(k)^box[(box[i]+box[j])%256]);}
 return out;
}

export function inspectStringTable(source){
 const tree=parse(source,options),ix=index(tree),{nodes,parents,bindings}=ix;
 const candidates=tree.body.filter(n=>n.type==='FunctionDeclaration'&&methodContract(n,new Set(nodes.filter(x=>x.type==='FunctionDeclaration').map(x=>x.id.name)))===DECODER);
 if(candidates.length!==1)stop('未匹配已审查的解码器语法');
 const decoder=candidates[0],db=bindings.get(decoder.id),first=decoder.body.body[0];
 const tableCall=first.declarations[0].init,table=bindings.get(tableCall.callee)?.init;
 if(table?.type!=='FunctionDeclaration'||table.params.length||table.body.body.length!==3)stop('字符串表工厂结构不明确');
 const [declaration,assignment,returned]=table.body.body,d=declaration?.declarations?.[0],set=assignment?.expression;
 const cached=set?.right;
 if(declaration.type!=='VariableDeclaration'||declaration.declarations.length!==1||d.id.type!=='Identifier'||set?.type!=='AssignmentExpression'||set.operator!=='='||bindings.get(set.left)!==bindings.get(table.id)||!functions.has(cached?.type)||cached.params.length||cached.body.body.length!==1||cached.body.body[0].type!=='ReturnStatement'||bindings.get(cached.body.body[0].argument)!==bindings.get(d.id)||returned.type!=='ReturnStatement'||returned.argument.type!=='CallExpression'||returned.argument.arguments.length||bindings.get(returned.argument.callee)!==bindings.get(table.id))stop('字符串表工厂包含未审查的操作');
 let size=0;
 function literal(n){
  if(++size>10000)stop('字符串表超过静态展开上限');
  if(n?.type==='Literal'&&typeof n.value==='string')return n.value;
  if(n?.type==='ArrayExpression')return n.elements.flatMap(e=>{if(e?.type!=='SpreadElement')return [literal(e)];const array=literal(e.argument);if(!Array.isArray(array))stop('只允许静态数组展开');return array;});
  if(n?.type==='CallExpression'&&!n.arguments.length&&functions.has(n.callee.type)&&!n.callee.params.length&&n.callee.body.body?.length===1&&n.callee.body.body[0].type==='ReturnStatement')return literal(n.callee.body.body[0].argument);
  if(n?.type==='Identifier'){
   const b=bindings.get(n),init=b?.init;
   // The version sentinel is initialized before this bounded rotation. Its
   // later assignment is part of the separately reviewed shell, not executed.
   if(init?.type==='Literal'&&typeof init.value==='string'&&init.value==='jsjiami.com.v7')return init.value;
  }
  stop('字符串表必须只包含字符串、数组展开和单 return 的无参工厂');
 }
 const data=literal(d.init);
 if(!Array.isArray(data)||data.some(v=>typeof v!=='string')||data.length<3||data.length>4096||data.reduce((sum,v)=>sum+v.length,0)>1048576)stop('无效或超出上限的字符串表');
 const roles=new Set([decoder.id.name,table.id.name]);
 const rotations=nodes.filter(n=>n.type==='CallExpression'&&functions.has(n.callee.type)&&methodContract(n.callee,roles)===ROTATION);
 if(rotations.length!==1)stop('未匹配已审查的字符串表旋转语法');
 const rotate=rotations[0],args=rotate.arguments;
 if(args.length!==4||args[2].type!=='Identifier'||bindings.get(args[2])!==bindings.get(table.id)||[0,1,3].some(i=>args[i].type!=='Literal'||!Number.isInteger(args[i].value)))stop('旋转参数不是有界常量');
 if(args[3].value-(args[0].value>>4)!==2||data[1].replace(/[YrxdfWVUFDyBIuHbKLhX=]/g,'')!==data[0])stop('字符串表版本哨兵不匹配');
 const inner=decoder.body.body.at(-1).argument.expressions[0].right;
 const offset=inner.body.body[0].expression.right.right.value;
 const tryBlock=nodes.find(n=>n.type==='TryStatement'&&n.start>rotate.start&&n.end<rotate.end);
 const checksum=tryBlock?.block.body[0]?.expression?.right;
 const cipher=data.slice(2);
 const aliases=new Set([db]);let changed=true;
 while(changed){changed=false;for(const n of nodes)if(n.type==='VariableDeclarator'&&n.id.type==='Identifier'&&n.init?.type==='Identifier'&&aliases.has(bindings.get(n.init))&&!bindings.get(n.id)?.writes.length&&!aliases.has(bindings.get(n.id))){aliases.add(bindings.get(n.id));changed=true;}}
 const decode=(i,key)=>rc4(cipher[i-offset],key);
 function number(n){
  if(n?.type==='Literal'&&typeof n.value==='number')return n.value;
  if(n?.type==='UnaryExpression'&&['+','-'].includes(n.operator)){const v=number(n.argument);return n.operator==='+'?+v:-v;}
  if(n?.type==='BinaryExpression'&&['+','-','*','/'].includes(n.operator)){const a=number(n.left),b=number(n.right);return n.operator==='+'?a+b:n.operator==='-'?a-b:n.operator==='*'?a*b:a/b;}
  const call=n?.type==='CallExpression'&&ix.free(n.callee,'parseInt')&&n.arguments.length===1?n.arguments[0]:null;
  if(call?.type==='CallExpression'&&aliases.has(bindings.get(call.callee))&&call.arguments.length===2&&call.arguments[0].type==='Literal'&&call.arguments[1].type==='Literal')return Number.parseInt(decode(call.arguments[0].value,call.arguments[1].value));
  stop('旋转校验表达式超出常量算术范围');
 }
 let found=false;
 for(let k=0;k<cipher.length;k++){
  try{if(number(checksum)===args[1].value){found=true;break;}}catch(error){if(error.message.startsWith('静态字符串表解码：'))throw error;}
  cipher.push(cipher.shift());
 }
 if(!found)stop('旋转校验未在一轮内找到匹配项');
 const replacements=new WeakMap();
 for(const n of nodes)if(n.type==='CallExpression'&&aliases.has(bindings.get(n.callee))&&n.arguments.length===2&&n.arguments.every(a=>a.type==='Literal'))replacements.set(n,JSON.stringify(decode(n.arguments[0].value,n.arguments[1].value)));
 const render=n=>replacements.get(n)??patch(source,n,render);
 const touched=n=>nodes.some(x=>x.start>=n.start&&x.end<=n.end&&ix.free(x)&&x.name.startsWith('$'));
 const boundaries=tree.body.filter(touched);
 if(!boundaries.length)stop('没有独立的代理脚本业务语句');
 const business=tree.body.slice(tree.body.indexOf(boundaries[0]),tree.body.indexOf(boundaries.at(-1))+1);
 for(const n of nodes.filter(n=>business.some(b=>n.start>=b.start&&n.end<=b.end))){
  if(ix.free(n)&&['console','globalThis','global','window','setTimeout','setInterval','eval','Function'].includes(n.name))stop('业务观察了自防御壳影响的宿主状态');
  if(n.type==='Identifier'&&ix.reference(n)&&aliases.has(bindings.get(n))&&!replacements.has(parents.get(n)))stop('业务中的解码器引用不是常量字符串读取');
 }
 const shell=tree.body.filter(n=>!business.includes(n)&&n!==table&&n!==decoder);
 const shellSource=shell.map(render).join('\n');
 // A marker retains the business region's position in the complete shell.
 // Hashing the shell alone would also admit business moved before the version
 // initializer or table rotation, where the original decoder may fail.
 const layout=tree.body.flatMap(n=>n===business[0]?[';']:business.includes(n)||n===table||n===decoder?[]:[render(n)]).join('\n');
 const shellAST=parse(layout,options),contract=methodContract(shellAST,roles);
 const outside=new Set(nodes.filter(n=>n.type==='Identifier'&&ix.reference(n)&&business.some(b=>n.start>=b.start&&n.end<=b.end)).map(n=>bindings.get(n)).filter(b=>b?.init&&!business.some(n=>b.init.start>=n.start&&b.init.end<=n.end)&&!aliases.has(b)));
 if(outside.size)stop('业务依赖自防御壳中的非解码变量');
 return {source:business.map(render).join('\n'),shell:shellSource,contract};
}

export function lowerStringTables(source){
 if(!source.includes('jsjiami.com.v7'))return {source,transformations:[]};
 const result=inspectStringTable(source);
 if(!SHELLS.has(result.contract))stop('已解码，但自防御壳的语义契约尚未匹配 ('+result.contract+')');
 return {source:result.source,transformations:[{name:'jsjiami RC4 literal string table',shell_contract:result.contract,
  removed:'reviewed debugger/timer/console-suppression shell; business AST retained from source'}]};
}

// Resolve literal lookups from a closed string table. Source functions are
// never executed: only scalar arithmetic and a reviewed rotation are reduced.
// Keep the authored decoder and rotation intact for any runtime observations.
const rotations=new Set(['7e26a3d143c0160bb5601e22e4841f3da454bfe46de7b21adbb8d77057f9393a']);
export function lowerLiteralStringTables(source){
 const ix=index(parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}));
 const observed=evaluationBindings(ix,source);
 const {nodes,bindings,parents}=ix,replace=new WeakMap(),removed=new WeakSet(),transformations=[];
 const same=(a,b)=>a?.type==='Identifier'&&b?.type==='Identifier'&&bindings.get(a)&&bindings.get(a)===bindings.get(b);
 for(const fn of nodes){
  if(fn.type!=='FunctionDeclaration'||fn.params.length!==2||fn.params.some(p=>p.type!=='Identifier')||fn.body.body.length!==4)continue;
  const [assign,tableDecl,valueDecl,ret]=fn.body.body,sub=assign.expression,td=tableDecl.declarations?.[0],vd=valueDecl.declarations?.[0];
  if(sub?.type!=='AssignmentExpression'||sub.operator!=='='||!same(sub.left,fn.params[0])||sub.right.type!=='BinaryExpression'||sub.right.operator!=='-'||!same(sub.right.left,fn.params[0])||sub.right.right.type!=='Literal'||!Number.isInteger(sub.right.right.value)||tableDecl.type!=='VariableDeclaration'||tableDecl.declarations.length!==1||td.init?.type!=='CallExpression'||td.init.arguments.length||valueDecl.type!=='VariableDeclaration'||valueDecl.declarations.length!==1||vd.init?.type!=='MemberExpression'||!vd.init.computed||!same(vd.init.object,td.id)||!same(vd.init.property,fn.params[0])||ret.type!=='ReturnStatement'||!same(ret.argument,vd.id))continue;
  const fb=bindings.get(fn.id),table=bindings.get(td.init.callee)?.init;
  if(!fb||fb.writes.length||table?.type!=='FunctionDeclaration'||table.params.length||table.body.body.length!==3)continue;
  const [decl,set,returned]=table.body.body,d=decl.declarations?.[0],update=set.expression,cached=update?.right;
  if(decl.type!=='VariableDeclaration'||decl.declarations.length!==1||d.init?.type!=='ArrayExpression'||!d.init.elements.length||d.init.elements.length>10000||d.init.elements.some(e=>e?.type!=='Literal'||typeof e.value!=='string')||update?.type!=='AssignmentExpression'||update.operator!=='='||!same(update.left,table.id)||!functions.has(cached?.type)||cached.params.length||cached.body.body?.length!==1||cached.body.body[0].type!=='ReturnStatement'||!same(cached.body.body[0].argument,d.id)||returned.type!=='ReturnStatement'||returned.argument?.type!=='CallExpression'||returned.argument.arguments.length||!same(returned.argument.callee,table.id))continue;
  const roles=new Set([fn.id.name,table.id.name]);
  const matches=nodes.filter(n=>n.type==='CallExpression'&&functions.has(n.callee.type)&&rotations.has(methodContract(n.callee,roles))&&n.arguments.length===2&&same(n.arguments[0],table.id)&&n.arguments[1].type==='Literal'&&Number.isFinite(n.arguments[1].value));
  if(matches.length!==1)continue;
  const rotation=matches[0],tableBinding=bindings.get(table.id);
  if(tableBinding.refs.some(r=>r!==update.left&&!(r.start>=fn.start&&r.end<=fn.end)&&!(r.start>=table.start&&r.end<=table.end)&&r!==rotation.arguments[0]))continue;
  const aliases=new Set([fb]);let changed=true;
  while(changed){changed=false;for(const n of nodes)if(n.type==='VariableDeclarator'&&n.id.type==='Identifier'&&n.init?.type==='Identifier'&&aliases.has(bindings.get(n.init))&&!bindings.get(n.id)?.writes.length&&!aliases.has(bindings.get(n.id))){aliases.add(bindings.get(n.id));changed=true;}}
  if([...aliases,tableBinding].some(b=>observed.has(b)))continue;
  const values=d.init.elements.map(e=>e.value),offset=sub.right.right.value;
  const value=(n,depth=0)=>{
   if(depth>20)throw Error('bounded scalar depth');
   if(n?.type==='Literal'&&['number','string'].includes(typeof n.value))return n.value;
   if(n?.type==='UnaryExpression'&&['-','+'].includes(n.operator)){const v=value(n.argument,depth+1);return n.operator==='-'?-v:+v;}
   if(n?.type==='BinaryExpression'&&['+','-','*','/','%'].includes(n.operator)){const a=value(n.left,depth+1),b=value(n.right,depth+1);switch(n.operator){case '+':return a+b;case '-':return a-b;case '*':return a*b;case '/':return a/b;case '%':return a%b;}}
   if(n?.type==='CallExpression'&&n.arguments.length===1){if(ix.free(n.callee,'parseInt'))return Number.parseInt(value(n.arguments[0],depth+1));if(aliases.has(bindings.get(n.callee))){const i=value(n.arguments[0],depth+1)-offset;if(!Number.isInteger(i)||i<0||i>=values.length)throw Error('table index');return values[i];}}
   throw Error('not closed scalar');
  };
  const tried=nodes.find(n=>n.type==='TryStatement'&&n.start>=rotation.start&&n.end<=rotation.end),checksum=tried?.block.body[0]?.declarations?.[0]?.init;
  let found=false;
  for(let i=0;i<values.length;i++){try{if(value(checksum)===rotation.arguments[1].value){found=true;break;}}catch{}values.push(values.shift());}
  if(!found)continue;
  let count=0;
  for(const n of nodes)if(n.type==='CallExpression'&&aliases.has(bindings.get(n.callee))&&n.arguments.length===1&&!(n.start>=rotation.start&&n.end<=rotation.end)){
   try{replace.set(n,JSON.stringify(value(n)));count++;}catch{}
  }
  // Decoder aliases are ordinary immutable reads. Drop a closed chain only
  // when every use was decoded, and never within the original initializer.
  const removable=new Map();
  for(const b of aliases){if(b===fb)continue;const d=parents.get(b.init),decl=parents.get(d),container=parents.get(decl),target=bindings.get(b.init);
   if(d?.type==='VariableDeclarator'&&decl?.type==='VariableDeclaration'&&decl.declarations.length===1&&['Program','BlockStatement'].includes(container?.type)&&!(decl.start>=rotation.start&&decl.end<=rotation.end)&&(target?.init?.type==='FunctionDeclaration'||target?.init&&target.init.end<decl.start))removable.set(b,decl);
  }
  let pruned=true;while(pruned){pruned=false;for(const [b]of removable)if(b.refs.some(r=>{const p=parents.get(r);return !(p?.type==='CallExpression'&&replace.has(p)||p?.type==='VariableDeclarator'&&p.init===r&&removable.has(bindings.get(p.id)));})){removable.delete(b);pruned=true;}}
  for(const decl of removable.values())removed.add(decl);
  if(count)transformations.push({kind:'literal-string-table',lookups:count,rotation_contract:methodContract(rotation.callee,roles),reason:'有界常量运算解析字符串；保留原始解码函数与初始化语句'});
 }
 const render=n=>renderTree(source,n,node=>{
  if(removed.has(node))return {direct:true,value:''};
  if(replace.has(node))return {direct:true,value:replace.get(node)};
  // A literal computed method key has no effects. Exclude constructor: the
  // computed spelling denotes an ordinary method rather than a constructor.
  const name=node.type==='MethodDefinition'&&node.computed?(replace.has(node.key)?JSON.parse(replace.get(node.key)):node.key.type==='Literal'?node.key.value:null):null;
  if(typeof name==='string'&&name!=='constructor')return {children:[node.value],render:child=>source.slice(node.start,node.key.start).replace(/\[\s*$/,'')+JSON.stringify(name)+source.slice(node.key.end,node.value.start).replace(/^\s*\]/,'')+child(node.value)};
  return null;
 });
 return {source:render(nodes[0]),transformations};
}

// Statically lower the two closed obfuscator formats found in public sources.
// This parser never executes source functions; it interprets bounded numeric
// expressions, table rotation and RC4 string lookups from the AST.

const KS_DECODER='83130d056909f9118d60ceceeb1ffcb819c47420b2114acedede063c7a5472f9';
const KS_ROTATION='91499af7a74f83ff1a3b106761067059218afe14ec99b99a55ce4fa9065a0c8c';
const PDD_DECODER='cf808f8e545e8b0f2956a2cb8c65003f8c4efa6390476c510581d85660722860';
const PDD_ROTATION='374d90995d3d02aaf08cf4a5e7414bf45666efa755ae78b6662a663de8b78aa7';
const PDD_GUARD_FACTORY='3bfbbd96348f35ba071a427ec3871038da30c0fe26e9b368aca8a49865d32142';
const PDD_GUARD='e72e60357e1040861bbb649e0715623c8185fb49673a45aa2c40716905f1e7e0';
const PDD_GUARD_CALL='6ed5e4eaf1c95c9336570d1edef930e4e4edbebd66567eb920d6d853ba3cf05c';
const KS_SHELL='42968ce9767364c5b3436029a60341804f96ea028122f7ac3b1fc2ce85bedaae';
const KS_SHELL_CHILD='3327d55b7655e3c364edea7ff423d839b42b87d3466f56657b7804a36aba7d29';
const KS_SHELL_CALL='c4c789a203acb298828facda8a77d7a48093e896bf51a3645d67f91615fd4bb7';
const LIMIT=5000;
const fail=why=>{throw Error('混淆字符串表静态解析：'+why);};

// 无密钥调用（如轮转校验和里的 aD(0x2da)）只需 Base64 还原：混淆器在不带密钥时跳过 RC4 步骤。
function decodeBase64Alphabet(encoded,alphabet){
 if(typeof encoded!=='string'||encoded.length>65536)fail('密文或密钥超出边界');
 let acc=0,step=0;const bytes=[];
 for(const ch of encoded){const v=alphabet.indexOf(ch);if(v<0)fail('密文不符合已审查的 Base64 字母表');acc=step%4?acc*64+v:v;if(step++%4)bytes.push(acc>>(-2*step&6)&255);}
 return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Uint8Array.from(bytes));
}
function decodeRC4(encoded,key,alphabet,atob=false){
 if(typeof encoded!=='string'||typeof key!=='string'||!key||encoded.length>65536||key.length>256)fail('密文或密钥超出边界');
 const bytes=[];
 if(atob){
  const text=encoded.replace(/=+$/,'');if(text.length%4===1||!/^[A-Za-z0-9+/]*$/.test(text))fail('v6 密文不符合 atob 输入');
  let acc=0,bits=0;for(const ch of text){const v=alphabet.indexOf(ch);if(v<0||v>63)fail('v6 密文不符合 Base64 字母表');acc=acc<<6|v;bits+=6;if(bits>=8){bits-=8;bytes.push(acc>>bits&255);acc&=(1<<bits)-1;}}
 }else{
  let acc=0,step=0;
  for(const ch of encoded){const v=alphabet.indexOf(ch);if(v<0)fail('密文不符合已审查的 Base64 字母表');acc=step%4?acc*64+v:v;if(step++%4)bytes.push(acc>>(-2*step&6)&255);}
 }
 const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Uint8Array.from(bytes));
 const box=Array.from({length:256},(_,i)=>i);let j=0;
 for(let i=0;i<256;i++){j=(j+box[i]+key.charCodeAt(i%key.length))%256;[box[i],box[j]]=[box[j],box[i]];}
 let i=0,out='';j=0;
 for(let k=0;k<text.length;k++){i=(i+1)%256;j=(j+box[i])%256;[box[i],box[j]]=[box[j],box[i]];out+=String.fromCharCode(text.charCodeAt(k)^box[(box[i]+box[j])%256]);}
 return out;
}

// 结构识别：未列入哈希契约、但与已审查的"缓存式 RC4 解码器"同形。
// 只负责把候选收敛掉；真正的证明仍由 collect 的后续严格检查（表工厂静态来源唯一、
// 常量偏移、唯一轮转且校验和数值可复算）完成，因此不构成放宽。
function cachedDecoderShape(fn,ix){
 if(fn?.type!=='FunctionDeclaration'||fn.params.length!==2||fn.params.some(p=>p.type!=='Identifier'))return false;
 const body=fn.body?.body;if(body?.length!==2)return false;
 const [decl,ret]=body;
 if(decl.type!=='VariableDeclaration'||decl.declarations.length!==1)return false;
 const init=decl.declarations[0].init;
 if(init?.type!=='CallExpression'||init.arguments.length||init.callee.type!=='Identifier')return false;
 const factory=ix.bindings.get(init.callee)?.init;
 if(factory?.type!=='FunctionDeclaration'||factory.body.body.length!==3)return false;
 if(ret.type!=='ReturnStatement'||ret.argument?.type!=='SequenceExpression')return false;
 const assign=ret.argument.expressions?.[0];
 if(assign?.type!=='AssignmentExpression'||assign.operator!=='='||assign.left.type!=='Identifier'||assign.left.name!==fn.id?.name)return false;
 const inner=assign.right;
 if(inner?.type!=='FunctionExpression'||inner.params.length!==2)return false;
 const first=inner.body?.body?.[0]?.expression;
 if(first?.type!=='AssignmentExpression'||first.operator!=='=')return false;
 if(first.left.type!=='Identifier'||first.right?.type!=='BinaryExpression'||first.right.operator!=='-')return false;
 if(first.right.right.type!=='Literal'||!Number.isInteger(first.right.right.value))return false;
 // 内层第二步必须是本地表的成员读取，保证后续 evaluate 的表来源唯一
 const second=inner.body.body[1];
 return second?.type==='VariableDeclaration'&&second.declarations.length===1;
}
// 轮转调用的结构识别：两参、首参绑定到本地表工厂、被调函数体含 while 与 try。
// 轮转步数仍由 rotateKS 用校验和数值复算确认，结构匹配本身不产生信任。
function cachedRotationShape(call,ix,tableBinding){
 if(call.type!=='CallExpression'||call.arguments.length!==2)return false;
 const arg=call.arguments[0];
 if(arg.type!=='Identifier'||ix.bindings.get(arg)!==tableBinding)return false;
 const fn=call.callee,def=fn.type==='FunctionExpression'||fn.type==='FunctionDeclaration'?fn:ix.bindings.get(fn)?.init;
 if(!def||!['FunctionExpression','FunctionDeclaration'].includes(def.type))return false;
 const scan=ix.nodes.filter(n=>n.start>=def.start&&n.end<=def.end);
 return scan.some(n=>n.type==='WhileStatement')&&scan.some(n=>n.type==='TryStatement');
}
// 嵌套 IIFE 轮转的结构判据：外层把起始计数与目标值闭包进来，内层再通过
// 形参接收“表工厂 + 目标值 + 字符串反转器”。结构匹配只负责收敛候选，
// 轮转步数仍必须由逐轮校验和的数值复算唯一确定。
const inside=(node,range)=>!!node&&!!range&&node.start>=range.start&&node.end<=range.end;
function sameIdentifier(ix,left,right){return left?.type==='Identifier'&&right?.type==='Identifier'&&ix.bindings.get(left)&&ix.bindings.get(left)===ix.bindings.get(right);}
function resolvesTo(node,ix,binding,hops=4){
 let current=ix.bindings.get(node);
 for(let hop=0;hop<=hops&&current;hop++){
  if(current===binding)return true;
  const next=current.fn??current.init;
  current=next?.type==='Identifier'?ix.bindings.get(next):null;
 }
 return false;
}
// 轮转器只允许对已确认的本地字符串表做反向器给出的方法调用。
function validatorString(fn,inputs,ix){
 if(fn?.type!=='FunctionExpression'||fn.async||fn.generator||fn.params.some(p=>p.type!=='Identifier'))fail('轮转校验器不是封闭的本地函数');
 const body=fn.body.body;
 if(body.length!==1||body[0].type!=='ReturnStatement'||!body[0].argument)fail('轮转校验器必须只返回一个闭合表达式');
 const allowed=new Set([...fn.params.map(p=>p.name),'arguments','undefined','NaN','Infinity','String','Number','Array','parseInt']);
 for(const node of ix.nodes){
  if(!inside(node,fn)||node.type!=='Identifier'||!ix.free(node))continue;
  if(!allowed.has(node.name))fail('轮转校验器读取了未审查的全局标识符：'+node.name);
 }
 const state={env:new Map(),steps:0};
 fn.params.forEach((param,index)=>state.env.set(param.name,inputs[index]));
 state.env.set('arguments',shellArray(inputs));
 try{return shellString(shellEvaluate(body[0].argument,state));}
 catch{fail('轮转校验器不是已审查的字符串反转');}
}
// 证明轮转初始化语句只包含本地表操作。表达式语句允许保留版本哨兵赋值，
// 但该赋值目标不得再被业务读取；条件语句只允许空分支。
function rotationStatementShape(statement,outer,ix,decoder,tableFactory,wrappers){
 const outside=ix.nodes.filter(node=>inside(node,statement)&&!inside(node,outer));
 if(statement.type==='IfStatement'){
  if(statement.alternate||statement.consequent?.type!=='BlockStatement'||statement.consequent.body.length)fail('轮转初始化语句包含业务分支');
 }else if(statement.type!=='ExpressionStatement')fail('轮转初始化语句不是闭合表达式');
 if(outside.some(node=>['NewExpression','AwaitExpression','YieldExpression','ThisExpression','Super'].includes(node.type)))fail('轮转初始化语句包含未审查的调用或副作用');
 for(const node of outside){
  if(node.type==='CallExpression'){
   if(!resolveCallable(node.callee,ix,wrappers)||node.arguments.some(arg=>arg.type!=='Literal'&&arg.type!=='TemplateLiteral'))fail('轮转初始化语句包含未审查的调用或副作用');
   continue;
  }
  if(node.type!=='AssignmentExpression')continue;
  const literal=node.right.type==='Literal'?node.right.value:node.right.type==='TemplateLiteral'&&!node.right.expressions.length?node.right.quasis[0].value.cooked:undefined;
  const factoryAlias=node.right.type==='Identifier'&&ix.bindings.get(node.right)===ix.bindings.get(tableFactory.id);
  const decoded=node.right.type==='CallExpression'&&!!resolveCallable(node.right.callee,ix,wrappers)&&node.right.arguments.every(arg=>arg.type==='Literal'||arg.type==='TemplateLiteral');
  const closed=literal!==undefined&&['string','number','boolean'].includes(typeof literal)||factoryAlias||decoded;
  if(node.operator!=='='||node.left.type!=='Identifier'||!closed)fail('轮转初始化语句包含未审查的赋值');
  const binding=ix.bindings.get(node.left);
  if(!binding||binding.refs.some(ref=>!inside(ref,statement)&&!inside(ref,decoder)&&!inside(ref,tableFactory)))fail('轮转初始化改写了仍被业务读取的变量');
 }
}
function nestedRotationShape(call,ix,tableFactory,decoder){
 if(call?.type!=='CallExpression'||call.arguments.length!==3)return null;
 const inner=call.callee;
 if(!inner||(inner.type!=='FunctionExpression'&&inner.type!=='FunctionDeclaration')||inner.async||inner.generator||inner.params.length!==5||inner.params.some(p=>p.type!=='Identifier'))return null;
 if(call.arguments[2]?.type!=='FunctionExpression'||call.arguments[2].async||call.arguments[2].generator)return null;
 const scan=ix.nodes.filter(node=>inside(node,inner));
 if(!scan.some(node=>node.type==='WhileStatement')||!scan.some(node=>node.type==='TryStatement'))return null;
 let outer=null;
 for(let parent=ix.parents.get(call);parent;parent=ix.parents.get(parent)){
  if(parent.type==='CallExpression'&&functions.has(parent.callee.type)&&inside(call,parent.callee)){outer=parent;break;}
 }
 if(!outer||outer===call||outer.callee.params.length!==7||outer.arguments.length!==4)return null;
 const params=inner.params,args=call.arguments,[x,y,z,w,v]=params;
 const tableIndex=outer.callee.params.findIndex(param=>sameIdentifier(ix,param,args[0]));
 const targetIndex=outer.callee.params.findIndex(param=>sameIdentifier(ix,param,args[1]));
 if(tableIndex<0||targetIndex<0)return null;
 const factoryArg=outer.arguments[tableIndex],targetArg=outer.arguments[targetIndex];
 if(factoryArg?.type!=='Identifier'||ix.bindings.get(factoryArg)!==ix.bindings.get(tableFactory.id))fail('嵌套轮转使用的表工厂不是唯一静态来源');
 let target;
 try{target=number(targetArg);}catch{fail('嵌套轮转目标不是常量');}
 if(!Number.isFinite(target))fail('嵌套轮转目标不是常量');
 const outerBody=outer.callee.body;
 if(outerBody.type!=='BlockStatement'||outerBody.body.length!==1)fail('嵌套轮转外层不是单一返回');
 const returned=outerBody.body[0];
 if(returned.type!=='ReturnStatement'||returned.argument?.type!=='SequenceExpression'||returned.argument.expressions.length!==4)fail('嵌套轮转外层返回结构不匹配');
 const [shiftStatement,outerF,outerG,innerCall]=returned.argument.expressions;
 if(innerCall!==call)fail('嵌套轮转外层没有返回内层调用');
 if(shiftStatement.type!=='AssignmentExpression'||shiftStatement.operator!=='='||!sameIdentifier(ix,shiftStatement.left,outer.callee.params[0])||shiftStatement.right.type!=='BinaryExpression'||shiftStatement.right.operator!=='>>'||!sameIdentifier(ix,shiftStatement.right.left,outer.callee.params[0])||shiftStatement.right.right.type!=='Literal'||!Number.isInteger(shiftStatement.right.right.value))fail('嵌套轮转的起始位移不是常量');
 if(outerF.type!=='AssignmentExpression'||outerF.operator!=='='||!sameIdentifier(ix,outerF.left,outer.callee.params[5])||outerF.right.type!=='Literal'||outerF.right.value!=='hs')fail('嵌套轮转的方法名初值不匹配');
 if(outerG.type!=='AssignmentExpression'||outerG.operator!=='='||!sameIdentifier(ix,outerG.left,outer.callee.params[6])||outerG.right.type!=='Literal'||outerG.right.value!=='hs')fail('嵌套轮转的方法名初值不匹配');
 const initial=number(outer.arguments[0]),start=number(outer.arguments[3]),shift=shiftStatement.right.right.value,a=initial>>shift;
 if(!Number.isFinite(initial)||!Number.isFinite(start)||!Number.isInteger(shift)||shift<0||shift>31)fail('嵌套轮转的边界参数不是常量');
 if(start-a!==2)fail('嵌套轮转的起始窗口不是两条哨兵项');
 const body=inner.body.body;
 if(body.length!==4||body[0].type!=='VariableDeclaration'||body[0].declarations.length!==1||body[1].type!=='ExpressionStatement'||body[2].type!=='VariableDeclaration'||body[2].declarations.length!==1||body[3].type!=='WhileStatement')fail('嵌套轮转内层结构不匹配');
 const decoderAlias=body[0].declarations[0];
 if(decoderAlias.id.type!=='Identifier'||!resolvesTo(decoderAlias.init,ix,ix.bindings.get(decoder.id)))fail('轮转校验和没有指向已审查解码器');
 const assignments=body[1].expression;
 if(assignments.type!=='SequenceExpression'||assignments.expressions.length!==7)fail('嵌套轮转的方法名构造不匹配');
 const [setWord,setShift,setUnit,setPush,resolveShift,resolvePush,clearValidator]=assignments.expressions;
 if(setWord.type!=='AssignmentExpression'||setWord.operator!=='='||!sameIdentifier(ix,setWord.left,w)||setWord.right.type!=='Literal'||typeof setWord.right.value!=='string')fail('嵌套轮转缺少方法名字面量');
 if(setShift.type!=='AssignmentExpression'||setShift.operator!=='='||!sameIdentifier(ix,setShift.left,outer.callee.params[5])||setShift.right.type!=='BinaryExpression'||setShift.right.operator!=='+'||!sameIdentifier(ix,setShift.right.left,w)||!sameIdentifier(ix,setShift.right.right,outer.callee.params[5]))fail('嵌套轮转的 shift 方法名不是本地拼接');
 if(setUnit.type!=='AssignmentExpression'||setUnit.operator!=='='||!sameIdentifier(ix,setUnit.left,v)||setUnit.right.type!=='Literal'||typeof setUnit.right.value!=='string')fail('嵌套轮转缺少 push 方法名字面量');
 if(setPush.type!=='AssignmentExpression'||setPush.operator!=='+='||!sameIdentifier(ix,setPush.left,outer.callee.params[6])||!sameIdentifier(ix,setPush.right,v))fail('嵌套轮转的 push 方法名不是本地拼接');
 if(resolveShift.type!=='AssignmentExpression'||resolveShift.operator!=='='||!sameIdentifier(ix,resolveShift.left,outer.callee.params[5])||resolveShift.right.type!=='CallExpression'||!sameIdentifier(ix,resolveShift.right.callee,z)||resolveShift.right.arguments.length!==1||!sameIdentifier(ix,resolveShift.right.arguments[0],outer.callee.params[5]))fail('嵌套轮转没有用反转器解析 shift');
 if(resolvePush.type!=='AssignmentExpression'||resolvePush.operator!=='='||!sameIdentifier(ix,resolvePush.left,outer.callee.params[6])||resolvePush.right.type!=='CallExpression'||!sameIdentifier(ix,resolvePush.right.callee,z)||resolvePush.right.arguments.length!==1||!sameIdentifier(ix,resolvePush.right.arguments[0],outer.callee.params[6]))fail('嵌套轮转没有用反转器解析 push');
 if(clearValidator.type!=='AssignmentExpression'||clearValidator.operator!=='='||!sameIdentifier(ix,clearValidator.left,z)||clearValidator.right.type!=='Literal'||clearValidator.right.value!==0)fail('嵌套轮转没有清空反转器绑定');
 const tableAlias=body[2].declarations[0];
 if(tableAlias.id.type!=='Identifier'||tableAlias.init.type!=='CallExpression'||tableAlias.init.arguments.length||!sameIdentifier(ix,tableAlias.init.callee,x))fail('嵌套轮转的表实例不是本地工厂调用');
 const tableBinding=ix.bindings.get(tableAlias.id);
 if(!tableBinding||tableBinding.writes.length)fail('嵌套轮转的本地字符串表被改写');
 const loop=body[3];
 if(loop.test.type!=='LogicalExpression'||loop.test.operator!=='&&'||loop.test.left.type!=='UnaryExpression'||loop.test.left.operator!=='!'||loop.test.left.argument.type!=='UnaryExpression'||loop.test.left.argument.operator!=='!'||loop.test.left.argument.argument.type!=='ArrayExpression'||loop.test.left.argument.argument.elements.length||loop.test.right.type!=='BinaryExpression'||loop.test.right.operator!=='+')fail('嵌套轮转的 while 条件不匹配');
 const decrement=loop.test.right.left,targetSide=loop.test.right.right;
 if(decrement.type!=='UpdateExpression'||decrement.operator!=='--'||!decrement.prefix||!sameIdentifier(ix,decrement.argument,outer.callee.params[3])||!sameIdentifier(ix,targetSide,y))fail('嵌套轮转的递减计数不匹配');
 if(loop.body.type!=='BlockStatement'||loop.body.body.length!==1||loop.body.body[0].type!=='TryStatement')fail('嵌套轮转的循环体不是单一 try');
 const tried=loop.body.body[0];
 if(tried.block.body.length!==1||tried.block.body[0].type!=='ExpressionStatement'||tried.block.body[0].expression.type!=='AssignmentExpression'||tried.block.body[0].expression.operator!=='='||!sameIdentifier(ix,tried.block.body[0].expression.left,w))fail('嵌套轮转的校验和表达式不匹配');
 const checksum=tried.block.body[0].expression.right;
 if(!tried.handler||tried.handler.body.body.length!==1||tried.handler.body.body[0].type!=='ExpressionStatement'||tried.handler.body.body[0].expression.type!=='AssignmentExpression'||tried.handler.body.body[0].expression.operator!=='='||!sameIdentifier(ix,tried.handler.body.body[0].expression.left,w)||!sameIdentifier(ix,tried.handler.body.body[0].expression.right,z))fail('嵌套轮转的异常兜底不匹配');
 if(!tried.finalizer||tried.finalizer.body.length!==2)fail('嵌套轮转的 finally 结构不匹配');
 const [shiftValue,branch]=tried.finalizer.body;
 if(shiftValue.type!=='ExpressionStatement'||shiftValue.expression.type!=='AssignmentExpression'||shiftValue.expression.operator!=='='||!sameIdentifier(ix,shiftValue.expression.left,v)||shiftValue.expression.right.type!=='CallExpression'||shiftValue.expression.right.arguments.length||shiftValue.expression.right.callee.type!=='MemberExpression'||!sameIdentifier(ix,shiftValue.expression.right.callee.object,tableAlias.id))fail('嵌套轮转没有从本地表取出单个元素');
 const shiftName=shiftValue.expression.right.callee.property;
 if(shiftName.type!=='Identifier')fail('嵌套轮转的 shift 方法名不是本地绑定');
 if(branch.type!=='IfStatement'||branch.test.type!=='BinaryExpression'||branch.test.operator!=='<='||!sameIdentifier(ix,branch.test.left,outer.callee.params[0])||!sameIdentifier(ix,branch.test.right,outer.callee.params[3])||branch.consequent.type!=='ExpressionStatement'||branch.consequent.expression.type!=='ConditionalExpression'||!sameIdentifier(ix,branch.consequent.expression.test,z)||branch.consequent.expression.consequent.type!=='ConditionalExpression'||!sameIdentifier(ix,branch.consequent.expression.consequent.test,outer.callee.params[4])||branch.alternate.type!=='BlockStatement'||branch.alternate.body.length!==1)fail('嵌套轮转的起始窗口分支不匹配');
 const window=branch.consequent.expression;
 if(window.consequent.consequent.type!=='AssignmentExpression'||window.consequent.consequent.operator!=='='||!sameIdentifier(ix,window.consequent.consequent.left,w)||!sameIdentifier(ix,window.consequent.consequent.right,v)||window.consequent.alternate.type!=='AssignmentExpression'||window.consequent.alternate.operator!=='='||!sameIdentifier(ix,window.consequent.alternate.left,outer.callee.params[4])||!sameIdentifier(ix,window.consequent.alternate.right,v)||window.alternate.type!=='AssignmentExpression'||window.alternate.operator!=='='||!sameIdentifier(ix,window.alternate.left,z)||!sameIdentifier(ix,window.alternate.right,v))fail('嵌套轮转的前两项缓存不匹配');
 const marker=branch.alternate.body[0];
 if(marker.type!=='IfStatement'||marker.test.type!=='BinaryExpression'||marker.test.operator!=='=='||!sameIdentifier(ix,marker.test.left,z)||marker.test.right.type!=='CallExpression'||marker.test.right.arguments.length!==2||marker.test.right.callee.type!=='MemberExpression'||property(marker.test.right.callee)!=='replace'||!sameIdentifier(ix,marker.test.right.callee.object,outer.callee.params[4])||marker.test.right.arguments[1].type!=='Literal'||marker.test.right.arguments[1].value!=='')fail('嵌套轮转的版本自检不匹配');
 const regexNode=marker.test.right.arguments[0];
 if(regexNode.type!=='Literal'||!regexNode.regex||regexNode.regex.flags!=='g')fail('嵌套轮转的版本自检正则不唯一');
 let regex;try{regex=new RegExp(regexNode.regex.pattern,regexNode.regex.flags);}catch{fail('嵌套轮转的版本自检正则无效');}
 if(marker.consequent.type!=='BlockStatement'||marker.consequent.body.length!==2)fail('嵌套轮转的匹配分支不匹配');
 const matched=marker.consequent.body[0];
 if(matched.type!=='IfStatement'||matched.test.type!=='BinaryExpression'||matched.test.operator!=='==='||!sameIdentifier(ix,matched.test.left,w)||!sameIdentifier(ix,matched.test.right,y)||matched.consequent.type!=='BlockStatement'||matched.consequent.body.length!==2)fail('嵌套轮转没有用数值校验和终止');
 const unshift=matched.consequent.body[0];
 if(unshift.type!=='ExpressionStatement'||unshift.expression.type!=='CallExpression'||unshift.expression.arguments.length!==1||!sameIdentifier(ix,unshift.expression.arguments[0],v)||unshift.expression.callee.type!=='MemberExpression'||!sameIdentifier(ix,unshift.expression.callee.object,tableAlias.id)||unshift.expression.callee.property.type!=='BinaryExpression'||unshift.expression.callee.property.operator!=='+'||unshift.expression.callee.property.left.type!=='Literal'||unshift.expression.callee.property.left.value!=='un'||!sameIdentifier(ix,unshift.expression.callee.property.right,shiftName))fail('嵌套轮转的匹配分支没有恢复单个元素');
 if(matched.consequent.body[1].type!=='BreakStatement'||matched.consequent.body[1].label)fail('嵌套轮转的匹配分支没有唯一终止');
 const pushed=marker.consequent.body[1];
 if(pushed.type!=='ExpressionStatement'||pushed.expression.type!=='CallExpression'||pushed.expression.arguments.length!==1||!sameIdentifier(ix,pushed.expression.arguments[0],v)||pushed.expression.callee.type!=='MemberExpression'||!sameIdentifier(ix,pushed.expression.callee.object,tableAlias.id)||pushed.expression.callee.property.type!=='Identifier')fail('嵌套轮转的未匹配分支没有回填本地表');
 const shiftMethod=validatorString(call.arguments[2],[setWord.right.value+'hs'],ix),pushMethod=validatorString(call.arguments[2],['hs'+setUnit.right.value],ix);
 if(shiftMethod!=='shift'||pushMethod!=='push'||!sameIdentifier(ix,shiftName,outer.callee.params[5])||!sameIdentifier(ix,pushed.expression.callee.property,outer.callee.params[6]))fail('嵌套轮转的方法名没有经过已审查的反转器');
 const allowedObjects=new Set([shiftValue.expression.right.callee.object,unshift.expression.callee.object,pushed.expression.callee.object]);
 if(tableBinding.refs.some(ref=>!allowedObjects.has(ref)))fail('嵌套轮转只允许操作本地表');
 const tree=ix.nodes[0];
 const statement=topStatement(outer,ix.parents,tree);
 rotationStatementShape(statement,outer,ix,decoder,tableFactory,decoderWrappers(ix,decoder));
 const factoryBinding=ix.bindings.get(tableFactory.id);
 if(factoryBinding.refs.some(ref=>!inside(ref,tableFactory)&&!inside(ref,decoder)&&!inside(ref,statement)))fail('字符串表工厂在轮转初始化之外仍被引用');
 return {call,inner,outer,statement,checksum,target,regex,factoryArg};
}
function collect(source,variant,only){
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree),{nodes,parents,bindings}=ix;
 const decoderHash=variant==='ks'?KS_DECODER:PDD_DECODER;
 const decoders=nodes.filter(n=>n.type==='FunctionDeclaration'&&(methodContract(n)===decoderHash||(variant==='ks'&&cachedDecoderShape(n,ix)))&&(!only||n.id?.name===only));
 if(decoders.length!==1)fail('已识别标记，但解码器语法数量不唯一');
 const decoder=decoders[0],decoderBinding=bindings.get(decoder.id);
 let tableBinding,tableFactory=null,values,offset=0,rotationCall,rotationFn,rotationStatement,rotationSteps=0,alphabet=null,shells=new Set();
 if(variant==='ks'){
  const first=decoder.body.body[0],factory=first?.type==='VariableDeclaration'&&first.declarations.length===1?first.declarations[0].init:null;
  tableFactory=factory?.type==='CallExpression'&&!factory.arguments.length&&functions.has(bindings.get(factory.callee)?.init?.type)?bindings.get(factory.callee).init:null;
  if(!tableFactory)fail('表工厂不符合已审查结构');
  tableBinding=bindings.get(tableFactory.id);values=tableFactoryValues(tableFactory,ix,source);
  const assignment=decoder.body.body[1]?.argument?.expressions?.[0];
  const inner=assignment?.type==='AssignmentExpression'?assignment.right:null,sub=inner?.type==='FunctionExpression'?inner.body.body[0]?.expression:null;
  if(sub?.type!=='AssignmentExpression'||sub.operator!=='='||sub.right.type!=='BinaryExpression'||sub.right.operator!=='-'||sub.right.left.type!=='Identifier')fail('解码器索引没有固定偏移');
  offset=number(sub.right.right);if(!Number.isInteger(offset))fail('解码器偏移不是常量');
  const roles=new Set([decoder.id.name,tableFactory.id.name]);
  const direct=nodes.filter(n=>n.type==='CallExpression'&&functions.has(n.callee.type)&&(methodContract(n.callee,roles)===KS_ROTATION||cachedRotationShape(n,ix,tableBinding)));
  const nested=[];
  for(const node of nodes){
   if(node.type!=='CallExpression'||!functions.has(node.callee.type)||node.arguments.length!==3||node.arguments[2]?.type!=='FunctionExpression')continue;
   const shape=nestedRotationShape(node,ix,tableFactory,decoder);
   if(shape)nested.push(shape);
  }
  if(direct.length+nested.length!==1)fail('字符串表轮转语法数量不唯一');
  alphabet=decoderAlphabet(decoder);
  // 共用同一表工厂的同形外壳（如 a0d 与 a0e）共享偏移与表，按解码器身份求值
  shells=new Set(nodes.filter(n=>n!==decoder&&functions.has(n.type)&&!n.async&&!n.generator&&cachedDecoderShape(n,ix)&&tableFactoryName(n,ix)===tableFactory?.id?.name));
  if(nested.length){
   const shape=nested[0];
   rotationCall=shape.call;rotationFn=shape.inner;rotationStatement=shape.statement;
   const rotated=rotateNested(shape,values,decoder,offset,ix,alphabet,shells);
   values=rotated.values;rotationSteps=rotated.steps;
  }else{
   rotationCall=direct[0];rotationFn=rotationCall.callee;
   if(rotationCall.arguments.length!==2||rotationCall.arguments[0].type!=='Identifier'||bindings.get(rotationCall.arguments[0])!==tableBinding)fail('轮转没有使用本地字符串表工厂');
   rotationStatement=topStatement(rotationCall,parents,tree);
   rotationSteps=rotateKS(rotationFn,rotationCall,values,decoder,offset,ix,source,alphabet,shells);
  }
 }else{
  if(!source.includes('jsjiami.com.v6'))fail('缺少 jsjiami v6 哨兵');
  const d=decoder.body.body.find(n=>n.type==='VariableDeclaration'&&n.declarations.some(x=>x.id.name==='_0x20ec07'))?.declarations.find(x=>x.id.name==='_0x20ec07');
  if(d?.init?.type!=='MemberExpression'||d.init.object.type!=='Identifier')fail('v6 表读取语法不匹配');
  tableBinding=bindings.get(d.init.object);
  const td=nodes.find(n=>n.type==='VariableDeclarator'&&bindings.get(n.id)===tableBinding);
  if(td?.init?.type!=='ArrayExpression')fail('v6 字符串表必须是静态数组');
  values=literalArray(td.init,ix,source);
  const matches=nodes.filter(n=>n.type==='CallExpression'&&functions.has(n.callee.type)&&methodContract(n.callee,new Set([decoder.id.name,tableBinding.name]))===PDD_ROTATION);
  if(matches.length!==1)fail('v6 轮转语法数量不唯一');
  rotationCall=matches[0];rotationFn=rotationCall.callee;
  if(rotationCall.arguments.length!==3||bindings.get(rotationCall.arguments[0])!==tableBinding||number(rotationCall.arguments[1])!==0x99||number(rotationCall.arguments[2])!==0x9900)fail('v6 版本轮转参数不匹配');
  rotationStatement=topStatement(rotationCall,parents,tree);
  rotationSteps=rotatePdd(rotationFn,values,ix,source);
 }
 if(values.length<3||values.length>LIMIT||values.some(v=>typeof v!=='string')||values.reduce((n,v)=>n+v.length,0)>1048576)fail('字符串表为空或超过静态边界');
 return {tree,ix,nodes,parents,bindings,decoder,decoderBinding,tableBinding,tableFactory,values,offset,rotationCall,rotationFn,rotationStatement,rotationSteps,variant,alphabet,shells};
}

// 只读诊断入口：验证嵌套 IIFE 轮转的结构与数值校验和，不展开业务调用，
// 也不检查自防御壳契约。用于定向回归，不改变正常转换路径的拒收条件。
export function inspectNestedRotation(source,only){
 const data=collect(source,'ks',only);
 return {factory:data.tableFactory?.id?.name??null,values:data.values,steps:data.rotationSteps};
}

// 只读诊断入口：统计缓存式解码器族中的内嵌自防御壳数量，供语料回归使用。
export function inspectCachedShellFamily(source){
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree);
 return ix.nodes.filter(node=>node.type==='FunctionDeclaration'&&cachedDecoderShape(node,ix)).map(decoder=>({
  decoder:decoder.id?.name??null,
  shells:shellSites(decoder,ix).length,
 })).filter(item=>item.shells);
}

function literalArray(array,ix,source){
 if(array.elements.length>LIMIT)fail('字符串表条目超过上限');
 return array.elements.map(e=>{
  if(e?.type==='Literal'&&typeof e.value==='string')return e.value;
  if(e?.type==='Identifier'){
   const init=ix.bindings.get(e)?.init;if(init?.type==='Literal'&&typeof init.value==='string')return init.value;
  }
  fail('字符串表包含非字面量项：'+source.slice(e?.start??0,e?.end??0));
 });
}

// 求值表工厂的唯一静态来源。表可以由数组字面量、无参 IIFE、无副作用的 concat、
// 静态展开或局部无参工厂调用构造；所有依赖绑定都必须本地、唯一初始化且没有外部写入。
function staticStringArray(node,ix,source,state){
 const {root,depth=0,aliases=new Set(),functionsSeen=new Set()}=state;
 if(depth>32)fail('字符串表构造层级过深');
 if(!node)fail('字符串表表达式缺失');
 if(node.type==='Literal'){
  if(typeof node.value!=='string')fail('字符串表包含非字符串项');
  return [node.value];
 }
 if(node.type==='Identifier'){
  const binding=ix.bindings.get(node);
  if(!binding||!binding.init||binding.writes.length||aliases.has(binding))fail('字符串表别名不是唯一的静态初始化');
  if(binding.init.start<root.start||binding.init.end>root.end)fail('字符串表别名必须在本条构造语句内初始化');
  aliases.add(binding);
  return staticStringArray(binding.init,ix,source,{root,depth:depth+1,aliases,functionsSeen});
 }
 if(node.type==='ArrayExpression'){
  const out=[];
  for(const element of node.elements){
   if(element?.type==='SpreadElement'){
    out.push(...staticStringArray(element.argument,ix,source,{root,depth:depth+1,aliases,functionsSeen}));
    if(out.length>LIMIT)fail('字符串表条目超过上限');
    continue;
   }
   if(element?.type==='Literal'&&typeof element.value==='string'){out.push(element.value);continue;}
   if(element?.type==='Identifier'){
    const binding=ix.bindings.get(element);
    if(binding?.init?.type==='Literal'&&typeof binding.init.value==='string'){out.push(binding.init.value);continue;}
   }
   fail('字符串表包含非字面量项：'+source.slice(element?.start??0,element?.end??0));
  }
  return out;
 }
 if(node.type==='CallExpression'){
  const callee=node.callee;
  if(callee.type==='MemberExpression'&&property(callee)==='concat'&&node.arguments.length){
   const out=staticStringArray(callee.object,ix,source,{root,depth:depth+1,aliases,functionsSeen});
   for(const argument of node.arguments){
    if(argument.type==='SpreadElement')fail('字符串表 concat 参数不能是动态展开');
    out.push(...staticStringArray(argument,ix,source,{root,depth:depth+1,aliases,functionsSeen}));
    if(out.length>LIMIT)fail('字符串表条目超过上限');
   }
   return out;
  }
  if(node.arguments.length)fail('字符串表工厂调用不能带参数');
  let fn=null;
  if(functions.has(callee.type))fn=callee;
  else if(callee.type==='Identifier'){
   const binding=ix.bindings.get(callee);
   if(!binding||binding.writes.length)fail('字符串表工厂不是唯一的本地函数');
   fn=binding.fn??binding.init;
   if(!functions.has(fn?.type)||functionsSeen.has(fn)||aliases.has(binding))fail('字符串表工厂不是唯一的本地函数');
   if(binding.refs.some(ref=>ref.start<root.start||ref.end>root.end))fail('字符串表工厂还被构造语句以外的代码引用');
   aliases.add(binding);functionsSeen.add(fn);
  }else fail('字符串表工厂不是唯一的本地函数');
  if(fn.async||fn.generator||fn.params.length)fail('字符串表工厂必须是无参同步函数');
  if(fn.body.type!=='BlockStatement')return staticStringArray(fn.body,ix,source,{root,depth:depth+1,aliases,functionsSeen});
  const statements=fn.body.body;
  if(statements.length!==1||statements[0].type!=='ReturnStatement')fail('字符串表工厂必须只返回一个静态表达式');
  return staticStringArray(statements[0].argument,ix,source,{root,depth:depth+1,aliases,functionsSeen});
 }
 fail('字符串表来源不是已审查的静态表达式');
}

// 证明表工厂只维护一份静态数组：首条声明来源，第二条把同一个工厂绑定缓存为
// 返回该数组的无参函数，第三条调用该绑定。工厂绑定只允许这一次自赋值，数组绑定
// 不得被外层读取，避免来源被替换或逃逸。
function tableFactoryValues(factory,ix,source){
 const body=factory?.body?.body;
 if(!Array.isArray(body)||body.length!==3)fail('表工厂不符合已审查结构');
 const [declaration,assignment,returned]=body;
 const tableDecl=declaration.type==='VariableDeclaration'&&declaration.declarations.length===1?declaration.declarations[0]:null;
 if(!tableDecl||tableDecl.id.type!=='Identifier')fail('表工厂必须声明唯一的字符串表');
 const factoryBinding=ix.bindings.get(factory.id),tableBinding=ix.bindings.get(tableDecl.id);
 if(!factoryBinding||!tableBinding||tableBinding.writes.length||tableBinding.refs.some(ref=>ref.start<factory.start||ref.end>factory.end))fail('表工厂的字符串表来源不唯一');
 const values=staticStringArray(tableDecl.init,ix,source,{root:tableDecl.init,depth:0});
 const set=assignment.type==='ExpressionStatement'?assignment.expression:null;
 if(set?.type!=='AssignmentExpression'||set.operator!=='='||set.left.type!=='Identifier'||ix.bindings.get(set.left)!==factoryBinding)fail('表工厂缓存赋值目标不匹配');
 if(factoryBinding.writes.length!==1||factoryBinding.writes[0]!==set)fail('表工厂只能自赋值一次');
 const cached=set.right;
 if(!functions.has(cached?.type)||cached.async||cached.generator||cached.params.length)fail('表工厂缓存值必须是无参同步函数');
 const cachedStatements=cached.body.type==='BlockStatement'?cached.body.body:null;
 if(!cachedStatements||cachedStatements.length!==1||cachedStatements[0].type!=='ReturnStatement'||cachedStatements[0].argument.type!=='Identifier'||ix.bindings.get(cachedStatements[0].argument)!==tableBinding)fail('表工厂缓存函数必须只返回字符串表');
 const call=returned.type==='ReturnStatement'?returned.argument:null;
 if(call?.type!=='CallExpression'||call.arguments.length||call.callee.type!=='Identifier'||ix.bindings.get(call.callee)!==factoryBinding)fail('表工厂返回值必须来自自身缓存');
 return values;
}

// 只读诊断入口：验证缓存式解码器能沿唯一静态来源求值出字符串表。它不折叠、
// 不执行输入函数，也不替代 collect 对轮转、自防御壳和业务引用的完整检查。
export function inspectCachedTableFactory(source,only){
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree);
 const decoders=ix.nodes.filter(n=>n.type==='FunctionDeclaration'&&(methodContract(n)===KS_DECODER||cachedDecoderShape(n,ix))&&(!only||n.id?.name===only));
 if(decoders.length!==1)fail('已识别标记，但解码器语法数量不唯一');
 const decoder=decoders[0],first=decoder.body.body[0],factory=first?.type==='VariableDeclaration'&&first.declarations.length===1?first.declarations[0].init:null;
 const tableFactory=factory?.type==='CallExpression'&&!factory.arguments.length&&functions.has(ix.bindings.get(factory.callee)?.init?.type)?ix.bindings.get(factory.callee).init:null;
 if(!tableFactory)fail('表工厂不符合已审查结构');
 return {factory:tableFactory.id?.name,values:tableFactoryValues(tableFactory,ix,source)};
}
function number(n,depth=0){
 if(depth>24)fail('常量算术过深');
 if(n?.type==='Literal'&&typeof n.value==='number'&&Number.isFinite(n.value))return n.value;
 if(n?.type==='UnaryExpression'&&['+','-','~'].includes(n.operator)){const v=number(n.argument,depth+1);return n.operator==='+'?+v:n.operator==='-'?-v:~v;}
 if(n?.type==='BinaryExpression'&&['+','-','*','/','%','>>','>>>','<<','|','&','^'].includes(n.operator)){const a=number(n.left,depth+1),b=number(n.right,depth+1);return ({'+':()=>a+b,'-':()=>a-b,'*':()=>a*b,'/':()=>a/b,'%':()=>a%b,'>>':()=>a>>b,'>>>':()=>a>>>b,'<<':()=>a<<b,'|':()=>a|b,'&':()=>a&b,'^':()=>a^b})[n.operator]();}
 fail('表达式包含非静态数字运算');
}
function topStatement(n,parents,tree){let child=n,p=parents.get(n);while(p&&p!==tree){child=p;p=parents.get(child);}return p===tree?child:null;}

function rotateKS(fn,call,values,decoder,offset,ix,source,alphabet,shells){
 const target=number(call.arguments[1]),loop=ix.nodes.find(n=>n.type==='TryStatement'&&n.start>=fn.start&&n.end<=fn.end),checksum=loop?.block.body[0]?.declarations?.[0]?.init;
 if(!Number.isFinite(target)||!checksum||!ix.nodes.some(n=>n.type==='WhileStatement'&&n.start>=fn.start&&n.end<=fn.end))fail('js-obfuscator 校验循环不匹配');
 const wrappers=decoderWrappers(ix,decoder);
 // 轮转校验和可能经由同族外壳或本地别名调用解码器，先把外壳并入可解析集合
 if(shells)for(const shell of shells)wrappers.add(shell);
 for(let i=0;i<values.length;i++){
  try{const checksumValue=evaluate(checksum,new Map(),{ix,values,offset,decoder,wrappers,variant:'ks',alphabet,shells});if(checksumValue===target)return i;}
  catch{}
  values.push(values.shift());
 }
 fail('js-obfuscator 轮转校验在一轮内没有匹配');
}

// 嵌套 IIFE 轮转按原循环语义先去表头两条哨兵，再在密文项上逐轮左移并复算
// 校验和。结构判据已证明循环只有这一条终止路径；这里仍要求数值匹配唯一。
function rotateNested(shape,values,decoder,offset,ix,alphabet,shells){
 const version=values[0],marker=values[1];
 if(typeof version!=='string'||!/^jsjiami\.(?:com|cn)\.v7$/.test(version))fail('字符串表版本哨兵不匹配');
 if(typeof marker!=='string'||marker.replace(shape.regex,'')!==version)fail('字符串表版本自检不匹配');
 const cipher=values.slice(2);
 if(cipher.length<1)fail('字符串表轮转没有可证明的密文项');
 const wrappers=decoderWrappers(ix,decoder);
 if(shells)for(const shell of shells)wrappers.add(shell);
 const matches=[];
 for(let r=0;r<cipher.length;r++){
  const rotated=cipher.slice(r).concat(cipher.slice(0,r));
  try{
   const value=evaluate(shape.checksum,new Map(),{ix,values:rotated,offset,decoder,wrappers,variant:'ks',alphabet,shells});
   if(value===shape.target)matches.push(r);
  }catch{}
 }
 if(!matches.length)fail('js-obfuscator 轮转校验在一轮内没有匹配');
 if(matches.length!==1)fail('轮转校验和存在多个静态匹配，结果不唯一');
 const steps=matches[0];
 return {values:cipher.slice(steps).concat(cipher.slice(0,steps)),steps};
}

function rotatePdd(fn,values,ix,source){
 const marker=values.find(v=>v==='jsjiami.com.v6');if(!marker)fail('v6 表版本哨兵缺失');
 const check=[...marker].reduce((n,c)=>n+c.charCodeAt(0),0);
 if((check^(-marker.length))!==-0x524)fail('v6 表版本校验不匹配');
 const methods=ix.nodes.filter(n=>n.type==='Property'&&key(n)==='removeCookie'&&n.value?.type==='FunctionExpression');
 const remove=methods.find(p=>{const f=p.value;return f.body.body.length===1&&f.body.body[0].type==='ReturnStatement'&&f.body.body[0].argument.type==='Literal'&&f.body.body[0].argument.value==='dev';});
 if(!remove)fail('v6 自防御源代码校验目标缺失');
 const regexNode=ix.nodes.find(n=>n.type==='NewExpression'&&n.callee.name==='RegExp'&&n.arguments[0]?.type==='Literal'&&n.arguments[0].value.includes('\\w+'));
 if(!regexNode||!new RegExp(regexNode.arguments[0].value).test(source.slice(remove.value.start,remove.value.end)))fail('v6 自防御格式检查没有通过');
 const loop=ix.nodes.find(n=>n.type==='WhileStatement'&&n.start>=fn.start&&n.end<=fn.end);
 if(!loop||values.length<160)fail('v6 有界轮转循环不匹配');
 // The reviewed v6 helper starts at count=arg1+1 and compares the shifted
 // count with arg2>>8. Its marker branch initializes the final-element check.
 const first=number(fn.params[1]&&{type:'Literal',value:0x99})+1,target=0x9900>>8;
 if(first!==0x9a||target!==0x99)fail('v6 轮转计数不匹配');
 const regex=/[PkTnkfThOSgPzdCJ=]/g;let targetString,checkString,count=first;
 for(let i=0;i<first-1;i++){
  count--;
  const shifted=values.shift();
  if(target===count){targetString=shifted;checkString=values.pop();}
  else if(targetString&&checkString?.replace(regex,'')===targetString){values.push(shifted);}
  else fail('v6 轮转校验没有保持静态数组长度');
 }
 values.push(values.shift());
 if(values.length===0)fail('v6 轮转产生了空表');
 return first;
}

function functionFor(n,ix){
 if(functions.has(n?.type))return n;
 if(n?.type==='Identifier'){const b=ix.bindings.get(n);return b?.fn??b?.init??null;}
 if(n?.type==='MemberExpression'){
  const object=n.object?.type==='ObjectExpression'?n.object:ix.bindings.get(n.object)?.init;
  const p=object?.properties?.find(p=>p.type==='Property'&&String(key(p))===String(property(n)));
  return p?.value&&functions.has(p.value.type)?p.value:null;
 }
 return null;
}
// 从已审查解码器内部读取 base64 字母表：混淆器会打乱字母表顺序，
// 硬编码会导致解码值与轮转校验和整体错位。字母表必须唯一。
function decoderAlphabet(decoder){
 const found=[];
 (function walk(n){
  if(!n||typeof n!=='object')return;
  if(Array.isArray(n)){n.forEach(walk);return;}
  if(n.type==='Literal'&&typeof n.value==='string'&&n.value.length===65&&/^[A-Za-z0-9+/=]{65}$/.test(n.value))found.push(n.value);
  for(const k of Object.keys(n)){if(['type','start','end'].includes(k))continue;const v=n[k];if(v&&typeof v==='object')walk(v);}
 })(decoder);
 if(!found.length)return null;
 if(found.some(a=>a!==found[0]))fail('解码器内部字母表不唯一');
 return found[0];
}

// 缓存式解码器内嵌的自防御壳只维护实例状态，并在格式自检为真时走固定返回 -1
// 的短路分支。这里逐项校验随机键名归一化后的结构契约，不执行输入函数；壳内部
// 仍以同一套 AST 角色关联，因此改键名、换局部变量名不会放宽，改变语义则拒绝。
const CACHED_SHELL_GLOBALS=new Set(['RegExp','Boolean','Math']);
const CACHED_SHELL_REGEX_A='\\w+ *\\(\\) *{\\w+ *';
const CACHED_SHELL_REGEX_B='[\'|"].+[\'|"];? *}';
const insideNode=(node,range)=>!!node&&!!range&&node.start>=range.start&&node.end<=range.end;
const sameNodeBinding=(ix,left,right)=>left?.type==='Identifier'&&right?.type==='Identifier'&&ix.bindings.get(left)&&ix.bindings.get(left)===ix.bindings.get(right);
const memberKey=node=>node?.type==='MemberExpression'?property(node):undefined;
const thisKey=(node,key)=>node?.type==='MemberExpression'&&node.object.type==='ThisExpression'&&memberKey(node)===key;
function literalSample(fn){
 if(fn?.type!=='FunctionExpression'||fn.async||fn.generator||fn.params.length||fn.body.type!=='BlockStatement'||fn.body.body.length!==1)return false;
 const statement=fn.body.body[0];
 return statement.type==='ReturnStatement'&&statement.argument?.type==='Literal'&&typeof statement.argument.value==='string';
}
function shellConstructorRoles(fn,ix){
 if(fn?.type!=='FunctionExpression'||fn.async||fn.generator||fn.params.length!==1||fn.params[0].type!=='Identifier')fail('缓存式自防御壳构造器结构不匹配');
 const body=fn.body?.body;
 if(body?.length!==1||body[0].type!=='ExpressionStatement'||body[0].expression.type!=='SequenceExpression'||body[0].expression.expressions.length!==5)fail('缓存式自防御壳构造器结构不匹配');
 const param=ix.bindings.get(fn.params[0]),roles={},keys=new Set();
 for(const assignment of body[0].expression.expressions){
  if(assignment.type!=='AssignmentExpression'||assignment.operator!=='='||assignment.left.type!=='MemberExpression'||assignment.left.object.type!=='ThisExpression')fail('缓存式自防御壳构造器结构不匹配');
  const keyName=memberKey(assignment.left);
  if(typeof keyName!=='string'||keys.has(keyName))fail('缓存式自防御壳构造器键名不唯一');
  keys.add(keyName);
  const right=assignment.right;
  if(right.type==='Identifier'&&ix.bindings.get(right)===param)roles.externalKey=keyName;
  else if(right.type==='ArrayExpression'&&right.elements.length===3&&right.elements.every((item,index)=>item?.type==='Literal'&&item.value===[1,0,0][index]))roles.stateKey=keyName;
  else if(literalSample(right)){roles.sampleKey=keyName;roles.sample=right;}
  else if(right.type==='Literal'&&typeof right.value==='string'){
   if(roles.regexAKey===undefined){roles.regexAKey=keyName;roles.regexAValue=right.value;}
   else if(roles.regexBKey===undefined){roles.regexBKey=keyName;roles.regexBValue=right.value;}
   else fail('缓存式自防御壳构造器结构不匹配');
  }
  else fail('缓存式自防御壳构造器结构不匹配');
 }
 return roles.externalKey&&roles.stateKey&&roles.sampleKey&&roles.regexAKey&&roles.regexBKey?roles:null;
}
function shellMethods(shellBinding,decoder,ix){
 return ix.nodes.filter(node=>node.type==='AssignmentExpression'&&node.operator==='='&&node.left.type==='MemberExpression'&&node.left.object.type==='MemberExpression'&&property(node.left.object)==='prototype'&&node.left.object.object.type==='Identifier'&&ix.bindings.get(node.left.object.object)===shellBinding&&insideNode(node,decoder)&&typeof memberKey(node.left)==='string'&&node.right?.type==='FunctionExpression');
}
function checkerMethod(fn,roles,ix){
 const body=fn.body?.body;
 if(fn.async||fn.generator||fn.params.length||body?.length!==2)return null;
 const declaration=body[0],returned=body[1];
 if(declaration.type!=='VariableDeclaration'||declaration.declarations.length!==2||returned.type!=='ReturnStatement')return null;
 const [regexDeclaration,resultDeclaration]=declaration.declarations;
 if(regexDeclaration.id.type!=='Identifier'||resultDeclaration.id.type!=='Identifier'||!regexDeclaration.init||!resultDeclaration.init)return null;
 const regex=regexDeclaration.init;
 if(regex.type!=='NewExpression'||regex.callee.type!=='Identifier'||!ix.free(regex.callee,'RegExp')||regex.arguments.length!==1)return null;
 const source=regex.arguments[0];
 if(source?.type!=='BinaryExpression'||source.operator!=='+'||!thisKey(source.left,roles.regexAKey)||!thisKey(source.right,roles.regexBKey))return null;
 const selected=resultDeclaration.init;
 if(selected.type!=='ConditionalExpression')return null;
 const test=selected.test;
 if(test?.type!=='CallExpression'||test.arguments.length!==1||test.callee.type!=='MemberExpression'||memberKey(test.callee)!=='test'||!sameNodeBinding(ix,test.callee.object,regexDeclaration.id))return null;
 const tested=test.arguments[0];
 if(tested?.type!=='CallExpression'||tested.arguments.length||tested.callee.type!=='MemberExpression'||memberKey(tested.callee)!=='toString'||!thisKey(tested.callee.object,roles.sampleKey))return null;
 const decrement=(node,index)=>node?.type==='UpdateExpression'&&node.operator==='--'&&node.prefix&&node.argument.type==='MemberExpression'&&thisKey(node.argument.object,roles.stateKey)&&memberKey(node.argument)===index;
 if(!decrement(selected.consequent,1)||!decrement(selected.alternate,0))return null;
 const next=returned.argument;
 if(next?.type!=='CallExpression'||next.arguments.length!==1||next.callee.type!=='MemberExpression'||next.callee.object.type!=='ThisExpression'||typeof memberKey(next.callee)!=='string'||!sameNodeBinding(ix,next.arguments[0],resultDeclaration.id))return null;
 return {helperKey:memberKey(next.callee)};
}
function helperMethod(fn,roles,ix){
 const body=fn.body?.body;
 if(fn.async||fn.generator||fn.params.length!==1||fn.params[0].type!=='Identifier'||body?.length!==2)return null;
 const [guard,returned]=body,param=ix.bindings.get(fn.params[0]);
 if(guard.type!=='IfStatement'||guard.alternate)return null;
 const test=guard.test;
 if(test?.type!=='UnaryExpression'||test.operator!=='!'||test.argument.type!=='CallExpression'||test.argument.arguments.length!==1||test.argument.callee.type!=='Identifier'||!ix.free(test.argument.callee,'Boolean'))return null;
 const inverted=test.argument.arguments[0];
 if(inverted?.type!=='UnaryExpression'||inverted.operator!=='~'||inverted.argument.type!=='Identifier'||ix.bindings.get(inverted.argument)!==param)return null;
 if(guard.consequent.type!=='ReturnStatement'||!sameNodeBinding(ix,guard.consequent.argument,fn.params[0]))return null;
 const next=returned.type==='ReturnStatement'?returned.argument:null;
 if(next?.type!=='CallExpression'||next.arguments.length!==1||next.callee.type!=='MemberExpression'||next.callee.object.type!=='ThisExpression'||typeof memberKey(next.callee)!=='string'||!thisKey(next.arguments[0],roles.externalKey))return null;
 return {recursiveKey:memberKey(next.callee)};
}
function recursiveMethod(fn,roles,ix){
 const body=fn.body?.body;
 if(fn.async||fn.generator||fn.params.length!==1||fn.params[0].type!=='Identifier'||body?.length!==2)return null;
 const [loop,returned]=body,param=ix.bindings.get(fn.params[0]);
 if(loop.type!=='ForStatement'||loop.init?.type!=='VariableDeclaration'||loop.init.declarations.length!==2||!loop.test||!loop.update||loop.body.type!=='BlockStatement'||loop.body.body.length!==1)return null;
 const [counter,length]=loop.init.declarations;
 if(counter.id.type!=='Identifier'||counter.init?.type!=='Literal'||counter.init.value!==0||length.id.type!=='Identifier')return null;
 const lengthRead=length.init;
 if(lengthRead?.type!=='MemberExpression'||memberKey(lengthRead)!=='length'||!thisKey(lengthRead.object,roles.stateKey))return null;
 if(loop.test.type!=='BinaryExpression'||loop.test.operator!=='<'||!sameNodeBinding(ix,loop.test.left,counter.id)||!sameNodeBinding(ix,loop.test.right,length.id))return null;
 if(loop.update.type!=='UpdateExpression'||loop.update.operator!=='++'||!sameNodeBinding(ix,loop.update.argument,counter.id))return null;
 const mutations=loop.body.body[0];
 if(mutations.type!=='ExpressionStatement'||mutations.expression.type!=='SequenceExpression'||mutations.expression.expressions.length!==2)return null;
 const [push,refresh]=mutations.expression.expressions;
 if(push.type!=='CallExpression'||push.arguments.length!==1||push.callee.type!=='MemberExpression'||memberKey(push.callee)!=='push'||!thisKey(push.callee.object,roles.stateKey))return null;
 const rounded=push.arguments[0];
 if(rounded.type!=='CallExpression'||rounded.arguments.length!==1||rounded.callee.type!=='MemberExpression'||memberKey(rounded.callee)!=='round'||rounded.callee.object.type!=='Identifier'||!ix.free(rounded.callee.object,'Math'))return null;
 const random=rounded.arguments[0];
 if(random.type!=='CallExpression'||random.arguments.length||random.callee.type!=='MemberExpression'||memberKey(random.callee)!=='random'||random.callee.object.type!=='Identifier'||!ix.free(random.callee.object,'Math'))return null;
 if(refresh.type!=='AssignmentExpression'||refresh.operator!=='='||!sameNodeBinding(ix,refresh.left,length.id)||refresh.right?.type!=='MemberExpression'||memberKey(refresh.right)!=='length'||!thisKey(refresh.right.object,roles.stateKey))return null;
 const next=returned.type==='ReturnStatement'?returned.argument:null;
 if(next?.type!=='CallExpression'||next.arguments.length!==1||next.callee.type!=='Identifier'||ix.bindings.get(next.callee)!==param)return null;
 const value=next.arguments[0];
 if(value?.type!=='MemberExpression'||memberKey(value)!==0||!thisKey(value.object,roles.stateKey))return null;
 return true;
}
function shellSites(decoder,ix){
 const sites=[];
 for(const construct of ix.nodes){
  if(construct.type!=='NewExpression'||construct.callee.type!=='Identifier'||!insideNode(construct,decoder))continue;
  const binding=ix.bindings.get(construct.callee);
  if(!binding?.init||binding.init.type!=='FunctionExpression')continue;
  const methods=shellMethods(binding,decoder,ix);
  if(methods.length)sites.push({binding,methods});
 }
 return sites;
}
function discardedValue(node,ix){
 const parent=ix.parents.get(node);
 if(parent?.type==='ExpressionStatement'&&parent.expression===node)return true;
 if(parent?.type!=='SequenceExpression')return false;
 return parent.expressions[parent.expressions.length-1]!==node||discardedValue(parent,ix);
}
function proveShellWrites(ranges,ix,shellBinding){
 const local=new Set();
 for(const n of ix.nodes){
  if(!ranges.some(range=>insideNode(n,range)))continue;
  if(functions.has(n.type)&&n.params)for(const param of n.params)if(param.type==='Identifier')local.add(ix.bindings.get(param));
  if(n.type==='VariableDeclarator'&&n.id.type==='Identifier')local.add(ix.bindings.get(n.id));
  if(n.type==='FunctionDeclaration'&&n.id)local.add(ix.bindings.get(n.id));
 }
 const rootOf=node=>{let root=node;while(root?.type==='MemberExpression')root=root.object;return root;};
 const inspectWrite=target=>{
  const root=rootOf(target);
  if(root?.type==='ThisExpression')return;
  if(root?.type!=='Identifier')fail('缓存式自防御壳写入了外部绑定');
  const binding=ix.bindings.get(root);
  if(!binding)fail('缓存式自防御壳写入了自由绑定');
  if(binding===shellBinding)return;
  if(!local.has(binding))fail('缓存式自防御壳写入了外部绑定');
 };
 for(const n of ix.nodes){
  if(!ranges.some(range=>insideNode(n,range)))continue;
  if(n.type==='AssignmentExpression')inspectWrite(n.left);
  else if(n.type==='UpdateExpression')inspectWrite(n.argument);
  else if(['ForInStatement','ForOfStatement'].includes(n.type)&&n.left.type!=='VariableDeclaration')inspectWrite(n.left);
 }
}
function proveShellGlobals(ranges,ix){
 const free=new Set(),declared=new Set();
 for(const n of ix.nodes){
  if(!ranges.some(range=>insideNode(n,range)))continue;
  if(n.type==='Identifier'&&ix.free(n))free.add(n.name);
  if(n.type==='Identifier'&&CACHED_SHELL_GLOBALS.has(n.name)&&!ix.free(n))fail('缓存式自防御壳遮蔽了自由全局：'+n.name);
  if(n.type==='VariableDeclarator'&&n.id.type==='Identifier')declared.add(n.id.name);
  if(functions.has(n.type)&&n.params)for(const param of n.params)if(param.type==='Identifier')declared.add(param.name);
  if(n.type==='FunctionDeclaration'&&n.id)declared.add(n.id.name);
 }
 for(const name of free)if(!CACHED_SHELL_GLOBALS.has(name))fail('缓存式自防御壳使用了未审查的自由全局：'+name);
 for(const name of CACHED_SHELL_GLOBALS)if(declared.has(name))fail('缓存式自防御壳重复声明了自由全局：'+name);
 for(const n of ix.nodes){
  if(!ranges.some(range=>insideNode(n,range)))continue;
  const target=n.type==='AssignmentExpression'?n.left:n.type==='UpdateExpression'?n.argument:null;
  let root=target;while(root?.type==='MemberExpression')root=root.object;
  if(root?.type==='Identifier'&&(!ix.bindings.get(root)||CACHED_SHELL_GLOBALS.has(root.name)))fail('缓存式自防御壳写入了自由全局：'+root.name);
 }
}
function proveEmbeddedShells(decoder,site,source,ix){
 if(site.methods.length!==3)fail('缓存式自防御壳方法数量不匹配');
 const constructorRange=site.binding.init,methodRanges=site.methods.map(node=>node.right);
 proveShellGlobals([constructorRange,...methodRanges],ix);
 proveShellWrites([constructorRange,...methodRanges],ix,site.binding);
 const roles=shellConstructorRoles(site.binding.init,ix);
 if(!roles)fail('缓存式自防御壳构造器结构不匹配');
 if(roles.regexAValue!==CACHED_SHELL_REGEX_A||roles.regexBValue!==CACHED_SHELL_REGEX_B)fail('缓存式自防御壳的格式自检正则被改动');
 const methods=site.methods.map(node=>({key:memberKey(node.left),fn:node.right}));
 if(new Set(methods.map(method=>method.key)).size!==3)fail('缓存式自防御壳方法键名重复');
 const checkers=methods.filter(method=>checkerMethod(method.fn,roles,ix));
 if(checkers.length!==1)fail('缓存式自防御壳缺少唯一的格式自检方法');
 const checker=checkers[0],checkerProof=checkerMethod(checker.fn,roles,ix);
 const helpers=methods.filter(method=>helperMethod(method.fn,roles,ix));
 if(helpers.length!==1||helpers[0].key!==checkerProof.helperKey)fail('缓存式自防御壳的短路辅助方法不匹配');
 const helperProof=helperMethod(helpers[0].fn,roles,ix);
 const recursives=methods.filter(method=>recursiveMethod(method.fn,roles,ix));
 if(recursives.length!==1||recursives[0].key!==helperProof.recursiveKey)fail('缓存式自防御壳的失败路径方法不匹配');
 if(new Set([checker.key,helpers[0].key,recursives[0].key]).size!==3)fail('缓存式自防御壳方法角色不唯一');
 const constructed=ix.nodes.filter(node=>node.type==='NewExpression'&&node.callee.type==='Identifier'&&ix.bindings.get(node.callee)===site.binding&&insideNode(node,decoder));
 if(constructed.length!==1)fail('缓存式自防御壳调用数量不一致');
 const instance=constructed[0];
 if(instance.arguments.length!==1||!sameNodeBinding(ix,instance.arguments[0],decoder.id))fail('缓存式自防御壳的解码器参数不匹配');
 const member=ix.parents.get(instance),call=member&&ix.parents.get(member);
 if(member?.type!=='MemberExpression'||member.object!==instance||call?.type!=='CallExpression'||call.callee!==member||call.arguments.length||memberKey(member)!==checker.key)fail('缓存式自防御壳自检调用结构不匹配');
 if(!discardedValue(call,ix))fail('缓存式自防御壳的自检结果没有被丢弃');
 const format=new RegExp(CACHED_SHELL_REGEX_A+CACHED_SHELL_REGEX_B);
 if(!format.test(source.slice(roles.sample.start,roles.sample.end)))fail('缓存式自防御壳的格式自检正则没有通过，失败路径可达');
 // 初始状态为 [1,0,0]；正则命中时走 state[1] 前置自减，辅助方法对 -1 直接短路。
 const safeValue=[1,0,0][1]-1;
 if(safeValue!==-1||!(!Boolean(~safeValue)))fail('缓存式自防御壳的安全路径没有返回 -1');
}
function proveEmbeddedShellFamily(decoders,source,ix){
 let total=0;const sitesByDecoder=new Map();
 for(const decoder of decoders){
  const sites=shellSites(decoder,ix);
  if(sites.length>1)fail('缓存式自防御壳的外壳数量不一致');
  if(sites.length){total+=sites.length;sitesByDecoder.set(decoder,sites[0]);}
 }
 if(!total)return false;
 if(total!==decoders.length)fail('缓存式自防御壳的外壳数量不一致');
 for(const decoder of decoders)proveEmbeddedShells(decoder,sitesByDecoder.get(decoder),source,ix);
 return true;
}
// 解析调用目标：允许沿本地别名（var aD=a0e / var aQ=a0d）解析到已确认的解码器或外壳，
// 别名链最多 16 跳且必须无写入、无环；不在已确认集合内的目标一律返回 null，交由调用方拒绝。
function resolveCallable(callee,ix,wrappers){
 let fn=functionFor(callee,ix);const seen=new Set();
 const initial=callee.type==='Identifier'?ix.bindings.get(callee):null;
 if(fn?.type==='Identifier'&&initial?.writes.length&&!functions.has((initial.fn??initial.init)?.type))return null;
 for(let hop=0;hop<16;hop++){
  if(!fn)return null;
  if(fn.type!=='Identifier')break;
  const binding=ix.bindings.get(fn);
  if(!binding||binding.writes.length&&!functions.has((binding.fn??binding.init)?.type)||seen.has(fn))return null;
  seen.add(fn);
  const next=functionFor(fn,ix);
  if(!next||next===fn)return null;
  fn=next;
  if(hop===15&&fn.type==='Identifier')return null;
 }
 return fn&&wrappers.has(fn)?fn:null;
}
function decoderWrappers(ix,decoder){
 const known=new Set([decoder]);let changed=true;
 while(changed){changed=false;for(const fn of ix.nodes.filter(n=>functions.has(n.type))){
  if(known.has(fn)||fn.async||fn.generator)continue;
  const returned=fn.body.type==='BlockStatement'&&fn.body.body.length===1&&fn.body.body[0].type==='ReturnStatement'?fn.body.body[0].argument:fn.body.type==='BlockStatement'?null:fn.body;
  if(!returned)continue;
  let has=false,valid=true;
  for(const n of ix.nodes){
   if(n.start<returned.start||n.end>returned.end)continue;
   if(n.type==='CallExpression'){
    const callee=functionFor(n.callee,ix);
    if(callee&&known.has(callee))has=true;
    else if(!(n.callee.type==='Identifier'&&ix.free(n.callee,'parseInt')))valid=false;
   }
   if(['AssignmentExpression','UpdateExpression','AwaitExpression','YieldExpression','NewExpression','ThisExpression','Super'].includes(n.type))valid=false;
  }
  if(has&&valid){known.add(fn);changed=true;}
 }}
 return known;
}

function evaluate(n,env,ctx,depth=0){
 if(depth>32)throw Error('decoder call depth exceeded');const {ix,values,offset,decoder,wrappers,variant}=ctx;
 if(!n)throw Error('missing expression');
 if(n.type==='Literal')return n.value;
 if(n.type==='Identifier'){
  const b=ix.bindings.get(n);if(env.has(b))return env.get(b);
  if(ix.free(n,'undefined'))return undefined;
  const fn=b?.fn??b?.init;if(fn&&wrappers.has(fn))return fn;
  // 轮转语句内常见 var aD=a0e 形式的本地别名：沿一层别名解析到已确认的解码器/包装器
  if(fn?.type==='Identifier'){const target=functionFor(fn,ix);if(target&&wrappers.has(target))return target;}
  if(b?.init?.type==='Literal')return b.init.value;
  throw Error('unknown identifier '+n.name);
 }
 if(n.type==='UnaryExpression'){
  const v=evaluate(n.argument,env,ctx,depth+1);
  if(n.operator==='-')return -v;if(n.operator==='+')return +v;if(n.operator==='~')return ~v;if(n.operator==='!')return !v;if(n.operator==='void')return undefined;
 }
 if(n.type==='BinaryExpression'){
  const a=evaluate(n.left,env,ctx,depth+1),b=evaluate(n.right,env,ctx,depth+1);
  const ops={'+':()=>a+b,'-':()=>a-b,'*':()=>a*b,'/':()=>a/b,'%':()=>a%b,'>>':()=>a>>b,'>>>':()=>a>>>b,'<<':()=>a<<b,'|':()=>a|b,'&':()=>a&b,'^':()=>a^b,'===':()=>a===b,'==':()=>a==b,'!==':()=>a!==b,'!=':()=>a!=b,'<':()=>a<b,'>':()=>a>b};
  if(ops[n.operator])return ops[n.operator]();
 }
 if(n.type==='CallExpression'){
  if(n.callee.type==='Identifier'&&ix.free(n.callee,'parseInt'))return Number.parseInt(evaluate(n.arguments[0],env,ctx,depth+1),n.arguments[1]?evaluate(n.arguments[1],env,ctx,depth+1):undefined);
  const fn=resolveCallable(n.callee,ix,wrappers);if(!fn)throw Error('unreviewed call');
  const callArgs=n.arguments.map(a=>evaluate(a,env,ctx,depth+1));
  if(fn===decoder||(ctx.shells&&ctx.shells.has(fn))){
   let index;
   if(variant==='ks')index=Number(callArgs[0])-offset;
  else{const raw=callArgs[0],marker=typeof raw==='string'?raw.charCodeAt(0):0;if(typeof raw!=='string'||marker<0x202a||marker>0x202e||!/^[0-9a-f]+$/i.test(raw.slice(1)))throw Error('v6 lookup index is not a bidi-prefixed hex literal');index=Number.parseInt('0x'+raw.slice(1));}
   if(!Number.isInteger(index)||index<0||index>=values.length)throw Error('lookup outside rotated table');
   const ksAlphabet=variant==='ks'?(ctx.alphabet||'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/='):'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
   // 无密钥调用走 Base64 还原；有密钥时按既有 RC4 路径
   if(variant==='ks'&&(callArgs[1]===undefined||callArgs[1]===null))return decodeBase64Alphabet(values[index],ksAlphabet);
   return decodeRC4(values[index],callArgs[1],ksAlphabet,variant==='pdd');
  }
  const returned=fn.body.type==='BlockStatement'?fn.body.body[0]?.argument:fn.body;
  if(fn.params.length!==callArgs.length)throw Error('wrapper arity differs');
  const local=new Map(env);fn.params.forEach((p,i)=>{if(p.type!=='Identifier')throw Error('wrapper parameter is not an identifier');local.set(ix.bindings.get(p),callArgs[i]);});
  return evaluate(returned,local,ctx,depth+1);
 }
 throw Error('unreviewed expression '+n.type);
}

// 收集可识别的解码器候选：哈希契约与结构识别并列，仅用于收敛，不产生信任。
function decoderCandidates(source){
 const scan=index(parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}));
 const seen=new Set(),out=[];
 for(const n of scan.nodes){
  if(n.type!=='FunctionDeclaration')continue;
  if(methodContract(n)!==KS_DECODER&&!cachedDecoderShape(n,scan))continue;
  // 共用同一张表工厂的外壳属于同一个解码器族，只取首个作为族代表，避免重复折叠
  const factory=tableFactoryName(n,scan),id=factory??n.id?.name;
  if(!id||seen.has(id))continue;
  seen.add(id);
  out.push({name:n.id?.name,key:id});
 }
 return out;
}
function tableFactoryName(fn,ix){
 const first=fn.body?.body?.[0];
 if(first?.type!=='VariableDeclaration'||first.declarations.length!==1)return null;
 const init=first.declarations[0].init;
 return init?.type==='CallExpression'&&init.callee.type==='Identifier'?init.callee.name:null;
}
const MAX_DECODERS=8;
// 多解码器族：逐族折叠，每次重新解析；任一族校验失败即整体拒绝，不做部分折叠。
export function lowerObfuscatedTables(source){
 let current=source,transformations=[];
 const done=new Set();
 for(let guard=0;guard<=MAX_DECODERS;guard++){
  // 已处理的解码器族（按表工厂去重）不再重复折叠，避免同表外壳被二次当成新族
  const candidates=decoderCandidates(current).filter(c=>!done.has(c.key));
  if(!candidates.length)break;
  if(guard===MAX_DECODERS)fail('解码器族数量超过静态上限');
  done.add(candidates[0].key);
  const result=foldObfuscatedTables(current,candidates[0].name);
  transformations.push(...result.transformations);
  if(!result.transformations.length)break;
  current=result.source;
 }
 return {source:current,transformations};
}
function foldObfuscatedTables(source,only){
 const initial=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),scan=index(initial);
 const ks=scan.nodes.some(n=>n.type==='FunctionDeclaration'&&(methodContract(n)===KS_DECODER||cachedDecoderShape(n,scan))),pdd=source.includes('jsjiami.com.v6');
 if(!ks&&!pdd)return {source,transformations:[]};
 if(ks&&pdd)fail('一个文件包含多个不兼容的表格式');
 const data=collect(source,ks?'ks':'pdd',only),{tree,ix,nodes,parents,bindings,decoder,decoderBinding,tableBinding,tableFactory,values,offset,rotationStatement,rotationSteps,variant}=data;
 const wrappers=decoderWrappers(ix,decoder),replace=new Map(),removed=new WeakSet(),removedRanges=[];
 const alphabet=data.alphabet,shells=data.shells;
 let family=[decoder];
 // 共用同一表工厂的同形外壳共享解码器身份：并入 wrapper 集合，保证轮转校验和经由任一外壳都能静态求值
 const factoryName=tableFactoryName(decoder,ix);
 for(const fn of nodes){
  if(fn===decoder||!functions.has(fn.type)||fn.async||fn.generator)continue;
  if(!cachedDecoderShape(fn,ix)||tableFactoryName(fn,ix)!==factoryName)continue;
  wrappers.add(fn);
 }
 const isRemoved=n=>removedRanges.some(r=>n.start>=r.start&&n.end<=r.end);
 for(const n of nodes){
  if(n.type!=='CallExpression')continue;const fn=resolveCallable(n.callee,ix,wrappers);if(!fn)continue;
  try{const value=evaluate(n,new Map(),{ix,values,offset,decoder,wrappers,variant,alphabet,shells});if(typeof value==='string')replace.set(n,JSON.stringify(value));}
  catch(error){if(fn===decoder||wrappers.has(fn)){
    const inShell=rotationStatement&&n.start>=rotationStatement.start&&n.end<=rotationStatement.end;
    if(!inShell&&variant==='pdd'&&n.start<decoder.start)continue;
   }}
 }
 const calls=[...replace.keys()];if(!calls.length)fail('没有可静态还原的字面量调用');
 const mark=n=>{if(!n)return;removed.add(n);removedRanges.push(n);};
 if(!rotationStatement)fail('未找到可移除的轮转语句');mark(rotationStatement);
 mark(decoder);
 if(tableFactory)mark(tableFactory);
 if(variant==='pdd'){
  const first=tree.body[0];if(first?.type!=='VariableDeclaration'||!first.declarations.some(d=>bindings.get(d.id)===tableBinding))fail('v6 表声明不在固定位置');mark(first);
  const guardFactory=tree.body.find(n=>n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id.name==='_0x54f9b7'));
  const guard=tree.body.find(n=>n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id.name==='_0x1dde07'));
  const guardCall=tree.body.find(n=>n.type==='ExpressionStatement'&&n.expression.type==='CallExpression'&&n.expression.callee.name==='_0x1dde07');
  const f=guardFactory?.declarations.find(d=>d.id.name==='_0x54f9b7'),g=guard?.declarations.find(d=>d.id.name==='_0x1dde07');
  if(!f||methodContract(f.init)!==PDD_GUARD_FACTORY||!g||methodContract(g.init)!==PDD_GUARD||!guardCall||methodContract(guardCall.expression)!==PDD_GUARD_CALL)fail('v6 自防御壳与已审查契约不同');
  mark(guardFactory);mark(guard);mark(guardCall);
 }else{
  const shell=tree.body.find(n=>n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id.name==='_0x554d94'));
  const child=tree.body.find(n=>n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id.name==='_0x511896'));
  const shellCall=tree.body.find(n=>n.type==='ExpressionStatement'&&n.expression.type==='CallExpression'&&n.expression.callee.name==='_0x511896');
  const shellDecl=shell?.declarations.find(d=>d.id.name==='_0x554d94'),childDecl=child?.declarations.find(d=>d.id.name==='_0x511896');
  const legacy=!!(shellDecl||childDecl||shellCall);
  if(legacy){
   if(!shellDecl||methodContract(shellDecl.init)!==KS_SHELL||!childDecl||methodContract(childDecl.init)!==KS_SHELL_CHILD||!shellCall||methodContract(shellCall.expression)!==KS_SHELL_CALL)fail('js-obfuscator 自防御壳与已审查契约不同');
   mark(shell);mark(child);mark(shellCall);
  }else{
   family=[decoder,...shells].filter(fn=>fn.type==='FunctionDeclaration');
   if(!proveEmbeddedShellFamily(family,source,ix))fail('js-obfuscator 自防御壳与已审查契约不同');
   for(const fn of family)mark(fn);
  }
 }

 // Delete only closed lookup wrappers whose every reference is either a
 // replaced call or lies inside another removed wrapper/scaffold.
 const wrapperFns=[...wrappers].filter(fn=>fn!==decoder),removable=new Set();let changed=true;
 while(changed){changed=false;for(const fn of wrapperFns){if(removable.has(fn))continue;const b=fn.id?bindings.get(fn.id):parents.get(fn)?.type==='VariableDeclarator'?bindings.get(parents.get(fn).id):null;
   if(!b)continue;
   const safe=b.refs.every(r=>{const p=parents.get(r);if(p?.type==='CallExpression'&&p.callee===r&&replace.has(p))return true;if(isRemoved(r))return true;if(removable.has(parents.get(r))||removable.has(parents.get(parents.get(r))))return true;return false;});
   if(safe){removable.add(fn);changed=true;const parent=parents.get(fn);if(fn.type==='FunctionDeclaration')mark(fn);else if(parent?.type==='VariableDeclarator'&&parent.init===fn){const decl=parents.get(parent);if(decl?.type==='VariableDeclaration'&&decl.declarations.length===1&&['Program','BlockStatement'].includes(parents.get(decl)?.type))mark(decl);else mark(parent);}}
  }}
 for(const fn of wrapperFns){const p=parents.get(fn);if(p?.type!=='Property'||p.value!==fn)continue;const object=parents.get(p),declarator=parents.get(object),objectBinding=declarator?.type==='VariableDeclarator'&&declarator.init===object&&declarator.id.type==='Identifier'?bindings.get(declarator.id):null;if(!objectBinding)continue;
  const accesses=nodes.filter(n=>n.type==='MemberExpression'&&bindings.get(n.object)===objectBinding&&String(property(n))===String(key(p)));
  if(accesses.every(n=>{const call=parents.get(n);return call?.type==='CallExpression'&&call.callee===n&&replace.has(call);}))mark(p);
 }

 // 同表解码器的局部别名只允许用于已替换的字面量调用。先沿别名链收敛，再在
 // 无写入且全部引用均已消失时删除声明；任何逃逸引用都会在下方解码器检查中拒绝。
 const aliases=new Map(),known=new Set(family.map(fn=>bindings.get(fn.id)));
 for(let changed=true;changed;){
  changed=false;
  for(const declarator of nodes){
   if(declarator.type!=='VariableDeclarator'||declarator.id.type!=='Identifier'||declarator.init?.type!=='Identifier')continue;
   const source=bindings.get(declarator.init),target=bindings.get(declarator.id);
   if(!source||!target||!known.has(source)||known.has(target))continue;
   known.add(target);aliases.set(target,declarator);changed=true;
  }
 }
 const removableAliases=new Set();
 for(let changed=true;changed;){
  changed=false;
  for(const [binding,declarator]of aliases){
   if(removableAliases.has(binding)||binding.writes.length)continue;
   const safe=binding.refs.every(ref=>{
    if(isRemoved(ref))return true;
    const parent=parents.get(ref);
    if(parent?.type==='CallExpression'&&parent.callee===ref&&replace.has(parent))return true;
    if(parent?.type==='VariableDeclarator'&&parent.init===ref)return removableAliases.has(bindings.get(parent.id));
    return false;
   });
   if(safe){removableAliases.add(binding);mark(declarator);changed=true;}
  }
 }
 for(const fn of family){
  const binding=bindings.get(fn.id),decoderRefs=binding.refs.filter(r=>!isRemoved(r)&&!removable.has(parents.get(r))&&!removable.has(parents.get(parents.get(r))));
  const unsafe=decoderRefs.filter(r=>{const p=parents.get(r);return !(p?.type==='CallExpression'&&p.callee===r&&replace.has(p));});
  if(unsafe.length)fail('解码器仍有动态、逃逸或未识别的引用');
 }
 const tableRefs=tableBinding.refs.filter(r=>!isRemoved(r)&&!isRemoved(parents.get(r)));
 if(tableRefs.some(r=>bindings.get(r)!==decoderBinding&&!(parents.get(r)?.type==='CallExpression'&&parents.get(r).callee===r)))fail('字符串表仍被解码器以外的业务读取');
 for(const d of nodes.filter(n=>n.type==='ExpressionStatement'&&n.expression.type==='AssignmentExpression'&&n.expression.left.type==='Identifier'&&n.expression.left.name==='_0xodJ'&&n.expression.right.type==='Literal'&&n.expression.right.value==='jsjiami.com.v6')){
  const b=bindings.get(d.expression.left),reads=b?.refs.filter(r=>r!==d.expression.left&&!isRemoved(r)&&!isRemoved(parents.get(r)));
  if(!reads?.length)mark(d);
 }
 let count=0;for(const _ of replace.keys())count++;
 const render=n=>renderTree(source,n,node=>{
  if(removed.has(node))return {direct:true,value:''};
  if(replace.has(node))return {direct:true,value:replace.get(node)};
  if(node.type==='VariableDeclaration'&&node.declarations.some(removed.has.bind(removed))){const ds=node.declarations.filter(d=>!removed.has(d));return ds.length?{children:ds,render:child=>`${node.kind} ${ds.map(child).join(', ')};`}:{direct:true,value:''};}
  if(node.type==='ObjectExpression'&&node.properties.some(removed.has.bind(removed))){const ps=node.properties.filter(p=>!removed.has(p));return {children:ps,render:child=>`{${ps.map(child).join(', ')}}`};}
  return null;
 });
 return {source:render(tree),transformations:[{kind:'obfuscator-literal-string-table',format:variant==='ks'?'javascript-obfuscator':'jsjiami-v6',lookups:count,rotation_steps:rotationSteps,reason:'仅用闭合 AST 常量计算解码字符串；业务语句保留自原始 AST'}]};
}
