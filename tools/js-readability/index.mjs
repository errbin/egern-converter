// Parse and regenerate JavaScript. Never evaluate the input or run its decoders.
import {parse} from 'acorn';
import {generate} from 'astring';
import {readFileSync} from 'node:fs';
import {protectLibraries} from '../js-analysis/analysis/libraries.mjs';
const libraries=protectLibraries(readFileSync(0, 'utf8'),{sourceType:'module'});
const source = libraries.source;
const options = {ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true};
// Self-inspecting or dynamically executed programs may depend on source spelling.
if (/\b(?:eval|Function)\s*\(|\.\s*toString\s*\(|\[\s*['"]toString['"]\s*\]/.test(source)) {
  throw Error('含动态执行或源码自检，需人工审查，拒绝自动改写');
}
const comments = [];
const tree = parse(source, {...options, onComment: comments});
let decoded = 0;
function walk(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'Identifier' && ['eval', 'Function'].includes(node.name)) throw Error('含动态执行入口，拒绝自动改写');
  if (node.type === 'MemberExpression' && ((node.computed && node.property?.value === 'toString') || (!node.computed && node.property?.name === 'toString'))) throw Error('含源码自检入口，拒绝自动改写');
  // A directive's escaped spelling can determine whether strict mode is enabled.
  if (node.type === 'ExpressionStatement' && typeof node.directive === 'string') return;
  if (node.type === 'Literal' && typeof node.value === 'string' && /\\(?:x[0-9a-f]{2}|u(?:[0-9a-f]{4}|\{[0-9a-f]+\}))/i.test(node.raw || '')) {
    delete node.raw;
    decoded++;
  }
  for (const [key, value] of Object.entries(node)) {
    if (['start', 'end', 'loc', 'raw', 'directive'].includes(key)) continue;
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') walk(value);
  }
}
// Keep author notices verbatim. Reprinting comments as a leading block keeps them
// out of expressions; JavaScript does not give ordinary comments runtime semantics.
const notices = comments.map(comment => source.slice(comment.start, comment.end)).join('\n');
walk(tree);
const code = (notices ? notices + '\n' : '') + generate(tree, {indent: '  '});
// Compare parsed programs after regeneration, including directive spellings.
function canonical(node) {
  if (Array.isArray(node)) return node.map(canonical);
  if (!node || typeof node !== 'object') return typeof node === 'bigint' ? String(node) + 'n' : node;
  const result = {};
  for (const key of Object.keys(node).sort()) {
    if (['start', 'end', 'loc', 'raw'].includes(key)) continue;
    result[key] = canonical(node[key]);
  }
  return result;
}
if (JSON.stringify(canonical(tree)) !== JSON.stringify(canonical(parse(code, options)))) {
  throw Error('重新生成后的语法树发生变化，拒绝输出');
}
process.stdout.write(libraries.restore(code,{globalReceiver:false}));
process.stderr.write(`已格式化；解码 ${decoded} 个字符串字面量。动态解码器与控制流未改写。\n`);
