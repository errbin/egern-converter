"""A QX response-filter option does not run in callback HTTP clients."""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL = 'https://example.test/filter.js'


class PlatformHTTPOptionsTests(unittest.TestCase):
    def test_callback_clients_keep_raw_body_in_shared_option_records(self):
        source = '''const options={url:'https://example.test/api',
opts:{filter:'throw new Error("QX-only filter must not execute")'}};
$httpClient.get(options,(error,response,body)=>$done({body}));'''
        for platform in ['surge', 'loon', 'stash', 'shadowrocket']:
            with self.subTest(platform=platform):
                output = convert_script(source, 'Fixture', URL, '', source_format=platform)
                case = {'name': 'callback body bypasses QX filter',
                        'request': {'url': URL},
                        'http': [{'url': 'https://example.test/api', 'body': 'unfiltered'}],
                        'expected': {'result': {'body': 'unfiltered'}}}
                result = compare(source, output, platform, URL, case)
                self.assertEqual(result['status'], 'passed', result)
                self.assertIn('ctx.http.get(', output)
                self.assertNotIn('$httpClient', output)

    def test_unknown_dynamic_effectful_and_mutated_options_are_rejected(self):
        for value in ['{unknown:true}', '{filter:unknown}',
                      '{get filter(){return "body"}}',
                      '{filter:sideEffect()}', '{[sideEffect()]:"body"}']:
            source = ('const options={url:"https://example.test/api",opts:' + value + '};'
                      '$httpClient.get(options,(e,r,b)=>$done({body:b}));')
            with self.subTest(value=value), self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '')
        source = '''const opts={filter:'return body'};opts.filter='changed';
$httpClient.get({url:'https://example.test/api',opts},(e,r,b)=>$done({body:b}));'''
        with self.assertRaises(ConversionError):
            convert_script(source, 'Fixture', URL, '')
        for use in ['unknown(opts);', 'const alias=opts;alias.filter="changed";']:
            source = ('const opts={filter:"return body"};' + use +
                      '$httpClient.get({url:"https://example.test/api",opts},(e,r,b)=>$done({body:b}));')
            with self.subTest(use=use), self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '')

    def test_qx_filter_cannot_be_silently_discarded(self):
        source = '''$task.fetch({url:'https://example.test/api',
opts:{filter:'return body.toUpperCase()'}}).then(r=>$done({body:r.body}));'''
        with self.assertRaises(ConversionError):
            convert_script(source, 'Fixture', URL, '', source_format='qx')
