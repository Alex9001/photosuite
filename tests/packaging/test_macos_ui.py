import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('macos_smoke', Path(__file__).resolve().parents[2] / 'scripts/verify-macos.py')
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class EditorReadiness(unittest.TestCase):
    def test_default_white_window_rejected(self):
        self.assertFalse(smoke.editor_visible('PhotoSuite File Edit View Window Help'))

    def test_editor_menus_accepted(self):
        self.assertTrue(smoke.editor_visible('PhotoSuite\nFile Edit Image Layer Select Filter View Window More Transform controls'))

    def test_partial_frontend_rejected(self):
        self.assertFalse(smoke.editor_visible('PhotoSuite File Edit Image Select Filter'))

    def test_menus_without_webview_toolbar_rejected(self):
        self.assertFalse(smoke.editor_visible('PhotoSuite Image Layer Select Filter'))

    def test_case_and_line_breaks(self):
        self.assertTrue(smoke.editor_visible('IMAGE\nLAYER\nSelect\nFilter\nTransform controls'))


if __name__ == '__main__':
    unittest.main()
