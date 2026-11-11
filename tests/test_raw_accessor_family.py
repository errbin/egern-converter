"""字符串表原始访问器与同表工厂混合角色必须按身份证明，不能整体套用解码步骤。"""
import json
import os
from pathlib import Path
import subprocess
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare


ROOT = Path(__file__).resolve().parents[1]
FOLD = ROOT / 'tests/helpers/cached-shell-fold.mjs'
URL = 'https://example.test/raw-accessor.js'

BASE = """function table(){var a=['111a','222b','333c','444d'];table=function(){return a;};return table();}
function raw(i,k){var t=table();return raw=function(j,l){j=j-0x10;var v=t[j];return v;},raw(i,k);}
(function(table,target){var d=raw,t=table();while(true){try{var sum=parseInt(d(0x10))/1+parseInt(d(0x11))/2+parseInt(d(0x12))/3;if(sum===target)break;else t.push(t.shift());}catch(e){t.push(t.shift());}}})(table,592);
$done({body:raw(0x10)});"""


def fold(source):
    result = subprocess.run(
        ['node', str(FOLD)],
        input=source,
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=True,
    )
    return json.loads(result.stdout)


class RawAccessorFamilyTests(unittest.TestCase):

    def test_raw_accessor_rotation_folds_and_compares(self):
        data = fold(BASE)
        self.assertNotIn('error', data)
        self.assertEqual(data['transformations'], 1)
        self.assertIn('"333c"', data['source'])
        output = convert_script(BASE, 'Fixture', URL, '', source_format='loon')
        result = compare(BASE, output, 'loon', URL, {'name': 'raw accessor', 'request': {'url': URL}})
        self.assertEqual(result['status'], 'passed', result)
        self.assertTrue(result['observable_change'])

    def test_same_factory_side_effect_member_rejects_whole_family(self):
        source = BASE.replace(
            '$done({body:raw(0x10)});',
            """function extra(i,k){var t=table();return extra=function(j,l){j=j-0x10;var v=t[j];globalThis.x=v;return v;},extra(i,k);}
$done({body:raw(0x10)});""",
        )
        with self.assertRaises(ConversionError) as caught:
            convert_script(source, 'Fixture', URL, '', source_format='loon')
        self.assertIn('内联缓存式解码器', str(caught.exception))

    def test_same_factory_offset_mismatch_rejects(self):
        source = BASE.replace(
            '$done({body:raw(0x10)});',
            """function raw2(i,k){var t=table();return raw2=function(j,l){j=j-0x11;var v=t[j];return v;},raw2(i,k);}
$done({body:raw(0x10)});""",
        )
        with self.assertRaises(ConversionError) as caught:
            convert_script(source, 'Fixture', URL, '', source_format='loon')
        self.assertIn('同表工厂解码器偏移不一致', str(caught.exception))

    def test_external_rebind_rejects(self):
        source = BASE.replace(
            '$done({body:raw(0x10)});',
            'raw=function(){return "x"};$done({body:raw(0x10)});',
        )
        with self.assertRaises(ConversionError) as caught:
            convert_script(source, 'Fixture', URL, '', source_format='loon')
        self.assertIn('原始访问器结构不匹配', str(caught.exception))

    def test_second_parameter_read_rejects(self):
        source = BASE.replace('var v=t[j];return v;', 'var v=t[j+l];return v;')
        with self.assertRaises(ConversionError):
            convert_script(source, 'Fixture', URL, '', source_format='loon')

    def test_escaped_value_is_not_folded(self):
        source = BASE.replace('var v=t[j];return v;', 'globalThis.x=t[j];return t[j];')
        data = fold(source)
        self.assertNotIn('error', data)
        self.assertEqual(data['transformations'], 0)


CORPUS = os.environ.get('EGERN_INLINE_DECODER_CORPUS')
CHATGPT = 'https://raw.githubusercontent.com/yqc007/QuantumultX/master/ChatGPTPlusCrack.js'
NOADS = 'https://raw.githubusercontent.com/Yuheng0101/X/main/Scripts/ChinaMobile/NoAds.js'


@unittest.skipUnless(CORPUS and Path(CORPUS).is_file(), 'Set EGERN_INLINE_DECODER_CORPUS to the local impact index')
class RealStringTableCorpusTests(unittest.TestCase):

    def source(self, url):
        index = json.loads(Path(CORPUS).read_text())
        meta = index[url]
        return (Path(CORPUS).parent / 'sources' / meta['file']).read_text()

    def test_chatgpt_plus_crack_converts_and_compares_in_all_formats(self):
        source = self.source(CHATGPT)
        body = json.dumps({
            'accounts': {'default': {
                'account': {'has_previously_paid_subscription': False, 'processor': {
                    'a001': {'has_customer_object': False},
                    'b001': {'has_transaction_history': False},
                }},
                'features': [], 'entitlement': {}, 'last_active_subscription': {},
            }},
        }, separators=(',', ':'))
        fixture = {
            'name': 'chatgpt plus accounts/check',
            'request': {'url': 'https://ios.chat.openai.com/backend-api/accounts/check/'},
            'response': {'body': body},
        }
        for platform in ['qx', 'surge', 'loon']:
            with self.subTest(platform=platform):
                output = convert_script(source, 'yqc007', CHATGPT, '', source_format=platform)
                result = compare(source, output, platform, CHATGPT, fixture)
                self.assertEqual(result['status'], 'passed', result)
                self.assertTrue(result['observable_change'])

    def test_noads_advances_to_runtime_globals_not_success(self):
        source = self.source(NOADS)
        with self.assertRaises(ConversionError) as caught:
            convert_script(source, 'Yuheng0101', NOADS, '', source_format='qx')
        self.assertIn('window', str(caught.exception))


if __name__ == '__main__':
    unittest.main()
