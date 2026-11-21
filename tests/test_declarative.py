import copy
import json
import shutil
import subprocess
import unittest

from tools.egern_hub.declarative import (
    apply_module_downgrades, downgrade_module, plan_module_downgrades, provenance_lines,
)
from tools.egern_hub.js_analysis import classify_declarative
from tools.egern_hub.verify import (
    is_anchored, location_is_valid, validate_declarative_module,
    validate_product_quality,
)


class DeclarativeClassifierTests(unittest.TestCase):
    def classify(self, source):
        return classify_declarative({'sample': source})['sample']

    def test_fixed_body_is_map_local(self):
        self.assertEqual(self.classify("$done({body: 'fixed'})"),
                         {'kind': 'map_local', 'body': 'fixed', 'json': False})
        self.assertEqual(self.classify('$done({body: JSON.stringify({ok: true, n: 1})})'),
                         {'kind': 'map_local', 'body': '{"ok":true,"n":1}', 'json': True})

    def test_whole_json_replacement_is_map_local(self):
        result = self.classify(
            "var obj = JSON.parse($response.body); obj = {ok: true}; "
            "$done({body: JSON.stringify(obj)});")
        self.assertEqual(result, {'kind': 'map_local', 'body': '{"ok":true}',
                                  'json': True, 'fixed_from_input': True})

    def test_delete_filter_strips_javascript_variable_name(self):
        result = self.classify(
            "var obj = JSON.parse($response.body); delete obj.data.ad; "
            "$done({body: JSON.stringify(obj)});")
        self.assertEqual(result['kind'], 'response_jq')
        self.assertIn('delpaths([["data","ad"]])', result['filter'])
        self.assertNotIn('["obj"', result['filter'])

    @unittest.skipUnless(shutil.which('jq'), '等价性检查需要 jq 命令')
    def test_guarded_delete_matches_javascript_edge_cases(self):
        result = self.classify(
            "var obj = JSON.parse($response.body); delete obj.data.ad; "
            "$done({body: JSON.stringify(obj)});")
        cases = [
            ({}, {}),
            ({'data': {}}, {'data': {}}),
            ({'data': {'ad': 1, 'keep': 2}}, {'data': {'keep': 2}}),
            ({'data': None}, {'data': None}),
            ({'data': []}, {'data': []}),
            ([1, 2], [1, 2]),
        ]
        for body, expected in cases:
            with self.subTest(body=body):
                value = run_jq(result['filter'], body)
                self.assertEqual(value, expected)

    @unittest.skipUnless(shutil.which('jq'), '等价性检查需要 jq 命令')
    def test_guarded_set_matches_javascript_edge_cases(self):
        result = self.classify(
            "var obj = JSON.parse($response.body); obj.data.enabled = true; "
            "$done({body: JSON.stringify(obj)});")
        cases = [
            ({}, {}),
            ({'data': {}}, {'data': {'enabled': True}}),
            ({'data': None}, {'data': None}),
            ({'data': []}, {'data': []}),
            ({'data': 'x'}, {'data': 'x'}),
            ([1, 2], [1, 2]),
        ]
        for body, expected in cases:
            with self.subTest(body=body):
                self.assertEqual(run_jq(result['filter'], body), expected)

    def test_reject_and_redirect(self):
        self.assertEqual(self.classify('$done({status: 404})'), {'kind': 'reject', 'status': 404})
        self.assertEqual(self.classify('$done({status: 200})'), {'kind': 'reject', 'status': 200})
        self.assertEqual(self.classify('$done({status: "HTTP/1.1 404 Not Found"})'),
                         {'kind': 'reject', 'status': 404})
        redirect = self.classify(
            '$done({status: 302, headers: {Location: "https://new.example/x"}})')
        self.assertEqual(redirect, {'kind': 'redirect', 'status': 302,
                                    'location': 'https://new.example/x'})

    def test_header_only_script(self):
        result = self.classify(
            "const headers = $response.headers; headers['X-A'] = '1'; "
            "delete headers['X-B']; $done({headers});")
        self.assertEqual(result['kind'], 'header')
        self.assertEqual(result['headers_type'], 'response')
        self.assertEqual(result['operations'], [
            {'op': 'set', 'name': 'X-A', 'value': '1'},
            {'op': 'delete', 'name': 'X-B'},
        ])

    def test_unsafe_patterns_stay_scriptings(self):
        for source in [
            "var obj = JSON.parse($response.body); $done({body: $response.body.replace(/a/g, 'b')});",
            "if ($response.body) $done({body: 'x'});",
            "function f(){return 'x'} $done({body: f()});",
            "var obj = JSON.parse($response.body); delete obj.a.b; delete obj.a; "
            "$done({body: JSON.stringify(obj)});",
            "$done({body: 'fixed', headers: {'X-A': '1'}});",
            '"use strict"; var obj = JSON.parse($response.body); obj.a = 1; '
            "$done({body: JSON.stringify(obj)});",
            "var obj = JSON.parse($response.body); other.a = 1; "
            "$done({body: JSON.stringify(obj)});",
            "var [x] = $response.body; $done({body: 'fixed'});",
            "$done({body: 'fixed'}); var x = 1;",
            "var obj = JSON.parse($response.body); obj.__proto__ = {}; "
            "$done({body: JSON.stringify(obj)});",
            "$done({body: JSON.stringify({__proto__: {x: 1}})});",
            "const headers = $response.headers; $done({headers}); "
            "headers['X-A'] = '1';",
        ]:
            with self.subTest(source=source):
                self.assertEqual(self.classify(source), {'kind': 'unsafe'})


class DowngradePlanTests(unittest.TestCase):
    def module(self, **extra):
        value = {
            'name': '示例',
            'scriptings': [{'http_response': {
                'name': 'fixed', 'match': '^https://api.example/config',
                'script_url': 'https://scripts.example/fixed.js', 'body_required': True,
                'max_size': 65536,
            }}],
            'mitm': {'hostnames': {'includes': ['api.example'], 'excludes': []}},
        }
        value.update(extra)
        return value

    def analysis(self, kind='map_local', **extra):
        result = {'map_local': {'kind': 'map_local', 'body': '{"ok":true}', 'json': True},
                  'response_jq': {'kind': 'response_jq',
                                  'filter': '. as $orig | try (delpaths([["ad"]])) catch $orig'},
                  'reject': {'kind': 'reject', 'status': 404},
                  'redirect': {'kind': 'redirect', 'status': 302,
                               'location': 'https://new.example/x'},
                  'header': {'kind': 'header', 'headers_type': 'response',
                             'operations': [{'op': 'set', 'name': 'X-A', 'value': '1'}]}}[kind]
        result.update(extra)
        return {'script-1': result}

    def test_map_local_downgrade_removes_scripting_and_preserves_mitm(self):
        obj = self.module()
        original_mitm = copy.deepcopy(obj['mitm'])
        script_map = {'https://scripts.example/fixed.js': 'script-1'}
        rows = downgrade_module(obj, script_map, self.analysis())
        self.assertEqual(rows, [{'kind': 'map_local', 'phase': 'http_response',
                                 'match': '^https://api.example/config',
                                 'script_url': 'https://scripts.example/fixed.js',
                                 'script_id': 'script-1'}])
        self.assertNotIn('scriptings', obj)
        self.assertEqual(obj['map_locals'], [{'match': '^https://api.example/config',
                                              'body': '{"ok":true}'}])
        self.assertEqual(obj['mitm'], original_mitm)
        self.assertEqual(script_map, {})

    def test_script_map_is_kept_when_url_still_used(self):
        obj = self.module()
        obj['scriptings'].append({'http_response': {
            'name': 'other', 'match': '^https://api.example/other', 'disabled': True,
            'script_url': 'https://scripts.example/fixed.js', 'body_required': True}})
        script_map = {'https://scripts.example/fixed.js': 'script-1'}
        plan, _ = plan_module_downgrades(obj, script_map, self.analysis())
        self.assertEqual(len(plan), 1)
        apply_module_downgrades(obj, script_map, plan)
        self.assertEqual(script_map, {'https://scripts.example/fixed.js': 'script-1'})
        self.assertEqual(len(obj['scriptings']), 1)

    def test_existing_declarative_match_is_not_duplicated(self):
        obj = self.module()
        obj['body_rewrites'] = [{'response_jq': {
            'match': '^https://api.example/config', 'filter': '.x = 1'}}]
        self.assertEqual(plan_module_downgrades(
            obj, {'https://scripts.example/fixed.js': 'script-1'},
            self.analysis('response_jq'))[0], [])

    def test_unanchored_match_and_missing_body_are_not_downgraded(self):
        obj = self.module()
        obj['scriptings'][0]['http_response']['match'] = 'https://api.example/config'
        self.assertEqual(plan_module_downgrades(obj, {'https://scripts.example/fixed.js': 'script-1'},
                                                self.analysis())[0], [])
        obj = self.module()
        obj['scriptings'][0]['http_response']['body_required'] = False
        self.assertEqual(plan_module_downgrades(obj, {'https://scripts.example/fixed.js': 'script-1'},
                                                self.analysis())[0], [])

    def test_disabled_binary_and_merge_sources_are_not_downgraded(self):
        for key, value in [('disabled', True), ('binary_body', True)]:
            obj = self.module()
            obj['scriptings'][0]['http_response'][key] = value
            self.assertEqual(plan_module_downgrades(
                obj, {'https://scripts.example/fixed.js': 'script-1'}, self.analysis())[0], [])
        obj = self.module(_merge_members=[{'id': 'a'}])
        self.assertEqual(plan_module_downgrades(
            obj, {'https://scripts.example/fixed.js': 'script-1'}, self.analysis()), ([], True))

    def test_unsupported_reject_status_is_skipped(self):
        obj = self.module()
        obj['scriptings'][0] = {'http_request': {
            'name': 'reject', 'match': '^https://api.example/config',
            'script_url': 'https://scripts.example/fixed.js'}}
        self.assertEqual(plan_module_downgrades(
            obj, {'https://scripts.example/fixed.js': 'script-1'},
            self.analysis('reject', status=403))[0], [])

    def test_header_operations_become_header_rewrites(self):
        obj = self.module()
        obj['scriptings'][0] = {'http_response': {
            'name': 'headers', 'match': '^https://api.example/config',
            'script_url': 'https://scripts.example/fixed.js'}}
        plan, _ = plan_module_downgrades(
            obj, {'https://scripts.example/fixed.js': 'script-1'}, self.analysis('header'))
        self.assertEqual(len(plan), 1)
        apply_module_downgrades(obj, {'https://scripts.example/fixed.js': 'script-1'}, plan)
        self.assertEqual(obj['header_rewrites'], [
            {'add': {'match': '^https://api.example/config', 'name': 'X-A',
                     'type': 'response', 'value': '1'}}])

    def test_header_direction_must_match_script_phase(self):
        obj = self.module()
        obj['scriptings'][0] = {'http_request': {
            'name': 'headers', 'match': '^https://api.example/config',
            'script_url': 'https://scripts.example/fixed.js'}}
        self.assertEqual(plan_module_downgrades(
            obj, {'https://scripts.example/fixed.js': 'script-1'},
            self.analysis('header'))[0], [])

    def test_empty_header_name_is_not_downgraded(self):
        obj = self.module()
        obj['scriptings'][0] = {'http_response': {
            'name': 'headers', 'match': '^https://api.example/config',
            'script_url': 'https://scripts.example/fixed.js'}}
        self.assertEqual(plan_module_downgrades(
            obj, {'https://scripts.example/fixed.js': 'script-1'},
            self.analysis('header', operations=[{'op': 'set', 'name': '', 'value': '1'}]))[0], [])

    def test_provenance_lines_are_deduplicated(self):
        rows = [{'script_url': 'https://a'}, {'script_url': 'https://a'},
                {'script_url': 'https://b'}]
        self.assertEqual(provenance_lines(rows),
                         ['# Declarative: https://a\n', '# Declarative: https://b\n'])


class ProductQualityTests(unittest.TestCase):
    def test_anchor_detection_accepts_inline_flags(self):
        for match in ['^https://x', '\\Ahttps://x', '(?i:^https://x)', '(?i)^https://x']:
            self.assertTrue(is_anchored(match), match)
        for match in ['https://x', '.*https://x', '(?i:https://x)']:
            self.assertFalse(is_anchored(match), match)

    def test_good_module_has_no_findings(self):
        obj = {
            'url_rewrites': [{'match': '^https://ads', 'location': 'http://reject-dict/'}],
            'body_rewrites': [{'response_jq': {'match': '^https://api', 'filter': '.x = 1'}}],
            'header_rewrites': [{'add': {'match': '^https://api', 'name': 'X-A',
                                         'type': 'response', 'value': '1'}}],
            'map_locals': [{'match': '^https://api', 'body': '{}'}],
        }
        self.assertEqual(validate_declarative_module(obj), [])

    def test_fault_injection_unanchored(self):
        findings = validate_declarative_module({'url_rewrites': [
            {'match': 'https://ads', 'location': 'http://reject-dict/'}]})
        self.assertEqual([row['kind'] for row in findings], ['unanchored'])

    @unittest.skipUnless(shutil.which('jq'), 'jq 语法检查需要 jq 命令')
    def test_fault_injection_bad_jq(self):
        findings = validate_declarative_module({'body_rewrites': [
            {'response_jq': {'match': '^https://api', 'filter': 'del(.x'}}]})
        self.assertEqual([row['kind'] for row in findings], ['jq'])

    def test_fault_injection_missing_jq_is_a_failure(self):
        findings = validate_declarative_module(
            {'body_rewrites': [{'response_jq': {'match': '^https://api', 'filter': '.x'}}]},
            jq_executable='egern-missing-jq')
        self.assertEqual([row['kind'] for row in findings], ['jq-missing'])

    def test_fault_injection_bad_reject_location_and_status(self):
        findings = validate_declarative_module({'url_rewrites': [
            {'match': '^https://ads', 'location': 'http://reject-foo/'},
            {'match': '^https://old', 'location': 'https://new', 'status_code': 200},
            {'match': '^https://empty', 'location': ''},
        ]})
        self.assertEqual(sorted(row['kind'] for row in findings),
                         ['location', 'reject', 'status'])

    def test_location_capture_references_and_parameter_templates(self):
        for location in ['$1true$2', 'http://$1', 'https://api.example/$2',
                         'https://{{{endpoint}}}/api/v1/weather']:
            self.assertTrue(location_is_valid(location), location)
        for location in ['not a url', 'ftp://example.test/file', 'ftp://example.test/$1',
                         'http://[bad']:
            self.assertFalse(location_is_valid(location), location)
        # 非官方 token 由 reject 检查报告，location 结构检查不重复计数。
        self.assertTrue(location_is_valid('http://reject-foo/'))

    def test_fault_injection_invalid_location_url(self):
        findings = validate_declarative_module({'url_rewrites': [
            {'match': '^https://old', 'location': 'not a url', 'status_code': 302}]})
        self.assertEqual([row['kind'] for row in findings], ['location'])

    def test_fault_injection_malformed_header(self):
        findings = validate_declarative_module({'header_rewrites': [
            {'add': {'match': '^https://api', 'name': 'X-A', 'type': 'side', 'value': 1}}]})
        self.assertEqual(sorted(row['kind'] for row in findings), ['header', 'header'])

    def test_product_quality_counts(self):
        resources = [ {'id': 'a', 'kind': 'modules', 'yaml': '\n'.join([
            'name: a',
            'url_rewrites:',
            '  - match: "https://ads"',
            '    location: "http://reject-dict/"',
            'body_rewrites:',
            '  - response_jq:',
            '      match: "^https://api"',
            '      filter: ".x = 1"',
        ]) + '\n'} ]
        report = validate_product_quality(resources)
        self.assertEqual(report['modules'], 1)
        self.assertEqual(report['jq_total'], 1)
        self.assertEqual(report['unanchored_total'], 1)
        self.assertEqual(report['unanchored'], {'url_rewrites': 1})


def run_jq(filter_text, value):
    result = subprocess.run(['jq', '-c', filter_text], input=json.dumps(value),
                            text=True, capture_output=True, check=True)
    return json.loads(result.stdout)


if __name__ == '__main__':
    unittest.main()
