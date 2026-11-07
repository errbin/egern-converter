"""Complete constructor libraries are retained, independently of business APIs."""
import base64
import json
from pathlib import Path
import subprocess
import unittest

from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'sources/evilbutcher/Quantumult_X/master/check_in/hotsearch/hot.js'
BRIDGE = '''
import {parse} from './tools/js-analysis/core/syntax.mjs';
import {protectLibraries} from './tools/js-analysis/analysis/libraries.mjs';
let source='';for await(const c of process.stdin)source+=c;
const tree=parse(source,{ecmaVersion:'latest'});
const node=tree.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='Base64Code');
const library=node?source.slice(node.start,node.end):source;
const protectedSource=protectLibraries(library);
process.stdout.write(JSON.stringify({library,blocks:protectedSource.blocks,
 restored:protectedSource.restore(protectedSource.source)}));
'''


@unittest.skipUnless(SOURCE.is_file(), 'Requires the cached original Base64 constructor')
class Base64ConstructorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.library = cls.inspect(SOURCE.read_text())['library']

    @staticmethod
    def inspect(source):
        result = subprocess.run(['node', '--input-type=module', '-e', BRIDGE],
                                input=source, cwd=ROOT, text=True, capture_output=True, check=True)
        return json.loads(result.stdout)

    def test_constructor_keeps_exact_bytes_and_binding(self):
        for library in [self.library, self.library.replace('Base64Code', 'RenamedCodec')]:
            with self.subTest(renamed='RenamedCodec' in library):
                report = self.inspect(library)
                self.assertEqual([b['name'] for b in report['blocks']],
                                 ['js-base64 Base64Code constructor'])
                self.assertEqual(report['restored'], library)

    def test_encoding_decoding_and_native_business_api(self):
        for text in ['hello', '火龙果 🍎', 'https://example.test/a?b=1&c=2']:
            encoded = base64.b64encode(text.encode()).decode()
            source = self.library + '\nconst codec=new Base64Code();' + \
                '$done({body:JSON.stringify([codec.encode($request.headers.input),' + \
                'codec.decode(' + json.dumps(encoded) + ')])});'
            output = convert_script(source, 'Original', 'https://example.test/a.js', '')
            self.assertIn(self.library, output)
            self.assertNotIn('$done(', output)
            self.assertIn('ctx.request', output)
            fixture = {'name': 'Base64 known answer',
                       'request': {'url': 'https://example.test/', 'headers': {'input': text}},
                       'expected': {'result': {'body': json.dumps([encoded, text], ensure_ascii=False, separators=(',', ':'))}}}
            result = compare(source, output, 'surge', 'https://example.test/a.js', fixture)
            self.assertEqual(result['status'], 'passed', result)

    def test_name_comment_or_modified_code_cannot_grant_exemption(self):
        for library in [
            self.library.replace('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'ZBCDEFGHIJKLMNOPQRSTUVWXYA', 1),
            self.library.replace('var r =', '$done({});var r =', 1),
            '//From https://github.com/dankogai/js-base64\nfunction Base64Code(){this.encode=x=>eval(x)}',
        ]:
            self.assertEqual(self.inspect(library)['blocks'], [])
