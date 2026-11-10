"""闭合对象字面量只在无写入且可证明晚于初始化进入时折叠死分支。"""
import json
from pathlib import Path
import subprocess
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare


ROOT=Path(__file__).resolve().parents[1]
URL='https://example.test/closed-literal.js'


def fold(source):
    probe="""
import {readFileSync} from 'node:fs';
import {platformFold} from './tools/js-analysis/platform/globals.mjs';
const {source}=JSON.parse(readFileSync(0,'utf8'));
process.stdout.write(platformFold(source,'surge',{}).source);
"""
    result=subprocess.run(
        ['node','--input-type=module','-e',probe],
        input=json.dumps({'source':source}),cwd=ROOT,text=True,capture_output=True,check=True,
    )
    return result.stdout


class ClosedLiteralDeadBranchTests(unittest.TestCase):
    def test_nested_function_can_observe_an_inert_literal_declared_first(self):
        source=(
            "(function(){var g={a:'x',b:'y'},h=(function(){return function(){"
            "if(g['a']===g['b'])return 'dead';return 'live'}})();"
            "$done({body:h()});})();"
        )
        folded=fold(source)
        self.assertNotIn("'dead'",folded)
        self.assertIn("'live'",folded)

    def test_mutation_or_earlier_call_keeps_the_comparison_live(self):
        sources=[
            "(function(){var g={a:'x',b:'y'},h=(function(){return function(){"
            "if(g['a']===g['b'])return 'dead';return 'live'}})();"
            "g.a='y';$done({body:h()});})();",
            "(function(){function h(){if(g['a']===g['b'])return 'dead';return 'live'}"
            "h();var g={a:'x',b:'y'};$done({body:h()});})();",
        ]
        for source in sources:
            with self.subTest(source=source):
                self.assertIn("'dead'",fold(source))

    def test_dead_literal_branch_conversion_matches_the_original(self):
        source=(
            "(function(){var g={a:'x',b:'y'};function h(){"
            "if(g['a']===g['b'])return 'dead';return 'live'}"
            "$done({body:h()});})();"
        )
        native=convert_script(source,'Fixture',URL,'',source_format='surge')
        case={'name':'closed literal dead branch','request':{'url':URL},'expected':{'result':{'body':'live'}}}
        result=compare(source,native,'surge',URL,case)
        self.assertEqual(result['status'],'passed',result)

    def test_escaping_literal_observation_still_rejects_forwarding(self):
        source="const h={done:function(f,v){return f(v)}};unknown(h||{});h.done($done,{body:'ok'});"
        with self.assertRaises(ConversionError):
            convert_script(source,'Fixture',URL,'')


if __name__=='__main__':
    unittest.main()
