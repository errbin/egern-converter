"""封闭 HTTP 回调形参可接收物化响应，逃逸或未知实参仍保持拒绝。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL = 'https://example.test/source.js'


class ClosedHttpCallbackParameterTests(unittest.TestCase):
    def test_closed_callback_parameter_can_receive_materialized_response(self):
        source = '''const api=new class{get(options,callback=()=>{}){ $httpClient.get(options,(error,response,body)=>{if(!error&&response){response.body=body;response.statusCode=response.status||response.statusCode;response.status=response.statusCode;}callback(error,response,body);});}};
async function run(flag){return await new Promise(resolve=>{if(flag)api.get({url:'https://api.test/a'},(error,response,body)=>resolve(error||body));else api.get({url:'https://api.test/b'},(error,response,body)=>resolve(error||body));});}
run($request.url.endsWith('/a')).then(body=>$done({body}));'''
        output = convert_script(source, 'Fixture', URL, '', source_format='loon')
        self.assertNotIn('$httpClient', output)
        for request, api_url, body in [
            ('https://example.test/a', 'https://api.test/a', 'A'),
            ('https://example.test/b', 'https://api.test/b', 'B'),
        ]:
            fixture = {'name':'closed callback', 'request':{'url':request},
                       'http':[{'url':api_url,'body':body}]}
            result = compare(source, output, 'loon', URL, fixture)
            self.assertEqual(result['status'], 'passed', result)

    def test_callback_parameter_escape_and_opaque_call_argument_remain_rejected(self):
        escaped = '''const api=new class{get(options,callback=()=>{}){consume(callback);$httpClient.get(options,(error,response,body)=>callback(error,response,body));}};
api.get({url:'https://api.test/'},(error,response,body)=>$done({body}));'''
        opaque = '''const api=new class{get(options,callback=()=>{}){$httpClient.get(options,(error,response,body)=>callback(error,response,body));}};
api.get({url:'https://api.test/a'},(error,response,body)=>$done({body}));api.get({url:'https://api.test/b'},$persistentStore.read('callback'));'''
        for source in [escaped, opaque]:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '', source_format='loon')

    def test_callback_value_forwarded_through_local_helper_parameter(self):
        source = ("function send(req,cb){$httpClient.get(req,(err,resp,body)=>{"
                  "if(resp){resp.body=body;resp.statusCode=resp.status||resp.statusCode;}"
                  "cb(err,resp,body);});}"
                  "send({url:'https://api.test/'},(err,resp,body)=>"
                  "$done({body:resp?resp.statusCode+':'+resp.body:'error:'+String(err)}));")
        output = convert_script(source, 'Fixture', URL, '', source_format='surge')
        self.assertNotIn('$httpClient', output)
        for http, expected in [
            ({'url': 'https://api.test/', 'body': 'ok', 'status': 201}, '201:ok'),
            ({'url': 'https://api.test/', 'error': 'synthetic'}, 'error:synthetic'),
        ]:
            with self.subTest(http=http):
                case = {'name': 'forwarded callback value', 'request': {'url': URL}, 'http': [http]}
                result = compare(source, output, 'surge', URL, case)
                self.assertEqual(result['status'], 'passed', result)
                self.assertEqual(result.get('differences'), [])

    def test_forwarded_callback_rejects_escape_rebinding_and_nonlocal_values(self):
        cases = [
            ("function send(req,cb){consume(cb);$httpClient.get(req,(err,resp,body)=>cb(err,resp,body));}"
             "send({url:'https://api.test/'},(err,resp,body)=>$done({body}));"),
            ("function send(req,cb){$httpClient.get(req,(err,resp,body)=>cb(err,resp,body));}"
             "send={};send({url:'https://api.test/'},(err,resp,body)=>$done({body}));"),
            ("function send(req,cb){$httpClient.get(req,(err,resp,body)=>cb(err,resp,body));}"
             "send({url:'https://api.test/'},globalThis.callback);$done({body:'fallback'});"),
            ("function send(req,cb){$httpClient.get(req,(err,resp,body)=>cb(err,resp,body));}"
             "send({url:'https://api.test/'},$persistentStore.read('callback'));$done({body:'fallback'});"),
        ]
        for source in cases:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '', source_format='surge')

    def test_qx_whole_response_reaches_closed_structured_callback(self):
        source = ("function send(req,cb){$task.fetch(req).then("
                  "r=>{r.status=r.statusCode;cb(null,r,r.body);},"
                  "e=>cb(e.error||e,null,null));}"
                  "function get(req){return new Promise((resolve,reject)=>{"
                  "send(req,(err,resp,body)=>err?reject(err):resolve({status:resp.status,body:body||''}))})}"
                  "(async()=>{const r=await get({url:'https://api.test/'});"
                  "$done({body:r.status+':'+r.body})})();")
        output = convert_script(source, 'Fixture', URL, '', source_format='qx')
        self.assertNotIn('$task', output)
        fixture = {'name': 'qx structured callback', 'request': {'url': URL},
                   'http': [{'url': 'https://api.test/', 'status': 201, 'body': 'ok'}],
                   'expected': {'result': {'body': '201:ok'}}}
        result = compare(source, output, 'qx', URL, fixture)
        self.assertEqual(result['status'], 'passed', result)

    def test_qx_structured_callback_rejects_unknown_escape_and_wrong_alias(self):
        template = ("function send(req,cb){$task.fetch(req).then("
                    "r=>{__ALIAS__;cb(null,r,r.body);},"
                    "e=>cb(e.error||e,null,null));}"
                    "function get(req){return new Promise((resolve,reject)=>{send(req,__CALLBACK__)})}"
                    "(async()=>{const r=await get({url:'https://api.test/'});$done({body:r.status})})();")
        cases = [
            ('r.status=r.statusCode',
             "(err,resp,body)=>err?reject(err):resolve({status:resp.unknown,body})"),
            ('r.status=r.statusCode',
             "(err,resp,body)=>{unknown(resp);return err?reject(err):resolve({status:resp.status,body})}"),
            ('r.status=r.body',
             "(err,resp,body)=>err?reject(err):resolve({status:resp.status,body})"),
            ('r.status=r.statusCode',
             "(err,resp,body)=>err?reject(err):resolve({status:resp[$argument],body})"),
        ]
        for alias, callback in cases:
            source = template.replace('__ALIAS__', alias).replace('__CALLBACK__', callback)
            with self.subTest(alias=alias, callback=callback), self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '', source_format='qx')


if __name__ == '__main__':
    unittest.main()
