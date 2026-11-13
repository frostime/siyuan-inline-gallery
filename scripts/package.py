"""Rebuild and package installable files at ZIP root, plus editable source/tests."""
import json
from pathlib import Path
import subprocess
import zipfile
root = Path(__file__).resolve().parents[1]
subprocess.run(['python3', str(root / 'scripts/build.py')], check=True)
# Keep the standalone contract preview in sync with the shipped bundle.
subprocess.run(['node', str(root / 'tests/fixture.cjs')], env={**__import__('os').environ, 'WRITE_PREVIEW':'1'}, check=True)
version = json.loads((root / 'plugin.json').read_text())['version']
target = root.parent / ('siyuan-inline-gallery-' + version + '.zip')
allowed_roots = ['index.js','index.css','plugin.json','README.md','README.zh-CN.md','LICENSE','THIRD_PARTY_NOTICES.md','package.json']
files = [root / name for name in allowed_roots]
for folder in ['src','i18n','docs','scripts','tests']:
    files += [p for p in (root / folder).rglob('*') if p.is_file() and p.suffix not in {'.png','.pyc'} and '__pycache__' not in p.parts]
with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for file in sorted(files):
        archive.write(file, file.relative_to(root).as_posix())
with zipfile.ZipFile(target) as archive:
    assert archive.testzip() is None
    names = archive.namelist()
    assert all(name in names for name in allowed_roots)
    assert all(not name.startswith('/') and '..' not in Path(name).parts for name in names)
    assert b"require('./" not in archive.read('index.js')
print(f'{target} ({target.stat().st_size:,} bytes; {len(files)} files; CRC OK)')
