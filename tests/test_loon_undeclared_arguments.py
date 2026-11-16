"""未在 [Argument] 声明的开关按“未声明即关”补充，且不得凭空产生会被脚本当真的值。"""
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

    def test_undeclared_argument_value_stays_unset_instead_of_a_truthy_string(self):
        # 关闭状态传入脚本的值必须是空串；字符串 "false" 在 JavaScript 里是 truthy，
        # 会让脚本把“未开启”误判成已开启，属于引入行为偏差。
        obj = convert_module(module(
            '[Script]\n'
            'http-response ^https://a\\.com/x script-path=https://e.com/a.js, argument=[{undeclaredFlag}], tag=t\n'
        ), 'loon', scripts_native=True, generated_headers=True, native_rewrites=True)
        value = obj['compat_arguments']['undeclaredFlag']
        self.assertEqual(value, '')
        self.assertNotEqual(value, 'false')
        self.assertIn('本站补充参数 undeclaredFlag', obj['compat_arguments_desc'])

    def test_undeclared_slots_that_need_a_concrete_value_are_still_rejected(self):
        for body in [
            '[Script]\ncron {undeclaredCron} script-path=https://e.com/a.js, tag=t\n',
            '[Script]\nhttp-response ^https://a\\.com/x script-path=https://e.com/a.js, timeout={undeclaredTimeout}, tag=t\n',
        ]:
            with self.subTest(body=body), self.assertRaises(ConversionError):
                convert_module(module(body), 'loon', scripts_native=True, generated_headers=True, native_rewrites=True)

    def test_module_without_a_declaration_table_still_rejects_undeclared_switches(self):
        # 没有 [Argument] 说明声明表不在当前来源作用域内；此时补参数会越过来源边界，
        # 必须保持原来的拒绝，不能靠合成开关把这类模块放行。
        source = ('[Script]\n'
                  'http-response ^https://a\\.com/x script-path=https://e.com/a.js, '
                  'enable={noScopeSwitch}, tag=t\n')
        with self.assertRaises(ConversionError):
            convert_module(source, 'loon', scripts_native=True, generated_headers=True, native_rewrites=True)


if __name__ == '__main__':
    unittest.main()
