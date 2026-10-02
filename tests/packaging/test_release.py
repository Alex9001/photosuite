"""Release inventory regressions: exercise the actual validator with fake artifacts."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('release', Path(__file__).resolve().parents[2] / 'scripts/package-release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseInventory(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = 'a' * 40
        for platform, (_, extensions) in release.TARGETS.items():
            files = {}
            for ext in extensions:
                path = self.root / f'{release.basename(platform, "1.2.3")}.{ext}'
                path.write_bytes(b'candidate bytes')
                files[path.name] = {'sha256': release.digest(path), 'size': path.stat().st_size}
            (self.root / f'{platform}.json').write_text(json.dumps({
                'source': self.source, 'version': '1.2.3', 'platform': platform, 'files': files}))

    def verify(self):
        return release.verify(self.root, self.source, '1.2.3')

    def test_complete(self):
        self.assertEqual(len(self.verify()), sum(len(value[1]) for value in release.TARGETS.values()))

    def test_missing(self):
        next(self.root.glob('*.dmg')).unlink()
        with self.assertRaises(FileNotFoundError):
            self.verify()

    def test_corrupted(self):
        next(self.root.glob('*.exe')).write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'Corrupted'):
            self.verify()

    def test_unexpected(self):
        (self.root / 'stale.exe').write_bytes(b'stale')
        with self.assertRaisesRegex(ValueError, 'Unexpected'):
            self.verify()

    def test_wrong_commit(self):
        with self.assertRaisesRegex(ValueError, 'Wrong source'):
            release.verify(self.root, 'b' * 40, '1.2.3')

    def test_wrong_version(self):
        with self.assertRaisesRegex(ValueError, 'Wrong source'):
            release.verify(self.root, self.source, '2.0.0')

    def test_generated_metadata_is_repeatable(self):
        inventory = self.verify()
        checksums, manifest = release.metadata_text(inventory, self.source, '1.2.3')
        (self.root / 'SHA256SUMS').write_text(checksums)
        (self.root / 'build-manifest.json').write_text(manifest)
        self.assertEqual(self.verify(), inventory)

    def test_corrupted_generated_metadata(self):
        inventory = self.verify()
        _, manifest = release.metadata_text(inventory, self.source, '1.2.3')
        (self.root / 'SHA256SUMS').write_text('tampered')
        (self.root / 'build-manifest.json').write_text(manifest)
        with self.assertRaisesRegex(ValueError, 'Generated release metadata'):
            self.verify()

    def test_incomplete_generated_metadata(self):
        (self.root / 'SHA256SUMS').write_text('partial')
        with self.assertRaisesRegex(ValueError, 'Incomplete generated'):
            self.verify()

    def test_zero_byte_package_with_matching_receipt(self):
        path = self.root / 'windows-x64.json'
        receipt = json.loads(path.read_text())
        name = next(iter(receipt['files']))
        package = self.root / name
        package.write_bytes(b'')
        receipt['files'][name] = {'sha256': release.digest(package), 'size': 0}
        path.write_text(json.dumps(receipt))
        with self.assertRaisesRegex(ValueError, 'Corrupted or empty'):
            self.verify()

    def test_receipt_cannot_hide_missing_format(self):
        path = self.root / 'windows-x64.json'
        receipt = json.loads(path.read_text())
        receipt['files'].pop(next(iter(receipt['files'])))
        path.write_text(json.dumps(receipt))
        with self.assertRaisesRegex(ValueError, 'Wrong package inventory'):
            self.verify()


if __name__ == '__main__':
    unittest.main()
