import {parse} from '../core/syntax.mjs';
import {index,key,patch} from '../core/ast.mjs';
import {methodContract} from '../platform/clients.mjs';

// Preserve reviewed embedded public libraries. Only the business/platform code
// is compiled. Contracts identify code, never an author's URL or a comment tag.

export const libraryContracts=new Map([
 ['fc2d0428d1d8daa968b627cf857565a938a4619c2d0dc509f12ea113b64a430e',{name:'JSEncrypt complete string-table bundle',source:'https://github.com/travist/jsencrypt',retainDependencies:true,implicitBindings:['ASN1','Hex','Base64S','v','KJUR','utc']}],
 ['fe2e46e63d48460f3885b5a2c9eb30db2be16562d83887548f0a01b332d45749',{name:'js-base64 Base64Code constructor',source:'https://github.com/dankogai/js-base64'}],
 ['6d1475ca208f0b71db2613c54de3b114e41acf3bbcd8134ba7a5683aacad2012',{name:'CryptoJS embedded full bundle',source:'https://github.com/brix/crypto-js',globalReceiver:true,valueContracts:[{global:'CryptoJS',nonCallableCalls:['AES.encrypt','DES.encrypt','TripleDES.encrypt','MD5','enc.Utf8.parse','enc.Hex.parse','enc.Hex.stringify','enc.Base64.parse'],resultFormatters:['MD5','DES.encrypt','TripleDES.encrypt','enc.Base64.parse']}]}],
 ['1d801bf22e2f15b3f95a89787621ed7361cdd160988b00e0718c957507718e55',{name:'CryptoJS embedded full bundle',source:'https://github.com/brix/crypto-js',globalReceiver:true,valueContracts:[{global:'CryptoJS',nonCallableCalls:['AES.encrypt','DES.encrypt','TripleDES.encrypt','MD5','enc.Utf8.parse','enc.Hex.parse','enc.Hex.stringify','enc.Base64.parse'],resultFormatters:['MD5','DES.encrypt','TripleDES.encrypt','enc.Base64.parse']}]}],
 ['ee4f09f5002e4669a973dd3ccfec144156c063af4b74bbbc685c38098cee07fb',{name:'CryptoJS embedded full bundle',source:'https://github.com/brix/crypto-js',valueContracts:[{global:'CryptoJS',nonCallableCalls:['AES.encrypt','DES.encrypt','TripleDES.encrypt','MD5','enc.Utf8.parse','enc.Hex.parse','enc.Hex.stringify','enc.Base64.parse'],resultFormatters:['MD5','DES.encrypt','TripleDES.encrypt','enc.Base64.parse']}]}],
 ['852be7b2194fd311c020e53402486e3001057f70b4ac96ff6a823e928b5e14e6',{name:'JSEncrypt embedded bundle',source:'https://github.com/travist/jsencrypt'}],
 ['7279d3fe48ff1f10e6ace7de1356ecc17967f0c659d203a0d5500b8788703b68',{name:'CryptoJS embedded AES variant',source:'https://github.com/brix/crypto-js'}],
 ['62809d899a0e2085283a72c6f39acfe6a4982989556ce09f7c4994e3f9e6f5b3',{name:'he HTML entities',source:'https://github.com/mathiasbynens/he',globalReceiver:true}],
 ['6e3eebd79b9106279e9203a6d130518b38f8180706305d8aae47fc53ee7d2cdb',{name:'js-base64 3.7.2',source:'https://github.com/dankogai/js-base64',globalReceiver:true}],
 ['316c0b3d3648951f6114259246689eb05f556f1eb29ab8581feabaafbc78ea46',{name:'text-encoding',source:'https://github.com/inexorabletash/text-encoding',globalReceiver:true}],
 ['91cc1549ff57cc7c4d9640918067e06dae8b46343d90e748f699c511123871bc',{name:'protobuf-ts runtime 2.10.0',source:'https://github.com/timostamm/protobuf-ts'}],
 ['296eed6f8c680e28839fd4184432719194859c0311e0916b0c6469116f60c0e4',{name:'protobuf-ts bundled runtime',source:'https://github.com/timostamm/protobuf-ts'}],
 ['e663fe73297ef644c04d7dd8d79343f90da6d871dae85d33c30f546383df1599',{name:'protobuf-ts bundled runtime',source:'https://github.com/timostamm/protobuf-ts'}],
 ['53846e4888144ff9939fe2d3c5d8d2d41c24c4cad52cefe5d893698f6277e4dc',{name:'protobuf-ts bundled runtime',source:'https://github.com/timostamm/protobuf-ts'}],
 ['fd799507898ebc97f4435cf314c11f7e9e5782ad11cad854a21b83db2ef3b168',{name:'protobuf.js embedded bundle',source:'https://github.com/protobufjs/protobuf.js'}],
 ['9a53e1215029e9c6cab68103f806742227b6974229772d2d46ca459185103312',{name:'js-md5 embedded variant',source:'https://github.com/emn178/js-md5'}],
]);

function contract(body){return methodContract({type:'Program',sourceType:'script',start:body[0].start,end:body.at(-1).end,body});}
export function protectLibraries(source,{sourceType='script'}={}){
 const tree=parse(source,{ecmaVersion:'latest',sourceType,allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree);
 const names=new Set(ix.nodes.filter(n=>n.type==='Identifier').map(n=>n.name)),blocks=new Map(),replace=new WeakMap();
 const fresh=()=>{let n=0;while(names.has('publicLibraryBlock'+n))n++;const name='publicLibraryBlock'+n;names.add(name);return name;};
 const candidates=[];
 // Complete IIFEs are independently bounded library candidates. A spoofed
 // comment or familiar method name cannot pass the exact AST contract.
 const groups=ix.nodes.filter(n=>['Program','BlockStatement'].includes(n.type));
 // Bundled CommonJS libraries can be emitted as several declarations at the
 // start of an IIFE. The exact contract, not this boundary heuristic, grants
 // preservation; stop before the first statement touching a free proxy API.
 for(const group of groups){
  const first=group.body[0];
  if(first?.type!=='VariableDeclaration'||!source.slice(first.start,first.end).includes('exports'))continue;
  const body=[];
  for(const n of group.body.slice(0,80)){
   if(ix.nodes.some(x=>x.start>=n.start&&x.end<=n.end&&ix.free(x)&&x.name.startsWith('$')))break;
   body.push(n);
  }
  if(body.length>1&&libraryContracts.has(contract(body)))candidates.push(body);
 }
 // Some complete libraries export a constructor rather than an IIFE. Only
 // an exact reviewed AST contract admits these declarations; names and
 // attribution comments never exempt arbitrary constructors.
 for(const group of groups)for(const n of group.body)if(n.type==='FunctionDeclaration')candidates.push([n]);
 for(const group of groups)for(const n of group.body)if(n.type==='ExpressionStatement'){
  const expression=n.expression.type==='UnaryExpression'?n.expression.argument:n.expression;
  if(expression?.type==='CallExpression'&&['FunctionExpression','ArrowFunctionExpression'].includes(expression.callee.type)){
   candidates.push([n]);
   const position=group.body.indexOf(n);
   // Some complete libraries initialize browser globals and exports before
   // their IIFE. The full contract must include those authored initializers.
   if(position>=3)candidates.push(group.body.slice(position-3,position+1));
  }
 }
 // Unwrapped protobuf-ts runtime ends at its MessageType implementation,
 // before the generated application-specific schema subclasses begin.
 for(const group of groups)for(let start=0;start<group.body.length;start++){
  const first=group.body[start],text=source.slice(first.start,first.end);
  if(!/protobuf-ts\/unknown/.test(text))continue;
  const begin=start>0&&group.body[start-1].type==='VariableDeclaration'&&group.body[start-1].declarations.every(d=>!d.init)?start-1:start;
  for(let end=start;end<Math.min(group.body.length,start+120);end++){
   const n=group.body[end];
   const classes=n.type==='ClassDeclaration'?[n]:n.type==='VariableDeclaration'?n.declarations.map(d=>d.init).filter(n=>n?.type==='ClassExpression'):[];
   if(classes.some(n=>['fromBinary','toBinary','internalBinaryRead','internalBinaryWrite','mergePartial'].every(name=>n.body.body.some(m=>key(m)===name)))){candidates.push(group.body.slice(begin,end+1));break;}
  }
 }
 // Protobuf-generated schema classes are ordinary JavaScript. Preserve their
 // complete source with the reviewed runtime, rather than treating a reader's
 // int64().toString() as Function source inspection. Admission is structural,
 // requires a known MessageType base, and still follows every lexical dependency.
 function withSchemas(body,known){
  if(!known.name.startsWith('protobuf-ts'))return body;
  const last=body.at(-1),group=ix.parents.get(last);
  if(!group?.body)return body;
  const bases=new Set(),schemas=new Set();
  for(const c of ix.nodes.filter(n=>['ClassExpression','ClassDeclaration'].includes(n.type)&&n.start>=body[0].start&&n.end<=last.end)){
   if(!['fromBinary','toBinary','internalBinaryRead','internalBinaryWrite','mergePartial'].every(name=>c.body.body.some(m=>key(m)===name)))continue;
   const id=c.id??ix.parents.get(c)?.id,b=id&&ix.bindings.get(id);if(b)bases.add(b);
  }
  function schema(c){
   return c?.type==='ClassExpression'&&bases.has(ix.bindings.get(c.superClass))&&c.body.body.every(m=>m.type==='MethodDefinition'&&!m.static&&!m.computed&&!m.value.async&&!m.value.generator&&/^(?:constructor|create|internalBinaryRead|internalBinaryWrite|binaryReadMap\d+)$/.test(key(m)))&&
    ['constructor','create','internalBinaryRead','internalBinaryWrite'].every(name=>c.body.body.some(m=>key(m)===name));
  }
  function enumeration(d){
   const call=d.init,fn=call?.callee,arg=call?.arguments?.[0];
   if(call?.type!=='CallExpression'||call.arguments.length!==1||fn?.type!=='ArrowFunctionExpression'||fn.params.length!==1||fn.params[0].type!=='Identifier'||arg?.type!=='LogicalExpression'||arg.operator!=='||'||ix.bindings.get(arg.left)!==ix.bindings.get(d.id)||arg.right.type!=='ObjectExpression'||arg.right.properties.length)return false;
   const b=ix.bindings.get(fn.params[0]),allowed=new Set(['ArrowFunctionExpression','Identifier','SequenceExpression','AssignmentExpression','MemberExpression','Literal']);
   return ix.nodes.filter(n=>n.start>=fn.start&&n.end<=fn.end).every(n=>allowed.has(n.type)&&
    (n.type!=='Identifier'||n===fn.params[0]||ix.bindings.get(n)===b||!ix.reference(n))&&
    (n.type!=='AssignmentExpression'||n.operator==='='&&n.left.type==='MemberExpression'&&n.left.object.type==='Identifier'&&ix.bindings.get(n.left.object)===b));
  }
  const extended=[...body];
  for(const n of group.body.slice(group.body.indexOf(last)+1)){
   if(n.type!=='VariableDeclaration'||n.declarations.some(d=>d.id.type!=='Identifier'))break;
   for(const d of n.declarations)if(schema(d.init))schemas.add(ix.bindings.get(d.id));
   if(!n.declarations.every(d=>schema(d.init)||d.init?.type==='NewExpression'&&!d.init.arguments.length&&schemas.has(ix.bindings.get(d.init.callee))||enumeration(d)))break;
   // A schema may not introduce host globals, dynamic evaluation, platform
   // calls or source-level dependencies on a surrounding adapter.
   const safe=new Set(['Object','Array','String','Number','Boolean','BigInt','Uint8Array','ArrayBuffer','DataView','Error','TypeError','RangeError','Math','JSON','undefined','Infinity','NaN','parseInt','parseFloat','isNaN','isFinite']);
   const standard=x=>safe.has(x.name)||x.name==='globalThis'&&ix.parents.get(x)?.type==='MemberExpression'&&safe.has(ix.parents.get(x).computed?ix.parents.get(x).property.value:ix.parents.get(x).property.name);
   if(ix.nodes.some(x=>x.start>=n.start&&x.end<=n.end&&ix.free(x)&&!standard(x)))break;
   extended.push(n);
  }
  if(extended.length===body.length)return body;
  const begin=body[0].start,end=last.end,pending=ix.nodes.filter(n=>n.start>=extended[body.length].start&&n.end<=extended.at(-1).end),seen=new Set(),expanded=new Set();
  const safe=new Set(['Object','Array','String','Number','Boolean','BigInt','Uint8Array','ArrayBuffer','DataView','Error','TypeError','RangeError','Math','JSON','undefined','Infinity','NaN','parseInt','parseFloat','isNaN','isFinite']);
  while(pending.length){
   const n=pending.pop();if(seen.has(n)||n.start>=begin&&n.end<=end)continue;seen.add(n);
   if(ix.free(n)&&!safe.has(n.name)&&!(n.name==='globalThis'&&ix.parents.get(n)?.type==='MemberExpression'&&safe.has(ix.parents.get(n).computed?ix.parents.get(n).property.value:ix.parents.get(n).property.name)))return body;
   if(n.type!=='Identifier'||!ix.reference(n))continue;
   const b=ix.bindings.get(n);if(!b||expanded.has(b))continue;expanded.add(b);
   for(const d of [b.init,...b.writes].filter(Boolean))if(!(d.start>=begin&&d.end<=end))pending.push(...ix.nodes.filter(x=>x.start>=d.start&&x.end<=d.end));
  }
  return extended;
 }
 for(let body of candidates){
  if(body.some(n=>replace.has(n)))continue;
  const known=libraryContracts.get(contract(body));if(!known)continue;
  const runtimeContract=contract(body);
  body=withSchemas(body,known);
  if(known.globalReceiver&&ix.nodes.some(n=>n.type==='Identifier'&&n.name==='globalThis'&&ix.bindings.has(n)))throw Error('公共库全局接收者被局部变量遮蔽');
  const start=body[0].start,end=body.at(-1).end;
  // Defense in depth: a reviewed library must contain no free proxy API.
  if(ix.nodes.some(n=>n.start>=start&&n.end<=end&&ix.free(n)&&n.name.startsWith('$')))continue;
  // Bundlers sometimes hoist pure helpers outside the runtime. Follow their
  // lexical dependencies as well: a helper changed to call a proxy API must
  // not hide a completion operation inside an opaque library call.
  const pending=ix.nodes.filter(n=>n.start>=start&&n.end<=end),seen=new Set(),expanded=new Set();let closed=true;
  while(pending.length&&closed){
   const n=pending.pop();if(seen.has(n))continue;seen.add(n);
   if(ix.free(n)&&n.name.startsWith('$')){closed=false;break;}
   if(n.type!=='Identifier'||!ix.reference(n))continue;
   const b=ix.bindings.get(n);if(!b||expanded.has(b))continue;expanded.add(b);
   if(['module','exports','require','global','window','self','process','define'].includes(n.name)&&b.init&&(b.init.start<start||b.init.end>end)){closed=false;break;}
   for(const dependency of [b.init,...b.writes].filter(Boolean)){
    if(seen.has(dependency)||dependency.start>=start&&dependency.end<=end)continue;
    pending.push(...ix.nodes.filter(n=>n.start>=dependency.start&&n.end<=dependency.end));
   }
  }
  if(!closed)continue;
  const exports=[...(known.implicitBindings??[])];
  for(const n of body){
   if(['FunctionDeclaration','ClassDeclaration'].includes(n.type))exports.push(n.id.name);
   if(n.type==='VariableDeclaration')for(const d of n.declarations){if(d.id.type!=='Identifier')throw Error('Unsupported library export pattern');exports.push(d.id.name);}
  }
  const marker=fresh(),raw=source.slice(start,end);
  blocks.set(marker,{...known,contract:contract(body),runtime_contract:runtimeContract,raw,start,end,code:known.globalReceiver?`(function(){${raw}}).call(globalThis);`:(known.implicitBindings?.length?'var '+known.implicitBindings.join(', ')+';\n':'')+raw});
  const dependencies=new Set();
  if(known.retainDependencies)for(const n of ix.nodes)if(n.start>=start&&n.end<=end&&n.type==='Identifier'&&ix.reference(n)){
   const binding=ix.bindings.get(n),initial=binding?.init;
   if(initial&&(initial.end<start||initial.type==='FunctionDeclaration'&&(initial.start<start||initial.end>end)))dependencies.add(n.name);
  }
  // Retain closed, already initialized lexical library dependencies in the
  // compiler graph. Restoration removes this marker initializer entirely.
  replace.set(body[0],'var '+marker+(dependencies.size?' = ['+[...dependencies].join(', ')+']':'')+(exports.length?', '+[...new Set(exports)].join(', '):'')+';');
  for(const n of body.slice(1))replace.set(n,'');
 }
 const render=n=>replace.has(n)?replace.get(n):patch(source,n,render);
 const restore=(code,{globalReceiver=true}={})=>{
  const t=parse(code,{ecmaVersion:'latest',sourceType:'module',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),i=index(t),replacements=new WeakMap(),found=new Set();
  for(const n of i.nodes)if(n.type==='VariableDeclaration'){
   const b=blocks.get(n.declarations[0]?.id?.name);if(!b)continue;
   if(found.has(n.declarations[0].id.name))throw Error('Duplicate public library placeholder');
   found.add(n.declarations[0].id.name);replacements.set(n,globalReceiver?b.code:b.raw);
  }
  if(found.size!==blocks.size)throw Error('Public library placeholder lost during compilation');
  const emit=n=>replacements.has(n)?replacements.get(n):patch(code,n,emit);
  return emit(t);
 };
 return {source:render(tree),restore,valueContracts:[...blocks.values()].flatMap(b=>b.valueContracts??[]),blocks:[...blocks.values()].map(({name,source,start,end,contract})=>({name,source,start,end,contract}))};
}
