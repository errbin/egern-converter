"""Generate an opt-in native runtime probe; never add it to the resource catalog."""
import argparse
from pathlib import Path
from urllib.parse import urlsplit
import yaml

SCRIPT = '''export default async function(ctx) {
  const report = {
    appVersion: ctx.app.version,
    timer: {available: typeof setTimeout === 'function'},
    deviceFields: Object.keys(ctx.device || {}).sort(),
    fieldTypes: {}
  };
  // Only property names and types: no network addresses, credentials or storage.
  for (const key of ['model', 'deviceModel', 'system', 'os', 'osVersion']) {
    report.fieldTypes[key] = typeof ctx.device?.[key];
  }
  if (report.timer.available) {
    const started = Date.now();
    await new Promise(resolve => setTimeout(resolve, 20));
    report.timer.completed = true;
    report.timer.elapsedMs = Date.now() - started;
  }
  const text = JSON.stringify(report, null, 2);
  console.log(text);
  ctx.notify({title: 'Egern native API probe', body: text,
    action: {type: 'clipboard', text}});
}
'''


def generate(output, base_url):
    url = urlsplit(base_url)
    if url.scheme not in {'http', 'https'} or not url.netloc or url.query or url.fragment:
        raise ValueError('base-url must be an HTTP(S) site URL without query or fragment')
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    (output/'native-capabilities.js').write_text(SCRIPT, encoding='utf-8')
    module = {'name':'Egern 原生 API 检测',
              'description':'手动运行检测原生定时器和设备字段；点击通知复制结果。不读取请求、存储或网络地址。',
              'scriptings':[{'generic':{'name':'Native API probe',
                'script_url':base_url.rstrip('/')+'/_verification/native-capabilities.js', 'timeout':5}}]}
    (output/'native-capabilities.yaml').write_text(yaml.safe_dump(module,allow_unicode=True,sort_keys=False),encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=Path('dist/_verification'))
    parser.add_argument('--base-url',required=True)
    args = parser.parse_args()
    generate(args.output,args.base_url)
    print(args.base_url.rstrip('/')+'/_verification/native-capabilities.yaml')
