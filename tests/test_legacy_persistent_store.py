"""旧持久化 API 的方法引用只能做存在性探测，直接调用按存储契约映射。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL = 'https://example.test/persistent-store.js'


class LegacyPersistentStoreTests(unittest.TestCase):
    def test_method_existence_probe_and_direct_calls_map_to_storage(self):
        source = '''function kvGet(key){try{if (typeof $persistentStore!=='undefined' && $persistentStore.read) return $persistentStore.read(key)||'';}catch{}return '';}
function kvSet(key,val){try{if (typeof $persistentStore!=='undefined' && $persistentStore.write) return $persistentStore.write(val,key);}catch{}return false;}
kvSet('k','v');$done({body:kvGet('k')});'''
        for source_format in ['surge', 'loon']:
            with self.subTest(source_format=source_format):
                output = convert_script(source, 'Fixture', URL, '', source_format=source_format)
                self.assertNotIn('$persistentStore', output)
                case = {'name': 'persistent store probe', 'request': {'url': URL},
                        'expected': {'result': {'body': 'v'}, 'storage': {'k': 'v'}}}
                result = compare(source, output, source_format, URL, case)
                self.assertEqual(result['status'], 'passed', result)

    def test_storage_object_and_method_aliases_still_reject(self):
        cases = [
            '''const store=$persistentStore;unknown(store);$done({body:'ok'});''',
            '''const store=$persistentStore;store.write=function(){};$done({body:'ok'});''',
            '''const read=$persistentStore.read;read('k');$done({body:'ok'});''',
            '''$persistentStore.read.call($persistentStore,'k');$done({body:'ok'});''',
        ]
        for source in cases:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '', source_format='loon')


if __name__ == '__main__':
    unittest.main()
