"""Compile ordered Surge/Loon header actions to direct Egern Headers operations."""
import hashlib
import json
from pathlib import PurePosixPath


def dependencies_for(obj, defaults, repository, ref, origin, path):
    actions = obj.pop('_header_actions', [])
    for direction in ('request', 'response'):
        rows = [row for row in actions if row['type'] == direction]
        if not rows:
            continue
        url = origin + '#egern-headers-' + direction
        identity = 'headers-' + hashlib.sha256(url.encode()).hexdigest()[:16]
        env, code, reference = {}, [], [f'const headers = {{...${direction}.headers}};']
        for i, row in enumerate(rows):
            env['match'+str(i)] = row['match']
            field = json.dumps(row['name'], ensure_ascii=False)
            value = f'ctx.env.value{i}'
            if row['action'] != 'del':
                env['value'+str(i)] = row['value']
            operation = {'del':f'headers.delete({field});',
                         'add':f'if (headers.has({field})) headers.append({field}, {value}); else headers.set({field}, {value});',
                         'replace':f'if (headers.has({field})) {{ const count = headers.getAll({field}).length; headers.set({field}, {value}); for (let n = 1; n < count; n++) headers.append({field}, {value}); }}'}[row['action']]
            if row.get('flags'):
                env[f'flags{i}']=row['flags']
            code.append(f'  if (new RegExp(ctx.env.match{i}, ctx.env.flags{i} || "").test(ctx.request.url)) {{ {operation} }}')
            # Separate plain-object reference model, run only in the isolated verifier.
            reference += [f'if (new RegExp($environment.variables.match{i}, $environment.variables.flags{i} || "").test($request.url)) {{',
                          f'  const keys = Object.keys(headers).filter(k => k.toLowerCase() === {field}.toLowerCase());']
            v = f'$environment.variables.value{i}'
            if row['action'] == 'del':
                reference.append('  for (const k of keys) delete headers[k];')
            elif row['action'] == 'replace':
                reference.append(f'  for (const k of keys) headers[k] = Array.isArray(headers[k]) ? headers[k].map(() => {v}) : {v};')
            else:
                reference.append(f'  const k = keys[0] || {field}; headers[k] = keys.length ? [...(Array.isArray(headers[k]) ? headers[k] : [headers[k]]), {v}] : {v};')
            reference.append('}')
        reference.append('$done({headers});')
        body = (f'/*\nOriginal author: {defaults["author"]}\nSource: {origin}\n'
                'Egern adaptation: ErrBin\n*/\n\n\n'
                f'export default async function(ctx) {{\n  const headers = ctx.{direction}.headers;\n'
                + '\n'.join(code) + '\n  return {headers};\n}\n')
        script = {**defaults, 'id':identity, 'url':url, 'repository':repository, 'git_ref':ref,
                  'source_format':'egern', '_inline_body':body, '_generated_header':True,
                  '_verification_source':'\n'.join(reference), '_verification_format':'surge',
                  'output':str(PurePosixPath(path).with_suffix(''))+'.headers.'+direction+'.js'}
        entry = {'http_'+direction:{'name':PurePosixPath(script['output']).stem, 'match':'.*',
                                   'script_url':url, 'body_required':False, 'env':env}}
        yield script, entry
