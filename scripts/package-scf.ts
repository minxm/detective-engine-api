import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'dist');
const stageDir = path.join(root, '.scf-build');
const zipPath = path.join(root, 'function.zip');

function run(cmd: string, cwd = root) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

if (!existsSync(distDir)) {
  run('npm run build');
}

rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });

cpSync(path.join(distDir, 'cloud-functions'), path.join(stageDir, 'cloud-functions'), { recursive: true });
cpSync(path.join(distDir, 'src'), path.join(stageDir, 'src'), { recursive: true });
cpSync(path.join(root, 'cloud-functions/scf-entry.cjs'), path.join(stageDir, 'cloud-functions/scf-entry.cjs'));
cpSync(path.join(root, 'package.json'), path.join(stageDir, 'package.json'));
cpSync(path.join(root, 'package-lock.json'), path.join(stageDir, 'package-lock.json'));

run('npm install --omit=dev --ignore-scripts', stageDir);

if (existsSync(zipPath)) rmSync(zipPath);
run(process.platform === 'win32'
  ? `powershell -NoProfile -Command "Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${zipPath}' -Force"`
  : `cd "${stageDir}" && find . -name '*.d.ts' -delete && find . -name '*.map' -delete && zip -r "${zipPath}" .`);

console.log(`\nSCF package ready: ${zipPath}`);
console.log(`Upload this zip in Tencent Cloud SCF console, handler: ${'cloud-functions/scf-entry.main'}`);
