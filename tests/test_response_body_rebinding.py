"""响应正文直接重绑可物化为本地变量，其他字段修改仍保持拒绝。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL = 'https://example.test/source.js'


class ResponseBodyRebindingTests(unittest.TestCase):
    def test_response_body_rebinding_preserves_latest_value(self):
        source = "const body=$response.body||'';if(body.includes('a'))$response.body=body.replace('a','b');else $response.body=body+'!';$done({body:$response.body});"
        output = convert_script(source, 'Fixture', URL, '', source_format='loon')
        self.assertNotIn('$response', output)
        for body in ['cat', 'dog']:
            fixture = {'name':'response body rebinding', 'request':{'url':URL},
                       'response':{'body':body}}
            result = compare(source, output, 'loon', URL, fixture)
            self.assertEqual(result['status'], 'passed', result)

    def test_non_body_or_non_assignment_mutations_remain_rejected(self):
        sources = [
            '$response.status=500;$done({body:$response.body});',
            '$request.body="changed";$done({body:$response.body});',
            'delete $response.body;$done({body:$response.body});',
            '$response.bodyBytes="changed";$done({body:$response.body});',
            '$response.body="changed";$done($response);',
        ]
        for source in sources:
            with self.subTest(source=source), self.assertRaisesRegex(ConversionError, '直接修改|整体传递'):
                convert_script(source, 'Fixture', URL, '', source_format='loon')


if __name__ == '__main__':
    unittest.main()
