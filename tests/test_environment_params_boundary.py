"""动态节点上下文没有原生证明时必须保持未知。"""
import unittest
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.convert import ConversionError
URL = 'https://example.test/environment-params.js'


class EnvironmentParamsBoundaryTests(unittest.TestCase):
    def test_dynamic_node_and_node_info_remain_rejected(self):
        sources = [
            ('node', 'const node=$environment.params.node;'
                     '$httpClient.get({url:"https://api.test/",node},(e,r,b)=>$done({body:b}));'),
            ('nodeInfo', 'const name=$environment.params.nodeInfo.name;$done({body:name});'),
            ('whole object', '$done({body:JSON.stringify($environment.params)});'),
        ]
        for label, source in sources:
            with self.subTest(label=label), self.assertRaisesRegex(
                    ConversionError, r'未适配 API 成员：\$environment\.params'):
                convert_script(source, 'Fixture', URL, '', source_format='loon')


if __name__ == '__main__':
    unittest.main()
