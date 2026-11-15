"""宿主请求整体只在真值或静态字段观察中保持闭合。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL = 'https://example.test/source.js'


class HostRequestObservationTests(unittest.TestCase):
    def test_fallback_record_reads_static_url(self):
        source = "(()=>{const url=($request||{}).url||'';return $done({body:url})})();"
        output = convert_script(source, 'Fixture', URL, '', source_format='surge')
        self.assertIn('(ctx.request||{})', output)
        for request_url in [URL, 'https://example.test/changed']:
            case = {'name': '请求回退记录', 'request': {'url': request_url},
                    'expected': {'result': {'body': request_url}}}
            result = compare(source, output, 'surge', URL, case)
            self.assertEqual(result['status'], 'passed', result)

    def test_logical_probe_only_observes_truthiness(self):
        source = ("if(typeof $request!=='undefined'&&$request&&$request.url)"
                  "$done({body:'capture'});else $done({body:'sign'});")
        output = convert_script(source, 'Fixture', URL, '', source_format='surge')
        case = {'name': '请求真值探测', 'request': {'url': URL},
                'expected': {'result': {'body': 'capture'}}}
        result = compare(source, output, 'surge', URL, case)
        self.assertEqual(result['status'], 'passed', result)

    def test_escape_assignment_dynamic_key_and_call_remain_rejected(self):
        for source in [
            'const saved=$request;unknown(saved);$done({})',
            'const saved=$argument&&$request;$done({body:saved.url})',
            'const url=($request||{})[$argument];$done({body:url})',
            'unknown($request||{});$done({})',
        ]:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '', source_format='surge')


if __name__ == '__main__':
    unittest.main()
