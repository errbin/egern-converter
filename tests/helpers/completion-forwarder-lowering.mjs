// 读取单个脚本并输出完成转发器降级结果，供正反例回归使用。
import {readFileSync} from 'node:fs';
import {lowerCompletionForwarders} from '../../tools/js-analysis/transforms/specialization.mjs';

const source=readFileSync(0,'utf8');
const result=lowerCompletionForwarders(source);
process.stdout.write(JSON.stringify({transformations:result.transformations,source:result.source}));
