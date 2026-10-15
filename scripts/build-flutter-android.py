"""Build Flutter using the existing app's signing identity without logging credentials."""
import argparse
import os
from pathlib import Path
import re
import shutil
import subprocess


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--no-pub', action='store_true')
    parser.add_argument('--split-per-abi', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    if os.name == 'nt':
        shell = shutil.which('pwsh') or shutil.which('powershell')
        if not shell:
            raise SystemExit('PowerShell is required for the local Android build')
        command = [shell, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(root / 'scripts/build-flutter-windows.ps1'), '-Target', 'android']
        if args.split_per_abi:
            command.append('-SplitPerAbi')
        raise SystemExit(subprocess.call(command, cwd=root))
    environment = os.environ.copy()
    legacy = (root / 'android/app/build.gradle').read_text(encoding='utf-8')
    for key, field in [('ANIME_STORE_PASSWORD', 'storePassword'), ('ANIME_KEY_ALIAS', 'keyAlias'), ('ANIME_KEY_PASSWORD', 'keyPassword')]:
        if not environment.get(key):
            match = re.search(r'\b' + field + r'\s+"([^"\r\n]+)"', legacy)
            if not match:
                raise SystemExit('Missing signing configuration: ' + key)
            environment[key] = match.group(1)
    environment.setdefault('ANIME_SIGNING_STORE', str(root / 'android/app/keystore/upload.keystore'))
    extension = '.bat' if os.name == 'nt' else ''
    sdk = Path(environment.get('FLUTTER_ROOT', root / '.tools/flutter'))
    flutter = sdk / ('bin/flutter' + extension)
    command = str(flutter) if flutter.is_file() else shutil.which('flutter')
    if not command:
        raise SystemExit('Flutter SDK not found')
    arguments = [command, 'build', 'apk', '--release', '--target-platform=android-arm,android-arm64']
    if args.no_pub:
        arguments.append('--no-pub')
    if args.split_per_abi:
        arguments.append('--split-per-abi')
    raise SystemExit(subprocess.call(arguments, cwd=root / 'flutter_app', env=environment))


if __name__ == '__main__':
    main()
