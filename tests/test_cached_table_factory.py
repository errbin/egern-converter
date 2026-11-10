"""缓存式解码器的表工厂只接受可证明为唯一静态来源的等价写法。"""
import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
REVIEWED_SOURCE = ROOT / 'sources/fmz200/wool_scripts/main/Scripts/kuaishou/ks_fruit.js'
REVIEWED_HELPER = ROOT / 'tests/helpers/cached-factory-fold.mjs'

PROBE = r"""
import {readFileSync} from 'node:fs';
import {inspectCachedTableFactory} from './tools/js-analysis/transforms/decoding.mjs';
const source = readFileSync(0, 'utf8');
try {
  const result = inspectCachedTableFactory(source);
  process.stdout.write(JSON.stringify({factory: result.factory, values: result.values}));
} catch (error) {
  process.stdout.write(JSON.stringify({error: error.message}));
}
"""


def inspect(source):
    result = subprocess.run(
        ['node', '--input-type=module', '-e', PROBE],
        input=source,
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=True,
    )
    return json.loads(result.stdout)


def decoder_source(factory, name='t0'):
    return factory + f"""
function d0(a,b){{var c={name}();return d0=function(e,f){{e=e-0x10;var g=c[e];return g;}},d0(a,b);}}
"""


class CachedTableFactoryTests(unittest.TestCase):

    def test_equivalent_static_factory_shapes_are_extracted(self):
        cases = {
            'concat_iife': '''
function t0(){var a=(function(){return ['YQ==','Yg=='].concat((function(){return ['Yw==','ZA=='];})());})();t0=function(){return a;};return t0();}
''',
            'spread_iife': '''
function t0(){var a=(function(){return [...['YQ=='],...['Yg==','Yw=='],...['ZA==']];})();t0=function(){return a;};return t0();}
''',
            'two_level_factory': '''
function seed(){return ['YQ==','Yg==','Yw==','ZA=='];}
function t0(){var a=seed();t0=function(){return a;};return t0();}
''',
            'renamed_bindings': '''
function tableFactory(){var _0xTable=['YQ==','Yg==','Yw==','ZA=='];tableFactory=function cached(){return _0xTable;};return tableFactory();}
''',
        }
        for name, factory in cases.items():
            factory_name = 'tableFactory' if name == 'renamed_bindings' else 't0'
            with self.subTest(name=name):
                data = inspect(decoder_source(factory, factory_name))
                self.assertNotIn('error', data)
                self.assertEqual(data['values'], ['YQ==', 'Yg==', 'Yw==', 'ZA=='])

    def test_unproven_sources_and_writes_remain_unknown(self):
        cases = {
            'unknown_call': '''
function t0(){var a=make();t0=function(){return a;};return t0();}
''',
            'external_alias': '''
const external=['YQ==','Yg==','Yw=='];
function t0(){var a=external;t0=function(){return a;};return t0();}
''',
            'dynamic_concat': '''
function t0(){var a=['YQ==','Yg==','Yw=='].concat(window.items);t0=function(){return a;};return t0();}
''',
            'non_string_item': '''
function t0(){var a=['YQ==','Yg==',1];t0=function(){return a;};return t0();}
''',
            'external_factory_write': '''
function seed(){return ['YQ==','Yg==','Yw=='];}
seed=function(){return ['ZA=='];};
function t0(){var a=seed();t0=function(){return a;};return t0();}
''',
            'external_factory_read': '''
function seed(){return ['YQ==','Yg==','Yw=='];}
function t0(){var a=seed();t0=function(){return a;};return t0();}
seed();
''',
        }
        for name, factory in cases.items():
            with self.subTest(name=name):
                data = inspect(decoder_source(factory))
                self.assertIn('error', data)

    @unittest.skipUnless(REVIEWED_SOURCE.is_file(), 'Requires the reviewed cached-factory snapshot')
    def test_equivalent_factory_shapes_fold_through_the_reviewed_shell(self):
        result = subprocess.run(
            ['node', str(REVIEWED_HELPER), str(REVIEWED_SOURCE)],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=True,
        )
        self.assertEqual(json.loads(result.stdout), {'concat': 1, 'spread': 1, 'two_level': 1})


if __name__ == '__main__':
    unittest.main()
