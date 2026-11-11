"""封闭通知构造器的本地别名与默认实参保留字段证明。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL = 'https://example.test/notification-builder.js'


class NotificationBuilderAliasTests(unittest.TestCase):
    def test_object_assign_builder_maps_closed_auto_dismiss_for_both_receivers(self):
        template = '''function build(input={}){const out={};Object.assign(out,{url:input.url});Object.assign(out,{"auto-dismiss":input["auto-dismiss"],sound:input.sound});return out}
const options=build({url:"https://a.test","auto-dismiss":true,sound:true});
{call};$done({{}});'''
        fixture = {'name':'closed notification builder','request':{'url':URL},'expected':{'events':{'notifications':[
            {'title':'t','subtitle':'','body':'','action':{'type':'openUrl','url':'https://a.test'},'sound':True,'duration':10},
        ]}}}
        for source_format, call in [('surge','$notification.post("t","","",options)'),('loon','$notification.post("t","","",options)'),('qx','$notify("t","","",options)')]:
            with self.subTest(source_format=source_format):
                program=template.replace('{call}',call).replace('{{}}','{}')
                output=convert_script(program,'Fixture',URL,'',source_format=source_format)
                result=compare(program,output,source_format,URL,fixture)
                self.assertEqual(result['status'],'passed',result)
                self.assertIn('.notify',output)
                self.assertIn('duration',output)

    def test_literal_auto_dismiss_seconds_map_to_native_duration(self):
        source='$notification.post("t","","",{url:"https://a.test","auto-dismiss":3,sound:false});$done({});'
        output=convert_script(source,'Fixture',URL,'',source_format='surge')
        fixture={'name':'literal auto dismiss','request':{'url':URL},'expected':{'events':{'notifications':[
            {'title':'t','subtitle':'','body':'','action':{'type':'openUrl','url':'https://a.test'},'sound':False,'duration':3},
        ]}}}
        result=compare(source,output,'surge',URL,fixture)
        self.assertEqual(result['status'],'passed',result)
        self.assertIn('duration:',output)

    def test_notify_value_escape_still_rejects(self):
        for source in ['const notify=$notify;notify("t","","");$done({});',
                       'unknown($notify);$done({});']:
            with self.subTest(source=source),self.assertRaises(ConversionError):
                convert_script(source,'Fixture',URL,'',source_format='qx')

    def test_immutable_alias_and_default_argument_keep_notification_shape(self):
        source = '''function build(options={}){const out={};if(options.url)out.url=options.url;return out}
function notify(options={}){const value=build(options);JSON.stringify(value);$notification.post("t","","",value)}
notify();notify({url:"https://a.test"});$done({});'''
        output = convert_script(source, 'Fixture', URL, '', source_format='loon')
        fixture = {'name':'notification builder alias','request':{'url':URL},'expected':{'events':{'notifications':[
            {'title':'t','subtitle':'','body':''},
            {'title':'t','subtitle':'','body':'','action':{'type':'openUrl','url':'https://a.test'}},
        ]}}}
        result = compare(source, output, 'loon', URL, fixture)
        self.assertEqual(result['status'], 'passed', result)
        self.assertIn('.notify', output)
        self.assertNotIn('$notification', output)

    def test_alias_escape_mutation_or_unknown_default_still_rejects(self):
        sources = [
            '''function build(options={}){const out={};if(options.url)out.url=options.url;return out}
function notify(options={}){const value=build(options);unknown(value);$notification.post("t","","",value)}
notify({url:"https://a.test"});$done({});''',
            '''function build(options={}){const out={};if(options.url)out.url=options.url;return out}
function notify(options={}){const value=build(options);value.url="https://b.test";$notification.post("t","","",value)}
notify({url:"https://a.test"});$done({});''',
            '''function build(options=unknown()){return options}
function notify(options=unknown()){const value=build(options);$notification.post("t","","",value)}
notify();$done({});''',
        ]
        for source in sources:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '', source_format='loon')


if __name__ == '__main__':
    unittest.main()
