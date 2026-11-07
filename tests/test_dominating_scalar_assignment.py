"""A proven local reassignment can refine an initially unknown JSON field."""
import unittest
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.convert import ConversionError
from tools.egern_hub.verify import compare

URL='https://example.test/assigned.js'
class DominatingScalarAssignmentTests(unittest.TestCase):
    def test_numeric_branch_assignment_keeps_basic_javascript(self):
        source='function change(data){let value=data.unknown;if(value<10){value=10+Math.ceil(Math.random()*2);data.unknown=value.toString()}return JSON.stringify(data)}$done({body:change(JSON.parse($request.body))});'
        output=convert_script(source,'Fixture',URL,'',source_format='loon')
        for value in [1,20]:
            fixture={'name':str(value),'request':{'url':URL,'body':'{"unknown":'+str(value)+'}'}}
            result=compare(source,output,'loon',URL,fixture)
            self.assertEqual(result['status'],'passed',result)

    def test_string_assignment_dominates_only_the_same_block(self):
        source='function change(input){let value=input;value="fixture";return value.toString()}$done({body:change($argument)});'
        output=convert_script(source,'Fixture',URL,'',source_format='loon')
        result=compare(source,output,'loon',URL,{'name':'string assignment','request':{'url':URL},'expected':{'result':{'body':'fixture'}}})
        self.assertEqual(result['status'],'passed',result)

    def test_conditional_writes_captures_and_source_eval_do_not_acquire_proofs(self):
        for body in [
            'let value=input;value=1;if(input)value=unknown();return value.toString()',
            'let value=input;if(input)value=1;return value.toString()',
            'let value=input;function change(){value=unknown()}value=1;change();return value.toString()',
            'let value=input;value=1;return (value=unknown(),value.toString())',
        ]:
            with self.subTest(body=body),self.assertRaises(ConversionError):
                convert_script('function f(input){'+body+'}$done({body:f($argument)});','Fixture',URL,'',source_format='loon')

    def test_original_health_request_body_keeps_numeric_updates(self):
        from pathlib import Path
        source_path=Path(__file__).resolve().parents[1]/'sources/iepngs/Script/master/lxhealth/manual.js'
        if not source_path.is_file():self.skipTest('Requires cached source')
        source=source_path.read_text()
        output=convert_script(source,'iepngs',URL,'',source_format='loon')
        for body in ['{"list":[{"step":1,"calories":"0","distance":"0"}]}','{"list":[{"step":20000}]}','invalid JSON']:
            result=compare(source,output,'loon',URL,{'name':'health request body','request':{'url':URL,'body':body}})
            self.assertEqual(result['status'],'passed',result)
