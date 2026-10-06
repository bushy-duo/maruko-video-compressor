const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const executable = path.resolve(process.argv[2]);
const reportPath = path.resolve(process.argv[3]);
const runs = Number(process.argv[4] || 3);
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
async function one(index) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'maruko-startup-'));
  const guiReport = path.join(temp, 'gui.json');
  const started = Date.now();
  const proc = spawn(executable, ['--gui-selftest', '--no-sandbox', '--disable-gpu', '--in-process-gpu', '--disable-gpu-sandbox'], {
    windowsHide: true, env: { ...process.env, TEMP: temp, TMP: temp, MARU_GUI_ST_OUT: guiReport }, stdio: 'ignore',
  });
  const exitCode = await new Promise(resolve => {
    const timeout = setTimeout(() => { proc.kill(); resolve('timeout'); }, 45000);
    proc.once('exit', code => { clearTimeout(timeout); resolve(code); });
    proc.once('error', error => { clearTimeout(timeout); resolve(String(error)); });
  });
  let gui = null, readyMs = null;
  if (fs.existsSync(guiReport)) {
    const outer = JSON.parse(fs.readFileSync(guiReport, 'utf8'));
    gui = JSON.parse(outer.selftest);
    // guiSelftest waits 4000 ms after did-finish-load; file time estimates the load time.
    readyMs = Math.max(0, Math.round(fs.statSync(guiReport).mtimeMs - started - 4000));
  }
  return { run: index, readyMs, totalMs: Date.now() - started, exitCode, guiPass: gui?.pass, guiFail: gui?.fail };
}
(async () => {
  const samples = [];
  for (let i = 1; i <= runs; i++) { const sample = await one(i); samples.push(sample); console.log(JSON.stringify(sample)); }
  const valid = samples.map(s => s.readyMs).filter(v => v !== null).sort((a, b) => a - b);
  const report = { executable, method: 'GUI report timestamp minus fixed 4000 ms wait; approximate UI initialization', samples, medianReadyMs: valid.length ? valid[Math.floor(valid.length / 2)] : null };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  process.exit(valid.length === runs && samples.every(s => s.exitCode === 0 && s.guiFail === 0) ? 0 : 1);
})().catch(error => { console.error(error); process.exit(1); });
