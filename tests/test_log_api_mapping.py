"""Loon 的 $log 只会产生日志观察，必须映射为等价的 console.log 调用。"""
import unittest
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare
from tools.egern_hub.convert import ConversionError
URL = 'https://example.test/log.js'


class LogAPIMappingTests(unittest.TestCase):
    def test_direct_statement_log_maps_to_console(self):
        source = '$log("value", {ok: true});$done({body: "ok"});'
        native = convert_script(source, 'Fixture', URL, '', source_format='loon')
        fixture = {'name': 'log mapping', 'request': {'url': URL},
                   'expected': {'result': {'body': 'ok'}}}
        result = compare(source, native, 'loon', URL, fixture)
        self.assertEqual(result['status'], 'passed', result)
        self.assertIn('console.log', native)
        self.assertNotIn('$log', native)

    def test_spread_arguments_keep_evaluation_order(self):
        source = 'const values = ["a", "b"];$log(...values);$done({});'
        native = convert_script(source, 'Fixture', URL, '', source_format='loon')
        self.assertIn('console.log(...values)', native)
        self.assertNotIn('$log', native)

    def test_non_statement_uses_remain_rejected(self):
        for label, source in [
            ('alias', 'const log = $log;log("x");$done({});'),
            ('returned value', '$done({ok: !!$log("x")});'),
            ('condition', 'if($log("x")){$done({});}'),
            ('constructor', 'new $log("x");$done({});'),
            ('member escape', '$log.call(null, "x");$done({});'),
            ('assignment', '$log = () => {};$done({});'),
        ]:
            with self.subTest(label=label), self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '', source_format='loon')


if __name__ == '__main__':
    unittest.main()
