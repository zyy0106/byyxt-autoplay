import fs from 'node:fs';
import path from 'node:path';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function launchBrowser(ctx, config, log) {
  const launchOpts = {
    headless: config.headless !== false,
    viewport: { width: 1440, height: 900 },
    args: ['--autoplay-policy=no-user-gesture-required'],
  };
  const mode = String(config.browser || 'auto').toLowerCase();
  if (mode === 'chrome' || mode === 'edge') launchOpts.channel = mode;
  const profileDir = path.resolve(ctx.projectDir, config.profileDir || '.profile');
  log('浏览器数据目录: ' + profileDir);
  const context = await ctx.pw.chromium.launchPersistentContext(profileDir, launchOpts);
  const page = context.pages()[0] || await context.newPage();
  page.on('dialog', d => { try { d.dismiss(); } catch {} });
  page.on('pageerror', e => log('页面异常: ' + e.message));
  page.on('requestfailed', r => {
    if (/pStatIf|m3u8|oauthlogin|login\.do/.test(r.url())) {
      log('请求失败: ' + r.url().slice(0, 130) + ' ' + (r.failure()?.errorText || ''));
    }
  });
  return { context, page };
}

function readUserscript(ctx) {
  const p = path.join(ctx.projectDir, 'byyxt-autoplay.user.js');
  let src = fs.readFileSync(p, 'utf8');
  src = src.replace(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/, '').trim();
  return src;
}

export async function run(page, ctx, config, hooks, log) {
  const { targetUrl } = config;
  const limit = Number(config.limit || 0);
  const timeoutMs = Number(config.timeoutMs || 8 * 60 * 60 * 1000);
  const inject = {
    playbackRate: Number(config.playbackRate ?? 16),
    mute: config.mute !== false,
    fastSeek: !!config.fastSeek,
    maxWatchMs: Number(config.maxWatchMs ?? 45 * 60 * 1000),
  };

  await page.addInitScript(cfg => { window.__BYYXT_CONFIG__ = cfg; }, inject);
  await page.addInitScript(readUserscript(ctx));
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2000);

  let authIssue = false;
  const onResponse = r => {
    const st = r.status();
    if ((st === 401 || st === 403) &&
      /pupedu\.cn|readoor\.cn/.test(r.url()) &&
      !/login|oauth|idaas|token/.test(r.url())) {
      if (!authIssue) {
        authIssue = true;
        log('检测到平台接口返回 ' + st + ',登录可能已失效或设备数超限: ' + r.url().slice(0, 120));
      }
    }
  };
  page.on('response', onResponse);

  const snapshot = () => page.evaluate(() => {
    const items = [...document.querySelectorAll('.categroy_item')];
    let pending = 0;
    items.forEach(el => {
      const img = el.querySelector('img.CoursewareIcon');
      const done = el.querySelector('.done_box .ymhicon');
      const src = img ? img.getAttribute('src') || '' : '';
      const cls = done ? done.className.toString() : '';
      if (/video_icon\.png|video\.png/.test(src) && !/Union|successTrainTeg/.test(cls)) pending++;
    });
    let st = {};
    try { st = JSON.parse(sessionStorage.getItem('__byyxt_autoplay__') || '{}'); } catch {}
    const pathname = location.pathname;
    const guid = pathname.split('/').filter(Boolean)[0] || '';
    const token = guid ? !!localStorage.getItem('token_' + guid) : true;
    const isViewer = /c\/pc\/viewer|e-textbook2/.test(pathname);
    const onList = /statudentsHomeDetails/.test(pathname);
    return {
      url: location.href,
      status: document.querySelector('#byyxt-status')?.textContent || '',
      pending,
      totalItems: items.length,
      state: st,
      token,
      isViewer,
      onList,
      loggedOut: !token && !isViewer && !onList,
      limited: /登录超过最大限制数|登录设备数超限|已在别处登录|账号在其它设备登录/.test(document.body.innerText || ''),
    };
  }).catch(() => null);

  const start = Date.now();
  let lastKey = '';
  let stopped = false;
  let final = null;
  let stopReason = null;
  let reloginTries = 0;
  const maxAutoRelogin = Number(config.maxAutoRelogin ?? 2);
  const parseCurrent = status => {
    const a = /打开: (.+)$/.exec(status || '');
    if (a) return a[1];
    const b = /播放中: (.+)$/.exec(status || '');
    return b ? b[1] : '';
  };

  while (true) {
    const s = await snapshot();
    if (s) {
      final = s;
      const total = s.state.totalPending ?? null;
      const done = s.state.doneCount ?? 0;
      const currentName = parseCurrent(s.status);
      const pct = total ? Math.min(100, Math.round(done / total * 100)) : null;
      let eta = '';
      if (total && done > 0) {
        const per = (Date.now() - start) / done;
        const mins = Math.round((total - done) * per / 60000);
        eta = mins > 0 ? `预计约 ${mins} 分钟` : '即将完成';
      }
      const key = `${s.url.slice(0, 110)}|${s.status}|${s.pending}`;
      if (key !== lastKey) {
        lastKey = key;
        log(pct !== null
          ? `进度 ${done}/${total} (${pct}%) · 剩余 ${total - done} · ${eta} · 状态: ${s.status}`
          : `状态: ${s.status}`);
      }
      if ((authIssue || s.limited) && !stopped) {
        const allowAutoRelogin = config.autoReloginOnLimit !== false && typeof hooks.forceRelogin === 'function';
        if (!allowAutoRelogin || reloginTries >= maxAutoRelogin) {
          log('⚠ 检测到该账号存在其他登录(设备数超限),且无法自动顶替,已停止。请在其他设备退出登录后重试');
          await page.evaluate(() => sessionStorage.setItem('__byyxt_autoplay_stop__', '1')).catch(() => {});
          stopped = true;
          stopReason = authIssue ? 'auth' : 'limited';
          await sleep(4000);
          break;
        }
        reloginTries++;
        log(`⚠ 检测到其他登录(设备数超限),自动重新登录(第 ${reloginTries} 次)以顶掉最旧的其它会话…`);
        const ok = await hooks.forceRelogin().catch(() => false);
        if (!ok) {
          log('⚠ 自动重新登录失败,已停止。请在其他设备退出登录后重试');
          await page.evaluate(() => sessionStorage.setItem('__byyxt_autoplay_stop__', '1')).catch(() => {});
          stopped = true;
          stopReason = 'auth';
          await sleep(4000);
          break;
        }
        authIssue = false;
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        await sleep(4000);
        continue;
      }
      if (hooks.onProgress) {
        try {
          hooks.onProgress({
            time: new Date().toISOString(),
            status: s.status,
            done,
            total,
            pending: s.pending,
            currentName,
            url: s.url,
            pct,
            eta,
          });
        } catch {}
      }

      // 登录态丢失 → 自动重新登录
      if (s.loggedOut && !stopped) {
        log('检测到登录失效,正在重新登录…');
        const ok = await hooks.relogin().catch(() => false);
        if (!ok) {
          log('重新登录失败,程序停止');
          stopReason = 'auth';
          break;
        }
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        await sleep(4000);
        continue;
      }

      // 测试限制:处理完 N 个后停止
      if (limit > 0 && done >= limit && !stopped) {
        log(`已达到 limit=${limit},发出停止标记`);
        await page.evaluate(() => sessionStorage.setItem('__byyxt_autoplay_stop__', '1')).catch(() => {});
        stopped = true;
        stopReason = 'limit';
        await sleep(15000);
        break;
      }

      // 全部完成
      if (s.onList && (s.status.includes('没有待处理') || (s.totalItems > 0 && s.pending === 0 && total !== null))) {
        log('✅ 全部视频已处理完成');
        stopReason = 'done';
        await sleep(5000);
        break;
      }

      // 脚本自行停止但仍有剩余(存在无法完成的项)
      if (s.onList && s.totalItems > 0 && s.state.running === false && !s.state.stopped && s.pending > 0) {
        const remain = await page.evaluate(() => {
          return [...document.querySelectorAll('.categroy_item')]
            .filter(el => {
              const img = el.querySelector('img.CoursewareIcon');
              const done = el.querySelector('.done_box .ymhicon');
              const src = img ? img.getAttribute('src') || '' : '';
              const cls = done ? done.className.toString() : '';
              return /video_icon\.png|video\.png/.test(src) && !/Union|successTrainTeg/.test(cls);
            })
            .map(el => el.querySelector('.categroy_item_left span')?.textContent?.trim() || '(未知)');
        }).catch(() => []);
        log('脚本已停止,剩余未完成:', JSON.stringify(remain));
        stopReason = 'incomplete';
        break;
      }
    }

    if (Date.now() - start > timeoutMs) {
      log('达到总超时,发出停止标记');
      await page.evaluate(() => sessionStorage.setItem('__byyxt_autoplay_stop__', '1')).catch(() => {});
      stopReason = 'timeout';
      await sleep(12000);
      break;
    }
    await sleep(3000);
  }

  try { page.off('response', onResponse); } catch {}
  final = await snapshot();
  if (hooks.onProgress) {
    try {
      hooks.onProgress({
        time: new Date().toISOString(),
        status: final?.status,
        done: final?.state?.doneCount ?? 0,
        total: final?.state?.totalPending ?? null,
        pending: final?.pending,
        currentName: parseCurrent(final?.status),
        url: final?.url,
        pct: final?.state?.totalPending ? Math.min(100, Math.round((final.state.doneCount || 0) / final.state.totalPending * 100)) : null,
        eta: '',
        finished: true,
      });
    } catch {}
  }
  return { ...final, stopReason };
}
