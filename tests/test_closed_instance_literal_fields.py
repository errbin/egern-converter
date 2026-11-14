"""封闭本地实例的常量字段只在实际数据流可证时折叠。"""
import subprocess
import unittest
from pathlib import Path

from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare


ROOT = Path(__file__).resolve().parents[1]
URL = 'https://example.test/closed-instance-literal.js'
PROBE = """
import {readFileSync} from 'node:fs';
import {lowerClosedInstanceLiteralFields} from './tools/js-analysis/transforms/factories.mjs';
process.stdout.write(lowerClosedInstanceLiteralFields(readFileSync(0, 'utf8')));
"""


def fold(source):
    result = subprocess.run(
        ['node', '--input-type=module', '-e', PROBE],
        input=source, cwd=ROOT, text=True, capture_output=True, check=True,
    )
    return result.stdout


class ClosedInstanceLiteralFieldTests(unittest.TestCase):
    def test_write_once_literal_fields_fold_dead_reads(self):
        cases = [
            "class C{}const x=new C();x.flag=false;if(x.flag)unknown();$done({body:'live'});",
            "function C(){this.other=1}const x=new C();x.flag=false;if(x.flag)unknown();$done({body:'live'});",
            "class C{}const x=new C();x.flag=true;const value=x.flag?'live':'dead';$done({body:value});",
        ]
        for source in cases:
            with self.subTest(source=source):
                folded = fold(source)
                self.assertNotIn('if(x.flag)', folded)
                self.assertNotIn('unknown()', folded)
                self.assertNotIn("'dead'", folded)

    def test_folded_field_is_differentially_equivalent(self):
        source = "class C{}const x=new C();x.flag=false;if(x.flag)unknown();$done({body:'live'});"
        native = convert_script(source, 'Fixture', URL, '', source_format='surge')
        case = {'name': 'closed instance literal', 'request': {'url': URL},
                'expected': {'result': {'body': 'live'}}}
        self.assertEqual(compare(source, native, 'surge', URL, case)['status'], 'passed')

    def test_method_prototype_and_this_escape_keep_the_field_live(self):
        cases = [
            "class C{evil(){this.flag=true}}const x=new C();x.flag=false;x.evil();if(x.flag)unknown();$done({body:'live'});",
            "class C{}Object.defineProperty(C.prototype,'flag',{get(){return true}});const x=new C();x.flag=false;if(x.flag)unknown();$done({body:'live'});",
            "class C{constructor(){unknown(this)}}const x=new C();x.flag=false;if(x.flag)unknown();$done({body:'live'});",
        ]
        for source in cases:
            with self.subTest(source=source):
                self.assertIn('if(x.flag)', fold(source))

    def test_extra_write_early_read_or_escape_keeps_the_field_live(self):
        cases = [
            "class C{}const x=new C();x.flag=false;x.flag=true;if(x.flag)unknown();$done({body:'live'});",
            "class C{}const x=new C();if($request.url)x.flag=false;if(x.flag)unknown();$done({body:'live'});",
            "class C{}const x=new C();if(x.flag)unknown();x.flag=false;$done({body:'live'});",
            "class C{}const x=new C();unknown(x);x.flag=false;if(x.flag)unknown();$done({body:'live'});",
        ]
        for source in cases:
            with self.subTest(source=source):
                self.assertIn('if(x.flag)', fold(source))

    def test_returned_object_dynamic_key_or_effectful_field_stays_live(self):
        cases = [
            "function C(){return {}}const x=new C();x.flag=false;if(x.flag)unknown();$done({body:'live'});",
            "class C{}const x=new C();x[$argument]=false;if(x.flag)unknown();$done({body:'live'});",
            "class C{other=unknown()}const x=new C();x.flag=false;if(x.flag)unknown();$done({body:'live'});",
        ]
        for source in cases:
            with self.subTest(source=source):
                self.assertIn('if(x.flag)', fold(source))

    def test_live_constructor_shapes_keep_equivalent_error_paths(self):
        sources = [
            "class C{evil(){this.flag=true}}const x=new C();x.flag=false;x.evil();if(x.flag)unknown();$done({body:'live'});",
            "class C{}Object.defineProperty(C.prototype,'flag',{get(){return true}});const x=new C();x.flag=false;if(x.flag)unknown();$done({body:'live'});",
        ]
        for source in sources:
            with self.subTest(source=source):
                native = convert_script(source, 'Fixture', URL, '', source_format='surge')
                result = compare(source, native, 'surge', URL,
                                 {'name': 'live constructor path', 'request': {'url': URL},
                                  'expected': {'result': {'body': 'live'}}})
                self.assertEqual(result['status'], 'original_error', result)
                self.assertEqual(result['original_error'], result['converted_error'])


if __name__ == '__main__':
    unittest.main()
