import tempfile
from pathlib import Path
import unittest
import yaml
from verification.native_probe import generate
from tools.egern_hub.js_analysis import validate_generated


class RuntimeProbeTests(unittest.TestCase):
    def test_probe_is_native_opt_in_and_uses_selected_site(self):
        with tempfile.TemporaryDirectory() as tmp:
            generate(tmp,'http://example.test:8787/sub')
            module=yaml.safe_load((Path(tmp)/'native-capabilities.yaml').read_text())
            entry=module['scriptings'][0]['generic']
            self.assertEqual(entry['script_url'],'http://example.test:8787/sub/_verification/native-capabilities.js')
            self.assertEqual(entry['timeout'],5)
            script=(Path(tmp)/'native-capabilities.js').read_text()
            validate_generated({'probe':script})
            self.assertNotIn('$environment',script)
            self.assertNotIn('$loon',script)
            self.assertNotIn('ctx.http',script)
            self.assertNotIn('ctx.storage',script)

    def test_invalid_site_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            for url in ['file:///tmp','https://example.test/?secret=1','https://example.test/#hash']:
                with self.subTest(url=url),self.assertRaises(ValueError):generate(tmp,url)
