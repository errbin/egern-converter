"""闭合的 QX 响应投影与宿主请求快照跨 helper 的数据流证明。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL = 'https://example.test/closed-fetch.js'


def convert(source, source_format='qx'):
    return convert_script(source, 'Fixture', URL, '', source_format=source_format)


def closed_reply_source(tail='return reply;'):
    return f'''(async()=>{{
 async function fetchReply(url){{
  const reply=await $task.fetch({{url:url}});
  return reply.ok=/^2\\d\\d$/.test(reply.statusCode),reply.status=reply.statusCode,reply;
 }}
 async function read(url){{
  const reply=await fetchReply(url);{tail}
 }}
 $done({{body:String(await read("https://api.test/a"))}});
}})();'''


class ClosedFetchResponseTests(unittest.TestCase):
    def test_whole_reply_from_helper_is_projected_into_local_snapshot(self):
        source = '''(async()=>{
 async function fetchReply(url){
  if("undefined"!=typeof $task&&$task.fetch){
   const reply=await $task.fetch({url:url});
   return reply.ok=/^2\\d\\d$/.test(reply.statusCode),reply.status=reply.statusCode,reply;
  }
  return null;
 }
 async function readBody(url){
  const reply=await fetchReply(url);
  if(!reply.ok)return "bad";
  return "body:"+reply.body;
 }
 async function readStatus(url){
  const reply=await fetchReply(url);
  if(!reply.ok)return "bad";
  return "status:"+reply.status;
 }
 const values=await Promise.all([readBody("https://api.test/a"),readStatus("https://api.test/b")]);
 $done({body:values.join("|")});
})();'''
        for source_format in ['qx', 'surge', 'loon']:
            with self.subTest(source_format=source_format):
                self.assertNotIn('$task', convert(source, source_format))
        output = convert(source)
        self.assertIn('statusCode: response.statusCode ?? response.status', output)
        fixture = {'name': 'closed fetch response',
                   'request': {'url': URL},
                   'http': [{'url': 'https://api.test/a', 'status': 200, 'body': 'one'},
                            {'url': 'https://api.test/b', 'status': 201, 'body': 'two'}],
                   'expected': {'result': {'body': 'body:one|status:201'}}}
        result = compare(source, output, 'qx', URL, fixture)
        self.assertEqual(result['status'], 'passed', result)

    def test_dynamic_unknown_alias_and_mutation_keep_failing_closed(self):
        tails = [
            'const value=reply[$argument];',
            'const value=reply.cookies;',
            'unknown(reply);',
            'const alias=reply;unknown(alias);',
            'reply.status+=1;',
            'delete reply.status;',
            'const value=reply.headers[$argument];',
            'const alias=reply;alias.extra=1;',
        ]
        for tail in tails:
            with self.subTest(tail=tail), self.assertRaises(ConversionError):
                convert(closed_reply_source(tail))

    def test_host_request_url_and_method_allow_only_string_methods(self):
        positive = ('async function handle(request){return request.url.replace(/^https?:\\/\\/[^/]+/,"")}'
                    '(async()=>{if($response){$done({body:handle($request)})}else{$done($request)}})();')
        self.assertIn('const hostRequest', convert(positive))
        negatives = ['request.url[$argument].trim()', 'request.url.replace',
                     'request.url.badMethod()', 'request.url()',
                     'request.url.trim.call(request.url)']
        for expression in negatives:
            source = f'async function handle(request){{return {expression}}}(async()=>{{if($response){{$done({{body:handle($request)}})}}else{{$done($request)}}}})();'
            with self.subTest(expression=expression), self.assertRaises(ConversionError):
                convert(source)

    def test_qualified_client_counts_as_platform_evidence_and_task_fetch_is_present(self):
        source = ('const platform=globalThis.$httpClient?"legacy":"qx";'
                  'if("undefined"!=typeof $task&&$task.fetch){$done({body:platform+":qx"})}'
                  'else{$done({body:platform+":other"})}')
        expected = {'qx': 'qx:qx', 'surge': 'legacy:other', 'loon': 'legacy:other'}
        for source_format, body in expected.items():
            with self.subTest(source_format=source_format):
                output = convert(source, source_format)
                fixture = {'name': 'platform probe', 'request': {'url': URL},
                           'expected': {'result': {'body': body}}}
                result = compare(source, output, source_format, URL, fixture)
                self.assertEqual(result['status'], 'passed', result)


if __name__ == '__main__':
    unittest.main()
