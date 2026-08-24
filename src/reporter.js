import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

function renderPage() {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>byyxt 视频自动播放 · 实时进度</title>
<style>
  body{background:#0f172a;color:#e2e8f0;font:15px/1.6 system-ui,"Microsoft YaHei",sans-serif;margin:0;padding:28px;max-width:860px;margin-left:auto;margin-right:auto;}
  h1{font-size:20px;margin:0 0 16px;}
  .bar{background:#1e293b;border-radius:8px;height:22px;overflow:hidden;}
  #fill{background:linear-gradient(90deg,#16a34a,#4ade80);height:100%;width:0;transition:width .5s;}
  .pct{font-size:28px;font-weight:700;margin:10px 0 2px;}
  .stat{color:#94a3b8;}
  .cur{color:#fbbf24;margin-top:6px;min-height:24px;}
  #log{background:#020617;border-radius:8px;padding:12px;margin-top:16px;max-height:55vh;overflow:auto;white-space:pre-wrap;word-break:break-all;font-size:12px;color:#cbd5e1;}
</style>
</head>
<body>
  <h1>byyxt 视频自动播放 · 实时进度</h1>
  <div class="bar"><div id="fill"></div></div>
  <div class="pct" id="pct">0%</div>
  <div class="stat" id="stat">正在连接…</div>
  <div class="cur" id="cur"></div>
  <pre id="log"></pre>
  <script>
    async function tick(){
      try{
        var r = await fetch('/progress.json', {cache:'no-store'});
        var d = await r.json();
        var total = d.total || 0, done = d.done || 0;
        var pct = total ? Math.min(100, Math.round(done / total * 100)) : 0;
        document.getElementById('fill').style.width = pct + '%';
        document.getElementById('pct').textContent = pct + '%';
        document.getElementById('stat').textContent =
          '已完成 ' + done + ' / ' + total + ' · 剩余 ' + Math.max(0, total - done) + ' · ' + (d.status || '');
        document.getElementById('cur').textContent = d.currentName ? '当前: ' + d.currentName : '';
        document.getElementById('log').textContent = (d.lines || []).join('\n');
        if (d.finished) document.title = '(已完成) ' + document.title.replace('(已完成) ', '');
      }catch(e){}
    }
    tick();
    setInterval(tick, 2000);
  </script>
</body>
</html>`;
}

export class ProgressReporter {
  constructor({ projectDir, port = 8899, log }) {
    this.projectDir = projectDir;
    this.port = port;
    this.log = log || (() => {});
    this.lines = [];
    this.latest = {};
    this.server = null;
    this.actualPort = port;
  }

  start() {
    let tryPort = this.port;
    const tryListen = () => {
      if (tryPort > this.port + 10) {
        this.server = null;
        this.log('进度页面启动失败(端口均被占用,不影响主流程)');
        return;
      }
      const srv = http.createServer((req, res) => {
        try {
          if (req.url === '/progress.json') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify(this.latest || {}));
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end(renderPage());
          }
        } catch {
          res.writeHead(500);
          res.end('error');
        }
      });
      srv.on('error', () => {
        try { srv.close(); } catch {}
        tryPort++;
        tryListen();
      });
      srv.listen(tryPort, '127.0.0.1', () => {
        this.server = srv;
        this.actualPort = tryPort;
        this.log(`实时进度页面: http://127.0.0.1:${tryPort} (浏览器打开可随时查看进度)`);
      });
    };
    tryListen();
  }

  line(text) {
    this.lines.push(text);
    if (this.lines.length > 150) this.lines.shift();
  }

  update(data) {
    this.latest = { ...data, lines: [...this.lines] };
    try {
      fs.writeFileSync(path.join(this.projectDir, 'progress.json'), JSON.stringify(this.latest, null, 2), 'utf8');
    } catch {}
  }

  stop() {
    try { this.server?.close(); } catch {}
    this.server = null;
  }
}
