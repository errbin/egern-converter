"""内联完成函数只有在结果可证明与最终完成无关时才允许交给本地封闭目标。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare


URL = 'https://example.test/inline-completion-result.js'
COMPLETION = "function(){$done({body:'ok'})}"


class InlineCompletionResultProofTests(unittest.TestCase):
    def convert(self, source):
        return convert_script(source, 'Fixture', URL, '')

    def test_closed_target_that_discards_the_return_value_is_accepted(self):
        source = f"function consume(cb){{cb({{}});}}consume({COMPLETION});"
        native = self.convert(source)
        case = {'name': 'discarded callback result', 'request': {'url': URL},
                'expected': {'result': {'body': 'ok'}}}
        result = compare(source, native, 'surge', URL, case)
        self.assertEqual(result['status'], 'passed', result)

    def test_unknown_callbacks_still_reject(self):
        cases = [
            f"unknown({COMPLETION});",
            f"const callback={COMPLETION};unknown(callback);",
            f"const holder={{callback:{COMPLETION}}};unknown(holder);",
            f"unknown([{COMPLETION}]);",
            f"unknown(...[{COMPLETION}]);",
            f"const holder={{callback:{COMPLETION}}};unknown(holder.callback);",
        ]
        for source in cases:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                self.convert(source)

    def test_stored_or_forwarded_callback_still_rejects(self):
        cases = [
            f"let saved;function store(cb){{saved=cb;}}store({COMPLETION});",
            f"function relay(cb){{return cb;}}unknown(relay({COMPLETION}));",
            f"function run(cb){{return cb();}}const alias=run;unknown(alias);"
            f"alias({COMPLETION});",
        ]
        for source in cases:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                self.convert(source)

    def test_return_consuming_state_machine_still_rejects(self):
        cases = [
            f"const runtime={{wrap(inner){{return {{next(){{return inner({{}})}}}};}}}};"
            f"runtime.wrap({COMPLETION}).next();",
            f"const runtime={{mark(fn){{return fn;}},wrap(inner){{return {{next(){{return inner({{}})}}}};}}}};"
            f"const driver=runtime.mark(function outer(){{return runtime.wrap({COMPLETION},outer);}});"
            f"driver().next();",
        ]
        for source in cases:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                self.convert(source)

    def test_context_dependent_payload_still_rejects(self):
        source = ("const runtime={wrap(inner){return {next(state){return inner(state)}}}};"
                  "runtime.wrap(function(state){$done({body:state.body});}).next({body:'ok'});")
        with self.assertRaises(ConversionError):
            self.convert(source)

    def test_unknown_conditional_invocation_still_rejects(self):
        source = (f"function maybe(cb){{if(flag)cb({{}});}}unknown(maybe);"
                  f"maybe({COMPLETION});")
        with self.assertRaises(ConversionError):
            self.convert(source)

    def test_target_object_escape_still_rejects(self):
        source = (f"const runtime={{run:function(cb){{return cb({{}});}}}};"
                  f"unknown(runtime);runtime.run({COMPLETION});")
        with self.assertRaises(ConversionError):
            self.convert(source)


if __name__ == '__main__':
    unittest.main()
