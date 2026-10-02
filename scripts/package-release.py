#!/usr/bin/env python3
"""Stage deterministic release names and receipts; never publish from build jobs."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TARGETS = {
    'linux-x86_64': ('x86_64-unknown-linux-gnu', ['AppImage', 'AppImage.zsync', 'deb', 'rpm', 'tar.gz']),
    'windows-x64': ('x86_64-pc-windows-msvc', ['exe', 'zip']),
    'macos-x86_64': ('x86_64-apple-darwin', ['dmg', 'zip']),
    'macos-arm64': ('aarch64-apple-darwin', ['dmg', 'zip']),
}


def version():
    return json.loads((ROOT / 'src-tauri/tauri.conf.json').read_text())['version']


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def one(directory, pattern):
    matches = sorted(directory.glob(pattern))
    if len(matches) != 1:
        raise ValueError(f'Expected exactly one {directory}/{pattern}, found {len(matches)}')
    return matches[0]


def basename(platform, release_version):
    return f'PhotoSuite-{release_version}-{platform}'


def copy_package(source, destination):
    if not source.is_file() or source.stat().st_size == 0:
        raise ValueError(f'Missing or empty package: {source}')
    shutil.copy2(source, destination)


def archive_windows(release, output):
    # The frontend is embedded, but Tauri resources are external to the EXE.
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.write(release / 'photosuite.exe', 'PhotoSuite/photosuite.exe')
        for name in ['LICENSE', 'THIRD-PARTY-NOTICES.md']:
            archive.write(ROOT / name, f'PhotoSuite/{name}')


def stage(platform, output):
    target, extensions = TARGETS[platform]
    release = ROOT / 'src-tauri/target' / target / 'release'
    bundle = release / 'bundle'
    name = basename(platform, version())
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        raise ValueError('Staging directory must be empty; stale artifacts must not enter a release')
    if platform.startswith('linux'):
        for ext in ['AppImage', 'deb', 'rpm']:
            folder = 'appimage' if ext == 'AppImage' else ext
            copy_package(one(bundle / folder, f'*.{ext}'), output / f'{name}.{ext}')
        subprocess.run(['zsyncmake', '-u', f'{name}.AppImage', '-o',
                        f'{name}.AppImage.zsync', f'{name}.AppImage'], cwd=output, check=True)
        with tarfile.open(output / f'{name}.tar.gz', 'w:gz') as archive:
            archive.add(output / f'{name}.AppImage', arcname=f'{name}/{name}.AppImage')
            for file in ['LICENSE', 'THIRD-PARTY-NOTICES.md']:
                archive.add(ROOT / file, arcname=f'{name}/{file}')
    elif platform.startswith('windows'):
        copy_package(one(bundle / 'nsis', '*.exe'), output / f'{name}.exe')
        archive_windows(release, output / f'{name}.zip')
    else:
        copy_package(one(bundle / 'dmg', '*.dmg'), output / f'{name}.dmg')
        app = one(bundle / 'macos', '*.app')
        subprocess.run(['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent',
                        str(app), str(output / f'{name}.zip')], check=True)
    files = [output / f'{name}.{ext}' for ext in extensions]
    source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    receipt = {'platform': platform, 'version': version(), 'source': source,
               'files': {p.name: {'sha256': digest(p), 'size': p.stat().st_size} for p in files}}
    (output / f'{platform}.json').write_text(json.dumps(receipt, indent=2) + '\n')


def verify(directory, expected_source, expected_version):
    """Reject missing, additional, corrupted or mixed-commit platform artifacts."""
    inventory = {}
    expected = set()
    for platform, (_, extensions) in TARGETS.items():
        receipt_name = f'{platform}.json'
        receipt = json.loads((directory / receipt_name).read_text())
        expected.add(receipt_name)
        if (receipt['platform'], receipt['version'], receipt['source']) != (
                platform, expected_version, expected_source):
            raise ValueError(f'Wrong source, platform or version in {receipt_name}')
        names = {f'{basename(platform, expected_version)}.{ext}' for ext in extensions}
        if set(receipt['files']) != names:
            raise ValueError(f'Wrong package inventory for {platform}')
        for name in sorted(names):
            path = directory / name
            metadata = receipt['files'][name]
            if path.stat().st_size == 0 or metadata != {'sha256': digest(path), 'size': path.stat().st_size}:
                raise ValueError(f'Corrupted or empty package: {name}')
            inventory[name] = metadata
        expected.update(names)
    generated = {'SHA256SUMS', 'build-manifest.json'}
    present = {p.name for p in directory.iterdir()}
    if present & generated:
        if not generated <= present:
            raise ValueError('Incomplete generated release metadata')
        expected.update(generated)
        checksums, manifest = metadata_text(inventory, expected_source, expected_version)
        if (directory / 'SHA256SUMS').read_text() != checksums or (
                directory / 'build-manifest.json').read_text() != manifest:
            raise ValueError('Generated release metadata does not match the candidates')
    if present != expected:
        raise ValueError('Unexpected files in release candidate directory')
    return inventory


def metadata_text(inventory, source, release_version):
    checksums = ''.join(f'{data["sha256"]}  {name}\n' for name, data in sorted(inventory.items()))
    manifest = json.dumps({'source': source, 'version': release_version, 'files': inventory}, indent=2) + '\n'
    return checksums, manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    build = sub.add_parser('stage')
    build.add_argument('platform', choices=TARGETS)
    build.add_argument('directory', type=Path)
    check = sub.add_parser('verify')
    check.add_argument('directory', type=Path)
    check.add_argument('--source', required=True)
    check.add_argument('--version', required=True)
    args = parser.parse_args()
    if args.command == 'stage':
        stage(args.platform, args.directory)
    else:
        inventory = verify(args.directory, args.source, args.version)
        checksums, manifest = metadata_text(inventory, args.source, args.version)
        (args.directory / 'SHA256SUMS').write_text(checksums)
        (args.directory / 'build-manifest.json').write_text(manifest)


if __name__ == '__main__':
    main()
