"""Node/浏览器双目标打包产物的死分支只在目标宿主可证明缺失时折叠。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL = 'https://example.test/node-browser.js'


class NodeBrowserDeadBranchTests(unittest.TestCase):
    def convert(self, source, format='surge'):
        return convert_script(source, 'Fixture', URL, '', source_format=format)

    def check(self, source, expected, format='surge'):
        native = self.convert(source, format)
        fixture = {
            'name': 'node/browser dead branch',
            'request': {'url': URL},
            'expected': {'result': {'body': expected}},
        }
        result = compare(source, native, format, URL, fixture)
        self.assertEqual(result['status'], 'passed', result)

    def test_platform_switch_selects_egern_and_removes_node_case(self):
        source = (
            "const p=(()=>{const has=n=>n in globalThis;"
            "switch(true){case has('$task'):return 'qx';"
            "case has('Egern'):return 'egern';"
            "case Boolean(globalThis.process?.versions?.node):return 'node';"
            "default:return 'other'}})();$done({body:p});"
        )
        native = self.convert(source)
        self.assertIn('egern', native)
        self.assertNotIn('Node.js', native)

    def test_missing_typeof_probe_removes_require_only_branch(self):
        source = (
            "let loader='browser';"
            "if(typeof process!=='undefined'){loader=require('fs')}"
            "if(typeof require==='function'){loader=require('path')}"
            "$done({body:loader});"
        )
        self.check(source, 'browser')

    def test_absent_global_this_members_fold_in_probe_positions(self):
        source = (
            "const node=Boolean(globalThis.process?.versions?.node);"
            "const env=globalThis.process?.env?.NODE_ENV||'fallback';"
            "const win=typeof globalThis.window;"
            "$done({body:String(node)+'|'+env+'|'+win});"
        )
        self.check(source, 'false|fallback|undefined')

    def test_local_node_and_browser_bindings_are_not_host_probes(self):
        source = (
            "const process={env:{NODE_ENV:'local'}};"
            "const window={name:'local'};"
            "$done({body:process.env.NODE_ENV+window.name});"
        )
        self.check(source, 'locallocal')

    def test_probe_result_passed_to_unknown_code_still_rejects(self):
        for source in [
            "const has=typeof process!=='undefined';unknown(has);$done({body:'x'});",
            "const has=typeof window!=='undefined';unknown(has);$done({body:'x'});",
        ]:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                self.convert(source)

    def test_reachable_global_this_branch_still_rejects(self):
        source = (
            "if(typeof globalThis!=='undefined'){"
            "const root=globalThis;$done({body:root.name});}"
        )
        with self.assertRaises(ConversionError):
            self.convert(source)

    def test_require_result_in_business_logic_still_rejects(self):
        source = "const fs=require('fs');$done({body:String(Boolean(fs))});"
        with self.assertRaises(ConversionError):
            self.convert(source)

    def test_process_env_in_business_logic_still_rejects(self):
        source = "const value=process.env.NODE_ENV;$done({body:value});"
        with self.assertRaises(ConversionError):
            self.convert(source)

    def test_global_writes_invalidate_member_probes(self):
        for source in [
            "globalThis.process={};const node=Boolean(globalThis.process?.versions?.node);$done({body:String(node)});",
            "window.alert=()=>{};$done({body:'x'});",
            "globalThis.require=()=>{};$done({body:'x'});",
        ]:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                self.convert(source)

    def test_dynamic_member_access_and_direct_values_still_reject(self):
        for source in [
            "const key='process';$done({body:String(globalThis[key])});",
            "const key='window';$done({body:String(globalThis[key])});",
            "$done({body:globalThis.process});",
            "$done({body:String(globalThis.require)});",
        ]:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                self.convert(source)


if __name__ == '__main__':
    unittest.main()
