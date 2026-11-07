"""Resolve immutable Promise callback references without replacing identity."""
import unittest
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare
from tools.egern_hub.convert import ConversionError
URL='https://example.test/named.js'
class NamedCompletionCallbackTests(unittest.TestCase):
    def test_named_callbacks_and_immutable_aliases_preserve_completion(self):
        for declaration in ["function finish(value){$done({body:value})}","const finish=value=>$done({body:value});","function original(value){$done({body:value})}const finish=original;"]:
            source=declaration+"function cleanup(){$persistentStore.write('wrong','late')}Promise.resolve('first').then(finish).finally(cleanup);"
            output=convert_script(source,'Fixture',URL,'')
            case={'name':'named completion','event_loop':True,'request':{'url':URL},'expected':{'result':{'body':'first'},'events':{'storageWrites':[]}}}
            result=compare(source,output,'surge',URL,case)
            self.assertEqual(result['status'],'passed',result)

    def test_named_catch_callback_handles_rejection(self):
        source="function recover(e){$done({body:e.message})}Promise.reject(new Error('offline')).catch(recover);"
        output=convert_script(source,'Fixture',URL,'')
        case={'name':'named rejection','request':{'url':URL},'expected':{'result':{'body':'offline'}}}
        self.assertEqual(compare(source,output,'surge',URL,case)['status'],'passed')

    def test_registration_before_initialization_and_mutation_are_rejected(self):
        sources=[
          "Promise.resolve('ok').then(finish).finally(()=>{});const finish=value=>$done({body:value});",
          "Promise.resolve('ok').then(finish).finally(()=>{});var finish=value=>$done({body:value});",
          "let finish=value=>$done({body:value});finish=foreign;Promise.resolve('ok').then(finish).finally(()=>$done({body:'last'}));",
        ]
        for source in sources:
            with self.subTest(source=source),self.assertRaises(ConversionError):convert_script(source,'Fixture',URL,'')
