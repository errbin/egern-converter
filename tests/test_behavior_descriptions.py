from pathlib import Path
import tempfile
import unittest

from tools.egern_hub.behavior_descriptions import apply_behavior_descriptions, configuration_summary, script_summary
from tools.egern_hub.js_analysis import analyze_many


class BehaviorDescriptionTests(unittest.TestCase):
    def analyze(self, source):
        return analyze_many([(source, 'any')], mode='behavior')[0]

    def test_tracks_returned_json_aliases_and_object_assign_with_line_evidence(self):
        source = '''const value=JSON.parse($response.body);
const alias=value;
Object.assign(alias.data,{is_vip:true,expires_at:"2099-01-01"});
const unused={ads:[],admin:true};
$done({body:JSON.stringify(value)});'''
        result = self.analyze(source)
        self.assertEqual(result['fields'], ['expires_at', 'is_vip'])
        self.assertTrue(any(e['line']==3 and e.get('field')=='is_vip' for e in result['evidence']))
        description = '；'.join(script_summary([result], {'http_response'}))
        self.assertIn('会员状态', description)
        self.assertIn('到期时间', description)
        self.assertNotIn('广告', description)
        self.assertNotIn('解锁', description)

    def test_replacement_filters_and_deleted_fields_are_output_related(self):
        source = '''let obj=JSON.parse($response.body);
obj.items=obj.items.filter(x=>x.kind!=="ad");
delete obj.banner;
let body=JSON.stringify(obj).replace(/"premium":false/g,'"premium":true');
$done({body});'''
        result = self.analyze(source)
        self.assertIn('array_filter', result['effects'])
        self.assertIn('body_delete', result['effects'])
        self.assertIn('premium', result['fields'])
        self.assertIn('banner', result['fields'])
        self.assertIn('过滤返回数组', '；'.join(script_summary([result], {'http_response'})))

    def test_unrelated_objects_comments_strings_shadowed_apis_and_uncalled_helpers_ignored(self):
        source = '''// $notification.post("fake");
const text='$prefs.setValueForKey("fake")';
const unused={is_vip:true,expires_date:"2099"};
function neverCalled(){$notification.post("dead");$done({body:JSON.stringify(unused)});}
function local($notification){$notification.post("local");}
local({post(){}});
const obj=JSON.parse($response.body);
$done({body:JSON.stringify(obj)});'''
        result = self.analyze(source)
        self.assertEqual(result['fields'], [])
        self.assertNotIn('notification', result['effects'])
        self.assertEqual(script_summary([result], {'http_response'}), ['重新序列化响应 JSON 正文'])

    def test_native_entry_point_and_literal_receipt_payload(self):
        result = self.analyze('export default async (ctx)=>{const obj=await ctx.response.json();obj.receipt={in_app:[{expires_date:"2099",product_id:"year"}]};return {body:JSON.stringify(obj)};}')
        self.assertIn('read_response.body', result['effects'])
        self.assertIn('receipt', result['fields'])
        description = '；'.join(script_summary([result], {'http_response'}))
        for word in ['订阅权益', '订阅回执', '到期时间']:
            self.assertIn(word, description)

    def test_storage_notification_http_and_header_mutation(self):
        result = self.analyze('''const h=$request.headers;
delete h.authorization;
$persistentStore.write("value","key");
$notification.post("title");
$httpClient.get("https://example.com",()=>{$done({headers:h,url:"https://other.example"});});''')
        for effect in ['storage_write', 'network', 'notification', 'headers_write', 'url_write']:
            self.assertIn(effect, result['effects'])
        self.assertNotIn('body_fields', result['effects'])

    def test_dynamic_or_invalid_code_is_never_executed_or_guessed(self):
        result = self.analyze('const code="process.exit(12)";$done({body:eval(code)});')
        self.assertTrue(result['limits'])
        self.assertFalse(result['fields'])
        result = self.analyze('this is not javascript !')
        self.assertIn('语法无法静态解析', result['limits'][0])
        self.assertEqual(result['effects'], [])

    def test_configuration_only_module_summary_and_rewrite_counts(self):
        parts, facts = configuration_summary({'url_rewrites':[
            {'match':'^https://ad/', 'location':'http://reject-dict/'},
            {'match':'^https://old/', 'location':'https://new/'}],
            'map_locals':[{'match':'^https://local/'}]}, 'modules')
        self.assertEqual(facts['url_rewrites'], {'reject':1, 'rewrite':1})
        self.assertIn('拦截 1 条', parts[0])
        self.assertIn('返回预设的本地响应', parts[-1])

    def test_fallback_only_and_native_bytes_are_preserved(self):
        raw='name: Native\r\nscriptings:\r\n- http_response:\r\n    script_url: https://example/demo.js\r\n'
        native={'id':'native','kind':'modules','format':'egern','url':'https://example/native.yaml',
            '_render_obj':{'scriptings':[{'http_response':{'script_url':'https://example/demo.js'}}]},
            '_description_result':{'description':'','source':'none'},
            '_behavior_inputs':[('https://example/demo.js', '$done({body:JSON.stringify({premium:true})});')]}
        manual={'id':'upstream','kind':'modules','format':'derived','_description_result':{'description':'原作者说明','source':'module'}}
        resources=[{'description':'','yaml':raw}, {'description':'原作者说明','yaml':'unchanged'}]
        with tempfile.TemporaryDirectory() as temp:
            apply_behavior_descriptions(Path(temp), resources, [native,manual], [], {})
        self.assertNotIn('自动分析：', resources[0]['description'])
        self.assertIn('会员状态', resources[0]['description'])
        self.assertEqual(resources[0]['yaml'], raw)
        self.assertEqual(resources[1], {'description':'原作者说明','yaml':'unchanged'})
        report=native['_description_result']
        self.assertEqual(report['source'], 'behavior')
        self.assertEqual(report['scripts'][0]['url'], 'https://example/demo.js')

    def test_unknown_output_has_stage_summary_instead_of_empty_or_invented_claim(self):
        source={'id':'unknown','kind':'modules','format':'egern','_render_obj':{'scriptings':[{'http_request':{}}]},
                '_description_result':{'description':'','source':'none'}}
        resource={'description':'','yaml':'native'}
        with tempfile.TemporaryDirectory() as temp:
            apply_behavior_descriptions(Path(temp), [resource], [source], [], {})
        self.assertIn('请求阶段', resource['description'])
        self.assertIn('未确定', resource['description'])
        self.assertTrue(source['_description_result']['limited'])


if __name__=='__main__':
    unittest.main()
