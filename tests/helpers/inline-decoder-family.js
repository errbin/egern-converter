// 内联缓存式解码器的结构回归夹具：不使用独立外壳，只在首次调用时安装
// Base64/RC4 助手并通过 arguments 缓存结果。
var iｉl = 'jsjiami.com.v7';
/* inline-decoder-start */
function II1iI11i(_0x4554b7, _0x4ed50d) {
  const _0x941244 = liiI1lli();
  return (II1iI11i = function (_0x1a2ab3, _0x2c1df6) {
    _0x1a2ab3 = _0x1a2ab3 - 0x1b6;
    let _0x5e191a = _0x941244[_0x1a2ab3];
    if (II1iI11i['SFASsu'] === undefined) {
      var _0x110ae7 = function (_0x40cf09) {
        const _0x559226 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';
        let _0x56112b = '', _0x50d848 = '';
        for (let _0x3585e4 = 0x0, _0x340b0b, _0x40cf1a, _0x238b87 = 0x0; _0x40cf1a = _0x40cf09['charAt'](_0x238b87++); ~_0x40cf1a && (_0x340b0b = _0x3585e4 % 0x4 ? _0x340b0b * 0x40 + _0x40cf1a : _0x40cf1a, _0x3585e4++ % 0x4) ? _0x56112b += String['fromCharCode'](0xff & _0x340b0b >> (-0x2 * _0x3585e4 & 0x6)) : 0x0) {
          _0x40cf1a = _0x559226['indexOf'](_0x40cf1a);
        }
        for (let _0x40fa6e = 0x0, _0x5390e7 = _0x56112b['length']; _0x40fa6e < _0x5390e7; _0x40fa6e++) {
          _0x50d848 += '%' + ('00' + _0x56112b['charCodeAt'](_0x40fa6e)['toString'](0x10))['slice'](-0x2);
        }
        return decodeURIComponent(_0x50d848);
      };
      const _0x2714a6 = function (_0x591897, _0x3de570) {
        let _0x10e364 = [], _0x92d752 = 0x0, _0x453433, _0x3f99b0 = '';
        _0x591897 = _0x110ae7(_0x591897);
        let _0x5f0376;
        for (_0x5f0376 = 0x0; _0x5f0376 < 0x100; _0x5f0376++) {
          _0x10e364[_0x5f0376] = _0x5f0376;
        }
        for (_0x5f0376 = 0x0; _0x5f0376 < 0x100; _0x5f0376++) {
          (_0x92d752 = (_0x92d752 + _0x10e364[_0x5f0376] + _0x3de570['charCodeAt'](_0x5f0376 % _0x3de570['length'])) % 0x100, _0x453433 = _0x10e364[_0x5f0376], _0x10e364[_0x5f0376] = _0x10e364[_0x92d752], _0x10e364[_0x92d752] = _0x453433);
        }
        (_0x5f0376 = 0x0, _0x92d752 = 0x0);
        for (let _0xdcf07d = 0x0; _0xdcf07d < _0x591897['length']; _0xdcf07d++) {
          (_0x5f0376 = (_0x5f0376 + 0x1) % 0x100, _0x92d752 = (_0x92d752 + _0x10e364[_0x5f0376]) % 0x100, _0x453433 = _0x10e364[_0x5f0376], _0x10e364[_0x5f0376] = _0x10e364[_0x92d752], _0x10e364[_0x92d752] = _0x453433, _0x3f99b0 += String['fromCharCode'](_0x591897['charCodeAt'](_0xdcf07d) ^ _0x10e364[(_0x10e364[_0x5f0376] + _0x10e364[_0x92d752]) % 0x100]));
        }
        return _0x3f99b0;
      };
      (II1iI11i['AFazLR'] = _0x2714a6, _0x4554b7 = arguments, II1iI11i['SFASsu'] = !![]);
    }
    const _0x32b4b5 = _0x941244[0x0], _0x5a2944 = _0x1a2ab3 + _0x32b4b5, _0x3888cd = _0x4554b7[_0x5a2944];
    return (!_0x3888cd ? (II1iI11i['wteyCf'] === undefined && (II1iI11i['wteyCf'] = !![]), _0x5e191a = II1iI11i['AFazLR'](_0x5e191a, _0x2c1df6), _0x4554b7[_0x5a2944] = _0x5e191a) : _0x5e191a = _0x3888cd, _0x5e191a);
  }, II1iI11i(_0x4554b7, _0x4ed50d));
}
/* inline-decoder-end */
function liiI1lli() {
  var a = ['jsjiami.com.v7', 'marker', 'mtaW', 'mJaW', 'mZaW'];
  liiI1lli = function () { return a; };
  return liiI1lli();
}
(function (a, b) {
  var d = II1iI11i, c = liiI1lli();
  while (!![]) {
    try {
      var e = parseInt(d(0x1b8));
      if (e === b) break;
      else c['push'](c['shift']());
    } catch (err) {
      c['push'](c['shift']());
    }
  }
}(liiI1lli, 100));
$done({body: II1iI11i(0x1b8)});
