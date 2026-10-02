#!/usr/bin/env python3
"""Launch the extracted shipping ZIP through LaunchServices on the CI runner."""
import os
from pathlib import Path
import signal
import re
import subprocess
import tempfile
import time


def pids_for(binary):
    rows = subprocess.check_output(['ps', '-axo', 'pid=,comm='], text=True).splitlines()
    return [int(parts[0]) for row in rows if len(parts := row.strip().split(None, 1)) == 2
            and parts[1] == str(binary)]


def editor_visible(text):
    words = set(re.findall(r'[a-z]+', text.lower()))
    menus = {'image', 'select', 'filter'} <= words
    toolbar = {'transform', 'controls'} <= words
    # A fresh app normally opens its home screen, which intentionally has no
    # editor toolbar. Require its actual in-window title and action buttons.
    title = re.search(r'photosuite\s+\d+\.\d+\.\d+', text, re.IGNORECASE)
    home = title is not None and {'new', 'open', 'from'} <= words
    return menus and (toolbar or home)


def wait_for_editor(launcher, binary, ocr, evidence):
    # Tauri first shows a default white webview and File/Edit/View menus. The
    # frontend installs Image/Layer/Select/Filter just before mounting its DOM.
    # Also require in-window home actions or the Transform controls toolbar,
    # because native menus alone do not prove that the webview rendered.
    screenshot = evidence / 'macos-startup.png'
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        if launcher.poll() is not None or not pids_for(binary):
            raise RuntimeError('Extracted app exited during frontend startup')
        subprocess.run(['screencapture', '-x', str(screenshot)], check=True)
        text = subprocess.check_output([str(ocr), str(screenshot)], text=True, timeout=15)
        (evidence / 'macos-startup-text.txt').write_text(text)
        if editor_visible(text):
            return
        time.sleep(2)
    raise RuntimeError('Home/editor UI did not render within 60 seconds; see screenshot and OCR evidence')


def main():
    archives = list(Path('dist').glob('*.zip'))
    if len(archives) != 1:
        raise ValueError('Expected exactly one macOS ZIP')
    evidence = Path('evidence')
    evidence.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='photosuite-smoke-') as temporary:
        root = Path(temporary).resolve()
        subprocess.run(['ditto', '-x', '-k', str(archives[0].resolve()), str(root)], check=True)
        app = root / 'PhotoSuite.app'
        binary = app / 'Contents/MacOS/photosuite'
        subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
        ocr = root / 'recognize-macos-ui'
        subprocess.run(['swiftc', 'scripts/recognize-macos-ui.swift', '-o', str(ocr)], check=True)
        # open -W fails if launch fails, and exits if the application closes.
        launcher = subprocess.Popen(['open', '-W', '-n', str(app)], stderr=subprocess.PIPE)
        try:
            for _ in range(30):
                if launcher.poll() is not None:
                    raise RuntimeError(f'App exited before startup: {launcher.communicate()[1]!r}')
                if pids_for(binary):
                    break
                time.sleep(1)
            else:
                raise RuntimeError('Extracted app did not start within 30 seconds')
            wait_for_editor(launcher, binary, ocr, evidence)
        finally:
            for pid in pids_for(binary):
                os.kill(pid, signal.SIGTERM)
            try:
                launcher.wait(timeout=10)
            except subprocess.TimeoutExpired:
                launcher.terminate()
                launcher.wait(timeout=5)


if __name__ == '__main__':
    main()
