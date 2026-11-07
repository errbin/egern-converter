"""Logging a closed request record does not make its field schema unknown."""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL = 'https://example.test/script.js'
SOURCE = '''const request={url:'https://example.test/api',headers:{X:'kept'}};
console.log('request',request);
(function(options, callback=()=>{}){
 if(options.headers)delete options.headers['Content-Length'];
 $httpClient.get(options,(error,response,body)=>callback(error,response,body));
})(request,(e,r,b)=>$done({body:e||b}));'''


class HTTPRecordObservationTests(unittest.TestCase):
    def test_logging_keeps_closed_iife_request_fields_and_transport_errors(self):
        native = convert_script(SOURCE, 'Fixture', URL, '', source_format='loon')
        self.assertIn('ctx.http.get(', native)
        for response, expected in [({'body': 'received'}, 'received'),
                                   ({'error': 'offline'}, 'offline')]:
            fixture = {'name': 'logged request', 'request': {'url': URL},
                       'http': [{'url': 'https://example.test/api', **response}],
                       'expected': {'result': {'body': expected},
                                    'events': {'requests': [{'headers': {'x': 'kept'}}]}}}
            result = compare(SOURCE, native, 'loon', URL, fixture)
            self.assertEqual(result['status'], 'passed', result)

    def test_console_reassignment_escape_or_unknown_observer_remains_rejected(self):
        for source in [SOURCE.replace("console.log('request',request)", 'unknown(request)'),
                       'console.log=unknown;'+SOURCE,
                       'unknown(console);'+SOURCE]:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '', source_format='loon')
