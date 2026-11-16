"""Loon V2 的 with 子句必须接受 enable，且字面量开关保持布尔语义。"""
import unittest

from tools.egern_hub.loon_v2 import parse as parse_v2

PREFIX = 'request if ${url} ~= /^https:\\/\\/a\\.com\\/x$/i then script("https://e.com/a.js") with enable='
SUFFIX = ', tag="t"'


def line(value):
    return PREFIX + value + SUFFIX


class LoonV2EnableClauseTests(unittest.TestCase):
    def test_bare_and_braced_enable_are_both_parameter_references(self):
        for value in ('spendSwitch', '{spendSwitch}'):
            with self.subTest(value=value):
                parsed = parse_v2(line(value))
                self.assertEqual(parsed[0], 'request')
                self.assertEqual(parsed[3]['enable'].name, 'spendSwitch')

    def test_literal_enable_keeps_boolean_meaning(self):
        parsed = parse_v2(line('true'))
        self.assertIs(parsed[3]['enable'], True)

    def test_other_with_fields_are_unaffected(self):
        parsed = parse_v2(
            'request if ${url} ~= /^https:\\/\\/a\\.com\\/x$/i then script("https://e.com/a.js") '
            'with enable=spendSwitch, tag="bilibili.airborne", timeout=10, requires_body=true'
        )
        self.assertEqual(parsed[3]['enable'].name, 'spendSwitch')
        self.assertEqual(parsed[3]['tag'].value, 'bilibili.airborne')
        self.assertEqual(parsed[3]['timeout'], 10)
        self.assertIs(parsed[3]['requires_body'], True)


if __name__ == '__main__':
    unittest.main()
