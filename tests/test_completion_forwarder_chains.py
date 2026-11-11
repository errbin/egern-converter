"""完成函数经封闭转发器或唯一恒等包装传递时仍可确定调用契约。"""
import json
from pathlib import Path
import subprocess
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

ROOT = Path(__file__).resolve().parents[1]
PROBE = ROOT / 'tests/helpers/completion-forwarder-lowering.mjs'
URL = 'https://example.test/completion-forwarder.js'


def lower(source):
    result = subprocess.run(['node', str(PROBE)], input=source, cwd=ROOT,
                            text=True, capture_output=True, check=True)
    return json.loads(result.stdout)


class CompletionForwarderChainTests(unittest.TestCase):
    def check(self, source):
        output = convert_script(source, 'Fixture', URL, '', source_format='loon')
        fixture = {'name': 'completion forwarder', 'request': {'url': URL},
                   'expected': {'result': {'body': 'ok'}}}
        result = compare(source, output, 'loon', URL, fixture)
        self.assertEqual(result['status'], 'passed', result)

    def test_direct_and_closed_table_forwarders_become_completion_calls(self):
        direct = "function dispatch(f,v){return f(v)}dispatch($done,{body:'ok'});"
        nested = ("const table={forward:function(f,v){return f(v)}};"
                  "function dispatch(f,v){return table.forward(f,v)}dispatch($done,{body:'ok'});")
        for source in [direct, nested]:
            with self.subTest(source=source):
                lowered = lower(source)
                self.assertEqual(len(lowered['transformations']), 1, lowered)
                self.assertIn('$done({body:\'ok\'})', lowered['source'])
                self.check(source)

    def test_unique_identity_wrapper_keeps_timer_completion(self):
        source = ("const A={};A.mark=function(fn){return Object.setPrototypeOf(fn,A),fn};"
                  "setTimeout(A.mark(()=>$done({body:'ok'})),0);")
        output = convert_script(source, 'Fixture', URL, '', source_format='loon')
        fixture = {'name': 'identity completion wrapper', 'event_loop': True,
                   'request': {'url': URL}, 'expected': {'result': {'body': 'ok'}}}
        result = compare(source, output, 'loon', URL, fixture)
        self.assertEqual(result['status'], 'passed', result)

    def test_forwarder_parameter_rewrite_side_effect_and_order_remain_rejected(self):
        for source in [
            "function dispatch(f,v){return f({body:'bad'})}dispatch($done,{body:'ok'});",
            "function dispatch(f,v){console.log(v);return f(v)}dispatch($done,{body:'ok'});",
            "function dispatch(f,v){return v(f)}dispatch($done,{body:'ok'});",
            "const table={forward:function(f,v){return f(v)}};function dispatch(f,v){return table.forward(v,f)}"
            "dispatch($done,{body:'ok'});",
            "const table={forward:function(f,v){return f(v)}};function dispatch(f,v){return table[$argument](f,v)}"
            "dispatch($done,{body:'ok'});",
        ]:
            with self.subTest(source=source):
                self.assertEqual(lower(source)['transformations'], [])

    def test_written_or_escaped_forwarder_table_remains_rejected(self):
        prefix = "const table={forward:function(f,v){return f(v)}};function dispatch(f,v){return table.forward(f,v)}"
        for source in [
            prefix + "table.forward=function(f,v){return f({body:'bad'})};dispatch($done,{body:'ok'});",
            prefix + "table.extra=1;dispatch($done,{body:'ok'});",
            prefix + "delete table.forward;dispatch($done,{body:'ok'});",
            prefix + "unknown(table);dispatch($done,{body:'ok'});",
        ]:
            with self.subTest(source=source):
                self.assertEqual(lower(source)['transformations'], [])

    def test_identity_wrapper_requires_unique_definition_and_original_return(self):
        for source in [
            "const A={};A.mark=function(fn){return function(){}};"
            "A.mark(async function(){await Promise.resolve();$done({body:'ok'})})();",
            "const A={};A.mark=function(fn){return fn};const B={};B.mark=function(fn){return fn};"
            "A.mark(async function(){await Promise.resolve();$done({body:'ok'})})();",
            "const A={};A.mark=function(fn){return fn};unknown(A.mark);"
            "A.mark(async function(){await Promise.resolve();$done({body:'ok'})})();",
            "const A={};A.mark=function(fn){fn=function(){};return fn};"
            "A.mark(async function(){await Promise.resolve();$done({body:'ok'})})();",
            "unknown($done);",
        ]:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '', source_format='loon')


if __name__ == '__main__':
    unittest.main()
