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


if __name__ == '__main__':
    unittest.main()
