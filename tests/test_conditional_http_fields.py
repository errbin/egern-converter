"""Conditional request-field overwrites read live values without replaying work."""
import unittest
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare
from tools.egern_hub.convert import ConversionError

URL='https://example.test/script.js'
class ConditionalHTTPFieldTests(unittest.TestCase):
    def test_branch_overwrites_existing_fields_and_evaluates_expressions_once(self):
        source="""let count=0;const opts={url:'https://example.test/original',body:'original',headers:{X:'original'}};
if($persistentStore.read('change')){opts.url='https://example.test/changed/'+(++count);opts.body='changed';opts.headers={X:'changed'}}
$httpClient.post(opts,(e,r,b)=>$done({body:b+':'+count}));"""
        output=convert_script(source,'Fixture',URL,'',source_format='loon')
        for changed in [False,True]:
            suffix='changed/1' if changed else 'original'
            case={'name':'conditional options','request':{'url':URL},'storage':{'change':'yes'} if changed else {},
                  'http':[{'url':'https://example.test/'+suffix,'body':'response'}],
                  'expected':{'result':{'body':'response:'+str(int(changed))},
                              'events':{'requests':[{'method':'POST','body':'changed' if changed else 'original','headers':{'x':'changed' if changed else 'original'}}]}}}
            result=compare(source,output,'loon',URL,case)
            self.assertEqual(result['status'],'passed',result)

    def test_value_dependent_flags_and_unknown_mutators_remain_rejected(self):
        cases=[
          "const o={url:'https://example.test/', 'auto-redirect':true};if($persistentStore.read('key'))o['auto-redirect']=false;$httpClient.get(o,(e,r,b)=>$done({body:b}));",
          "const o={url:'https://example.test/'};unknown(o);if($persistentStore.read('change'))o.url='https://example.test/changed';$httpClient.get(o,(e,r,b)=>$done({body:b}));",
        ]
        for source in cases:
            with self.subTest(source=source),self.assertRaises(ConversionError):convert_script(source,'Fixture',URL,'')

    def test_nullable_headers_are_omitted_and_header_expression_runs_once(self):
        for value in ['null','undefined',"({X:'present','Content-Length':'999'})"]:
            source="let reads=0;function headers(){reads++;return "+value+"}const o={url:'https://example.test/api',body:'sent',headers:headers()};$httpClient.post(o,(e,r,b)=>$done({body:b+':'+reads}));"
            output=convert_script(source,'Fixture',URL,'',source_format='loon')
            case={'name':'nullable headers','request':{'url':URL},
                  'http':[{'url':'https://example.test/api','body':'ok'}],
                  'expected':{'result':{'body':'ok:1'}}}
            result=compare(source,output,'loon',URL,case)
            self.assertEqual(result['status'],'passed',result)
