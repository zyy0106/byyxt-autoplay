import fs from 'node:fs';
import path from 'node:path';

// 仅负责把实时进度写入 progress.json,供外部程序读取
export class ProgressReporter {
  constructor({ projectDir }) {
    this.projectDir = projectDir;
    this.latest = {};
  }

  update(data) {
    this.latest = data;
    try {
      fs.writeFileSync(path.join(this.projectDir, 'progress.json'), JSON.stringify(this.latest, null, 2), 'utf8');
    } catch {}
  }

  stop() {}
}
