"""条件接收者只能用静态平台选择与闭合观察函数证明。"""
import unittest
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare
from tools.egern_hub.convert import ConversionError
URL='https://example.test/conditional-receiver.js'

class ConditionalPlatformReceiverTests(unittest.TestCase):
    def check(self,source,fmt,expected_body='ok'):
        output=convert_script(source,'Fixture',URL,'',source_format=fmt)
        self.assertNotIn('$notify',output)
        self.assertNotIn('$notification',output)
        self.assertIn('ctx.notify',output)
        case={'name':'conditional platform receiver','request':{'url':URL},
              'expected':{'result':{'body':expected_body},
                          'events':{'notifications':[{'title':'t'}]}}}
        result=compare(source,output,fmt,URL,case)
        self.assertEqual(result['status'],'passed',result)

    def test_qx_alias_selected_by_closed_observers_is_directly_dispatched(self):
        self.check(
            "var h={neq:function(a,b){return a!==b}},E;"
            "(h.neq(null,E=$notify)&&h.neq(void 0,E)?E:$request.url)"
            "('t','s','b',{});$done({body:'ok'});",
            'qx'
        )

    def test_non_qx_notification_branch_is_selected_without_guessing(self):
        self.check(
            "var h={neq:function(a,b){return a!==b}};"
            "(typeof $notify!=='undefined'&&h.neq(void 0,$notify)?$notify:$notification.post)"
            "('t','s','b',{});$done({body:'ok'});",
            'surge'
        )

    def test_unresolved_non_qx_branch_stays_rejected(self):
        source=("var h={neq:function(a,b){return a!==b}},E;"
                "(h.neq(null,E=$notify)&&h.neq(void 0,E)?E:$request.url)"
                "('t','s','b',{});$done({body:'ok'});")
        with self.assertRaisesRegex(ConversionError,'平台 API 作为值传递'):
            convert_script(source,'Fixture',URL,'',source_format='surge')

    def test_effectful_or_escaping_selector_is_rejected(self):
        for source in [
            "var calls=0,h={neq:function(a,b){calls++;return a!==b}},E;"
            "(h.neq(null,E=$notify)&&h.neq(void 0,E)?E:$notification.post)"
            "('t','s','b',{});$done({body:'ok'});",
            "var h={neq:function(a,b){return a!==b}},E;"
            "(h.neq(null,E=$notify)&&unknown(E)?E:$notification.post)"
            "('t','s','b',{});$done({body:'ok'});",
            "var h={neq:function(a,b){return a!==b},mutate:function(){h.neq=null}},E;"
            "(h.neq(null,E=$notify)?E:$notification.post)('t','s','b',{});$done({body:'ok'});",
            "var hits=0,h={neq:function(a,b){return a!==b},toString:function(){hits++;return ''}},E;"
            "''.concat(h);(h.neq(null,E=$notify)?E:$notification.post)('t','s','b',{});$done({body:'ok'});",
        ]:
            with self.subTest(source=source),self.assertRaises(ConversionError):
                convert_script(source,'Fixture',URL,'',source_format='qx')

    def test_selector_aliases_cannot_escape_the_receiver(self):
        source=("var h={neq:function(a,b){return a!==b}},E;"
                "(h.neq(null,E=$notify)?E:$notification.post)('t','s','b',{});"
                "$done({body:E});")
        with self.assertRaises(ConversionError):
            convert_script(source,'Fixture',URL,'',source_format='qx')

    def test_spread_arguments_stay_rejected(self):
        source=("var h={neq:function(a,b){return a!==b}},E;"
                "(h.neq(null,E=$notify)?E:$notification.post)(...['t','s','b']);"
                "$done({body:'ok'});")
        with self.assertRaises(ConversionError):
            convert_script(source,'Fixture',URL,'',source_format='qx')

if __name__=='__main__':
    unittest.main()
