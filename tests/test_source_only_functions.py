"""只被 toString 注入的浏览器补丁函数不算宿主运行时依赖。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
URL = 'https://example.test/injected-patch.js'

INJECTED_FUNCTION = '''function patch(){
  window.patchMarker = 1;
  return window.patchMarker;
}
const injected = '<script>(' + patch.toString() + ')();<\\/script>';
$done({body:'<html></html>'.replace('</html>', injected + '</html>')});
'''


class SourceOnlyFunctionTests(unittest.TestCase):
    def test_stringified_browser_patch_is_not_a_host_dependency(self):
        for source_format in ['qx', 'surge', 'loon']:
            with self.subTest(source_format=source_format):
                output = convert_script(INJECTED_FUNCTION, 'Fixture', URL, '',
                                        source_format=source_format)
                self.assertIn('patch.toString()', output)
                self.assertIn('window.patchMarker', output)

    def test_executable_or_escaped_function_remains_rejected(self):
        counterexamples = [
            INJECTED_FUNCTION.replace('const injected',
                                      'patch();const injected'),
            INJECTED_FUNCTION.replace('const injected',
                                      'const alias=patch;const injected'),
            INJECTED_FUNCTION.replace(
                '$done(',
                'consume(injected);$done('),
            INJECTED_FUNCTION.replace(
                '$done(',
                'consume(injected + "");$done('),
            INJECTED_FUNCTION.replace('patch.toString()', 'patch["toString"]()'),
            INJECTED_FUNCTION.replace('patch.toString()', 'alias(patch.toString())'),
            INJECTED_FUNCTION.replace('window.patchMarker = 1;', '$done({});window.patchMarker = 1;'),
        ]
        for source in counterexamples:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '', source_format='surge')

    def test_response_fallback_alias_keeps_closed_field_semantics(self):
        source = "const response=$response||{};$done({body:response.body});"
        for source_format in ['qx', 'surge', 'loon']:
            with self.subTest(source_format=source_format):
                output = convert_script(source, 'Fixture', URL, '',
                                        source_format=source_format)
                self.assertIn('ctx.response||{}', output)
                self.assertIn('response.body', output)

    def test_response_whole_object_escape_still_rejects(self):
        for source in [
            'unknown($response);$done({body:"ok"});',
            'const response=$response;unknown(response);$done({body:"ok"});',
            'unknown(($response));$done({body:"ok"});',
        ]:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '', source_format='surge')


if __name__ == '__main__':
    unittest.main()
