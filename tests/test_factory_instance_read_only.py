"""工厂返回实例的裸读取只在值观察或内建丢弃返回值时可保持闭合。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare


URL = 'https://example.test/factory-instance-read-only.js'
BASE = ("function create(){return {value:'ok',done:function(v){$done(v)}}};"
        "const z=new create();USAGE")


class FactoryInstanceReadOnlyTests(unittest.TestCase):
    def check(self, usage):
        source = BASE.replace('USAGE', usage)
        native = convert_script(source, 'Fixture', URL, '', source_format='surge')
        case = {'name': 'factory instance read only', 'request': {'url': URL},
                'expected': {'result': {'body': 'ok'}}}
        result = compare(source, native, 'surge', URL, case)
        self.assertEqual(result['status'], 'passed', result)

    def test_truth_typeof_and_discarded_array_callback_return_are_read_only(self):
        self.check("if(z)z.done({body:z.value});")
        self.check("if(typeof z==='object')z.done({body:z.value});")
        self.check("[1].forEach(()=>z);z.done({body:z.value});")

    def test_unknown_alias_and_return_consumers_reject_the_instance(self):
        counterexamples = [
            "unknown(z);z.done({body:z.value});",
            "const alias=z;alias.value='changed';z.done({body:z.value});",
            "function leak(){return z}leak();z.done({body:z.value});",
            "const value=(z,1);z.done({body:z.value});",
        ]
        for usage in counterexamples:
            with self.subTest(usage=usage), self.assertRaises(ConversionError):
                convert_script(BASE.replace('USAGE', usage), 'Fixture', URL, '',
                               source_format='surge')


if __name__ == '__main__':
    unittest.main()
