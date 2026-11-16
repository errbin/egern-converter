"""仅未在 [Argument] 声明的 enable 开关按“未声明即关”补充；argument 引用仍拒绝。"""
import unittest

from tools.egern_hub.convert import convert_module, ConversionError

ARGS = '''[Argument]
declaredSwitch = switch,false,tag=已声明开关
declaredText = input,"x",tag=已声明文本
'''


def module(body):
    return ARGS + body


class UndeclaredArgumentTests(unittest.TestCase):
    def test_declared_switch_keeps_its_original_binding(self):
        obj = convert_module(module(
            '[Script]\n'
            'http-response ^https://a\\.com/x script-path=https://e.com/a.js, enable={declaredSwitch}, tag=t\n'
        ), 'loon', scripts_native=True, generated_headers=True, native_rewrites=True)
        self.assertEqual(obj['compat_arguments'], {'declaredSwitch': False, 'declaredText': 'x'})
        self.assertNotIn('本站补充参数', obj.get('compat_arguments_desc') or '')

    def test_declared_argument_keeps_its_original_binding(self):
        obj = convert_module(module(
            '[Script]\n'
            'http-response ^https://a\\.com/x script-path=https://e.com/a.js, argument=[{declaredText}], tag=t\n'
        ), 'loon', scripts_native=True, generated_headers=True, native_rewrites=True)
        self.assertEqual(obj['compat_arguments'], {'declaredSwitch': False, 'declaredText': 'x'})
        self.assertNotIn('本站补充参数', obj.get('compat_arguments_desc') or '')
        entry = obj['scriptings'][0]['http_response']
        self.assertEqual(entry['env']['argument'], '{"declaredText":"{{{declaredText}}}"}')
        self.assertTrue(entry['_native_options']['argument_object'])

    def test_undeclared_switch_is_supplied_closed_and_disclosed(self):
        obj = convert_module(module(
            '[Script]\n'
            'http-response ^https://a\\.com/x script-path=https://e.com/a.js, enable={undeclaredSwitch}, tag=t\n'
        ), 'loon', scripts_native=True, generated_headers=True, native_rewrites=True)
        self.assertIs(obj['compat_arguments']['undeclaredSwitch'], False)
        self.assertIn('本站补充参数 undeclaredSwitch', obj['compat_arguments_desc'])
        self.assertIn('默认关闭', obj['compat_arguments_desc'])
        self.assertEqual(obj['compat_arguments_schema']['undeclaredSwitch']['default_value'], 'false')
        self.assertEqual(obj['compat_arguments_schema']['undeclaredSwitch']['options'], ['true', 'false'])

    def test_undeclared_argument_reference_is_rejected(self):
        # argument 位置的具体值依赖参数声明类型（switch/input/select），未声明时类型不可知，
        # 合成值必然是猜测，因此必须沿用原来的拒绝路径，不能按 enable 的布尔语义放行。
        for argument in ['[{undeclaredFlag}]', '{undeclaredFlag}']:
            with self.subTest(argument=argument), self.assertRaisesRegex(ConversionError, '未声明或重复'):
                convert_module(module(
                    '[Script]\n'
                    'http-response ^https://a\\.com/x script-path=https://e.com/a.js, argument='+argument+', tag=t\n'
                ), 'loon', scripts_native=True, generated_headers=True, native_rewrites=True)

    def test_duplicate_argument_references_are_still_rejected(self):
        for argument in ['[{declaredText}, {declaredText}]', '{declaredText, declaredText}']:
            with self.subTest(argument=argument), self.assertRaisesRegex(ConversionError, '未声明或重复'):
                convert_module(module(
                    '[Script]\n'
                    'http-response ^https://a\\.com/x script-path=https://e.com/a.js, argument='+argument+', tag=t\n'
                ), 'loon', scripts_native=True, generated_headers=True, native_rewrites=True)

    def test_enable_synthesis_does_not_unlock_undeclared_argument_references(self):
        # enable 位置补出的本站开关不能被 argument 位置当作上游已声明参数复用。
        for first, second in [
            ('http-response ^https://a\\.com/x script-path=https://e.com/a.js, enable={mixedFlag}, argument=[{mixedFlag}], tag=t\n', ''),
            ('http-response ^https://a\\.com/x script-path=https://e.com/a.js, enable={mixedFlag}, tag=a\n',
             'http-response ^https://a\\.com/x script-path=https://e.com/a.js, argument=[{mixedFlag}], tag=b\n'),
        ]:
            with self.subTest(second=second), self.assertRaisesRegex(ConversionError, '未声明或重复'):
                convert_module(module('[Script]\n'+first+second), 'loon', scripts_native=True,
                               generated_headers=True, native_rewrites=True)

    def test_undeclared_slots_that_need_a_concrete_value_are_still_rejected(self):
        for body in [
            '[Script]\ncron {undeclaredCron} script-path=https://e.com/a.js, tag=t\n',
            '[Script]\nhttp-response ^https://a\\.com/x script-path=https://e.com/a.js, timeout={undeclaredTimeout}, tag=t\n',
        ]:
            with self.subTest(body=body), self.assertRaises(ConversionError):
                convert_module(module(body), 'loon', scripts_native=True, generated_headers=True, native_rewrites=True)

    def test_module_without_a_declaration_table_still_rejects_undeclared_references(self):
        # 没有 [Argument] 说明声明表不在当前来源作用域内；此时补参数会越过来源边界，
        # 必须保持原来的拒绝，不能靠合成开关把这类模块放行。
        for body in [
            '[Script]\nhttp-response ^https://a\\.com/x script-path=https://e.com/a.js, enable={noScopeSwitch}, tag=t\n',
            '[Script]\nhttp-response ^https://a\\.com/x script-path=https://e.com/a.js, argument=[{noScopeArgument}], tag=t\n',
        ]:
            with self.subTest(body=body), self.assertRaises(ConversionError):
                convert_module(body, 'loon', scripts_native=True, generated_headers=True, native_rewrites=True)


if __name__ == '__main__':
    unittest.main()
