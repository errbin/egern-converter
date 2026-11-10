"""只在目标宿主没有 window 时折叠 typeof 探测，未受保护的浏览器对象继续拒绝。"""
import json
import subprocess
import unittest
from pathlib import Path

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare


URL = 'https://example.test/window-fallback.js'
ROOT = Path(__file__).resolve().parents[1]


class WindowFallbackFoldingTests(unittest.TestCase):
    def convert(self, source):
        return convert_script(source, 'Fixture', URL, '')

    def check(self, source, expected_body):
        native = self.convert(source)
        case = {'name': 'window fallback', 'request': {'url': URL},
                'expected': {'result': {'body': expected_body}}}
        result = compare(source, native, 'surge', URL, case)
        self.assertEqual(result['status'], 'passed', result)

    def test_guarded_fallback_chain_selects_global_this(self):
        self.check(
            "const root=typeof window!=='undefined'?window:Math;"
            "$done({body:root===Math?'ok':'bad'});",
            'ok',
        )

    def test_window_typeof_probe_folds_to_undefined(self):
        self.check("$done({body:typeof window});", 'undefined')
        self.check(
            "const hasWindow=typeof window!=='undefined';"
            "$done({body:String(hasWindow)});",
            'false',
        )

    def test_guarded_window_property_access_is_removed(self):
        self.check(
            "const crypto=typeof window!=='undefined'&&window.crypto;"
            "$done({body:String(Boolean(crypto))});",
            'false',
        )

    def test_local_window_binding_is_not_a_host_probe(self):
        self.check(
            "const window={value:'local'};$done({body:window.value});",
            'local',
        )

    def test_unreachable_browser_branch_is_removed(self):
        self.check(
            "if(typeof window!=='undefined'){window.localStorage.setItem('k','v')}"
            "$done({body:'ok'});",
            'ok',
        )

    def test_unguarded_browser_objects_still_reject(self):
        for source in [
            "window.alert('x');$done({body:'ok'});",
            "const w=window;$done({body:w.name});",
            "const location=window.location;$done({body:location.href});",
            "const w=typeof window!=='undefined'||window;$done({body:w.name});",
            "const w=probe?window:null;$done({body:w.name});",
        ]:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                self.convert(source)

    def test_logical_fold_does_not_skip_uninitialized_reads(self):
        probe = """
import assert from 'node:assert/strict';
import {platformFold} from './tools/js-analysis/platform/globals.mjs';
assert.match(platformFold('const value=(late&&false);let late;','qx').source,/late&&false/);
assert.match(platformFold('function f(late){return !late&&false;}','qx').source,
  /function f\\(late\\)\\{return false;\\}/);
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


if __name__ == '__main__':
    unittest.main()
