import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {FixtureSearchParams,FixtureHeaders,FixtureBody,FixtureRequest,FixtureResponse,fixtureEvaluations,fixtureFunctionEvaluations} from './verification/fixtures.mjs';

// Independent fixture hosts. No converter/runtime template imports.
const input=JSON.parse(readFileSync(0,'utf8'));
// Preparse only fixture strings with the standard URL implementation. No host
// constructors/functions cross the VM boundary; unlisted dynamic URLs fail.
const urlValues={};
function collectURLs(value){
 if(typeof value==='string'){try{const u=new URL(value);urlValues[value]=Object.fromEntries(['href','origin','protocol','username','password','host','hostname','port','pathname','search','hash'].map(k=>[k,u[k]]));}catch{}}
 else if(value&&typeof value==='object')for(const v of Object.values(value))collectURLs(v);
}
collectURLs(input.fixture);
const nativeEvaluation=input.fixture.native_evaluation===true;
const context=vm.createContext({}, {codeGeneration:{strings:nativeEvaluation,wasm:false}});
process.on('unhandledRejection',error=>{
 try{vm.runInContext(`reject(${JSON.stringify(String(error?.message??error))})`,context,{timeout:500});}catch{}
});
// Only JSON text enters the realm; no callable host objects are injected.
vm.runInContext(`globalThis.fixture=${JSON.stringify(input.fixture)};globalThis.platform=${JSON.stringify(input.platform)};globalThis.sourceURL=${JSON.stringify(input.url)};globalThis.fixtureURLs=${JSON.stringify(urlValues)};`,context,{timeout:500});
const setup=String.raw`
const events={requests:[],storageWrites:[],notifications:[]}, store=new Map(Object.entries(fixture.storage??{}));
let finished=false, result, failure, httpIndex=0, completedObservation, fixtureError;
${input.side==='original'&&!nativeEvaluation?fixtureEvaluations(input.fixture):''}
const fixedTime=fixture.now??1893456000000, NativeDate=Date;let elapsed=0,timers=0,timerPending=false;
globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[fixedTime+elapsed]));}static now(){return fixedTime+elapsed;}};
// Explicit, sequential timer vectors only. This measures ordering against a
// virtual clock; runtime support itself is checked by the native device probe.
globalThis.setTimeout=()=>{fixtureError='Missing timer fixture';throw Error(fixtureError);};
if(fixture.timers)globalThis.setTimeout=(callback,delay=0)=>{
 if(timerPending){fixtureError='Concurrent timer fixtures are unsupported';throw Error(fixtureError);}
 if(typeof callback!=='function'||fixture.timers[timers++]!==delay){fixtureError='Missing timer fixture';throw Error(fixtureError);}
 timerPending=true;
 Promise.resolve().then(()=>{timerPending=false;if(finished)return;elapsed+=delay;try{callback();}catch(error){if(!finished)failure=String(error.message??error);}});
};
// Loon documents this API as a one-shot timer. Completed scripts release pending
// timers; never run a self-defence callback after the first completion snapshot.
if(fixture.timers&&platform==='loon')globalThis.setInterval=globalThis.setTimeout;
// Opt-in virtual event loop for HTTP deadlines racing against mocked I/O.
// All ready promise jobs settle before the next timer event. Pending deadlines
// need not fire once the original completion snapshot has been captured.
const timerQueue=new Map();let timerSerial=0;
if(fixture.event_loop){
 globalThis.setTimeout=(callback,delay=0,...args)=>{
  if(typeof callback!=='function'||!Number.isFinite(Number(delay))||timerSerial>=1000)throw Error('Unsupported timer fixture');
  const id=++timerSerial;timerQueue.set(id,{at:elapsed+Math.max(0,Number(delay)),callback,args});return id;
 };
 globalThis.clearTimeout=id=>timerQueue.delete(id);
}
globalThis.advanceTimers=()=>{
 if(!fixture.event_loop||finished||!timerQueue.size)return;
 const [id,event]=[...timerQueue].sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];timerQueue.delete(id);elapsed=event.at;
 try{event.callback(...event.args);}catch(error){if(!finished)failure=String(error.message??error);}
};
let seed=fixture.seed??12345;Math.random=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
const encode=s=>Uint8Array.from(unescape(encodeURIComponent(String(s))),c=>c.charCodeAt(0));
const decode=b=>decodeURIComponent(escape(String.fromCharCode(...new Uint8Array(b.buffer??b,b.byteOffset??0,b.byteLength))));
globalThis.TextEncoder=class{encode(s){return encode(s);}};
globalThis.TextDecoder=class{decode(b){return decode(b);}};
globalThis.console={log(){},warn(){},error(){},info(){},debug(){}};
globalThis.$log=()=>{};
const bytes=v=>v instanceof ArrayBuffer?Array.from(new Uint8Array(v)):ArrayBuffer.isView(v)?Array.from(new Uint8Array(v.buffer,v.byteOffset,v.byteLength)):v;
const Headers = ${FixtureHeaders.toString()};
globalThis.Headers=Headers;
globalThis.URLSearchParams=${FixtureSearchParams.toString()};
globalThis.URL=class{
 constructor(value,base){if(base!==undefined||!Object.hasOwn(fixtureURLs,value))throw Error('URL is outside the fixture model');Object.assign(this,fixtureURLs[value]);}
 toString(){return this.href;}
};
const FixtureBody=${FixtureBody.toString()};
globalThis.Request=${FixtureRequest.toString()};
globalThis.Response=${FixtureResponse.toString()};
const headers=v=>Object.fromEntries([...new Headers(v).entries()].map(([k,v])=>[k.toLowerCase(),v]).sort(([a],[b])=>a.localeCompare(b)));
const status=v=>typeof v==='string'?Number(v.match(/^HTTP\/[\d.]+\s+(\d{3})/)?.[1]??NaN):v;
const clean=(v)=>{
 if(!v||typeof v!=='object')return v;
 if(v instanceof ArrayBuffer||ArrayBuffer.isView(v))return bytes(v);
 if(Array.isArray(v))return v.map(clean);
 return Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,clean(v[k])]));
};
const defaultKey=()=>platform==='loon'?'egern-hub:loon:'+(fixture.name??'Fixture'):'egern-hub:'+sourceURL;
const key=k=>k??defaultKey();
const storage={get:k=>store.get(k)??null,set:(k,v)=>{if(finished)return;store.set(k,v);events.storageWrites.push({op:'set',key:k,value:v});},delete:k=>{if(finished)return;store.delete(k);events.storageWrites.push({op:'delete',key:k});}};
const notification=(title,subtitle,body,options={})=>{
 if(finished)return;
 const n={title,subtitle,body};if(typeof options==='string')options={url:options};
 const url=options.url??options.openUrl??options['open-url'];
 const clip=options['update-pasteboard']??(options.action==='clipboard'?options.text:undefined);
 if(url!==undefined)n.action={type:'openUrl',url};else if(clip!==undefined)n.action={type:'clipboard',text:clip};
 const media=options.mediaUrl??options['media-url'];if(media!==undefined)n.attachment={url:media};
 if(options['media-base64']!==undefined)n.attachment={base64:options['media-base64'],mimeType:options['media-base64-mime']};
 if(options.sound!==undefined)n.sound=options.sound;
 events.notifications.push(n);
};
function nativeMessage(raw){
 let used=false;
 const read=()=>{if(used)throw Error('Body stream already consumed');used=true;return raw.bytes?Uint8Array.from(raw.bytes):encode(raw.body??'');};
 return {url:raw.url,method:raw.method??'GET',status:raw.status??200,headers:new Headers(raw.headers),body:raw.body==null&&!raw.bytes?null:{},
 text:async()=>decode(read()),json:async()=>JSON.parse(decode(read())),arrayBuffer:async()=>read().buffer};
}
function network(method,url,options){
 if(finished)throw Error('Request after completion');
 const record={method:method.toUpperCase(),url,...options};
 if(fixture.timers)record.elapsedMs=elapsed;
 if(record.headers)record.headers=headers(record.headers);
 if(record.body!==undefined&&record.headers)for(const k of ['content-length','transfer-encoding'])delete record.headers[k];
 events.requests.push(clean(record));
 const reply=fixture.http?.[httpIndex++];
 if(!reply){fixtureError='Missing HTTP fixture';throw Error(fixtureError);}
 if(reply.url&&reply.url!==url){fixtureError='HTTP fixture URL mismatch';throw Error(fixtureError);}
 if(reply.error)throw Error(reply.error);
 return reply;
}
function oldNetwork(input,method,qx=false){
 const r=typeof input==='string'?{url:input}:{...input};
 const options={};
 if(r.body!==undefined)options.body=r.body;if(r.bodyBytes!==undefined)options.body=r.bodyBytes;
 if(r.headers)options.headers=r.headers;
 if(qx){const o=r.opts??{};options.redirect=o.redirection===false?'manual':'follow';options.credentials=o['auto-cookie']?'include':'omit';options.insecureTls=o['skip-cert-verify']??false;if(o.policy!==undefined)options.policy=o.policy;}
 else {options.timeout=r.timeout===undefined?5000:r.timeout*(platform==='loon'?1:1000);options.redirect=r['auto-redirect']===false?'manual':'follow';options.credentials=r['auto-cookie']===false?'omit':'include';if(r.policy!==undefined||r.node!==undefined)options.policy=r.policy??r.node;if(r['policy-descriptor']!==undefined)options.policyDescriptor=r['policy-descriptor'];if(r.insecure!==undefined)options.insecureTls=r.insecure;}
 return network(method??r.method??'GET',r.url,options);
}
const request=fixture.request??{url:'https://example.test/',method:'GET',headers:{}}, response=fixture.response;
const messageEntry=!['schedule','generic','network'].includes(fixture.entry_type);
// Only byte vectors prepared by the trusted fixture runner enter this realm.
// Unknown compression input is inconclusive, never simulated as success.
function compression(method,input){
 const data=bytes(input),entry=fixture.compression?.find(c=>c.method===method&&JSON.stringify(c.input)===JSON.stringify(data));
 if(!entry){fixtureError='Missing compression fixture';throw Error(fixtureError);}
 if(entry.error)throw Error(entry.error);
 return entry.output===null?null:Uint8Array.from(entry.output);
}
function observation(value,native=false){
 let mode='modify';value=value??{};
 // QX's official rewrite example calls $done(body) with a string. Other
 // platforms require independent evidence before accepting this shorthand.
 if(!native&&platform==='qx'&&typeof value==='string')value={body:value};
 if(value.aborted===true){mode='abort';value={};}
 if(value.syntheticResponse){mode='respond';value=value.syntheticResponse;}
 if(!native){if(value.abort){mode='abort';value={};}else if(value.response){mode='respond';value={status:200,...value.response};}else if(!response&&value.status!==undefined)mode='respond';}
 const message={...value};
 if(message.status!==undefined)message.status=status(message.status);
 if(message.bodyBytes!==undefined){message.body=message.bodyBytes;delete message.bodyBytes;}
 if(message.headers){message.headers=headers(message.headers);if(message.body!==undefined)for(const k of ['content-length','content-encoding','transfer-encoding'])delete message.headers[k];}
 return clean({mode,result:message,events,storage:Object.fromEntries(store)});
}
globalThis.ctx={request:messageEntry?nativeMessage(request):undefined,response:messageEntry&&response?nativeMessage(response):undefined,env:{argument:'argument' in fixture?(typeof fixture.argument==='object'?JSON.stringify(fixture.argument):fixture.argument):'',...(fixture.env??{})},script:{name:fixture.name??'Fixture'},app:{language:'zh-CN',version:'fixture'},device:fixture.device??{},cron:fixture.cron,
 compress:Object.fromEntries(['gzip','gunzip','inflate','deflate'].map(m=>[m,async input=>compression(m,input)])),
 storage,http:Object.fromEntries(['get','post','put','delete','head','options','patch'].map(m=>[m,async(url,o={})=>nativeMessage(network(m,url,o))])),
 notify:n=>{if(!finished)events.notifications.push(n);},respond:v=>({syntheticResponse:v}),abort:()=>({aborted:true}),lookupIP:ip=>fixture.geoip?.[ip]??null};
const oldMessage=raw=>{const b=raw.bytes?Uint8Array.from(raw.bytes):encode(raw.body??'');return {...raw,headers:{...(raw.headers??{})},...(platform==='qx'?{bodyBytes:b.buffer}:fixture.binary&&(raw.body!=null||raw.bytes)?{body:b,bodyBytes:b}: {})};};
globalThis.$request=messageEntry?oldMessage(request):undefined;globalThis.$response=messageEntry&&response?oldMessage(response):undefined;
globalThis.$argument='argument' in fixture?fixture.argument:'';
globalThis.$script={name:fixture.name??'Fixture',startTime:fixedTime/(platform==='loon'?1:1000),binaryBodyMode:!!fixture.binary};
globalThis.$environment={language:'zh-CN',variables:fixture.env??{},...(platform==='surge'?{'surge-version':'fixture'}:platform==='stash'?{'stash-version':'fixture'}:{}),...(fixture.legacy_environment??{})};
const device=fixture.device??{},oldAddress=v=>({primaryAddress:v?.address,primaryInterface:v?.interface,primaryRouter:v?.gateway});
globalThis.$network={wifi:device.wifi,v4:oldAddress(device.ipv4),v6:oldAddress(device.ipv6),dns:device.dnsServers,'cellular-data':device.cellular};
// Platform presence is independent of the converted script. Without $loon the
// original bundled client silently selected its Surge default in Loon tests.
if(platform==='loon')globalThis.$loon=fixture.legacy_loon??'fixture';
if(platform==='shadowrocket')globalThis.$rocket='fixture';
globalThis.$persistentStore={read:k=>storage.get(key(k)),write:(v,k)=>{if(v===null)storage.delete(key(k));else storage.set(key(k),v);return true;}};
globalThis.$prefs={valueForKey:k=>storage.get(key(k)),setValueForKey:(v,k)=>{storage.set(key(k),v);return true;},removeValueForKey:k=>{storage.delete(key(k));return true;}};
if(platform==='qx')globalThis.$notify=notification;else globalThis.$notification={post:notification};
globalThis.$utils={geoip:ip=>fixture.geoip?.[ip]?.country??null,ipasn:ip=>fixture.geoip?.[ip]?.asn??null,ipaso:ip=>fixture.geoip?.[ip]?.organization??null,
 ...Object.fromEntries(['ungzip','gzip','inflate','deflate'].map(m=>[m,input=>compression(m==='ungzip'?'gunzip':m,input)]))};
const stop=Symbol('host completion');
globalThis.$done=(v={})=>{if(!finished){completedObservation=observation(v);finished=true;}throw stop;};
if(platform!=='qx')globalThis.$httpClient=Object.fromEntries(['get','post','put','delete','head','options','patch'].map(m=>[m,(r,cb)=>{let reply,error;try{reply=oldNetwork(r,m);}catch(e){error=e.message;}Promise.resolve().then(()=>{if(error!==undefined){cb(error,null,null);return;}const input=typeof r==='string'?{}:r;const h=headers(reply.headers);const hs=input['full-header-mode']?Object.entries(h).flatMap(([field,value])=>(Array.isArray(value)?value:[value]).map(value=>({field,value}))):h;cb(null,{status:reply.status??200,statusCode:reply.status??200,headers:hs},input['binary-mode']?Uint8Array.from(reply.bytes??encode(reply.body??'')):reply.body??'');}).catch(e=>{if(e!==stop&&!finished)failure=String(e.message??e);});}]));
if(platform==='qx')globalThis.$task={fetch:async r=>{try{const reply=oldNetwork(r,undefined,true);return {statusCode:reply.status??200,headers:headers(reply.headers),body:reply.body??'',bodyBytes:Uint8Array.from(reply.bytes??encode(reply.body??'')).buffer};}catch(e){throw {error:e.message};}}};
globalThis.snapshot=()=>JSON.stringify(completedObservation??observation(result,true));
globalThis.state=()=>JSON.stringify({finished,failure,fixtureError:fixtureError||(finished&&fixture.timers&&timers!==fixture.timers.length?'Unused timer fixture':undefined),unusedHttp:(fixture.http?.length??0)-httpIndex});
globalThis.accept=v=>{result=v;completedObservation=observation(result,true);finished=true;};
globalThis.reject=e=>{if(!finished)failure=String(e?.message??e);};
`;
try {
 vm.runInContext(setup,context,{timeout:500});
 if(input.side==='original') {
   try{vm.runInContext('(function(){\n'+(nativeEvaluation?input.source:fixtureFunctionEvaluations(input.source))+'\n})();',context,{timeout:500});}catch(e){vm.runInContext(`reject(${JSON.stringify(String(e.message??e))})`,context,{timeout:500});}
 } else {
   const module=new vm.SourceTextModule(input.source,{context});
   await module.link(()=>{throw Error('External imports are not available in verification');});
   await module.evaluate({timeout:500});
   context.run=module.namespace.default;
   // Attach completion directly to the returned Promise. Wrapping entry in
   // another .then adopts it through extra jobs and can let detached work
   // mutate observations after the entry has already returned its result.
   vm.runInContext('Promise.resolve(run(ctx)).then(accept,reject)',context,{timeout:500});
 }
 let state;
 for(let tick=0;tick<100;tick++){
   await new Promise(resolve=>setImmediate(resolve));
   state=JSON.parse(vm.runInContext('state()',context,{timeout:500}));
   if(state.finished||state.failure)break;
   vm.runInContext('advanceTimers()',context,{timeout:500});
 }
 const output={observation:JSON.parse(vm.runInContext('snapshot()',context,{timeout:500})),unused_http:state.unusedHttp,fixture_error:state.fixtureError};
 if(!state.finished)output.error=state.failure??'Script did not complete';
 process.stdout.write(JSON.stringify(output));
} catch(error){process.stdout.write(JSON.stringify({error:String(error.message??error)}));}
