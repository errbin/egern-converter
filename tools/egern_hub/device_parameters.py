"""Expose user-selected device families only where the native compiler needs one."""
from copy import deepcopy

from .convert import dump

DEVICE_ENV = 'EGH_DEVICE_TYPE'
DEVICE_TYPES = ('iPhone', 'iPad', 'Mac')
DEVICE_SCHEMA = {
    'name': '设备类型',
    'description': '默认 iPhone；iPad / Mac 请按实际设备切换。用于原脚本的设备分类判断；待 Egern 提供原生设备类型接口后移除此临时参数。',
    'default_value': 'iPhone',
    'options': list(DEVICE_TYPES),
}


def apply_device_parameters(sources, resources, scripts, metadata):
    """Compiler metadata controls schema/default injection; no catalog overrides."""
    required = {key for key, row in metadata.items() if row.get('device_type_parameter')}
    for script in scripts:
        script['device_type_parameter'] = script['id'] in required
    by_id = {row['id']: row for row in resources}
    for source in sources:
        mapping = source.get('script_map', {})
        if source['format'] == 'egern' or not required.intersection(mapping.values()):
            continue
        obj = source['_render_obj']
        schema = obj.setdefault('env_schema', {})
        if DEVICE_ENV in schema:
            raise ValueError('设备类型参数与模块原参数冲突：' + source['id'])
        schema[DEVICE_ENV] = deepcopy(DEVICE_SCHEMA)
        for entry in obj.get('scriptings', []):
            for options in entry.values():
                if mapping.get(options.get('script_url')) in required:
                    env = options.setdefault('env', {})
                    if DEVICE_ENV in env:
                        raise ValueError('设备类型参数与脚本原参数冲突：' + source['id'])
                    # env_schema.default_value is a UI hint, not a runtime value.
                    env[DEVICE_ENV] = 'iPhone'
        by_id[source['id']]['yaml'] = source['_render_header'] + dump(obj)


def device_cases(cases):
    """Compare independently supplied legacy device inputs to all three choices."""
    result = []
    for original in cases:
        selected = original.get('env', {}).get(DEVICE_ENV)
        legacy = original.get('legacy_environment', {}).get('device-model') or original.get('legacy_loon', '')
        inferred = next((kind for kind in DEVICE_TYPES if legacy.startswith(kind)), None)
        for kind in [selected or inferred] if selected or inferred else DEVICE_TYPES:
            case = deepcopy(original)
            case['name'] += ' [' + kind + ']'
            case.setdefault('env', {})[DEVICE_ENV] = kind
            case.setdefault('legacy_loon', kind + ' fixture')
            env = case.setdefault('legacy_environment', {})
            env.setdefault('device-model', kind + '13,1')
            env.setdefault('system', 'macOS' if kind == 'Mac' else 'iOS')
            result.append(case)
    return result
