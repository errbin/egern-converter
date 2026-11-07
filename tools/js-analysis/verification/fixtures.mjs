import {parse} from '../core/syntax.mjs';
import {index,patch} from '../core/ast.mjs';

// Independent URLSearchParams fixture model. It runs entirely inside the VM;
// host constructors or callable objects are never injected into source code.
export class FixtureSearchParams {
 constructor(input=''){
  this.pairs=[];
  const text=value=>String(value).replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,'\uFFFD');
  if(typeof input==='string'){
   for(const pair of input.replace(/^\?/,'').split('&')){
    if(!pair)continue;
    const split=pair.indexOf('='),parts=split<0?[pair,'']:[pair.slice(0,split),pair.slice(split+1)];
    this.pairs.push(parts.map(value=>decodeURIComponent(value.replace(/\+/g,' '))));
   }
  }else if(input!=null&&typeof input[Symbol.iterator]==='function'){
   for(const entry of input){const pair=[...entry];if(pair.length!==2)throw new TypeError('Query pair needs two values');this.pairs.push(pair.map(text));}
  }else if(input!=null){for(const key of Object.keys(input))this.pairs.push([text(key),text(input[key])]);}
 }
 get size(){return this.pairs.length;}
 append(name,value){this.pairs.push([String(name),String(value)]);}
 delete(name,value){name=String(name);this.pairs=this.pairs.filter(([k,v])=>k!==name||(arguments.length>1&&v!==String(value)));}
 get(name){return this.pairs.find(([k])=>k===String(name))?.[1]??null;}
 getAll(name){return this.pairs.filter(([k])=>k===String(name)).map(([,v])=>v);}
 has(name,value){return this.pairs.some(([k,v])=>k===String(name)&&(arguments.length<2||v===String(value)));}
 set(name,value){name=String(name);value=String(value);let found=false;this.pairs=this.pairs.filter(pair=>{if(pair[0]!==name)return true;if(found)return false;found=true;pair[1]=value;return true;});if(!found)this.pairs.push([name,value]);}
 sort(){this.pairs.sort(([a],[b])=>a<b?-1:a>b?1:0);}
 *entries(){for(const pair of this.pairs)yield [...pair];}
 *keys(){for(const [key]of this.pairs)yield key;}
 *values(){for(const [,value]of this.pairs)yield value;}
 [Symbol.iterator](){return this.entries();}
 forEach(callback,receiver){for(const [key,value]of this.pairs)callback.call(receiver,value,key,this);}
 toString(){const encode=value=>encodeURIComponent(value).replace(/[!'()~]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase()).replace(/%20/g,'+');return this.pairs.map(pair=>pair.map(encode).join('=')).join('&');}
}

// Fixture host only: model Egern's documented case-insensitive property API.
// This is never imported by converted scripts or published with the website.
export class FixtureHeaders {
 constructor(value={}) {
  Object.defineProperty(this,'values',{value:new Map()});
  for(const [k,v] of value instanceof FixtureHeaders?value.entries():Object.entries(value))this.values.set(k,{name:k,value:Array.isArray(v)?v.map(String):String(v)});
  const find=k=>[...this.values.keys()].find(n=>n.toLowerCase()===String(k).toLowerCase());
  return new Proxy(this,{
   get:(t,k,receiver)=>{const found=typeof k==='string'?find(k):undefined;if(found!==undefined)return t.values.get(found).value;const v=Reflect.get(t,k);return typeof v==='function'?v.bind(receiver):v;},
   set:(t,k,v)=>{const found=find(k);t.values.set(found??k,{name:found??k,value:Array.isArray(v)?v.map(String):String(v)});return true;},
   deleteProperty:(t,k)=>{const found=find(k);return found===undefined||t.values.delete(found);},
   has:(t,k)=>typeof k==='string'&&find(k)!==undefined||Reflect.has(t,k),
   ownKeys:t=>['values',...t.values.keys()],
   getOwnPropertyDescriptor:(t,k)=>{const found=typeof k==='string'?find(k):undefined;return found===undefined?Reflect.getOwnPropertyDescriptor(t,k):{value:t.values.get(found).value,writable:true,enumerable:true,configurable:true};}
  });
 }
 find(k){return [...this.values.keys()].find(n=>n.toLowerCase()===String(k).toLowerCase());}
 get(k){const v=this.values.get(this.find(k))?.value;return v===undefined?null:Array.isArray(v)?v.join(', '):v;}
 getAll(k){const v=this.values.get(this.find(k))?.value;return v===undefined?[]:Array.isArray(v)?v:[v];}
 has(k){return this.find(k)!==undefined;}
 set(k,v){const name=this.find(k)??k;this.values.set(name,{name,value:Array.isArray(v)?v.map(String):String(v)});}
 append(k,v){this.set(k,[...this.getAll(k),String(v)]);}
 delete(k){this.values.delete(this.find(k));}
 *entries(){for(const {name,value} of this.values.values())yield [name,value];}
 [Symbol.iterator](){return this.entries();}
}

// Independent, deliberately limited Fetch body model for differential fixtures.
// Never emitted into converted resources. Unsupported inputs fail explicitly.
export class FixtureBody {
 constructor(body=null){
  this.bodyUsed=false;
  if(body==null)this._bytes=null;
  else if(typeof body==='string')this._bytes=new TextEncoder().encode(body);
  else if(body instanceof ArrayBuffer)this._bytes=new Uint8Array(body.slice(0));
  else if(ArrayBuffer.isView(body))this._bytes=new Uint8Array(body.buffer.slice(body.byteOffset,body.byteOffset+body.byteLength));
  else throw new TypeError('Fixture Fetch body supports strings and bytes only');
 }
 get body(){return this._bytes===null?null:{};}
 async arrayBuffer(){
  if(this.bodyUsed)throw new TypeError('Body already consumed');
  if(this._bytes!==null)this.bodyUsed=true;
  return this._bytes?.slice().buffer??new ArrayBuffer(0);
 }
 async text(){return new TextDecoder().decode(await this.arrayBuffer());}
 async json(){return JSON.parse(await this.text());}
}
export class FixtureResponse extends FixtureBody {
 constructor(body=null,init={}){
  super(body);this.url='';this.status=init.status??200;
  if(!Number.isInteger(this.status)||this.status<200||this.status>599)throw new RangeError('Invalid response status');
  if(body!=null&&[204,205,304].includes(this.status))throw new TypeError('Null-body response status');
  this.headers=new Headers(init.headers??{});
  if(typeof body==='string'&&!this.headers.has('content-type'))this.headers.set('content-type','text/plain;charset=UTF-8');
 }
}
export class FixtureRequest extends FixtureBody {
 constructor(url,init={}){
  if(typeof url!=='string')throw new TypeError('Fixture Request requires an absolute URL string');
  super(init.body);this.url=new URL(url).href;
  const method=String(init.method??'GET');
  if(!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(method)||['CONNECT','TRACE','TRACK'].includes(method.toUpperCase()))throw new TypeError('Invalid request method');
  this.method=['DELETE','GET','HEAD','OPTIONS','POST','PUT'].includes(method.toUpperCase())?method.toUpperCase():method;
  if(['GET','HEAD'].includes(this.method)&&this.body!==null)throw new TypeError('GET/HEAD cannot have a body');
  this.headers=new Headers(init.headers??{});
  if(typeof init.body==='string'&&!this.headers.has('content-type'))this.headers.set('content-type','text/plain;charset=UTF-8');
 }
}

// Independent original-side model for parenthesized JSON fixture text. Validate
// input as JSON before compiling a literal in the isolated VM; never enable
// string code generation or execute storage-provided statements/functions.

// Original-side fixture model: expose all visible lexical function declarations,
// independently of the compiler's finite-table proof. Unknown strings still go
// through the JSON-only model and cannot execute code in the fixture realm.
export function fixtureFunctionEvaluations(source){
 const ix=index(parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true})),replacements=new WeakMap();
 for(const call of ix.nodes)if(call.type==='CallExpression'&&ix.free(call.callee,'eval')&&call.arguments.length===1){
  const visible=new Map();
  for(let s=ix.scopes.get(call);s;s=s.parent)for(const [name,b]of s.names)if(!visible.has(name))visible.set(name,b);
  const names=[...visible].filter(([name,b])=>b.init?.type==='FunctionDeclaration').map(([name])=>name);
  if(names.length)replacements.set(call,`(value => {if(typeof value !== 'string')return value;switch(value){${names.map(name=>'case '+JSON.stringify(name)+': return '+name+';').join('')}default:return eval(value);}})(${source.slice(call.arguments[0].start,call.arguments[0].end)})`);
 }
 const render=n=>replacements.has(n)?replacements.get(n):patch(source,n,render);return render(ix.nodes[0]);
}
export function fixtureEvaluations(fixture){
 const inputs=new Set();
 function collect(value){
  if(typeof value==='string'&&value.length<=65536){try{JSON.parse(value);inputs.add(value);}catch{}}
  else if(value&&typeof value==='object')for(const child of Object.values(value))collect(child);
 }
 collect(fixture);
 const literal=raw=>{try{parse('('+raw+')',{ecmaVersion:'latest'});return `() => (${raw})`;}catch{return `() => {throw new SyntaxError('Invalid JSON object literal');}`;}};
 return `const fixtureExpressions = new Map([${[...inputs].map(raw=>`[${JSON.stringify('('+raw+')')}, ${literal(raw)}]`).join(',')}]);
 globalThis.eval = value => {
   if (typeof value !== 'string') return value;
   const literal = fixtureExpressions.get(value);
   if (!literal) { fixtureError = 'Dynamic evaluation is outside the JSON fixture model'; throw new Error(fixtureError); }
   return literal();
 };`;
}
