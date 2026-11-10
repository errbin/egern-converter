"""封闭类工厂的调用图证明必须同时接受完整闭合形态并拒绝任何逃逸。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare


URL = 'https://example.test/closed-method.js'
BASE = (
    "const runtime=new Factory({url:'https://example.test/base'});"
    "runtime.done({body:'ok'});"
    'function Factory(options){return new class{'
    'constructor(options){Object.assign(this,options)}'
    'done(value){$done(value)}}(options)}'
)


class ClosedMethodCallerTests(unittest.TestCase):
    def test_closed_factory_instance_method_converts_and_preserves_result(self):
        output = convert_script(BASE, 'Fixture', URL, '', source_format='loon')
        self.assertNotIn('$done', output)
        result = compare(BASE, output, 'loon', URL, {
            'name': '封闭工厂完成方法',
            'request': {'url': URL},
            'expected': {'result': {'body': 'ok'}},
        })
        self.assertEqual(result['status'], 'passed', result)

    def test_nested_direct_call_and_multiple_closed_instances_are_accepted(self):
        cases = [
            (
                "const runtime=new Factory({url:'https://example.test/base'});"
                'finish();function finish(){runtime.done({body:"ok"})}'
                'function Factory(options){return new class{'
                'constructor(options){Object.assign(this,options)}'
                'done(value){$done(value)}}(options)}'
            ),
            (
                "const first=new Factory({url:'https://example.test/a'});"
                "const second=new Factory({url:'https://example.test/b'});"
                'first.done({body:"ok"});'
                'function Factory(options){return new class{'
                'constructor(options){Object.assign(this,options)}'
                'done(value){$done(value)}}(options)}'
            ),
        ]
        for source in cases:
            with self.subTest(source=source):
                output = convert_script(source, 'Fixture', URL, '', source_format='loon')
                self.assertNotIn('$done', output)

    def test_instance_or_factory_escape_rejects_the_call_graph(self):
        variants = [
            BASE.replace(
                "runtime.done({body:'ok'});",
                "use(runtime);runtime.done({body:'ok'});",
            ),
            BASE + 'use(Factory);',
            BASE + 'function later(){use(runtime)}',
        ]
        for source in variants:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '', source_format='loon')

    def test_binding_write_or_method_value_use_rejects_the_call_graph(self):
        variants = [
            BASE.replace('const runtime=', 'let runtime=').replace(
                "runtime.done({body:'ok'});",
                "runtime=new Factory({url:'https://example.test/changed'});"
                "runtime.done({body:'ok'});",
            ),
            BASE.replace(
                "runtime.done({body:'ok'});",
                "const finish=runtime.done;finish({body:'ok'});",
            ),
            BASE.replace(
                "runtime.done({body:'ok'});",
                "const methodName=$argument;runtime[methodName]({body:'ok'});",
            ),
        ]
        for source in variants:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '', source_format='loon')

    def test_unproved_or_method_overwriting_constructor_copy_is_rejected(self):
        variants = [
            BASE.replace("{url:'https://example.test/base'}", 'options'),
            BASE.replace(
                "{url:'https://example.test/base'}",
                "{url:'https://example.test/base',done:()=>$done({body:'shadow'})}",
            ),
            BASE.replace(
                'constructor(options){Object.assign(this,options)}',
                'constructor(options){Object.assign(this,options,{done:1})}',
            ),
        ]
        for source in variants:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '', source_format='loon')


if __name__ == '__main__':
    unittest.main()
