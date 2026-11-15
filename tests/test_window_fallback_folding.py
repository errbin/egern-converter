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
            "window.crypto;$done({body:'ok'});",
            "const w=(0,window);$done({body:String(w)});",
        ]:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                self.convert(source)

    def test_missing_global_write_is_not_rewritten_as_a_read(self):
        with self.assertRaises(ConversionError):
            self.convert("window=1;$done({body:'ok'});")
        self.check("$done({body:typeof window});",'undefined')
        self.check("const window={value:'local'};$done({body:window.value});",'local')

    def test_missing_global_catch_assignment_preserves_reference_error(self):
        source=("let value='ok';try{value=JSON.parse($argument).value}"
                "catch(error){value=window}$done({body:String(value)});")
        native=self.convert(source)
        for usage in ('=window','(window','window.','typeof window'):
            self.assertNotIn(usage,native)
        self.assertIn('new ReferenceError("window is not defined")',native)
        success={'name':'catch fallback success path','request':{'url':URL},
                 'argument':'{"value":"parsed"}','expected':{'result':{'body':'parsed'}}}
        result=compare(source,native,'surge',URL,success)
        self.assertEqual(result['status'],'passed',result)
        failure={'name':'catch fallback ReferenceError path','request':{'url':URL},
                 'argument':'not json'}
        result=compare(source,native,'surge',URL,failure)
        self.assertEqual(result['status'],'original_error',result)
        self.assertEqual(result['original_error'],'window is not defined')
        self.assertEqual(result['converted_error'],'window is not defined')

    def test_catch_fallback_only_rewrites_bare_missing_global_reads(self):
        probe="""
import assert from 'node:assert/strict';
import {lowerMissingGlobalCatchFallbacks} from './tools/js-analysis/platform/globals.mjs';
const rewrite=source=>lowerMissingGlobalCatchFallbacks(source).transformations.length;
assert.equal(rewrite('let v;try{v=1}catch(e){v=window}$done({});'),1);
assert.equal(rewrite('let v;try{v=1}catch(e){window=1}$done({});'),0);
assert.equal(rewrite('let v;try{v=1}catch(e){const window=2;v=window}$done({});'),0);
assert.equal(rewrite('let v;try{v=1}catch(e){v=window.foo}$done({});'),0);
assert.equal(rewrite('let v;try{v=1}catch(e){v=(window,1)}$done({});'),0);
assert.equal(rewrite('let v;try{v=1}catch(e){v=typeof window}$done({});'),0);
console.log(JSON.stringify({ok:true}));
"""
        result=subprocess.run(['node','--input-type=module','-e',probe],cwd=ROOT,
                              text=True,capture_output=True,check=True)
        self.assertEqual(json.loads(result.stdout),{'ok':True})
        for source in [
            "const w=window;$done({body:w.name});",
            "let v;try{v=1}catch(e){window=2}$done({body:String(v)});",
            "let v;try{v=1}catch(e){v=window.foo}$done({body:String(v)});",
            "let v;try{v=1}catch(e){v=typeof window}$done({body:String(v)});",
        ]:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                self.convert(source)
        local=self.convert("let v;try{v=1}catch(e){const window=2;v=window}"
                           "$done({body:String(v)});")
        self.assertEqual(local.count('ReferenceError'),0)

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
