/* ============================================================
   小丸工具箱 · Electron 主进程
   职责：窗口、文件对话框、ffprobe 探测、ffmpeg 真实执行与进度、
         设置持久化、导出、环境探测、基准测试、关机调度。
   命令数组由渲染层生成（与 ffmpeg_utils.build_compress_command 同构），
   这里只负责执行，不重复实现编码参数逻辑。
   ============================================================ */
const { app, BrowserWindow, Menu, ipcMain, dialog, shell, webContents, nativeTheme } = require("electron");
const { spawn, execFile } = require("child_process");
const path = require("path");
const fs = require("fs");

const testMode = ["--gui-selftest", "--e2e-encode", "--backend-selftest"].some((flag) => process.argv.includes(flag));
if (testMode) {
  app.setPath("userData", fs.mkdtempSync(path.join(require("os").tmpdir(), "maruko-check-profile-")));
}

const WIN_W = 675;
const WIN_H = 660;

let win = null;
const jobs = new Map();      // id -> { proc, done }
let benchProc = null;
let batchCancel = false;

/* ---------- 工具定位：优先随包目录，其次 PATH，最后已知安装位置 ---------- */
function which(name) {
  const exts = process.platform === "win32" ? [".exe", ""] : [""];
  const dirs = (process.env.PATH || "").split(path.delimiter);
  for (const d of dirs) {
    for (const e of exts) {
      const p = path.join(d, name + e);
      try { if (fs.existsSync(p) && fs.statSync(p).isFile()) return p; } catch (e) { }
    }
  }
  return null;
}
function toolPath(name) {
  /* macOS 从访达启动时拿不到 shell 的 PATH，Homebrew 装的 ffmpeg 不在默认搜索路径里 */
  const macDirs = process.platform === "darwin"
    ? ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"]
    : [];
  const roots = [
    path.join(process.resourcesPath || "", "bin"),
    path.join(__dirname, "bin"),
  ].concat(macDirs);
  for (const r of roots) {
    const p = path.join(r, name + (process.platform === "win32" ? ".exe" : ""));
    try { if (fs.existsSync(p)) return p; } catch (e) { }
  }
  return which(name);
}
function ffmpegPath() { return toolPath("ffmpeg"); }
function ffprobePath() { return toolPath("ffprobe"); }

function run(bin, args, timeoutMs) {
  return new Promise((resolve) => {
    if (!bin) return resolve({ code: -1, out: "", err: "未找到可执行文件: " + bin });
    let out = "", err = "", done = false;
    let p;
    try { p = spawn(bin, args, { windowsHide: true }); }
    catch (e) { return resolve({ code: -1, out: "", err: String(e.message || e) }); }
    const timer = timeoutMs && setTimeout(() => { if (!done) { try { p.kill("SIGKILL"); } catch (e) { } } }, timeoutMs);
    p.stdout.on("data", (b) => { out += b; });
    p.stderr.on("data", (b) => { err += b; });
    p.on("error", (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ code: -1, out, err: String(e.message || e) }); } });
    p.on("close", (c) => { if (!done) { done = true; clearTimeout(timer); resolve({ code: c, out, err }); } });
  });
}

function emit(kind, payload) {
  try { win && win.webContents.send("evt", Object.assign({ kind }, payload)); } catch (e) { }
}

/* ---------- 设置持久化 ---------- */
function settingsFile() { return path.join(app.getPath("userData"), "app_settings.json"); }

/* ---------- 环境探测 ---------- */
let envDetection = null;
function detectEnv(force = false) {
  if (!envDetection || force) envDetection = collectEnv().catch(error => { envDetection = null; throw error; });
  return envDetection;
}
async function collectEnv() {
  const ff = ffmpegPath(), fp = ffprobePath();
  const res = {
    ffmpeg: ff, ffprobe: fp, ffmpegVersion: "",
    encoders: {}, gpus: [], nvenc: false, amf: false, qsv: false, cpu: true,
  };
  const gpuTask = process.platform === "win32" ? new Promise((resolve) => {
      execFile("powershell", ["-NoProfile", "-Command",
        "Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,AdapterRAM | ConvertTo-Json -Compress"
      ], { windowsHide: true, timeout: 20000 }, (err, out) => resolve(err ? "[]" : out));
    }) : Promise.resolve("[]");
  if (ff) {
    const [v, e] = await Promise.all([
      run(ff, ["-version"], 15000),
      run(ff, ["-hide_banner", "-encoders"], 25000),
    ]);
    res.ffmpegVersion = (v.out.split("\n")[0] || "").trim();
    const text = e.out + e.err;
    res.encoders.h264_nvenc = / h264_nvenc/.test(text);
    res.encoders.hevc_nvenc = / hevc_nvenc/.test(text);
    res.encoders.av1_nvenc = / av1_nvenc/.test(text);
    res.encoders.hevc_amf = / hevc_amf/.test(text);
    res.encoders.h264_amf = / h264_amf/.test(text);
    res.encoders.av1_amf = / av1_amf/.test(text);
    res.encoders.hevc_qsv = / hevc_qsv/.test(text);
    res.encoders.h264_qsv = / h264_qsv/.test(text);
    res.encoders.av1_qsv = / av1_qsv/.test(text);
    res.encoders.libx264 = / libx264 /.test(text);
    res.encoders.libx265 = / libx265 /.test(text);
    res.encoders.libsvtav1 = / libsvtav1/.test(text);
    res.encoders["libvpx-vp9"] = / libvpx-vp9/.test(text);
    res.encoders.prores_ks = / prores_ks/.test(text);
    res.nvenc = !!(res.encoders.h264_nvenc || res.encoders.hevc_nvenc);
    res.amf = !!res.encoders.hevc_amf;
    res.qsv = !!res.encoders.hevc_qsv;
  }
  if (process.platform === "win32") {
    const ps = await gpuTask;
    try {
      const j = JSON.parse(ps.trim() || "[]");
      res.gpus = (Array.isArray(j) ? j : [j])
        .map((g) => ({
          name: g.Name || "", driver: g.DriverVersion || "",
          vramMB: Math.round((Number(g.AdapterRAM) || 0) / 1048576),
        }))
        .filter((g) => g.name)
        /* 必须按显存降序：系统里常混有虚拟显示适配器，列在第一条的不是独显 */
        .sort((a, b) => b.vramMB - a.vramMB);
    } catch (e) { res.gpus = []; }
  }
  return res;
}

/* ---------- 探测单个文件 ---------- */
async function probe(p) {
  const fp = ffprobePath();
  if (!fp) return { ok: false, error: "未找到 ffprobe" };
  let sizeMB = 0;
  try { sizeMB = fs.statSync(p).size / 1048576; } catch (e) { }
  const r = await run(fp, ["-v", "error", "-print_format", "json",
    "-show_format", "-show_streams", p], 30000);
  if (r.code !== 0) return { ok: false, error: (r.err || "ffprobe 失败").slice(0, 300) };
  let j;
  try { j = JSON.parse(r.out); } catch (e) { return { ok: false, error: "ffprobe 输出无法解析" }; }
  const v = (j.streams || []).find((s) => s.codec_type === "video") || {};
  const a = (j.streams || []).find((s) => s.codec_type === "audio") || {};
  let fps = 0;
  const fr = v.avg_frame_rate || v.r_frame_rate || "0/1";
  const m = String(fr).split("/");
  if (Number(m[1])) fps = Number(m[0]) / Number(m[1]);
  const dur = Number((j.format && j.format.duration) || v.duration || 0);
  return {
    ok: true, sizeMB, dur, fps,
    w: Number(v.width) || 0, h: Number(v.height) || 0,
    vcodec: v.codec_name || "", acodec: a.codec_name || "",
    bitRate: Math.round(Number((j.format && j.format.bit_rate) || 0) / 1000),
    rotate: Number((v.side_data_list || []).filter((s) => s.rotation)[0]?.rotation || 0),
  };
}

ipcMain.handle("env:detect", (_e, force) => detectEnv(!!force));
ipcMain.handle("media:probe", (_e, p) => probe(p));

/* ---------- 执行编码 ---------- */
function parseTime(s) {
  const t = /(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s);
  return t ? Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3]) : 0;
}

function runOne(job) {
  return new Promise((resolve) => {
    const bin = ffmpegPath();
    if (!bin) { emit("log", { level: "error", text: "未找到 ffmpeg，请在设置里指定路径" }); return resolve({ id: job.id, state: "失败", error: "no-ffmpeg" }); }
    const args = job.argv.slice();
    args.push("-progress", "pipe:2", "-nostats");
    let proc;
    try { proc = spawn(bin, args, { windowsHide: true }); }
    catch (e) { return resolve({ id: job.id, state: "失败", error: String(e.message) }); }
    jobs.set(job.id, { proc });
    let errTail = "", lastEmit = 0;
    proc.stderr.on("data", (buf) => {
      const text = buf.toString();
      errTail = (errTail + text).slice(-4000);
      const now = Date.now();
      if (now - lastEmit < 250) return;
      const tm = /time=\s*([\d:.]+)/.exec(text);
      const fr = /frame=\s*(\d+)/.exec(text);
      const sp = /speed=\s*([\d.]+)x/.exec(text);
      const fp = /fps=\s*([\d.]+)/.exec(text);
      if (tm || fr) {
        lastEmit = now;
        emit("progress", {
          id: job.id, seconds: tm ? parseTime(tm[1]) : 0,
          frame: fr ? Number(fr[1]) : 0,
          speed: sp ? Number(sp[1]) : 0,
          fps: fp ? Number(fp[1]) : 0,
        });
      }
    });
    proc.on("error", (e) => {
      jobs.delete(job.id);
      emit("log", { level: "error", text: job.name + " 启动失败：" + (e.message || e) });
      resolve({ id: job.id, state: "失败", error: String(e.message || e) });
    });
    proc.on("close", (code) => {
      jobs.delete(job.id);
      let sizeMB = 0;
      try { sizeMB = fs.statSync(job.dst).size / 1048576; } catch (e) { }
      const ok = code === 0;
      if (!ok) emit("log", { level: "error", text: job.name + " 退出码 " + code + "：" + tailMeaning(errTail, code) });
      resolve({ id: job.id, state: ok ? "完成" : "失败", code, sizeMB });
    });
  });
}
function tailMeaning(err, code) {
  if (/Impossible to convert between the formats/.test(err)) return "硬件帧转 10-bit 失败（应改用 scale_cuda format=p010le 且不传 -pix_fmt）";
  if (/Cannot initialize the NVENC|nvenc/i.test(err) && /failed|error/i.test(err)) return "NVENC 初始化失败，本机可能无该硬件或被会话数占满";
  if (/No such file or directory/.test(err)) return "输入文件不存在或路径含非法字符";
  const m = err.trim().split("\n").slice(-1)[0];
  return (m || "无错误输出").slice(0, 200);
}

ipcMain.handle("encode:start", async (_e, jobs_) => {
  batchCancel = false;
  const out = [];
  /* 串行/并发都按并发数分批，避免 NVENC 会话数超限 */
  let i = 0;
  const par = Math.max(1, Number(jobs_.parallel) || 1);
  const list = jobs_.tasks || [];
  emit("log", { level: "info", text: "批次启动：" + list.length + " 个任务 · 并发 " + par });
  while (i < list.length) {
    if (batchCancel) { emit("log", { level: "warn", text: "用户停止，未启动剩余任务" }); break; }
    const wave = list.slice(i, i + par);
    i += wave.length;
    const rs = await Promise.all(wave.map(runOne));
    out.push(...rs);
    rs.forEach((r) => emit("job", { id: r.id, state: r.state, sizeMB: r.sizeMB }));
  }
  emit("batch", { done: !batchCancel, results: out });
  return out;
});
ipcMain.handle("encode:stop", () => {
  batchCancel = true;
  let n = 0;
  for (const [, j] of jobs) { try { j.proc.kill("SIGKILL"); n++; } catch (e) { } }
  emit("log", { level: "warn", text: "已终止 " + n + " 路编码进程" });
  return n;
});

/* ---------- 基准测试：同一片源逐个编码 ---------- */
ipcMain.handle("bench:start", async (_e, opt) => {
  const bin = ffmpegPath();
  if (!bin) return { ok: false, error: "未找到 ffmpeg" };
  const results = [];
  for (const item of opt.items) {
    if (batchCancel) break;
    const t0 = Date.now();
    const args = ["-hide_banner", "-y", "-ss", String(opt.start || 0), "-t", String(opt.clip || 12),
      "-i", opt.src].concat(item.argv);
    emit("bench", { encoder: item.encoder, state: "运行中" });
    const r = await run(bin, args, 600000);
    const secs = (Date.now() - t0) / 1000;
    let sizeMB = 0;
    try { sizeMB = fs.statSync(item.dst).size / 1048576; } catch (e) { }
    const ok = r.code === 0 && sizeMB > 0;
    results.push({ encoder: item.encoder, ok, secs, sizeMB, code: r.code, note: ok ? "" : tailMeaning(r.err, r.code) });
    emit("bench", { encoder: item.encoder, state: ok ? "完成" : "失败", secs, sizeMB, note: ok ? "" : tailMeaning(r.err, r.code) });
  }
  emit("bench", { state: "全部结束", results });
  return { ok: true, results };
});

/* ---------- 对话框 / 文件 ---------- */
const VIDEO_EXT = ".mp4 .mov .mkv .avi .wmv .flv .webm .m4v .ts .mts .m2ts .rm .rmvb .vob .mpg .mpeg";

ipcMain.handle("dialog:files", async () => {
  const r = await dialog.showOpenDialog(win, {
    title: "选择视频文件", properties: ["openFile", "multiSelections"],
    filters: [{ name: "视频文件", extensions: VIDEO_EXT.split(" ").map((s) => s.slice(1)) }, { name: "所有文件", extensions: ["*"] }],
  });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle("dialog:folder", async () => {
  const r = await dialog.showOpenDialog(win, { title: "选择视频文件夹", properties: ["openDirectory"] });
  if (r.canceled) return [];
  const out = [];
  const walk = (d) => {
    let es;
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (VIDEO_EXT.split(" ").includes(path.extname(e.name).toLowerCase())) out.push(p);
    }
  };
  walk(r.filePaths[0]);
  return out;
});
ipcMain.handle("dialog:one", async (_e, opt) => {
  const r = await dialog.showOpenDialog(win, {
    title: opt.title || "选择文件", properties: ["openFile"],
    filters: opt.filters || [{ name: "所有文件", extensions: ["*"] }],
  });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle("dialog:dir", async (_e, opt) => {
  const r = await dialog.showOpenDialog(win, { title: (opt && opt.title) || "选择目录", properties: ["openDirectory"] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle("fs:stat", (_e, p) => {
  try { const s = fs.statSync(p); return { ok: true, sizeMB: s.size / 1048576, isDir: s.isDirectory() }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});
/* 拖入整个文件夹时递归收集视频，对应原版 _add_paths 的 rglob */
ipcMain.handle("fs:walk", (_e, dir) => {
  const out = [];
  const exts = VIDEO_EXT.split(" ");
  const walk = (d, depth) => {
    if (depth > 8 || out.length > 5000) return;
    let es;
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (exts.includes(path.extname(e.name).toLowerCase())) out.push(p);
    }
  };
  try { if (fs.statSync(dir).isDirectory()) walk(dir, 0); } catch (e) { }
  return out;
});
ipcMain.handle("fs:exists", (_e, p) => { try { return fs.existsSync(p); } catch (e) { return false; } });
/* 隐藏水印的图片载荷需要 SHA-1 前 16 位，对齐 build_hidden_watermark_payload */
ipcMain.handle("fs:hash", async (_e, p) => {
  try {
    const buf = fs.readFileSync(p);
    const digest = require("crypto").createHash("sha1").update(buf).digest("hex").slice(0, 16);
    return { ok: true, digest, sizeMB: buf.length / 1048576, name: path.basename(p) };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});
ipcMain.handle("fs:saveText", async (_e, o) => {
  const r = await dialog.showSaveDialog(win, { title: "保存", defaultPath: o.name });
  if (r.canceled) return false;
  try { fs.writeFileSync(r.filePath, o.text, "utf8"); emit("log", { level: "ok", text: "已保存 " + r.filePath }); return true; }
  catch (e) { emit("log", { level: "error", text: "保存失败：" + e.message }); return false; }
});
ipcMain.handle("shell:openPath", (_e, p) => shell.openPath(p));
ipcMain.handle("shell:showItem", (_e, p) => { shell.showItemInFolder(p); return true; });
ipcMain.handle("shell:external", (_e, url) => {
  if (url !== "https://github.com/arenascats/MarukoToolbox-Rewrite") return false;
  return shell.openExternal(url).then(() => true);
});

/* ---------- 设置 ---------- */
function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile(), "utf8")); } catch (_) { return null; }
}
ipcMain.on("settings:initial", event => { event.returnValue = readSettings(); });
ipcMain.handle("settings:load", () => readSettings());
ipcMain.handle("settings:save", (_e, o) => {
  try { fs.writeFileSync(settingsFile(), JSON.stringify(o, null, 2), "utf8"); return true; } catch (e) { return false; }
});

/* ---------- 真实资源占用（GPU 走 nvidia-smi，CPU 走 Electron 自带采样） ---------- */
ipcMain.handle("sys:gpu", async () => {
  const out = { ok: false, gpu: 0, usedMB: 0, totalMB: 0, cpu: 0, name: "" };
  try { out.cpu = Math.round((process.getCPUUsage ? process.getCPUUsage().cpuPercent : 0) * 10) / 10; } catch (e) { }
  const r = await run("nvidia-smi",
    ["--query-gpu=name,utilization.gpu,memory.used,memory.total,driver_version", "--format=csv,noheader,nounits"], 8000);
  if (r.code === 0) {
    const l = (r.out || "").trim().split("\n")[0].split(",").map((s) => s.trim());
    out.ok = true; out.name = l[0] || ""; out.gpu = Number(l[1]) || 0;
    out.usedMB = Number(l[2]) || 0; out.totalMB = Number(l[3]) || 0; out.driver = l[4] || "";
  }
  return out;
});

/* ---------- 关机（可撤销，默认关闭） ---------- */
ipcMain.handle("sys:shutdown", async (_e, sec) => {
  if (process.platform !== "win32") {
    emit("log", { level: "warn", text: "自动关机仅支持 Windows，本批次已跳过该步骤" });
    return { ok: false, error: "仅 Windows 支持" };
  }
  const r = await run("shutdown", ["/s", "/t", String(sec || 20)], 8000);
  return { ok: r.code === 0, code: r.code };
});
ipcMain.handle("sys:cancelShutdown", async () => {
  if (process.platform !== "win32") return { ok: false };
  const r = await run("shutdown", ["/a"], 8000);
  return { ok: r.code === 0 };
});

/* ---------- 后端自检：--backend-selftest 时不启界面，只验证真实能力 ---------- */
async function backendSelftest(outFile) {
  const R = [];
  const T = async (name, fn) => {
    try {
      const r = await fn();
      /* 约定：返回 true / undefined / "" 视为通过；返回字符串视为失败原因 */
      const ok = (r === true || r === undefined || r === "");
      R.push({ name, ok, info: typeof r === "string" ? r : (r === false ? "断言为假" : "") });
    }
    catch (e) { R.push({ name, ok: false, info: String(e.message || e) }); }
  };
  /* 期望失败：用来证明"原版的写法确实坏"，而不是只证明新写法能跑 */
  const TFail = async (name, fn) => {
    try {
      const r = await fn();
      R.push({ name, ok: r !== true, info: r === true ? "竟然成功了，结论需复核" : "如预期失败" });
    }
    catch (e) { R.push({ name, ok: true, info: "如预期抛错" }); }
  };
  const os = require("os");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maruko-st-"));
  const env = await detectEnv();
  R.push({ name: "环境探测", ok: !!env.ffmpeg && !!env.nvenc, info: (env.ffmpegVersion || "").slice(0, 60) + " · NVENC=" + env.nvenc + " · GPU=" + ((env.gpus[0] || {}).name || "-") });

  const clip = path.join(tmp, "in.mkv");
  await T("生成测试片源（lavfi testsrc 4 秒 640×480@30）", async () => {
    const r = await run(env.ffmpeg, ["-hide_banner", "-y", "-f", "lavfi", "-i",
      "testsrc=size=640x480:rate=30:duration=4", "-pix_fmt", "yuv420p", clip], 120000);
    if (r.code !== 0) return "退出码 " + r.code + " " + r.err.slice(-160);
    return fs.existsSync(clip);
  });

  await T("ffprobe 探测真实规格", async () => {
    const p = await probe(clip);
    if (!p.ok) return p.error;
    if (p.w !== 640 || p.h !== 480) return "分辨率不符 " + p.w + "×" + p.h;
    if (!p.dur || p.dur < 3.5) return "时长不符 " + p.dur;
    return "";
  });

  /* pre = 放在 -i 之前的参数（-hwaccel 必须在输入前，这是原版的顺序） */
  const encTest = async (label, pre, enc, expectMain10) => T(label, async () => {
    const dst = path.join(tmp, "out-" + label.replace(/[^\w]/g, "").slice(0, 18) + ".mp4");
    const r = await run(env.ffmpeg, ["-hide_banner", "-y"].concat(pre || []).concat(["-i", clip])
      .concat(enc).concat(["-map_metadata", "0", dst]), 240000);
    if (r.code !== 0) return "退出码 " + r.code + "：" + (r.err.trim().split("\n").slice(-1)[0] || "").slice(0, 200);
    if (!fs.existsSync(dst) || fs.statSync(dst).size < 1000) return "输出过小或不存在";
    if (expectMain10) {
      const p = await run(env.ffprobe, ["-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=codec_name,profile,pix_fmt", "-of", "csv=p=0", dst], 30000);
      const line = (p.out || "").trim();
      if (!/Main 10/.test(line) || !/yuv420p10le/.test(line)) return "未产出 10-bit：" + line;
    }
    return "";
  });

  const nvencBase = ["-c:v", "hevc_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "24", "-b:v", "0"];
  await encTest("hevc_nvenc 8-bit", [], nvencBase);
  await encTest("hevc_nvenc 10-bit（附录 A 修正：scale_cuda format=p010le 且不传 -pix_fmt）",
    ["-hwaccel", "cuda", "-hwaccel_output_format", "cuda"], nvencBase.concat(["-vf", "scale_cuda=format=p010le"]), true);
  await TFail("反证：原版写法（10-bit 传 -pix_fmt p010le + 全 GPU 管线）应当失败", async () => {
    const dst = path.join(tmp, "out-bad10.mp4");
    const r = await run(env.ffmpeg, ["-hide_banner", "-y", "-hwaccel", "cuda", "-hwaccel_output_format", "cuda",
      "-i", clip].concat(nvencBase).concat(["-pix_fmt", "p010le", dst]), 240000);
    return r.code === 0;   /* 返回 true 表示"竟然成功了"，即结论需复核 */
  });
  await encTest("h264_nvenc", [], ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "24", "-b:v", "0"]);
  await encTest("av1_nvenc", [], ["-c:v", "av1_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "30", "-b:v", "0"]);
  await encTest("libx265（CPU 对照）", [], ["-c:v", "libx265", "-preset", "medium", "-crf", "28"]);

  await T("并发两路 NVENC 会话", async () => {
    const a = path.join(tmp, "c1.mp4"), b = path.join(tmp, "c2.mp4");
    const one = (d) => run(env.ffmpeg, ["-hide_banner", "-y", "-i", clip, "-c:v", "hevc_nvenc",
      "-preset", "p5", "-rc", "vbr", "-cq", "24", "-b:v", "0", d], 240000);
    const rs = await Promise.all([one(a), one(b)]);
    if (rs.some((r) => r.code !== 0)) return "退出码 " + rs.map((r) => r.code).join("/");
    return fs.existsSync(a) && fs.existsSync(b);
  });

  const pass = R.filter((x) => x.ok).length, fail = R.length - pass;
  try { fs.writeFileSync(outFile, JSON.stringify({ pass, fail, results: R }, null, 2), "utf8"); } catch (e) { }
  R.forEach((x) => console.log((x.ok ? "  ✓ " : "  ★ ") + x.name + (x.info ? " — " + x.info : "")));
  console.log("后端自检：通过 " + pass + " / 失败 " + fail);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }
  app.exit(fail ? 1 : 0);
}

/* ---------- 界面自检：--gui-selftest 时隐藏窗口加载界面，跑渲染层自检后退出 ---------- */
function guiSelftest(outFile) {
  win = new BrowserWindow({
    width: WIN_W, height: WIN_H, show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  const url = "file://" + path.join(__dirname, "renderer", "index.html").replace(/\\/g, "/") + "?selftest=1&json=1#queue";
  win.webContents.on("did-finish-load", () => {
    setTimeout(async () => {
      let text = "";
      try {
        text = await win.webContents.executeJavaScript(
          "(function(){var a=document.getElementById('__selftest_json');" +
          "var b=document.getElementById('__jserr');" +
          "var c=document.getElementById('__probe');" +
          "return JSON.stringify({selftest: a?a.textContent:null, jserr: b?b.textContent:null});})()");
      } catch (e) { text = JSON.stringify({ error: String(e.message || e) }); }
      try { fs.writeFileSync(outFile, text, "utf8"); } catch (e) { }
      console.log("GUI 自检结果: " + text.slice(0, 400));
      app.exit(0);
    }, 4000);
  });
  win.loadURL(url);
}

/* ---------- 端到端：驱动真实界面（UI 生成命令 → 后端执行 → 校验产物） ---------- */
async function js(code) { return win.webContents.executeJavaScript(code, true); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitProbe(maxMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < (maxMs || 15000)) {
    const rows = await js("window.__E2E.rows()");
    if (rows[0] && rows[0].spec) return rows[0];
    await sleep(300);
  }
  return null;
}
async function waitDone(maxMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < (maxMs || 300000)) {
    const rows = await js("window.__E2E.rows()");
    const r = rows[0];
    if (r && (r.st === "完成" || r.st === "失败" || r.st === "已跳过")) return r;
    await sleep(500);
  }
  return null;
}

async function e2eRun(srcClip, label, setup, expectProfile) {
  const report = { label, ok: false, state: "", argv: "", out: "", note: "" };
  await js("window.__E2E.clear()");
  await js(`window.__E2E.set("lut", null); window.__E2E.set("sharpen","关闭");
            window.__E2E.set("speed","1.00"); window.__E2E.set("watermark", false);
            window.__E2E.set("amode","复制"); window.__E2E.set("mux","MP4");
            window.__E2E.set("res","原样"); window.__E2E.set("naming","原名_标签");
            window.__E2E.set("conflict","覆盖"); window.__E2E.set("qmode","恒定质量");
            window.__E2E.set("outmode","与源文件同目录");`);
  for (const k of Object.keys(setup)) await js(`window.__E2E.set(${JSON.stringify(k)}, ${JSON.stringify(setup[k])})`);
  const sizeMB = fs.statSync(srcClip).size / 1048576;
  await js(`window.__E2E.add(${JSON.stringify(srcClip)}, ${Math.round(sizeMB * 1048576)})`);
  const probed = await waitProbe();
  if (!probed) { report.note = "ffprobe 未回填规格"; return report; }
  const argv = await js("window.__E2E.argv()");
  report.argv = argv.join(" ");
  report.out = argv[argv.length - 1];
  await js("window.__E2E.start()");
  const done = await waitDone();
  report.state = done ? done.st : "超时";
  report.ok = !!done && done.st === "完成";
  if (report.ok && expectProfile && fs.existsSync(report.out)) {
    const p = await run(ffprobePath(), ["-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=codec_name,profile,pix_fmt", "-of", "csv=p=0", report.out], 30000);
    report.note = (p.out || "").trim();
    if (!report.note.includes(expectProfile)) { report.ok = false; report.note = "产物不符：" + report.note; }
  }
  await js("window.__E2E ? null : null");
  return report;
}

function e2eEncode(outFile) {
  win = new BrowserWindow({
    width: WIN_W, height: WIN_H, show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  const url = "file://" + path.join(__dirname, "renderer", "index.html").replace(/\\/g, "/") + "?e2e=1#queue";
  win.loadURL(url);
  win.webContents.on("did-finish-load", async () => {
    const results = [];
    const tmp = fs.mkdtempSync(path.join(os_tmpdir(), "maruko-e2e-"));
    const clip = path.join(tmp, "sample.mkv");
    try {
      await sleep(600);
      const g = await run(ffmpegPath(), ["-hide_banner", "-y", "-f", "lavfi", "-i",
        "testsrc=size=1280x720:rate=30:duration=4", "-pix_fmt", "yuv420p", clip], 120000);
      results.push({ label: "生成测试片源", ok: g.code === 0 && fs.existsSync(clip), note: "退出码 " + g.code });
      results.push(await e2eRun(clip, "界面 → 8-bit hevc_nvenc", { vendor: "NVIDIA", codec: "H.265", depth: "8-bit", cq: "24" }, null));
      results.push(await e2eRun(clip, "界面 → 10-bit hevc_nvenc（附录 A 修正）",
        { vendor: "NVIDIA", codec: "H.265", depth: "10-bit", cq: "24" }, "Main 10"));
      results.push(await e2eRun(clip, "界面 → h264_nvenc", { vendor: "NVIDIA", codec: "H.264", depth: "8-bit", cq: "23" }, null));
      results.push(await e2eRun(clip, "界面 → libx265（CPU）", { vendor: "CPU", codec: "H.265", depth: "8-bit", cq: "28" }, null));
    } catch (e) {
      results.push({ label: "异常", ok: false, note: String(e.message || e) });
    }
    const pass = results.filter((r) => r.ok).length;
    const payload = { pass, fail: results.length - pass, results };
    try { fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), "utf8"); } catch (e) { }
    console.log("端到端：通过 " + pass + " / " + results.length);
    app.exit(payload.fail ? 1 : 0);
  });
}
function os_tmpdir() { return require("os").tmpdir(); }

/* ---------- macOS 应用菜单：补齐 Cmd+Q、复制粘贴等系统习惯 ---------- */
function setupDarwinMenu() {
  if (process.platform !== "darwin") return;
  app.setAboutPanelOptions({
    applicationName: "小丸工具箱",
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    copyright: "MIT License · 社区版本",
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: "小丸工具箱",
      submenu: [
        { role: "about", label: "关于小丸工具箱" },
        { type: "separator" },
        { role: "hide", label: "隐藏小丸工具箱" },
        { role: "hideOthers", label: "隐藏其他" },
        { role: "unhide", label: "全部显示" },
        { type: "separator" },
        { role: "quit", label: "退出小丸工具箱" },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" },
      ],
    },
    {
      label: "窗口",
      submenu: [
        { role: "minimize", label: "最小化" },
        { role: "zoom", label: "缩放" },
        { type: "separator" },
        { role: "front", label: "前置全部窗口" },
      ],
    },
  ]));
}

/* ---------- 窗口 ---------- */
function createWindow() {
  const theme = readSettings()?.theme;
  const dark = theme === "夜间" || (theme === "跟随" && nativeTheme.shouldUseDarkColors);
  win = new BrowserWindow({
    width: WIN_W, height: WIN_H, show: false,
    minWidth: WIN_W, minHeight: WIN_H,
    maxWidth: WIN_W, maxHeight: WIN_H,
    resizable: false, maximizable: false, fullscreenable: false,
    useContentSize: false,
    autoHideMenuBar: true,
    backgroundColor: dark ? "#0a0a0b" : "#f4f4f2",
    icon: path.join(__dirname, "assets", "app.ico"),
    title: "小丸工具箱",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
      spellcheck: false, devTools: !app.isPackaged,
    },
  });
  win.once("ready-to-show", () => win && win.show());
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.on("closed", () => { win = null; });
}

app.whenReady().then(() => {
  setupDarwinMenu();
  if (process.argv.includes("--backend-selftest")) {
    const out = process.env.MARU_ST_OUT || path.join(app.getPath("temp"), "maruko-backend-selftest.json");
    backendSelftest(out);
    return;
  }
  if (process.argv.includes("--gui-selftest")) {
    guiSelftest(process.env.MARU_GUI_ST_OUT || path.join(app.getPath("temp"), "maruko-gui-selftest.json"));
    return;
  }
  if (process.argv.includes("--e2e-encode")) {
    e2eEncode(process.env.MARU_E2E_OUT || path.join(app.getPath("temp"), "maruko-e2e.json"));
    return;
  }
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => {
  /* 退出前确保子进程被回收，避免 ffmpeg 孤儿进程 */
  for (const [, j] of jobs) { try { j.proc.kill("SIGKILL"); } catch (e) { } }
  if (benchProc) { try { benchProc.kill("SIGKILL"); } catch (e) { } }
  app.quit();
});
process.on("exit", () => { for (const [, j] of jobs) { try { j.proc.kill("SIGKILL"); } catch (e) { } } });
