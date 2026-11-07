import beautifier from '../vendor/beautify.cjs';
import {parse} from '../core/syntax.mjs';

// Format compiled code only; attribution and YAML documentation stay verbatim.

const options={ecmaVersion:'latest',sourceType:'module'};
const canonical=tree=>JSON.stringify(tree,(key,value)=>
 ['start','end','loc','range'].includes(key)?undefined:typeof value==='bigint'?String(value)+'n':value);
const notices=comments=>comments.map(({type,value})=>
 [type,value.split(/\r\n|[\n\r\u2028\u2029]/).map(line=>line.trim()).join('\n').trim()]);

// Ignore author notices and blank lines when detecting an upstream one-line body.
export function singleLineSource(source){
 const tokens=[];
 parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true,locations:true,onToken:tokens});
 const code=tokens.filter(t=>t.type.label!=='eof');
 return code.length>0&&code.every(t=>t.loc.start.line===code[0].loc.start.line&&t.loc.end.line===code[0].loc.start.line);
}

export function compactNative(source){
 const comments=[],semicolons=[];
 const before=parse(source,{...options,onComment:comments,onInsertedSemicolon:p=>semicolons.push(p)});
 let printable=source;
 for(const p of [...new Set(semicolons)].sort((a,b)=>b-a))printable=printable.slice(0,p)+';'+printable.slice(p);
 const tokens=[];parse(printable,{...options,onToken:tokens});
 let code='',previous;
 for(const token of tokens.filter(t=>t.type.label!=='eof')){
  if(previous&&token.start>previous.end){
   // Keep lexical separators around words/operators. Touching template tokens
   // retain their exact raw spelling, including significant quasi whitespace.
   const tight=t=>['{','}','(',')','[',']',';',',',':'].includes(t.type.label);
   if(!tight(previous)&&!tight(token))code+=' ';
  }
  code+=printable.slice(token.start,token.end);previous=token;
 }
 if(/[\r\n\u2028\u2029]/.test(code))throw Error('原生压缩结果仍含多行字面量，拒绝改变其原始内容');
 if(canonical(before)!==canonical(parse(code,options)))throw Error('压缩改变了脚本语法树，拒绝输出');
 return {code:code+'\n',comments:comments.map(c=>c.value.trim()).filter(Boolean)};
}

export function formatNative(source){
 const beforeComments=[],afterComments=[],semicolons=[];
 const before=parse(source,{...options,onComment:beforeComments,
  onInsertedSemicolon:position=>semicolons.push(position)});
 // Make parser-inserted semicolons explicit before changing line layout. This
 // protects return/break/continue and other ASI boundaries from beautification.
 let printable='',position=0;
 for(const end of [...new Set(semicolons)].sort((a,b)=>a-b)){
  printable+=source.slice(position,end)+';';position=end;
 }
 printable+=source.slice(position);
 const formatted=beautifier.js_beautify(printable,{
  indent_size:2,indent_char:' ',indent_with_tabs:false,
  preserve_newlines:true,max_preserve_newlines:1,end_with_newline:true,
  eol:'\n',wrap_line_length:100,unescape_strings:false,eval_code:false,
 });
 const after=parse(formatted,{...options,onComment:afterComments});
 if(canonical(before)!==canonical(after)){
  throw Error('格式化改变了脚本语法树，拒绝输出');
 }
 if(JSON.stringify(notices(beforeComments))!==JSON.stringify(notices(afterComments))){
  throw Error('格式化改变了脚本注释内容，拒绝输出');
 }
 return formatted;
}

// Rewrite only parsed comments, never strings, regexes or executable source.

const section=/^\[(?:rewrite_local|rewrite_remote|script|script_remote|mitm|rewrite|url rewrite|rule|filter_local|task_local|general)\]\s*$/i;
const declaration=/^(?:\S+\s+url\s+(?:script-|reject\b)|\S+\s*=\s*type\s*=\s*(?:http-|cron)|http-(?:request|response)\s+\S+.*script-path\s*=|hostname\s*=|(?:DOMAIN|HOST|IP-CIDR|URL-REGEX)(?:[-,]))/i;
const platform=/\b(?:Surge|Loon|Quantumult(?:\s*X)?|QX|Shadowrocket|Stash)\b/i;
const instruction=/用法|配置|教程|安装|添加|导入|使用|支持|适用|@supported|http-request|http-response|script-path|setup|usage|install|supported/i;
const normalized=line=>line.replace(/^\s*\*\s?/,'').trim().replace(/^#(?!\!)[ \t]*/,'');

// Keep upstream attribution and legal notices, not feature descriptions or
// obsolete installation prose. Full license paragraphs retain every line.
export function copyrightDocumentation(text){
 const notice=/(?:\bcopyright\b|\bauthors?\b|\bcredits?\b|\blicen[cs]e\b|\bSPDX-|\ball rights reserved\b|©|版权所有|著作权|许可证|作者|署名|来源|原作|二改|^\s*@?by\s+\S)/i;
 const legalParagraph=/permission is hereby granted|the above copyright notice|the software is provided|redistributions?|neither the name|in no event|any express or implied|this (?:software|program|library) is (?:free|distributed)|licensed under|you may (?:not )?use this file|you should have received|limitations under the license|免责声明|禁止转载|严禁转载/i;
 const paragraphs=text.split(/\r\n|[\n\r\u2028\u2029]/).map(normalized).join('\n').split(/\n\s*\n/);
 const kept=[];
 for(const paragraph of paragraphs){
  if(legalParagraph.test(paragraph)){kept.push(paragraph.trim());continue;}
  const lines=paragraph.split('\n'),selected=[];
  let authorLink=false;
  for(const line of lines){
   if(notice.test(line)){selected.push(line);authorLink=true;}
   else if(authorLink&&/^https?:\/\/\S+$/.test(line)){selected.push(line);authorLink=false;}
   else authorLink=false;
  }
  if(selected.length)kept.push(selected.join('\n'));
 }
 return [...new Set(kept)].join('\n\n');
}

export function rewriteUsageComments(source){
 const comments=[];
 try{parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true,onComment:comments});}catch{return source;}
 let result='',position=0;
 for(const comment of comments){
  const raw=source.slice(comment.start,comment.end);
  const lines=comment.value.split(/\r\n|[\n\r\u2028\u2029]/);
  const hasConfig=lines.some(line=>section.test(normalized(line))||declaration.test(normalized(line)));
  if(hasConfig){
   const legal=copyrightDocumentation(comment.value);
   result+=source.slice(position,comment.start)+(legal?(comment.type==='Block'?'/*'+legal+'*/':'//'+legal):(/[\n\r\u2028\u2029]/.test(raw)?'\n':' '));
   position=comment.end;
   continue;
  }
  let changed=false;
  const kept=[];
  for(const line of lines){
   const text=normalized(line);
   // Copyright/author/legal notices are not installation instructions.
   if(!section.test(text)&&!declaration.test(text)&&/copyright|license|permission|版权所有|著作权|许可证|授权|免责声明|禁止|严禁|仅供|作者|来源/i.test(text)){
    kept.push(line);continue;
   }
   const remove=section.test(text)||declaration.test(text)
    ||/^#!(?:name|desc|author|homepage|icon|arguments(?:-desc)?)\s*=/i.test(text)
    ||(platform.test(text)&&instruction.test(text))
    ||/^(?:surge|loon|quantumult-x|quantumultx|shadowrocket):\/\//i.test(text)
    ||(/^\d+[.)、]\s*(?:添加|复制|导入|开启|启用).*(?:脚本|重写|节点)/.test(text))
    ||(hasConfig&&/^```(?:\w+)?\s*$/.test(text))
    ||(hasConfig&&/^https?:\/\/\S+$/.test(text)&&!/^https?:\/\/(?:github\.com|raw\.githubusercontent\.com)\//i.test(text));
   if(remove){changed=true;continue;}
   kept.push(line);
  }
  let replacement=raw;
  if(changed){
   if(!kept.some(line=>normalized(line)))replacement=/[\n\r\u2028\u2029]/.test(raw)?'\n':' ';
   else replacement=comment.type==='Block'?'/*'+kept.join('\n')+'*/':'//'+kept.join('');
  }
  result+=source.slice(position,comment.start)+replacement;
  position=comment.end;
 }
 return result+source.slice(position);
}
