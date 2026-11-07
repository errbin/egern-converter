import json
import tempfile
import unittest

from tools.egern_hub.js_analysis import analyze_many
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verification_probes import generated_cases, sample_text, sample_urls, skeleton, contexts_for
from tools.egern_hub.verify import verify_scripts
from unittest.mock import patch


class ProbeTests(unittest.TestCase):
    def test_replay_refuses_missing_or_invalid_request_urls(self):
        from tools.egern_hub.verify import replay_case
        case={'name':'missing account','generation':{},'request':{'url':'https://example.test/'}}
        for request in [{}, {'url':None}, {'url':''}, {'url':42}, None]:
            observed={'fixture_error':'Missing HTTP fixture',
                      'observation':{'events':{'requests':[request]}}}
            with self.subTest(request=request),patch('tools.egern_hub.verify.execute',return_value=observed):
                self.assertIsNone(replay_case('','loon','https://source.test/script.js',case))
        self.assertNotIn('http',case)

    def test_uninitialized_http_endpoint_remains_inconclusive(self):
        source='$httpClient.get({url:$persistentStore.read("endpoint")},()=>{$done({})});'
        script={'id':'missing','url':'https://source.test/missing.js','source_format':'loon',
                'verification_contexts':[{'stage':'schedule'}]}
        converted=convert_script(source,'Test',script['url'],'',source_format='loon')
        with tempfile.TemporaryDirectory() as temp:
            report=verify_scripts([script],{'missing':source},{'missing':converted})
        row=report['scripts']['missing']
        self.assertEqual(row['status'],'inconclusive')
        self.assertEqual(row['coverage']['effective'],0)

    def test_preserved_native_evaluation_does_not_enable_auto_probe_code_generation(self):
        source='const value=eval("1+1");$done({body:String(value)});'
        analysis=analyze_many([(source,'surge','{}')],mode='native')[0]
        script={'id':'native-eval','url':'https://source.test/native-eval.js','source_format':'surge',
                'entry_types':['schedule'],'verification_contexts':[{'stage':'schedule'}],
                'native_evaluation':analysis['native_evaluation']}
        converted=convert_script(source,'Test',script['url'],'',source_format='surge',_analysis=analysis)
        with tempfile.TemporaryDirectory() as temp:
            report=verify_scripts([script],{'native-eval':source},{'native-eval':converted})
        row=report['scripts']['native-eval']
        self.assertNotEqual(row['status'],'failed',row)
        self.assertTrue(row['cases'])
        self.assertTrue(all(case['status']=='inconclusive' for case in row['cases']),row)

    def test_regex_samples_match_branches_optional_scheme_and_arrays(self):
        urls=sample_urls(r'^https?:\/\/api\.example\.com\/(user|subscriptions)\/\d+$')
        self.assertTrue(urls)
        self.assertTrue(any('/user/' in url for url in urls))
        self.assertTrue(any('/subscriptions/' in url for url in urls))
        self.assertEqual(sample_urls('['),[])
        self.assertEqual(sample_text('(?:' * 20 + 'a' + '){8}' * 20),[])

    def test_ast_hints_build_nested_input_without_running_source(self):
        source='const body=JSON.parse($response.body);body.data.items.forEach(item=>{item.vip=true;});body.user.profile.name="x";$done({body:JSON.stringify(body)});'
        hint=analyze_many([(source,'any')],mode='probes')[0]
        value=skeleton(hint['paths'])
        self.assertIsInstance(value['data']['items'],list)
        self.assertFalse(value['data']['items'][0]['vip'])
        self.assertIn('profile',value['user'])
        self.assertNotIn('__proto__',skeleton([['__proto__','polluted']]))

    def test_real_request_stage_and_arguments_are_derived_from_module(self):
        contexts=contexts_for([{'script_map':{'https://source/demo.js':'demo'},'_render_obj':{'scriptings':[{'http_request':{'script_url':'https://source/demo.js','match':'^https://api.example.test/user','env':{'argument':'mode=all'}}}]}}])
        cases=generated_cases({'paths':[['user','vip']]},contexts['demo'])
        self.assertTrue(all('response' not in case for case in cases))
        self.assertEqual(cases[0]['argument'],'mode=all')
        self.assertTrue(cases[0]['generation']['url_matched'])
        self.assertFalse(generated_cases({},[])[0]['generation']['url_matched'])
        self.assertFalse(generated_cases({},[{'match':'['}])[0]['generation']['url_matched'])

    def test_non_http_probes_use_the_declared_entry_in_both_hosts(self):
        from tools.egern_hub.script_convert import convert_scripts
        for stage in ['schedule','generic','network']:
            source='if(typeof $request!=="undefined")$done({body:"request"});else $done({body:"task"});'
            script={'id':'task','url':'https://source.test/task.js','author':'Test','license_text':'',
                    'source_format':'loon','source':source,'entry_types':[stage],
                    'verification_contexts':[{'stage':stage}]}
            output=convert_scripts([script])['task']
            cases=generated_cases({},[{'stage':stage}])
            self.assertTrue(all(case['entry_type']==stage for case in cases))
            self.assertTrue(all('response' not in case for case in cases))
            with self.subTest(stage=stage),tempfile.TemporaryDirectory() as temp:
                report=verify_scripts([script],{'task':source},{'task':output})
                self.assertNotIn('failed',report['summary'])
                self.assertGreater(report['scripts']['task']['coverage']['effective'],0)

    def test_object_iteration_does_not_turn_objects_into_arrays(self):
        source='let obj=JSON.parse($response.body);for(const k in obj.result)delete obj.result[k];obj.result.isMember=true;$done({body:JSON.stringify(obj)});'
        hint=analyze_many([(source,'any')],mode='probes')[0]
        self.assertIsInstance(skeleton(hint['paths'])['result'],dict)

    def test_function_parameters_in_guards_and_nested_json_are_input_hints(self):
        source='const obj=JSON.parse($response.body);modify(obj.data);function modify(data){const p=data.config||data;if("openVideoVip" in p)p.openVideoVip="0";}JSON.parse(obj.saved);'
        hint=analyze_many([(source,'any')],mode='probes')[0]
        value=skeleton(hint['paths'],containers=hint['containers'],json_fields=hint['json_fields'])
        self.assertIn('openVideoVip',value['data']['config'])
        self.assertIsInstance(json.loads(value['saved']),dict)

    def test_literal_urls_and_html_guards_trigger_more_than_empty_json(self):
        source='if($request.url.includes("https://www.example.test")){};if($response.body.includes("<html"))$done({body:$response.body.replace(/"ad":true/g,"\\\"ad\\\":false")});'
        hint=analyze_many([(source,'any')],mode='probes')[0]
        cases=generated_cases(hint,[{'stage':'http_response','match':'https://www.example.test'}])
        self.assertEqual(cases[0]['request']['url'],'https://www.example.test')
        text=next(case['response']['body'] for case in cases if case['generation'].get('payload'))
        self.assertIn('<html',text)
        self.assertIn('"ad":true',text)

    def test_http_scripts_get_frozen_synthetic_replays_with_no_live_network(self):
        source='(async()=>{let a=await $task.fetch({url:"https://api.test/login"});let d=JSON.parse(a.body);let b=await $task.fetch({url:"https://api.test/user?token="+d.token});$done({body:b.body});})();'
        script={'id':'network','url':'https://source.test/demo.js','source_format':'qx',
                'verification_contexts':[{'stage':'http_response','match':'^https://api.example.test/user'}]}
        converted=convert_script(source,'Test',script['url'],'MIT',source_format='qx')
        with tempfile.TemporaryDirectory() as temp:
            report=verify_scripts([script],{'network':source},{'network':converted})
        row=report['scripts']['network']
        self.assertEqual(row['status'],'partial')
        self.assertTrue(any(case.get('generation',{}).get('payload')=='synthetic-http-replay' and case['status']=='passed' for case in row['cases']))
        self.assertGreater(row['coverage']['effective'],0)

    def test_unregistered_scripts_are_attempted_and_noops_are_not_functional_passes(self):
        scripts=[{'id':key,'url':'https://example.test/'+key+'.js','source_format':'surge',
                  'verification_contexts':[{'stage':'http_response','match':'^https://api.example.test/user'}]} for key in ['change','noop','error']]
        source={'change':'const body=JSON.parse($response.body);body.data.vip=true;$done({body:JSON.stringify(body)});',
                'noop':'$done({});','error':'throw Error("sample missing");$done({});'}
        generated={key:convert_script(code,'Test',scripts[i]['url'],'MIT') for i,(key,code) in enumerate(source.items())}
        with tempfile.TemporaryDirectory() as temp:
            report=verify_scripts(scripts,source,generated)
        self.assertEqual(report['summary'],{'probe_passed':1,'baseline_only':1,'inconclusive':1})
        self.assertTrue(all(row['coverage']['attempted']>0 for row in report['scripts'].values()))
        self.assertFalse(report['scripts']['change']['coverage']['complete_branch_coverage'])


if __name__=='__main__':unittest.main()
