"""宿主响应可先落入局部别名，但别名只能读取已投影字段。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL = 'https://example.test/response-alias.js'


def source_with(tail):
    return ("(async()=>{const record={};const result=await new Promise((resolve,reject)=>{"
            "$httpClient.get({url:'https://example.test/reply'},(e,reply,body)=>{"
            "record.response=reply;record.body=body;resolve(record)})});"
            "let alias;alias=result.response;" + tail + "$done({body:'ok'})})();")


class HTTPResponseAliasTests(unittest.TestCase):
    def test_single_write_alias_reads_status_and_headers(self):
        source = source_with("const status=alias.status||alias.statusCode;const headers=alias.headers;")
        output = convert_script(source, 'Fixture', URL, '', source_format='loon')
        self.assertIn('ctx.http.get', output)
        fixture = {'name': 'response alias',
                   'request': {'url': URL},
                   'http': [{'url': 'https://example.test/reply', 'body': 'reply', 'status': 200}],
                   'expected': {'result': {'body': 'ok'}}}
        result = compare(source, output, 'loon', URL, fixture)
        self.assertEqual(result['status'], 'passed', result)

    def test_alias_escape_dynamic_or_repeated_write_remains_rejected(self):
        for tail in [
            "unknown(alias);",
            "const value=alias[$argument];",
            "alias=result;const status=alias.status;",
        ]:
            with self.subTest(tail=tail), self.assertRaises(ConversionError):
                convert_script(source_with(tail), 'Fixture', URL, '', source_format='loon')

    def test_alias_projection_fields_are_read_only(self):
        for tail in [
            "delete alias.status;",
            "alias.status=500;",
            "alias.status();",
        ]:
            with self.subTest(tail=tail), self.assertRaises(ConversionError):
                convert_script(source_with(tail), 'Fixture', URL, '', source_format='loon')


if __name__ == '__main__':
    unittest.main()
