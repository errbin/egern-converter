// 读取单个脚本并输出 regenerator 状态机证明，供正反例回归使用。
import {readFileSync} from 'node:fs';
import {parse} from '../../tools/js-analysis/core/syntax.mjs';
import {index} from '../../tools/js-analysis/core/ast.mjs';
import {regeneratorStateMachine} from '../../tools/js-analysis/analysis/values.mjs';

const source=readFileSync(0,'utf8');
const tree=parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true});
process.stdout.write(JSON.stringify(regeneratorStateMachine(index(tree),source)));
