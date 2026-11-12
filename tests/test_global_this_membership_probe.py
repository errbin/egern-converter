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
