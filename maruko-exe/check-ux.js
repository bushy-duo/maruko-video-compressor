const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const viewportWidth = Number(process.argv[2] || 886);
const out = path.join(__dirname, 'verification', 'ux-' + require('./package.json').version + '-' + viewportWidth);
fs.mkdirSync(out, { recursive: true });
app.setPath('userData', fs.mkdtempSync(path.join(out, 'profile-')));
let starts = [], saveResult = false;
const replies = {
  'settings:load': () => null,
  'settings:save': () => true,
  'env:detect': () => ({ nvenc: true, amf: false, qsv: false, encoders: { hevc_nvenc: true, h264_nvenc: true }, gpus: [{ name: 'NVIDIA GeForce RTX 4090', driver: 'test', vramMB: 24576 }], ffmpeg: 'ffmpeg.exe', ffprobe: 'ffprobe.exe', ffmpegVersion: 'ffmpeg version 9.0.1' }),
  'media:probe': () => ({ ok: true, w: 1920, h: 1080, fps: 30, dur: 120, sizeMB: 80 }),
  'encode:start': (_e, payload) => { starts.push(payload); return []; },
  'encode:stop': () => 1,
  'sys:gpu': () => ({ ok: true, gpu: 30, cpu: 5, usedMB: 1024, totalMB: 24576 }),
  'fs:saveText': () => saveResult,
};
for (const [channel, fn] of Object.entries(replies)) ipcMain.handle(channel, fn);
ipcMain.on('settings:initial', event => { event.returnValue = null; });
const results = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let win;
const js = code => win.webContents.executeJavaScript(code, true);
async function check(name, code) {
  const value = await js(code);
  results.push({ name, ok: value === true, value });
}
app.whenReady().then(async () => {
  try {
    win = new BrowserWindow({ width: viewportWidth, height: 597, show: false, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false, backgroundThrottling: false, offscreen: true } });
    for (const theme of ['日间', '夜间']) for (const scale of ['小', '中', '大']) for (const view of ['queue', 'video', 'bench', 'settings']) {
      await win.loadFile(path.join(__dirname, 'renderer/index.html'), { query: { e2e: '1', audit: '1', case: `${theme}-${scale}-${view}` }, hash: view });
      await js(`__E2E.set('theme', ${JSON.stringify(theme)}); __E2E.set('fscale', ${JSON.stringify(scale)});`);
      await pause(850);
      await check(`主题状态 ${theme}/${scale}/${view}`, `document.documentElement.dataset.theme === ${JSON.stringify(theme === '日间' ? 'light' : 'dark')} && document.querySelector('[data-group="theme"] [aria-pressed="true"]').textContent === ${JSON.stringify(theme)}`);
      const value = await js(`document.getElementById('__audit')?.textContent || document.getElementById('__jserr')?.textContent || 'missing audit'`);
      results.push({ name: `布局 ${theme}/${scale}/${view}`, ok: value.startsWith('✓'), value });
      if (view === 'video') {
        const grid = await js(`(() => { const w = document.querySelector('.workspace.simple-view[data-view="video"]'); const a = w.children[0].getBoundingClientRect(); const b = w.children[1].getBoundingClientRect(); const mode = w.querySelector('#output-settings [data-group="outmode"] button[aria-pressed="true"]'); return { columns: getComputedStyle(w).gridTemplateColumns, left: {x:a.x,y:a.y,width:a.width}, right: {x:b.x,y:b.y,width:b.width}, sideBySide: Math.abs(a.y-b.y)<1 && b.x>=a.right-1, outputModeLabelFits: mode.scrollWidth <= mode.clientWidth + 1 }; })()`);
        results.push({ name: `压缩设置页左右两列和按钮完整显示 ${theme}/${scale}`, ok: grid.sideBySide && grid.right.width < grid.left.width && grid.outputModeLabelFits, value: grid });
      }
      await js(`document.getElementById('__audit')?.remove()`);
      if (scale === '中') {
        win.webContents.invalidate();
        await pause(150);
        fs.writeFileSync(path.join(out, `${theme}-${view}.png`), (await win.webContents.capturePage(undefined, { stayHidden: true })).toPNG());
      }
      await check(`用户文案 ${theme}/${scale}/${view}`, `!/(高保真原型|config\\.py|BATCH_PRESETS|extra_ffmpeg_args|附录|修正方案|原版回退|窗口固定|联动控件高度与间距)/.test(document.body.innerText + document.title)`);
      await check(`默认折叠 ${theme}/${scale}/${view}`, `!document.querySelector('.view:not([hidden]) details[open]') && !document.querySelector('.view:not([hidden]) .card-num, .view:not([hidden]) .card-meta')`);
    }
    await win.loadFile(path.join(__dirname, 'renderer/index.html'), { query: { e2e: '1' } });
    await pause(300);
    await check('空队列按钮状态', `document.getElementById('start-all').disabled && document.querySelector('[data-act="removeSel"]').disabled && document.querySelector('[data-act="stopAll"]').disabled`);
    await check('首次入口保留三项快捷设置', `document.getElementById('queue-toolbar').hidden && document.getElementById('queue-footer').hidden && document.getElementById('queue-quickbar').getClientRects().length > 0 && document.getElementById('queue-codec').textContent.includes('H.265') && document.querySelector('#queue-quickbar [data-cq-input]').value === '24' && document.getElementById('queue-res-select').value === '原样'`);
    await js(`__E2E.add('D:/test/长文件名测试视频.mp4', 80 * 1048576)`);
    await pause(200);
    await check('添加后显示开始按钮并保留快捷设置', `!document.getElementById('queue-toolbar').hidden && document.getElementById('quick-preset').value === 'H.265' && !document.getElementById('start-all').disabled && document.querySelector('#queue-quickbar [data-cq-slider]') != null`);
    await js(`document.querySelector('#q-body tr').click(); document.getElementById('start-all').focus(); document.getElementById('start-all').click()`);
    await check('确认弹窗和初始焦点', `!document.getElementById('modal-veil').hidden && document.querySelector('.app').inert && document.activeElement.dataset.act === 'confirmStart'`);
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await check('取消确认解除锁定并恢复焦点', `document.getElementById('modal-veil').hidden && !document.getElementById('start-all').disabled && document.activeElement.id === 'start-all' && document.querySelector('[data-start-label]').textContent === '开始选中'`);
    results.push({ name: '取消未启动编码', ok: starts.length === 0, value: starts.length });
    await js(`document.getElementById('start-all').click(); document.querySelector('[data-act="confirmStart"]').click()`);
    await pause(150);
    await check('转码中按钮保护', `document.getElementById('start-all').disabled && document.querySelector('[data-act="clearAll"]').disabled && !document.querySelector('[data-act="stopAll"]').disabled`);
    results.push({ name: '只启动一次', ok: starts.length === 1 && starts[0].tasks.length === 1, value: starts.length });
    const id = starts[0].tasks[0].id;
    win.webContents.send('evt', { kind: 'progress', id, seconds: 12, fps: 30 });
    await pause(50);
    await js(`window.stableRow = document.querySelector('#q-body tr'); window.stableBar = stableRow.querySelector('.bar > i');`);
    win.webContents.send('evt', { kind: 'progress', id, seconds: 48, fps: 35 });
    await pause(50);
    await check('真实事件路径的行稳定性', `stableRow === document.querySelector('#q-body tr') && stableBar === document.querySelector('#q-body .bar > i') && stableBar.style.width === '40%' && !stableRow.classList.contains('is-new')`);
    win.webContents.invalidate();
    await pause(150);
    fs.writeFileSync(path.join(out, '转码中.png'), (await win.webContents.capturePage(undefined, { stayHidden: true })).toPNG());
    win.webContents.send('evt', { kind: 'job', id, state: '完成', sizeMB: 20 });
    win.webContents.send('evt', { kind: 'batch', done: true });
    await pause(100);
    await check('完成状态和按钮恢复', `__E2E.rows()[0].st === '完成' && document.querySelector('[data-act="clearAll"]').disabled === false && document.querySelector('[data-act="stopAll"]').disabled`);
    await js(`document.querySelector('[data-act="exportLog"]').click()`);
    await pause(80);
    await check('取消保存不会显示成功', `document.getElementById('toast-text').textContent === '文件未保存'`);
    saveResult = true;
    await js(`document.querySelector('[data-act="exportLog"]').click()`);
    await pause(80);
    await check('保存后才显示成功', `document.getElementById('toast-text').textContent.startsWith('已保存 maruko-')`);
    await js(`document.querySelector('.nav-tab[data-view="settings"]').click(); document.querySelector('[data-act="openWizard"]').closest('details').open = true; document.querySelector('[data-act="openWizard"]').click()`);
    await check('向导首步按钮', `document.querySelector('[data-act="wizardPrev"]').disabled && document.querySelector('[data-act="wizardNext"]').textContent === '下一步'`);
    await js(`document.querySelector('[data-act="wizardNext"]').click(); document.querySelector('[data-act="wizardNext"]').click()`);
    await check('向导末步按钮', `document.querySelector('[data-act="wizardNext"]').textContent === '完成' && !/config\\.py|BATCH_PRESETS|附录/.test(document.getElementById('modal').innerText)`);
    await js(`document.querySelector('[data-act="wizardNext"]').click(); document.querySelector('[data-act="editExtra"]').closest('details').open = true; document.querySelector('[data-act="editExtra"]').click()`);
    await check('弹窗输入焦点', `document.activeElement.id === 'modal-extra'`);
    await js(`document.querySelector('#modal .modal-foot .btn--accent').focus(); document.dispatchEvent(new KeyboardEvent('keydown', { key:'Tab', bubbles:true, cancelable:true }));`);
    await check('Tab 循环限制在弹窗', `document.activeElement.dataset.act === 'closeModal' && document.getElementById('modal').contains(document.activeElement)`);
    await js(`document.getElementById('modal-extra').focus(); document.getElementById('modal-extra').value = '-movflags +faststart'; document.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true, cancelable:true}));`);
    await check('Enter 保存并关闭', `document.getElementById('modal-veil').hidden && document.getElementById('set-extra-text').textContent === '-movflags +faststart'`);
    await js(`document.querySelector('.nav-tab[data-view="video"]').click(); Array.from(document.querySelectorAll('.view[data-view="video"] details')).forEach(el => { el.open = true; });`);
    await check('详细功能仍可展开', `Array.from(document.querySelectorAll('#cq-input, #bitrate-field, #lut-dz, #wm-mode, #abit-field, #cmd-preview')).filter(el => !el.hidden).every(el => el.getClientRects().length > 0)`);
    await js(`document.querySelector('[data-act="gotoQueue"]').click(); document.getElementById('out-chip').click()`);
    await check('保存位置入口可直达', `!document.querySelector('.view[data-view="video"]').hidden && document.getElementById('output-settings').contains(document.activeElement)`);
    await check('生产页面不显示自检报告', `!document.getElementById('__audit') && !document.getElementById('__selftest_json') && !document.getElementById('__jserr')`);
  } catch (error) { results.push({ name: '检查异常', ok: false, value: error.stack }); }
  const report = { pass: results.filter(x => x.ok).length, fail: results.filter(x => !x.ok).length, results };
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ pass: report.pass, fail: report.fail, failures: results.filter(x => !x.ok) }, null, 2));
  app.exit(report.fail ? 1 : 0);
});
