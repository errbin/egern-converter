from functools import lru_cache
import json
import hashlib
from pathlib import Path
from unittest import SkipTest
from tools.egern_hub.layout import source_path

ROOT = Path(__file__).resolve().parents[1]


@lru_cache(maxsize=1)
def source_items():
    if not (ROOT/'catalog').is_dir():
        raise SkipTest('Standalone converter tests do not fetch upstream source snapshots')
    from tools.egern_hub.catalog import load_catalog
    resources, scripts = load_catalog(ROOT)
    items = {item['id']: item for item in resources + scripts}
    for manifest in (ROOT/'catalog').glob('*.json'):
        data = json.loads(manifest.read_text())
        # Only repository discovery has a Git ref and raw-file overrides.
        # Local, release and channel sources use their catalog entries instead.
        discovery = data.get('discovery')
        if not discovery or discovery.get('type', 'repository') != 'repository':
            continue
        prefix = 'https://raw.githubusercontent.com/' + data['repository'].removeprefix('https://github.com/') + '/' + discovery['ref'] + '/'
        for overrides in ['overrides', 'script_overrides']:
            for path, value in data.get(overrides,{}).items():
                if 'id' in value:
                    items[value['id']] = {'url':prefix+path,'repository':data['repository']}
                if data['repository'].endswith('/ios151/Rewrite') and path.endswith('.js'):
                    items.setdefault('ios151-file-'+hashlib.sha256(path.encode()).hexdigest()[:16], {'url':prefix+path,'repository':data['repository']})
    return items


def source_text(identity):
    items = source_items()
    if identity not in items:
        raise SkipTest('Legacy source identity is not present in this source snapshot')
    path = source_path(ROOT, items[identity])
    if not path.is_file():
        raise SkipTest('本地上游原文未下载；运行 python build.py 后可执行此集成测试')
    return path.read_text()
