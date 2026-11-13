"""请求参数的自快照只在 typeof 与 url 包装都闭合时可静态展开。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare


URL = 'https://example.test/request-self-snapshot.js'
TEMPLATE = '''function send(input) {
  input = %s;
  return new Promise((resolve, reject) => {
    $httpClient.post(input, (error, response, body) => error ? reject(error) : resolve(body));
  });
}
Promise.all([
  send('https://api.example/string'),
  send({url: 'https://api.example/object', body: 'payload'})
]).then(([a, b]) => $done({body: a + ':' + b}));
'''


class NativeRequestSelfSnapshotTests(unittest.TestCase):
    def test_string_or_record_self_snapshot_converts_and_compares(self):
        source = TEMPLATE % 'typeof input === "string" ? {url: input} : input'
        output = convert_script(source, 'Fixture', URL, '', source_format='loon')
        self.assertNotIn('$httpClient', output)
        result = compare(source, output, 'loon', URL, {
            'name': 'request self snapshot', 'event_loop': True,
            'request': {'url': URL},
            'http': [{'url': 'https://api.example/string', 'body': 'one'},
                     {'url': 'https://api.example/object', 'body': 'two'}],
            'expected': {'result': {'body': 'one:two'}},
        })
        self.assertEqual(result['status'], 'passed', result)

    def test_mismatched_self_snapshot_shapes_are_rejected(self):
        cases = {
            'typeof operand differs from alternate': 'typeof other === "string" ? {url: input} : input',
            'wrapper key is not url': 'typeof input === "string" ? {link: input} : input',
            'wrapper value differs from alternate': 'typeof input === "string" ? {url: other} : input',
            'alternate is not the tested binding': 'typeof input === "string" ? {url: input} : other',
        }
        for name, expression in cases.items():
            with self.subTest(name=name), self.assertRaises(ConversionError):
                convert_script(TEMPLATE % expression, 'Fixture', URL, '', source_format='loon')


if __name__ == '__main__':
    unittest.main()
