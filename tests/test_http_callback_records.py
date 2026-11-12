"""Host response objects must not leak into authored callback data records."""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL = 'https://example.test/script.js'


class HTTPCallbackRecordTests(unittest.TestCase):
    @staticmethod
    def forwarded_record_source(tail):
        return ('''const method=$argument==='post'?$httpClient.post:$httpClient.get;
function send(fn,options,callback){return fn(options,callback)}
new Promise((resolve,reject)=>{send(method,{url:'https://api.test/'},(error,response,body)=>{
if(error)return reject(error);const result={};result.response=response;result.body=body;'''
                + tail + '''});}).then(result=>{result.response;$done({body:result.body});});''')

    def test_forwarded_method_rechecks_closed_record_at_consumer(self):
        source=self.forwarded_record_source('resolve(result);')
        output=convert_script(source,'Fixture',URL,'',source_format='loon')
        result=compare(source,output,'loon',URL,{
            'name':'forwarded closed response wrapper','argument':'get',
            'request':{'url':URL},
            'http':[{'url':'https://api.test/','body':'payload','status':202}],
            'expected':{'result':{'body':'payload'}}})
        self.assertEqual(result['status'],'passed',result)

    def test_forwarded_record_escape_projection_or_dynamic_read_is_rejected(self):
        for tail in [
            'unknown(result);resolve(result);',
            'resolve(result);});}).then(result=>{$done({body:result.response.body});',
            'resolve(result);});}).then(result=>{$done({body:result.response[$argument]});',
        ]:
            with self.subTest(tail=tail),self.assertRaises(ConversionError):
                convert_script(self.forwarded_record_source(tail),'Fixture',URL,'',source_format='loon')

    def test_closed_promise_wrapper_may_observe_an_unused_response_key(self):
        direct="new Promise(resolve=>{$httpClient.get({url:'https://api.test/'},(error,response,body)=>{if(error)return;const result={};result.response=response;result.body=body;resolve(result);});}).then(result=>{result.response;$done({body:result.body});});"
        helper="function forward(resolve,value){return resolve(value)}"+direct.replace('resolve(result);','forward(resolve,result);')
        literal="new Promise(resolve=>{$httpClient.get({url:'https://api.test/'},(error,response,body)=>{if(error)return;resolve({response,body});});}).then(result=>{result.response;$done({body:result.body});});"
        status=literal.replace('$done({body:result.body});','$done({body:result.response.status+":"+result.body});')
        for source,expected in [(direct,'payload'),(helper,'payload'),(literal,'payload'),(status,'202:payload')]:
            with self.subTest(source=source):
                output=convert_script(source,'Fixture',URL,'',source_format='loon')
                result=compare(source,output,'loon',URL,{
                    'name':'closed response wrapper','request':{'url':URL},
                    'http':[{'url':'https://api.test/','body':'payload','status':202}],
                    'expected':{'result':{'body':expected}}})
                self.assertEqual(result['status'],'passed',result)

    def test_wrapped_response_field_reads_and_record_escape_are_rejected(self):
        prefix="new Promise(resolve=>{$httpClient.get({url:'https://api.test/'},(error,response,body)=>{if(error)return;"
        for tail in [
            "const result={};result.response=response;result.body=body;resolve(result);});}).then(result=>{$done({body:result.response.body});});",
            "const result={};result.response=response;result.body=body;unknown(result);resolve(result);});}).then(result=>{result.response;$done({body:result.body});});",
            "resolve({response,body});});}).then(result=>{$done({body:unknown(result.response)});});",
            "resolve({response,body});});}).then(result=>{const alias=result.response;$done({body:result.body});});",
        ]:
            with self.subTest(tail=tail),self.assertRaises(ConversionError):
                convert_script(prefix+tail,'Fixture',URL,'',source_format='loon')

    def test_serialization_and_template_logging_keep_the_callback_record(self):
        for value in ['JSON.stringify(r)', '`response: ${r}`']:
            for wrap in [False, True]:
                callback = '(e,r,b)=>{$done({body:VALUE})}'.replace('VALUE', value)
                source = '$httpClient.get("https://api.test/", CALLBACK);'.replace('CALLBACK', callback)
                if wrap:
                    source = '''(async()=>{const result=await new Promise(resolve=>{
$httpClient.get('https://api.test/',(e,r,b)=>resolve(VALUE));
});$done({body:result})})();'''.replace('VALUE', value)
                output = convert_script(source, 'Fixture', URL, '', source_format='loon')
                for reply in [
                    {'body':'ok','status':201,'headers':{'set-cookie':['a=1','b=2'],'x-fixture':'yes'}},
                    {'error':'offline'},
                ]:
                    result = compare(source, output, 'loon', URL, {
                        'name':'HTTP callback record', 'request':{'url':URL},
                        'http':[{'url':'https://api.test/', **reply}]})
                    self.assertEqual(result['status'], 'passed', result)

    def test_full_header_record_and_authored_body_mutation_are_preserved(self):
        source = '''$httpClient.get({url:'https://api.test/','full-header-mode':true},(e,r,b)=>{
if(r){r.body=b;r.statusCode=r.status}
$done({body:JSON.stringify(r)});
});'''
        output = convert_script(source, 'Fixture', URL, '', source_format='loon')
        for reply in [
            {'body':'ok','status':202,'headers':{'set-cookie':['a=1','b=2'],'x-fixture':'yes'}},
            {'error':'offline'},
        ]:
            result = compare(source, output, 'loon', URL, {
                'name':'full header callback record', 'request':{'url':URL},
                'http':[{'url':'https://api.test/', **reply}]})
            self.assertEqual(result['status'], 'passed', result)

    def test_unknown_response_fields_and_unknown_consumers_are_rejected(self):
        for usage in ['r.unknown', 'foreign(r)', 'r.toString=()=>"changed"']:
            with self.subTest(usage=usage), self.assertRaises(ConversionError):
                convert_script('$httpClient.get("https://api.test/",(e,r,b)=>{' + usage + ';$done({});});',
                               'Fixture', URL, '', source_format='loon')
