import unittest

from tools.egern_hub.js_analysis import validate_generated
from tools.egern_hub.script_convert import convert_scripts


class ScheduleCompletionTests(unittest.TestCase):
    def convert(self, entry_type, source='console.log("scheduled");'):
        errors = {}
        generated = convert_scripts([{
            'id': 'fixture',
            'url': 'https://example.test/task.js',
            'source': source,
            'source_format': 'loon',
            'entry_types': [entry_type],
            'author': 'Fixture',
            'license_text': '',
        }], errors=errors)
        return generated, errors

    def test_schedule_can_finish_without_a_response_value(self):
        generated, errors = self.convert('schedule')
        self.assertEqual(errors, {})
        code = generated['fixture']
        self.assertIn('console.log("scheduled")', code)
        self.assertNotIn('Script ended without a completion result', code)
        validate_generated(generated)

    def test_schedule_preserves_done_payload_and_its_evaluation(self):
        generated, errors = self.convert('schedule', '$done({body: sideEffect()});')
        self.assertEqual(errors, {})
        code = generated['fixture']
        self.assertIn('body:sideEffect()', code)
        self.assertNotIn('ctx.respond(', code)
        validate_generated(generated)

    def test_custom_panel_result_keeps_fields_and_read_only_observations(self):
        from tools.egern_hub.verify import compare
        source="""const panel={title:'public',content:'fixture',icon:'test',backgroundColor:'#123456'};
console.log(panel);function finish(value={}){$done(value)}finish(panel);"""
        generated,errors=self.convert('schedule',source)
        self.assertEqual(errors,{})
        result=compare(source,generated['fixture'],'loon','https://example.test/task.js',
                       {'name':'panel return','entry_type':'schedule','request':{'url':'https://example.test/'},
                        'expected':{'result':{'title':'public','content':'fixture','icon':'test','backgroundColor':'#123456'}}})
        self.assertEqual(result['status'],'passed',result)

    def test_detached_native_catch_callbacks_keep_launch_order_and_first_completion(self):
        from tools.egern_hub.verify import compare
        source="""async function run(title,delay){await new Promise(resolve=>setTimeout(resolve,delay));$done({title,content:'native'})}
run('first',10).catch(console.error);run('second',20).catch('ignored '+$argument);
$persistentStore.write('launched','phase');"""
        generated,errors=self.convert('schedule',source)
        self.assertEqual(errors,{})
        result=compare(source,generated['fixture'],'loon','https://example.test/task.js',
                       {'name':'concurrent native callbacks','entry_type':'schedule','event_loop':True,
                        'request':{'url':'https://example.test/'},
                        'expected':{'result':{'title':'first','content':'native'},'storage':{'phase':'launched'}}})
        self.assertEqual(result['status'],'passed',result)

    def test_request_entry_still_requires_a_completion_value(self):
        generated, errors = self.convert('http_request')
        self.assertEqual(generated, {})
        self.assertIn('没有可识别的 $done 完成入口', errors['fixture'])


if __name__ == '__main__':
    unittest.main()
