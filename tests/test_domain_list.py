import re
import unittest

from tools.egern_hub.convert import ConversionError, convert_rules, detect_rule_format


def loader(mapping):
    def load(name, current):
        key = name.casefold()
        if key not in mapping:
            raise LookupError(name)
        return key, mapping[key]
    return load


class DomainListTests(unittest.TestCase):
    def test_entry_kinds_map_to_egern_rule_set_keys(self):
        source = ('\ufeffgithub.com\n'
                  'domain:example.org\n'
                  'full:api.example.org\n'
                  'keyword:google\n'
                  'regexp:(^|\\.)ads\\.example$\n')
        self.assertEqual(convert_rules(source, 'v2fly-domain-list'), {
            'domain_suffix_set': ['github.com', 'example.org'],
            'domain_set': ['api.example.org'],
            'domain_keyword_set': ['google'],
            'domain_regex_set': [r'(^|.*\.)ads\.example$'],
        })

    def test_attributes_and_affiliations_are_dropped_after_parsing(self):
        converted = convert_rules('ads.example @cn @ads &ADS\n', 'v2fly-domain-list')
        self.assertEqual(converted, {'domain_suffix_set': ['ads.example']})

    def test_include_recurses_and_applies_must_and_ban_filters(self):
        files = {
            'child': ('include:grand @cn\n'
                      'keep.example @cn\n'
                      'must-no-attr.example\n'
                      'ban.example @cn @ads\n'
                      'wrong-must.example @ads\n'),
            'grand': 'grand.example @cn\nother.example @ads\n',
        }
        source = 'include:child @cn @-ads\nroot.example\n'
        converted = convert_rules(source, 'v2fly-domain-list', source_path='root', include_loader=loader(files))
        self.assertEqual(converted['domain_suffix_set'],
                         ['root.example', 'keep.example', 'grand.example'])

    def test_untagged_entries_only_depend_on_must_filters(self):
        files = {'child': 'plain.example\ntagged.example @cn\nads.example @ads\n'}
        source = 'include:child @-ads\n'
        converted = convert_rules(source, 'v2fly-domain-list', source_path='root', include_loader=loader(files))
        self.assertEqual(converted['domain_suffix_set'], ['plain.example', 'tagged.example'])

    def test_include_target_lookup_is_case_insensitive_through_loader_contract(self):
        files = {'child': 'child.example\n'}
        converted = convert_rules('include:CHILD\n', 'v2fly-domain-list', source_path='root', include_loader=loader(files))
        self.assertEqual(converted['domain_suffix_set'], ['child.example'])

    def test_include_cycle_reports_path_and_line(self):
        files = {'a': 'include:b\n', 'b': 'include:a\n'}
        with self.assertRaisesRegex(ConversionError, r'b:1：include 循环：root -> a -> b -> a'):
            convert_rules('include:a\n', 'v2fly-domain-list', source_path='root', include_loader=loader(files))

    def test_missing_include_target_is_an_error(self):
        with self.assertRaisesRegex(ConversionError, r'root:1：include 目标不存在：MISSING'):
            convert_rules('include:missing\n', 'v2fly-domain-list', source_path='root', include_loader=loader({}))

    def test_malformed_lines_are_rejected(self):
        cases = {
            'unknown:value\n': '未知规则类型',
            'full:\n': '规则值为空',
            'bad..example\n': '无效域名',
            'bad.example @-cn\n': '无效的属性',
            'bad.example unknown\n': '未知字段',
            'include:child &AFF\n': 'include 不允许归属标注',
            'include:child @-\n': '无效的 ban 属性',
            'regexp:unanchored\n': '无法证明 regexp',
        }
        for source, message in cases.items():
            with self.subTest(source=source):
                with self.assertRaisesRegex(ConversionError, message):
                    convert_rules(source, 'v2fly-domain-list', source_path='root')

    def test_regexp_normalization_is_equivalent_under_search_and_full_match(self):
        cases = [
            (r'(^|\.)foo\.com$', r'(^|.*\.)foo\.com$', ['foo.com', 'x.foo.com', 'foo.com.evil', 'xfoo.com']),
            (r'^ads?\..+$', r'^ads?\..+$', ['ads.example', 'ad.example', 'x.ads.example']),
            (r'.+\.awsdns-[0-9]+\.com$', r'.+\.awsdns-[0-9]+\.com$', ['a.awsdns-1.com', 'x.a.awsdns-1.com', 'awsdns-1.com']),
            (r'(\w+)-static-[0-9]+\.example$', r'.*(\w+)-static-[0-9]+\.example$',
             ['foo-static-1.example', 'x-foo-static-1.example', 'static-1.example']),
        ]
        for original, normalized, domains in cases:
            with self.subTest(original=original):
                before, after = re.compile(original), re.compile(normalized)
                for domain in domains:
                    expected = bool(before.search(domain))
                    self.assertEqual(bool(after.fullmatch(domain)), expected, domain)
                    self.assertEqual(bool(after.search(domain)), expected, domain)
        self.assertEqual(convert_rules('regexp:(^|\\.)foo\\.com$\n', 'v2fly-domain-list'),
                         {'domain_regex_set': [r'(^|.*\.)foo\.com$']})

    def test_format_detection_uses_content_only(self):
        self.assertEqual(detect_rule_format('github.com\nfull:api.github.com\n'), 'v2fly-domain-list')
        self.assertEqual(detect_rule_format('payload:\n  - DOMAIN,example.com\n'), 'clash-classical')
        self.assertEqual(detect_rule_format('DOMAIN,example.com\n'), 'surge')


if __name__ == '__main__':
    unittest.main()
