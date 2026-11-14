"""本地函数被字符串化时，转换必须保留原始源码文本。"""
import unittest

from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL = 'https://example.test/function-source.js'


class ObservableFunctionSourceTests(unittest.TestCase):
    def convert(self, source):
        return convert_script(source, 'Fixture', URL, '', source_format='surge')

    def assert_source_preserved(self, source, expected):
        native = self.convert(source)
        case = {'name': 'observable function source', 'request': {'url': URL},
                'expected': {'result': {'body': expected}}}
        result = compare(source, native, 'surge', URL, case)
        self.assertEqual(result['status'], 'passed', result)

    def test_declaration_source_is_preserved(self):
        source = ('function patch(){ return "a"+"b"; }\n'
                  '$done({body:patch.toString()});\n')
        self.assert_source_preserved(source, 'function patch(){ return "a"+"b"; }')

    def test_function_expression_source_is_preserved(self):
        source = ('const patch=function(){ return "a"+"b"; };\n'
                  '$done({body:patch.toString()});\n')
        self.assert_source_preserved(source, 'function(){ return "a"+"b"; }')

    def test_arrow_source_is_preserved(self):
        source = ('const patch=()=> "a"+"b";\n'
                  '$done({body:patch.toString()});\n')
        self.assert_source_preserved(source, '()=> "a"+"b"')


if __name__ == '__main__':
    unittest.main()
