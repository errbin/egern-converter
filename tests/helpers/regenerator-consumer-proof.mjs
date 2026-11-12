// 直接探测 `.wrap` 完成消费方判据，避免把其它转换失败误算成该判据的拒绝。
import {readFileSync} from 'node:fs';
import {index,property} from '../../tools/js-analysis/core/ast.mjs';
import {parse} from '../../tools/js-analysis/core/syntax.mjs';
import {closedRegeneratorConsumer} from '../../tools/js-analysis/compiler/flow.mjs';

const source=readFileSync(0,'utf8');
const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true});
const ix=index(tree);
const call=ix.nodes.find(node=>node.type==='CallExpression'&&node.callee.type==='MemberExpression'&&property(node.callee)==='wrap');
if(!call)throw new Error('未找到 .wrap 调用');
const callback=call.arguments[0];
const isCompletion=node=>node?.type==='CallExpression'&&node.callee.type==='Identifier'&&ix.free(node.callee,'$done');
const machine=closedRegeneratorConsumer(ix,source,call,callback,isCompletion);
process.stdout.write(JSON.stringify({
 accepted:!!machine,
 proved:!!machine?.proved,
 deadReachabilityProved:!!machine?.deadReachabilityProved,
 acyclic:!!machine?.acyclic,
 completions:machine?ix.nodes.filter(node=>node.start>=callback.start&&node.end<=callback.end&&isCompletion(node)).length:0,
}));
