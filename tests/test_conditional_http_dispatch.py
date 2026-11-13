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

    def test_conditional_method_alias_dispatches_through_closed_forwarder(self):
        source = '''const method=$request.method==='POST'?$httpClient.post:$httpClient.get;
const forward={call:function(fn,request,callback){return fn(request,callback)}};
function send(request){
  return new Promise((resolve,reject)=>{
    forward.call(method,request,(error,response,body)=>error?reject(error):resolve(body));
  });
}
(async()=>{const body=await send({url:'https://api.test/'});$done({body});})();'''
        for source_format in ['surge', 'loon']:
            for method in ['GET', 'POST']:
                with self.subTest(source_format=source_format, method=method):
                    output = convert_script(source, 'Fixture', URL, '', source_format=source_format)
                    self.assertNotIn('$httpClient', output)
                    case = {'name': 'forwarded conditional dispatch',
                            'request': {'url': URL, 'method': method},
                            'http': [{'url': 'https://api.test/', 'body': 'ok'}],
                            'expected': {'result': {'body': 'ok'},
                                         'events': {'requests': [{'method': method,
                                                                  'url': 'https://api.test/'}]}}}
                    result = compare(source, output, source_format, URL, case)
                    self.assertEqual(result['status'], 'passed', result)

    def test_unknown_copied_rebound_or_mutated_forwarded_methods_are_rejected(self):
        template = '''const method=$request.method==='POST'?$httpClient.post:$httpClient.get;
const forward={call:function(fn,request,callback){return fn(request,callback)}};
function send(request){
  return new Promise((resolve,reject)=>{PREFIX
    forward.call(DISPATCH,request,(error,response,body)=>error?reject(error):resolve(body));});}
(async()=>{const body=await send({url:'https://api.test/'});$done({body});})();'''
        for prefix, dispatch, replacement in [
            ('', 'method', "$request.method==='POST'?$httpClient.post:unknown"),
            ('const alias=method;', 'alias', None),
            ('method=$httpClient.get;', 'method', None),
            ('unknown(method);', 'method', None),
            ('delete forward.call;', 'method', None),
            ('unknown(forward);', 'method', None),
        ]:
            source = template.replace('PREFIX', prefix).replace('DISPATCH', dispatch)
            if replacement:
                source = source.replace("$request.method==='POST'?$httpClient.post:$httpClient.get", replacement)
            with self.subTest(prefix=prefix), self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '', source_format='loon')

    def test_forwarders_with_extra_work_or_wrong_argument_order_are_rejected(self):
        template = '''const method=$request.method==='POST'?$httpClient.post:$httpClient.get;
const forward={call:FUNCTION};
function send(request){
  return new Promise((resolve,reject)=>{
    forward.call(ARGUMENTS,(error,response,body)=>error?reject(error):resolve(body));});}
(async()=>{const body=await send({url:'https://api.test/'});$done({body});})();'''
        for function_text, arguments_text in [
            ('function(fn,request,callback){const copy=fn;return copy(request,callback)}', 'method,request'),
            ('function(fn,request,callback){return fn(callback,request)}', 'method,request'),
            ('function(fn,request,callback){console.log(request.url);return fn(request,callback)}', 'method,request'),
            ('function(fn,request,callback){return fn(request,callback)}', 'request,method'),
        ]:
            source = template.replace('FUNCTION', function_text).replace('ARGUMENTS', arguments_text)
            with self.subTest(function_text=function_text, arguments_text=arguments_text), self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '', source_format='loon')

    def test_nested_identity_forwarders_preserve_request_and_method_order(self):
        source = '''const call=(fn,request,callback)=>fn(request,callback);
const pass=(fn,request,callback)=>call(fn,request,callback);
pass($httpClient.get,{url:'https://api.test/',method:'GET'},(error,response,body)=>{});
$done({body:'ok'});'''
        for source_format in ['surge', 'loon']:
            with self.subTest(source_format=source_format):
                output = convert_script(source, 'Fixture', URL, '', source_format=source_format)
                self.assertNotIn('$httpClient', output)
                case = {'name': 'nested identity forwarder', 'request': {'url': URL},
                        'http': [{'url': 'https://api.test/', 'body': 'ignored'}],
                        'expected': {'result': {'body': 'ok'},
                                     'events': {'requests': [{'method': 'GET',
                                                              'url': 'https://api.test/'}]}}}
                result = compare(source, output, source_format, URL, case)
                self.assertEqual(result['status'], 'passed', result)

    def test_nested_forwarders_reordering_or_extra_work_are_rejected(self):
        template = '''const call=FIRST;
const pass=SECOND;
const method=$httpClient.get;
function send(request){pass(method,request,(error,response,body)=>$done({body}));}
send({url:'https://api.test/'});'''
        for first, second in [
            ('(fn,request,callback)=>fn(callback,request)', '(fn,request,callback)=>call(fn,request,callback)'),
            ('(fn,request,callback)=>fn(request,callback)', '(fn,request,callback)=>call(request,fn,callback)'),
            ('(fn,request,callback)=>{console.log(request.url);return fn(request,callback)}', '(fn,request,callback)=>call(fn,request,callback)'),
            ('(fn,request,callback)=>fn(request,callback)', '(fn,request,callback)=>{call(fn,request,callback);return fn(request,callback)}'),
        ]:
            source = template.replace('FIRST', first).replace('SECOND', second)
            with self.subTest(first=first, second=second), self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '', source_format='loon')


if __name__ == '__main__':
    unittest.main()
