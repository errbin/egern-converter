"""Legacy sloppy-mode octal literals remain valid in strict Egern modules."""
import unittest

from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL='https://example.test/legacy-octal.js'


class LegacyNumericLiteralTests(unittest.TestCase):
    def test_legacy_octal_and_decimal_literals_keep_their_values(self):
        source="$done({body:[0000,010,08,09].join(',')});"
        output=convert_script(source,'Fixture',URL,'',source_format='loon')
        self.assertIn('0o000',output)
        self.assertIn('0o10',output)
        self.assertIn('8',output)
        self.assertNotRegex(output,r'(?<![\w.])0[0-7]+(?![\w.])')
        fixture={'name':'legacy numeric literal values','request':{'url':URL},
                 'expected':{'result':{'body':'0,8,8,9'}}
        }
        self.assertEqual(compare(source,output,'loon',URL,fixture)['status'],'passed')


if __name__=='__main__':
    unittest.main()
