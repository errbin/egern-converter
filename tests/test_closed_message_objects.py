"""整体消息对象只在完整局部数据流可枚举时投影为普通快照。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script

URL = 'https://example.test/message.js'


class ClosedMessageObjectTests(unittest.TestCase):
    def convert(self, source, format='qx'):
        return convert_script(source, 'Fixture', URL, '', source_format=format)

    def test_alias_and_mutable_consumer_project_known_fields(self):
        for source in [
            '''const request=$request; $done({body:request.url});''',
            '''function finish(response){response.body='rewritten';return response}
const result=finish($response); $done({body:result.body});''',
        ]:
            with self.subTest(source=source):
                native = self.convert(source)
                self.assertNotIn('$request', native)
                self.assertNotIn('$response', native)

    def test_headers_are_materialized_as_plain_data(self):
        source = '''function snapshot(response){return {status:response.status,headers:{...response.headers}}}
const result=snapshot($response);$done({body:JSON.stringify(result.headers)});'''
        native = self.convert(source)
        self.assertIn('ctx.response["headers"].entries()', native)
        self.assertIn('ctx.response["status"]', native)

    def test_unknown_dynamic_method_or_status_mutation_still_rejects(self):
        sources = [
            '''const request=$request; $done({body:request.unknown});''',
            '''const request=$request, key=$argument; $done({body:request[key]});''',
            '''const request=$request; $done({body:request.headers.get('x')});''',
            '''function finish(response){response.statusCode=204;return response}
const result=finish($response);$done({status:result.status});''',
        ]
        for source in sources:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                self.convert(source)

    def test_escape_write_and_live_read_divergence_still_rejects(self):
        sources = [
            '''const request=$request; unknown(request); $done({});''',
            '''const request=$request; request.url='https://other.test/'; $done({body:request.url});''',
            '''function finish(response){response.body='x';return response}
const result=finish($response);$done({body:$response.body,status:result.status});''',
            '''function finish(response){unknown(response);return response}
const result=finish($response);$done({body:result.body});''',
            '''function finish(response){return response}
const result=finish($response);$done({body:result.unknown});''',
        ]
        for source in sources:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                self.convert(source)


if __name__ == '__main__':
    unittest.main()
