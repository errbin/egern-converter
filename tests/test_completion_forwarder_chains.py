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

    def test_closed_predicate_and_if_identity_wrapper_keep_timer_completion(self):
        sources = [
            ("const A={},flags={enabled:true};"
             "function same(left,right){return left===right}"
             "A.mark=function(fn){if(same(flags.enabled,true))return fn;else return fn;};"
             "setTimeout(A.mark(()=>$done({body:'ok'})),0);"),
            ("const A={},flags={enabled:true},P={same:function(left,right){return left===right}};"
             "A.mark=function(fn){return P.same(flags.enabled,false)?Object.setPrototypeOf(fn,A):fn;};"
             "setTimeout(A.mark(()=>$done({body:'ok'})),0);"),
        ]
        for source in sources:
            with self.subTest(source=source):
                output = convert_script(source, 'Fixture', URL, '', source_format='loon')
                fixture = {'name': 'conditional identity completion wrapper', 'event_loop': True,
                           'request': {'url': URL}, 'expected': {'result': {'body': 'ok'}}}
                result = compare(source, output, 'loon', URL, fixture)
                self.assertEqual(result['status'], 'passed', result)

    def test_unknown_predicate_side_effect_and_table_write_reject_identity_wrapper(self):
        variants = [
            ("const A={},flags={enabled:true};"
             "function same(left,right){return left===right}"
             "A.mark=function(fn){if(same(flags.enabled,false))return fn;else{touch();return fn;}};"
             "setTimeout(A.mark(()=>$done({body:'ok'})),0);"),
            ("const A={},flags={enabled:true};"
             "function same(left,right){return left===right}"
             "A.mark=function(fn){if(same(flags.enabled,true)){touch();return fn;}else return fn;};"
             "setTimeout(A.mark(()=>$done({body:'ok'})),0);"),
            ("const A={},flags={enabled:true};flags.enabled=false;"
             "function same(left,right){return left===right}"
             "A.mark=function(fn){if(same(flags.enabled,true))return fn;else{touch();return fn;}};"
             "setTimeout(A.mark(()=>$done({body:'ok'})),0);"),
        ]
        for source in variants:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '', source_format='loon')

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

    def test_forwarder_table_escape_in_a_closed_dead_branch_is_ignored(self):
        source = ("const flags={mode:'live'},table={forward:function(f,v){return f(v)}};"
                  "function dispatch(f,v){return table.forward(f,v)}"
                  "if(flags.mode==='dead')unknown(table);dispatch($done,{body:'ok'});")
        lowered = lower(source)
        self.assertEqual(len(lowered['transformations']), 1, lowered)
        self.check(source)

    def test_live_unknown_and_written_forwarder_table_escapes_remain_rejected(self):
        prefix = "const table={forward:function(f,v){return f(v)}};function dispatch(f,v){return table.forward(f,v)}"
        for source in [
            "const flags={mode:'live'};" + prefix + "if(flags.mode==='live')unknown(table);dispatch($done,{body:'ok'});",
            "const flags={mode:'live'};" + prefix + "if($argument==='dead')unknown(table);dispatch($done,{body:'ok'});",
            "const flags={mode:'live'};" + prefix + "flags.mode='dead';if(flags.mode==='dead')unknown(table);dispatch($done,{body:'ok'});",
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
