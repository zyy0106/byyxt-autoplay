import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensureDependencies } from './src/env.js';
import { CaptchaService } from './src/captcha.js';
import * as login from './src/login.js';
import * as runner from './src/runner.js';
import { ProgressReporter } from './src/reporter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let reporter = null;
const log = (...a) => {
  console.log('[byyxt]', ...a);
  try { reporter?.line(a.map(String).join(' ')); } catch {}
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- 配置 ---------------- */
const DEFAULTS = {
  targetUrl: '',
  account: '',
  password: '',
  playbackRate: 16,
  mute: true,
  fastSeek: false,
  headless: true,
  browser: 'auto',
  limit: 0,
  timeoutMs: 28800000,
  maxWatchMs: 2700000,
  profileDir: '.profile',
  python: '',
  playwrightModuleDir: '',
  ocrDepsDir: 'pylibs',
  maxCaptchaAttempts: 8,
  progressPort: 8899,
  progressAutoOpen: true,
};

function loadConfig() {
  let cfg = {};
  for (const name of ['config.json', 'config.local.json']) {
    const p = path.join(__dirname, name);
    if (fs.existsSync(p)) {
      try {
        cfg = { ...cfg, ...JSON.parse(fs.readFileSync(p, 'utf8')) };
      } catch (e) {
        log(name + ' 解析失败,已忽略');
      }
    }
  }
  return cfg;
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const n = argv[i + 1];
    if (k === '--account') { a.account = n; i++; }
    else if (k === '--password') { a.password = n; i++; }
    else if (k === '--target') { a.targetUrl = n; i++; }
    else if (k === '--limit') { a.limit = Number(n); i++; }
    else if (k === '--browser') { a.browser = n; i++; }
    else if (k === '--python') { a.python = n; i++; }
    else if (k === '--headful') a.headless = false;
    else if (k === '--force') a.force = true;
    else if (k === '--help') a.help = true;
  }
  return a;
}

const HELP = `
用法: node start.js [选项]
  --account 账号      --password 密码
  --target URL        任务详情页地址(覆盖 config.json)
  --limit N           只处理 N 个视频(测试用)
  --browser auto|chrome|edge  浏览器选择
  --python 路径       Python 可执行文件路径(用于验证码 OCR)
  --headful           显示浏览器窗口(调试用)
  --force             忽略运行锁强制启动
环境变量: BYYXT_ACCOUNT / BYYXT_PASSWORD / BYYXT_TARGET / BYYXT_LIMIT / BYYXT_PYTHON
`;

/* ---------------- 交互输入 ---------------- */
function ask(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, a => { rl.close(); resolve(a); });
  });
}

function askHidden(question) {
  return new Promise(resolve => {
    let buf = '';
    const finish = val => {
      try {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
      } catch {}
      process.stdout.write('\n');
      resolve(val);
    };
    const onData = c => {
      const s = c.toString('utf8');
      for (const ch of s) {
        if (ch === '\r' || ch === '\n') return finish(buf);
        if (ch === '\u0003') { finish(''); process.exit(130); }
        if (ch === '\b' || ch === '\u007f') buf = buf.slice(0, -1);
        else buf += ch;
      }
    };
    process.stdout.write(question);
    try {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('data', onData);
    } catch {
      // 不支持 raw mode 时退化为明文输入
      ask(question).then(resolve);
    }
  });
}

function openImage(p) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', p], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [p], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [p], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {}
}

function openUrl(u) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', u], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [u], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [u], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {}
}

/* ---------------- 运行锁与清理 ---------------- */
const lockPath = path.join(__dirname, '.run.lock');
let captcha = null;
let contextHandle = null;

async function cleanup(code) {
  try { reporter?.stop(); } catch {}
  try { captcha?.stop(); } catch {}
  try { await contextHandle?.close(); } catch {}
  try { fs.rmSync(lockPath, { force: true }); } catch {}
  process.exit(code);
}

process.on('SIGINT', () => cleanup(130));
process.on('SIGTERM', () => cleanup(143));
process.on('unhandledRejection', e => {
  log('未处理异常: ' + (e?.stack || e?.message || e));
  cleanup(1);
});

/* ---------------- 主流程 ---------------- */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); return; }

  const config = {
    ...DEFAULTS,
    ...loadConfig(),
    ...(process.env.BYYXT_TARGET ? { targetUrl: process.env.BYYXT_TARGET } : {}),
    ...(process.env.BYYXT_ACCOUNT ? { account: process.env.BYYXT_ACCOUNT } : {}),
    ...(process.env.BYYXT_PASSWORD ? { password: process.env.BYYXT_PASSWORD } : {}),
    ...(process.env.BYYXT_LIMIT ? { limit: Number(process.env.BYYXT_LIMIT) } : {}),
    ...(process.env.BYYXT_BROWSER ? { browser: process.env.BYYXT_BROWSER } : {}),
    ...(process.env.BYYXT_PYTHON ? { python: process.env.BYYXT_PYTHON } : {}),
    ...args,
  };

  if (!config.targetUrl) {
    const t = (await ask('请粘贴任务详情页地址(在浏览器打开培训任务页,复制地址栏整行): ')).trim();
    if (!/^https?:\/\//.test(t)) {
      console.error('[byyxt] 地址格式不正确,应以 https:// 开头,请重新运行');
      process.exit(1);
    }
    config.targetUrl = t;
    try {
      let cfgJson = {};
      const p = path.join(__dirname, 'config.json');
      if (fs.existsSync(p)) cfgJson = JSON.parse(fs.readFileSync(p, 'utf8'));
      cfgJson.targetUrl = t;
      fs.writeFileSync(p, JSON.stringify(cfgJson, null, 2), 'utf8');
      log('已把任务地址保存到 config.json,下次运行无需再填');
    } catch (e) {
      log('保存 config.json 失败(不影响本次运行): ' + e.message);
    }
  }
  if (fs.existsSync(lockPath) && !config.force) {
    console.error('[byyxt] 检测到另一个实例正在运行(.run.lock)。确认没有其他实例后,删除该文件或加 --force 重试');
    process.exit(1);
  }
  fs.writeFileSync(lockPath, String(process.pid));

  reporter = new ProgressReporter({
    projectDir: __dirname,
    port: Number(config.progressPort || 8899),
    log,
  });

  if (!config.account) config.account = (await ask('请输入账号(学号/手机号/邮箱): ')).trim();
  if (!config.password) config.password = await askHidden('请输入密码(输入不回显): ');
  if (!config.account || !config.password) {
    console.error('[byyxt] 账号和密码不能为空');
    await cleanup(1);
    return;
  }

  log('正在检查运行环境…');
  reporter.start();
  if (config.progressAutoOpen !== false && process.env.BYYXT_PROGRESS_AUTO_OPEN !== '0') {
    openUrl(`http://127.0.0.1:${reporter.actualPort}`);
  }
  const env = await ensureDependencies(config, log);
  log(`运行环境就绪。验证码 OCR:${env.ocrReady ? '可用' : '不可用(将人工输入)'}`);

  const tmpDir = path.join(__dirname, 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });

  captcha = new CaptchaService({
    python: env.python,
    pythonArgs: env.pythonArgs,
    ocrDepsDir: env.ocrDepsDir,
    scriptPath: path.join(__dirname, 'ocr', 'captcha_ocr.py'),
    log,
  });
  captcha.start();

  const ctx = { projectDir: __dirname, pw: env.pw };
  const { context, page } = await runner.launchBrowser(ctx, config, log);
  contextHandle = context;

  const loginOpts = {
    targetUrl: config.targetUrl,
    config,
    captcha,
    log,
    pngDir: tmpDir,
    ask,
    openImage,
  };

  const logged = await login.ensureLogin(page, loginOpts);
  if (!logged) {
    console.error('[byyxt] 自动登录失败。请检查账号密码是否正确;也可把 headless 改为 false 后手动登录');
    await cleanup(2);
    return;
  }

  const hooks = {
    relogin: () => login.ensureLogin(page, loginOpts),
    onProgress: data => reporter.update(data),
  };
  const fin = await runner.run(page, ctx, config, hooks, log);

  const summary = {
    time: new Date().toISOString(),
    ok: !!(fin && fin.onList && fin.pending === 0),
    pending: fin?.pending,
    done: fin?.state?.doneCount,
    status: fin?.status,
    url: fin?.url,
  };
  fs.writeFileSync(path.join(__dirname, 'result.json'), JSON.stringify(summary, null, 2), 'utf8');
  log('完成。结果: ' + JSON.stringify(summary));
  await cleanup(0);
}

main().catch(e => {
  log('程序异常: ' + (e?.stack || e?.message || e));
  cleanup(1);
});
