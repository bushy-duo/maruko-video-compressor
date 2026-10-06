/* 预加载：只暴露白名单方法，渲染层拿不到 require / Node 能力 */
const { contextBridge, ipcRenderer, webUtils } = require("electron");
const initialSettings = ipcRenderer.sendSync("settings:initial");

contextBridge.exposeInMainWorld("MARU", {
  isElectron: true,
  platform: process.platform,
  initialSettings,

  /* 拖放：Electron 32 起 File.path 已移除，必须用 webUtils */
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file) || ""; } catch (e) { return ""; }
  },

  detectEnv: (force = false) => ipcRenderer.invoke("env:detect", force),
  probe: (p) => ipcRenderer.invoke("media:probe", p),
  stat: (p) => ipcRenderer.invoke("fs:stat", p),
  exists: (p) => ipcRenderer.invoke("fs:exists", p),
  hash: (p) => ipcRenderer.invoke("fs:hash", p),
  walk: (dir) => ipcRenderer.invoke("fs:walk", dir),

  pickFiles: () => ipcRenderer.invoke("dialog:files"),
  pickFolder: () => ipcRenderer.invoke("dialog:folder"),
  pickOne: (opt) => ipcRenderer.invoke("dialog:one", opt || {}),
  pickDir: (opt) => ipcRenderer.invoke("dialog:dir", opt || {}),

  startBatch: (payload) => ipcRenderer.invoke("encode:start", payload),
  stopBatch: () => ipcRenderer.invoke("encode:stop"),
  startBench: (opt) => ipcRenderer.invoke("bench:start", opt),

  saveText: (name, text) => ipcRenderer.invoke("fs:saveText", { name, text }),
  openPath: (p) => ipcRenderer.invoke("shell:openPath", p),
  showItem: (p) => ipcRenderer.invoke("shell:showItem", p),
  openExternal: (url) => ipcRenderer.invoke("shell:external", url),

  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (o) => ipcRenderer.invoke("settings:save", o),

  shutdown: (sec) => ipcRenderer.invoke("sys:shutdown", sec),
  cancelShutdown: () => ipcRenderer.invoke("sys:cancelShutdown"),
  gpu: () => ipcRenderer.invoke("sys:gpu"),

  onEvent: (cb) => {
    ipcRenderer.on("evt", (_e, data) => { try { cb(data); } catch (e) { } });
  },
});
