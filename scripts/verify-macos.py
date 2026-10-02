#!/usr/bin/env python3
"""Launch the extracted shipping ZIP through LaunchServices on the CI runner."""
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time


def pids_for(binary):
    rows = subprocess.check_output(['ps', '-axo', 'pid=,comm='], text=True).splitlines()
    return [int(parts[0]) for row in rows if len(parts := row.strip().split(None, 1)) == 2
            and parts[1] == str(binary)]


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
            time.sleep(5)
            if launcher.poll() is not None or not pids_for(binary):
                raise RuntimeError('Extracted app exited during startup')
            subprocess.run(['screencapture', '-x', str(evidence / 'macos-startup.png')], check=True)
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
