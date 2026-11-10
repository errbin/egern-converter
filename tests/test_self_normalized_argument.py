"""顶层一次性参数归一化只在无条件、单次写回且无词法遮蔽时成立。"""
import unittest
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare
from tools.egern_hub.convert import ConversionError
URL = 'https://example.test/self-normalized-argument.js'


class SelfNormalizedArgumentTests(unittest.TestCase):
    def test_unconditional_json_normalization_preserves_argument_value(self):
        source = ('globalThis.$argument=JSON.parse(globalThis.$argument||"{}");'
                  '$done({body:globalThis.$argument.value});')
        native = convert_script(source, 'Fixture', URL, '', source_format='loon')
        fixture = {'name': 'self-normalized argument', 'request': {'url': URL},
                   'argument': '{"value":"ok"}', 'expected': {'result': {'body': 'ok'}}}
        result = compare(source, native, 'loon', URL, fixture)
        self.assertEqual(result['status'], 'passed', result)
        self.assertNotIn('globalThis', native)

    def test_normalization_rejects_control_flow_or_repeated_writes(self):
        prefix = 'globalThis.$argument=JSON.parse(globalThis.$argument||"{}");'
        for label, source in [
            ('conditional', 'if(true){' + prefix + '}'),
            ('repeated', prefix + prefix),
            ('constant rhs', 'globalThis.$argument=JSON.parse("{}");'),
        ]:
            with self.subTest(label=label), self.assertRaises(ConversionError):
                convert_script(source + '$done({body:globalThis.$argument.value});',
                               'Fixture', URL, '', source_format='loon')

    def test_normalization_rejects_mixed_bare_access_and_other_globals(self):
        prefix = 'globalThis.$argument=JSON.parse(globalThis.$argument||"{}");'
        for label, suffix in [
            ('bare read', '$done({body:$argument.value});'),
            ('bare write', '$argument={value:"x"};$done({body:globalThis.$argument.value});'),
            ('local binding', 'const $argument="local";'),
            ('other global', '$done({body:String(globalThis.process)});'),
            ('member write', 'globalThis.$argument.value="x";$done({body:globalThis.$argument.value});'),
        ]:
            source = ('const $argument="local";' + prefix + suffix
                      if label == 'local binding' else prefix + suffix)
            with self.subTest(label=label), self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '', source_format='loon')


if __name__ == '__main__':
    unittest.main()
