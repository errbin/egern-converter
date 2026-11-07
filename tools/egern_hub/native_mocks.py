"""Compile ordered mock responses to the documented Egern ctx.respond API."""
import hashlib
import json
from pathlib import PurePosixPath


def dependencies_for(obj,defaults,repository,ref,origin,path):
    rows=obj.pop('_mock_actions',[])
    if not rows:return
    url=origin+'#egern-mocks'
    identity='mock-'+hashlib.sha256(url.encode()).hexdigest()[:16]
    code=[];reference=[]
    for row in rows:
        data=json.dumps({k:row[k] for k in ('status','headers','body')},ensure_ascii=False)
        body=('new Uint8Array('+json.dumps(row['body'])+')') if isinstance(row['body'],list) else json.dumps(row['body'],ensure_ascii=False)
        value='{status: '+str(row['status'])+', headers: '+json.dumps(row['headers'])+', body: '+body+'}'
        pattern=json.dumps(row['match'])
        code.append('  if (new RegExp('+pattern+').test(ctx.request.url)) return ctx.respond('+value+');')
        reference.append('if (new RegExp('+pattern+').test($request.url)) $done({response:'+value+'});')
    reference.append('$done({});')
    body='export default async function(ctx) {\n'+'\n'.join(code)+'\n}\n'
    script={**defaults,'id':identity,'url':url,'repository':repository,'git_ref':ref,'source_format':'egern',
            '_inline_body':f'/*\nOriginal author: {defaults["author"]}\nSource: {origin}\nEgern adaptation: ErrBin (ErrBin)\n*/\n\n\n'+body,
            '_verification_source':'\n'.join(reference),'_verification_format':'surge',
            'output':str(PurePosixPath(path).with_suffix(''))+'.mocks.js'}
    yield script,{'http_request':{'name':PurePosixPath(script['output']).stem,'match':'|'.join('(?:'+r['match']+')' for r in rows),'script_url':url,'body_required':False}}
