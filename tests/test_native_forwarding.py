"""Closed HTTP selectors and nested completion values retain authored data flow."""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL = 'https://example.test/forwarding.js'


class NativeForwardingTests(unittest.TestCase):
    def test_forwarded_abort_keeps_empty_default_and_rejects_false_variants(self):
        source = 'function finish(value={}){$done(value)}if($argument==="abort")finish({abort:true});else finish();'
        output = convert_script(source, 'Test', URL, '', source_format='loon')
        for argument,mode in [('abort','abort'),('empty','modify')]:
            case = {'name':argument,'argument':argument,'request':{'url':'https://example.test/'},
                    'expected':{'mode':mode,'result':{}}}
            with self.subTest(argument=argument):
                result = compare(source, output, 'loon', URL, case)
                self.assertEqual(result['status'], 'passed', result)
        with self.assertRaises(ConversionError):
            convert_script(source.replace('else finish()', 'else finish({abort:false})'), 'Test', URL, '', source_format='loon')
        with self.assertRaises(ConversionError):
            convert_script('const value={abort:false};if($argument)value.abort=true;$done(value);', 'Test', URL, '', source_format='loon')

    def test_forwarded_response_fields_are_unioned_across_callers(self):
        source = '''function finish(value={}){$done(value)}
        if($argument==='first'){const local='kept';finish({response:{status:201,body:local}})}
        else{const local='other';finish({response:{status:202,headers:{X:local}}})}'''
        output = convert_script(source, 'Test', URL, '', source_format='loon')
        for argument, expected in [('first',{'status':201,'body':'kept'}),('second',{'status':202,'headers':{'x':'other'}})]:
            case = {'name':argument,'argument':argument,'request':{'url':'https://example.test/'},
                    'expected':{'mode':'respond','result':expected}}
            with self.subTest(argument=argument):
                result = compare(source, output, 'loon', URL, case)
                self.assertEqual(result['status'], 'passed', result)

    def test_nested_response_forwarder_keeps_local_value_and_empty_default(self):
        source = '''function finish(value={}){$done(value)}
        if(typeof $request!=='undefined'){
          const status={local:'kept'};
          finish({response:{status:201,headers:{'Content-Type':'application/json'},body:JSON.stringify({status})}});
        }else{finish()}'''
        output = convert_script(source, 'Test', URL, '', source_format='loon')
        for stage in ['http_request', 'schedule']:
            expected = {'mode':'respond', 'result':{'status':201,'body':'{"status":{"local":"kept"}}'}} if stage=='http_request' else {'mode':'modify','result':{}}
            case = {'name':stage,'entry_type':stage,'request':{'url':'https://example.test/'},'expected':expected}
            with self.subTest(stage=stage):
                result = compare(source, output, 'loon', URL, case)
                self.assertEqual(result['status'], 'passed', result)

    def test_http_alias_through_nested_forwarders_uses_native_request_signature(self):
        source = '''const get=(s,t)=>send(s,"GET",t);
        const send=(s,t,i)=>{const method="POST"==t?$httpClient.post:$httpClient.get;
          method(s,(e,r,b)=>{r&&(r.body=b,r.statusCode=r.status);i(e,r,b)});};
        new Promise(resolve=>get({url:'https://example.test/api'},(e,r,b)=>resolve(b)))
          .then(body=>$done({body}));'''
        output = convert_script(source, 'Test', URL, '', source_format='loon')
        case = {'name':'nested alias','request':{'url':'https://example.test/'},
                'http':[{'url':'https://example.test/api','body':'kept'}],
                'expected':{'result':{'body':'kept'},'events':{'requests':[{'method':'GET','url':'https://example.test/api'}]}}}
        result = compare(source, output, 'loon', URL, case)
        self.assertEqual(result['status'], 'passed', result)
        self.assertNotIn('$httpClient', output)

    def test_method_selection_is_evaluated_once_before_later_mutation(self):
        source = '''let choose=$argument==='post',count=0;
        const method=(++count&&choose)?$httpClient.post:$httpClient.get;
        choose=!choose;count+=10;
        method({url:'https://example.test/api'},(e,r,b)=>$done({body:b+':'+count}));'''
        output = convert_script(source, 'Test', URL, '', source_format='loon')
        for argument,method in [('post','POST'),('get','GET')]:
            case = {'name':method,'argument':argument,'request':{'url':'https://example.test/'},
                    'http':[{'url':'https://example.test/api','body':'kept'}],
                    'expected':{'result':{'body':'kept:11'},'events':{'requests':[{'method':method}]}}}
            with self.subTest(method=method):
                result = compare(source, output, 'loon', URL, case)
                self.assertEqual(result['status'], 'passed', result)

    def test_escaped_method_and_unknown_stored_request_are_rejected(self):
        for source in [
            'foreign($httpClient.get);$done({});',
            'const method=$httpClient.get;foreign(method);$done({});',
            'const method=$httpClient.get;method(JSON.parse($persistentStore.read("request")),(e,r,b)=>$done({body:b}));'
        ]:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                convert_script(source, 'Test', URL, '', source_format='loon')
