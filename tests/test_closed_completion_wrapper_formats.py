"""非 QX 平台闭合状态归一包装器与存储门面的投影边界。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL = 'https://example.test/closed-wrapper.js'
PREFIX = ("const $origDone=$done;"
          "$done=(obj={})=>{obj.status &&= +String(obj.status).match(/\\b\\d{3}\\b/)[0];$origDone(obj);};"
          "const store={get:$prefs?.valueForKey ?? $persistentStore.read,"
          "set:(k,v)=>($prefs?.setValueForKey ?? $persistentStore.write)(v,k)};")


class ClosedCompletionWrapperFormatTests(unittest.TestCase):
    def convert(self, source, platform):
        return convert_script(source, 'Fixture', URL, '', source_format=platform)

    def test_status_normalizing_wrapper_and_store_facade_surge_loon(self):
        source = PREFIX + "store.set('x','ok');$done({status:'HTTP/1.1 200 OK',body:store.get('x')});"
        for platform in ('surge', 'loon'):
            with self.subTest(platform=platform):
                output = self.convert(source, platform)
                self.assertNotIn('$origDone', output)
                self.assertNotIn('obj.status', output)
                self.assertNotIn('store.set', output)
                fixture = {'name': 'closed status wrapper', 'request': {'url': URL},
                           'expected': {'result': {'status': 200, 'body': 'ok'}}}
                result = compare(source, output, platform, URL, fixture)
                self.assertEqual(result['status'], 'passed', result)

    def test_status_normalizing_wrapper_rejects_unmapped_status_values(self):
        for status in ("'200 OK'", "payload.status", "String(payload.status)"):
            source = (PREFIX.replace('$done=(obj={})', '$done=(obj={})')
                      + "const payload={status:'HTTP/1.1 204 No Content'};"
                      + f"$done({{status:{status},body:'ok'}});")
            for platform in ('surge', 'loon'):
                with self.subTest(platform=platform, status=status), self.assertRaises(ConversionError):
                    self.convert(source, platform)

    def test_status_normalizing_wrapper_rejects_missing_object_payload(self):
        source = PREFIX + "const payload={body:'ok'};$done(payload);"
        for platform in ('surge', 'loon'):
            with self.subTest(platform=platform), self.assertRaises(ConversionError):
                self.convert(source, platform)

    def test_store_facade_rejects_alias_on_non_qx_formats(self):
        for platform in ('surge', 'loon'):
            source = PREFIX + "const read=store.get;read('x');$done({});"
            with self.subTest(platform=platform), self.assertRaises(ConversionError):
                self.convert(source, platform)


if __name__ == '__main__':
    unittest.main()
