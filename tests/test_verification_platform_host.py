"""差分宿主必须向原脚本暴露与产物一致的 Egern 平台标记。"""
import unittest

from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare


URL = 'https://example.test/platform-host.js'


class VerificationPlatformHostTests(unittest.TestCase):
    def test_explicit_egern_branch_sees_the_native_host_marker(self):
        source = """
const platform = (() => {
  const has = name => name in globalThis;
  switch (true) {
    case has('$task'): return 'Quantumult X';
    case has('$loon'): return 'Loon';
    case has('Egern'): return 'Egern';
    case Boolean(globalThis.$environment?.['surge-version']): return 'Surge';
    default: return 'Other';
  }
})();
$done({body: platform});
"""
        native = convert_script(source, 'Fixture', URL, '', source_format='surge')
        case = {'name': 'native host marker', 'request': {'url': URL},
                'expected': {'result': {'body': 'Egern'}}}
        result = compare(source, native, 'surge', URL, case)
        self.assertEqual(result['status'], 'passed', result)
        self.assertTrue(result['expected_checked'])


if __name__ == '__main__':
    unittest.main()
