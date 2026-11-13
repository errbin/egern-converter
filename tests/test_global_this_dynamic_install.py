"""globalThis 只在动态安装器或同名全局读取可静态证明时保留。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL = 'https://example.test/global-this-install.js'


class GlobalThisDynamicInstallTests(unittest.TestCase):
    def convert(self, source):
        return convert_script(source, 'Fixture', URL, '', source_format='qx')

    def check(self, source, expected):
        native = self.convert(source)
        fixture = {'name': 'globalThis install', 'request': {'url': URL},
                   'expected': {'result': {'body': expected}}}
        result = compare(source, native, 'qx', URL, fixture)
        self.assertEqual(result['status'], 'passed', result)

    def test_static_global_read_matches_free_identifier(self):
        source = ('const direct=typeof fzstd;const qualified=typeof globalThis.fzstd;'
                  '$done({body:direct+":"+qualified});')
        self.check(source, 'undefined:undefined')

    def test_dynamic_function_may_receive_the_real_global_this(self):
        source = ('Function("this.__egernRound40Installed = 1").call(globalThis);'
                  '$done({body:"ok"});')
        native = self.convert(source)
        self.assertIn('.call(globalThis)', native)

    def test_dynamic_installer_family_keeps_the_exact_global_record(self):
        source = ('let z=typeof fzstd!=="undefined"?fzstd:'
                  '(typeof globalThis!=="undefined"&&globalThis.fzstd);'
                  '$done({body:typeof z});')
        self.check(source, 'undefined')

    def test_global_escape_writes_and_shadowing_still_reject(self):
        sources = [
            'unknown(globalThis);$done({body:"x"});',
            'Function("return this").call(globalThis,1);$done({body:"x"});',
            'const fzstd={};$done({body:typeof globalThis.fzstd});',
            'globalThis.fzstd=1;$done({body:String(globalThis.fzstd)});',
            'const key="fzstd";$done({body:String(globalThis[key])});',
            '$done({body:String(globalThis.window)});',
        ]
        for source in sources:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                self.convert(source)


if __name__ == '__main__':
    unittest.main()
