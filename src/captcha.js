import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export class CaptchaService {
  constructor({ python, pythonArgs, ocrDepsDir, scriptPath, log }) {
    this.python = python;
    this.pythonArgs = pythonArgs || [];
    this.ocrDepsDir = ocrDepsDir;
    this.scriptPath = scriptPath;
    this.log = log || (() => {});
    this.proc = null;
    this.waiters = [];
  }

  start() {
    if (!this.python) {
      this.log('无 Python,OCR 不可用,验证码将转人工输入');
      return;
    }
    try {
      this.proc = spawn(this.python, [...this.pythonArgs, this.scriptPath], {
        env: { ...process.env, PYTHONPATH: this.ocrDepsDir, PYTHONIOENCODING: 'utf-8' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const rl = createInterface({ input: this.proc.stdout });
      rl.on('line', line => { const w = this.waiters.shift(); if (w) w(line); });
      this.proc.stderr.on('data', d => this.log('OCR: ' + d.toString().trim()));
      this.proc.on('error', e => {
        this.log('OCR 进程启动失败: ' + e.message);
        this.proc = null;
      });
      this.proc.on('exit', () => { this.proc = null; });
    } catch (e) {
      this.log('OCR 启动异常: ' + e.message);
      this.proc = null;
    }
  }

  available() {
    return !!this.proc;
  }

  recognize(pngPath, timeoutMs = 25000) {
    return new Promise(resolve => {
      if (!this.proc) return resolve('');
      let settled = false;
      const settle = text => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(text || '');
      };
      const timer = setTimeout(() => {
        const i = this.waiters.findIndex(w => w.fn === settle);
        if (i >= 0) this.waiters.splice(i, 1);
        settle('');
      }, timeoutMs);
      this.waiters.push({ fn: settle });
      try { this.proc.stdin.write(pngPath + '\n'); } catch { settle(''); }
    });
  }

  stop() {
    try { this.proc?.kill(); } catch {}
    this.proc = null;
  }
}
