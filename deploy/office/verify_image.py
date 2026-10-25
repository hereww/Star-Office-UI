#!/usr/bin/env python3
"""Read-only image provenance check against the packaged, checksum-verified manifest."""
import hashlib,json,sys
from pathlib import Path,PurePosixPath

def verify(root, manifest_path):
    root=Path(root).resolve()
    manifest=json.loads(Path(manifest_path).read_text())
    checked=0
    for row in manifest['source_files']:
        rel=PurePosixPath(row['path'])
        if rel.is_absolute() or '..' in rel.parts or rel.parts[0] not in ('backend','frontend','deploy'):
            raise ValueError('unsafe image source path')
        path=root.joinpath(*rel.parts)
        if not path.is_file():
            raise ValueError('missing image source')
        for parent in (path,)+tuple(path.parents):
            if parent==root.parent:
                break
            if parent.is_symlink():
                raise ValueError('symlink image source')
        data=path.read_bytes()
        if len(data)!=row['bytes'] or hashlib.sha256(data).hexdigest()!=row['sha256']:
            raise ValueError('image source byte mismatch: '+str(rel))
        checked+=1
    if not checked:
        raise ValueError('empty image source manifest')
    return {'release_id':manifest['release_id'],'verified_source_files':checked,'source_bytes_match':True}

if __name__=='__main__':
    try:
        print(json.dumps(verify(sys.argv[1] if len(sys.argv)>1 else '/app',sys.argv[2] if len(sys.argv)>2 else '/app/release-manifest.json')))
    except (ValueError,OSError,KeyError,IndexError,TypeError):
        print('office_image_provenance: FAILED',file=sys.stderr)
        sys.exit(2)
