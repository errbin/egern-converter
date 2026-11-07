import {parse} from './core/syntax.mjs';
import {readFileSync} from 'node:fs';

// Inspect native widget syntax without executing untrusted upstream scripts.
let result={native:false,env:[]};
try {
  const tree=parse(readFileSync(0,'utf8'),{ecmaVersion:'latest',sourceType:'module'});
  let widget=false;
  function visit(node){
    if(!node||typeof node!=='object')return;
    if(node.type==='Property'&&(node.key.name||node.key.value)==='type'&&node.value.type==='Literal'&&node.value.value==='widget')widget=true;
    for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);
  }
  visit(tree);
  const exported=tree.body.find(node=>node.type==='ExportDefaultDeclaration');
  result.native=widget&&!!exported;
  const context=exported?.declaration?.params?.[0]?.name;
  const aliases=new Set(),keys=new Set();
  function isEnv(node){
    if(!node)return false;
    if(node.type==='Identifier')return aliases.has(node.name);
    if(node.type==='LogicalExpression')return isEnv(node.left);
    return node.type==='MemberExpression'&&node.object.type==='Identifier'&&node.object.name===context&&
      (node.computed?node.property.value:node.property.name)==='env';
  }
  function scan(node){
    if(!node||typeof node!=='object')return;
    if(node.type==='VariableDeclarator'&&isEnv(node.init)){
      if(node.id.type==='Identifier')aliases.add(node.id.name);
      if(node.id.type==='ObjectPattern')for(const property of node.id.properties){
        const key=property.key?.name||property.key?.value;
        if(key)keys.add(key);
      }
    }
    if(node.type==='MemberExpression'&&isEnv(node.object)){
      const key=node.computed?node.property.value:node.property.name;
      if(typeof key==='string')keys.add(key);
    }
    for(const value of Object.values(node))if(Array.isArray(value))value.forEach(scan);else if(value&&typeof value==='object')scan(value);
  }
  scan(tree);scan(tree);
  result.env=[...keys].sort();
}catch{}
process.stdout.write(JSON.stringify(result));
