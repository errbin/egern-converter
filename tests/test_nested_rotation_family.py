"""嵌套 IIFE 轮转必须用数值校验和唯一确定，且遮蔽或外部写入仍要拒绝。"""
import base64
import json
from pathlib import Path
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / 'tests/helpers/nested-rotation-inspect.mjs'
ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='


def rc4(data, key):
    box = list(range(256))
    index = 0
    for position in range(256):
        index = (index + box[position] + key[position % len(key)]) % 256
        box[position], box[index] = box[index], box[position]
    index = 0
    cursor = 0
    output = bytearray()
    for value in data:
        index = (index + 1) % 256
        cursor = (cursor + box[index]) % 256
        box[index], box[cursor] = box[cursor], box[index]
        output.append(value ^ box[(box[index] + box[cursor]) % 256])
    return bytes(output)


def encoded_entries(kind):
    plain = ['100', '200', '300']
    if kind == 'rc4':
        # 原解码器先把 Base64 字节还原为 UTF-8 字符串，再按字符码异或。
        return [base64.b64encode(rc4(item.encode(), b'k3y').decode('latin-1').encode()).decode() for item in plain]
    return [base64.b64encode(item.encode()).decode() for item in plain]


def fixture(kind, wrapper='expr', target=200, alias='dec', extra='', factory_extra=''):
    cipher = encoded_entries(kind)
    checksum = "parseInt(da(0x10,'k3y'))" if kind == 'rc4' else 'parseInt(da(0x10))'
    values = "['jsjiami.com.v7','Xjsjiami.com.v7','%s','%s','%s']" % tuple(cipher)
    rotation = f"""(function(a,b,c,d,e,f,g){{return a=a>>0x7,f='hs',g='hs',function(x,y,z,w,v){{const da={alias};w='tfi',f=w+f,v='up',g+=v,f=z(f),g=z(g),z=0;const t=x();while(!![]&&--d+y){{try{{w={checksum};}}catch(err){{w=z;}}finally{{v=t[f]();if(a<=d)z?e?w=v:e=v:z=v;else{{if(z==e.replace(/[X]/g,'')){{if(w===y){{t['un'+f](v);break;}}t[g](v);}}}}}}}}}}(c,b,function(p){{return p=arguments[0],p=p['split'](''),p=p['reverse']('x'),p['join']('');}});}}(0x200,{target},tf,0x6))"""
    statement = f"if(({rotation},tf)){{}}" if wrapper == 'if' else f"({rotation},tf);"
    return f"""var _0xodK='jsjiami.com.v7';
function tf(){{var a={values};tf=function(){{return a;}};return tf();}}
{factory_extra}
function dec(a,b){{var c=tf();return dec=function(e,f){{e=e-0x10;var g=c[e];var A='{ALPHABET}';return g;}},dec(a,b);}}
function decShadow(x){{return x;}}
{extra}
{statement}
$done({{body:dec(0x10)}});
"""


def inspect(source):
    result = subprocess.run(
        ['node', str(HELPER)],
        input=source,
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=True,
    )
    return json.loads(result.stdout)


class NestedRotationFamilyTests(unittest.TestCase):

    def test_nested_iife_rotation_has_a_unique_numeric_result(self):
        for kind in ('base64', 'rc4'):
            for wrapper in ('expr', 'if'):
                with self.subTest(kind=kind, wrapper=wrapper):
                    data = inspect(fixture(kind, wrapper))
                    self.assertNotIn('error', data)
                    self.assertEqual(data['steps'], 1)
                    cipher = encoded_entries(kind)
                    self.assertEqual(data['values'], [cipher[1], cipher[2], cipher[0]])
                    self.assertEqual(data['factory'], 'tf')

    def test_unknown_shadowed_overwritten_and_externally_written_tables_are_rejected(self):
        cases = {
            'unknown_target': dict(target=999),
            'shadowed_decoder_alias': dict(alias='decShadow'),
            'overwritten_factory': dict(factory_extra='tf=function(){return ["eA=="];};'),
            'external_table_write': dict(extra='tf().push("evil");'),
        }
        for kind in ('base64', 'rc4'):
            for name, options in cases.items():
                with self.subTest(kind=kind, case=name):
                    data = inspect(fixture(kind, **options))
                    self.assertIn('error', data)


if __name__ == '__main__':
    unittest.main()
