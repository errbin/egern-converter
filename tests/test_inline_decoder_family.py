"""内联缓存式解码器必须整族通过结构证明，任一成员改动或混用外壳都要拒绝。"""
import json
import os
from pathlib import Path
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]
FOLD = ROOT / 'tests/helpers/cached-shell-fold.mjs'
STEPS = ROOT / 'tests/helpers/decode-steps.mjs'
CORPUS = ROOT / 'tests/helpers/inline-decoder-corpus.mjs'
FIXTURE = (ROOT / 'tests/helpers/inline-decoder-family.js').read_text()
START = '/* inline-decoder-start */'
END = '/* inline-decoder-end */'


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


def decode_steps(source):
    result = subprocess.run(
        ['node', str(STEPS)],
        input=source,
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=True,
    )
    return json.loads(result.stdout)


class InlineDecoderFamilyTests(unittest.TestCase):

    def test_inline_cache_decoder_folds_without_a_separate_shell(self):
        data = fold(FIXTURE)
        self.assertNotIn('error', data)
        self.assertEqual(data['transformations'], 1)
        self.assertIn('$done({body: "100"});', data['source'])
        self.assertNotIn('II1iI11i(', data['source'])

    def test_helper_algorithm_and_cache_roles_are_not_interchangeable(self):
        cases = {
            'base64_helper_changed': ('String[\'fromCharCode\']', 'Array[\'fromCharCode\']'),
            'arguments_cache_replaced': ('_0x4554b7 = arguments', '_0x4554b7 = {}'),
            'decode_guard_changed': ("II1iI11i['wteyCf'] === undefined", 'false'),
            'cache_writeback_changed': ('_0x4554b7[_0x5a2944] = _0x5e191a', 'globalThis.result = _0x5e191a'),
        }
        for name, (before, after) in cases.items():
            with self.subTest(name=name):
                changed = FIXTURE.replace(before, after, 1)
                self.assertNotEqual(changed, FIXTURE)
                data = fold(changed)
                self.assertIn('error', data)
                self.assertIn('内联缓存式解码器', data['error'])

    def test_one_mismatched_family_member_rejects_the_whole_family(self):
        block = FIXTURE.split(START, 1)[1].split(END, 1)[0]
        second = block.replace('II1iI11i', 'II1iI11iCopy')
        second = second.replace("String['fromCharCode']", "Array['fromCharCode']", 1)
        changed = FIXTURE.replace(END, second + END, 1)
        data = fold(changed)
        self.assertIn('error', data)
        self.assertIn('内联缓存式解码器', data['error'])

    def test_dead_version_sentinel_after_folding_is_not_redecoded(self):
        data = decode_steps(FIXTURE)
        self.assertNotIn('error', data)
        self.assertEqual(data['folded'], 1)
        self.assertEqual(data['decoded'], 0)
        self.assertIn('$done({body: "100"});', data['source'])

    def test_live_version_sentinel_still_rejects_unreviewed_source(self):
        data = decode_steps("var marker = 'jsjiami.com.v7';marker = 'changed';")
        self.assertIn('error', data)
        self.assertIn('未匹配已审查的解码器语法', data['error'])

    @unittest.skipUnless(os.environ.get('EGERN_INLINE_DECODER_CORPUS'), 'Set EGERN_INLINE_DECODER_CORPUS to the local impact index')
    def test_real_corpus_folds_inline_families_and_leaves_only_unproven_rotations(self):
        result = subprocess.run(
            ['node', str(CORPUS), os.environ['EGERN_INLINE_DECODER_CORPUS']],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=True,
        )
        data = json.loads(result.stdout)
        self.assertEqual(data['files'], 109)
        self.assertEqual(data['folded'], 68)
        self.assertNotIn('js-obfuscator 轮转校验在一轮内没有匹配', data['errors'])
        self.assertEqual(data['errors'].get('Unexpected token (103:0)'), 1)
        self.assertFalse([reason for reason in data['errors'] if '自防御壳' in reason or '内联缓存式解码器' in reason])


if __name__ == '__main__':
    unittest.main()
