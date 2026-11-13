"""完成函数引用只有在闭表谓词静态判死时才能忽略。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL = 'https://example.test/completion-dead-branch.js'


class ClosedCompletionDeadBranchTests(unittest.TestCase):
    def convert(self, source):
        return convert_script(source, 'Fixture', URL, '', source_format='surge')

    def check(self, source):
        native = self.convert(source)
        case = {'name': 'completion dead branch', 'request': {'url': URL},
                'expected': {'result': {'body': 'ok'}}}
        result = compare(source, native, 'surge', URL, case)
        self.assertEqual(result['status'], 'passed', result)

    def test_closed_predicate_dead_branch_may_hold_completion_escape(self):
        sources = [
            ("const flags={mode:'live'};function eq(a,b){return a===b}"
             "if(eq(flags.mode,'dead'))unknown($done);$done({body:'ok'});"),
            ("const flags={mode:'live'},ops={eq:function(a,b){return a===b}};"
             "function same(a,b){return ops.eq(a,b)}"
             "if(same(flags.mode,'dead'))unknown($done);$done({body:'ok'});"),
            ("const flags={mode:'live'};function eq(a,b){return a===b}"
             "if(eq(flags.mode,'live')){$done({body:'ok'})}else{unknown($done)}"),
        ]
        for source in sources:
            with self.subTest(source=source):
                self.check(source)

    def test_live_written_escaped_or_dynamic_predicate_still_rejects(self):
        sources = [
            ("const flags={mode:'live'};function eq(a,b){return a===b}"
             "if(eq(flags.mode,'live'))unknown($done);$done({body:'ok'});"),
            ("const flags={mode:'live'};flags.mode='dead';"
             "if(flags.mode==='dead')unknown($done);$done({body:'ok'});"),
            ("const flags={mode:'live'};unknown(flags);"
             "if(flags.mode==='dead')unknown($done);$done({body:'ok'});"),
            "if($argument==='dead')unknown($done);$done({body:'ok'});",
        ]
        for source in sources:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                self.convert(source)

    def test_loose_equality_never_collapses_a_live_branch(self):
        source = "const flags={n:0};if(flags.n=='0')unknown($done);$done({body:'ok'});"
        with self.assertRaises(ConversionError):
            self.convert(source)


if __name__ == '__main__':
    unittest.main()
