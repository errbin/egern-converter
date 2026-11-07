"""Closed object-returning SDK factories can acquire ordinary data fields."""
import json,subprocess,unittest
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL='https://example.test/factory.js'
class LegacyFactoryStateTests(unittest.TestCase):
    def lower(self,source):
        code="import {lowerLegacyFactories} from './tools/js-analysis/transforms/factories.mjs';import {readFileSync} from 'node:fs';process.stdout.write(lowerLegacyFactories(readFileSync(0,'utf8')));"
        return subprocess.run(['node','--input-type=module','-e',code],input=source,text=True,capture_output=True,check=True).stdout

    def test_literal_probe_fields_preserve_closed_completion_and_initializer_order(self):
        source="""let calls=0;const sdk=create();
        sdk.finish(String(sdk.enabled)+':'+sdk.label+':'+calls);
        function create(){const init=(calls++,'init');const finish=body=>$done({body});
        return {enabled:false,label:'fixture',finish}}"""
        output=convert_script(source,'Fixture',URL,'')
        result=compare(source,output,'surge',URL,{'name':'literal probe fields',
            'request':{'url':URL},'expected':{'result':{'body':'false:fixture:1'}}})
        self.assertEqual(result['status'],'passed',result)
        self.assertNotIn('sdk.',self.lower(source))

    def test_extra_state_keeps_updates_reads_and_internal_capture_separate(self):
        source='const sdk=create();sdk.count=2;sdk.count++;sdk.label="fixture";sdk.finish(sdk.label+":"+sdk.count+":"+sdk.initial());function create(){const count="internal";const initial=()=>count;const finish=body=>$done({body});return {initial,finish}}'
        native=convert_script(source,'Fixture',URL,'')
        result=compare(source,native,'surge',URL,{'name':'extra singleton state','request':{'url':URL},'expected':{'result':{'body':'fixture:3:internal'}}})
        self.assertEqual(result['status'],'passed',result)
        self.assertNotIn('sdk.',self.lower(source))

    def test_missing_state_initially_reads_undefined_and_preserves_initializer_effects(self):
        source='let calls=0;const sdk=create();sdk.finish(String(sdk.missing)+":"+calls);function create(){const init=(calls++,"value");const finish=body=>$done({body});return {finish}}'
        native=convert_script(source,'Fixture',URL,'')
        result=compare(source,native,'surge',URL,{'name':'uninitialized singleton state','request':{'url':URL},'expected':{'result':{'body':'undefined:1'}}})
        self.assertEqual(result['status'],'passed',result)

    def test_mutations_deletion_inherited_fields_and_escape_do_not_flatten(self):
        factory='function create(){const finish=body=>$done({body});return {finish}}'
        for business in ['sdk.finish=foreign;sdk.finish("x");','delete sdk.extra;sdk.finish("x");',
                         'sdk.toString();sdk.finish("x");','unknown(sdk);sdk.finish("x");',
                         'Object.prototype.extra=1;sdk.finish(String(sdk.extra));',
                         'sdk.extra=1;eval("sdk.extra=2");sdk.finish(String(sdk.extra));']:
            source='const sdk=create();'+business+factory
            with self.subTest(business=business):self.assertIn('sdk.',self.lower(source))

    def test_data_fields_do_not_need_publication_or_a_named_author_rule(self):
        first='const sdk=create();sdk.extra=1;sdk.finish();function create(){const finish=()=>$done({});return {finish}}'
        self.assertNotIn('sdk.extra',self.lower(first))
        second=first.replace('sdk','client').replace('create','factory').replace('finish','complete').replace('extra','count')
        self.assertNotIn('client.count',self.lower(second))
