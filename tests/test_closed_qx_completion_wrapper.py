"""QX 闭合完成包装、存储门面和同值通知 URL 的投影边界。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL = 'https://example.test/qx-wrapper.js'


class ClosedQxCompletionWrapperTests(unittest.TestCase):
    def convert(self, source):
        return convert_script(source, 'Fixture', URL, '', source_format='qx')

    def check(self, source, body='ok'):
        output = self.convert(source)
        fixture = {'name': 'closed qx completion wrapper', 'request': {'url': URL},
                   'expected': {'result': {'body': body}}}
        result = compare(source, output, 'qx', URL, fixture)
        self.assertEqual(result['status'], 'passed', result)
        return output

    def test_qx_identity_completion_wrapper_is_removed(self):
        source = ("const $origDone=$done;"
                  "$done=(obj={})=>{this.$prefs||(obj.status=1);$origDone(obj);};"
                  "$done({body:'ok'});")
        output = self.check(source)
        self.assertNotIn('$origDone', output)
        self.assertNotIn('obj.status', output)

    def test_qx_wrapper_default_argument_keeps_object_payload(self):
        source = ("const $origDone=$done;"
                  "$done=(obj={})=>{this.$prefs||(obj.status=1);$origDone(obj);};"
                  "$done();")
        output = self.convert(source)
        self.assertNotIn('$origDone', output)
        fixture = {'name': 'closed qx completion wrapper default', 'request': {'url': URL}}
        result = compare(source, output, 'qx', URL, fixture)
        self.assertEqual(result['status'], 'passed', result)

    def test_qx_completion_wrapper_rejects_payload_parameter_and_call_changes(self):
        variants = [
            ("const $origDone=$done;"
             "$done=(obj={})=>{obj.body='bad';$origDone(obj);};$done({body:'ok'});"),
            ("const $origDone=$done;"
             "$done=(obj={})=>{const saved=obj;$origDone(obj);};$done({body:'ok'});"),
            ("const $origDone=$done;"
             "$done=(obj={})=>{$origDone(obj);$origDone(obj);};$done({body:'ok'});"),
            ("const $origDone=$done;"
             "$done=(obj={})=>{$origDone(obj);};$done({body:'ok'},'extra');"),
            ("const $origDone=$done;$done=(obj={})=>{$origDone(obj);};"
             "$origDone({body:'alias'});$done({body:'ok'});"),
        ]
        for source in variants:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                self.convert(source)


class ClosedQxStorageFacadeTests(unittest.TestCase):
    def convert(self, source):
        return convert_script(source, 'Fixture', URL, '', source_format='qx')

    def test_qx_store_facade_keeps_qx_value_key_order(self):
        source = ("const store={get:this.$prefs?.valueForKey ?? $persistentStore.read,"
                  "set:(k,v)=>(this.$prefs?.setValueForKey ?? $persistentStore.write)(v,k)};"
                  "store.set('x','ok');$done({body:store.get('x')});")
        output = self.convert(source)
        self.assertNotIn('store.set', output)
        fixture = {'name': 'closed qx storage facade', 'request': {'url': URL},
                   'expected': {'result': {'body': 'ok'}}}
        result = compare(source, output, 'qx', URL, fixture)
        self.assertEqual(result['status'], 'passed', result)

    def test_qx_store_facade_rejects_alias_dynamic_member_and_bad_arity(self):
        prefix = ("const store={get:this.$prefs?.valueForKey ?? $persistentStore.read,"
                  "set:(k,v)=>(this.$prefs?.setValueForKey ?? $persistentStore.write)(v,k)};")
        variants = [
            prefix + "const read=store.get;read('x');$done({});",
            prefix + "store['get']('x');$done({});",
            prefix + "store.set('x');$done({});",
            prefix + "store.extra=1;$done({});",
        ]
        for source in variants:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                self.convert(source)


class NotificationUrlFieldTests(unittest.TestCase):
    def convert(self, source):
        return convert_script(source, 'Fixture', URL, '', source_format='qx')

    def test_same_literal_url_fields_select_one_notification_target(self):
        source = ("$notify('T','S','B',{'open-url':'https://x.test/a',"
                  "'url':'https://x.test/a'});$done({body:'ok'});")
        output = self.convert(source)
        fixture = {'name': 'same notification url fields', 'request': {'url': URL},
                   'expected': {'result': {'body': 'ok'}}}
        result = compare(source, output, 'qx', URL, fixture)
        self.assertEqual(result['status'], 'passed', result)

    def test_notification_url_fields_still_reject_conflicting_values(self):
        for options in ["{'open-url':'https://x.test/a','url':'https://x.test/b'}",
                        "{'open-url':$argument,'url':$argument}"]:
            source = ("const target='https://x.test/a';"
                      f"$notify('T','S','B',{options});$done({{}});")
            with self.subTest(options=options), self.assertRaises(ConversionError):
                self.convert(source)


if __name__ == '__main__':
    unittest.main()
