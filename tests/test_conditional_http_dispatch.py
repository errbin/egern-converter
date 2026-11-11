"""同一请求记录的互斥 HTTP 派发分支可按来源平台展开为直接调用。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL = 'https://example.test/conditional-dispatch.js'


class ConditionalHTTPDispatchTests(unittest.TestCase):
    def test_mutually_exclusive_receiver_branches_share_one_closed_request(self):
        source = '''function send(request, callback){
  const method=(request.method||'GET').toUpperCase();
  if (typeof $httpClient!=='undefined'){
    const fn = method==='POST' ? $httpClient.post : $httpClient.get;
    fn(request,(error,response,body)=>error?callback(error):callback(null,body));
  } else if (typeof $task!=='undefined'){
    $task.fetch(request).then(resp=>callback(null,resp.body),err=>callback(err));
  } else callback(new Error('unsupported'));
}
send({url:'https://api.test/',method:'GET'},(error,body)=>$done({body:error?String(error):body}));'''
        for source_format in ['surge', 'loon', 'qx']:
            with self.subTest(source_format=source_format):
                output = convert_script(source, 'Fixture', URL, '', source_format=source_format)
                self.assertNotIn('$httpClient', output)
                self.assertNotIn('$task', output)
                case = {'name': 'conditional dispatch', 'request': {'url': URL},
                        'http': [{'url': 'https://api.test/', 'body': 'ok'}],
                        'expected': {'result': {'body': 'ok'},
                                     'events': {'requests': [{'url': 'https://api.test/'}]}}}
                result = compare(source, output, source_format, URL, case)
                self.assertEqual(result['status'], 'passed', result)

    def test_sequential_dual_dispatch_is_still_rejected(self):
        source = '''function send(request, callback){
  $httpClient.get(request,(error,response,body)=>callback(error,body));
  $task.fetch(request).then(resp=>callback(null,resp.body),err=>callback(err));
}
send({url:'https://api.test/'},(error,body)=>$done({body:error?String(error):body}));'''
        with self.assertRaises(ConversionError):
            convert_script(source, 'Fixture', URL, '', source_format='loon')

    def test_write_after_first_exclusive_dispatch_is_rejected(self):
        source = '''function send(request, callback){
  const fn = request.method==='POST' ? $httpClient.post : $httpClient.get;
  if (request.method==='POST'){ fn(request,(error,response,body)=>callback(error,body)); }
  else { request.url += '?late'; fn(request,(error,response,body)=>callback(error,body)); }
}
send({url:'https://api.test/',method:'GET'},(error,body)=>$done({body:error?String(error):body}));'''
        with self.assertRaises(ConversionError):
            convert_script(source, 'Fixture', URL, '', source_format='loon')


if __name__ == '__main__':
    unittest.main()
