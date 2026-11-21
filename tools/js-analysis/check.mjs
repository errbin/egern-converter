import {parse} from './core/syntax.mjs';
import {assertNoUnverifiedHeaderCalls} from './compiler/native.mjs';
import {readFileSync} from 'node:fs';

const FORBIDDEN=new Set([
  'FunctionDeclaration','FunctionExpression','ArrowFunctionExpression','ClassDeclaration',
  'ClassExpression','AwaitExpression','ImportDeclaration','ExportNamedDeclaration',
  'ExportDefaultDeclaration','ForStatement','ForInStatement','ForOfStatement','WhileStatement',
  'DoWhileStatement','IfStatement','SwitchStatement','TryStatement','ThrowStatement',
  'ConditionalExpression','LogicalExpression','SequenceExpression','NewExpression',
  'TaggedTemplateExpression','UpdateExpression','SpreadElement','YieldExpression','MetaProperty',
]);

function walkNodes(node,visit){
  if(!node||typeof node!=='object')return;
  if(node.type)visit(node);
  for(const [key,value] of Object.entries(node)){
    if(key==='loc')continue;
    if(Array.isArray(value))value.forEach(child=>walkNodes(child,visit));
    else if(value&&typeof value==='object')walkNodes(value,visit);
  }
}

function memberPath(node){
  if(node?.type!=='MemberExpression')return null;
  const parts=[];
  let base=node;
  while(base?.type==='MemberExpression'){
    if(base.computed){
      if(base.property.type!=='Literal'||typeof base.property.value!=='string')return null;
      parts.unshift(base.property.value);
    }else{
      if(base.property.type!=='Identifier')return null;
      parts.unshift(base.property.name);
    }
    base=base.object;
  }
  // `obj.__proto__ = value` 改的是原型而不是自有属性；jq 的 setpath 会写成
  // 普通键，两者在 JSON.stringify 后不等价。
  if(parts.includes('__proto__'))return null;
  return base?.type==='Identifier'?[base.name,...parts]:null;
}

function staticValue(node,bindings,seen=new Set()){
  if(!node)return {ok:false};
  if(node.type==='Literal'&&!node.regex&&
     (node.value===null||['string','number','boolean'].includes(typeof node.value)))
    return {ok:true,value:node.value};
  if(node.type==='UnaryExpression'&&['+','-'].includes(node.operator)&&
     node.argument.type==='Literal'&&typeof node.argument.value==='number')
    return {ok:true,value:node.operator==='-'?-node.argument.value:node.argument.value};
  if(node.type==='Identifier'){
    const binding=bindings.get(node.name);
    if(!binding||binding.kind!=='const'||!binding.init||seen.has(binding))return {ok:false};
    seen.add(binding);
    return staticValue(binding.init,bindings,seen);
  }
  if(node.type==='ArrayExpression'){
    const value=[];
    for(const element of node.elements){
      if(!element)return {ok:false};
      const result=staticValue(element,bindings,seen);
      if(!result.ok)return result;
      value.push(result.value);
    }
    return {ok:true,value};
  }
  if(node.type==='ObjectExpression'){
    const value={};
    for(const property of node.properties){
      if(property.type!=='Property'||property.kind!=='init'||property.method||
         property.computed||property.shorthand)return {ok:false};
      const key=property.key.type==='Identifier'?property.key.name:
        property.key.type==='Literal'&&typeof property.key.value==='string'?property.key.value:null;
      if(key===null||key==='__proto__')return {ok:false};
      const result=staticValue(property.value,bindings,seen);
      if(!result.ok)return result;
      value[key]=result.value;
    }
    return {ok:true,value};
  }
  return {ok:false};
}

function callName(call){
  const callee=call?.callee;
  if(callee?.type==='Identifier')return callee.name;
  const path=memberPath(callee)?.join('.');
  return path==='JSON.parse'||path==='JSON.stringify'?path:null;
}

function propertyMap(objectExpression){
  const result=new Map();
  for(const property of objectExpression.properties){
    if(property.type!=='Property'||property.kind!=='init'||property.method||
       property.computed)return null;
    const key=property.key.type==='Identifier'?property.key.name:
      property.key.type==='Literal'&&typeof property.key.value==='string'?property.key.value:null;
    if(key===null||result.has(key))return null;
    // 简写属性 `{headers}` 等价于 `{headers: headers}`。
    result.set(key,property.shorthand?{type:'Identifier',name:key}:property.value);
  }
  return result;
}

function pathsOverlap(left,right){
  const length=Math.min(left.length,right.length);
  for(let index=0;index<length;index++)if(left[index]!==right[index])return false;
  return true;
}

function guardedFilter(operations){
  // 逐条模拟 JS 的顺序赋值：任一路径在源对象中不可写时，原脚本会抛错并
  // 保留响应；这里用 try/catch 原样返回输入，避免 jq 自动补出中间对象。
  const steps=operations.map(operation=>{
    // operation.jsonPath 已去掉 JS 变量名，只保留响应 JSON 的实际路径。
    const path=operation.jsonPath;
    const parent=path.slice(0,-1);
    const typeExpression=parent.length?`(getpath(${JSON.stringify(parent)}) | type)`:'type';
    const action=operation.op==='delete'?
      `delpaths([${JSON.stringify(path)}])`:
      `setpath(${JSON.stringify(path)}; ${JSON.stringify(operation.value)})`;
    // 非严格模式下，基本类型/数组上的命名属性操作不会抛错，也不会进入
    // JSON.stringify；null/undefined 才会中止整个脚本。保留这两种分支。
    return `if ${typeExpression} == "object" then ${action} `+
      `elif ${typeExpression} == "null" then error("declarative-abort") else . end`;
  });
  return `. as $orig | try (${steps.join(' | ')}) catch $orig`;
}

function headersTarget(path){
  const name=path?.join('.');
  if(name==='$response.headers'||name==='ctx.response.headers')return 'response';
  if(name==='$request.headers'||name==='ctx.request.headers')return 'request';
  return null;
}

function classifyHeaders(tree,done,doneProperties){
  const bindings=new Map();
  let headerName=null,headerType=null;
  const operations=[];
  let finished=false;
  for(const statement of tree.body){
    if(finished)return null;
    if(statement.type==='VariableDeclaration'){
      if(statement.declarations.length!==1)return null;
      const declaration=statement.declarations[0];
      const type=headersTarget(memberPath(declaration.init));
      if(declaration.id.type!=='Identifier'||!type||bindings.size)return null;
      bindings.set(declaration.id.name,{kind:statement.kind,type});
      headerName=declaration.id.name;
      headerType=type;
      continue;
    }
    if(statement.type!=='ExpressionStatement'||!statement.expression)return null;
    const expression=statement.expression;
    if(expression===done){finished=true;continue;}
    if(expression.type==='AssignmentExpression'&&expression.operator==='='&&
       expression.left.type==='MemberExpression'){
      const path=memberPath(expression.left);
      if(!path||path.length!==2||path[0]!==headerName)return null;
      if(!bindings.has(headerName))return null;
      const value=staticValue(expression.right,bindings);
      if(!value.ok||typeof value.value!=='string')return null;
      operations.push({op:'set',name:path[1],value:value.value});
      continue;
    }
    if(expression.type==='UnaryExpression'&&expression.operator==='delete'&&
       expression.argument.type==='MemberExpression'){
      const path=memberPath(expression.argument);
      if(!path||path.length!==2||path[0]!==headerName)return null;
      if(!bindings.has(headerName))return null;
      operations.push({op:'delete',name:path[1]});
      continue;
    }
    return null;
  }
  const output=doneProperties.get('headers');
  if(!operations.length||output?.type!=='Identifier'||output.name!==headerName)return null;
  return {kind:'header',headers_type:headerType,operations};
}

function classifyDeclarative(source){
  let tree;
  try{
    tree=parse(source,{ecmaVersion:'latest',sourceType:'script',allowReturnOutsideFunction:true});
  }catch{
    return {kind:'unsafe'};
  }
  const first=tree.body?.[0];
  if(first?.type==='ExpressionStatement'&&first.expression?.type==='Literal'&&
     first.expression.value==='use strict')return {kind:'unsafe'};
  const nodes=[];
  walkNodes(tree,node=>nodes.push(node));
  if(nodes.some(node=>FORBIDDEN.has(node.type)||(node.type==='Literal'&&node.regex)))
    return {kind:'unsafe'};
  const calls=nodes.filter(node=>node.type==='CallExpression');
  if(calls.some(node=>!['$done','JSON.parse','JSON.stringify'].includes(callName(node))))
    return {kind:'unsafe'};
  const dones=calls.filter(node=>callName(node)==='$done');
  if(dones.length!==1)return {kind:'unsafe'};
  const done=dones[0];
  if(done.arguments.length!==1||done.arguments[0].type!=='ObjectExpression')return {kind:'unsafe'};
  const doneProperties=propertyMap(done.arguments[0]);
  if(!doneProperties)return {kind:'unsafe'};
  if([...doneProperties.keys()].some(key=>!['body','status','headers'].includes(key)))
    return {kind:'unsafe'};

  const statusNode=doneProperties.get('status');
  if(statusNode&&!doneProperties.has('body')&&!doneProperties.has('headers')){
    if(statusNode.type==='Literal'&&Number.isInteger(statusNode.value))
      return {kind:'reject',status:statusNode.value};
    if(statusNode.type==='Literal'&&typeof statusNode.value==='string'){
      const match=/^HTTP\/1\.[01]\s+(\d{3})\b/.exec(statusNode.value);
      if(match)return {kind:'reject',status:Number(match[1])};
    }
    return {kind:'unsafe'};
  }

  if(statusNode){
    const status=statusNode.type==='Literal'&&Number.isInteger(statusNode.value)?
      statusNode.value:null;
    const headersNode=doneProperties.get('headers');
    if(status===null||doneProperties.has('body')||!headersNode||
       headersNode.type!=='ObjectExpression')return {kind:'unsafe'};
    const headers=staticValue(headersNode,new Map());
    if(!headers.ok||!headers.value||typeof headers.value!=='object'||
       Array.isArray(headers.value))return {kind:'unsafe'};
    const keys=Object.keys(headers.value);
    if(keys.length!==1||keys[0].toLowerCase()!=='location'||
       typeof headers.value[keys[0]]!=='string')return {kind:'unsafe'};
    if(![301,302,307,308].includes(status))return {kind:'unsafe'};
    return {kind:'redirect',status,location:headers.value[keys[0]]};
  }

  if(doneProperties.has('headers')&&!doneProperties.has('status')&&!doneProperties.has('body'))
    return classifyHeaders(tree,done,doneProperties)||{kind:'unsafe'};

  const bindings=new Map();
  const operations=[];
  let parsed=null;
  let finished=false;
  for(const statement of tree.body){
    if(finished)return {kind:'unsafe'};
    if(statement.type==='VariableDeclaration'){
      for(const declaration of statement.declarations){
        if(declaration.id.type!=='Identifier'||bindings.has(declaration.id.name))
          return {kind:'unsafe'};
        // 只接受无副作用字面量或待校验的 JSON.parse；解构、成员读取等
        // 都可能在上游对象异常时改变控制流，不能折叠为固定规则。
        if(declaration.init){
          const call=declaration.init.type==='CallExpression'?callName(declaration.init):null;
          if(call!=='JSON.parse'&&!staticValue(declaration.init,bindings).ok)
            return {kind:'unsafe'};
        }
        bindings.set(declaration.id.name,{kind:statement.kind,init:declaration.init});
      }
      continue;
    }
    let expression=null;
    if(statement.type==='ExpressionStatement')expression=statement.expression;
    else if(statement.type==='ReturnStatement')expression=statement.argument;
    else return {kind:'unsafe'};
    if(expression?.type==='CallExpression'&&expression===done){
      finished=true;
      continue;
    }
    if(expression?.type==='UnaryExpression'&&expression.operator==='delete'&&
       expression.argument.type==='MemberExpression'){
      const path=memberPath(expression.argument);
      if(!path)return {kind:'unsafe'};
      operations.push({op:'delete',path});
      continue;
    }
    if(expression?.type==='AssignmentExpression'&&expression.operator==='='&&
       expression.left.type==='MemberExpression'){
      const path=memberPath(expression.left);
      if(!path)return {kind:'unsafe'};
      const value=staticValue(expression.right,bindings);
      if(!value.ok)return {kind:'unsafe'};
      operations.push({op:'set',path,value:value.value});
      continue;
    }
    if(expression?.type==='AssignmentExpression'&&expression.operator==='='&&
       expression.left.type==='Identifier'){
      const value=staticValue(expression.right,bindings);
      if(!value.ok)return {kind:'unsafe'};
      operations.push({op:'whole',name:expression.left.name,value:value.value});
      continue;
    }
    return {kind:'unsafe'};
  }
  if(!finished)return {kind:'unsafe'};

  const parses=calls.filter(node=>callName(node)==='JSON.parse');
  if(parses.length>1)return {kind:'unsafe'};
  if(parses.length){
    const parseCall=parses[0];
    const declaration=nodes.find(node=>node.type==='VariableDeclarator'&&node.init===parseCall);
    const sourcePath=memberPath(parseCall.arguments[0]);
    if(!declaration||declaration.id.type!=='Identifier'||parseCall.arguments.length!==1||
       !sourcePath||!['$response.body','$request.body'].includes(sourcePath.join('.')))
      return {kind:'unsafe'};
    parsed={name:declaration.id.name,phase:sourcePath[0].replace('$','')};
  }

  for(const operation of operations){
    if(operation.op==='whole'){
      if(!parsed||operation.name!==parsed.name)return {kind:'unsafe'};
      continue;
    }
    if(!parsed||operation.path[0]!==parsed.name)return {kind:'unsafe'};
    const jsonPath=operation.path.slice(1);
    if(!jsonPath.length)return {kind:'unsafe'};
    operation.jsonPath=jsonPath;
  }
  for(let left=0;left<operations.length;left++){
    for(let right=left+1;right<operations.length;right++){
      const a=operations[left],b=operations[right];
      if(a.op==='whole'||b.op==='whole')return {kind:'unsafe'};
      if(pathsOverlap(a.jsonPath,b.jsonPath))return {kind:'unsafe'};
    }
  }

  const bodyNode=doneProperties.get('body');
  if(!bodyNode)return {kind:'unsafe'};

  let fixed=null;
  if(bodyNode.type==='CallExpression'&&callName(bodyNode)==='JSON.stringify'&&
     bodyNode.arguments.length===1){
    const value=staticValue(bodyNode.arguments[0],bindings);
    if(value.ok)fixed={body:JSON.stringify(value.value),json:true};
  }else{
    const value=staticValue(bodyNode,bindings);
    if(value.ok&&typeof value.value==='string')fixed={body:value.value,json:false};
  }
  if(fixed&&!operations.length)return {kind:'map_local',...fixed};

  if(!parsed)return {kind:'unsafe'};
  const whole=operations.find(operation=>operation.op==='whole'&&operation.name===parsed.name);
  if(whole&&operations.length===1&&bodyNode.type==='CallExpression'&&
     callName(bodyNode)==='JSON.stringify'&&bodyNode.arguments.length===1&&
     bodyNode.arguments[0].type==='Identifier'&&bodyNode.arguments[0].name===parsed.name)
    return {kind:'map_local',body:JSON.stringify(whole.value),json:true,fixed_from_input:true};
  if(bodyNode.type!=='CallExpression'||callName(bodyNode)!=='JSON.stringify'||
     bodyNode.arguments.length!==1||bodyNode.arguments[0].type!=='Identifier'||
     bodyNode.arguments[0].name!==parsed.name)return {kind:'unsafe'};
  if(!operations.length||operations.some(operation=>operation.op==='whole'))
    return {kind:'unsafe'};
  return {
    kind:parsed.phase==='response'?'response_jq':'request_jq',
    filter:guardedFilter(operations),
  };
}

if(process.argv.includes('--header-calls')){
  // 供差分验证复用编译器的 Headers 污点检查；存在未验证调用或语法错误时
  // 以非零状态退出，调用方据此区分宿主方法与普通集合方法。
  try{assertNoUnverifiedHeaderCalls(readFileSync(0,'utf8'));}
  catch{process.exitCode=2;}
}else if(process.argv.includes('--declarative')){
  // 只做保守的静态判定：任何函数、分支、正则或未白名单调用都保留 scriptings。
  const scripts=JSON.parse(readFileSync(0,'utf8'));
  const result={};
  for(const [id,source] of Object.entries(scripts)){
    try{result[id]=classifyDeclarative(source);}
    catch(error){result[id]={kind:'unsafe',error:String(error?.message??error)};}
  }
  process.stdout.write(JSON.stringify(result));
}else{
// Validate every generated artifact without evaluating any upstream code.
const scripts=JSON.parse(readFileSync(0,'utf8'));
const errors=[];
for(const [id,source] of Object.entries(scripts)) {
  try {parse(source,{ecmaVersion:'latest',sourceType:'module'});}
  catch(error) {errors.push(id+': '+error.message);}
}
process.stdout.write(JSON.stringify(errors));
}
