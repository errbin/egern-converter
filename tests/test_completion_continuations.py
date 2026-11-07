"""Completing async tasks suppress later Promise continuations."""
import unittest
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare
from tools.egern_hub.convert import ConversionError

URL='https://example.test/task.js'
class CompletionContinuationTests(unittest.TestCase):
    def test_first_completion_skips_then_catch_and_finally(self):
        for chain in [".then(()=>$done({body:'second'}))", ".then(()=>{$persistentStore.write('late','key')}).catch(()=>$done({body:'caught'}))", ".then(()=>$done({body:'second'})).finally(()=>{$persistentStore.write('late','key')})"]:
            source="async function task(){await Promise.resolve();$done({body:'first'})}task()"+chain+';'
            output=convert_script(source,'Fixture',URL,'')
            case={'name':'first completion','event_loop':True,'request':{'url':URL},'expected':{'result':{'body':'first'},'events':{'storageWrites':[]}}}
            self.assertEqual(compare(source,output,'surge',URL,case)['status'],'passed')

    def test_noncompleting_return_runs_then_and_rejection_runs_catch(self):
        for body,expected in [("return 'normal'",'normal'),("throw new Error('failed')",'failed')]:
            source="async function task(){await Promise.resolve();if($persistentStore.read('finish'))$done({body:'first'});"+body+"}task().then(value=>$done({body:value})).catch(error=>$done({body:error.message}));"
            output=convert_script(source,'Fixture',URL,'')
            case={'name':'normal promise branch','request':{'url':URL},'expected':{'result':{'body':expected}}}
            self.assertEqual(compare(source,output,'surge',URL,case)['status'],'passed')

    def test_qx_response_body_and_completion_skip_finalizer(self):
        source='$task.fetch({url:"https://api.example"}).then(r=>$done({body:r.body})).finally(()=>$persistentStore.write("wrong","late"));'
        output=convert_script(source,'Fixture',URL,'',source_format='qx')
        case={'name':'QX finalizer','event_loop':True,'request':{'url':URL},
              'http':[{'url':'https://api.example','body':'first'}],
              'expected':{'result':{'body':'first'},'events':{'storageWrites':[]}}}
        result=compare(source,output,'qx',URL,case)
        self.assertEqual(result['status'],'passed',result)

    def test_unknown_thenable_is_not_assumed_to_be_a_promise(self):
        source="unknown().then(value=>$done({body:value})).finally(()=>{});"
        with self.assertRaises(ConversionError):convert_script(source,'Fixture',URL,'')

    def test_sync_tail_forwarder_of_async_completion_becomes_async(self):
        source="async function task(){await Promise.resolve().finally(()=>$done({body:'ok'}))}function start(){task()}start();"
        output=convert_script(source,'Fixture',URL,'')
        case={'name':'async completion forwarder','event_loop':True,'request':{'url':URL},'expected':{'result':{'body':'ok'}}}
        result=compare(source,output,'surge',URL,case)
        self.assertEqual(result['status'],'passed',result)

    def test_detached_async_completion_preserves_sibling_work_before_completion(self):
        source="async function task(){await Promise.resolve().finally(()=>$done({body:'ok'}))}function start(){task();$persistentStore.write('sibling','key')}start();"
        output=convert_script(source,'Fixture',URL,'')
        case={'name':'detached sibling','request':{'url':URL},'event_loop':True,
              'expected':{'result':{'body':'ok'},'storage':{'key':'sibling'}}}
        result=compare(source,output,'surge',URL,case)
        self.assertEqual(result['status'],'passed',result)
