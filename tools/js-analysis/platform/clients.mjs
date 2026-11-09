import {parse} from '../core/syntax.mjs';
import {createHash} from 'node:crypto';
import {index,children,patch,renderTree,property,key,functions} from '../core/ast.mjs';

// Reviewed, alpha-normalized method contracts; no file/author matching.
export const contracts = {
  "constructor": {
    "549830e037692d430fd01de02409a5a5d5c7b1c4554fb0f5f4c24239ca706bff": "reviewed",
    "a62e5dd569bbb84fb5729c5016d47690fbb4334100c1a3f6a71432bc0d9633ff": "reviewed"
  },
  "getInstance": {
    "523ba0492bc8e234bcbabed707cc538426ab4fbe6a4fce3a8e1574a344d024f7": "reviewed",
    "d3a2042b54a34df1d5b32bcb435db16cdd1f7d524f85a8bf8d00730cabe571fa": "reviewed"
  },
  "createProxy": {
    "c4bfd46a986d2671b5c5eb2276d0587afabc9b3caf8c1f7ec3b945aeddff1358": "reviewed"
  },
  "getFn": {
    "0487897f92cac4c692aa4499a91530f6c670f0bb35dc84949c86dcf17175c3b8": "reviewed",
    "030e9b8c1237e72cace38e4e584e9503261816ba2c09e253b0e16ba1fff3df36": "reviewed",
    "31b2e5a6d242eb32d13c0593ad43969d4eb8538f897d821969266a8c59b2196c": "reviewed"
  },
  "setFn": {
    "4bb8008a3345ff468c6de4229685ef55a52104ddbd6a8a70c6bca2367864c6f7": "reviewed",
    "9b70a5f92ea33305948eaebd495b151b18aa8d8901ac133e99893505647acf3c": "reviewed",
    "fbf2c86fb02585fa032d494e4728213f201710d32f663d6e5abceb40dd0f1193": "reviewed"
  },
  "getJSON": {
    "444a8524d530094289638af8b7e83904d073dc3a76bb6d39e1bde196e2206eab": "reviewed"
  },
  "setJSON": {
    "547507ef6784de69f0d931aab73b5f47c2c94af467a94080bca54ddb2d11dfa5": "reviewed"
  },
  "msg": {
    "8fb53172a015de45e7cd89f14cc911e8fbf1b4dc49f671f7e3a97151a580d8a0": "conditional-url",
    "25c4da6f290bb166ac15495e74e135418a66be10f0555dd81703fc6dd2b0966c": "conditional-url",
    "448ad8f2eebde0cc64c6cdc00da527fb308155c98776900ee0e76118f39627b2": "conditional-url",
    "4c532802cfc95117e37ee93789f1e373880281fadb4c3f6a7ceec52ac8be2fde": "empty-url"
  },
  "debug": {
    "8c9b0e88e4a6b4be3bbfe0f67e030af02cf7798730aefb6213cd40c2ce7e7153": "debug"
  },
  "log": {
    "dfc23ba15aaa3974e788e179a6e3361032afabdbb869d9711ea4ff3978a43583": "always",
    "41ea649fa90b18a7e557056452b558975170e418213371342d502f17a5046e74": "debug"
  },
  "timeStart": {
    "224110def929328a06c388d83f7667b03e025a21e77d84ec8cafcdff01a61224": "reviewed"
  },
  "timeEnd": {
    "3025f31e644ef54e19ce2f3098771a98627315498039397d0eae98c2e1091de7": "reviewed",
    "67a672a32a675b04d28a62c0c0323e0503b8861512f26699ac669aeb2a3b6a42": "reviewed"
  },
  "exit": {
    "b2db3220895ad68bd5077a4ab0257767cc480ddfc10ec8b621ab878792b185e3": "reviewed"
  },
  "reject": {
    "b961a677c413d0f33dc367a52dbfc6c72897f95afdc2ff78304e60a389d92c7e": "reviewed"
  },
  "decodeParams": {
    "7a2749c6235c389bec1ab2bbdb713220d9e11340b3874ef35de35223fbf4d89b": "identity",
    "ba1316214e297e68d03c53d4ea416dedbc7bb2dccc62a87fd69347a75e67058f": "json-string",
    "758b544fb08480499ad65091cdb486e88d4984c999132b57b3efaed0205e0afa": "object-fields"
  },
  "init": {
    "eb7bb9b2f2a1fa2dac529ef97192c91a63914fffc1beaa0756668359323a3c3e": "reviewed",
    "fb9758da79e0a718b4a052189ba03056060413ebab98ec7214b1b510b43b0ac0": "reviewed"
  },
  "getVal": {
    "21699d187794c4d6eaf18dd58bc5918651be987bffb00ec720ac1bde59bda662": "reviewed",
    "65ca039759cf6edfabf2c796cf401373c675b1dc22c06a5514e2cd4aad35b3f7": "reviewed",
    "ac10579fa9697b7c4c6804e64328e7a19424d6e2b266d36621ba62f02b0e2f05": "reviewed"
  },
  "setVal": {
    "8f165d28b2bd8731644972b6b13885bbc1985f6e09e3bf8acb1176170a12f2d5": "reviewed",
    "d914512ade57e2cde734cdecbfc17ae8d17fa12c584e6acb2f1bfddb656722a4": "reviewed"
  },
  "fetch": {
    "04af851ec45dca98f89b9d39824380f86cf0ca1ab5a68c9452b0f359495866b8": "reviewed",
    "2643c61826fd260e73331451265d4dfa5f4d7f70ba42eeffd93af74a9cb4803f": "reviewed",
    "8d2b89f8dc9c62eddbf19e52bb0432ad764423db21198ea16e5d4dfdd143428e": "reviewed"
  },
  "done": {
    "1e4aeb9e7cd72cc865c9560aa5b9b34f467f998add2296a751e1de63c939f743": "reviewed",
    "c75f50fb082d5c94c379c95e3d30bb3d2e97d0f94c887032bf65cd6b8ccbe7df": "reviewed",
    "9879653adff4dceb7905eb3847ef2485a58c1a0f18a249ce7ceb4fbf4b3a6078": "reviewed",
    "b5db58b6edd71e316425e9813e65b1e1253c6e8b461a17b49e76e1d359701529": "reviewed"
  },
  "transferBodyBytes": {
    "14f773c7c5a2c7c9685125e59f77cd71b814667f1db95b385ec0308d2d928c95": "reviewed"
  },
  "fieldInitializer": {
    "cb54e3203dffd0a52adfcc4283b2cfee2d4cd2107f189401f203419d0df34d6a": "receiver-only",
    "31ad5464f2d9f2c8d009a567b686020818a02e51e153771326c66174555e946e": "receiver-only",
    "f0991b4737ab2fdcf98ef5ca496aa2add5e6c8f9810cc2cb5f232a69017be8bd": "receiver-only",
    "84095096d6cba33316af516c3cbb73319f4e8f6c130b8b210002d3021c7ba80c": "receiver-only",
    "21a04e4fbcb28116ae68c7a0f4f379d1b844bba68628713ed15b028f1be312a2": "receiver-only",
    "3d60a64ac637f72cff3bb822e83b32cdd5617140f69b563237014e777172b345": "receiver-only",
    "2eb7c3ed2f9538decc70398812d62e6731e6dfc0a2033dcaae1bb82c5e372157": "receiver-only",
    "5d1b0da098bc93af8b99719d1576ffb22f1da700fe3ffdfc64335ccec5df72e9": "receiver-only"
  }
};

// Statically specialize closed, bundled platform clients. No client/shim is
// emitted. Contracts describe alpha-equivalent method syntax, never file URLs.

export function methodContract(node, classNames=new Set(),externalNames=new Map()){
 const ix=index(node),ids=new Map();let next=0;
 function clean(n){
  if(!n||typeof n!=='object')return typeof n==='bigint'?String(n)+'n':n;
  if(Array.isArray(n))return n.map(clean);
  const out={};for(const [k,v]of Object.entries(n)){
   if(['start','end','loc','raw'].includes(k))continue;
   if(k==='name'&&n.type==='Identifier'){
    const p=ix.parents.get(n),label=p?.type==='MemberExpression'&&p.property===n&&!p.computed||['Property','MethodDefinition','PropertyDefinition'].includes(p?.type)&&p.key===n&&!p.computed;
    const b=label?null:ix.bindings.get(n);
    if(b){if(!ids.has(b))ids.set(b,'v'+next++);out[k]=ids.get(b);}
    else out[k]=!label&&ix.reference(n)?(classNames.has(v)?'ClientClass':externalNames.get(v)??v):v;
   }else out[k]=clean(v);
  }return out;
 }
 return createHash('sha256').update(JSON.stringify(clean(node))).digest('hex');
}

export function clientInventory(source){
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree);
 function resolve(n,seen=new Set()){
  if(n?.type==='Identifier'){const b=ix.bindings.get(n);if(b?.init&&!b.writes.length&&!seen.has(b)){seen.add(b);return resolve(b.init,seen);}}
  return n;
 }
 const classes=ix.nodes.filter(n=>['ClassExpression','ClassDeclaration'].includes(n.type));
 const roots=classes.filter(c=>c.body.body.some(m=>m.type==='MethodDefinition'&&m.static&&key(m)==='getInstance'));
 const families=[];
 for(const root of roots){
  const members=new Set([root]);let changed=true;
  while(changed){changed=false;for(const c of classes)if(!members.has(c)&&members.has(resolve(c.superClass))){members.add(c);changed=true;}}
  const names=new Set(ix.nodes.filter(n=>n.type==='Identifier'&&members.has(resolve(n))).map(n=>n.name));
  families.push({root,members,names});
 }
 return {tree,ix,resolve,families};
}

export function lowerClients(source,format='surge'){
 const {tree,ix,resolve,families}=clientInventory(source);
 if(!families.length)return {source,lowered:false};
 const {nodes,parents,bindings,free}=ix,removed=new Set(),replacements=new WeakMap(),instances=new Map(),notes=[];
 const fail=(n,reason)=>{throw Error(`客户端展开第 ${source.slice(0,n.start).split('\n').length} 行：${reason}`);};
 if(nodes.some(n=>free(n,'$native')))fail(tree,'输入占用了编译器内部标识符');
 const isRemoved=n=>{for(let p=n;p;p=parents.get(p))if(removed.has(p))return true;return false;};
 const render=n=>n?emit(n):'';
 const digest=(method,family)=>methodContract(method.value,family.names);
 function contract(method,family){
  const code=digest(method,family),known=contracts[key(method)]?.[code];
  if(!known)fail(method,'客户端方法 '+key(method)+' 的实现尚未匹配语义契约 ('+code.slice(0,12)+')');
  return known;
 }
 function checkInitializer(fn,seen=new Set()){
  if(seen.has(fn))return;seen.add(fn);
  if(!functions.has(fn?.type)||!contracts.fieldInitializer?.[methodContract(fn)])fail(fn??tree,'类字段初始化器包含未知行为');
  const local=index(fn);
  for(const n of local.nodes)if(n.type==='Identifier'&&local.free(n)&&!['undefined','Object'].includes(n.name)){
   const value=resolve(n);
   if(functions.has(value?.type))checkInitializer(value,seen);
   else if(!(value?.type==='MemberExpression'&&free(value.object,'Object')&&property(value)==='defineProperty'))fail(n,'类字段初始化器的外部依赖不明确');
  }
 }
 function initValue(n){while(n?.type==='AssignmentExpression'&&n.operator==='=')n=n.right;return n;}
 for(const family of families){
  const {root,members}=family;
  // Only families actually instantiated by a local singleton factory qualify.
  const calls=nodes.filter(n=>n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&property(n.callee)==='getInstance'&&resolve(n.callee.object)===root);
  if(!calls.length)continue;
  if(!['surge','loon'].includes(format))fail(root,'该客户端展开目前要求已确定的 Surge 或 Loon 源平台');
  if(root.superClass)fail(root,'客户端基类不能继承未知外部类');
  for(const c of members){
   const keys=c.body.body.map(m=>String(m.static)+':'+key(m));
   if(new Set(keys).size!==keys.length)fail(c,'客户端成员被重复声明');
   for(const m of c.body.body){
   if(m.type==='MethodDefinition')contract(m,family);
   else if(m.type!=='PropertyDefinition'||m.static||m.computed||!['_times','name','isDebug','className','request','response'].includes(key(m))||m.value&&!(key(m)==='_times'&&m.value.type==='NewExpression'&&free(m.value.callee,'Map')&&!m.value.arguments.length))fail(m,'未知客户端字段初始化');
   }
  }
  function metadata(name,value){
   if(value?.type!=='ObjectExpression'||value.properties.some(p=>p.type!=='Property'||p.kind!=='init'||p.computed)||new Set(value.properties.map(key)).size!==value.properties.length)fail(value??root,'客户端静态配置不是确定的对象');
   if(name==='instances'&&value.properties.length)fail(value,'客户端单例缓存非空');
   if(name==='classNames'&&value.properties.some(p=>!['Surge','Loon','QuanX'].includes(key(p))||p.value.type!=='ArrowFunctionExpression'))fail(value,'客户端工厂含未知行为');
   if(name==='clientAdapter'){
    const actual=Object.fromEntries(value.properties.map(p=>[key(p),p.value.type==='Literal'?p.value.value:null]));
    if(!(Object.keys(actual).length===1&&actual.bodyBytes==='body'||Object.keys(actual).length===2&&actual.id==='sessionIndex'&&actual.status==='statusCode'))fail(value,'客户端字段映射超出已确认的平台字段');
   }
  }
  let factory;
  for(const n of nodes){
   if(n.type==='AssignmentExpression'&&n.operator==='='&&n.left.type==='MemberExpression'&&members.has(resolve(n.left.object))&&['instances','classNames','clientAdapter'].includes(property(n.left))){
    metadata(property(n.left),n.right);
    removed.add(n);if(resolve(n.left.object)===root&&property(n.left)==='classNames')factory=n.right;
   }
   if(n.type==='CallExpression'&&n.arguments.length===3&&members.has(resolve(n.arguments[0]))&&['instances','classNames','clientAdapter'].includes(n.arguments[1]?.value)){
    const helper=resolve(n.callee);
    checkInitializer(helper);
    metadata(n.arguments[1].value,n.arguments[2]);
    removed.add(n);if(resolve(n.arguments[0])===root&&n.arguments[1].value==='classNames')factory=n.arguments[2];
   }
  }
  const selected=factory?.type==='ObjectExpression'?factory.properties.find(p=>key(p)===(format==='loon'?'Loon':'Surge')):null;
  const make=selected?.value,ctor=make?.body?.type==='NewExpression'?resolve(make.body.callee):null;
  if(!members.has(ctor)||make.type!=='ArrowFunctionExpression'||make.params.length!==3||make.params.some(p=>p.type!=='Identifier')||make.body.arguments.length!==3||make.body.arguments.some((a,i)=>a.type!=='Identifier'||bindings.get(a)!==bindings.get(make.params[i])))fail(root,'无法静态确定 '+format+' 客户端工厂及其参数');
  function method(name,c=ctor){const own=c.body.body.find(m=>m.type==='MethodDefinition'&&key(m)===name&&!m.static);return own??(c.superClass?method(name,resolve(c.superClass)):null);}
  const first=calls[0];
  if(first.arguments[0]?.type!=='Literal'||typeof first.arguments[0].value!=='string')fail(first,'客户端名称必须是静态字符串');
  const name=first.arguments[0].value;
  const opts=first.arguments[1];
  if(opts&&(opts.type!=='ObjectExpression'||opts.properties.some(p=>key(p)!=='debug'||!['Literal','UnaryExpression'].includes(p.value.type))))fail(first,'客户端初始化选项不能静态确定');
  const debug=opts?.properties.find(p=>key(p)==='debug')?.value;
  const enabled=debug?.type==='Literal'?debug.value:debug?.type==='UnaryExpression'&&debug.operator==='!'?!debug.argument.value:false;
  if(typeof enabled!=='boolean')fail(first,'客户端调试开关不是布尔值');
  const info={name,enabled,method,family};
  for(const call of calls){
   if(JSON.stringify(call.arguments.map(n=>source.slice(n.start,n.end)))!==JSON.stringify(first.arguments.map(n=>source.slice(n.start,n.end))))fail(call,'同一单例的初始化参数不一致');
   let p=parents.get(call);while(p?.type==='AssignmentExpression'&&p.right===call)p=parents.get(p);
   if(p?.type!=='VariableDeclarator'||p.id.type!=='Identifier'||initValue(p.init)!==call)fail(call,'客户端单例必须保存到局部变量');
   if(bindings.get(p.id)?.writes.length)fail(p,'客户端单例被重新赋值');
   instances.set(bindings.get(p.id),info);removed.add(p);
  }
  for(const n of nodes){
   if(n.type==='VariableDeclarator'&&members.has(resolve(n.init)))removed.add(n);
   if(n.type==='ClassDeclaration'&&members.has(n))removed.add(n);
  }
  for(const n of nodes)if(n.type==='Identifier'&&ix.reference(n)&&members.has(resolve(n))&&!isRemoved(n))fail(n,'客户端类引用逃逸，不能删除原平台封装');
  if(enabled)notes.push(`console.log(${JSON.stringify(name+' Start')});`);
 }
 if(!instances.size)return {source,lowered:false};
 // Resolve aliases before rewriting so a renamed singleton has the same proof.
 let changed=true;while(changed){changed=false;for(const n of nodes)if(n.type==='VariableDeclarator'&&n.id.type==='Identifier'&&n.init?.type==='Identifier'&&instances.has(bindings.get(n.init))&&!instances.has(bindings.get(n.id))){if(bindings.get(n.id)?.writes.length)fail(n,'客户端别名被重新赋值');instances.set(bindings.get(n.id),instances.get(bindings.get(n.init)));removed.add(n);changed=true;}}
 for(const n of [...nodes].reverse()){
  if(n.type!=='Identifier'||!ix.reference(n)||!instances.has(bindings.get(n))||isRemoved(n))continue;
  const info=instances.get(bindings.get(n)),p=parents.get(n),q=parents.get(p);
  if(p?.type!=='MemberExpression'||p.object!==n||property(p)===undefined)fail(n,'客户端对象整体传递或动态访问');
  const field=property(p);
  if(['request','response'].includes(field)){
   if(q?.type!=='MemberExpression'||q.object!==p||!['url','method','status','headers','body','bodyBytes'].includes(property(q)))fail(p,'请求或响应必须使用可确定的字段');
   replacements.set(p,'$'+field);continue;
  }
  if(field==='name'){replacements.set(p,JSON.stringify(info.name));continue;}
  if(q?.type!=='CallExpression'||q.callee!==p)fail(p,'客户端方法引用逃逸');
  const maximum={done:1,exit:0,reject:0,getVal:1,setVal:2,getJSON:2,setJSON:2,decodeParams:1,debug:1,log:1,msg:4,fetch:1}[field];
  if(maximum!==undefined&&(q.arguments.length>maximum||q.arguments.some(a=>a.type==='SpreadElement')))fail(q,'客户端方法参数无法保留求值语义');
  const m=info.method(field);if(!m)fail(p,'未知客户端方法 '+field);
  const behavior=contract(m,info.family),a=q.arguments.map(render),at=(i,fallback='undefined')=>a[i]??fallback;
  let text;
  if(field==='done')text='$done('+at(0)+')';
  else if(['exit','reject'].includes(field))text='$done({})';
  else if(field==='getVal')text='$native.storage.get('+at(0)+')';
  else if(field==='setVal')text='$native.storage.set('+at(1)+', '+at(0)+')';
  else if(field==='getJSON')text=`((key, fallback = {}) => {const raw = $native.storage.get(key);return raw ? JSON.parse(raw) : fallback;})(${a.join(', ')})`;
  else if(field==='setJSON')text=`((value, key) => $native.storage.set(key, JSON.stringify(value)))(${a.join(', ')})`;
  else if(field==='decodeParams'){
   if(behavior==='identity')text=at(0);
   else if(behavior==='object-fields')text=`((defaults, argument) => {if (argument !== undefined) for (const key of Object.keys(defaults)) {const value = argument?.[key];if (value !== undefined) defaults[key] = value;}return defaults;})(${at(0)}, $argument)`;
   else if(behavior==='json-string')text=`((defaults) => typeof $native.env.argument === 'string' && !$native.env.argument.includes('{{{') ? Object.assign(defaults, JSON.parse($native.env.argument)) : defaults)(${at(0)})`;
   else fail(q,'未知客户端参数解码契约');
  }
  else if(field==='debug'||field==='log'){
   const enabled=behavior==='always'||info.enabled;
   text=enabled?`((value) => console.log(typeof value === 'object' ? JSON.stringify(value) : value))(${at(0)})`:`void (${at(0)})`;
  }else if(field==='msg'){
   const action=behavior==='empty-url'?`, {url: ${at(3,'""')} ?? ''}`:a[3]?`, {url: ${at(3)}}`:'';
   text=`$notification.post(${at(0,JSON.stringify(info.name))}, ${at(1,'""')}, ${at(2,'""')}${action})`;
  }else if(field==='fetch'){
   const input=q.arguments[0];if(q.arguments.length!==1||input?.type!=='ObjectExpression'||input.properties.some(p=>p.type!=='Property'||p.computed))fail(q,'HTTP 请求必须是可确定字段的对象');
   const fields=new Map(input.properties.map(p=>[key(p),p.value]));
   if([...fields.keys()].some(k=>!['url','method','headers','body','bodyBytes','timeout','policy','insecure','auto-redirect','auto-cookie'].includes(k)))fail(q,'客户端 HTTP 请求包含未知选项');
   const verb=fields.get('method')?.value??'GET';if(typeof verb!=='string'||!['GET','POST','PUT','DELETE','HEAD','OPTIONS','PATCH'].includes(verb.toUpperCase()))fail(q,'HTTP 方法不能静态确定');
   const options=["timeout: 5000", "redirect: 'follow'", "credentials: 'include'"];
   for(const name of ['headers','body','bodyBytes','timeout','policy'])if(fields.has(name))options.push(`${name==='bodyBytes'?'body':name}: ${name==='timeout'?'1000 * ':''}${render(fields.get(name))}`);
   for(const [name,key,yes,no]of [['auto-redirect','redirect','follow','manual'],['auto-cookie','credentials','include','omit']])if(fields.has(name))options.push(`${key}: ${render(fields.get(name))} ? '${yes}' : '${no}'`);
   if(fields.has('insecure'))options.push('insecureTls: '+render(fields.get('insecure')));
   text=`$native.http.${verb.toLowerCase()}(${render(fields.get('url'))}, {${options.join(', ')}})`;
  }else fail(q,'尚未展开客户端方法 '+field);
  replacements.set(q,text);
 }
 function emit(n){
  if(removed.has(n))return n.type==='CallExpression'||n.type==='AssignmentExpression'?'undefined':'';
  if(replacements.has(n))return replacements.get(n);
  if(n.type==='VariableDeclaration'){
   const keep=n.declarations.filter(d=>!removed.has(d)),p=parents.get(n),header=['ForStatement','ForInStatement','ForOfStatement'].includes(p?.type);
   return keep.length?n.kind+' '+keep.map(render).join(', ')+(header?'':';'):'';
  }
  return patch(source,n,emit);
 }
 return {source:notes.join('\n')+'\n'+emit(tree),lowered:true};
}

// Alpha-equivalent SDK/runner method ASTs reviewed for middleware specialization.
// No source-file hashes, URLs, business bodies or generated resource templates.
export const pipelineContracts = {
  "root.createInstance": [
    "e5b0c2d0ebb39fe9722ec734ed699749ad9b1dc9846898492fda97c1dbe85c58"
  ],
  "root.url": [
    "9b7d07465ef9cb8eea85d74933ed55ff7cbdae47432e8fa3e54354a97bad07a1"
  ],
  "root.path": [
    "0f00df156dbff2bf57984bf0eb73115aa7a9f5de5876baef9df1d4b0eb3f3748"
  ],
  "root.method": [
    "131210af447f0a2f0f2c310675d60f066befcb2eb7973fe52ce67811d1972906"
  ],
  "root.constructor": [
    "d419a05dcf3782823f752b87a7ea7a67d176f1ce12839494bf4f0cb2e6f6912d"
  ],
  "root.getJSON": [
    "23c295830c3eac9dc20f6ddceca16f5454114e472d2c455f9365e4966d541be6"
  ],
  "root.setJSON": [
    "48332745f2f85e80ae6fd080b91557c98d0c8b649aeb85f670d1d98c59141313"
  ],
  "root.exit": [
    "b2db3220895ad68bd5077a4ab0257767cc480ddfc10ec8b621ab878792b185e3"
  ],
  "root.onerror": [
    "0527c57b1ccb3cf4bfe5eb6ae73d15cbbd661d21605f63e0fa50a6c7684d5a00",
    "e558d483312a797fae9ccb1ef8af3168fb0acac47b5162890669daadada2aed2",
    "f7069ac1972320ad1cbadfab8453f2943b8b0cb54b6528978db7c616555bea53"
  ],
  "root.end": [
    "b12b5030406787e48626a28d0607c1fcaccab6c24f898558075d1720442b2a39"
  ],
  "root.toString": [
    "063bdbe7adb5b2178006a8cb79277f265c1a2c94a72ca2d309ed59add36cd602"
  ],
  "surge.createRequest": [
    "9a250df3c244e74a6d8562cddaeaebcefa8cbef0be532f5be3abf8a01dff3df8"
  ],
  "surge.createResponse": [
    "9a250df3c244e74a6d8562cddaeaebcefa8cbef0be532f5be3abf8a01dff3df8"
  ],
  "surge.setupArgument": [
    "18fa5fe9c1ee323473623d4035e859276f02e78c0fe5b0d7aab285544724bc27",
    "89e8af89a312b6027997d9e3e510707832b95f0aeed170b6865732e4d5b3ce91",
    "8f3efe7b45d2627e91ff9937a34ba018bb0ec41df6e6ac3277f8dc3f19b8e9d3"
  ],
  "surge.getVal": [
    "21699d187794c4d6eaf18dd58bc5918651be987bffb00ec720ac1bde59bda662"
  ],
  "surge.setVal": [
    "19ac98cbc087849b9d953c3e1a286e4ab34dc4b1a8c37f68ffc4519a9ee82da8"
  ],
  "surge.fetch": [
    "5a28743a021d502d8f41a68dadbd90d0ee270cd201b60c01e182414b2d05a335",
    "189581c7c1ff2c9ce938b51add971220c130d79bb91cf2455295caaf22f53f0f",
    "4e090ad80bdc7014359df418503f3ca1b67bbc2a29f6bb5505061cb58ed8632b",
    "b887ccf622dad896a7bf37c99bb51550db065295c1155c80a1f097ac9379d234"
  ],
  "surge.notify": [
    "59289e81b2d60ceffc416b42f9f4bf90c8bfbdab9d0f4c7ebb66fa210e8117f2"
  ],
  "surge.done": [
    "501a045990b18408bac56bf57fc26cd503ec8aff51a0914d73b5c2a350087e45"
  ],
  "surge.abort": [
    "6d31f3d0a7d758ee7fca0f2fd51a490cdf39ad27ac23689f2651021059b443a1"
  ],
  "loon.setupArgument": [
    "0ae0f2890cd6de4a8fddc7f6cb0a20d8716a676e063643f5661b20fae1dd8a11"
  ],
  "loon.fetch": [
    "44de81b3238f642fc4a1982476bb41ee0332ed58f16555acf2c7fb9a908aad69"
  ],
  "loon.notify": [
    "cc4f483dfd39747403a4afc6f615bd22f4f2b0f9fb7ea2ca495de07785160f35"
  ],
  "loon.abort": [
    "b961a677c413d0f33dc367a52dbfc6c72897f95afdc2ff78304e60a389d92c7e"
  ],
  "runner": [
    "458e9992caa1fa2f827b89a8df7788410df37ac36af395bc3fab3cff4d2b3bd6",
    "19c423889fa6c0cf84346f40473d4c00f723d8dcf37ad12a6e5908641ed36a06"
  ]
};

// Specialize reviewed middleware clients, keeping upstream routing/business JS.
// Contracts cover SDK methods, never whole files or handwritten business output.

export function lowerPipeline(source,format,options={}) {
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree);
 const {nodes,parents,bindings,free}=ix;
 function resolve(n,seen=new Set()) {
  if(n?.type==='Identifier'){const b=bindings.get(n);if(b?.init&&!b.writes.length&&!seen.has(b)){seen.add(b);return resolve(b.init,seen);}}
  return n;
 }
 const classes=nodes.filter(n=>['ClassExpression','ClassDeclaration'].includes(n.type));
 const roots=classes.filter(c=>c.body.body.some(m=>m.static&&key(m)==='createInstance'));
 if(!roots.length)return {source,lowered:false};
 const edits=new WeakMap(),removed=new Set(),preamble=[],gaps=[];
 const names=new Set(nodes.filter(n=>n.type==='Identifier').map(n=>n.name));
 const fresh=base=>{let name=base,i=2;while(names.has(name))name=base+i++;names.add(name);return name;};
 const fail=(n,message)=>{throw Error('中间件客户端第 '+source.slice(0,n.start).split('\n').length+' 行：'+message);};
 function isRemoved(n){for(let p=n;p;p=parents.get(p))if(removed.has(p))return true;return false;}
 const emit=n=>edits.has(n)?edits.get(n):removed.has(n)?'':
  n.type==='VariableDeclaration'&&n.declarations.some(d=>removed.has(d))?
   (n.declarations.every(d=>removed.has(d))?'':n.kind+' '+n.declarations.filter(d=>!removed.has(d)).map(emit).join(',')+';'):patch(source,n,emit);
 let lowered=false;
 for(const root of roots){
  const factory=root.body.body.find(m=>m.static&&key(m)==='createInstance');
  const calls=nodes.filter(n=>n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&property(n.callee)==='createInstance'&&resolve(n.callee.object)===root);
  if(!calls.length)continue;
  const family=new Set([root]);let changed=true;
  while(changed){changed=false;for(const c of classes)if(!family.has(c)&&family.has(resolve(c.superClass))){family.add(c);changed=true;}}
  const classNames=new Set(nodes.filter(n=>n.type==='Identifier'&&family.has(resolve(n))).map(n=>n.name));
  const binaryPredicates=new Set();
  for(const binding of new Set(nodes.filter(n=>n.type==='Identifier').map(n=>bindings.get(n)).filter(Boolean))){
   const fn=binding.fn,statements=fn?.body?.body;
   if(binding.writes.length||fn?.params.length!==1||fn.params[0].type!=='Identifier'||!Array.isArray(statements)||statements.length!==1||statements[0].type!=='ReturnStatement')continue;
   const result=statements[0].argument;
   if(result?.type==='BinaryExpression'&&result.operator==='instanceof'&&result.left.type==='Identifier'&&bindings.get(result.left)===bindings.get(fn.params[0])&&free(result.right,'Uint8Array'))binaryPredicates.add(binding);
  }
  function check(method,kind){
   const externalNames=new Map();
   if(method&&kind==='surge.fetch')for(const n of nodes){
    if(n.type==='Identifier'&&n.start>=method.start&&n.end<=method.end&&ix.reference(n)&&binaryPredicates.has(bindings.get(n)))externalNames.set(n.name,{reviewedExternal:'byte-array-predicate'});
   }
   if(!method||!pipelineContracts[kind]?.includes(methodContract(method.value,classNames,externalNames)))fail(method??root,'未知的 '+kind+' 语义契约，拒绝替换 SDK 行为');
  }
  // Only this closed, inherited factory protocol is eligible. Other JS classes
  // continue through the general compiler rather than acquiring this privilege.
  if(!pipelineContracts['root.createInstance'].includes(methodContract(factory.value,classNames)))continue;
  if(!['surge','loon'].includes(format))fail(factory,'需要确定的 Surge 或 Loon 模块来源');
  if(root.superClass||family.size!==3||calls.length!==1)fail(root,'客户端工厂或继承关系并非封闭的单次调用');
  if(nodes.some(n=>n.type==='Identifier'&&n.name==='$native'))fail(root,'输入占用了编译器内部标识符');
  const surge=[...family].find(c=>resolve(c.superClass)===root),loon=[...family].find(c=>resolve(c.superClass)===surge);
  if(!surge||!loon)fail(root,'无法确定平台类');
  for(const c of [surge,loon])if(c.body.body.some(m=>m.type!=='MethodDefinition'||m.static||m.computed))fail(c,'平台类包含额外初始化行为');
  for(const [c,kind]of [[surge,'surge'],[loon,'loon']])for(const m of c.body.body)check(m,kind+'.'+key(m));
  for(const c of family){
   const keys=c.body.body.map(m=>String(m.static)+':'+key(m));
   if(new Set(keys).size!==keys.length)fail(c,'客户端成员重复声明');
  }
  if(root.body.body.some(m=>['setupArgument','done','abort','getVal','setVal'].includes(key(m))))fail(root,'基类覆盖了所选平台 API 方法');
  for(const n of nodes)if(n.type==='Identifier'&&ix.reference(n)&&resolve(n)===root){
   const p=parents.get(n);
   if(p===calls[0].callee)continue;
   if(p?.type==='ClassExpression'&&p.superClass===n&&family.has(p))continue;
   fail(n,'客户端基类引用被修改或逃逸');
  }
  const method=(c,name)=>c.body.body.find(m=>m.type==='MethodDefinition'&&key(m)===name);
  for(const name of ['constructor','end','exit'])check(method(root,name),'root.'+name);
  for(const name of ['createRequest','createResponse','setupArgument','done','abort'])check(method(surge,name),'surge.'+name);
  check(method(loon,'abort'),'loon.abort');
  check(method(loon,'setupArgument'),'loon.setupArgument');
  const ctor=method(root,'constructor'),factoryCall=calls[0],local=parents.get(factoryCall),runnerFn=ix.owners.get(factoryCall),runnerMethod=parents.get(runnerFn),runner=parents.get(parents.get(runnerMethod));
  check(runnerMethod,'runner');
  if(local?.type!=='VariableDeclarator'||local.id.type!=='Identifier'||runner?.type!=='ClassExpression'||runnerMethod?.type!=='MethodDefinition'||key(runnerMethod)!=='run')fail(factoryCall,'工厂调用没有位于封闭的中间件入口');
  // Derive the compose/catch/finally chain from the original AST. It remains
  // original JS; only await/return ownership is changed.
  const statements=runnerFn.body.body,chain=statements.at(-1)?.expression;
  if(statements.length!==2||chain?.type!=='CallExpression'||property(chain.callee)!=='finally')fail(runnerFn,'未知的中间件收尾链');
  const caught=chain.callee.object;
  if(caught?.type!=='CallExpression'||property(caught.callee)!=='catch')fail(chain,'中间件错误处理链不明确');
  const dispatch=caught.callee.object;
  const request=fresh('nativeRequest'),response=fresh('nativeResponse');
  for(const [name,kind]of [[request,'request'],[response,'response']]){
   const msg='$native.'+kind,fields=kind==='request'?`url:${msg}.url,method:${msg}.method`:`status:${msg}.status`;
   const body=options.binary?`new Uint8Array(await ${msg}.arrayBuffer())`:`await ${msg}.text()`;
   preamble.push(`const ${name} = ${msg} ? {${fields},headers:{...${msg}.headers},body:${msg}.body == null ? undefined : ${body}} : null;`);
  }
  const snapshot=name=>`Object.create(${name},{bodyBytes:{get(){return this.body},set(value){this.body=value}}})`;
  edits.set(ctor,`constructor(){this.request=${snapshot(request)};this.response=${snapshot(response)};}`);
  removed.add(factory);
  // Native methods replace the inherited platform methods at their original
  // ownership boundary. No $loon/$surge/$httpClient façade is emitted.
  const setup=method(surge,'setupArgument');
  function setupText(n){return free(n,'$argument')?'$native.env.argument':patch(source,n,setupText);}
  const nativeSetup=setupText(setup.value.body);
  const nativeMethods=[`setupArgument(${setup.value.params.map(emit).join(',')})${nativeSetup}`];
  const rootEnd=method(root,'end'),last=rootEnd.value.body.body.at(-1);
  if(last.type!=='ExpressionStatement')fail(rootEnd,'收尾函数结果无法传播');
  const endBody=source.slice(rootEnd.value.body.start,last.start)+'return '+source.slice(last.expression.start,last.expression.end)+';'+source.slice(last.end,rootEnd.value.body.end);
  edits.set(rootEnd,'end()'+endBody);
  edits.set(method(root,'exit'),'exit(){return {};}');
  nativeMethods.push('done(value){return value.response ? $native.respond({status:200,...value.response}) : {...value};}');
  nativeMethods.push('abort(){return $native.abort();}');
  // Reject genuinely unmapped transport requirements independently of result
  // propagation. A missing API is never replaced by guessed device fields.
  const outside=n=>![...family].some(c=>n.start>=c.start&&n.end<=c.end);
  const externalCalls=nodes.filter(n=>n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&outside(n));
  for(const n of externalCalls)if(['done','exit','abort','notify','createRequest','createResponse'].includes(property(n.callee)))fail(n,'SDK 完成／通知方法从中间件内部调用，需要独立的提前终止传播证明');
  // Select the author's default (Surge) protocol, independent of the module
  // syntax. Its optional trailer check/fallback remains ordinary upstream JS.
  // Native snapshots deliberately expose the documented message fields only.
  if(externalCalls.some(n=>property(n.callee)==='fetch')){
   check(method(surge,'fetch'),'surge.fetch');
   for(const call of externalCalls.filter(n=>property(n.callee)==='fetch')){
    const input=resolve(call.arguments[0]);
    const allowed=new Set(['method','url','headers','body','timeout']);
    if(call.arguments.length!==1||input?.type!=='ObjectExpression'||input.properties.some(p=>p.type!=='Property'||p.kind!=='init'||p.computed||!allowed.has(key(p))))fail(call,'HTTP 请求选项无法静态映射到原生 API');
    // A literal's fields may be read for logging, but mutations and escapes
    // could add unknown transport options after the declaration.
    for(const ref of nodes.filter(n=>n.type==='Identifier'&&ix.reference(n)&&resolve(n)===input)){
     const parent=parents.get(ref),outer=parents.get(parent);
     if(parent===call&&call.arguments[0]===ref)continue;
     if(parent?.type==='MemberExpression'&&parent.object===ref&&property(parent)!==undefined&&!(outer?.type==='AssignmentExpression'&&outer.left===parent||outer?.type==='UpdateExpression'||outer?.type==='UnaryExpression'&&outer.operator==='delete'))continue;
     fail(ref,'HTTP 请求选项被修改或逃逸，无法证明字段映射');
    }
   }
   nativeMethods.push(`async fetch(input){
    const {method,body,timeout=5,url,...rest}=input;
    const verb=method.toLowerCase();
    if(!['get','post','put','delete','head','options','patch'].includes(verb))throw new Error('Unsupported HTTP method');
    if(Object.keys(rest).some(k=>k!=='headers'))throw new Error('Unsupported HTTP options');
    let reply;reply=await $native.http[verb](url,{...rest,body,timeout:timeout*1000,redirect:'follow',credentials:'include'});
    const data=body instanceof Uint8Array?new Uint8Array(await reply.arrayBuffer()):await reply.text();
    return Object.create({status:reply.status,headers:{...reply.headers},body:data},{bodyBytes:{get(){return this.body},set(value){this.body=value}}});
   }`);
  }
  for(const name of ['getVal','setVal']){
   const member=method(surge,name);check(member,'surge.'+name);nativeMethods.push(source.slice(member.start,member.end));
  }
  const close=root.body.end-1;
  const originalRoot=()=>source.slice(root.start,root.body.start+1)+root.body.body.filter(m=>!removed.has(m)).map(emit).join('\n')+'\n'+nativeMethods.join('\n')+'\n'+source.slice(close,root.end);
  for(const c of [surge,loon]){const p=parents.get(c);if(p?.type!=='VariableDeclarator')fail(c,'平台类引用不能安全删除');removed.add(p);}
  for(const n of nodes)if(n.type==='Identifier'&&ix.reference(n)&&[surge,loon].includes(resolve(n))&&!isRemoved(n))fail(n,'平台类引用逃逸');
  edits.set(factoryCall,'new '+source.slice(factoryCall.callee.object.start,factoryCall.callee.object.end)+'()');
  const localText=emit(statements[0]),instance=local.id.name;
  edits.set(runnerMethod,`async run(){${localText}try{await ${emit(caught)};}finally{return ${instance}.end();}}`);
  const entries=nodes.filter(n=>n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&property(n.callee)==='run'&&resolve(n.callee.object)?.type==='NewExpression'&&resolve(resolve(n.callee.object).callee)===runner);
  if(entries.length!==1||parents.get(entries[0])?.type!=='ExpressionStatement'||parents.get(parents.get(entries[0]))!==tree)fail(runner,'中间件入口不是唯一的顶层调用');
  edits.set(parents.get(entries[0]),'return await '+emit(entries[0])+';');
  edits.set(root,originalRoot());
  lowered=true;
 }
 return {source:lowered?preamble.join('\n')+'\n'+emit(tree):source,lowered,gaps,verificationFormat:lowered?'surge':undefined};
}

// Erase a closed, reviewed MagicJS factory; map only the members actually used.
const factoryContract='1e85dd7fd30da7eae38de2a313a8112a2a1618238cd32fa4570ec3dfc71f5709';
export function lowerMagic(source){
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree);
 const {nodes,parents,bindings,free}=ix,replacements=new WeakMap(),removed=new WeakSet();
 const literal=(n,seen=new Set())=>{if(n?.type==='Literal')return n.value;if(n?.type==='Identifier'){
  const b=bindings.get(n),d=parents.get(b?.init),decl=parents.get(d),block=parents.get(decl);
  let statement=n;while(parents.get(statement)&&parents.get(statement)!==block)statement=parents.get(statement);
  if(b?.init&&!b.writes.length&&!seen.has(b)&&decl?.type==='VariableDeclaration'&&['Program','BlockStatement'].includes(block?.type)&&statement.start>=decl.end&&ix.owners.get(n)===ix.owners.get(decl)){seen.add(b);return literal(b.init,seen);}
 }};
 for(const fn of nodes.filter(n=>n.type==='FunctionDeclaration')){
  if(!fn.body.body.some(n=>n.type==='ReturnStatement'&&n.argument?.type==='NewExpression'&&n.argument.callee.type==='ClassExpression'))continue;
  const b=bindings.get(fn.id);if(!b?.refs.length||b.writes.length||methodContract(fn)!==factoryContract)continue;
  if(nodes.filter(n=>n.type==='FunctionDeclaration'&&bindings.get(n.id)===b).length!==1)continue;
  const local=index(fn);if(local.nodes.some(n=>local.free(n)&&!free(n)))continue;
  // Unused legacy Base64 state must not be read by the business program.
  const writes=new Set(nodes.filter(n=>n.start>=fn.start&&n.end<=fn.end&&free(n)&&parents.get(n)?.type==='AssignmentExpression'&&parents.get(n).left===n).map(n=>n.name));
  if(nodes.some(n=>(n.start<fn.start||n.end>fn.end)&&free(n)&&writes.has(n.name)))continue;
  const planned=[];let valid=true;
  for(const ref of b.refs){
   const call=parents.get(ref),d=parents.get(call),decl=parents.get(d);
   if(call?.type!=='NewExpression'||call.callee!==ref||call.arguments.length!==2||call.arguments.some(a=>typeof literal(a)!=='string')||literal(call.arguments[1])!=='INFO'||d?.type!=='VariableDeclarator'||d.id.type!=='Identifier'||decl?.type!=='VariableDeclaration'||decl.declarations.length!==1){valid=false;break;}
   const instance=bindings.get(d.id);if(instance.writes.length){valid=false;break;}
   const changes=[];
   for(const r of instance.refs){
    let ancestor=r,dominated=true;
    while(parents.get(ancestor)){
     if(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(ancestor.type)&&!(parents.get(ancestor)?.type==='CallExpression'&&parents.get(ancestor).callee===ancestor)){dominated=false;break;}
     if(parents.get(ancestor)===parents.get(decl))break;
     ancestor=parents.get(ancestor);
    }
    if(!dominated||ancestor.start<decl.end){valid=false;break;}
    const m=parents.get(r),use=parents.get(m),name=property(m);
    if(m?.type!=='MemberExpression'||m.object!==r){valid=false;break;}
    if(name==='isResponse'){changes.push([m,()=>'(typeof $response !== "undefined")']);continue;}
    if(['request','response'].includes(name)&&use?.type==='MemberExpression'&&use.object===m&&['url','method','headers','body','status','statusCode'].includes(property(use))){
     const p=parents.get(use);if(p?.type==='AssignmentExpression'&&p.left===use||p?.type==='UpdateExpression'||p?.operator==='delete'){valid=false;break;}
     changes.push([use,()=>`$${name}.${property(use)==='statusCode'?'status':property(use)}`]);continue;
    }
    if(['done','logError','logWarning'].includes(name)&&use?.type==='CallExpression'&&use.callee===m&&use.arguments.length<=1&&!use.arguments.some(a=>a.type==='SpreadElement')){
     changes.push([use,()=>name==='done'?`$done(${use.arguments.map(render).join(', ')})`:`console.log(${JSON.stringify('['+(name==='logError'?'ERROR':'WARNING')+'] ['+literal(call.arguments[0])+']\n')} + ${use.arguments[0]?render(use.arguments[0]):'undefined'} + '\\n')`]);continue;
    }
    valid=false;break;
   }
   if(!valid)break;planned.push({decl,changes});
  }
  if(!valid||!planned.length)continue;
  removed.add(fn);for(const {decl,changes} of planned){removed.add(decl);for(const [n,value]of changes)replacements.set(n,value);}
 }
 function render(root){return renderTree(source,root,n=>{
  if(removed.has(n))return {direct:true,value:''};
  const r=replacements.get(n);return r?{direct:true,value:r()}:null;
  });}
 return render(tree);
}

// Device-family configuration is an explicit user input, not a hardware probe.
// Only family predicates may consume substituted model strings. Model numbers,
// OS/app versions, escaping values and dynamic calls still fail compilation.
export const DEVICE_ENV='EGH_DEVICE_TYPE';
export function lowerDevice(source){
 const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}),ix=index(tree);
 const replacements=new Map(),families=['iPhone','iPad','Mac'];
 const names=new Set(ix.nodes.filter(n=>n.type==='Identifier').map(n=>n.name));let deviceTypeToken='__eghDeviceTypeInput';
 while(names.has(deviceTypeToken))deviceTypeToken+='_';
 function callTestsDeviceFamily(call){
  const member=ix.parents.get(call),test=ix.parents.get(member);
  if(member?.type==='MemberExpression'&&member.object===call&&property(member)==='startsWith'&&test?.type==='CallExpression'&&test.callee===member&&!test.optional&&test.arguments.length===1&&test.arguments[0].type==='Literal'&&families.includes(test.arguments[0].value))return true;
  if(test?.type==='CallExpression'&&test.callee.type==='MemberExpression'&&property(test.callee)==='test'&&test.callee.object.regex&&test.arguments.length===1){const regex=test.callee.object.regex;return !regex.flags&&/^\^?(?:iPhone|iPad|Mac)$/.test(regex.pattern);}
  return false;
 }
 function returnedOnlyForDeviceFamily(statement){
  const fn=ix.owners.get(statement),parent=ix.parents.get(fn),id=fn?.id??(parent?.type==='VariableDeclarator'?parent.id:null),binding=id?.type==='Identifier'?ix.bindings.get(id):null;
  return !!binding&&!binding.writes.length&&binding.refs.length>0&&binding.refs.every(ref=>{const call=ix.parents.get(ref);return call?.type==='CallExpression'&&call.callee===ref&&!call.optional&&callTestsDeviceFamily(call);});
 }
 function loonModelValue(n,seen=new Set()){
  if(!n||seen.has(n))return false;seen=new Set(seen);seen.add(n);
  const p=ix.parents.get(n);
  if(p?.type==='MemberExpression'&&p.object===n){
   const call=ix.parents.get(p);
   return property(p)==='startsWith'&&call?.type==='CallExpression'&&call.callee===p&&!call.optional&&
    call.arguments.length===1&&call.arguments[0].type==='Literal'&&families.includes(call.arguments[0].value);
  }
  if(p?.type==='CallExpression'&&p.arguments.includes(n)&&p.callee.type==='MemberExpression'&&
    property(p.callee)==='test'&&p.callee.object.regex){
   const regex=p.callee.object.regex;
   return p.arguments.length===1&&regex&&!regex.flags&&/^\^?(?:iPhone|iPad|Mac)$/.test(regex.pattern);
  }
  if(p?.type==='VariableDeclarator'&&p.init===n&&p.id.type==='Identifier'){
   const binding=ix.bindings.get(p.id);return !!binding&&binding.refs.some(ref=>loonModelValue(ref,seen));
  }
  if(p?.type==='AssignmentExpression'&&p.right===n&&p.operator==='='&&p.left.type==='Identifier'){
   const binding=ix.bindings.get(p.left);return !!binding&&binding.refs.some(ref=>loonModelValue(ref,seen));
  }
  if(p?.type==='LogicalExpression'||p?.type==='ConditionalExpression'&&p.test!==n){
   return loonModelValue(p,seen);
  }
  if(p?.type==='SequenceExpression'&&p.expressions.at(-1)===n)return loonModelValue(p,seen);
  if(p?.type==='ReturnStatement'&&p.argument===n)return returnedOnlyForDeviceFamily(p);
  return false;
 }
 const model=n=>(ix.free(n,'$loon')||n.type==='MemberExpression'&&ix.free(n.object,'$environment')&&property(n)==='device-model')&&loonModelValue(n);
 const system=n=>n.type==='MemberExpression'&&ix.free(n.object,'$environment')&&property(n)==='system';
 const sources=ix.nodes.filter(n=>model(n)||system(n));
 if(!sources.length)return {source,deviceParameter:false};
 if(ix.nodes.some(n=>n.type==='MemberExpression'&&property(n)===DEVICE_ENV))throw Error('设备参数与上游环境变量冲突：'+DEVICE_ENV);
 const fail=n=>{throw Error('设备类型参数仅支持 iPhone/iPad/Mac 分类判断，不能代替具体型号、系统版本或传出设备字符串：第 '+(source.slice(0,n.start).split('\n').length)+' 行');};
 let deviceParameter=false;
 for(const root of sources){
  const kind=system(root)?'system':'model',visited=new Set();let needsType=false,familyLowered=false;
  function reads(b){
   if(!b)fail(root);
   for(const ref of b.refs){const p=ix.parents.get(ref);if(p?.type==='AssignmentExpression'&&p.left===ref)continue;flow(ref);}
  }
  function flow(n){
   if(visited.has(n))return;visited.add(n);
   const p=ix.parents.get(n);if(!p)fail(n);
   if(p.type==='MemberExpression'&&p.object===n&&kind==='model'){
    const call=ix.parents.get(p);
    if(property(p)==='startsWith'&&call?.type==='CallExpression'&&call.callee===p&&!call.optional&&
      call.arguments.length===1&&call.arguments[0].type==='Literal'&&families.includes(call.arguments[0].value)){
     needsType=true;familyLowered=true;replacements.set(n,`${deviceTypeToken}()`);return;
    }
   }
   if(p.type==='CallExpression'&&p.arguments.length===1&&p.arguments[0]===n&&p.callee.type==='MemberExpression'&&
     property(p.callee)==='test'&&kind==='model'){
    const regex=p.callee.object.regex;
    if(regex&&!regex.flags&&/^\^?(?:iPhone|iPad|Mac)$/.test(regex.pattern)){
     needsType=true;familyLowered=true;replacements.set(n,`${deviceTypeToken}()`);return;
    }
   }
   if(p.type==='BinaryExpression'&&kind==='system'&&['==','===','!=','!=='].includes(p.operator)){
    const other=p.left===n?p.right:p.left;
    if(other.type==='Literal'&&['iOS','macOS'].includes(other.value)){
     needsType=true;familyLowered=true;
     replacements.set(n,`(${deviceTypeToken}() === 'Mac' ? 'macOS' : 'iOS')`);return;
    }
   }
   if(p.type==='UnaryExpression'&&['!','typeof','void'].includes(p.operator))return;
   if(p.type==='IfStatement'&&p.test===n||p.type==='ConditionalExpression'&&p.test===n)return;
   if(p.type==='VariableDeclarator'&&p.init===n&&p.id.type==='Identifier'){reads(ix.bindings.get(p.id));return;}
   if(p.type==='AssignmentExpression'&&p.right===n&&p.operator==='='&&p.left.type==='Identifier'){
    reads(ix.bindings.get(p.left));flow(p);return;
   }
   if(p.type==='SequenceExpression'){if(p.expressions.at(-1)===n)flow(p);return;}
   if(p.type==='ConditionalExpression'||p.type==='LogicalExpression'){flow(p);return;}
   if(p.type==='ReturnStatement'){
    const fn=ix.owners.get(p);
    const declaration=ix.parents.get(fn),id=fn?.type==='FunctionDeclaration'?fn.id:declaration?.type==='VariableDeclarator'?declaration.id:null;
    const b=id?.type==='Identifier'?ix.bindings.get(id):null;
    if(!functions.has(fn?.type)||fn.async||fn.generator||!b||b.writes.length)fail(n);
    for(const ref of b.refs){const call=ix.parents.get(ref);if(call?.type!=='CallExpression'||call.callee!==ref||call.optional)fail(ref);flow(call);}
    if(fn.type==='FunctionDeclaration'&&b.refs.length&&b.refs.every(ref=>{const call=ix.parents.get(ref);return call?.type==='CallExpression'&&call.callee===ref&&callTestsDeviceFamily(call);}))replacements.set(fn,'');
    return;
   }
   if(p.type==='ExpressionStatement')return; // The value is discarded.
   fail(n);
  }
  flow(root);
  if(needsType){
   if(!familyLowered)fail(root);
   deviceParameter=true;
   if(!replacements.has(root))replacements.set(root,'void 0');
  }else replacements.set(root,'void 0');
 }
 function render(n){return replacements.get(n)??patch(source,n,render);}
 return {source:render(tree),deviceParameter,deviceTypeToken:deviceParameter?deviceTypeToken:null};
}
