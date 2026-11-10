"""完成结果只被 typeof 观察时保留字段证明，其他逃逸仍拒绝。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL = 'https://example.test/typeof-completion.js'


class CompletionTypeofObservationTests(unittest.TestCase):
    def test_typeof_guard_does_not_escape_a_completion_function(self):
        source="function finish(value){$done(value)}if(typeof finish==='function')finish({body:'ok'});"
        output=convert_script(source,'Fixture',URL,'',source_format='loon')
        result=compare(source,output,'loon',URL,{'name':'typeof completion call','request':{'url':URL}})
        self.assertEqual(result['status'],'passed',result)

    def test_unknown_use_of_a_typeof_observed_completion_function_still_rejects(self):
        source="function finish(value){$done(value)}if(typeof finish==='function')unknown(finish);finish({body:'ok'});"
        with self.assertRaises(ConversionError):
            convert_script(source,'Fixture',URL,'',source_format='loon')

    def test_typeof_guard_does_not_escape_a_closed_completion_object(self):
        source = '''const value = {body: 'changed'};
if (typeof value === 'object') $done(value);'''
        output = convert_script(source, 'Fixture', URL, '', source_format='loon')
        fixture = {'name': 'typeof completion', 'request': {'url': URL}}
        result = compare(source, output, 'loon', URL, fixture)
        self.assertEqual(result['status'], 'passed', result)

    def test_other_observation_or_escape_paths_still_reject(self):
        sources = [
            '''const value = {body: 'changed'};
if (typeof value === 'object') unknown(value);
$done(value);''',
            '''const value = {body: 'changed'};
if (typeof value === 'object') value[unknownKey] = 'changed';
$done(value);''',
            '''const value = {body: 'changed'};
if (typeof value === 'object') {const alias = value; unknown(alias);}
$done(value);''',
            '''const value = {body: 'changed'};
if (typeof value === 'object') delete value.body;
$done(value);''',
        ]
        for source in sources:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '', source_format='loon')


if __name__ == '__main__':
    unittest.main()
