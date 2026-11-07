"""Synchronous Promise executors retain native first-completion results."""
import unittest
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare
from tools.egern_hub.convert import ConversionError

URL='https://example.test/executor.js'

class ExecutorNativeCompletionTests(unittest.TestCase):
    def check(self,source,fixture):
        native=convert_script(source,'Fixture',URL,'',source_format='surge')
        result=compare(source,native,'surge',URL,dict(fixture,event_loop=True,request={'url':URL}))
        self.assertEqual(result['status'],'passed',result)
        self.assertNotIn('new Promise(async',native)
        self.assertNotIn('$httpClient',native)
        self.assertNotIn('$done',native)
        return native

    def test_early_http_completion_unwinds_an_unresolved_executor_promise(self):
        source='async function run(){await new Promise(resolve=>{$httpClient.get("https://api.test/",(e,r,b)=>{try{if(b==="early")$done({body:b});resolve(b)}finally{$persistentStore.write("finally","effect")}})});$persistentStore.write("after","effect")}run().catch(()=>{}).finally(()=>$done({body:"normal"}));'
        for reply,expected in [('early','early'),('continue','normal')]:
            self.check(source,{'name':reply,'http':[{'url':'https://api.test/','body':reply}],
                              'expected':{'result':{'body':expected},'storage':{} if reply=='early' else {'effect':'after'}}})

    def test_forwarding_helper_keeps_executor_synchronous_and_local_catch(self):
        source='function send(o,c){$httpClient.get(o,c)}async function run(){await new Promise(resolve=>{send({url:"https://api.test/"},(e,r,b)=>{if(b==="early")$done({body:b});resolve()})})}run().catch(e=>$done({body:e.message})).finally(()=>$done({body:"normal"}));'
        self.check(source,{'name':'forwarded early finish','http':[{'url':'https://api.test/','body':'early'}],'expected':{'result':{'body':'early'}}})
        source=source.replace('function send(o,c){','function send(o,c){if($persistentStore.read("fail"))throw Error("argument failed");')
        self.check(source,{'name':'executor argument exception','storage':{'fail':'true'},'http':[],'expected':{'result':{'body':'argument failed'},'events':{'requests':[]}}})

    def test_synchronous_executor_completion_does_not_wait_for_resolve(self):
        source='async function run(){await new Promise(resolve=>{$done({body:"early"});resolve()});$persistentStore.write("late","effect")}run().finally(()=>$done({body:"wrong"}));'
        self.check(source,{'name':'sync executor finish','expected':{'result':{'body':'early'},'storage':{}}})

    def test_executor_starts_requests_before_outer_synchronous_work(self):
        source='let order="";async function run(){await new Promise(resolve=>{$httpClient.get("https://api.test/",(e,r,b)=>$done({body:order}));order+="executor;"})}run();order+="outer;";'
        self.check(source,{'name':'executor launch order','http':[{'url':'https://api.test/','body':'ok'}],
                          'expected':{'result':{'body':'executor;outer;'}}})

    def test_unknown_constructor_does_not_gain_executor_contract(self):
        with self.assertRaises(ConversionError):
            convert_script('async function run(){await new Unknown(resolve=>$done({body:"x"}))}run();','Fixture',URL,'')
