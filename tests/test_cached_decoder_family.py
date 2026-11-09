"""缓存式 RC4 解码器的结构识别必须收敛到唯一解码器，且未知偏移不得被接受。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script

URL = 'https://example.test/decoder.js'

# 两个同形缓存解码器：结构识别会同时命中，collect 必须以"数量不唯一"拒绝，而不是部分折叠
MULTI = """
function t0(){var a=['aGVsbG8=','d29ybGQ='];t0=function(){return a;};return t0();}
function d0(a,b){var c=t0();return d0=function(e,f){e=e-0x10;var g=c[e];return g;},d0(a,b);}
function t1(){var a=['eA==','eQ=='];t1=function(){return a;};return t1();}
function d1(a,b){var c=t1();return d1=function(e,f){e=e-0x20;var g=c[e];return g;},d1(a,b);}
$done({body:d0(0x10)});
"""

# 偏移不是常量时结构识别必须不成立，脚本不得被静默折叠
UNKNOWN_OFFSET = """
function t0(){var a=['aGVsbG8='];t0=function(){return a;};return t0();}
function d0(a,b){var c=t0();return d0=function(e,f){e=e-1;var g=c[e];return g;},d0(a,b);}
var shift=0x10;
function d1(a,b){var c=t0();return d1=function(e,f){e=e-shift;var g=c[e];return g;},d1(a,b);}
$done({body:d1(0x10)});
"""


class CachedDecoderFamilyTests(unittest.TestCase):

    def test_multiple_cached_decoders_are_rejected_instead_of_partially_folded(self):
        with self.assertRaises(ConversionError) as caught:
            convert_script(MULTI, 'Author', URL, '')
        self.assertIn('数量不唯一', str(caught.exception))

    def test_non_constant_offset_is_not_treated_as_a_cached_decoder(self):
        with self.assertRaises(ConversionError):
            convert_script(UNKNOWN_OFFSET, 'Author', URL, '')


if __name__ == '__main__':
    unittest.main()
