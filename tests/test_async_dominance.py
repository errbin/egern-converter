"""异步完成根的调用图支配证明必须接受闭合双根并拒绝六类旁路。"""
import json
from pathlib import Path
import subprocess
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare


ROOT = Path(__file__).resolve().parents[1]
PROBE = ROOT / 'tests/helpers/async-dominance.mjs'
URL = 'https://example.test/async-dominance.js'


def proved(source):
    result = subprocess.run(
        ['node', str(PROBE)],
        input=source,
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=True,
    )
    return json.loads(result.stdout)['proved']


class AsyncDominanceTests(unittest.TestCase):
    def test_closed_roots_and_tuhyche_shaped_double_root_are_accepted(self):
        cases = [
            "(async()=>{await Promise.resolve();$done({body:'first'})})().catch(()=>{}).finally(()=>$done({body:'last'}));",
            "(async()=>{await Promise.resolve();$done({body:'first'})})().catch(()=>{}).finally(()=>$done({body:'last'}));"
            "function main(){return Promise.resolve()}"
            "main().then(()=>$done({body:'second'})).catch(()=>{});",
        ]
        for source in cases:
            with self.subTest(source=source):
                self.assertTrue(proved(source))

    def test_early_call_before_initializer_is_rejected(self):
        source = "run().finally(()=>$done({}));const run=async()=>{await Promise.resolve()};"
        self.assertFalse(proved(source))
        with self.assertRaises(ConversionError):
            convert_script(source, 'Fixture', URL, '')

    def test_conditional_or_loop_bypass_is_rejected(self):
        for prefix, suffix in [('if(flag)', ''), ('for(;flag;)', '')]:
            source = (
                f"{prefix}run().finally(()=>$done({{}}));{suffix}"
                "const run=async()=>{await Promise.resolve()};"
            )
            with self.subTest(source=source):
                self.assertFalse(proved(source))
                with self.assertRaises(ConversionError):
                    convert_script(source, 'Fixture', URL, '')

    def test_exception_path_around_launch_is_rejected(self):
        source = (
            "const run=async()=>{await Promise.resolve()};"
            "try{run().finally(()=>$done({}))}finally{$persistentStore.write('late','effect')}"
        )
        self.assertFalse(proved(source))
        with self.assertRaises(ConversionError):
            convert_script(source, 'Fixture', URL, '')

    def test_execution_after_a_completion_chain_is_rejected(self):
        source = (
            "const run=async()=>{await Promise.resolve()};"
            "run().finally(()=>$done({}));unknown();"
        )
        self.assertFalse(proved(source))
        with self.assertRaises(ConversionError):
            convert_script(source, 'Fixture', URL, '')

    def test_binding_write_and_cross_closure_escape_are_rejected(self):
        cases = [
            "let run=async()=>{await Promise.resolve()};run=other;run().finally(()=>$done({}));",
            "const run=async()=>{await Promise.resolve()};run().finally(()=>$done({}));use(run);",
            "const finish=()=>$done({});const run=async()=>{await Promise.resolve()};use(finish);run().finally(finish);",
        ]
        for source in cases:
            with self.subTest(source=source):
                self.assertFalse(proved(source))
                with self.assertRaises(ConversionError):
                    convert_script(source, 'Fixture', URL, '')

    def test_chain_without_a_proven_promise_contract_is_rejected(self):
        source = "const run=()=>1;run().finally(()=>$done({}));"
        with self.assertRaises(ConversionError):
            convert_script(source, 'Fixture', URL, '')

    def test_double_root_preserves_first_native_completion(self):
        source = (
            "let log='';"
            "(async()=>{await Promise.resolve();log+='first';$done({body:log})})()"
            ".catch(()=>{}).finally(()=>$done({body:'wrapper'}));"
            "function main(){return Promise.resolve()}"
            "main().then(()=>{log+='second';$done({body:log})}).catch(()=>{});"
        )
        output = convert_script(source, 'Fixture', URL, '')
        self.assertNotIn('$done', output)
        result = compare(
            source,
            output,
            'surge',
            URL,
            {
                'name': '异步双根支配',
                'event_loop': True,
                'request': {'url': URL},
                'expected': {'result': {'body': 'first'}},
            },
        )
        self.assertEqual(result['status'], 'passed', result)

    def test_conditional_root_requires_both_branches_to_reach_completion(self):
        source = ("function finishB(){$done({body:'b'})}"
                  "const flag=$request.url.endsWith('/a');"
                  "const run=async()=>{await Promise.resolve()};"
                  "if(flag){run().finally(()=>$done({body:'a'}))}else{finishB()}")
        self.assertTrue(proved(source))
        output = convert_script(source, 'Fixture', URL, '')
        for suffix in ['a', 'b']:
            case = {'name': 'conditional completion root', 'event_loop': True,
                    'request': {'url': URL + '/' + suffix},
                    'expected': {'result': {'body': suffix}}}
            result = compare(source, output, 'surge', URL, case)
            self.assertEqual(result['status'], 'passed', result)
        one_branch = ("const flag=$request.url.endsWith('/a');"
                      "const run=async()=>{await Promise.resolve()};"
                      "if(flag){run().finally(()=>$done({body:'a'}))}")
        self.assertFalse(proved(one_branch))
        unreachable = ("const flag=true;const run=async()=>{await Promise.resolve()};"
                       "if(flag){run().finally(()=>$done({body:'a'}))}"
                       "else{return;$done({body:'b'})}")
        self.assertFalse(proved(unreachable))

    def test_hoisted_function_and_inert_declaration_after_root_are_accepted(self):
        source = ("run().finally(()=>$done({body:'ok'}));"
                  "function run(){return Promise.resolve()}const answer=1+2;")
        self.assertTrue(proved(source))
        output = convert_script(source, 'Fixture', URL, '')
        case = {'name': 'hoisted completion root', 'event_loop': True,
                'request': {'url': URL}, 'expected': {'result': {'body': 'ok'}}}
        self.assertEqual(compare(source, output, 'surge', URL, case)['status'], 'passed')

    def test_effectful_trailing_call_or_variable_initializer_is_rejected(self):
        sources = [
            ("run().finally(()=>$done({}));unknown();"
             "function run(){return Promise.resolve()}"),
            ("run().finally(()=>$done({}));const answer=compute();"
             "function run(){return Promise.resolve()}function compute(){return 1}"),
        ]
        for source in sources:
            with self.subTest(source=source):
                self.assertFalse(proved(source))
                with self.assertRaises(ConversionError):
                    convert_script(source, 'Fixture', URL, '')

    def test_trailing_local_iife_must_not_call_or_use_host_globals(self):
        source = ("const run=async()=>{await Promise.resolve()};"
                  "run().finally(()=>$done({body:'ok'}));(()=>{const answer=1+2;})();")
        self.assertTrue(proved(source))
        output = convert_script(source, 'Fixture', URL, '')
        case = {'name': 'closed trailing iife', 'event_loop': True,
                'request': {'url': URL}, 'expected': {'result': {'body': 'ok'}}}
        self.assertEqual(compare(source, output, 'surge', URL, case)['status'], 'passed')
        for suffix in ['(()=>{unknown();})();', '(()=>{$persistentStore.read("key");})();']:
            with self.subTest(suffix=suffix):
                rejected = ("const run=async()=>{await Promise.resolve()};"
                            "run().finally(()=>$done({body:'ok'}));" + suffix)
                self.assertFalse(proved(rejected))
                with self.assertRaises(ConversionError):
                    convert_script(rejected, 'Fixture', URL, '')


if __name__ == '__main__':
    unittest.main()
