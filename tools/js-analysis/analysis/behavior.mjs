import {parse} from '../core/syntax.mjs';

// A bounded, flow-insensitive summary of output data and observable API calls.
// Parse original source only. Never run scripts, decoders, imports or callbacks.

const functions=new Set(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression']);
const property=n=>n?.computed?(n.property?.type==='Literal'?String(n.property.value):null):n?.property?.name;
const key=n=>n.computed?(n.key.type==='Literal'?String(n.key.value):null):(n.key.name??String(n.key.value));
const children=n=>Object.values(n).flatMap(v=>Array.isArray(v)?v.filter(x=>x?.type):v?.type?[v]:[]);

export function behavior(source) {
  let tree;
  try {tree=parse(source,{ecmaVersion:'latest',sourceType:'module',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true,locations:true});}
  catch(error) {return {effects:[],fields:[],evidence:[],limits:['语法无法静态解析：'+error.message]};}
  const scopes=new WeakMap(), owners=new WeakMap(), nodes=[], fnScopes=new WeakMap();
  const root={parent:null,owner:null,names:new Map(),fn:true};
  const bind=(pattern,scope,definition)=>{
    if(!pattern)return;
    if(pattern.type==='Identifier') {
      if(!scope.names.has(pattern.name))scope.names.set(pattern.name,{defs:[],mutations:[],aliases:[]});
      if(definition)scope.names.get(pattern.name).defs.push(definition);
    } else if(pattern.type==='RestElement')bind(pattern.argument,scope);
    else if(pattern.type==='AssignmentPattern')bind(pattern.left,scope,pattern.right);
    else if(pattern.type==='ArrayPattern')pattern.elements.forEach(x=>bind(x,scope));
    else if(pattern.type==='ObjectPattern')pattern.properties.forEach(x=>bind(x.type==='RestElement'?x.argument:x.value,scope));
  };
  const stack=[{node:tree,scope:root}];
  while(stack.length) {
    let {node:n,scope}=stack.pop();
    if(n.type==='FunctionDeclaration')bind(n.id,scope,n);
    if(functions.has(n.type)) {
      scope={parent:scope,owner:n,names:new Map(),fn:true};fnScopes.set(n,scope);
      if(n.type==='FunctionExpression')bind(n.id,scope,n);
      n.params.forEach(p=>bind(p,scope));
    } else if(['BlockStatement','CatchClause','ForStatement','ForInStatement','ForOfStatement','SwitchStatement'].includes(n.type)) {
      scope={parent:scope,owner:scope.owner,names:new Map(),fn:false};
    }
    if(n.type==='CatchClause')bind(n.param,scope);
    if(n.type==='VariableDeclaration') {
      let target=scope;if(n.kind==='var')while(!target.fn)target=target.parent;
      n.declarations.forEach(d=>bind(d.id,target,d.init));
    }
    scopes.set(n,scope);owners.set(n,scope.owner);nodes.push(n);
    for(const child of children(n).reverse())stack.push({node:child,scope});
  }
  const binding=n=>{
    if(n?.type!=='Identifier')return null;
    for(let s=scopes.get(n);s;s=s.parent)if(s.names.has(n.name))return s.names.get(n.name);
    return null;
  };
  const free=(n,name)=>n?.type==='Identifier'&&n.name===name&&!binding(n);
  const base=n=>n?.type==='MemberExpression'?base(n.object):n;
  const chain=n=>{
    if(n?.type==='ChainExpression')return chain(n.expression);
    if(n?.type==='Identifier')return [n];
    if(n?.type==='MemberExpression') {const head=chain(n.object),part=property(n);return head&&part?[...head,part]:null;}
    return null;
  };
  const defs=n=>n?.type==='Identifier'?(binding(n)?.defs??[]):functions.has(n?.type)?[n]:[];
  const entries=new Set();
  for(const n of nodes)if(n.type==='ExportDefaultDeclaration')for(const fn of defs(n.declaration))if(functions.has(fn.type))entries.add(fn);
  const active=new Set([null,...entries]);
  // Only top-level/entry-point calls, their local callees and callbacks are considered.
  for(let pass=0;pass<16;pass++) {
    let changed=false;
    for(const n of nodes)if(n.type==='CallExpression'&&active.has(owners.get(n))) {
      for(const arg of [n.callee,...n.arguments])for(const fn of defs(arg))if(functions.has(fn.type)&&!active.has(fn)) {active.add(fn);changed=true;}
    }
    if(!changed)break;
  }
  for(const n of nodes)if(active.has(owners.get(n))) {
    if(n.type==='AssignmentExpression'&&n.left.type==='Identifier')binding(n.left)?.defs.push(n.right);
    let target;
    if(n.type==='AssignmentExpression'&&n.left.type==='MemberExpression')target=n.left.object;
    if(n.type==='UnaryExpression'&&n.operator==='delete'&&n.argument.type==='MemberExpression')target=n.argument.object;
    if(n.type==='CallExpression'&&n.callee.type==='MemberExpression') {
      if(free(n.callee.object,'Object')&&property(n.callee)==='assign')target=n.arguments[0];
      else if(['push','pop','shift','unshift','splice','sort','reverse'].includes(property(n.callee)))target=n.callee.object;
    }
    if(target)binding(base(target))?.mutations.push(n);
  }
  const objectLike=(n,seen=new Set())=>{
    if(!n)return false;
    if(['ObjectExpression','ArrayExpression'].includes(n.type))return true;
    if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&free(n.callee.object,'JSON')&&property(n.callee)==='parse')return true;
    if(n.type==='MemberExpression'&&['headers'].includes(property(n))&&['$request','$response'].some(name=>free(n.object,name)))return true;
    if(n.type==='Identifier') {const b=binding(n);if(!b||seen.has(b))return false;seen.add(b);return b.defs.some(d=>objectLike(d,seen));}
    if(n.type==='MemberExpression')return objectLike(n.object,seen);
    return false;
  };
  for(const n of nodes)if(active.has(owners.get(n))) {
    const left=n.type==='VariableDeclarator'?n.id:n.type==='AssignmentExpression'?n.left:null;
    const right=n.type==='VariableDeclarator'?n.init:n.type==='AssignmentExpression'?n.right:null;
    const a=binding(left),target=base(right),b=binding(target);
    if(a&&b&&a!==b&&objectLike(target)) {a.aliases.push(target);b.aliases.push(left);}
  }
  const effects=new Set(), fields=new Set(), evidence=[], limits=new Set();
  const record=(effect,n,field)=>{
    effects.add(effect);
    if(field&&field.length<=80)fields.add(field);
    if(evidence.length<80&&!evidence.some(e=>e.effect===effect&&e.line===n.loc.start.line&&e.field===field))
      evidence.push({effect,line:n.loc.start.line,...(field?{field}:{} )});
  };
  const fieldsIn=(value,n)=>{
    if(Array.isArray(value))value.slice(0,32).forEach(v=>fieldsIn(v,n));
    else if(value&&typeof value==='object')for(const [k,v] of Object.entries(value).slice(0,80)) {record('body_fields',n,k);fieldsIn(v,n);}
  };
  const origin=n=>{
    const parts=chain(n);if(!parts)return '';
    const [id,...path]=parts;
    if(!binding(id)&&['$request','$response'].includes(id.name))return [id.name.slice(1),...path].join('.');
    for(const fn of entries)if(fn.params[0]?.type==='Identifier'&&binding(id)===fnScopes.get(fn).names.get(fn.params[0].name))return path.join('.');
    return '';
  };
  const returns=fn=>fn.body.type==='BlockStatement'?nodes.filter(n=>n.type==='ReturnStatement'&&owners.get(n)===fn).map(n=>n.argument):[fn.body];
  function trace(n,part,seen=new Set(),depth=0) {
    if(!n)return;
    if(depth>32){limits.add('数据流追踪达到深度上限');return;}
    const visit=(value,slot=part)=>trace(value,slot,seen,depth+1);
    if(n.type==='Identifier') {
      const b=binding(n);if(!b||seen.has(b))return;
      seen.add(b);b.defs.forEach(value=>visit(value));b.aliases.forEach(value=>visit(value));
      for(const m of b.mutations) {
        if(m.type==='AssignmentExpression') {
          record(part==='body'?'body_fields':part+'_write',m,property(m.left));visit(m.right);
        } else if(m.type==='UnaryExpression')record(part==='body'?'body_delete':part+'_write',m,property(m.argument));
        else if(property(m.callee)==='assign')m.arguments.slice(1).forEach(value=>visit(value));
        else record('array_edit',m);
      }
      return;
    }
    if(n.type==='ChainExpression'||n.type==='AwaitExpression')return visit(n.expression??n.argument);
    if(n.type==='MemberExpression') {const from=origin(n);if(from)record('read_'+from,n);else visit(n.object);return;}
    if(n.type==='ObjectExpression') {
      record(part==='body'?'body_construct':part+'_write',n);
      for(const p of n.properties) {
        if(p.type==='SpreadElement'){visit(p.argument);continue;}
        if(part==='body')record('body_fields',p,key(p));
        visit(p.value);
      }
      return;
    }
    if(n.type==='ArrayExpression') {record('body_construct',n);n.elements.forEach(v=>visit(v));return;}
    if(n.type==='Literal') {
      if(part==='body')record('body_constant',n);
      if(part==='body'&&typeof n.value==='string') {
        if(/^\s*<!doctype html|^\s*<html\b/i.test(n.value))record('html_output',n);
        try {fieldsIn(JSON.parse(n.value),n);}catch{}
      }
      return;
    }
    if(n.type==='CallExpression') {
      const callee=n.callee,method=callee.type==='MemberExpression'?property(callee):'';
      if(callee.type==='MemberExpression'&&free(callee.object,'JSON')&&['parse','stringify'].includes(method)) {
        record(method==='parse'?'json_parse':'json_stringify',n);visit(n.arguments[0]);return;
      }
      if(['replace','replaceAll','filter','map','concat','slice','join','split'].includes(method)) {
        if(['replace','replaceAll'].includes(method)) {
          record(part+'_replace',n);
          for(const arg of n.arguments)if(arg.type==='Literal') {
            const text=typeof arg.value==='string'?arg.value:arg.regex?.pattern??'';
            for(const match of text.matchAll(/["']([\w.-]+)["']\s*:/g))if(part==='body')record('body_fields',arg,match[1]);
          }
        } else if(['filter','map'].includes(method))record('array_'+method,n);
        visit(callee.object);
        for(const fn of defs(n.arguments[0]))if(functions.has(fn.type))returns(fn).forEach(value=>visit(value));
        return;
      }
      if(['text','json','arrayBuffer'].includes(method)&&/^(request|response)$/.test(origin(callee.object))) {
        record('read_'+origin(callee.object)+'.body',n);if(method==='json')record('json_parse',n);return;
      }
      const local=defs(callee).filter(fn=>functions.has(fn.type));
      if(local.length) {for(const fn of local)returns(fn).forEach(value=>visit(value));return;}
      if(free(callee,'String')){visit(n.arguments[0]);return;}
      limits.add('部分返回值经过未展开的函数调用');return;
    }
    if(n.type==='ConditionalExpression'){visit(n.consequent);visit(n.alternate);return;}
    if(n.type==='AssignmentExpression'){visit(n.right);return;}
    if(n.type==='SequenceExpression'){visit(n.expressions.at(-1));return;}
    if(n.type==='TemplateLiteral'&&part==='body'&&n.quasis.some(q=>/<(?:html|body|!doctype)\b/i.test(q.value.raw)))record('html_output',n);
    for(const child of children(n))if(!functions.has(child.type))visit(child);
  }
  function message(n,seen=new Set()) {
    if(!n)return;
    if(n.type==='AwaitExpression')return message(n.argument,seen);
    if(n.type==='Identifier') {const b=binding(n);if(b&&!seen.has(b)){seen.add(b);b.defs.forEach(v=>message(v,seen));}return;}
    if(n.type==='ConditionalExpression'){message(n.consequent,seen);message(n.alternate,seen);return;}
    if(n.type!=='ObjectExpression'){limits.add('部分完成结果不是可展开的对象');return;}
    for(const p of n.properties)if(p.type==='Property') {
      const name=key(p);
      if(name==='response'){message(p.value,seen);continue;}
      if(['body','bodyBytes','headers','url','status','statusCode'].includes(name)) {
        const part=name==='bodyBytes'?'body':name;
        record('output_'+part,p);trace(p.value,part);
        if(name==='url')record('url_write',p);
        if(['status','statusCode'].includes(name))record('status_write',p);
      }
    }
  }
  for(const n of nodes)if(active.has(owners.get(n))) {
    if(n.type==='CallExpression') {
      const c=chain(n.callee),id=c?.[0],path=c?.slice(1).join('.');
      if(free(n.callee,'$done')){record('complete',n);message(n.arguments[0]);}
      if(id&&!binding(id)) {
        if((id.name==='$httpClient'&&/^(get|post|put|delete|patch|head|options)$/.test(path))||(id.name==='$task'&&path==='fetch'))record('network',n);
        if((id.name==='$persistentStore'&&path==='write')||(id.name==='$prefs'&&/^(setValueForKey|removeValueForKey)$/.test(path)))record('storage_write',n);
        if((id.name==='$notification'&&path==='post')||id.name==='$notify')record('notification',n);
        if(['eval','Function'].includes(id.name))limits.add('动态执行内容未展开');
      }
    }
    if(n.type==='ReturnStatement'&&entries.has(owners.get(n)))message(n.argument);
  }
  for(const fn of entries)if(fn.body.type!=='BlockStatement')message(fn.body);
  return {effects:[...effects].sort(),fields:[...fields].sort().slice(0,100),evidence,limits:[...limits].sort(),analysis:'static-output-flow-v1'};
}
