"""Infer notification URL types only from closed constructor method calls."""
import unittest
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.convert import ConversionError
from tools.egern_hub.verify import compare

URL='https://example.test/notify.js'

class ConstructorNotificationTests(unittest.TestCase):
    def test_closed_method_urls_and_deferred_captured_values(self):
        source='const x=new E();const a="https://a.test",b="https://b.test";Promise.resolve().then(()=>{x.n(a);x.n(b);$done({})});function E(){this.n=url=>$notification.post("t","","",url)}'
        output=convert_script(source,'Fixture',URL,'',source_format='loon')
        fixture={'name':'closed URL calls','request':{'url':URL},'expected':{'events':{'notifications':[{'title':'t','subtitle':'','body':'','action':{'type':'openUrl','url':url}} for url in ['https://a.test','https://b.test']]}}}
        self.assertEqual(compare(source,output,'loon',URL,fixture)['status'],'passed')
        self.assertIn('ctx.notify',output)
        self.assertNotIn('$notification',output)

    def test_unknown_or_mutable_method_inputs_are_not_assumed_to_be_urls(self):
        sources=[
            'const x=new E();unknown(x);x.n("https://a.test");$done({});function E(){this.n=url=>$notification.post("t","","",url)}',
            'const x=new E();x.n("https://a.test");$done({});function E(){this.n=url=>$notification.post("t","","",url);return other}',
            'const x=new E();x.n("https://a.test");x.set();$done({});function E(){this.n=url=>$notification.post("t","","",url);this.set=()=>{this.n=unknown}}',
            'const x=new E();x.n("https://a.test");$done({});function E(){this.n=function(url){arguments[0]={"open-url":"https://b.test"};$notification.post("t","","",url)}}',
            'const x=new E();x.n(getOptions());$done({});function E(){this.n=url=>$notification.post("t","","",url)}',
        ]
        for source in sources:
            with self.subTest(source=source),self.assertRaises(ConversionError):
                convert_script(source,'Fixture',URL,'',source_format='loon')
