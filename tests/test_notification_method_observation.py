"""通知方法引用只允许存在性观察，不把宿主对象泄漏为普通值。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script

URL = 'https://example.test/notification-method.js'


class NotificationMethodObservationTests(unittest.TestCase):
    def test_truthiness_and_typeof_observation_map_to_native_notify(self):
        for source in [
            '''if($notification.post)$notification.post("t","s","b");$done({});''',
            '''typeof $notification.post==="function"&&$notification.post("t","s","b");$done({});''',
        ]:
            for format in ['surge', 'loon']:
                with self.subTest(source=source, format=format):
                    native = convert_script(source, 'Fixture', URL, '', source_format=format)
                    self.assertIn('ctx.notify', native)
                    self.assertNotIn('$notification', native)

    def test_alias_unknown_member_and_value_escape_still_reject(self):
        sources = [
            '''const post=$notification.post;post("t","s","b");$done({});''',
            '''if($notification.unknown)$notification.post("t","s","b");$done({});''',
            '''unknown($notification.post);$done({});''',
            '''if($notification.post===$argument)$notification.post("t","s","b");$done({});''',
        ]
        for source in sources:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '', source_format='surge')


if __name__ == '__main__':
    unittest.main()
