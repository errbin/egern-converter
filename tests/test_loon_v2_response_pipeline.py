"""Loon V2 单个 Mock 与 Header 动作必须合并为同一个原生响应。"""
import unittest

from tools.egern_hub.convert import ConversionError, convert_module


def convert(line, loader=None):
    return convert_module('[Rewrite]\n' + line, 'loon', native_rewrites=True, rule_set_loader=loader)


class LoonV2ResponsePipelineTests(unittest.TestCase):
    def test_binary_mock_and_header_set_share_one_respond(self):
        obj = convert(
            'response if ${url} == "https://grpc.example/ModeStatus" then '
            'response.body.mock("text", "AAAAABMKEQgCEgl0ZWVuYWdlcnMgAioA", 200, true) | '
            'response.header.set("grpc-status", "0")'
        )
        self.assertEqual(len(obj['rewrites']), 1)
        self.assertEqual(len(obj['rewrites'][0]['actions']), 1)
        respond = obj['rewrites'][0]['actions'][0]['respond']
        self.assertEqual(respond['status'], 200)
        self.assertEqual(respond['body'], {'base64': 'AAAAABMKEQgCEgl0ZWVuYWdlcnMgAioA'})
        self.assertEqual(respond['headers'], {'Content-Type': 'text/plain', 'grpc-status': '0'})

    def test_header_actions_are_order_independent_for_distinct_names(self):
        prefix = 'response if ${url} ~= /api/ then '
        before = convert(prefix + 'response.header.set("X-Test", "1") | response.body.mock("json", "{}")')
        after = convert(prefix + 'response.body.mock("json", "{}") | response.header.set("X-Test", "1")')
        expected = {'Content-Type': 'application/json', 'X-Test': '1'}
        self.assertEqual(before['rewrites'][0]['actions'][0]['respond']['headers'], expected)
        self.assertEqual(after['rewrites'][0]['actions'][0]['respond']['headers'], expected)

    def test_duplicate_sets_use_last_value_and_delete_removes_mock_header(self):
        obj = convert(
            'response if ${url} ~= /api/ then response.body.mock("json", "{}") | '
            'response.header.set("X-Test", "one") | response.header.set("x-test", "two")'
        )
        self.assertEqual(obj['rewrites'][0]['actions'][0]['respond']['headers'],
                         {'Content-Type': 'application/json', 'x-test': 'two'})
        obj = convert(
            'response if ${url} ~= /api/ then response.body.mock("json", "{}") | '
            'response.header.del("content-type")'
        )
        self.assertEqual(obj['rewrites'][0]['actions'][0]['respond']['headers'], {})

    def test_mock_file_and_header_pipeline_uses_loader_body(self):
        calls = []

        def load(url):
            calls.append(url)
            return '{"ok": true}'

        obj = convert(
            'response if ${url} ~= /api/ then response.body.mock_file("json", "mock.json", 201) | '
            'response.header.set("grpc-status", "0")', loader=load
        )
        self.assertEqual(calls, ['mock.json'])
        respond = obj['rewrites'][0]['actions'][0]['respond']
        self.assertEqual(respond['status'], 201)
        self.assertEqual(respond['body'], '{"ok": true}')
        self.assertEqual(respond['headers'], {'Content-Type': 'application/json', 'grpc-status': '0'})

    def test_batched_header_arrays_keep_pairing_inside_the_merged_response(self):
        obj = convert(
            'response if ${url} ~= /api/ then response.body.mock("json", "{}") | '
            'response.header.set(["X-A", "X-B"], ["1", "2"]) | response.header.del(["X-C", "X-D"])'
        )
        self.assertEqual(obj['rewrites'][0]['actions'][0]['respond']['headers'],
                         {'Content-Type': 'application/json', 'X-A': '1', 'X-B': '2'})

    def test_multiple_body_writes_are_rejected(self):
        prefix = 'response if ${url} ~= /api/ then '
        for pipeline in [
            'response.body.mock("json", "{}") | response.body.mock("json", "[]")',
            'response.body.mock("json", "{}") | response.json.jq(`.data = []`)',
            'response.body.mock("json", "{}") | response.body.replace(/a/, "b")',
            'response.json.jq(`.data = []`) | response.body.replace(/a/, "b")',
        ]:
            with self.subTest(pipeline=pipeline), self.assertRaisesRegex(ConversionError, '多个 Body 写入'):
                convert(prefix + pipeline)

    def test_unprovable_header_actions_and_framing_headers_are_rejected(self):
        prefix = 'response if ${url} ~= /api/ then response.body.mock("json", "{}") | '
        for pipeline in [
            'response.header.add("X-Test", "1")',
            'response.header.replace("X-Test", /a/, "b")',
            'response.header.set("Content-Length", "1")',
            'response.header.del("Transfer-Encoding")',
        ]:
            with self.subTest(pipeline=pipeline), self.assertRaises(ConversionError):
                convert(prefix + pipeline)

    def test_classic_mock_response_body_and_header_remain_separate(self):
        obj = convert_module(
            '[Rewrite]\n'
            '^https://a mock-response-body data-type=json data="{}"\n'
            '^https://a response-header-add grpc-status 0\n',
            'loon', native_rewrites=True
        )
        self.assertEqual([next(iter(row['actions'][0])) for row in obj['rewrites']],
                         ['respond', 'response_headers'])


if __name__ == '__main__':
    unittest.main()
