"""Assemble the complete installable payload into dist/, then package dist/ as the ZIP.

dist/ mirrors the official plugin-sample-vite-svelte convention: everything the
installed plugin needs lives here; the ZIP archives exactly these contents.
"""
import json
from pathlib import Path
import shutil
import subprocess
import zipfile
root = Path(__file__).resolve().parents[1]
dist = root / 'dist'
required = ['index.js', 'index.css', 'plugin.json', 'package.json', 'README.md',
            'README.zh-CN.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
            'i18n/en_US.json', 'i18n/zh_CN.json']
# Rebuild dist from scratch so it cannot accumulate stale files.
if dist.exists():
    shutil.rmtree(dist)
subprocess.run(['python3', str(root / 'scripts/build.py')], check=True)
for name in required:
    if name == 'index.js':
        continue
    source = root / name
    destination = dist / name
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
# README screenshots travel with the plugin so installed docs render offline.
docs = root / 'docs'
if docs.exists():
    shutil.copytree(docs, dist / 'docs', dirs_exist_ok=True)
    required += sorted('docs/' + p.relative_to(docs).as_posix() for p in docs.rglob('*') if p.is_file())
# Keep the standalone contract preview in sync with the shipped bundle.
subprocess.run(['node', str(root / 'tests/fixture.cjs')], env={**__import__('os').environ, 'WRITE_PREVIEW':'1'}, check=True)
version = json.loads((root / 'plugin.json').read_text())['version']
target = root.parent / ('siyuan-inline-gallery-' + version + '.zip')
files = sorted(p for p in dist.rglob('*') if p.is_file())
with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for file in files:
        archive.write(file, file.relative_to(dist).as_posix())
with zipfile.ZipFile(target) as archive:
    assert archive.testzip() is None
    names = archive.namelist()
    assert all(name in names for name in required)
    assert set(names) == {p.relative_to(dist).as_posix() for p in files}
    assert all(not name.startswith('/') and '..' not in Path(name).parts for name in names)
    assert b"require('./" not in archive.read('index.js')
print(f'{target} ({target.stat().st_size:,} bytes; {len(files)} files; CRC OK)')
