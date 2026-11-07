"""Closed notification normalization and synchronous tails keep JS ordering."""
import unittest
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.convert import ConversionError
from tools.egern_hub.verify import compare
URL='https://example.test/source.js'

class NativeScalarFlowTests(unittest.TestCase):
    def check(self,source,fixture=None):
        converted=convert_script(source,'Fixture',URL,'')
        case={'name':'scalar flow','request':{'url':URL},**(fixture or {})}
        result=compare(source,converted,'surge',URL,case)
        self.assertEqual(result['status'],'passed',result)
        return converted

    def test_string_guarded_option_returns_and_omitted_options(self):
        normalizer='function normalize(t){if(!t)return t;if("string"==typeof t)return t;if(typeof t==="object")return {openUrl:t.url,mediaUrl:t.image};}'
        source=normalizer+'$notification.post("first","","",normalize());$notification.post("second","","",normalize("https://a.test"));$notification.post("third","","",normalize({url:"https://b.test",image:"https://b.test/image.png"}));$done({});'
        self.check(source,{'expected':{'events':{'notifications':[
            {'title':'first','subtitle':'','body':''},
            {'title':'second','subtitle':'','body':'','action':{'type':'openUrl','url':'https://a.test'}},
            {'title':'third','subtitle':'','body':'','action':{'type':'openUrl','url':'https://b.test'},'attachment':{'url':'https://b.test/image.png'}}]}}})

    def test_scalar_option_switch_from_closed_defaults_and_strings(self):
        source='function notify(options={}){let link=null;switch(typeof options){case "string":link=options;break;case "object":if(JSON.stringify(options)!=="{}"){link=options["open-url"];break}default:link=""}$notification.post("t","","",link)}notify();notify("https://a.test");$done({});'
        self.check(source,{'expected':{'events':{'notifications':[
            {'title':'t','subtitle':'','body':'','action':{'type':'openUrl','url':''}},
            {'title':'t','subtitle':'','body':'','action':{'type':'openUrl','url':'https://a.test'}}]}}})

    def test_initialized_local_capture_in_later_promise_callback(self):
        self.check('function run(){const url="https://a.test";Promise.resolve().then(()=>$notification.post("t","","",url)).then(()=>$done({}));}run();')

    def test_sync_loop_runs_between_request_launch_and_callback(self):
        source='function run(){if(!$argument)$done({body:"early"});$httpClient.get("https://api.test",(e,r,b)=>$done({body:text+":"+b}))}run();let text="";for(let i=0;i<3;i++)text+=String.fromCharCode(65+i);console.log(text);'
        self.check(source,{'argument':'go','http':[{'url':'https://api.test','body':'ok'}],'expected':{'result':{'body':'ABC:ok'}}})
        self.check(source,{'expected':{'result':{'body':'early'},'events':{'requests':[]}}})

    def test_sync_completion_stops_tail_before_it_can_throw(self):
        source='function run(){if(!$argument)$done({body:"early"});$httpClient.get("https://api.test",(e,r,b)=>$done({body:b}))}run();throw "late";'
        self.check(source,{'expected':{'result':{'body':'early'}}})

    def test_conditional_sloppy_globals_preserve_uninitialized_reads(self):
        source='if($argument)conditionalValue="yes";let result;try{result=conditionalValue}catch(e){result=e.name}$done({body:result});'
        self.check(source,{'expected':{'result':{'body':'ReferenceError'}}})
        self.check(source,{'argument':'go','expected':{'result':{'body':'yes'}}})
        source='if($argument)conditionalValue=undefined;let result;try{result=JSON.stringify({conditionalValue})}catch(e){result=e.name}$done({body:result});'
        self.check(source,{'expected':{'result':{'body':'ReferenceError'}}})
        self.check(source,{'argument':'go','expected':{'result':{'body':'{}'}}})

    def test_conditional_global_assignment_evaluates_its_value_once(self):
        source='let calls=0;function rhs(){calls++;return "yes"}if($argument)conditionalValue=rhs();let result;try{result=conditionalValue}catch(e){result=e.name}$done({body:result+":"+calls});'
        self.check(source,{'expected':{'result':{'body':'ReferenceError:0'}}})
        self.check(source,{'argument':'go','expected':{'result':{'body':'yes:1'}}})
        for source in ['if($argument)conditionalFunction=()=>{$done({})};conditionalFunction();',
                       'if($argument)conditionalValue=1;delete conditionalValue;$done({});',
                       '"use strict";if($argument)conditionalValue=1;$done({});']:
            with self.subTest(source=source),self.assertRaises(ConversionError):convert_script(source,'Fixture',URL,'')

    def test_unknown_option_mutations_and_tail_work_still_require_proof(self):
        for source in [
            'function notify(options={}){let link=null;options["open-url"]=()=>1;switch(typeof options){case "string":link=options;break;case "object":link=options["open-url"];break;default:link=""}$notification.post("t","","",link)}notify();$done({});',
            'function notify(options={}){let link=null;switch(typeof options){case "string":link=options;break;case "object":link=options["open-url"];break;default:link=""}$notification.post("t","","",link)}notify({"open-url":()=>1});$done({});',
            'function run(){$httpClient.get("https://api.test",(e,r,b)=>$done({body:b}))}run();unknown();',
        ]:
            with self.subTest(source=source),self.assertRaises(ConversionError):convert_script(source,'Fixture',URL,'')

    def test_implicit_coercion_cannot_hide_another_tail_task(self):
        start='function run(){$httpClient.get("https://api.test",(e,r,b)=>$done({body:b}))}run();'
        for tail in [
            'const data={valueOf(){$httpClient.get("https://tail.test",()=>{$persistentStore.write("tail","x")});return 1}};const value=+data;',
            'const data={toString(){unknown();return "x"}};console.log(data);',
            'const data={valueOf(){unknown();return 1}};let value=0;value+=data;',
            'const data={toString(){unknown();return "x"}};const value=`${data}`;',
            'const data={toString(){unknown();return "x"}};const value={[data]:1};',
        ]:
            with self.subTest(tail=tail),self.assertRaises(ConversionError):convert_script(start+tail,'Fixture',URL,'')

    def test_modified_scalar_methods_cannot_be_assumed_synchronous(self):
        prefix='const proto=Object.getPrototypeOf("");Object.assign(proto,{toString(){unknown();return "x"}});'
        source=prefix+'function run(){$httpClient.get("https://api.test",(e,r,b)=>$done({body:b}))}run();console.log("x".toString());'
        with self.assertRaises(ConversionError):convert_script(source,'Fixture',URL,'')

    def test_reflective_prototype_mutation_does_not_prove_missing_options(self):
        notify='function notify(options={}){let link=null;switch(typeof options){case "string":link=options;break;case "object":link=options["open-url"];break;default:link=""}$notification.post("t","","",link)}notify();$done({});'
        for get in ['Object.getPrototypeOf({})','Reflect.getPrototypeOf({})','Object.getOwnPropertyDescriptor(Object,"prototype").value']:
            source='Object.assign('+get+',{"open-url":{url:"https://a.test"}});'+notify
            with self.subTest(get=get),self.assertRaises(ConversionError):convert_script(source,'Fixture',URL,'')

    def test_reflectively_inherited_data_is_preserved_in_ordinary_js(self):
        source='Object.assign(Object.getPrototypeOf({}),{inherited:"yes"});function read(options={}){$done({body:options.inherited})}read();'
        self.check(source,{'expected':{'result':{'body':'yes'}}})

    def test_implicit_global_errors_use_intrinsic_constructor_despite_shadowing(self):
        source='const ReferenceError=function(){return {name:"changed"}};const globalThis={ReferenceError};console.log(new globalThis.ReferenceError().name);if($argument)conditionalValue="yes";let result;try{result=conditionalValue}catch(e){result=e.name}$done({body:result});'
        self.check(source,{'expected':{'result':{'body':'ReferenceError'}}})
        self.check(source,{'argument':'go','expected':{'result':{'body':'yes'}}})
