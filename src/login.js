const sleep = ms => new Promise(r => setTimeout(r, ms));

function appGuidFrom(url) {
  try { return new URL(url).pathname.split('/').filter(Boolean)[0] || ''; } catch { return ''; }
}

export async function hasToken(page, targetUrl) {
  const guid = appGuidFrom(targetUrl);
  return page.evaluate(g => (g ? !!localStorage.getItem('token_' + g) : false), guid).catch(() => false);
}

async function openLoginDialog(page, log) {
  if (await page.locator('.h-login').count()) {
    await page.locator('.h-login').first().click();
    await page.waitForTimeout(2000);
    return true;
  }
  const any = page.getByText('登录', { exact: true }).first();
  if (await any.count()) {
    await any.click().catch(() => {});
    await page.waitForTimeout(2000);
    return true;
  }
  log('未找到登录入口,请确认已打开站点首页');
  return false;
}

async function checkAgreement(page) {
  const cb = page.locator('.el-dialog:visible .login_checkbox').first();
  if (!(await cb.count())) return;
  const checked = await cb.evaluate(el => el.getAttribute('aria-checked') === 'true');
  if (!checked) {
    await cb.locator('.van-checkbox__icon').first().click().catch(() => {});
    await page.waitForTimeout(400);
  }
}

function readError(page) {
  return page.evaluate(() => {
    const sel = '#msg, .van-toast, .van-field__error-message, .el-message, [class*="error"]';
    const out = [];
    document.querySelectorAll(sel).forEach(el => {
      const t = (el.innerText || el.textContent || '').trim();
      if (t && el.offsetParent && !out.includes(t)) out.push(t);
    });
    return out.slice(0, 3);
  }).catch(() => []);
}

async function solveCaptcha(page, captcha, opts, locator, pngPath, label) {
  await locator.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
  if (!(await locator.count())) return '';
  await locator.screenshot({ path: pngPath }).catch(() => {});

  let code = '';
  if (captcha && captcha.available()) {
    code = (await captcha.recognize(pngPath)).trim();
    opts.log(`第 ${opts.attempt} 次:OCR 识别${label} = "${code}"`);
  }
  if (!/^[A-Za-z0-9]{3,6}$/.test(code)) {
    if (captcha && captcha.available()) opts.log('OCR 识别失败,转人工输入');
    try { await opts.openImage(pngPath); } catch {}
    code = ((await opts.ask(`请查看已打开的验证码图片并输入(回车跳过): `)) || '').trim();
  }
  return /^[A-Za-z0-9]{3,6}$/.test(code) ? code : '';
}

/* ---------------- 统一身份认证(CAS/SSO) ---------------- */
async function casFormLogin(page, opts, platformHost) {
  const { config, captcha, log, targetUrl } = opts;
  const unameSel = ['#user_name', 'input[name="userName"]', 'input[placeholder*="学号"]',
    'input[placeholder*="职工"]', 'input[placeholder*="账号"]', 'input[placeholder*="用户"]'];
  const uname = page.locator(unameSel.join(',')).first();
  await uname.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  if (!(await uname.count())) {
    log('未识别到 SSO 登录表单');
    return false;
  }
  const pwd = page.locator('input[type="password"]:visible').first();
  const submit = page.locator('#logon_button, input[type="submit"], button[type="submit"], button:has-text("登录")').first();
  const capInput = page.locator('#valid_code, input[placeholder*="验证码"]:visible').first();
  const capImg = page.locator('#code_img, img[src*="DrawServlet"], img[src*="captcha"], img[src*="code"]').first();
  const pngPath = opts.pngDir + '/captcha_sso.png';

  for (let attempt = 1; attempt <= config.maxCaptchaAttempts; attempt++) {
    opts.attempt = attempt;
    await uname.fill(config.account);
    await pwd.fill(config.password).catch(() => {});
    const capVisible = (await capInput.count()) > 0 && await capInput.isVisible().catch(() => false);
    if (capVisible) {
      const code = await solveCaptcha(page, captcha, opts, capImg, pngPath, '验证码');
      if (code) {
        await capInput.fill(code);
      } else {
        await page.evaluate(() => { try { if (window.changeCode) window.changeCode(); } catch {} }).catch(() => {});
        const refresh = page.getByText('换一张').first();
        if (await refresh.count()) await refresh.click().catch(() => {});
        await sleep(1200);
        continue;
      }
    }
    await submit.click().catch(() => {});

    let ok = false;
    for (let t = 0; t < 15000; t += 400) {
      await sleep(400);
      try {
        if (new URL(page.url()).host === platformHost) { ok = true; break; }
      } catch {}
      if (await hasToken(page, targetUrl)) { ok = true; break; }
    }
    if (ok) {
      log('统一身份认证通过');
      return true;
    }
    const errs = await readError(page);
    log(`第 ${attempt} 次登录失败: ${errs.join(' | ') || '(无提示)'}`);
    await page.evaluate(() => { try { if (window.changeCode) window.changeCode(); } catch {} }).catch(() => {});
    const refresh = page.getByText('换一张').first();
    if (await refresh.count()) await refresh.click().catch(() => {});
    await sleep(1200);
  }
  return false;
}

/* ---------------- 平台自带密码登录(手机号/邮箱) ---------------- */
async function passwordLogin(page, opts) {
  const { config, captcha, log } = opts;
  const pwSwitch = page.locator('.login_form_bottom', { hasText: '密码登录' }).first();
  if (await pwSwitch.count()) {
    await pwSwitch.click();
    await page.waitForTimeout(1800);
  }
  const uname = page.locator('input[placeholder*="手机号"], input[placeholder*="邮箱"]').first();
  await uname.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  if (!(await uname.count())) {
    log('未识别到密码登录表单');
    return false;
  }
  if (!/^1[3-9]\d{9}$/.test(config.account) && !/^[\w.-]+@[\w-]+(\.[\w-]+)+$/.test(config.account)) {
    log('提示:当前账号不是手机号/邮箱格式,该通道可能不接受;若失败请使用统一身份认证入口');
  }
  const pwd = page.locator('input[placeholder*="密码"]').first();
  const capImg = page.locator('.login_input.captcha img').first();
  const capInput = page.locator('input[placeholder*="验证码"]').first();
  const pngPath = opts.pngDir + '/captcha_pwd.png';

  for (let attempt = 1; attempt <= config.maxCaptchaAttempts; attempt++) {
    opts.attempt = attempt;
    await checkAgreement(page);
    await uname.fill(config.account);
    await pwd.fill(config.password).catch(() => {});
    const capVisible = (await capInput.count()) > 0 && await capInput.isVisible().catch(() => false);
    if (capVisible) {
      const code = await solveCaptcha(page, captcha, opts, capImg, pngPath, '验证码');
      if (code) {
        await capInput.fill(code);
      } else {
        const refresh = page.locator('.sms_img_button').first();
        if (await refresh.count()) await refresh.click().catch(() => {});
        await sleep(1200);
        continue;
      }
    }
    await page.locator('.login_button').first().click().catch(() => {});
    let ok = false;
    for (let t = 0; t < 10000; t += 400) {
      await sleep(400);
      if (!(await page.locator('.el-dialog.login-dialog:visible').count())) { ok = true; break; }
      const agree = page.locator(':text("同意并继续")').first();
      if (await agree.count() && await agree.isVisible().catch(() => false)) {
        await agree.click().catch(() => {});
        await sleep(800);
        await page.locator('.login_button').first().click().catch(() => {});
      }
    }
    if (ok) {
      log('密码登录成功');
      return true;
    }
    const errs = await readError(page);
    log(`第 ${attempt} 次登录失败: ${errs.join(' | ') || '(无提示)'}`);
    const refresh = page.locator('.sms_img_button').first();
    if (await refresh.count()) await refresh.click().catch(() => {});
    await sleep(1200);
  }
  return false;
}

export async function ensureLogin(page, opts) {
  const { targetUrl, config, log, force } = opts;
  if (!force && await hasToken(page, targetUrl)) {
    log('已处于登录状态,跳过登录');
    return true;
  }
  if (force) {
    // 强制全新登录:清掉本地旧 token,使本次登录在平台侧顶掉最旧的其它会话
    const guid = appGuidFrom(targetUrl);
    await page.evaluate(g => {
      try { localStorage.removeItem('token_' + g); } catch {}
    }, guid).catch(() => {});
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(4000);
  }
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(6000);
  if (await hasToken(page, targetUrl)) return true;
  const limited = await page.evaluate(() =>
    /登录超过最大限制数|登录设备数超限|已在别处登录|账号在其它设备登录/.test(document.body.innerText)).catch(() => false);
  if (limited) {
    log('⚠ 警告:该账号登录设备数超限(可能存在其他设备登录),请先在其他设备退出登录后再试');
    return false;
  }
  if (!(await openLoginDialog(page, log))) return false;

  const platformHost = new URL(page.url()).host;
  const casBtn = page.locator('.denglu_text_one').first();
  if (await casBtn.count()) {
    await checkAgreement(page);
    log('点击统一身份认证入口…');
    await casBtn.click().catch(() => {});
    let leftPlatform = false;
    for (let t = 0; t < 10000; t += 400) {
      await sleep(400);
      try {
        if (new URL(page.url()).host !== platformHost) { leftPlatform = true; break; }
      } catch {}
    }
    if (leftPlatform) {
      const ok = await casFormLogin(page, opts, platformHost);
      if (ok) {
        for (let t = 0; t < 30 && !(await hasToken(page, targetUrl)); t++) await sleep(1000);
        return await hasToken(page, targetUrl);
      }
    }
    log('统一身份认证未成功,尝试平台密码登录…');
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(5000);
    if (!(await openLoginDialog(page, log))) return false;
  }
  const ok = await passwordLogin(page, opts);
  if (ok) {
    for (let t = 0; t < 30 && !(await hasToken(page, targetUrl)); t++) await sleep(1000);
    return await hasToken(page, targetUrl);
  }
  return false;
}
