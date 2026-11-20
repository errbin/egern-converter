import {parse} from './core/syntax.mjs';
import {readFileSync} from 'node:fs';

// 静态检查原生小组件语法，不执行不可信的上游脚本。
// env_schema 只输出 Egern 官方字段：name / description / default_value / options。
let result={native:false,env:[],env_schema:{}};
try {
  const source=readFileSync(0,'utf8');
  const comments=[];
  const tree=parse(source,{ecmaVersion:'latest',sourceType:'module',locations:true,onComment:comments});
  let widget=false;
  function visit(node,run){
    if(!node||typeof node!=='object')return;
    run(node);
    for(const [key,value] of Object.entries(node)){
      if(key==='loc'||key==='start'||key==='end')continue;
      if(Array.isArray(value))value.forEach(child=>visit(child,run));
      else if(value&&typeof value==='object')visit(value,run);
    }
  }
  visit(tree,node=>{
    if(node.type==='Property'&&(node.key.name||node.key.value)==='type'&&node.value.type==='Literal'&&node.value.value==='widget')widget=true;
  });
  const exported=tree.body.find(node=>node.type==='ExportDefaultDeclaration');
  result.native=widget&&!!exported;
  const context=exported?.declaration?.params?.[0]?.name;

  const supplied=new Map();
  function envEntry(key){
    if(typeof key!=='string'||!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key))return null;
    if(!supplied.has(key))supplied.set(key,{name:key});
    return supplied.get(key);
  }
  function scalar(node){
    if(!node)return undefined;
    if(node.type==='Literal'&&['string','number','boolean'].includes(typeof node.value))return node.value;
    if(node.type==='UnaryExpression'&&node.operator==='-'&&node.argument?.type==='Literal'&&typeof node.argument.value==='number')return -node.argument.value;
    if(node.type==='TemplateLiteral'&&node.expressions.length===0)return node.quasis[0]?.value?.cooked;
    return undefined;
  }
  function scalarText(value){
    if(value===undefined||value===null)return undefined;
    const text=String(value).trim();
    return text?text:undefined;
  }
  function setDefault(key,value){
    const text=scalarText(value),entry=envEntry(key);
    if(!text||!entry||entry.default_value!==undefined)return;
    entry.default_value=text;
    if(value===true||value===false)setOptions(key,['true','false']);
  }
  function setOptions(key,options){
    const entry=envEntry(key);
    if(!entry||entry.options)return;
    const values=[...new Set(options.map(value=>scalarText(value)).filter(Boolean))];
    if(values.length>1)entry.options=values;
  }
  function setDescription(key,description){
    const entry=envEntry(key),text=String(description||'').trim().replace(/[:：]\s*$/,'');
    if(!entry||!text)return;
    if(!entry.description)entry.description=text;
    else if(!entry.description.includes(text))entry.description+='；'+text;
  }
  function mark(key,required){
    const entry=envEntry(key);
    if(entry&&entry.required===undefined)entry.required=required;
  }

  // 解析 Required env / Optional env / env 参数 等注释块。
  const heading=/^(?:(required|optional|必填|必须|可选|选填)\s*)?(?:env(?:ironment)?(?:\s+(?:values?|variables?|parameters?|params?|参数|变量))?|(?:环境)?变量(?:说明)?|(?:环境变量)?参数(?:说明)?|env\s*(?:参数|变量))\s*[:：]?\s*$/i;
  function defaultFromText(text){
    const valueText=String(text||'');
    const explicit=valueText.match(/默认(?:值)?\s*[:：]\s*([^\s，,；;。()（）]+)/)
      ||valueText.match(/默认(?:值)?(?:为|是)\s*[:：]?\s*([^\s，,；;。()（）]+)/);
    const spaced=valueText.match(/默认\s+([^\s，,；;。()（）]+)/);
    const match=explicit||spaced;
    if(!match)return undefined;
    const value=match[1].replace(/^["'`“”‘’]|["'`“”‘’]$/g,'').trim();
    if(!explicit&&!/^(?:true|false|-?\d+(?:\.\d+)?)$/i.test(value))return undefined;
    return /^(?:值|为|是)$/.test(value)?undefined:value;
  }
  function optionsFrom(value,detail,fallback){
    const text=String(value||'').trim();
    const pair=text.match(/^(true|false)\s*[\/|]\s*(true|false)$/i);
    if(pair)return ['true','false'];
    if(/^(?:true|false)$/i.test(text))return ['true','false'];
    const documented=String(detail||'').match(/可选值\s*[:：]\s*(.+)$/);
    if(documented){
      const values=documented[1].split(/\s*[\/|,，]\s*/).map(item=>item.trim()).filter(Boolean);
      if(values.length>1)return values;
    }
    if(fallback===true||fallback===false)return ['true','false'];
    return undefined;
  }
  function applyEntry(key,mode,value,detail,explicitDefault){
    if(!envEntry(key))return;
    if(mode==='required')mark(key,true);
    else if(mode==='optional')mark(key,false);
    if(detail)setDescription(key,detail);
    // Optional 段里的单值 KEY=value 是声明的默认值；Required 段的值只是示例占位。
    // 选项列表（a/b）、URL 和以省略号结尾的示例不视为默认值。
    let documentedDefault=explicitDefault;
    if(documentedDefault===undefined&&mode==='optional'&&value
        &&!/[\/|]/.test(value)&&!/^https?:\/\//i.test(value)&&!/(?:\.\.\.|…)$/.test(value)){
      documentedDefault=value;
    }
    const fallback=documentedDefault!==undefined?documentedDefault:defaultFromText(detail);
    if(fallback!==undefined)setDefault(key,fallback);
    const options=optionsFrom(value,detail,fallback);
    if(options)setOptions(key,options);
  }
  function continuationOptions(line){
    const match=String(line).match(/^([A-Za-z0-9.+#-]+(?:\s*[\/|]\s*[A-Za-z0-9.+#-]+)+)(?:\s*[（(].*)?$/);
    if(!match)return undefined;
    const values=match[1].split(/\s*[\/|]\s*/).map(value=>value.trim()).filter(Boolean);
    return values.length>1?values:undefined;
  }
  for(const comment of comments){
    let mode=false;
    let last=null,lastIndent=0;
    for(const raw of comment.value.replace(/\r/g,'').split('\n')){
      const unstarred=raw.replace(/^\s*\*?\s?/,'');
      const line=unstarred.trim();
      if(!line)continue;
      const indent=unstarred.length-unstarred.trimStart().length;
      const headingLine=line.replace(/^[^\w\u4e00-\u9fff]+/,'')
        .replace(/[（(][^（）()]*[)）]\s*[:：]?$/,'').replace(/[:：]\s*$/,'').trim();
      const header=headingLine.match(heading);
      // 裸 `env:` 常出现在 YAML 配置示例里，不能据此开启变量块。
      if(header&&!/^(?:env|environment)$/i.test(headingLine)){
        const tag=(header[1]||'').toLowerCase();
        mode=tag==='required'||tag==='必填'||tag==='必须'?'required':
          tag==='optional'||tag==='可选'||tag==='选填'?'optional':'unknown';
        last=null;
        continue;
      }
      if(!mode)continue;
      const entryLine=line.replace(/^[-*•]\s+/,'');
      if(last&&indent>lastIndent&&/^[-*•]\s+/.test(line)){
        const option=entryLine.match(/^([^\s:：]+)\s*[:：]\s*(.+)$/);
        if(option){
          const entry=supplied.get(last);
          if(entry?.options)setOptions(last,[...entry.options,option[1]]);
          setDescription(last,option[1]+'：'+option[2].trim());
          continue;
        }
      }
      const assignment=entryLine.match(/^([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/);
      if(assignment){
        let body=assignment[2].trim(),explicitDefault,alternative;
        const choiceMarker=body.match(/^(.*?)\s*[（(]\s*(?:default|默认(?:值)?)\s*[)）]\s*\|\s*(.+)$/i);
        if(choiceMarker){
          explicitDefault=choiceMarker[1].trim();
          alternative=choiceMarker[2].trim();
          body=explicitDefault;
        }
        const defaultMarker=body.match(/^(.*?)\s*[（(]\s*(?:default|默认(?:值)?)\s*[)）]\s*$/i);
        if(!choiceMarker&&defaultMarker){
          body=defaultMarker[1].trim();
          explicitDefault=body;
        }
        let value='',detail='';
        const colon=!body.startsWith('http://')&&!body.startsWith('https://')&&body.match(/^([^:：\s]+)\s*[:：]\s*(.+)$/);
        if(colon){
          value=colon[1].trim();
          detail=colon[2].trim();
        }else{
          const parts=body.split(/\s{2,}/);
          value=parts.shift()?.trim()||'';
          detail=parts.join(' ').trim();
        }
        applyEntry(assignment[1],mode,value,detail,explicitDefault);
        if(alternative){
          const choices=[value,...alternative.split(/\s*[\/|]\s*/)].map(item=>item.trim()).filter(Boolean);
          setOptions(assignment[1],choices);
        }
        last=assignment[1];lastIndent=indent;
        continue;
      }
      const separated=entryLine.match(/^([A-Za-z_][A-Za-z0-9_.-]*)\s*[-－—:：]\s*(.+)$/);
      if(separated){
        applyEntry(separated[1],mode,'',separated[2].trim(),undefined);
        last=separated[1];lastIndent=indent;
        continue;
      }
      const described=entryLine.match(/^([A-Za-z_][A-Za-z0-9_.-]*)\s*[（(]([^()（）]+)[)）]\s*$/);
      if(described){
        applyEntry(described[1],mode,'',described[2].trim(),undefined);
        last=described[1];lastIndent=indent;
        continue;
      }
      if(last&&indent>lastIndent){
        const continuation=line.replace(/^[-*•]\s+/,'').trim();
        if(/^(?:示例|例如|用法|配置示例)\s*[:：]?$/.test(continuation)
            ||/^(?:widgets|env|scriptings|modules)\s*:/.test(continuation)
            ||/^-\s*\w+\s*:/.test(continuation)
            ||/^\w+\s*:/.test(continuation)){
          mode=false;last=null;
          continue;
        }
        const fallback=defaultFromText(continuation);
        if(fallback!==undefined)setDefault(last,fallback);
        const options=continuationOptions(continuation);
        if(options)setOptions(last,options);
        setDescription(last,continuation);
        continue;
      }
      // 注释块中的说明文字结束后，不再把后续散文当作变量声明。
      mode=false;
      last=null;
    }
  }

  // 解析代码中的 ctx.env / env 访问，包括可选链、计算属性和别名。
  const aliases=new Set();
  function unwrap(node){
    while(node?.type==='ChainExpression')node=node.expression;
    return node;
  }
  function propertyName(node){
    if(!node)return undefined;
    if(!node.computed)return node.property?.type==='Identifier'?node.property.name:undefined;
    const value=scalar(node.property);
    return typeof value==='string'?value:undefined;
  }
  const contexts=new Set(context?[context]:[]);
  function isContext(node){
    node=unwrap(node);
    if(!node)return false;
    if(node.type==='Identifier')return contexts.has(node.name);
    if(node.type==='LogicalExpression')return isContext(node.left)||isContext(node.right);
    if(node.type==='AssignmentExpression')return isContext(node.right);
    return false;
  }
  function isEnvContainer(node){
    node=unwrap(node);
    if(!node)return false;
    if(node.type==='Identifier')return aliases.has(node.name);
    if(node.type==='LogicalExpression')return isEnvContainer(node.left)||isEnvContainer(node.right);
    if(node.type==='AssignmentExpression')return isEnvContainer(node.right);
    return node.type==='MemberExpression'&&!node.computed&&node.property?.name==='env'&&isContext(node.object);
  }
  function objectPatternKeys(node){
    if(node?.type!=='ObjectPattern')return;
    for(const property of node.properties){
      const key=property.key?.type==='Identifier'?property.key.name:scalar(property.key);
      if(typeof key==='string')envEntry(key);
    }
  }
  for(let pass=0;pass<4;pass++){
    const before=aliases.size+contexts.size;
    visit(tree,node=>{
      if(node.type!=='VariableDeclarator')return;
      if(node.id?.type==='Identifier'&&isEnvContainer(node.init))aliases.add(node.id.name);
      else if(node.id?.type==='Identifier'&&isContext(node.init))contexts.add(node.id.name);
      objectPatternKeys(node.id?.type==='ObjectPattern'&&isEnvContainer(node.init)?node.id:null);
    });
    if(aliases.size+contexts.size===before)break;
  }
  function keysWithin(node){
    const keys=new Set();
    visit(node,current=>{
      if(current.type==='MemberExpression'&&isEnvContainer(current.object)){
        const key=propertyName(current);
        if(key)keys.add(key);
      }
    });
    return keys;
  }
  function fallbackValue(node){
    node=unwrap(node);
    if(node?.type==='LogicalExpression')return fallbackValue(node.right);
    return scalar(node);
  }
  visit(tree,node=>{
    if(node.type==='VariableDeclarator'&&isEnvContainer(node.init))objectPatternKeys(node.id?.type==='ObjectPattern'?node.id:null);
    if(node.type==='MemberExpression'&&isEnvContainer(node.object)){
      const key=propertyName(node);
      if(key)envEntry(key);
    }
    if(node.type==='LogicalExpression'&&(node.operator==='||'||node.operator==='??')){
      const keys=keysWithin(node);
      if(keys.size===1)setDefault([...keys][0],fallbackValue(node));
    }
  });

  // 识别读取 ctx.env?.[key] 的辅助函数，再按调用点的字面量提取变量名和默认值。
  const helpers=new Map();
  function functionName(node,parent){
    if(node.type==='FunctionDeclaration')return node.id?.name;
    if(parent?.type==='VariableDeclarator')return parent.id?.type==='Identifier'?parent.id.name:undefined;
    return undefined;
  }
  function inspectFunctions(node,parent){
    if(!node||typeof node!=='object')return;
    if(node.type==='FunctionDeclaration'||node.type==='FunctionExpression'||node.type==='ArrowFunctionExpression'){
      const name=functionName(node,parent);
      const params=node.params.filter(param=>param.type==='Identifier').map(param=>param.name);
      if(name&&params.length>1){
        let keyIndex=-1;
        visit(node.body,current=>{
          if(keyIndex>=0||current.type!=='MemberExpression'||!isEnvContainer(current.object)||!current.computed)return;
          const property=current.property;
          if(property?.type==='Identifier')keyIndex=params.indexOf(property.name);
        });
        if(keyIndex>0){
          let fallbackIndex=-1;
          visit(node.body,current=>{
            if(fallbackIndex>=0||current.type!=='ReturnStatement'||current.argument?.type!=='Identifier')return;
            const index=params.indexOf(current.argument.name);
            if(index>keyIndex)fallbackIndex=index;
          });
          if(fallbackIndex>keyIndex)helpers.set(name,{keyIndex,fallbackIndex});
        }
      }
    }
    for(const [key,value] of Object.entries(node)){
      if(key==='loc'||key==='start'||key==='end')continue;
      if(Array.isArray(value))value.forEach(child=>inspectFunctions(child,node));
      else if(value&&typeof value==='object')inspectFunctions(value,node);
    }
  }
  inspectFunctions(tree,null);
  visit(tree,node=>{
    if(node.type!=='CallExpression'||node.callee?.type!=='Identifier'||!helpers.has(node.callee.name))return;
    const helper=helpers.get(node.callee.name);
    const key=scalarText(scalar(node.arguments[helper.keyIndex]));
    if(!key||!envEntry(key))return;
    setDefault(key,scalar(node.arguments[helper.fallbackIndex]));
  });

  // 代码旁的行注释可补充说明，但不能覆盖注释块中的显式说明。
  const firstLines=new Map();
  visit(tree,node=>{
    if(node.type==='MemberExpression'&&isEnvContainer(node.object)){
      const key=propertyName(node);
      if(key&&node.loc&&!firstLines.has(key))firstLines.set(key,node.loc.start.line);
    }
  });
  for(const [key,line] of firstLines){
    if(supplied.get(key)?.description)continue;
    const nearby=comments.filter(comment=>comment.type==='Line'&&comment.loc&&comment.loc.end.line>=line-2&&comment.loc.end.line<line)
      .find(comment=>new RegExp('(^|[^A-Za-z0-9_])'+key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'([^A-Za-z0-9_]|$)').test(comment.value));
    if(nearby)setDescription(key,nearby.value.trim());
  }

  // 普通使用说明中的“KEY 值为 … / KEY：…”也可提供用途，仍只读取注释文本。
  for(const key of supplied.keys()){
    const entry=supplied.get(key);
    if(entry.description)continue;
    const escaped=key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const pattern=new RegExp('(?:^|[\\s，,、])(?:'+escaped+')\\s*(?:值)?\\s*(?:为|：|:|-)\\s*([^，,、；;。\\n]+)');
    for(const comment of comments){
      const match=comment.value.match(pattern);
      if(match){
        setDescription(key,match[1].trim());
        break;
      }
    }
  }

  const schema={};
  for(const key of [...supplied.keys()].sort()){
    const entry=supplied.get(key);
    let description=entry.description||'';
    if(entry.required===true&&!/^(?:必填|必须)/.test(description))description='必填。'+description;
    else if(entry.required===false&&!/^(?:可选|选填)/.test(description))description='可选。'+description;
    const descriptor={name:key};
    if(description)descriptor.description=description;
    if(entry.default_value!==undefined)descriptor.default_value=entry.default_value;
    if(entry.options)descriptor.options=entry.options;
    schema[key]=descriptor;
  }
  result.env=Object.keys(schema);
  result.env_schema=schema;
}catch{}
process.stdout.write(JSON.stringify(result));
