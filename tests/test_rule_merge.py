import unittest

from tools.egern_hub.convert import ConversionError, convert_rules, merge_rule_objects
from tools.egern_hub.layout import rule_identity


class RuleIdentityTests(unittest.TestCase):
    def test_basename_case_extension_and_punctuation_are_normalized(self):
        self.assertEqual(rule_identity('Telegram.list'), 'telegram')
        self.assertEqual(rule_identity('Apple.list'), rule_identity('apple'))
        self.assertEqual(rule_identity('Category_AI.List'), 'category-ai')

    def test_exclusion_names_never_collide_with_china_names(self):
        pairs = [
            ('geolocation-cn', 'geolocation-!cn', 'geolocation-not-cn'),
            ('tld-cn', 'tld-!cn', 'tld-not-cn'),
            ('category-ai-cn', 'category-ai-!cn', 'category-ai-not-cn'),
            ('category-cdn-cn', 'category-cdn-!cn', 'category-cdn-not-cn'),
            ('category-games-cn', 'category-games-!cn', 'category-games-not-cn'),
            ('category-scholar-cn', 'category-scholar-!cn', 'category-scholar-not-cn'),
            ('category-social-media-cn', 'category-social-media-!cn', 'category-social-media-not-cn'),
            ('category-netdisk-cn', 'category-netdisk-!cn', 'category-netdisk-not-cn'),
        ]
        for plain, excluded, expected in pairs:
            with self.subTest(plain=plain, excluded=excluded):
                self.assertNotEqual(rule_identity(plain), rule_identity(excluded))
                self.assertEqual(rule_identity(excluded), expected)

    def test_acl4ssr_names_without_collisions_stay_distinct(self):
        names = ['Telegram.list', 'Apple.list', 'Amazon.list', 'Google.list']
        self.assertEqual(len({rule_identity(name) for name in names}), len(names))


class RuleMergeTests(unittest.TestCase):
    def test_union_uses_existing_kind_value_deduplication(self):
        merged = merge_rule_objects([
            {'domain_suffix_set': ['Example.com', 'a.example'], 'url_regex_set': ['^https://Case/']},
            {'domain_suffix_set': ['example.com', 'b.example'], 'url_regex_set': ['^https://case/']},
        ])
        self.assertEqual(merged, {
            'domain_suffix_set': ['Example.com', 'a.example', 'b.example'],
            'url_regex_set': ['^https://Case/', '^https://case/'],
        })

    def test_merge_is_deterministic_and_preserves_first_seen_order(self):
        sources = [
            {'domain_keyword_set': ['telegram', 't.me']},
            {'domain_suffix_set': ['t.me'], 'domain_keyword_set': ['telegram', 'tdesktop']},
        ]
        first = merge_rule_objects(sources)
        second = merge_rule_objects(sources)
        self.assertEqual(first, second)
        self.assertEqual(list(first), ['domain_keyword_set', 'domain_suffix_set'])
        self.assertEqual(first['domain_keyword_set'], ['telegram', 't.me', 'tdesktop'])

    def test_mixed_no_resolve_semantics_fail_loudly(self):
        with self.assertRaisesRegex(ConversionError, 'no-resolve'):
            merge_rule_objects([
                {'ip_cidr_set': ['10.0.0.0/8'], 'no_resolve': True},
                {'ip_cidr_set': ['192.168.0.0/16']},
            ])

    def test_domain_only_source_does_not_conflict_with_no_resolve(self):
        self.assertEqual(merge_rule_objects([
            {'domain_suffix_set': ['example.com'], 'no_resolve': True},
            {'ip_cidr_set': ['10.0.0.0/8']},
        ]), {'domain_suffix_set': ['example.com'], 'ip_cidr_set': ['10.0.0.0/8']})


class UnsupportedRuleTests(unittest.TestCase):
    def test_process_name_is_rejected_by_default(self):
        with self.assertRaisesRegex(ConversionError, 'PROCESS-NAME'):
            convert_rules('PROCESS-NAME,Example.app')

    def test_process_name_can_be_skipped_with_an_audit_record(self):
        diagnostics = []
        converted = convert_rules(
            'DOMAIN-SUFFIX,before.example\nPROCESS-NAME,Example.app\nDOMAIN-SUFFIX,after.example',
            ignored_rule_types={'PROCESS-NAME'}, diagnostics=diagnostics,
        )
        self.assertEqual(converted['domain_suffix_set'], ['before.example', 'after.example'])
        self.assertEqual(diagnostics, [{
            'type': 'PROCESS-NAME', 'line': 2, 'value': 'Example.app',
            'reason': 'Egern 规则集不支持该匹配类型',
        }])

    def test_all_process_name_rules_fail_with_the_skipped_type_reason(self):
        diagnostics = []
        with self.assertRaisesRegex(ConversionError, 'PROCESS-NAME x 1'):
            convert_rules('PROCESS-NAME,Example.app', ignored_rule_types={'PROCESS-NAME'},
                          diagnostics=diagnostics)

    def test_url_regex_and_user_agent_remain_supported_and_case_sensitive(self):
        converted = convert_rules('URL-REGEX,^https://Case/\nUSER-AGENT,MyApp')
        self.assertEqual(converted['url_regex_set'], ['^https://Case/'])
        self.assertEqual(converted['user_agent_set'], ['MyApp'])


if __name__ == '__main__':
    unittest.main()
