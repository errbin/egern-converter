"""可选的旧 HTTP 接收者只能在闭合 helper 内按来源平台择一。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL = 'https://example.test/alternate-http.js'


class AlternateHTTPReceiverTests(unittest.TestCase):
    def test_optional_dual_receiver_emits_one_platform_dispatch(self):
        source = '''function send(op, cb) {
  $httpClient?.[op.method || "get"](op, (error, response, body) => cb(error, response, body));
  $task?.fetch({url: op, ...op}).then(response => cb(null, response, response.body), error => cb(error));
}
send({url:'https://example.test/api', headers:{X:'kept'}}, (error, response, body) => $done({body:error||body}));'''
        for source_format in ['surge', 'loon']:
            with self.subTest(source_format=source_format):
                output = convert_script(source, 'Fixture', URL, '', source_format=source_format)
                self.assertNotIn('$httpClient', output)
                self.assertNotIn('$task', output)
                fixture = {'name': 'dual HTTP receiver', 'request': {'url': URL},
                           'http': [{'url': 'https://example.test/api', 'body': 'ok'}],
                           'expected': {'result': {'body': 'ok'},
                                        'events': {'requests': [{'url': 'https://example.test/api',
                                                                 'headers': {'x': 'kept'}}]}}}
                result = compare(source, output, source_format, URL, fixture)
                self.assertEqual(result['status'], 'passed', result)

    def test_non_optional_dual_dispatch_stays_rejected(self):
        source = '''function send(op, cb) {
  $httpClient[op.method || "get"](op, (error, response, body) => cb(error, response, body));
  $task.fetch({url: op, ...op}).then(response => cb(null, response, response.body), error => cb(error));
}
send({url:'https://example.test/api'}, (error, response, body) => $done({body:error||body}));'''
        with self.assertRaises(ConversionError):
            convert_script(source, 'Fixture', URL, '', source_format='loon')

    def test_request_identity_aliases_escapes_and_post_dispatch_writes_are_rejected(self):
        for source in [
            '''const send = op => {const copy = op; $httpClient.get(op, () => {});};
send({url:'https://example.test/api'}); $done({});''',
            '''const send = op => {unknown(op); $httpClient.get(op, () => {});};
send({url:'https://example.test/api'}); $done({});''',
            '''const send = op => {$httpClient.get(op, () => {}); op.url = 'https://other.test/';};
send({url:'https://example.test/api'}); $done({});''',
            '''const send = op => {$httpClient.get(op, () => {}); delete op.headers;};
send({url:'https://example.test/api'}); $done({});''',
            '''const send = op => {$httpClient.get(op, () => {}); op.headers.X = 'late';};
send({url:'https://example.test/api'}); $done({});''',
            '''const send = op => {$httpClient.get(op, () => {});};
send({url:'https://example.test/api', mystery:1}); $done({});''',
        ]:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '', source_format='loon')

    def test_absent_timeout_read_and_closed_response_spread_remain_provable(self):
        timeout_source = '''function send(op, cb) {
  const timeout = op.$timeout ?? 4000;
  $httpClient.get(op, (error, response, body) => cb(error, response, body, timeout));
}
send({url:'https://example.test/api'}, (error, response, body, timeout) => $done({body:(error||body)+':'+timeout}));'''
        timeout_output = convert_script(timeout_source, 'Fixture', URL, '', source_format='loon')
        timeout_fixture = {'name': 'absent timeout', 'request': {'url': URL},
                           'http': [{'url': 'https://example.test/api', 'body': 'ok'}],
                           'expected': {'result': {'body': 'ok:4000'}}}
        self.assertEqual(compare(timeout_source, timeout_output, 'loon', URL, timeout_fixture)['status'],
                         'passed')

        response_source = '''function finish({status, ...rest}) {$done({body:status+':'+rest.body})}
function send(op) {$httpClient.get(op, (error, response, body) => finish({...response, body}));}
send({url:'https://example.test/api'});'''
        response_output = convert_script(response_source, 'Fixture', URL, '', source_format='loon')
        response_fixture = {'name': 'closed response spread', 'request': {'url': URL},
                            'http': [{'url': 'https://example.test/api', 'body': 'ok', 'status': 200}],
                            'expected': {'result': {'body': '200:ok'}}}
        self.assertEqual(compare(response_source, response_output, 'loon', URL, response_fixture)['status'],
                         'passed')


if __name__ == '__main__':
    unittest.main()
