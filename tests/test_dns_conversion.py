"""DNS configuration parsing must not implicitly authorize a compatibility script."""
from pathlib import Path
import unittest

from tools.egern_hub.convert import convert_module,ConversionError
from tools.egern_hub.script_convert import convert_script

MODULE='''#!name=DNS resolver
#!arguments=Resolver:223.5.5.5,Domain:*,Account
[Host]
{{{Domain}}}=script:Resolver
[Script]
Resolver = type=dns,engine=jsc,script-path=https://raw.githubusercontent.com/Author/Repo/main/dns.js,argument="{"HOST":"{{{Resolver}}}","UID":"{{{Account}}}"}"
'''

class DNSConversionTests(unittest.TestCase):
    def test_hosts_dns_declaration_and_native_arguments(self):
        obj=convert_module(MODULE,scripts_native=True)
        self.assertEqual(obj['dns'],{'hosts':{'{{{Domain}}}':['script:Resolver']}})
        self.assertEqual(obj['compat_arguments'],{'Resolver':'223.5.5.5','Domain':'*','Account':''})
        self.assertEqual(obj['scriptings'],[{'generic':{'name':'Resolver','script_url':'https://raw.githubusercontent.com/Author/Repo/main/dns.js','env':{'argument':'{"HOST":"{{{Resolver}}}","UID":"{{{Account}}}"}'}}}])
        self.assertNotIn('_compat',str(obj))

    def test_dns_configuration_still_requires_native_scripts(self):
        with self.assertRaisesRegex(ConversionError,'脚本需先适配'):convert_module(MODULE)

    def test_invalid_references_options_and_engines_are_rejected(self):
        for text in [MODULE.replace('script:Resolver','script:Missing'),MODULE.replace('engine=jsc','engine=webview'),MODULE.replace('engine=jsc','unsupported=1'),MODULE.replace('[Script]','{{{Domain}}}=script:Resolver\n[Script]'),MODULE+'Resolver = type=dns,script-path=dns.js\n']:
            with self.subTest(text=text),self.assertRaises(ConversionError):convert_module(text,scripts_native=True)

    def test_unproven_native_dns_contract_is_an_explicit_failure(self):
        with self.assertRaisesRegex(ConversionError,'查询域名输入与 addresses/ttl 返回契约'):
            convert_script('$done({addresses:[$domain],ttl:600});','Author','https://example.test/dns.js','')
        # A local variable with the same spelling is not a platform DNS API.
        self.assertIn('export default',convert_script('const $domain="local";$done({body:$domain});','Author','https://example.test/dns.js',''))

    def test_real_alidns_config_parses_but_legacy_dependency_is_not_converted(self):
        root=Path(__file__).resolve().parents[1]/'sources/Maasea/sgmodule/master'
        if not root.is_dir():self.skipTest('Fetch the Maasea snapshot for integration checks')
        module=convert_module((root/'Alidns.sgmodule').read_text(),scripts_native=True)
        self.assertEqual(module['scriptings'][0]['generic']['name'],'Alidns')
        self.assertEqual(module['dns']['hosts'],{'{{{请求域名}}}':['script:Alidns']})
        with self.assertRaisesRegex(ConversionError,'暂不发布'):
            convert_script((root/'Script/Tools/alidns.js').read_text(),'Maasea','https://example.test/alidns.js','')
