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


class DiscardedSelfCheckShellTests(unittest.TestCase):
    def test_pure_discarded_self_check_is_short_circuited(self):
        source = SHELL.replace('{tail}', '$done({body:"ok"});')
        output = convert_script(source, 'Fixture', URL, '', source_format='surge')
        self.assertNotIn('search', output)
        fixture = {'name': 'discarded self check', 'request': {'url': URL},
                   'expected': {'result': {'body': 'ok'}}}
        result = compare(source, output, 'surge', URL, fixture)
        self.assertEqual(result['status'], 'passed', result)

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
