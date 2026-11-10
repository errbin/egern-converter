// 在已审查的真实壳样本上替换表工厂构造方式，验证等价静态来源能走完整折叠路径。
import {readFileSync} from 'node:fs';
import {parse} from '../../tools/js-analysis/core/syntax.mjs';
import {index} from '../../tools/js-analysis/core/ast.mjs';
import {methodContract} from '../../tools/js-analysis/platform/clients.mjs';
import {lowerObfuscatedTables} from '../../tools/js-analysis/transforms/decoding.mjs';

const KS_DECODER = '83130d056909f9118d60ceceeb1ffcb819c47420b2114acedede063c7a5472f9';
const source = readFileSync(process.argv[2], 'utf8');
const tree = parse(source, {ecmaVersion: 'latest', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true});
const ix = index(tree);
const decoder = ix.nodes.find(node => node.type === 'FunctionDeclaration' && methodContract(node) === KS_DECODER);
if (!decoder) throw Error('缺少已审查的解码器');
const call = decoder.body.body[0].declarations[0].init;
const factory = ix.bindings.get(call.callee)?.init;
const array = factory?.body?.body?.[0]?.declarations?.[0]?.init;
if (array?.type !== 'ArrayExpression' || !array.elements.length) throw Error('缺少已审查的数组表');

const chunkCount = Math.min(3, array.elements.length);
const chunks = Array.from({length: chunkCount}, () => []);
array.elements.forEach((element, index) => chunks[Math.min(chunkCount - 1, Math.floor(index * chunkCount / array.elements.length))].push(source.slice(element.start, element.end)));
const arrayText = chunk => '[' + chunk.join(',') + ']';
const names = new Set(ix.nodes.filter(node => node.type === 'Identifier').map(node => node.name));
let seed = '__cachedTableSeed';
while (names.has(seed)) seed += '_';

const variants = {
  concat: chunks.map(arrayText).reduce((base, chunk) => `${base}.concat((function(){return ${chunk};})())`),
  spread: `(function(){return [${chunks.map(chunk => '...' + arrayText(chunk)).join(',')}];})()`,
};

const result = {};
for (const [name, replacement] of Object.entries(variants)) {
  const changed = source.slice(0, array.start) + replacement + source.slice(array.end);
  result[name] = lowerObfuscatedTables(changed).transformations.length;
}

const seedSource = `function ${seed}(){return ${source.slice(array.start, array.end)};}\n`;
const changed = source.slice(0, factory.start) + seedSource + source.slice(factory.start, array.start) + `${seed}()` + source.slice(array.end);
result.two_level = lowerObfuscatedTables(changed).transformations.length;
process.stdout.write(JSON.stringify(result));
