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

    def test_sequential_notification_url_fields_share_one_static_source(self):
        # 通知调用前按顺序写入的字段可静态装配；多平台同时写 url/open-url
        # 时，值必须来自同一字面量或同一未写入绑定，调用后的写入仍拒绝。
        sources = [
            ("var u='https://a.test',o={};o['open-url']=u,o.url=u,{call};$done({});", 'literal fields'),
            ("var u='https://a.test',a=u,b=u,o={};o.url=a,o['open-url']=b,{call};$done({});", 'shared binding'),
            ("var u='https://a.test',o={};$request.url&&(o.url=u),{call};$done({});", 'conditional field'),
        ]
        fixture = {'name':'sequential notification fields','request':{'url':URL},'expected':{'events':{'notifications':[
            {'title':'t','subtitle':'s','body':'b','action':{'type':'openUrl','url':'https://a.test'}},
        ]}}}
        for source_format, call in [('surge','$notification.post("t","s","b",o)'),
                                    ('loon','$notification.post("t","s","b",o)'),
                                    ('qx','$notify("t","s","b",o)')]:
            for template, name in sources:
                with self.subTest(source_format=source_format, name=name):
                    source=template.replace('{call}',call)
                    output=convert_script(source,'Fixture',URL,'',source_format=source_format)
                    result=compare(source,output,source_format,URL,fixture)
                    self.assertEqual(result['status'],'passed',result)
                    self.assertIn('.notify',output)

    def test_out_of_order_or_conflicting_notification_url_writes_still_reject(self):
        sources = [
            "var u='https://a.test',v='https://b.test',o={};o.url=u,o['open-url']=v,"
            "$notification.post('t','s','b',o);$done({});",
            "var u='https://a.test',o={};$notification.post('t','s','b',o),o.url=u;$done({});",
            "var u='https://a.test',o={};o[$argument]=u,$notification.post('t','s','b',o);$done({});",
        ]
        for source in sources:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                convert_script(source,'Fixture',URL,'',source_format='surge')


if __name__ == '__main__':
    unittest.main()
