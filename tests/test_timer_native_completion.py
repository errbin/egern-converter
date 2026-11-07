"""Known one-shot timers propagate completion without changing their schedule."""
import unittest
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare,execute

URL='https://example.test/timer.js'
class TimerNativeCompletionTests(unittest.TestCase):
    def check(self,source,expected,http=None):
        native=convert_script(source,'Fixture',URL,'',source_format='surge')
        fixture={'name':'timer completion','request':{'url':URL},'event_loop':True,'expected':expected,'http':http or []}
        result=compare(source,native,'surge',URL,fixture)
        self.assertEqual(result['status'],'passed',result)
        self.assertNotIn('$done',native)

    def test_recursive_polling_preserves_request_launch_and_notification(self):
        self.check('let ready=false;$httpClient.get("https://api.test/",()=>{ready=true});function check(){if(ready){$notification.post("ready","","");$done({body:"done"})}else setTimeout(()=>check(),100)}check();',
                   {'result':{'body':'done'},'events':{'requests':[{'method':'GET'}],'notifications':[{'title':'ready'}]}},[{'url':'https://api.test/','body':'ok'}])

    def test_first_timer_completion_stops_later_timer_side_effects(self):
        self.check('setTimeout(()=>{$done({body:"first"})},100);setTimeout(()=>{$persistentStore.write("late","effect");$done({body:"second"})},200);',
                   {'result':{'body':'first'},'storage':{}})

    def test_timer_completion_stops_continuing_function_and_finally(self):
        self.check('function finish(){try{$done({body:"done"})}finally{$persistentStore.write("late","effect")}}setTimeout(()=>finish(),100);',
                   {'result':{'body':'done'},'storage':{}})

    def test_immediately_invoked_timer_argument_keeps_order_and_completion(self):
        source='const events=[];function getinfo(){events.push("getinfo")}function show(){events.push("show");$done({body:events.join(",")})}setTimeout(getinfo(),500);setTimeout(show(),600);events.push("late");'
        native=convert_script(source,'Fixture',URL,'',source_format='surge')
        self.assertIn('getinfo();',native)
        self.assertNotIn('setTimeout(getinfo(),500)',native)
        self.assertNotIn('setTimeout(show(),600)',native)
        fixture={'name':'immediate timer argument','request':{'url':URL},'event_loop':True,
                 'expected':{'result':{'body':'getinfo,show'}}}
        result=execute(native,'surge',URL,fixture,'converted')
        self.assertNotIn('error',result,result)
        self.assertEqual(result['observation']['result']['body'],'getinfo,show')
