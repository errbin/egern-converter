"""Official QX scalar completion, including cross-platform module references."""
import json
from pathlib import Path
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.script_platform import script_platform
from tools.egern_hub.verify import compare

ROOT = Path(__file__).resolve().parents[1]
URL = 'https://raw.githubusercontent.com/Sliverkiss/QuantumultX/main/AdBlock/xmApp/wnbz.js'
DECLARATION = '/*\n^https://example.test/ url script-response-body '+URL+'\n*/\n'


class ScalarCompletionTests(unittest.TestCase):
    def test_qx_strings_are_body_and_ordinary_logic_is_retained(self):
        for body in ['"changed"', 'JSON.stringify({normal:1})', '`value:${1+2}`', 'text']:
            source='const text="alias";$done('+body+');'
            output=convert_script(source, 'Author', URL, '', source_format='qx')
            fixture={'name':'scalar', 'request':{'url':'https://example.test/'},
                     'response':{'body':'old'}, 'expected':{'result':{'body':
                         {'"changed"':'changed','JSON.stringify({normal:1})':'{"normal":1}',
                          '`value:${1+2}`':'value:3','text':'alias'}[body]}}}
            self.assertEqual(compare(source, output, 'qx', URL, fixture)['status'], 'passed')
            self.assertNotIn('$done(', output)

    def test_scalar_is_not_guessed_for_other_platforms_or_unknown_values(self):
        for platform in ['loon','surge','stash','shadowrocket']:
            with self.subTest(platform=platform), self.assertRaisesRegex(ConversionError, 'QX'):
                convert_script('$done("value");', 'Author', URL, '', source_format=platform)
        for source in ['$done(unknown());', '$done(123);', 'JSON.stringify=()=>({invalid:1});$done(JSON.stringify({}));']:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                convert_script(source, 'Author', URL, '', source_format='qx')

    def test_only_unambiguous_self_documented_text_rewrites_select_qx(self):
        code='let body=JSON.parse($response.body);$done(JSON.stringify(body));'
        self.assertEqual(script_platform(DECLARATION+code, URL, 'loon'), 'qx')
        self.assertEqual(script_platform(DECLARATION+code, URL.replace('wnbz','other'), 'loon'), 'loon')
        self.assertEqual(script_platform(code, URL, 'loon'), 'loon')
        self.assertEqual(script_platform(DECLARATION+code, URL, 'loon', binary=True), 'loon')
        self.assertEqual(script_platform(DECLARATION+'$done({body:$response.body});', URL, 'loon'), 'loon')
        for extra in ['if(typeof $loon!=="undefined")console.log("loon");',
                      'if(typeof $task!=="undefined")console.log("qx");',
                      'console.log($response.status);',
                      'console.log($environment.language);',
                      'console.log($\\u006coon);']:
            with self.subTest(extra=extra):
                self.assertEqual(script_platform(DECLARATION+extra+code, URL, 'loon'), 'loon')
        mixed=DECLARATION+'/*\nhttp-response ^https://example.test/ script-path='+URL+'\n*/\n'+code
        self.assertEqual(script_platform(mixed, URL, 'loon'), 'loon')
        # A string containing fake usage is not a source declaration.
        fake='const text='+json.dumps(DECLARATION)+';'+code
        self.assertEqual(script_platform(fake, URL, 'loon'), 'loon')
