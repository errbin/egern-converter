import copy
import unittest

import yaml

from tools.egern_hub.convert import convert_module, dump
from tools.egern_hub.module_comments import introduction


class ModuleCommentTests(unittest.TestCase):
    def test_notes_stay_with_rules_and_survive_copy_and_rerender(self):
        source = ('#!name=Example\n# 主机名 hostname 是规则的一部分\n'
                  '[Rule]\n# 应用甲\nDOMAIN,a.test,REJECT\n'
                  '# 应用乙\nDOMAIN,b.test,DIRECT\n[URL Rewrite]\n'
                  '# 去开屏\n^https://ad.test reject\n'
                  '[MITM]\n# 需要解密\nhostname = ad.test\n')
        obj = copy.deepcopy(convert_module(source))
        obj['description'] = 'Updated'
        rendered = dump(obj)
        self.assertEqual(yaml.safe_load(rendered), obj)
        self.assertIn('# 应用甲\n- domain:', rendered)
        self.assertIn('# 应用乙\n- domain:', rendered)
        self.assertIn('# 去开屏\n- match:', rendered)
        self.assertIn('# 需要解密\nmitm:', rendered)
        self.assertEqual(introduction(source), '# 主机名 hostname 是规则的一部分\n')
        self.assertEqual(dump(obj), rendered)

    def test_metadata_separators_and_platform_faq_are_not_dumped_as_prose(self):
        source = ('#!name=Example\n#!remark=需要添加 hostname\n########\n# 常见问题\n'
                  '# 1️⃣：主机名是什么？\n# ✅：hostname 是域名\n'
                  '# 2️⃣：Loon如果插件哪个优先？\n# ✅：插件优先\n'
                  '[Rule]\n# 应用甲\nDOMAIN,a.test,REJECT\n')
        header = introduction(source)
        self.assertIn('需要添加 hostname', header)
        self.assertIn('主机名是什么', header)
        self.assertIn('hostname 是域名', header)
        self.assertNotIn('Loon', header)
        self.assertNotIn('插件优先', header)
        self.assertNotIn('应用甲', header)
        self.assertNotIn('name=', header)

    def test_disputes_removed_without_stripping_technical_words(self):
        obj = convert_module('[Rule]\n# 主机名 hostname\n# 傻逼偷别人规则\nDOMAIN,a.test,REJECT')
        self.assertIn('# 主机名 hostname', dump(obj))
        self.assertNotIn('傻逼',dump(obj))

    def test_native_text_is_not_annotated(self):
        obj=convert_module('name: Native\nrules:\n# Original note\n- domain:\n    match: a.test\n    policy: REJECT\n','egern')
        self.assertFalse(hasattr(obj,'annotations'))
