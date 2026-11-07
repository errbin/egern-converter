import {parse as acornParse} from '../vendor/acorn.mjs';

// Reuse immutable parse trees during one synchronous native compilation only.
// Callbacks and parser extension options keep Acorn's normal behavior.
let active=null;
export function withSyntaxCache(run){
 const previous=active;active=new Map();
 try{return run();}finally{active=previous;}
}
export function parse(source,options={}){
 const {onComment,...plain}=options;
 if(!active||onComment!==undefined&&!Array.isArray(onComment)||Object.values(plain).some(value=>value!==null&&typeof value==='object'||typeof value==='function'))return acornParse(source,options);
 const key=JSON.stringify(Object.entries(plain).sort(([a],[b])=>a.localeCompare(b)))+'\0'+source;
 let record=active.get(key);
 if(record)active.delete(key);
 else{
  const comments=[],tree=acornParse(source,{...plain,onComment:comments});record={tree,comments};
 }
 active.set(key,record);
 if(onComment)onComment.push(...record.comments.map(comment=>({...comment})));
 // Large bundled files can have large trees. Retain only adjacent versions.
 if(active.size>2)active.delete(active.keys().next().value);
 return record.tree;
}
