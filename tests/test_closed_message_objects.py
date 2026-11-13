"""整体消息对象只在完整局部数据流可枚举时投影为普通快照。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

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

    def test_whole_snapshot_may_reach_closed_identity_helpers(self):
        source = ("function eq(a,b){return a===b}const snapshot=$response;"
                  "$done({body:eq(snapshot,null)?'same':'different'});")
        native = self.convert(source)
        self.assertNotIn('$response', native)
        case = {'name': 'closed identity helper', 'request': {'url': URL},
                'response': {'status': 200, 'headers': {}, 'body': 'original'},
                'expected': {'result': {'body': 'different'}}}
        result = compare(source, native, 'qx', URL, case)
        self.assertEqual(result['status'], 'passed', result)

    def test_identity_helper_table_chain_keeps_whole_snapshot_read_only(self):
        source = ("const helpers={eq:function(a,b){return a===b}};"
                  "function same(a,b){return helpers.eq(a,b)}const snapshot=$response;"
                  "$done({body:same(snapshot,null)?'same':'different'});")
        native = self.convert(source)
        self.assertNotIn('$response', native)
        case = {'name': 'closed identity helper chain', 'request': {'url': URL},
                'response': {'status': 200, 'headers': {}, 'body': 'original'},
                'expected': {'result': {'body': 'different'}}}
        result = compare(source, native, 'qx', URL, case)
        self.assertEqual(result['status'], 'passed', result)

    def test_coercing_or_escaping_identity_helpers_still_reject(self):
        sources = [
            "function eq(a,b){return a==b}const snapshot=$response;"
            "$done({body:eq(snapshot,null)?'same':'different'});",
            "function eq(a,b){return a.body===b}const snapshot=$response;"
            "$done({body:eq(snapshot,null)?'same':'different'});",
            "function eq(a,b){return unknown(a)}const snapshot=$response;"
            "$done({body:eq(snapshot,null)?'same':'different'});",
            "const helpers={eq:function(a,b){return a===b}};"
            "helpers.eq=function(){return true};const snapshot=$response;"
            "$done({body:helpers.eq(snapshot,null)?'same':'different'});",
            "const helpers={eq:function(a,b){return a===b}};const snapshot=$response;"
            "$done({body:helpers[$argument](snapshot,null)?'same':'different'});",
        ]
        for source in sources:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                self.convert(source)

    def test_response_alias_body_is_differentially_equivalent(self):
        source = 'const alias=$response; $done({body:alias.body});'
        native = self.convert(source)
        self.assertNotIn('$response', native)
        for body in ['', 'plain', '{"ok":true}', '中文正文']:
            with self.subTest(body=body):
                case = {'name': 'response alias body', 'request': {'url': URL},
                        'response': {'body': body}, 'expected': {'result': {'body': body}}}
                result = compare(source, native, 'qx', URL, case)
                self.assertEqual(result['status'], 'passed', result)

    def test_local_snapshot_status_write_is_differentially_equivalent(self):
        source = ('function finish(response){response.status=204;return response}'
                  "const result=finish($response);$done({status:result.status,body:'ok'});")
        native = self.convert(source)
        self.assertNotIn('$response', native)
        fixture = {'name': 'local status write', 'request': {'url': URL},
                   'response': {'status': 200, 'headers': {}, 'body': 'original'}}
        result = compare(source, native, 'qx', URL, fixture)
        self.assertEqual(result['status'], 'passed', result)

    def test_unknown_dynamic_method_or_status_mutation_still_rejects(self):
        sources = [
            '''const request=$request; $done({body:request.unknown});''',
            '''const request=$request, key=$argument; $done({body:request[key]});''',
            '''const request=$request; $done({body:request.headers.get('x')});''',
            '''$response.status=204;$done({body:'x'});''',
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
