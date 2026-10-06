const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
app.setPath('userData', path.join(__dirname, 'layout-profile'));
app.whenReady().then(async () => {
  const out = path.join(__dirname, 'verification');
  fs.mkdirSync(out, { recursive: true });
  const win = new BrowserWindow({ width: 1000, height: 780, show: false });
  win.webContents.on('console-message', (_e, _level, message) => console.log(message));
  const results = [];
  for (const theme of ['日间', '夜间']) for (const scale of ['小', '中', '大']) {
    for (const view of ['queue', 'video', 'bench', 'settings']) {
      await win.loadFile(path.join(__dirname, 'renderer/index.html'), { query: { audit: '1', e2e: '1', case: `${theme}-${scale}-${view}` }, hash: view });
      console.log(await win.webContents.executeJavaScript(`JSON.stringify({url:location.href, hook:!!window.__E2E,error:document.getElementById('__jserr')?.textContent})`));
      await win.webContents.executeJavaScript(`window.__E2E.set('theme', ${JSON.stringify(theme)}); window.__E2E.set('fscale', ${JSON.stringify(scale)});`);
      await new Promise(resolve => setTimeout(resolve, 700));
      const result = await win.webContents.executeJavaScript(`document.getElementById('__audit').textContent`);
      results.push({ theme, scale, view, result });
      await win.webContents.executeJavaScript(`document.getElementById('__audit').remove()`);
      if (scale === '中') fs.writeFileSync(path.join(out, `${theme}-${view}.png`), (await win.webContents.capturePage()).toPNG());
    }
  }
  fs.writeFileSync(path.join(out, 'layout.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results.filter(x => !x.result.startsWith('✓')), null, 2));
  app.exit(results.every(x => x.result.startsWith('✓')) ? 0 : 1);
}).catch(e => { console.error(e); app.exit(1); });
