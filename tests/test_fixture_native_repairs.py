"""Truthiness reads and renamed closed binary predicates preserve native contracts."""
import re
from pathlib import Path
import unittest
from tools.egern_hub.js_analysis import analyze_many
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare
from tools.egern_hub.convert import ConversionError

ROOT=Path(__file__).resolve().parents[1]

class MessageGuardTests(unittest.TestCase):
    def test_discarded_and_conditional_message_reads_do_not_escape(self):
        for source in ['$request;$done({body:"ok"});',
                       '$request||$done({});$done({body:"ok"});',
                       '$request?$done({body:"ok"}):$done({});']:
            with self.subTest(source=source):
                output=convert_script(source,'Fixture','https://example.test/guard.js','')
                result=compare(source,output,'surge','https://example.test/guard.js',
                    {'name':'request guard','request':{'url':'https://example.test/'},
                     'expected':{'result':{'body':'ok'}}})
                self.assertEqual(result['status'],'passed',result)
        with self.assertRaises(ConversionError):
            convert_script('unknown($request);$done({});','Fixture','https://example.test/escape.js','')

class ClosedBinaryPredicateTests(unittest.TestCase):
    def test_predicate_renaming_is_accepted_but_semantic_changes_are_rejected(self):
        path=ROOT/'sources/kokoryh/Sparkle/master/dist/bilibili.protobuf.request.js'
        if not path.is_file():self.skipTest('Requires the public Sparkle source snapshot')
        source=path.read_text()
        helper=re.search(r'"binary-mode":(\w+)\(',source)[1]
        renamed=re.sub(r'\b'+re.escape(helper)+r'\b','fixtureByteArrayCheck',source)
        changed,count=re.subn(r'(function fixtureByteArrayCheck\(\w+\)\{return )\w+ instanceof Uint8Array',r'\g<1>false',renamed)
        self.assertEqual(count,1)
        reports=analyze_many([(text,'loon','{"binary":true}') for text in [renamed,changed]],mode='native')
        self.assertEqual(reports[0]['errors'],[])
        self.assertTrue(any('surge.fetch' in e for e in reports[1]['errors']),reports[1]['errors'])
