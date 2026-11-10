"""直接 IIFE 的静态字符串实参可证明 HTTP URL，未知实参仍拒绝。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL = 'https://example.test/iife-http.js'


class IIFEHTTPStringArgumentTests(unittest.TestCase):
    def test_transformed_string_argument_is_proven_through_the_iife(self):
        source = '''const id="1";const target="https://api.test/{id}".replace("{id}",id);
(function(url){$httpClient.get(url,(error,response,body)=>{$done({body})})})(target);'''
        output = convert_script(source, 'Fixture', URL, '', source_format='loon')
        fixture = {'name':'IIFE string URL','request':{'url':URL},
                   'http':[{'url':'https://api.test/1','body':'ok'}],
                   'expected':{'result':{'body':'ok'}}}
        result = compare(source, output, 'loon', URL, fixture)
        self.assertEqual(result['status'], 'passed', result)
        self.assertIn('ctx.http.get(', output)

    def test_unknown_or_mutable_iife_arguments_still_reject(self):
        sources = [
            '(function(url){$httpClient.get(url,(e,r,b)=>$done({body:b}))})(unknown());',
            '(function(url=unknown()){$httpClient.get(url,(e,r,b)=>$done({body:b}))})();',
            '(function(url){url=unknown();$httpClient.get(url,(e,r,b)=>$done({body:b}))})("https://api.test/");',
        ]
        for source in sources:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '', source_format='loon')


if __name__ == '__main__':
    unittest.main()
