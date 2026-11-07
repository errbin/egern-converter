"""Runtime-shaped legacy request values are projected into native ctx.http calls."""
import unittest

from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL='https://example.test/dynamic-request.js'


class DynamicHTTPProjectionTests(unittest.TestCase):
    def test_closed_json_getter_keeps_live_headers_and_method(self):
        source='''function read(key){let value;const raw=$persistentStore.read(key);
if(raw)try{value=JSON.parse($persistentStore.read(key))}catch{}return value}
const options=read('request');delete options.headers.Cookie;
const method=options.method?options.method.toLowerCase():'post';
$httpClient[method](options,(error,response,body)=>$done({body}));'''
        output=convert_script(source,'Fixture',URL,'',source_format='loon')
        self.assertIn('ctx.http[',output)
        self.assertNotIn('$httpClient',output)
        for method in ['POST','PUT']:
            case={'name':'closed JSON getter '+method,'request':{'url':URL},
                  'storage':{'request':'{"url":"https://api.example.test/","method":"'+method+'","headers":{"Cookie":"public","X-Fixture":"yes"},"body":"payload"}'},
                  'http':[{'url':'https://api.example.test/','body':'ok'}],
                  'expected':{'result':{'body':'ok'},'events':{'requests':[{'method':method,'url':'https://api.example.test/','headers':{'x-fixture':'yes'},'body':'payload'}]}}}
            with self.subTest(method=method):
                result=compare(source,output,'loon',URL,case)
                self.assertEqual(result['status'],'passed',result)

    def test_string_argument_is_a_native_url(self):
        source='$httpClient.get($argument,(error,response,body)=>$done({body}));'
        output=convert_script(source,'Fixture',URL,'',source_format='loon')
        self.assertIn('ctx.http.get(',output)
        self.assertNotIn('$httpClient',output)
        target='https://api.example.test/value'
        case={'name':'string request argument','argument':target,'request':{'url':URL},
              'http':[{'url':target,'body':'ok'}],
              'expected':{'result':{'body':'ok'},'events':{'requests':[{'method':'GET','url':target}]}}}
        result=compare(source,output,'loon',URL,case)
        self.assertEqual(result['status'],'passed',result)

    def test_json_request_record_is_parsed_once_and_projected(self):
        source='$httpClient.post(JSON.parse($argument),(error,response,body)=>$done({body}));'
        output=convert_script(source,'Fixture',URL,'',source_format='loon')
        self.assertIn('ctx.http.post(',output)
        self.assertEqual(output.count('JSON.parse('),1)
        self.assertNotIn('$httpClient',output)
        target='https://api.example.test/value'
        argument='{"url":"'+target+'","headers":{"X-Test":"yes"},"body":"payload"}'
        case={'name':'JSON request record','argument':argument,'request':{'url':URL},
              'http':[{'url':target,'body':'ok'}],
              'expected':{'result':{'body':'ok'},'events':{'requests':[{'method':'POST','url':target,'body':'payload'}]}}}
        result=compare(source,output,'loon',URL,case)
        self.assertEqual(result['status'],'passed',result)

    def test_callback_may_attach_a_synthetic_status_field_before_resolving(self):
        source='''new Promise(resolve=>{
 $httpClient.get({url:'https://api.example.test/'},(error,response)=>{
 response.ok=/^2\\d\\d$/.test(response.status);
 resolve(response);
 });
}).then(response=>$done({body:String(response.ok)}));'''
        output=convert_script(source,'Fixture',URL,'',source_format='loon')
        self.assertNotIn('$httpClient',output)
        case={'name':'legacy synthetic response field','request':{'url':URL},
              'http':[{'url':'https://api.example.test/','status':204}],
              'expected':{'result':{'body':'true'},
                          'events':{'requests':[{'method':'GET','url':'https://api.example.test/'}]}}}
        result=compare(source,output,'loon',URL,case)
        self.assertEqual(result['status'],'passed',result)


if __name__=='__main__':
    unittest.main()
