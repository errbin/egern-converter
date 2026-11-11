"""极简 regenerator 只改写同步、单入口、无异常边且完成槽闭合的机器。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare


URL = 'https://example.test/minimal-regenerator.js'
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


def source_with(body, table=''):
    return (RUNTIME +
            "function outer(){return runtime.wrap(function(ctx){for(;;)switch(ctx.prev=ctx.next){"
            + body + "}},outer,null" + (',' + table if table else '') + ");}\n"
            + "const drive=outer();drive.next();\n")


class MinimalRegeneratorLoweringTests(unittest.TestCase):
    def test_direct_completion_is_lowered_and_compared(self):
        source = source_with("case 0:$done({body:'ok'});return ctx.stop();")
        output = convert_script(source, 'Fixture', URL, '')
        self.assertNotIn('runtime.wrap', output)
        result = compare(source, output, 'surge', URL, {
            'name': 'minimal direct completion',
            'request': {'url': URL},
            'expected': {'result': {'body': 'ok'}},
        })
        self.assertEqual(result['status'], 'passed', result)

    def test_single_write_completion_slot_is_inlined(self):
        source = source_with(
            "case 0:var saved=$done;ctx.next=2;break;"
            "case 2:saved({body:'slot'});return ctx.stop();")
        output = convert_script(source, 'Fixture', URL, '')
        self.assertNotIn('runtime.wrap', output)
        self.assertNotIn('saved=$done', output.replace(' ', ''))
        result = compare(source, output, 'surge', URL, {
            'name': 'minimal completion slot',
            'request': {'url': URL},
            'expected': {'result': {'body': 'slot'}},
        })
        self.assertEqual(result['status'], 'passed', result)

    def test_exception_table_handler_is_lowered_and_compared(self):
        source = source_with(
            "case 0:ctx.prev=0;ctx.next=2;break;"
            "case 2:JSON.parse('{');ctx.next=4;break;"
            "case 4:ctx.next=6;break;"
            "case 6:$done({body:'recovered'});return ctx.stop();",
            table='[[0,4]]')
        output = convert_script(source, 'Fixture', URL, '')
        self.assertNotIn('runtime.wrap', output)
        result = compare(source, output, 'surge', URL, {
            'name': 'minimal exception handler',
            'request': {'url': URL},
            'expected': {'result': {'body': 'recovered'}},
        })
        self.assertEqual(result['status'], 'passed', result)

    def test_six_rejection_categories_remain_closed(self):
        cases = {
            'multiple dispatch entries': (
                "case 0:for(;;)switch(ctx.prev=ctx.next){case 1:$done({body:'x'});return ctx.stop();}"
                "return ctx.stop();", ''),
            'exception edge': (
                "case 0:$done({body:'x'});return ctx.stop();case 2:return ctx.stop();", '[[0,2]]'),
            'finally side effect': (
                "case 0:ctx.next=2;break;case 2:ctx.next=4;break;"
                "case 4:$persistentStore.write('late','effect');ctx.next=6;break;"
                "case 6:$done({body:'x'});return ctx.stop();", '[[0,4,4,6]]'),
            'save slot reassignment': (
                "case 0:var saved=$done;saved=function(){return 1;};"
                "saved({body:'x'});return ctx.stop();", ''),
            'save slot escape': (
                "case 0:var saved=$done;consume(saved);return ctx.stop();", ''),
            'dynamic next target': (
                "case 0:ctx.next=dynamicTarget;break;case 2:return ctx.stop();", ''),
        }
        for name, (body, table) in cases.items():
            with self.subTest(name=name), self.assertRaises(ConversionError):
                convert_script(source_with(body, table), 'Fixture', URL, '')

    def test_three_exception_counterexamples_remain_closed(self):
        cases = {
            'handler target unreachable': (
                "case 0:return ctx.stop();case 2:ctx.prev=2;ctx.next=4;break;"
                "case 4:$done({body:'x'});return ctx.stop();", '[[2,4]]'),
            'handler business side effect': (
                "case 0:ctx.prev=0;ctx.next=2;break;case 2:ctx.next=4;break;"
                "case 4:$persistentStore.write('late','effect');ctx.next=6;break;"
                "case 6:$done({body:'x'});return ctx.stop();", '[[0,4]]'),
            'exception table state mismatch': (
                "case 0:ctx.prev=0;ctx.next=2;break;"
                "case 2:$done({body:'x'});return ctx.stop();", '[[0,2],[0,2],[0,2]]'),
        }
        for name, (body, table) in cases.items():
            with self.subTest(name=name), self.assertRaises(ConversionError):
                convert_script(source_with(body, table), 'Fixture', URL, '')

    def test_unknown_driver_still_rejects(self):
        source = source_with("case 0:$done({body:'x'});return ctx.stop();")
        source = source.replace('const drive=outer();drive.next();', 'const drive=outer();consume(drive);drive.next();')
        with self.assertRaises(ConversionError):
            convert_script(source, 'Fixture', URL, '')


if __name__ == '__main__':
    unittest.main()
