import json
from pathlib import Path
import shutil
import subprocess
import unittest
from tools.egern_hub.deobfuscate import deobfuscate
from tools.egern_hub.script_convert import convert_script

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(shutil.which('node') and (ROOT / 'tools/js-readability/node_modules/acorn').exists(), 'Optional readability dependencies required')
class ReadabilityTests(unittest.TestCase):
    def evaluate(self, code):
        return subprocess.check_output(['node', '--input-type=module', '-e', code], text=True)

    def test_literals_regex_template_and_directive_preserve_behavior(self):
        source = r'''// Original author: Example
const a = ["\x61\u0062", 0x20];
const regex = /a\x62/;
const template = String.raw`\x61`;
console.log(JSON.stringify([a, regex.test(a[0]), template]));'''
        readable = deobfuscate(source)
        self.assertIn('"ab"', readable)
        self.assertIn('Original author: Example', readable)
        self.assertEqual(self.evaluate(source), self.evaluate(readable))
        # An escaped directive must not become a strict-mode directive.
        directive = r'function f(){"use\x20strict";return this===undefined} console.log(f());'
        try:
            output = deobfuscate(directive)
        except ValueError:
            return  # A failed equivalence check must refuse the change.
        self.assertEqual(self.evaluate(directive), self.evaluate(output))

    def test_dynamic_code_and_source_inspection_are_rejected(self):
        for source in ['eval("1+1")', 'new Function("return 1")', 'function a(){};a.toString()', 'function a(){};a["toString"]()', r'function a(){};a["\x74oString"]()']:
            with self.subTest(source=source), self.assertRaises(ValueError):
                deobfuscate(source)

    def test_does_not_execute_input_and_invalid_syntax_fails(self):
        self.assertIn('throw', deobfuscate('throw new Error("must never execute");'))
        with self.assertRaises(ValueError):
            deobfuscate('function {')

    def test_readability_then_native_conversion(self):
        source = r'$done({body:"\x6f\x6b"});'
        output = convert_script(source, 'Example', 'https://example.com/a.js', 'Original notice', readable=True)
        self.assertIn('body:"ok"', output)
        self.assertIn('Egern adaptation: ErrBin', output)
        self.assertIn('export default async function(ctx)', output)


class NativeScriptTests(unittest.TestCase):
    def test_native_script_is_not_wrapped_or_recredited(self):
        source = '// Author: Original\nexport default async function(ctx) {return {body: "ok"};}\n'
        self.assertEqual(convert_script(source, 'Original', 'https://example.com/a.js', '', source_format='egern'), source)
        with self.assertRaises(ValueError):
            convert_script('$done({});', 'Original', 'https://example.com/a.js', '', source_format='egern')
