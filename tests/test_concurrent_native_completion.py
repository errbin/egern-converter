"""Native Promise results retain callback concurrency and first completion."""
import unittest
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare,execute

URL='https://example.test/concurrent.js'
class ConcurrentNativeCompletionTests(unittest.TestCase):
    def check(self,source,fixture):
        native=convert_script(source,'Fixture',URL,'',source_format='loon')
        result=compare(source,native,'loon',URL,dict(fixture,request={'url':URL},event_loop=True))
        self.assertEqual(result['status'],'passed',result)
        self.assertNotIn('$httpClient',native)
        self.assertNotIn('$done',native)
        return native

    def test_loop_requests_start_before_any_callback_and_share_one_result(self):
        source='let started=0,finished=0;for(const id of ["one","two","three"])work(id);function work(id){started++;$httpClient.get("https://api.test/"+id,(e,r,b)=>{$persistentStore.write(String(started),id);if(++finished===3)$done({body:String(finished)})})}'
        self.check(source,{'name':'parallel loop','http':[{'url':'https://api.test/'+id,'body':id} for id in ['one','two','three']],'expected':{'result':{'body':'3'},'storage':{'one':'3','two':'3','three':'3'}}})

    def test_request_launch_then_synchronous_completion_keeps_early_boundary(self):
        source='work();$done({body:"early"});function work(){$httpClient.get("https://api.test/one",(e,r,b)=>{$persistentStore.write("late","effect");$done({body:b})})}'
        self.check(source,{'name':'immediate finish','http':[{'url':'https://api.test/one','body':'late'}],'expected':{'result':{'body':'early'},'storage':{},'events':{'requests':[{'url':'https://api.test/one'}],'storageWrites':[]}}})

    def test_callback_can_launch_next_request_then_continue_sync_work(self):
        source='let order="";$httpClient.get("https://api.test/one",(e,r,b)=>{next();order+="after"});function next(){$httpClient.get("https://api.test/two",(e,r,b)=>$done({body:order}))}'
        self.check(source,{'name':'nested launch','http':[{'url':'https://api.test/one','body':'a'},{'url':'https://api.test/two','body':'b'}],'expected':{'result':{'body':'after'}}})

    def test_first_callback_completion_stops_later_callbacks(self):
        source='for(const id of ["one","two"])work(id);function work(id){$httpClient.get("https://api.test/"+id,(e,r,b)=>{$persistentStore.write(id,"last");$done({body:id})})}'
        self.check(source,{'name':'first result','http':[{'url':'https://api.test/'+id,'body':id} for id in ['one','two']],'expected':{'result':{'body':'one'},'storage':{'last':'one'}}})

    def test_detached_callback_exceptions_reject_the_native_result(self):
        source='work();console.log("launched");function work(){$httpClient.get("https://api.test/one",(e,r,b)=>{if(b==="bad")throw new Error("fixture failure");$done({body:b})})}'
        native=convert_script(source,'Fixture',URL,'',source_format='loon')
        fixture={'name':'callback failure','request':{'url':URL},'http':[{'url':'https://api.test/one','body':'bad'}],'event_loop':True}
        for code,side in [(source,'original'),(native,'converted')]:
            result=execute(code,'loon',URL,fixture,side)
            self.assertIn('fixture failure',result.get('error',''),result)

    def test_shadowed_promise_does_not_acquire_a_native_result_contract(self):
        from tools.egern_hub.convert import ConversionError
        source='const Promise=unknown();work();console.log("tail");function work(){$httpClient.get("https://api.test/",(e,r,b)=>$done({body:b}))}'
        with self.assertRaises(ConversionError):
            convert_script(source,'Fixture',URL,'',source_format='loon')

    def test_synchronous_completion_stops_resumed_async_work(self):
        source='(async()=>{await Promise.resolve();$persistentStore.write("late","effect");$done({body:"first"});})();$done({body:"second"});'
        self.check(source,{'name':'async resume after finish','expected':{'result':{'body':'second'},'storage':{},'events':{'storageWrites':[]}}})

    def test_completion_stops_pending_noncompleting_http_callback(self):
        source='work();$httpClient.get("https://api.test/two",()=>{$persistentStore.write("late","effect")});function work(){$httpClient.get("https://api.test/one",(e,r,b)=>$done({body:b}))}'
        self.check(source,{'name':'ordinary callback after finish','http':[{'url':'https://api.test/'+id,'body':id} for id in ['one','two']],'expected':{'result':{'body':'one'},'storage':{},'events':{'storageWrites':[]}}})

    def test_modified_promise_constructor_is_not_a_result_contract(self):
        from tools.egern_hub.convert import ConversionError
        for setup in ['Promise.prototype.catch=function(){};', 'const alias=Promise;alias.prototype.then=function(){};']:
            with self.subTest(setup=setup), self.assertRaises(ConversionError):
                convert_script(setup+'work();console.log("tail");function work(){$httpClient.get("https://api.test/",(e,r,b)=>$done({body:b}))}','Fixture',URL,'',source_format='loon')
