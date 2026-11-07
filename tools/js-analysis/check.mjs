import {parse} from './core/syntax.mjs';
import {readFileSync} from 'node:fs';

// Validate every generated artifact without evaluating any upstream code.
const scripts=JSON.parse(readFileSync(0,'utf8'));
const errors=[];
for(const [id,source] of Object.entries(scripts)) {
  try {parse(source,{ecmaVersion:'latest',sourceType:'module'});}
  catch(error) {errors.push(id+': '+error.message);}
}
process.stdout.write(JSON.stringify(errors));
