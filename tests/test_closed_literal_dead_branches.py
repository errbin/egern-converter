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

    def test_closed_literal_pure_method_call_folds_and_converts(self):
        # 表字段只被静态读取，方法体只读取形参和表字段时可安全折叠为字面量。
        source=(
            "const f={k:'x',p:function(a,b){return a!==b}};"
            "const result=f['p'](f['k'],'x');if(result)unknown();"
            "$done({body:String(result)});"
        )
        folded=fold(source)
        self.assertRegex(folded,r"const result\s*=\s*false")
        self.assertNotIn("f['p']",folded)
        native=convert_script(source,'Fixture',URL,'',source_format='surge')
        case={'name':'closed literal pure method','request':{'url':URL},
              'expected':{'result':{'body':'false'}}}
        result=compare(source,native,'surge',URL,case)
        self.assertEqual(result['status'],'passed',result)

    def test_branch_probe_reads_helper_before_a_rejected_reassignment(self):
        # 条件先求值、分支体后执行；因此分支内的 helper 表改绑不能反过来
        # 否定条件读取所看到的初始化器。更强的方法链也必须同样折叠。
        source=(
            "let q={key:'target',neq:function(a,b){return a!==b;},"
            "probe:function(a,b){return a!==b;}};"
            "const outer={test:function(a,b){return q.neq(a,b);}};"
            "if(outer.test(q.key,q.key))q=null;"
            "if(!q.probe('undefined',typeof window))$done({body:'browser'});"
            "else $done({body:'other'});"
        )
        folded=fold(source)
        self.assertNotIn('q.probe(',folded)

    def test_branch_probe_keeps_live_or_mutated_helper_reassignments(self):
        # 反例 1：谓词为真，分支改绑可达。
        # 反例 2：谓词方法在条件前被重绑。
        # 反例 3：条件未知，不能假定分支不可达。
        base=(
            "let q={key:'target',neq:function(a,b){return a!==b;},"
            "probe:function(a,b){return a!==b;}};"
            "const outer={test:function(a,b){return q.neq(a,b);}};"
            "CONDITION"
            "if(!q.probe('undefined',typeof window))$done({body:'browser'});"
            "else $done({body:'other'});"
        )
        counterexamples=[
            "if(outer.test(q.key,'other'))q=null;",
            "q.neq=function(){return true};if(outer.test(q.key,q.key))q=null;",
            "if(unknown())q=null;",
        ]
        for replacement in counterexamples:
            source=base.replace('CONDITION',replacement)
            with self.subTest(replacement=replacement):
                self.assertIn('q.probe(',fold(source))

    def test_table_field_write_only_rejects_the_probed_key(self):
        # 正例：只写与探测字段不相交的静态键，probe 仍由初始化器决定。
        base=("let q={probe:function(a,b){return a!==b;},other:1};WRITE"
              "if(q.probe('a','b'))$done({body:'a'});else $done({body:'b'});")
        folded=fold(base.replace('WRITE','q.other=2;'))
        self.assertNotIn('q.probe(',folded)

        # 反例 1：写入被探测字段本身。
        # 反例 2：动态键无法证明与探测字段不相交。
        for write in ["q.probe=function(){return true};",
                      "const key='other';q[key]=2;"]:
            with self.subTest(write=write):
                self.assertIn('q.probe(',fold(base.replace('WRITE',write)))

    def test_nonmutating_callee_escape_and_live_escapes(self):
        # 对象字面量作为 callee 会在求值点抛出 TypeError，不可能改写表或
        # 把表交给其它代码；不可达调用同样不构成逃逸。
        base="let q={probe:function(a,b){return a!==b;}};ESCAPEif(q.probe('a','b'))$done({body:'a'});else $done({body:'b'});"
        folded=fold(base.replace('ESCAPE','if(false)q();'))
        self.assertNotIn('q.probe(',folded)

        # 反例 1：整表传给未知代码。
        # 反例 2：通过别名写入被探测字段。
        for escape in ["unknown(q);",
                       "let alias=q;alias.probe=function(){return true};"]:
            with self.subTest(escape=escape):
                self.assertIn('q.probe(',fold(base.replace('ESCAPE',escape)))

    def test_self_dependent_write_cannot_use_its_own_predicate_as_a_death_proof(self):
        # 条件读取的正是候选写入所在的可变成员/绑定。写入是否可达依赖它
        # 自己的前瞻值，不能把自身当作已证不可达；保守短路后仍保留探测。
        base=("let q={probe:function(a,b){return a!==b;},other:1};CONDITION"
              "if(q.probe('a','b'))$done({body:'a'});else $done({body:'b'});")
        counterexamples=[
            "if(q.probe('a','b'))q.probe=function(){return true};",
            "if(q.probe('a','b'))q={probe:function(){return true},other:2};",
        ]
        for condition in counterexamples:
            with self.subTest(condition=condition):
                self.assertIn('q.probe(',fold(base.replace('CONDITION',condition)))

    def test_method_write_escape_dynamic_key_this_or_early_call_keeps_call(self):
        # 任一项不满足就保持原调用：方法重绑、表整体逃逸、动态键、读取 this
        # 或调用早于初始化，都不能用纯表达式折叠吞掉异常或副作用。
        cases=[
            "const f={k:'x',p:function(a,b){return a!==b}};"
            "f.p=function(){return false};const result=f['p'](f['k'],'x');$done({body:String(result)});",
            "const f={k:'x',p:function(a,b){return a!==b}};unknown(f);"
            "const result=f['p'](f['k'],'x');$done({body:String(result)});",
            "const f={k:'x',p:function(a,b){return a!==b}};"
            "const result=f[$argument](f['k'],'x');$done({body:String(result)});",
            "const f={k:'x',p:function(a,b){return this.k!==b}};"
            "const result=f['p'](f['k'],'x');$done({body:String(result)});",
            "const result=f['p'](f['k'],'x');"
            "const f={k:'x',p:function(a,b){return a!==b}};$done({body:String(result)});",
        ]
        for source in cases:
            with self.subTest(source=source):
                folded=fold(source)
                self.assertIn("f[",folded)
                self.assertNotRegex(folded,r"const result\s*=\s*false")


if __name__=='__main__':
    unittest.main()
