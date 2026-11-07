"""Request fields follow authored branch and sloppy-global assignments."""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL='https://example.test/record.js'


class HTTPRecordAssignmentTests(unittest.TestCase):
    def check(self,source,argument,expected):
        output=convert_script(source,'Fixture',URL,'',source_format='loon')
        case={'name':'live request record','argument':argument,'request':{'url':URL},
              'http':[{'url':'https://example.test/'+expected,'body':'ok'}],
              'expected':{'result':{'body':'ok'}}}
        result=compare(source,output,'loon',URL,case)
        self.assertEqual(result['status'],'passed',result)

    def test_local_branch_assignment_and_header_deletion_preserve_selected_record(self):
        source='''let options=null;
if($argument==='a'){options={url:'https://example.test/a',headers:{Cookie:'fixture',X:'a'}};delete options.headers.Cookie}
else{options={url:'https://example.test/b',headers:{X:'b'}}}
$httpClient.get(options,(e,r,b)=>$done({body:b}));'''
        for argument in ['a','b']:self.check(source,argument,argument)

    def test_sloppy_global_request_retains_url_appends_before_call(self):
        source='''url={url:'https://example.test/',headers:{X:'fixture'}};
if($argument==='stop')return $done({});
url.url+='record';$httpClient.get(url,(e,r,b)=>$done({body:b}));'''
        self.check(source,'continue','record')

    def test_external_call_or_await_between_global_write_and_request_invalidates_shape(self):
        for operation in ['foreign();','await Promise.resolve();']:
            source="url={url:'https://example.test/a'};"+operation+'$httpClient.get(url,(e,r,b)=>$done({body:b}));'
            with self.subTest(operation=operation),self.assertRaises(ConversionError):
                convert_script(source,'Fixture',URL,'',source_format='loon')

    def test_transport_flags_require_same_value_in_every_branch(self):
        source='''let options=null;if($argument){options={url:'https://example.test/a','binary-mode':true}}
else{options={url:'https://example.test/a','binary-mode':false}}$httpClient.get(options,(e,r,b)=>$done({body:b}));'''
        with self.assertRaises(ConversionError):convert_script(source,'Fixture',URL,'',source_format='loon')
