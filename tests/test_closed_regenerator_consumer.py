"""闭合 regenerator 完成消费方只放行可证单次完成的同步状态图。"""
from pathlib import Path
import json
import subprocess
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare


ROOT = Path(__file__).resolve().parents[1]
PROBE = ROOT / 'tests/helpers/regenerator-consumer-proof.mjs'
URL = 'https://example.test/closed-regenerator-consumer.js'

RUNTIME = '''const runtime = (function () {
  function mark(fn) { return fn; }
  function wrap(inner, outer, self, tryLocsList) {
    var context = {prev: 0, next: 0, sent: undefined, method: 'next', arg: undefined, tryEntries: tryLocsList || []};
    context.abrupt = function (type, arg) { context.method = type; return {type: type, arg: arg, done: true}; };
    context.stop = function () { return {done: true}; };
    function _invoke(method, arg) {
      context.method = method; context.arg = arg;
      for (;;) {
        try { return inner(context); }
        catch (error) {
          var entry = null;
          for (var i = 0; i < context.tryEntries.length; i++) {
            var candidate = context.tryEntries[i];
            if (candidate[0] <= context.prev && context.prev < candidate[1]) { entry = candidate; break; }
          }
          if (!entry) throw error;
          context.next = entry[1];
          context.method = 'next';
          context.arg = undefined;
        }
      }
    }
    return {next(value) { var result = _invoke('next', value); return {value: result, done: false}; }};
  }
  return {mark, wrap, abrupt(type, arg) { return {type: type, arg: arg}; }, stop() { return {done: true}; }, _invoke() { return this.prev; }};
})();
'''


def source_with(body):
    return (RUNTIME +
            "function outer(){return runtime.wrap(function(ctx){for(;;)switch(ctx.prev=ctx.next){"
            + body + "}},outer,null);}\n"
            + "const drive=outer();drive.next();\n")


def consume(source):
    result = subprocess.run(['node', str(PROBE)], input=source, cwd=ROOT,
                            text=True, capture_output=True, check=True)
    return json.loads(result.stdout)


class ClosedRegeneratorConsumerTests(unittest.TestCase):
    def assert_rejected(self, body):
        proof = consume(source_with(body))
        self.assertFalse(proof['accepted'], proof)

    def convert_and_compare(self, body, expected, name):
        source = source_with(body)
        output = convert_script(source, 'Fixture', URL, '', source_format='surge')
        self.assertIn('runtime.wrap', output)
        fixture = {'name': name, 'request': {'url': URL}, 'expected': {'result': {'body': expected}}}
        result = compare(source, output, 'surge', URL, fixture)
        self.assertEqual(result['status'], 'passed', result)

    def test_dead_state_with_reachable_completion_converts_and_compares(self):
        body = ("case 0:$done({body:'ok'});return ctx.stop();"
                "case 2:$done({body:'dead'});return ctx.stop();")
        proof = consume(source_with(body))
        self.assertTrue(proof['accepted'], proof)
        self.assertFalse(proof['proved'], proof)
        self.assertTrue(proof['deadReachabilityProved'], proof)
        self.convert_and_compare(body, 'ok', 'dead reachability completion')

    def test_independent_terminations_in_distinct_states_convert_and_compare(self):
        body = ("case 0:if(ctx.sent){ctx.next=2;break;}ctx.next=4;break;"
                "case 2:$done({body:'a'});return ctx.stop();"
                "case 4:$done({body:'b'});return ctx.stop();")
        proof = consume(source_with(body))
        self.assertTrue(proof['accepted'], proof)
        self.assertTrue(proof['proved'], proof)
        self.assertEqual(proof['completions'], 2, proof)
        self.convert_and_compare(body, 'b', 'distinct state completions')

    def test_completion_only_in_dead_states_is_rejected(self):
        cases = {
            'single dead completion': (
                "case 0:return ctx.stop();"
                "case 2:$done({body:'dead'});return ctx.stop();"),
            'multiple dead completion chain': (
                "case 0:return ctx.stop();"
                "case 2:$done({body:'first'});ctx.next=4;break;"
                "case 4:$done({body:'second'});return ctx.stop();"),
        }
        for name, body in cases.items():
            with self.subTest(name=name):
                self.assert_rejected(body)

    def test_cyclic_entry_subgraph_is_rejected(self):
        cases = {
            'back edge after completion': (
                "case 0:$done({body:'ok'});ctx.next=2;break;"
                "case 2:ctx.next=0;break;"),
            'self loop before completion': (
                "case 0:if(ctx.sent){ctx.next=2;break;}ctx.next=0;break;"
                "case 2:$done({body:'ok'});return ctx.stop();"),
        }
        for name, body in cases.items():
            with self.subTest(name=name):
                self.assert_rejected(body)

    def test_multiple_completions_in_one_case_are_rejected(self):
        cases = {
            'branch alternatives': (
                "case 0:if(ctx.sent){$done({body:'a'});}else{$done({body:'b'});}"
                "return ctx.stop();"),
            'sequential calls': (
                "case 0:$done({body:'a'});$done({body:'b'});return ctx.stop();"),
        }
        for name, body in cases.items():
            with self.subTest(name=name):
                self.assert_rejected(body)

    def test_nonterminal_tail_reaching_another_completion_is_rejected(self):
        cases = {
            'explicit next edge': (
                "case 0:$done({body:'a'});ctx.next=2;break;"
                "case 2:$done({body:'b'});return ctx.stop();"),
            'switch fallthrough': (
                "case 0:$done({body:'a'});"
                "case 2:$done({body:'b'});return ctx.stop();"),
        }
        for name, body in cases.items():
            with self.subTest(name=name):
                self.assert_rejected(body)


if __name__ == '__main__':
    unittest.main()
