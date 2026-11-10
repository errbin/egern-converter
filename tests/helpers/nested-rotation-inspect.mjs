// 只读验证嵌套 IIFE 轮转：返回校验和命中的轮转步数与最终本地表。
import {readFileSync} from 'node:fs';
import {inspectNestedRotation} from '../../tools/js-analysis/transforms/decoding.mjs';

const source = readFileSync(0, 'utf8');
try {
  const result = inspectNestedRotation(source);
  process.stdout.write(JSON.stringify({steps: result.steps, values: result.values, factory: result.factory}));
} catch (error) {
  process.stdout.write(JSON.stringify({error: error.message}));
}
