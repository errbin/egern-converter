"""Closed legacy request records using `header` map to native `headers`."""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare,execute

URL='https://example.test/script.js'


class LegacyHTTPHeaderAliasTests(unittest.TestCase):
    def test_callback_client_maps_singular_header_without_losing_values(self):
        source="""$httpClient.get({url:'https://api.example.test/',header:{Cookie:'session'}},(error,response,body)=>{
 if(error)$done({body:error});else $done({body:body});
});"""
        output=convert_script(source,'Fixture',URL,'',source_format='loon')
        self.assertIn('headers:',output)
        self.assertNotIn('header:',output)
        fixture={
            'name':'singular header option','request':{'url':URL},
            'http':[{'url':'https://api.example.test/','body':'ok'}],
            'expected':{'result':{'body':'ok'}}}
        result=execute(output,'loon',URL,fixture,'converted')['observation']
        self.assertEqual(result['result'],{'body':'ok'})
        self.assertEqual(result['events']['requests'][0]['headers'],{'cookie':'session'})

    def test_conflicting_singular_and_plural_header_fields_are_rejected(self):
        source="$httpClient.get({url:'https://api.example.test/',header:{A:'1'},headers:{B:'2'}},()=>{});$done({});"
        with self.assertRaisesRegex(ConversionError,'同时包含 header 与 headers'):
            convert_script(source,'Fixture',URL,'',source_format='loon')


if __name__=='__main__':
    unittest.main()
