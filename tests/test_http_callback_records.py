"""Host response objects must not leak into authored callback data records."""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL = 'https://example.test/script.js'


class HTTPCallbackRecordTests(unittest.TestCase):
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
