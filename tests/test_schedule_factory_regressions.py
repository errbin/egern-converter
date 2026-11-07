"""Public source snapshots exercise closed factory and Promise completion repairs."""
from pathlib import Path
import unittest
from tools.egern_hub.layout import read_source
from tools.egern_hub.script_convert import convert_scripts
from tools.egern_hub.verify import compare

ROOT=Path(__file__).resolve().parents[1]
class ScheduleFactoryRegressions(unittest.TestCase):
    def test_inert_class_fields_preserve_completion(self):
        from tools.egern_hub.script_convert import convert_script
        source="""const sdk=new class{
          level={info:1<<1};
          finish(){$done({body:String(this.level.info)})}
        };sdk.finish();"""
        url='https://example.test/class-fields.js'
        output=convert_script(source,'Fixture',url,'',source_format='loon')
        result=compare(source,output,'loon',url,{'name':'class receiver ownership',
            'request':{'url':url},'expected':{'result':{'body':'2'}}})
        self.assertEqual(result['status'],'passed',result)

    def test_psn_response_graph_reaches_notifications_and_completion(self):
        url='https://raw.githubusercontent.com/Peng-YM/QuanX/master/Tasks/psn.js'
        try:source=read_source(ROOT,{'url':url})
        except FileNotFoundError:self.skipTest('Fetch public PSN snapshot first')
        output=convert_scripts([dict(id='fixture',source=source,url=url,author='Peng-YM',
            license_text='',source_format='loon',entry_types=['schedule'])])['fixture']
        case={'name':'PSN product graph','request':{'url':'https://example.test/'},
            'entry_type':'schedule','event_loop':True,'http':[{
                'url':'https://store.playstation.com/zh-hant-hk/grid/STORE-MSF86012-PLUS_FTT_CONTENT/1',
                'body':'<script>{"@context":"fixture","@graph":[{"name":"Fixture","description":"Demo","category":"Game","image":"https://example.test/image.png","sku":"fixture"}]}</script>'}]}
        result=compare(source,output,'loon',url,case)
        self.assertEqual(result['status'],'passed',result)
        self.assertTrue(result['observable_change'],result)
