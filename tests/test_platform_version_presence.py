"""平台版本存在性只可证明“不是缺失哨兵”，具体版本比较必须保持未知。"""
import json
import subprocess
import unittest
from pathlib import Path

from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare


ROOT = Path(__file__).resolve().parents[1]
URL = 'https://example.test/platform-version.js'


class PlatformVersionPresenceTests(unittest.TestCase):
    def test_present_version_sentinel_folds_but_real_version_comparisons_stay_unknown(self):
        probe = """
import assert from 'node:assert/strict';
import {platformFold} from './tools/js-analysis/platform/globals.mjs';
const fold=(source,format)=>platformFold(source,format).source;
const sentinel='const present=typeof $environment!=="undefined"&&$environment["surge-version"]!=="undefined";';
assert.equal(fold(sentinel,'surge'),'const present = true;');
assert.equal(fold(sentinel,'loon'),'const present = false;');
assert.equal(fold(sentinel,'qx'),'const present = false;');
for(const comparison of ['!=="5.0"','==="5.0"','=="5.0"','!="5.0"']){
 const source='const value=$environment["surge-version"]'+comparison+';';
 assert.match(fold(source,'surge'),/\\$environment\\["surge-version"\\]/);
}
assert.equal(fold('const value=$environment["surge-version"]!=="undefined";','surge'),'const value = true;');
assert.equal(fold('const value=$environment["surge-version"]==="undefined";','surge'),'const value = false;');
console.log(JSON.stringify({ok:true}));
"""
        result = subprocess.run(
            ['node', '--input-type=module', '-e', probe],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=True,
        )
        self.assertEqual(json.loads(result.stdout), {'ok': True})

    def test_converted_presence_probe_is_differentially_equivalent(self):
        source = """const present=typeof $environment!=='undefined'&&$environment['surge-version']!=='undefined';
$done({body:String(present)});"""
        native = convert_script(source, 'Fixture', URL, '', source_format='surge')
        case = {'name': 'platform version presence', 'request': {'url': URL},
                'expected': {'result': {'body': 'true'}}}
        result = compare(source, native, 'surge', URL, case)
        self.assertEqual(result['status'], 'passed', result)


if __name__ == '__main__':
    unittest.main()
