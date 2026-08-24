# byyxt-autoplay

自动播放 [byyxt.pupedu.cn](https://byyxt.pupedu.cn)(北京大学出版社「云学堂」,底层为 Readoor 平台)培训任务中全部视频的命令行工具与油猴脚本。

一条命令完成:**自动登录 → 逐个视频自动播放 → 全部完成后输出结果**。

> ⚠️ 免责声明:本工具仅限用于**你自己的账号和课程**。异常的观看时长理论上可能被平台记录,请自行评估并遵守所在机构的规则。

## 功能特性

- 自动登录:优先「统一身份认证」,不可用时回退「密码登录(手机号/邮箱)」
- 图片验证码:本地 OCR 自动识别(ddddocr + OpenCV 多方案投票),失败自动换图重试,识别不出时弹出图片转人工输入
- 自动播放:16 倍速静音真实播放,绕过平台「防拖拽」限制,完成一个自动下一个
- 完成判定:同时监听平台 `pStatIf` 完成上报与视频 `ended` 事件
- 高健壮性:断点续跑、登录失效自动重登、单视频超时/报错自动跳过、防并发锁、异常退出自动清理
- 首次运行自动装依赖:Playwright、Chromium、验证码识别库,全程只需联网一次

## 目录结构

```
├── start.js                 # 主入口(配置、依赖引导、登录、执行编排)
├── start.bat / start.sh     # 一键启动(Windows / macOS·Linux)
├── config.example.json      # 配置模板(复制为 config.json 使用)
├── byyxt-autoplay.user.js   # 油猴脚本(替代方案)
├── src/
│   ├── env.js               # 环境检测与依赖自动安装
│   ├── captcha.js           # 验证码 OCR 服务(常驻进程)
│   ├── login.js             # 登录流程(CAS / 密码登录)
│   └── runner.js            # 浏览器执行与进度监控
├── ocr/captcha_ocr.py       # 验证码识别服务(OpenCV + ddddocr)
├── tools/install-node.*     # Node.js 缺失/过旧时自动下载便携版
└── .github/workflows/ci.yml # 语法检查 CI
```

## 快速开始


1. 在本仓库点绿色 **“<> Code” → “Download ZIP”**,解压;
2. 进入博雅云学堂https://byyxt.pupedu.cn ———— 进入你所选的课程————手动使用「统一身份认证」进入课程页————点击「进入学习任务」————复制浏览器顶端的url（需要包含“statudentsHomeDetails”字符串的那一个链接）并保管好————手动退出登录并退出博雅云学堂网页【**必须每一步都严格按照说明进行**】;
3. 双击 **`start.bat`**(Windows)——若检测不到必要的环境配置会自动下载,**不需要管理员权限**,不修改系统;
4. 按要求输入刚才的url和你的个人信息;
5. 等待程序运行完毕。
→ 更详细的逐步骤说明(含截图位置描述、验证码、常见问题):[docs/新手指南.md](docs/新手指南.md)

**稍微熟悉命令行**的用户也可以:

```bash
git clone https://github.com/zyy0106/byyxt-autoplay.git
cd byyxt-autoplay
cp config.example.json config.json   # 填 targetUrl(或留空,运行时粘贴)
npm install                          # 可选,程序也会自动装
node start.js
```

首次运行会自动安装缺失的依赖(Node.js、Playwright、Chromium、验证码识别库),之后直接秒开。

### Node.js 版本策略

- 程序要求 **Node.js ≥ 18**;启动器会检测版本,缺失或过旧时自动下载便携版;
- 便携版默认使用 **v24.19.0**(经过完整测试),可用环境变量 `BYYXT_NODE_VERSION` 指定其他版本;指定版本下载失败时自动回退到最新 LTS;
- 只有自动下载失败(如无网络)时,才需要手动安装:[https://nodejs.org/](https://nodejs.org/) 选 LTS 版。

## 配置(config.json)

| 字段 | 说明 | 默认 |
| --- | --- | --- |
| `targetUrl` | 任务详情页地址(`…/statudentsHomeDetails?training_id=…&spu_guid=…`) | 必填 |
| `account` / `password` | 登录账号密码,留空则运行时交互输入 | 空 |
| `playbackRate` | 播放倍速(浏览器最大 16) | 16 |
| `mute` | 静音(静音才能绕过自动播放限制) | true |
| `fastSeek` | 尝试直接跳到结尾(仅未开启防拖拽时有效,默认关更安全) | false |
| `headless` | 无头运行;`false` 显示浏览器窗口(调试用) | true |
| `browser` | `auto`(自带 Chromium)/ `chrome` / `edge` | auto |
| `limit` | 只处理 N 个视频(测试用),0=全部 | 0 |
| `timeoutMs` | 整体超时(毫秒) | 8 小时 |
| `maxWatchMs` | 单视频最长等待,超时跳过继续 | 45 分钟 |
| `profileDir` | 浏览器会话目录(登录态保存在此,重启免登录) | `.profile` |
| `maxCaptchaAttempts` | 验证码最大尝试次数 | 8 |
| `autoReloginOnLimit` | 检测到“其他登录/设备数超限”时自动重新登录(平台策略:新登录会顶掉最旧的其它会话) | true |
| `maxAutoRelogin` | 单次运行最多自动重新登录次数 | 2 |
| `python` / `playwrightModuleDir` / `ocrDepsDir` | 高级:自定义运行环境路径,一般留空自动检测 | 空 |

可选的本机特调文件 `config.local.json`(已 gitignore)会覆盖 `config.json`,适合保存机器相关路径。

## 命令行参数

```bash
node start.js --account 学号 --password 密码 --target "任务页URL" --limit 3
node start.js --headful            # 显示浏览器窗口
node start.js --browser chrome     # 使用系统 Chrome
node start.js --force              # 忽略运行锁
node start.js --help
```

环境变量:`BYYXT_ACCOUNT`、`BYYXT_PASSWORD`、`BYYXT_TARGET`、`BYYXT_LIMIT`、`BYYXT_BROWSER`、`BYYXT_PYTHON`。

## 实时进度

- 运行时黑色窗口会持续显示:已完成数量、百分比、剩余数量、预计剩余时间、当前视频;
- 进度同时写入 `progress.json`(实时覆盖),供其他程序读取;
- 结束后的汇总写入 `result.json`。

## 油猴脚本(替代方案)

适合平时已在浏览器登录的用户:

1. 安装 [Tampermonkey](https://www.tampermonkey.net/);
2. 新建脚本,粘贴 [byyxt-autoplay.user.js](byyxt-autoplay.user.js) 全部内容并保存;
3. 打开任务详情页即自动开始,右下角悬浮面板可暂停/停止。

## 工作原理

- 平台开启「防拖拽」,直接快进会被弹回,因此脚本用 **16 倍速静音真实播放**;
- 完成状态通过 `stat/pStatIf` 接口上报,脚本监听该接口并解密请求(平台前端内置固定 AES 密钥),服务端确认 `done=1` 后立即切换下一个视频;
- 登录走平台「统一身份认证」(如 `iaaa.pku.edu.cn`),密码由页面自带 JS 用 RSA 加密提交;
- 图片验证码由本地 ddddocr 识别,失败自动「换一张」重试并最终转人工。

## 常见问题

- **账号是学号,提示密码登录不接受?** 该通道只支持手机号/邮箱,请使用「统一身份认证」入口(程序默认优先)。
- **验证码一直识别错误?** 程序会自动换图重试;仍失败时会弹出图片让你人工输入。
- **Node.js 自动下载失败?** 检查网络后重试;仍失败就手动到 https://nodejs.org/ 安装 LTS 版。
- **提示“账号在其他设备登录/设备数超限”?** 平台对同一账号同时登录的设备数有限制,且**没有“一键退出所有设备”的接口**。程序检测到后会**自动重新登录**——按平台策略这会顶掉最早登录的其它会话,让本机恢复正常,然后继续;若多次自动登录仍失败才停止并提示。注意:两台电脑不要同时用同一账号跑,否则会互相顶掉。
- **粘贴地址后卡住不动?** 请确认复制的是“培训任务详情页”地址(应包含 `statudentsHomeDetails`)。如果误复制了视频播放页地址(`/c/pc/viewer`),程序会自动帮你转换成正确的任务页地址;其它不对的地址会在 45 秒内提示并退出。
- **中断了怎么办?** 完成状态保存在平台服务端,重新运行只会处理剩余视频。
- **下载依赖慢?** 先配置 npm / pip 国内镜像再运行。

## 开发

```bash
npm run check   # 本地 JS 语法检查
```

推送 PR 时 CI 会自动执行 JavaScript 与 Python 语法检查。

## License

[MIT](LICENSE) © 2026 zyy0106
