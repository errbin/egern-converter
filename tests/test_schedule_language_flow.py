"""Standard JS values and ordered schedule completion retain their behavior."""
import unittest
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.convert import ConversionError
from tools.egern_hub.verify import compare
URL='https://example.test/schedule.js'

class ScheduleLanguageFlowTests(unittest.TestCase):
    def check(self,source,body,**extra):
        output=convert_script(source,'Fixture',URL,'')
        result=compare(source,output,'surge',URL,{'name':'schedule flow','request':{'url':URL},'expected':{'result':{'body':body}},**extra})
        self.assertEqual(result['status'],'passed',result)
        return output

    def test_numeric_formatting_and_closed_numeric_helpers(self):
        self.check('function number(start,end){return (start+(end-start)*0.5).toFixed(2)}$done({body:number(2,4).toString()+Math.ceil(2).toPrecision(2).toString()});','3.002.0')
        for source,call in [('Number.prototype.toFixed=()=>function secret(){};$done({body:(2).toFixed().toString()});','toFixed().toString()'),
                            ('const v={toFixed(){return ()=>1}};$done({body:v.toFixed().toString()});','toFixed().toString()')]:
            output=convert_script(source,'Fixture',URL,'')
            self.assertIn(call,output)

    def test_for_in_declared_target_remains_dynamic_in_date_formatting(self):
        source='''Date.prototype.format=function(fmt){const values={"M+":this.getMonth()+1,"d+":this.getDate()};for(var token in values){if(new RegExp("("+token+")").test(fmt))fmt=fmt.replace(RegExp.$1,values[token])}return fmt};$done({body:new Date("2030-01-01T00:00:00Z").format("yyyy-MM-dd")});'''
        output=convert_script(source,'Fixture',URL,'',source_format='loon')
        fixture={'name':'for-in date formatter','entry_type':'schedule','request':{'url':URL},
                 'expected':{'result':{'body':'yyyy-1-1'}}}
        result=compare(source,output,'loon',URL,fixture)
        self.assertEqual(result['status'],'passed',result)

    def test_constructed_receiver_and_initialized_captured_global(self):
        self.check('const value=new Record();function Record(){flag="kept";this.read=()=>flag} $done({body:value.read()});','kept')
        self.check('const r=new Record();function Record(){this.read=()=>flag;flag="x"}$done({body:r.read()});','x')
        self.check('function Record(v){this.value=v}Record.prototype={constructor:Record};const r=new Record("kept");$done({body:r.value});','kept')
        # this 是标准 JavaScript：普通调用构造器、取到 constructor 后再普通调用都不再
        # 拒绝，转换后由注入的 sloppy 语义包装把 null/undefined 还原成全局对象。
        self.check('function Record(){this.value="x"}Record();$done({body:typeof this});','object')
        self.check('function Record(){this.value="x"}const r=new Record();const f=r.constructor;f();$done({body:"kept"});','kept')

    def test_http_error_status_is_a_response_and_transport_error_is_separate(self):
        source='const opts={url:"https://api.test/",throwHttpErrors:false};$httpClient.get(opts,(e,r,b)=>$done({body:e||r.status+":"+b+":"+opts.throwHttpErrors}));'
        self.check(source,'503:unavailable:false',http=[{'url':'https://api.test/','status':503,'body':'unavailable'}])
        self.check(source,'offline',http=[{'url':'https://api.test/','error':'offline'}])
        with self.assertRaisesRegex(ConversionError,'throwHttpErrors'):
            convert_script(source.replace('throwHttpErrors:false','throwHttpErrors:true'),'Fixture',URL,'')

    def test_repeated_promise_steps_keep_rejection_and_finally_order(self):
        source='let log="";Promise.resolve(1).then(v=>{log+="a";return v+1}).then(v=>{log+=v;throw Error("x")}).catch(e=>{log+=e.message;return 3}).then(v=>{log+=v;return v}).finally(()=>{log+="f"}).then(v=>$done({body:log+v}));'
        self.check(source,'a2x3f3')
        self.check('Promise.resolve(1).then(v=>$done({body:"early"})).then(()=>{throw Error("after completion")}).catch(()=>$persistentStore.write("bad","after")).finally(()=>$persistentStore.write("bad","final"));','early')

    def test_closed_factory_global_probe_from_dominated_helper(self):
        source='const prefix="kept";const api=init();run();function run(){$done({body:api.value()||isOther()?"wrong":prefix})}function init(){isOther=()=>typeof $task!=="undefined";const value=()=>isOther();return {value}}'
        self.check(source,'kept')

    def test_prototype_setup_after_launch_keeps_original_start_point(self):
        source='(async()=>{const before=Record.prototype;await Promise.resolve();$done({body:String(before!==Record.prototype)+":"+String(new Record().constructor===Record)})})();function Record(){}Record.prototype={constructor:Record};'
        self.check(source,'true:true')

    def test_qx_completion_skips_later_native_promise_handlers(self):
        source='$task.fetch({url:"https://api.test/"}).then(r=>$done({})).then(()=>$notify("late"));'
        output=convert_script(source,'Fixture',URL,'',source_format='qx')
        result=compare(source,output,'qx',URL,{'name':'QX early completion','request':{'url':URL},'http':[{'url':'https://api.test/','body':'ok'}],'expected':{'events':{'notifications':[]}}})
        self.assertEqual(result['status'],'passed',result)

    def test_shared_string_request_fields_are_read_at_each_call(self):
        source='const opts={url:"https://api.test",body:"start"};if($argument==="one")one();else two();function one(){opts.body="one";(function(o,cb){$httpClient.post(o,(e,r,b)=>cb(e,r,b))})(opts,(e,r,b)=>$done({body:b}))}function two(){opts.body="two";(function(o,cb){$httpClient.post(o,(e,r,b)=>cb(e,r,b))})(opts,(e,r,b)=>$done({body:b}))}'
        for body in ['one','two']:
            self.check(source,'ok',argument=body,http=[{'url':'https://api.test','body':'ok'}],
                       expected={'result':{'body':'ok'},'events':{'requests':[{'url':'https://api.test','method':'POST','body':body}]}})
