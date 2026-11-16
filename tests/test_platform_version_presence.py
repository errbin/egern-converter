"""平台版本存在性只可证明“不是缺失哨兵”，具体版本比较必须保持未知。"""
import json
import subprocess
import unittest
from pathlib import Path

from tools.egern_hub.convert import ConversionError
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

    def test_surge_build_branch_comparison_folds_to_the_modern_branch_without_a_version_literal(self):
        cases = [
            ('if($environment["surge-build"]<3112)$done({body:"legacy"});'
             'else $done({body:"modern"});', 'modern'),
            ('if(3112>$environment["surge-build"])$done({body:"legacy"});'
             'else $done({body:"modern"});', 'modern'),
        ]
        for source, body in cases:
            with self.subTest(source=source):
                native = convert_script(source, 'Fixture', URL, '', source_format='surge')
                self.assertNotIn('3112', native)
                self.assertNotIn('$environment', native)
                self.assertNotIn('surge-build', native)
                case = {'name': 'surge build branch', 'request': {'url': URL},
                        'expected': {'result': {'body': body}}}
                self.assertEqual(compare(source, native, 'surge', URL, case)['status'], 'passed')

    def test_platform_version_values_never_escape_or_compare_as_exact_versions(self):
        cases = [
            '$done({body:$environment["surge-build"]});',
            'const build=$environment["surge-build"];$done({body:build});',
            'unknown($environment["surge-build"]);$done({});',
            'if($environment["surge-build"])$done({body:"new"});else $done({body:"old"});',
            'Boolean($environment["surge-build"])?$done({body:"new"}):$done({body:"old"});',
            '$environment["surge-build"]&&$done({body:"new"});',
            'if($environment["surge-build"]===3112)$done({body:"new"});else $done({body:"old"});',
            'if($environment["surge-build"]>=3112)$done({body:"new"});else $done({body:"old"});',
            '$done({body:$environment["surge-version"]});',
            'const version=$environment["surge-version"];$done({body:version});',
            'if($environment["surge-version"]>"5.0")$done({body:"new"});else $done({body:"old"});',
            'if($environment["surge-version"]<3112)$done({body:"old"});else $done({body:"new"});',
        ]
        for source in cases:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '', source_format='surge')

    def test_surge_build_probe_selects_the_modern_notification_projection(self):
        probe = """
import assert from 'node:assert/strict';
import {platformFold} from './tools/js-analysis/platform/globals.mjs';
const fold=(source,format)=>platformFold(source,format).source;
const sentinel='const present=typeof $environment!=="undefined"&&$environment["surge-build"]!=="undefined";';
assert.equal(fold(sentinel,'surge'),'const present = true;');
assert.equal(fold(sentinel,'loon'),'const present = false;');
assert.equal(fold(sentinel,'qx'),'const present = false;');
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
        source = ('const legacy=$environment["surge-build"]<3112;'
                  'if(legacy){$notification.post("t","s","b",{url:"https://a.test/"})}'
                  'else{$notification.post("t","s","b",{action:"open-url",url:"https://a.test/",'
                  '"media-url":"https://a.test/i.png"})}$done({});')
        native = convert_script(source, 'Fixture', URL, '', source_format='surge')
        self.assertNotIn('3112', native)
        self.assertNotIn('$environment', native)
        case = {'name': 'surge build probe', 'request': {'url': URL},
                'expected': {'events': {'notifications': [
                    {'title': 't', 'subtitle': 's', 'body': 'b',
                     'action': {'type': 'openUrl', 'url': 'https://a.test/'},
                     'attachment': {'url': 'https://a.test/i.png'}}]}}}
        self.assertEqual(compare(source, native, 'surge', URL, case)['status'], 'passed')


if __name__ == '__main__':
    unittest.main()
