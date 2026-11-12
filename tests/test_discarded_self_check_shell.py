"""丢弃式源码自检回调只在纯度、注入路径和结果丢弃都闭合时短路。"""
import unittest

from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL = 'https://example.test/self-check-shell.js'

SHELL = '''var factory = (function () {
  var state = true;
  return function (host, callback) {
    var fn = state ? function () {
      if (callback) {
        var result = callback.apply(host, arguments);
        return callback = null, result;
      } else {
        var seen = callback ? result : null;
        return seen;
      }
    } : function () {};
    return state = false, fn;
  };
}());
var wrapper = factory(this, function () {
  var key = {};
  key["K"] = "x";
  var alias = key;
  return wrapper["toString"]()["search"](alias["K"])["toString"]()["constructor"](wrapper)["search"](alias["K"]);
});
wrapper();
{tail}
'''


def assigned(body):
    return body.replace(
        'var wrapper = factory(this, function () {',
        'var wrapper;\n(0, wrapper = factory(this, function () {').replace(
        '});\nwrapper();', '}));\nwrapper();')


class DiscardedSelfCheckShellTests(unittest.TestCase):
    def test_pure_discarded_self_check_is_short_circuited(self):
        source = SHELL.replace('{tail}', '$done({body:"ok"});')
        output = convert_script(source, 'Fixture', URL, '', source_format='surge')
        self.assertNotIn('search', output)
        fixture = {'name': 'discarded self check', 'request': {'url': URL},
                   'expected': {'result': {'body': 'ok'}}}
        result = compare(source, output, 'surge', URL, fixture)
        self.assertEqual(result['status'], 'passed', result)

    def test_assigned_wrapper_with_opposite_branch_reads_is_short_circuited(self):
        source = assigned(SHELL).replace('{tail}', '$done({body:"ok"});')
        output = convert_script(source, 'Fixture', URL, '', source_format='surge')
        self.assertNotIn('search', output)
        fixture = {'name': 'assigned discarded self check', 'request': {'url': URL},
                   'expected': {'result': {'body': 'ok'}}}
        result = compare(source, output, 'surge', URL, fixture)
        self.assertEqual(result['status'], 'passed', result)

    def test_extra_callback_or_result_reads_outside_opposite_branch_are_rejected(self):
        cases = {
            'callback read after branches': SHELL.replace(
                '    } : function () {};\n    return state = false, fn;',
                '    } : function () {};\n    var leaked = callback;\n    return state = false, fn;'),
            'result read after branches': SHELL.replace(
                '        return callback = null, result;\n      } else {\n        var seen = callback ? result : null;\n        return seen;\n      }',
                '        return callback = null, result;\n      } else {\n        var seen = callback ? result : null;\n        return seen;\n      }\n      var tail = result;'),
        }
        for name, body in cases.items():
            with self.subTest(name=name):
                output = convert_script(body.replace('{tail}', '$done({body:"ok"});'),
                                        'Fixture', URL, '', source_format='surge')
                self.assertIn('search', output)

    def test_wrapper_with_multiple_writes_is_rejected(self):
        source = SHELL.replace(
            'wrapper();',
            'wrapper();\nwrapper = factory(this, function () {});\nwrapper();').replace(
            '{tail}', '$done({body:"ok"});')
        output = convert_script(source, 'Fixture', URL, '', source_format='surge')
        self.assertIn('search', output)

    def test_callback_with_observable_effect_is_not_short_circuited(self):
        source = SHELL.replace('{tail}', '$done({});').replace(
            '  var alias = key;',
            '  var alias = key;\n  $notification.post("shell", "", "", {url:"https://a.test"});')
        output = convert_script(source, 'Fixture', URL, '', source_format='surge')
        self.assertIn('.notify', output)
        fixture = {'name': 'observed self check', 'request': {'url': URL},
                   'expected': {'events': {'notifications': [
                       {'title': 'shell', 'subtitle': '', 'body': '',
                        'action': {'type': 'openUrl', 'url': 'https://a.test'}},
                   ]}}}
        result = compare(source, output, 'surge', URL, fixture)
        self.assertEqual(result['status'], 'passed', result)


if __name__ == '__main__':
    unittest.main()
