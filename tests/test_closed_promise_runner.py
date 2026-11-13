"""闭合 Promise runner 与对象表调用证明的正反例回归。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare


URL = 'https://example.test/closed-promise-runner.js'


def convert(source):
    return convert_script(source, 'Fixture', URL, '')


class ClosedPromiseRunnerTests(unittest.TestCase):
    def test_closed_factory_runner_preserves_completion_value(self):
        source = "const make=()=>()=>Promise.resolve('ok');make()().finally(()=>$done({body:'done'}));"
        output = convert(source)
        result = compare(
            source,
            output,
            'surge',
            URL,
            {'name': 'closed promise runner', 'request': {'url': URL},
             'expected': {'result': {'body': 'done'}}},
        )
        self.assertEqual(result['status'], 'passed', result)

    def test_promise_returning_helpers_and_factories_are_accepted(self):
        cases = [
            "function task(){return Promise.resolve('ok')}"
            "task().finally(()=>$done({body:'x'}));",
            "const make=()=>()=>Promise.resolve('ok');"
            "make()().finally(()=>$done({body:'x'}));",
            "const table={invoke(fn){return fn()}};"
            "function task(){return Promise.resolve('ok')}"
            "table.invoke(task).finally(()=>$done({body:'x'}));",
            "function init(){return ()=>Promise.resolve('ok')}"
            "function run(){return run=init(),run.apply(this,arguments)}"
            "run().finally(()=>$done({body:'x'}));",
        ]
        for source in cases:
            with self.subTest(source=source):
                output = convert(source)
                self.assertNotIn('$done', output)

    def test_nested_block_and_branch_tail_returns_are_accepted(self):
        cases = [
            "function task(){{return Promise.resolve('ok')}}"
            "task().finally(()=>$done({body:'x'}));",
            "function task(flag){if(flag){return Promise.resolve('a')}else{return Promise.resolve('b')}}"
            "task(true).finally(()=>$done({body:'x'}));",
        ]
        for source in cases:
            with self.subTest(source=source):
                output = convert(source)
                self.assertNotIn('$done', output)

    def test_mixed_promise_and_non_promise_returns_are_rejected(self):
        cases = [
            "function task(flag){if(flag)return Promise.resolve('a');return 1}"
            "task(flag).finally(()=>$done({body:'x'}));",
            "function task(flag){if(flag){return 1}else{return Promise.resolve('b')}}"
            "task(flag).finally(()=>$done({body:'x'}));",
            "const make=()=>1;"
            "make()().finally(()=>$done({body:'x'}));",
        ]
        for source in cases:
            with self.subTest(source=source):
                with self.assertRaises(ConversionError):
                    convert(source)

    def test_object_table_writes_dynamic_keys_and_escapes_are_rejected(self):
        cases = [
            "const table={invoke(fn){return fn()}};table.invoke=()=>1;"
            "function task(){return Promise.resolve('ok')}"
            "table.invoke(task).finally(()=>$done({body:'x'}));",
            "const table={invoke(fn){return fn()}};const key=getKey();"
            "function task(){return Promise.resolve('ok')}"
            "table[key](task).finally(()=>$done({body:'x'}));",
            "const table={invoke(fn){return fn()}};use(table);"
            "function task(){return Promise.resolve('ok')}"
            "table.invoke(task).finally(()=>$done({body:'x'}));",
        ]
        for source in cases:
            with self.subTest(source=source):
                with self.assertRaises(ConversionError):
                    convert(source)

    def test_conditional_or_unproven_writes_cannot_prove_a_promise_contract(self):
        cases = [
            "let run=()=>1;if(flag)run=()=>Promise.resolve('ok');"
            "run().finally(()=>$done({body:'x'}));",
            "let run=()=>1;"
            "function wrapper(){if(flag)run=()=>Promise.resolve('ok');return run.apply(this,arguments)}"
            "wrapper().finally(()=>$done({body:'x'}));",
            "const run=1;run.apply(null).finally(()=>$done({body:'x'}));",
        ]
        for source in cases:
            with self.subTest(source=source):
                with self.assertRaises(ConversionError):
                    convert(source)


if __name__ == '__main__':
    unittest.main()
