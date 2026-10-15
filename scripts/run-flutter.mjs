import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const executable = path.join(root, 'release', version, 'windows', 'anime.exe');
if (!fs.existsSync(executable)) {
  console.error('请先构建 Windows 原生版，或解压正式 Windows ZIP 后运行 anime.exe。');
  process.exit(1);
}
const child = spawn(executable, [], {cwd: path.dirname(executable), stdio: 'inherit'});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 0; });
