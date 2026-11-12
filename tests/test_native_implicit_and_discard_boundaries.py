"""原生完成边界的双向回归：隐式全局、丢弃位置与定时器回调。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL = 'https://example.test/source.js'


class NativeImplicitAndDiscardBoundaryTests(unittest.TestCase):
    def convert(self, source):
        return convert_script(source, 'Fixture', URL, '', source_format='surge')

    def check(self, source, case):
        output = self.convert(source)
        fixture = {'name': case.get('name', 'completion boundary'), 'request': {'url': URL}, **case}
        result = compare(source, output, 'surge', URL, fixture)
        self.assertEqual(result['status'], 'passed', result)
        return output

    def test_strict_implicit_assignment_keeps_reference_error_timing(self):
        # 严格作用域中的未声明赋值不能被局部化，否则会吞掉原始 ReferenceError。
        source = '"use strict";strictImplicit=1;$done({});'
        output = self.convert(source)
        self.assertNotIn('let strictImplicit', output)
        result = compare(source, output, 'surge', URL,
                         {'name': 'strict implicit', 'request': {'url': URL}})
        self.assertEqual(result['status'], 'original_error', result)
        self.assertEqual(result['original_error'], result['converted_error'])

    def test_sloppy_implicit_assignment_still_uses_the_existing_local_binding_rule(self):
        # 非严格脚本仍按原规则建立本地绑定，并保持赋值后的读取结果。
        source = 'sloppyImplicit=1;$done({body:String(sloppyImplicit)});'
        output = self.check(source, {'name': 'sloppy implicit',
                                     'expected': {'result': {'body': '1'}}})
        self.assertIn('let sloppyImplicit', output)

    def test_same_implicit_name_across_strict_and_sloppy_scopes_is_rejected(self):
        # 同名隐式全局跨严格/非严格作用域时，任何单一定义都会改变异常时机。
        source = ('function strictScope(){"use strict";sharedImplicit=1}'
                  'function sloppyScope(){sharedImplicit=2}'
                  'strictScope();sloppyScope();$done({});')
        with self.assertRaisesRegex(ConversionError, '同一隐式全局'):
            self.convert(source)

    def test_comma_statement_discards_terminal_call_result(self):
        # 独立逗号表达式的值全部丢弃，完成调用只需终止流程。
        source = '$done({body:"ok"}),unknownTail();'
        self.check(source, {'name': 'discarded sequence completion',
                            'expected': {'result': {'body': 'ok'}}})

    def test_terminal_call_in_a_consumed_sequence_is_rejected(self):
        # 结果被赋值消费时仍无法证明完成结果与后续表达式之间的传播契约。
        source = 'const value=($done({body:"ok"}),0);'
        with self.assertRaisesRegex(ConversionError, '完成操作嵌入表达式'):
            self.convert(source)

    def test_sequence_completion_propagates_from_the_tail_or_direct_owner_call(self):
        # 直接完成调用由同一 owner 立即 return，可安全位于序列前项；末项的
        # 嵌套完成也会把结果作为整个序列的返回值传播。
        self.check('function tail(){}tail(),$done({body:"ok"});',
                   {'name':'direct completion before tail',
                    'expected':{'result':{'body':'ok'}}})
        source=('function tail(){}$argument?$done({body:"early"}):0,tail(),'
                '$done({body:"fallback"});')
        self.check(source,{'name':'conditional direct completion',
                           'expected':{'result':{'body':'fallback'}}})
        self.check(source,{'name':'conditional direct completion branch','argument':'go',
                           'expected':{'result':{'body':'early'}}})
        self.check('function tail(){}tail(),(()=>{$done({body:"ok"})})();',
                   {'name':'nested completion at sequence tail',
                    'expected':{'result':{'body':'ok'}}})

    def test_sequence_completion_inside_nested_owner_before_tail_is_rejected(self):
        # 嵌套 IIFE 或完成函数引用的 return 只退出自身，外层仍会求值后续项；
        # 这种形态无法保持原脚本“完成即终止”的顺序。
        for source in [
            '(()=>{$done({body:"ok"})})(),(()=>{throw new Error("late")})();',
            'function finish(){$done({body:"ok"})}finish(),unknownTail();',
        ]:
            with self.subTest(source=source), \
                    self.assertRaisesRegex(ConversionError, '逗号序列前项含完成操作'):
                self.convert(source)

    def test_conditional_implicit_global_direct_call_is_rejected(self):
        # 条件初始化的隐式全局直接作为调用目标时，函数身份和完成契约均未知。
        source = 'if($argument)conditionalCallable=()=>1;conditionalCallable();$done({});'
        with self.assertRaisesRegex(ConversionError, '条件初始化的隐式全局调用'):
            self.convert(source)

    def test_conditional_implicit_global_member_call_is_allowed(self):
        # 成员调用只把隐式全局当作接收者，未初始化读取仍保留 ReferenceError。
        source = ('if($argument)conditionalValue={replace(){return "ok"}};'
                  'let result;try{result=conditionalValue.replace("x","y")}'
                  'catch(error){result=error.name}$done({body:result});')
        self.check(source, {'name': 'conditional member initialized', 'argument': 'go',
                            'expected': {'result': {'body': 'ok'}}})
        self.check(source, {'name': 'conditional member uninitialized',
                            'expected': {'result': {'body': 'ReferenceError'}}})

    def test_completion_function_as_first_setTimeout_argument_is_allowed(self):
        # 首参是已证明的完成函数时，定时器调用可以按完成边界传播。
        source = 'function finish(){$done({body:"ok"})}setTimeout(finish,10);'
        output = self.check(source, {'name': 'timer completion', 'event_loop': True,
                                     'expected': {'result': {'body': 'ok'}}})
        self.assertNotIn('$done', output)

    def test_completion_function_outside_the_first_setTimeout_argument_is_rejected(self):
        # 非首参或非 setTimeout 的调用会改变完成函数的调用时机与接收者。
        for source in [
            'function finish(){$done({body:"ok"})}setTimeout(0,finish);',
            'function finish(){$done({body:"ok"})}unknown(finish);',
        ]:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                self.convert(source)

    def test_ignored_plain_then_and_catch_callbacks_are_preserved(self):
        # 全部回调可证明不完成、不同步提升时，被忽略的 Promise 链原样保留。
        for method in ('then', 'catch'):
            source = (f'let ran=false;Promise.resolve().{method}(function(){{ran=true}});'
                      '$done({body:String(ran)});')
            output = self.check(source, {'name': f'ignored {method}',
                                         'expected': {'result': {'body': 'false'}}})
            self.assertIn('.' + method + '(', output)

    def test_completing_or_async_then_callback_is_still_rejected(self):
        # 回调完成或异步提升时，未等待的 Promise 链仍可能改变全局终止顺序。
        for source in [
            'Promise.resolve().then(function(){$done({body:"late"})});$done({body:"first"});',
            'Promise.resolve().then(async function(){return 1});$done({body:"first"});',
        ]:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                self.convert(source)


if __name__ == '__main__':
    unittest.main()
