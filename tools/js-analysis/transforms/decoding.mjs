import {parse} from '../core/syntax.mjs';
import {index,patch,property,functions,key,children} from '../core/ast.mjs';
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
 const render=n=>{
  if(removed.has(n))return '';
  if(replace.has(n))return replace.get(n);
  // A literal computed method key has no effects. Exclude constructor: the
  // computed spelling denotes an ordinary method rather than a constructor.
  const name=n.type==='MethodDefinition'&&n.computed?(replace.has(n.key)?JSON.parse(replace.get(n.key)):n.key.type==='Literal'?n.key.value:null):null;
  if(typeof name==='string'&&name!=='constructor')return source.slice(n.start,n.key.start).replace(/\[\s*$/,'')+JSON.stringify(name)+source.slice(n.key.end,n.value.start).replace(/^\s*\]/,'')+render(n.value);
  return patch(source,n,render);
 };
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

function collect(source,variant){
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree),{nodes,parents,bindings}=ix;
 const decoderHash=variant==='ks'?KS_DECODER:PDD_DECODER;
 const decoders=nodes.filter(n=>n.type==='FunctionDeclaration'&&methodContract(n)===decoderHash);
 if(decoders.length!==1)fail('已识别标记，但解码器语法数量不唯一');
 const decoder=decoders[0],decoderBinding=bindings.get(decoder.id);
 let tableBinding,tableFactory=null,values,offset=0,rotationCall,rotationFn,rotationStatement,rotationSteps=0;
 if(variant==='ks'){
  const first=decoder.body.body[0],factory=first?.type==='VariableDeclaration'&&first.declarations.length===1?first.declarations[0].init:null;
  tableFactory=factory?.type==='CallExpression'&&!factory.arguments.length&&functions.has(bindings.get(factory.callee)?.init?.type)?bindings.get(factory.callee).init:null;
  const decl=tableFactory?.body.body[0],tableDecl=decl?.type==='VariableDeclaration'&&decl.declarations.length===1?decl.declarations[0]:null;
  if(!tableFactory||tableFactory.body.body.length!==3||tableDecl?.init?.type!=='ArrayExpression')fail('表工厂不符合已审查结构');
  tableBinding=bindings.get(tableFactory.id);values=literalArray(tableDecl.init,ix,source);
  const assignment=decoder.body.body[1]?.argument?.expressions?.[0];
  const inner=assignment?.type==='AssignmentExpression'?assignment.right:null,sub=inner?.type==='FunctionExpression'?inner.body.body[0]?.expression:null;
  if(sub?.type!=='AssignmentExpression'||sub.operator!=='='||sub.right.type!=='BinaryExpression'||sub.right.operator!=='-'||sub.right.left.type!=='Identifier')fail('解码器索引没有固定偏移');
  offset=number(sub.right.right);if(!Number.isInteger(offset))fail('解码器偏移不是常量');
  const matches=nodes.filter(n=>n.type==='CallExpression'&&functions.has(n.callee.type)&&methodContract(n.callee,new Set([decoder.id.name,tableFactory.id.name]))===KS_ROTATION);
  if(matches.length!==1)fail('字符串表轮转语法数量不唯一');
  rotationCall=matches[0];rotationFn=rotationCall.callee;
  if(rotationCall.arguments.length!==2||rotationCall.arguments[0].type!=='Identifier'||bindings.get(rotationCall.arguments[0])!==tableBinding)fail('轮转没有使用本地字符串表工厂');
  rotationStatement=topStatement(rotationCall,parents,tree);
  rotationSteps=rotateKS(rotationFn,rotationCall,values,decoder,offset,ix,source);
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
 return {tree,ix,nodes,parents,bindings,decoder,decoderBinding,tableBinding,tableFactory,values,offset,rotationCall,rotationFn,rotationStatement,rotationSteps,variant};
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
function number(n,depth=0){
 if(depth>24)fail('常量算术过深');
 if(n?.type==='Literal'&&typeof n.value==='number'&&Number.isFinite(n.value))return n.value;
 if(n?.type==='UnaryExpression'&&['+','-','~'].includes(n.operator)){const v=number(n.argument,depth+1);return n.operator==='+'?+v:n.operator==='-'?-v:~v;}
 if(n?.type==='BinaryExpression'&&['+','-','*','/','%','>>','>>>','<<','|','&','^'].includes(n.operator)){const a=number(n.left,depth+1),b=number(n.right,depth+1);return ({'+':()=>a+b,'-':()=>a-b,'*':()=>a*b,'/':()=>a/b,'%':()=>a%b,'>>':()=>a>>b,'>>>':()=>a>>>b,'<<':()=>a<<b,'|':()=>a|b,'&':()=>a&b,'^':()=>a^b})[n.operator]();}
 fail('表达式包含非静态数字运算');
}
function topStatement(n,parents,tree){let child=n,p=parents.get(n);while(p&&p!==tree){child=p;p=parents.get(child);}return p===tree?child:null;}

function rotateKS(fn,call,values,decoder,offset,ix,source){
 const target=number(call.arguments[1]),loop=ix.nodes.find(n=>n.type==='TryStatement'&&n.start>=fn.start&&n.end<=fn.end),checksum=loop?.block.body[0]?.declarations?.[0]?.init;
 if(!Number.isFinite(target)||!checksum||!ix.nodes.some(n=>n.type==='WhileStatement'&&n.start>=fn.start&&n.end<=fn.end))fail('js-obfuscator 校验循环不匹配');
 const wrappers=decoderWrappers(ix,decoder);
 for(let i=0;i<values.length;i++){
  try{const checksumValue=evaluate(checksum,new Map(),{ix,values,offset,decoder,wrappers,variant:'ks'});if(checksumValue===target)return i;}
  catch{}
  values.push(values.shift());
 }
 fail('js-obfuscator 轮转校验在一轮内没有匹配');
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
  const fn=functionFor(n.callee,ix);if(!fn||!wrappers.has(fn))throw Error('unreviewed call');
  const callArgs=n.arguments.map(a=>evaluate(a,env,ctx,depth+1));
  if(fn===decoder){
   let index;
   if(variant==='ks')index=Number(callArgs[0])-offset;
  else{const raw=callArgs[0],marker=typeof raw==='string'?raw.charCodeAt(0):0;if(typeof raw!=='string'||marker<0x202a||marker>0x202e||!/^[0-9a-f]+$/i.test(raw.slice(1)))throw Error('v6 lookup index is not a bidi-prefixed hex literal');index=Number.parseInt('0x'+raw.slice(1));}
   if(!Number.isInteger(index)||index<0||index>=values.length)throw Error('lookup outside rotated table');
   return decodeRC4(values[index],callArgs[1],variant==='ks'?'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=':'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=',variant==='pdd');
  }
  const returned=fn.body.type==='BlockStatement'?fn.body.body[0]?.argument:fn.body;
  if(fn.params.length!==callArgs.length)throw Error('wrapper arity differs');
  const local=new Map(env);fn.params.forEach((p,i)=>{if(p.type!=='Identifier')throw Error('wrapper parameter is not an identifier');local.set(ix.bindings.get(p),callArgs[i]);});
  return evaluate(returned,local,ctx,depth+1);
 }
 throw Error('unreviewed expression '+n.type);
}

export function lowerObfuscatedTables(source){
 const initial=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),scan=index(initial);
 const ks=scan.nodes.some(n=>n.type==='FunctionDeclaration'&&methodContract(n)===KS_DECODER),pdd=source.includes('jsjiami.com.v6');
 if(!ks&&!pdd)return {source,transformations:[]};
 if(ks&&pdd)fail('一个文件包含多个不兼容的表格式');
 const data=collect(source,ks?'ks':'pdd'),{tree,ix,nodes,parents,bindings,decoder,decoderBinding,tableBinding,tableFactory,values,offset,rotationStatement,rotationSteps,variant}=data;
 const wrappers=decoderWrappers(ix,decoder),replace=new Map(),removed=new WeakSet(),removedRanges=[];
 const isRemoved=n=>removedRanges.some(r=>n.start>=r.start&&n.end<=r.end);
 for(const n of nodes){
  if(n.type!=='CallExpression')continue;const fn=functionFor(n.callee,ix);if(!fn||!wrappers.has(fn))continue;
  try{const value=evaluate(n,new Map(),{ix,values,offset,decoder,wrappers,variant});if(typeof value==='string')replace.set(n,JSON.stringify(value));}
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
  if(!shellDecl||methodContract(shellDecl.init)!==KS_SHELL||!childDecl||methodContract(childDecl.init)!==KS_SHELL_CHILD||!shellCall||methodContract(shellCall.expression)!==KS_SHELL_CALL)fail('js-obfuscator 自防御壳与已审查契约不同');
  mark(shell);mark(child);mark(shellCall);
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
 const decoderRefs=decoderBinding.refs.filter(r=>!isRemoved(r)&&!removable.has(parents.get(r))&&!removable.has(parents.get(parents.get(r))));
 if(decoderRefs.some(r=>{const p=parents.get(r);return !(p?.type==='CallExpression'&&p.callee===r&&replace.has(p));}))fail('解码器仍有动态、逃逸或未识别的引用');
 const tableRefs=tableBinding.refs.filter(r=>!isRemoved(r)&&!isRemoved(parents.get(r)));
 if(tableRefs.some(r=>bindings.get(r)!==decoderBinding&&!(parents.get(r)?.type==='CallExpression'&&parents.get(r).callee===r)))fail('字符串表仍被解码器以外的业务读取');
 for(const d of nodes.filter(n=>n.type==='ExpressionStatement'&&n.expression.type==='AssignmentExpression'&&n.expression.left.type==='Identifier'&&n.expression.left.name==='_0xodJ'&&n.expression.right.type==='Literal'&&n.expression.right.value==='jsjiami.com.v6')){
  const b=bindings.get(d.expression.left),reads=b?.refs.filter(r=>r!==d.expression.left&&!isRemoved(r)&&!isRemoved(parents.get(r)));
  if(!reads?.length)mark(d);
 }
 let count=0;for(const _ of replace.keys())count++;
 const render=n=>{
  if(removed.has(n))return '';
  if(replace.has(n))return replace.get(n);
  if(n.type==='VariableDeclaration'&&n.declarations.some(removed.has.bind(removed))){const ds=n.declarations.filter(d=>!removed.has(d));return ds.length?`${n.kind} ${ds.map(render).join(', ')};`:'';}
  if(n.type==='ObjectExpression'&&n.properties.some(removed.has.bind(removed)))return `{${n.properties.filter(p=>!removed.has(p)).map(render).join(', ')}}`;
  return patch(source,n,render);
 };
 return {source:render(tree),transformations:[{kind:'obfuscator-literal-string-table',format:variant==='ks'?'javascript-obfuscator':'jsjiami-v6',lookups:count,rotation_steps:rotationSteps,reason:'仅用闭合 AST 常量计算解码字符串；业务语句保留自原始 AST'}]};
}
