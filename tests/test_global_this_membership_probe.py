"""封闭的 globalThis 平台标记查询可以折叠，未知/宿主变动仍准确拒绝。"""
import unittest
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.convert import ConversionError
URL='https://example.test/global-this-probe.js'

class GlobalThisMembershipProbeTests(unittest.TestCase):
    def test_known_marker_folds_through_local_predicate(self):
        source=("const platform=(()=>{const has=n=>n in globalThis;"
                "switch(true){case has('$task'):return 'qx';case has('Egern'):return 'egern';default:return 'other'}})();"
                "$done({body:platform});")
        output=convert_script(source,'Fixture',URL,'')
        self.assertIn('return{body:"egern"}',output.replace(' ',''))

    def test_explicit_egern_marker_wins_over_the_source_format(self):
        # `name in globalThis` 查询的是产物实际宿主能力；作者显式提供 Egern
        # 分支时应选择该分支，不能按源格式强选 Surge/QX 等旧平台分支。
        source=("const has=n=>n in globalThis;"
                "const platform=has('$task')?'qx':has('$loon')?'loon':has('$rocket')?'rocket':"
                "has('Egern')?'egern':has('$environment')?'surge-family':'other';"
                "$done({body:platform});")
        for source_format in ['surge', 'qx', 'loon', 'shadowrocket', 'stash']:
            with self.subTest(source_format=source_format):
                output=convert_script(source,'Fixture',URL,'',source_format=source_format)
                self.assertIn('return{body:"egern"}',output.replace(' ',''))

    def test_optional_environment_version_probe_follows_the_declared_source_platform(self):
        # 成员判定之外，新版模板还会用 globalThis.$environment 的版本标志。
        # 它必须和裸 $environment 一样按源格式折叠，不能落入 Node 分支。
        source=("const has=n=>n in globalThis;"
                "const platform=has('$task')?'qx':has('$loon')?'loon':has('$rocket')?'rocket':"
                "Boolean(globalThis.$environment?.['surge-version'])?'surge':"
                "Boolean(globalThis.$environment?.['stash-version'])?'stash':"
                "Boolean(globalThis.process?.versions?.node)?'node':'other';"
                "$done({body:platform});")
        for source_format, expected in [('surge', 'surge'), ('stash', 'stash'), ('qx', 'other'),
                                        ('loon', 'other'), ('shadowrocket', 'other')]:
            with self.subTest(source_format=source_format):
                output=convert_script(source,'Fixture',URL,'',source_format=source_format)
                self.assertIn('return{body:"'+expected+'"}',output.replace(' ',''))

    def test_environment_version_probe_stays_rejected_when_the_host_may_be_mutated(self):
        for change in [
            "globalThis.$environment=1;",
            "globalThis['$environment']=1;",
        ]:
            source=("const has=n=>n in globalThis;const value=Boolean(globalThis.$environment?.['surge-version']);"
                    +change+"$done({body:has('$task')?'qx':String(value)});")
            with self.subTest(change=change),self.assertRaises(ConversionError):
                convert_script(source,'Fixture',URL,'',source_format='surge')

    def test_local_prototype_write_does_not_invalidate_host_marker(self):
        source=("function Local(){}Local.prototype.value=1;"
                "const has=n=>n in globalThis;const platform=has('Egern')?'egern':'other';"
                "$done({body:platform});")
        output=convert_script(source,'Fixture',URL,'')
        self.assertIn('return{body:"egern"}',output.replace(' ',''))

    def test_unknown_marker_stays_unknown(self):
        source="const has=n=>n in globalThis;const value=has('UnknownHost');$done({body:String(value)});"
        with self.assertRaises(ConversionError):
            convert_script(source,'Fixture',URL,'')

    def test_mutated_host_membership_stays_rejected(self):
        for change in [
            "globalThis=1;",
            "globalThis.Egern=1;",
            "Object.prototype.Egern=1;",
            "Object.defineProperty(globalThis,'Egern',{value:1});",
        ]:
            source="const has=n=>n in globalThis;"+change+"$done({body:has('Egern')?'yes':'no'});"
            with self.subTest(change=change),self.assertRaises(ConversionError):
                convert_script(source,'Fixture',URL,'')

    def test_private_static_global_write_is_preserved(self):
        source="globalThis._fixture_private=1;$done({body:'ok'});"
        output=convert_script(source,'Fixture',URL,'')
        self.assertIn('_fixture_private',output)
        self.assertIn('globalThis._fixture_private',output)

    def test_private_static_global_write_does_not_block_qualified_api_lowering(self):
        # 私有全局写入只用于保留脚本自身状态，不是宿主能力查询；它不应让
        # 同一脚本中的限定平台 API 整体失去归一化机会。
        source=("globalThis._fixture_private=1;"
                "globalThis.$httpClient.get({url:'https://example.test'},()=>{});"
                "$done({body:'ok'});")
        output=convert_script(source,'Fixture',URL,'',source_format='surge')
        self.assertIn('globalThis._fixture_private',output)
        self.assertNotIn('globalThis.$httpClient',output)
        self.assertIn('ctx.http.get',output)

    def test_global_write_outside_private_whole_value_stays_rejected(self):
        for change in [
            "const value=globalThis._fixture_private;",
            "globalThis['_fixture_private']=1;",
            "const key='_fixture_private';globalThis[key]=1;",
            "globalThis.fixturePrivate=1;",
            "globalThis.alert=1;",
            "globalThis.Object=1;",
            "globalThis.Egern=1;",
            "globalThis.process=1;",
            "globalThis.setTimeout=1;",
            "globalThis._fixture_private+=1;",
            "delete globalThis._fixture_private;",
            "globalThis.__proto__=1;",
            "globalThis.constructor=1;",
        ]:
            source=change+"$done({body:'ok'});"
            with self.subTest(change=change),self.assertRaises(ConversionError):
                convert_script(source,'Fixture',URL,'')
