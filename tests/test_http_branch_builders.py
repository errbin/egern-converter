"""Project live request fields only after all reaching branches assign a URL."""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL = 'https://example.test/source.js'


class HTTPBranchBuilderTests(unittest.TestCase):
    def check(self, source, changed, endpoint, text):
        output = convert_script(source, 'Fixture', URL, '', source_format='loon')
        case = {'name': 'branch request builder', 'request': {'url': URL},
                'storage': {'branch': 'yes'} if changed else {},
                'http': [{'url': endpoint, 'body': 'reply'}],
                'expected': {'result': {'body': text},
                             'events': {'requests': [{'url': endpoint}]}}}
        result = compare(source, output, 'loon', URL, case)
        self.assertEqual(result['status'], 'passed', result)

    def test_url_assigned_in_both_branches_and_optional_headers(self):
        source = '''const branch=!!$persistentStore.read('branch');let calls=0;
const options={};
if(branch){options.url='https://example.test/first/'+(++calls)}
else {options.url='https://example.test/second/'+(++calls)}
if(branch)options.headers={X:'first'};
$httpClient.get(options,(e,r,b)=>$done({body:b+':'+calls}));'''
        for changed in [False, True]:
            self.check(source, changed, 'https://example.test/'+('first' if changed else 'second')+'/1', 'reply:1')

    def test_conditional_records_returned_from_factory_keep_live_overwrite(self):
        source = '''const branch=!!$persistentStore.read('branch');let calls=0;
function build(){let options=branch?{url:'https://example.test/first',headers:{X:'first'}}:{url:'https://example.test/second'};
if(branch)options.url=options.url+'?changed='+(++calls);return options}
function send(options,callback){$httpClient.get(options,(e,r,b)=>callback(e,r,b))}
const options=build();send(options,(e,r,b)=>$done({body:b+':'+calls}));'''
        for changed in [False, True]:
            self.check(source, changed, 'https://example.test/first?changed=1' if changed else 'https://example.test/second', 'reply:'+str(int(changed)))

    def test_partial_or_loop_assignment_and_conflicting_flags_remain_rejected(self):
        for builder in [
            "if(branch)options.url='https://example.test/first';",
            "if(branch){if(other)options.url='https://example.test/first';else options.url='https://example.test/second'}",
            "while(branch){options.url='https://example.test/first';break}",
        ]:
            source = "const branch=!!$persistentStore.read('branch'),other=!!$persistentStore.read('other');const options={};"+builder+"$httpClient.get(options,(e,r,b)=>$done({body:b}));"
            with self.subTest(builder=builder), self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '')
        source = '''const branch=!!$persistentStore.read('branch');
const options=branch?{url:'https://example.test/', 'auto-redirect':true}:{url:'https://example.test/', 'auto-redirect':false};
$httpClient.get(options,(e,r,b)=>$done({body:b}));'''
        with self.assertRaises(ConversionError):
            convert_script(source, 'Fixture', URL, '')
