// 读取单个脚本并输出异步 regenerator 降级结果，供正反例回归使用。
import {readFileSync} from 'node:fs';
import {lowerAsyncRegenerator} from '../../tools/js-analysis/transforms/specialization.mjs';

const source=readFileSync(0,'utf8');
const result=lowerAsyncRegenerator(source);
process.stdout.write(JSON.stringify({transformations:result.transformations,released:result.released,source:result.source}));
