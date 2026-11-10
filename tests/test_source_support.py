"""Source snapshot lookup respects each catalog discovery contract."""
import json
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import support


@unittest.skipUnless(importlib.util.find_spec('tools.egern_hub.catalog'),
                     'Catalog integration checks require the assembled build tools')
class SourceSupportTests(unittest.TestCase):
    def setUp(self):
        support.source_items.cache_clear()
        self.addCleanup(support.source_items.cache_clear)

    def test_mixed_discovery_keeps_entries_without_assuming_git_refs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'catalog').mkdir()
            manifests = [
                {'version': 1, 'repository': 'https://github.com/Example/Scripts',
                 'resources': [], 'scripts': [], 'discovery': {'ref': 'feature/native'},
                 'script_overrides': {'demo.js': {'id': 'legacy-script'}}},
                {'version': 2, 'repository': 'local', 'defaults': {},
                 'discovery': {'type': 'local', 'directory': 'sources/Example/Local'}},
                {'version': 2, 'repository': 'https://github.com/Example/Releases',
                 'defaults': {}, 'discovery': {'type': 'releases'}},
                {'version': 2, 'repository': 'https://t.me/ExampleChannel',
                 'defaults': {}, 'discovery': {'type': 'telegram'}},
                {'version': 1, 'repository': 'https://github.com/Example/Explicit',
                 'resources': [], 'scripts': [
                     {'id': 'explicit-script', 'path': 'sources/Example/Explicit/demo.js'}]},
            ]
            for index, manifest in enumerate(manifests):
                (root / 'catalog' / f'{index}.json').write_text(json.dumps(manifest))
            legacy = root / 'sources/Example/Scripts/feature/native/demo.js'
            legacy.parent.mkdir(parents=True)
            legacy.write_text('legacy source')
            explicit = root / 'sources/Example/Explicit/demo.js'
            explicit.parent.mkdir(parents=True)
            explicit.write_text('explicit source')

            with patch.object(support, 'ROOT', root):
                items = support.source_items()
                self.assertEqual(set(items), {'legacy-script', 'explicit-script'})
                self.assertEqual(items['legacy-script']['url'],
                    'https://raw.githubusercontent.com/Example/Scripts/feature/native/demo.js')
                self.assertEqual(support.source_text('legacy-script'), 'legacy source')
                self.assertEqual(support.source_text('explicit-script'), 'explicit source')

    def test_invalid_repository_ref_still_fails_catalog_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'catalog').mkdir()
            (root / 'catalog/source.json').write_text(json.dumps({
                'version': 2, 'repository': 'https://github.com/Example/Scripts',
                'defaults': {}, 'discovery': {'type': 'repository'}}))
            with patch.object(support, 'ROOT', root), self.assertRaisesRegex(ValueError, 'ref'):
                support.source_items()


if __name__ == '__main__':
    unittest.main()
