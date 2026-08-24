import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, '..');

export function findExecutable(names) {
  const pathEnv = process.env.PATH || '';
  for (const dir of pathEnv.split(path.delimiter)) {
    for (const name of names) {
      const cands = process.platform === 'win32' ? [name, name + '.exe'] : [name];
      for (const c of cands) {
        const p = path.join(dir, c);
        try { if (fs.existsSync(p)) return p; } catch {}
      }
    }
  }
  return null;
}

export function resolvePython(config) {
  const candidates = [
    config.python,
    process.env.BYYXT_PYTHON,
    findExecutable(['python', 'python3', 'py']),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const base = path.basename(candidate).toLowerCase();
    const pythonArgs = (base === 'py.exe' || base === 'py') ? ['-3'] : [];
    try {
      const r = spawnSync(candidate, [...pythonArgs, '--version'], { stdio: 'ignore' });
      if (r.status === 0) return { python: candidate, pythonArgs };
    } catch {}
  }
  return { python: '', pythonArgs: [] };
}

export async function ensureDependencies(config, log) {
  // 1) Playwright
  let pw = null;
  let pwSource = null;
  const candidates = [];
  if (config.playwrightModuleDir) {
    candidates.push({ dir: config.playwrightModuleDir, spec: 'playwright' });
    candidates.push({ dir: config.playwrightModuleDir, spec: 'playwright-core' });
  }
  candidates.push({ dir: path.join(projectDir, 'node_modules'), spec: 'playwright' });
  candidates.push({ dir: path.join(projectDir, 'node_modules'), spec: 'playwright-core' });
  for (const c of candidates) {
    try {
      pw = createRequire(path.join(c.dir, 'package.json'))(c.spec);
      pwSource = c.dir;
      break;
    } catch {}
  }
  if (!pw) {
    log('未检测到 Playwright,正在自动安装(约 10MB,需联网)…');
    const npm = findExecutable(['npm', 'npm.cmd']);
    if (!npm) throw new Error('未找到 npm。请先安装 Node.js(含 npm):https://nodejs.org/');
    const r = spawnSync(npm, ['install', '--no-save', '--no-audit', '--no-fund', 'playwright@1.62.1'],
      { cwd: projectDir, stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status !== 0) throw new Error('Playwright 安装失败,请检查网络后重试');
    try {
      pw = createRequire(path.join(projectDir, 'node_modules', 'playwright', 'package.json'))('playwright');
      pwSource = path.join(projectDir, 'node_modules', 'playwright');
    } catch {}
    if (!pw) throw new Error('Playwright 安装后仍无法加载,请重新运行');
  }

  // 2) Chromium(找不到系统浏览器时自动下载一次)
  const exe = pw.chromium.executablePath();
  if (!fs.existsSync(exe)) {
    log('未检测到 Chromium,正在自动下载(约 150MB,只需一次)…');
    const cli = path.join(pwSource, 'cli.js');
    const r = spawnSync(process.execPath, [cli, 'install', 'chromium'],
      { cwd: projectDir, stdio: 'inherit' });
    if (r.status !== 0) throw new Error('Chromium 下载失败,请检查网络后重试');
  }

  // 3) Python(可选,仅用于验证码识别)
  const { python, pythonArgs } = resolvePython(config);
  const ocrDepsDir = path.resolve(projectDir, config.ocrDepsDir || 'pylibs');
  let ocrReady = false;
  if (python) {
    const check = spawnSync(python, [...pythonArgs, '-c', 'import ddddocr'],
      { env: { ...process.env, PYTHONPATH: ocrDepsDir }, stdio: 'ignore' });
    if (check.status !== 0) {
      log('未检测到验证码识别依赖,正在自动安装(需联网)…');
      const r = spawnSync(python, [...pythonArgs, '-m', 'pip', 'install',
        '--disable-pip-version-check', '--no-warn-script-location', '--target', ocrDepsDir,
        'ddddocr==1.5.6', 'numpy==1.26.4'],
        { cwd: projectDir, stdio: 'inherit' });
      if (r.status === 0) {
        const recheck = spawnSync(python, [...pythonArgs, '-c', 'import ddddocr'],
          { env: { ...process.env, PYTHONPATH: ocrDepsDir }, stdio: 'ignore' });
        ocrReady = recheck.status === 0;
      }
    } else {
      ocrReady = true;
    }
  } else {
    log('未检测到 Python:验证码将转人工输入(不影响其余功能)');
  }

  return { pw, python, pythonArgs, ocrReady, ocrDepsDir, projectDir };
}
