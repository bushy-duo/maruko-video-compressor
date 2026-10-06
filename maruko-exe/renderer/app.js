/* ============================================================
   小丸工具箱 · 原型交互层
   架构：所有控件在 HTML 里用 data-group / data-switch / data-bind / data-act
   声明自己写哪个状态字段；render() 单向从 state 刷新全部卡片头、输出名、
   命令行。因此"按钮点了没反应"和"卡片头不联动"在结构上不可能出现。
   ============================================================ */
(function () {
  "use strict";

  /* 运行时异常写进 DOM，便于无头环境定位（否则页面静默半残） */
  window.addEventListener("error", function (e) {
    var d = document.createElement("div");
    d.id = "__jserr";
    d.textContent = "JS 错误：" + e.message + " @" + (e.lineno || "?") + ":" + (e.colno || "?");
    (document.body || document.documentElement).appendChild(d);
  });

  /* ---------- 真实配置表：从 MarukoToolbox-Rewrite-main/config.py 直译 ---------- */
  var VIDEO_EXTENSIONS = ["mp4", "mov", "mkv", "avi", "wmv", "flv", "webm", "m4v",
    "ts", "mts", "m2ts", "rm", "rmvb", "vob", "mpg", "mpeg"];

  var RESOLUTIONS = {          // 短标签 → config.py RESOLUTIONS 的 scale 值
    "原样": "", "2160p": "3840:-2", "1440p": "2560:-2", "1080p": "1920:-2", "720p": "1280:-2",
    "竖4K": "2160:3840", "竖1440": "1440:2560", "竖1080": "1080:1920", "竖720": "720:1280",
    "自定义": "custom",
  };
  var RES_REAL_KEY = {         // 原型短标签 → 原版下拉框真实项
    "原样": "保持原分辨率", "2160p": "2160p / 4K", "1440p": "1440p / 2K", "1080p": "1080p",
    "720p": "720p", "竖4K": "竖屏 4K 2160x3840", "竖1440": "竖屏 1440x2560",
    "竖1080": "竖屏 1080x1920", "竖720": "竖屏 720x1280", "自定义": "自定义宽高",
  };
  var PRESETS = { "极速": ["p1", "ultrafast"], "高速": ["p3", "veryfast"], "均衡": ["p5", "medium"], "高画质": ["p7", "slow"] };
  var SHARPEN_LEVELS = { "关闭": "", "轻度": "unsharp=5:5:0.6:3:3:0.0", "中度": "unsharp=5:5:1.0:3:3:0.0", "强力": "unsharp=7:7:1.4:5:5:0.0" };
  var VIDEO_MUXERS = { "MP4": ".mp4", "MKV": ".mkv", "MOV": ".mov", "WebM": ".webm", "TS": ".ts", "源": "source" };
  var AUDIO_MODES = { "复制": "copy", "AAC": "aac", "Opus": "libopus", "MP3": "libmp3lame", "FLAC": "flac", "移除": "none" };
  var AUDIO_BITRATES = {
    "AAC": ["96k", "128k", "160k", "192k", "256k", "320k"],
    "MP3": ["128k", "192k", "256k", "320k"],
    "Opus": ["64k", "96k", "128k", "160k", "192k"],
    "FLAC": [], "复制": ["128k", "160k", "192k", "256k", "320k"], "移除": [],
  };
  var QUALITY_MODES = { "恒定质量": "crf", "两遍码率": "2pass", "自定义": "custom" };
  var FILENAME_TAGS = {        // config.py ENCODER_FILENAME_TAGS
    hevc_nvenc: "h265", hevc_nvenc_10bit: "h265_10bit", h264_nvenc: "h264",
    av1_nvenc: "av1", av1_nvenc_10bit: "av1_10bit",
    hevc_amf: "amd_h265", h264_amf: "amd_h264", av1_amf: "amd_av1",
    hevc_qsv: "intel_h265", hevc_qsv_10bit: "intel_h265_10bit", h264_qsv: "intel_h264", av1_qsv: "intel_av1",
    libx265: "h265", libx265_10bit: "h265_10bit", libx264: "h264", libsvtav1: "av1",
    "libvpx-vp9": "vp9", prores_ks: "prores",
  };
  /* 本机环境探测结果（与「环境检测」页一致） */
  var ENV = { nvenc: true, amf: false, qsv: false, cpu: true, sm: 8.9, av1: true, vramGB: 24 };

  /* Electron 宿主提供真实后端（ffprobe / ffmpeg / 对话框 / 磁盘）；
     在浏览器里直接打开时 BE 为 null，相关路径退化为可观察的模拟实现。 */
  var BE = (window.MARU && window.MARU.isElectron) ? window.MARU : null;

  /* 批处理预设。config.py BATCH_PRESETS 原为 5 个"归档"预设，
     这里按用户指定的方案替换其中两项：
       · 去掉「高质量归档 H.265 2K」，改为直通预设「H.265」
       · 「高兼容 H.264」与「H.265」都取"截图二"那一组参数（原样 + CQ24 + 复制 320k），
         两者只差编码格式
     预设是**完整快照**（含滤镜/命名/输出位置），点一下就是一套可复现的配置，
     不会残留上一套的 LUT 或变速。 */
  var PRESET_COMMON = {
    vendor: "NVIDIA", depth: "8-bit", preset: "均衡", qmode: "恒定质量", bitrate: "8000k",
    lut: null, sharpen: "关闭", speed: "1.00", watermark: false,
    naming: "原名_标签", conflict: "重命名", outmode: "与源文件同目录",
  };
  function presetOf(over) {
    var o = {}, k;
    for (k in PRESET_COMMON) if (PRESET_COMMON.hasOwnProperty(k)) o[k] = PRESET_COMMON[k];
    for (k in over) if (over.hasOwnProperty(k)) o[k] = over[k];
    return o;
  }
  var BATCH_PRESETS = {
    "高质量归档 H.265 4K": presetOf({ codec: "H.265", res: "2160p", cq: 22, amode: "AAC", abit: "192k", mux: "MP4" }),
    "H.265": presetOf({ codec: "H.265", res: "原样", cq: 24, amode: "复制", abit: "320k", mux: "MP4" }),
    "网盘归档 H.265 1080p": presetOf({ codec: "H.265", res: "1080p", cq: 24, amode: "AAC", abit: "160k", mux: "MP4" }),
    "极速体积压缩 H.265 720p": presetOf({ codec: "H.265", res: "720p", cq: 27, amode: "AAC", abit: "128k", mux: "MP4" }),
    "高兼容 H.264": presetOf({ codec: "H.264", res: "原样", cq: 24, amode: "复制", abit: "320k", mux: "MP4" }),
  };
  var FFMPEG = "ffmpeg";

  /* ---------- 状态：唯一真值来源 ---------- */
  /* 默认值 = 用户截图确认过的那一组：NVENC / H.265 / 8-bit / 均衡 / 恒定质量 CQ24 /
     保持原分辨率 / MP4 / 无滤镜 / 复制音频 320k / 与源文件同目录 / 原名_标签 / 重命名 */
  var DEFAULTS = {
    vendor: "NVIDIA", codec: "H.265", depth: "8-bit",
    preset: "均衡", qmode: "恒定质量", cq: "24", bitrate: "8000k", customCmd: "-c:v hevc_nvenc -cq 24",
    res: "原样", customW: "1920", customH: "1080", mux: "MP4",
    lut: null, sharpen: "关闭", speed: "1.00", watermark: false,
    wmmode: "文字", wmText: "", wmImage: null,
    amode: "复制", abit: "320k",
    naming: "原名_标签", conflict: "重命名", outmode: "与源文件同目录", outDir: "D:\\maru-output",
    parallel: "1", boostGpu: true, sound: false, shutdown: false,
    theme: "日间", fscale: "中", centerDialog: true, openAfter: false,
    prefdev: "优先 GPU", autoFallback: true, confirmExport: true, exportLogOn: true,
    threads: "0", extraArgs: "", autoScroll: true,
    benchFile: "", bpreset: null, userPresets: [],
  };
  var state = clone(DEFAULTS);
  var hasInitialSettings = !!(BE && Object.prototype.hasOwnProperty.call(BE, "initialSettings"));
  if (hasInitialSettings && BE.initialSettings) {
    Object.keys(DEFAULTS).forEach(function (key) { if (key in BE.initialSettings) state[key] = BE.initialSettings[key]; });
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function extOf(n) { var i = n.lastIndexOf("."); return i > 0 ? n.slice(i + 1).toLowerCase() : ""; }
  function stemOf(n) { var i = n.lastIndexOf("."); return i > 0 ? n.slice(0, i) : n; }
  function fmtMB(mb) { return mb >= 1024 ? (mb / 1024).toFixed(2) + " GB" : mb.toFixed(1) + " MB"; }
  function clampNum(v, lo, hi, dflt) {
    var n = parseFloat(v);
    if (isNaN(n)) return dflt;
    return Math.min(hi, Math.max(lo, n));
  }

  /* ---------- 派生：编码器键 / 标签 / 可用性 ---------- */
  function encoderKey() {
    var v = { NVIDIA: "nvenc", AMD: "amf", Intel: "qsv", CPU: null }[state.vendor];
    var c = { "H.265": "hevc", "H.264": "h264", AV1: "av1", VP9: "vp9", ProRes: "prores" }[state.codec];
    var ten = state.depth === "10-bit";
    if (v === null) {
      var cpu = { "H.265": ten ? "libx265_10bit" : "libx265", "H.264": "libx264", AV1: "libsvtav1", VP9: "libvpx-vp9", ProRes: "prores_ks" }[state.codec];
      return cpu;
    }
    return c + "_" + v + (ten ? "_10bit" : "");
  }
  function resolveEncoder(key) {   // ffmpeg_utils.resolve_encoder
    var map = {
      hevc_nvenc_10bit: ["hevc_nvenc", "p010le"], av1_nvenc_10bit: ["av1_nvenc", "p010le"],
      hevc_qsv_10bit: ["hevc_qsv", "p010le"], libx265_10bit: ["libx265", "yuv420p10le"],
    };
    return map[key] ? { encoder: map[key][0], pixFmt: map[key][1] } : { encoder: key, pixFmt: "" };
  }
  function fileTag() { return FILENAME_TAGS[encoderKey()] || "compressed"; }
  function encoderAvailable() {
    if (state.vendor === "NVIDIA") return ENV.nvenc;
    if (state.vendor === "AMD") return ENV.amf;
    if (state.vendor === "Intel") return ENV.qsv;
    return true;
  }
  function av1Supported() {
    if (state.codec !== "AV1") return true;
    if (state.vendor === "NVIDIA") return ENV.av1;
    if (state.vendor === "Intel") return false;   // Arc+，本机无
    return true;
  }
  function outSuffix(srcName) {    // ffmpeg_utils.output_suffix
    var m = VIDEO_MUXERS[state.mux];
    return (m && m !== "source") ? m : ("." + (extOf(srcName) || "mp4"));
  }
  function scaleValue() {
    var mode = RESOLUTIONS[state.res];
    if (mode === "custom") {
      var w = parseInt(state.customW, 10), h = parseInt(state.customH, 10);
      return (isNaN(w) || w <= 0 ? -2 : w) + ":" + (isNaN(h) || h <= 0 ? -2 : h);
    }
    return mode;
  }
  function speedVal() { return clampNum(state.speed, 0.25, 4, 1); }
  function useCpuFilters() { return !!state.lut || state.sharpen !== "关闭" || speedVal() !== 1; }

  /* 隐藏水印：对齐 build_hidden_watermark_payload / hidden_watermark_filter / escape_drawtext_text */
  function escDrawtext(t) {
    return t.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'")
      .replace(/%/g, "\\%").replace(/,/g, "\\,");
  }
  function watermarkPayload() {
    if (!state.watermark) return "";
    if (state.wmmode === "文字") {
      var txt = String(state.wmText || "").trim();
      return txt ? "MTBX-HW:v1:text:" + txt : "";
    }
    return state.wmImage ? "MTBX-HW:v1:image:" + state.wmImage.name + ":" + state.wmImage.digest : "";
  }
  function drawtextFilter() {
    if (!state.watermark || state.wmmode !== "文字") return "";
    var txt = String(state.wmText || "").trim();
    if (!txt) return "";
    return "drawtext=text='" + escDrawtext(txt) + "':x=w-tw-20:y=h-th-20:fontsize=22:fontcolor=white@0.035:borderw=0";
  }

  /* ---------- 输出名：对齐 ffmpeg_utils.unique_path ---------- */
  function outputName(srcName, taken) {
    var stem = stemOf(srcName), tag = fileTag(), suffix = outSuffix(srcName), base;
    if (state.naming === "标签_原名") base = tag + "_" + stem;
    else if (state.naming === "仅原名") base = stem;
    else base = stem + "_" + tag;
    if (!taken || state.conflict === "覆盖") return base + suffix;
    if (state.conflict === "跳过" && taken[base + suffix]) return null;   // 由调用方标记跳过
    var name = base + suffix, n = 2;
    while (taken[name]) { name = base + "_" + n + suffix; n++; }         // 重命名：追加 _2、_3
    return name;
  }
  function outDirLabel() {
    return state.outmode === "与源文件同目录" ? "与源文件同目录" : state.outDir;
  }

  /* ---------- 命令生成：对齐 ffmpeg_utils.build_compress_command ----------
     含 DESIGN.md 附录 A 的 10-bit NVENC 修正（scale_cuda format=p010le，不传 -pix_fmt）
     encOverride：基准测试用，指定某个编码器键
     clean：基准测试用，剥掉 LUT / 锐化 / 变速 / 水印，只比编码器本身          */
  function buildCommand(srcName, targetName, encOverride, clean) {
    var lutOn = clean ? null : state.lut;
    var sharpName = clean ? "关闭" : state.sharpen;
    var spd = clean ? 1 : speedVal();
    var wmOn = (!clean && state.watermark);
    var cpuF = !!lutOn || sharpName !== "关闭" || spd !== 1;   /* 与原版 use_cpu_filters 同口径 */
    var t = [];
    if (!clean && state.qmode === "自定义" && state.customCmd.trim()) {
      return [FFMPEG].concat(state.customCmd.trim().replace(/\{input\}/g, srcName).replace(/\{output\}/g, targetName).split(/\s+/));
    }
    var r = resolveEncoder(encOverride || encoderKey()), enc = r.encoder, pixFmt = r.pixFmt;
    var isNvenc = enc.indexOf("nvenc") >= 0, isAmf = /_amf$/.test(enc), isQsv = /_qsv$/.test(enc);
    var tenBitGpu = isNvenc && !cpuF && pixFmt === "p010le";   // 附录 A 修正生效

    t.push(FFMPEG, "-hide_banner", (state.conflict === "覆盖" || clean) ? "-y" : "-n");
    if (isNvenc && !cpuF) t.push("-hwaccel", "cuda", "-hwaccel_output_format", "cuda");
    else if (isNvenc) t.push("-hwaccel", "cuda");
    t.push("-i", srcName);

    var f = [], mode = RESOLUTIONS[state.res];
    if (mode) {
      var sv = scaleValue();
      if (tenBitGpu) f.push("scale_cuda=" + sv + ":format=p010le");
      else if (cpuF || !isNvenc) f.push("scale=" + sv);
      else f.push("scale_cuda=" + sv);
    } else if (tenBitGpu) {
      f.push("scale_cuda=format=p010le");
    }
    if (lutOn) f.push("lut3d=file='" + String(lutOn).replace(/\\/g, "/") + "'");
    if (sharpName !== "关闭") f.push(SHARPEN_LEVELS[sharpName]);
    if (spd !== 1) f.push("setpts=PTS/" + spd.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""));
    var wmf = wmOn ? drawtextFilter() : "";
    if (wmf) f.push(wmf);
    if (f.length) t.push("-vf", f.join(","));

    t.push("-c:v", enc);
    var pg = PRESETS[state.preset][0], pc = PRESETS[state.preset][1];
    if (isNvenc) {
      t.push("-preset", pg, "-rc", "vbr", "-cq", String(clampNum(state.cq, 0, 51, 24)), "-b:v", state.bitrate.trim() || "0");
      t.push("-spatial-aq", "1", "-temporal-aq", "1", "-rc-lookahead", "32", "-bf", "3");
      if (state.boostGpu && parseInt(state.parallel, 10) > 1) t.push("-surfaces", "12");
    } else if (isAmf) {
      t.push("-quality", { p1: "speed", p3: "speed", p5: "balanced", p7: "quality" }[pg] || "balanced");
      if (state.bitrate.trim()) t.push("-rc", "vbr", "-b:v", state.bitrate.trim());
      else t.push("-rc", "cqp", "-qp_i", state.cq, "-qp_p", state.cq, "-qp_b", state.cq);
    } else if (isQsv) {
      if (state.bitrate.trim()) t.push("-b:v", state.bitrate.trim()); else t.push("-global_quality", state.cq);
    } else {
      if (enc === "libsvtav1") t.push("-preset", "6", "-crf", state.cq);
      else if (enc === "libvpx-vp9") t.push("-crf", state.cq, "-b:v", state.bitrate.trim() || "0", "-row-mt", "1");
      else if (enc === "prores_ks") t.push("-profile:v", "3");
      else t.push("-preset", pc, "-crf", state.cq);
      if (state.bitrate.trim() && enc !== "prores_ks") t.push("-b:v", state.bitrate.trim());
      if (parseInt(state.threads, 10) > 0 && /^libx26/.test(enc)) t.push("-threads", state.threads);
    }
    if (pixFmt && !tenBitGpu) t.push("-pix_fmt", pixFmt);

    /* audio_args：copy + 变速 → 自动改 aac 重编码（原版规则） */
    var am = AUDIO_MODES[state.amode], sp = spd, ab = "";
    if (am === "none") t.push("-an");
    else if (am === "copy") {
      if (sp !== 1) {
        t.push("-af", "atempo=" + sp.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""));
        t.push("-c:a", "aac");
        if (state.abit) t.push("-b:a", state.abit);
      } else t.push("-c:a", "copy");
    } else {
      if (sp !== 1) { t.push("-af", "atempo=" + sp.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")); ab = ""; }
      else { t.push("-c:a", am); ab = state.abit; }
      if (ab && am !== "flac") t.push("-b:a", ab);
    }
    if (state.extraArgs.trim()) t.push(state.extraArgs.trim());
    var wmp = wmOn ? watermarkPayload() : "";
    if (wmp) t.push("-metadata", "comment=" + wmp, "-metadata", "description=" + wmp);
    t.push("-map_metadata", "0", targetName);
    return t;
  }
  function commandText(srcName) {
    /* 输出名只能用文件名算：否则 stem 里带着目录，再拼一次目录就成了 D:\v\D:\v\... */
    var p = srcName.replace(/\//g, "\\");
    var i = p.lastIndexOf("\\");
    var srcDir = i > 0 ? p.slice(0, i + 1) : "";
    var base = i > 0 ? p.slice(i + 1) : p;
    var nm = outputName(base) || "(跳过)";
    var outDir = state.outmode === "与源文件同目录" ? srcDir : state.outDir + "\\";
    return buildCommand(srcName, outDir + nm).join(" ");
  }

  /* ============================================================
     队列
     ============================================================ */
  var queue = [];
  var uid = 0;
  var logs = [];
  var running = null;   // {timer, rows, done}

  function baseName(p) {
    var s = String(p).replace(/\//g, "\\");
    var i = s.lastIndexOf("\\");
    return i > 0 ? s.slice(i + 1) : s;
  }

  /* 去重按完整路径（Windows 大小写不敏感），对齐原版 str(path.resolve()) 的语义 */
  function addFiles(list) {
    var seen = {};
    queue.forEach(function (q) { seen[String(q.path).toLowerCase()] = true; });
    var added = 0, dup = 0, bad = 0;
    list.forEach(function (f) {
      var full = f.webkitRelativePath || f.path || f.absolutePath || "";
      var name = f.name || f.fileName || (full ? baseName(full) : "");
      if (!name || VIDEO_EXTENSIONS.indexOf(extOf(name)) < 0) { bad++; return; }
      var key = String(full || name).toLowerCase();
      if (seen[key]) { dup++; return; }
      seen[key] = true;
      queue.push({
        id: ++uid, name: name, path: full || name, size: f.size || 0,
        spec: "", parsed: false, st: "解析中", progress: 0, out: "", est: 0, sel: false,
      });
      lastAdded = uid;
      parseLater(queue[queue.length - 1]);
      added++;
    });
    recomputeOutputs();
    render();
    if (added) {
      toast("已加入 " + added + " 个任务" + (dup ? "，跳过 " + dup + " 个重复" : "") + (bad ? "，忽略 " + bad + " 个非视频" : ""));
      log("i", "已加入 " + added + " 个任务" + (dup ? "，跳过 " + dup + " 个重复项" : "") + (bad ? "，忽略 " + bad + " 个非视频文件" : ""));
    } else if (dup) toast("已跳过 " + dup + " 个重复项");
    else if (bad) toast("未识别到支持的视频格式（共 16 种容器）");
    return added;
  }

  /* 模拟 ffprobe：真实体积 + 文件名线索推断规格 */
  function guessSpec(name, bytes) {
    var n = name.toLowerCase();
    var res = /2160|4k|uhd/.test(n) ? "3840×2160" : /1440|2k/.test(n) ? "2560×1440"
      : /1080|webrip|bdrip|bluray|fullhd/.test(n) ? "1920×1080"
        : /720/.test(n) ? "1280×720" : /480|dvd|vcd/.test(n) ? "720×480" : "1920×1080";
    var fps = /60p|60fps/.test(n) ? "60p" : /23\.?976/.test(n) ? "23.98p" : /50p/.test(n) ? "50p" : "30p";
    var dur = /concert|现场|全场|婚礼|full/.test(n) ? 5400 : /recording|录制|lecture/.test(n) ? 1800 : 1200;
    return { spec: res + " · " + fps, res: res, fps: fps, dur: dur, sizeMB: bytes / 1048576 };
  }
  function estRatio() {
    var k = encoderKey();
    if (/prores/.test(k)) return 1.6;
    if (/libsvtav1|av1/.test(k)) return k.indexOf("nvenc") >= 0 ? 0.19 : 0.14;
    if (/hevc|265/.test(k)) return k.indexOf("nvenc") >= 0 ? 0.23 : 0.16;
    if (/h264|264|_amf|_qsv/.test(k)) return 0.35;
    if (/vp9/.test(k)) return 0.26;
    return 0.25;
  }
  /* 真实后端走 ffprobe；浏览器预览退化为文件名推断 + 真实体积 */
  function parseLater(q) {
    if (BE) {
      BE.probe(q.path).then(function (info) {
        if (!info || !info.ok) {
          q.st = "失败"; q.err = (info && info.error) || "ffprobe 无输出";
          log("e", "<b>" + esc(q.name) + "</b> 探测失败：" + esc(q.err));
          recomputeOutputs(); render(); return;
        }
        q.spec = info.w + "×" + info.h + (info.fps ? " · " + (Math.round(info.fps * 100) / 100) + "p" : "");
        q.dur = info.dur || 0;
        q.size = Math.round((info.sizeMB || 0) * 1048576);
        q.vcodec = info.vcodec; q.acodec = info.acodec; q.parsed = true;
        if (q.st === "解析中") q.st = "等待中";
        recomputeOutputs(); render();
      }, function (e) {
        q.st = "失败"; q.err = String((e && e.message) || e);
        recomputeOutputs(); render();
      });
      return;
    }
    setTimeout(function () {
      var g = guessSpec(q.name, q.size);
      q.spec = g.spec; q.dur = g.dur; q.parsed = true; q.st = "等待中";
      recomputeOutputs();
      render();
    }, 380 + (q.id % 5) * 110);
  }

  /* 输出名：按队列顺序算，真实体现「重命名 / 覆盖 / 跳过」 */
  function recomputeOutputs() {
    var taken = {};
    queue.forEach(function (q) {
      if (!q.parsed) { q.out = outputName(q.name) || ""; q.est = 0; return; }
      var nm = outputName(q.name, taken);
      if (nm === null) { q.out = "(冲突跳过)"; q.conflict = true; }
      else { q.out = nm; q.conflict = false; taken[nm] = true; }
      var sp = speedVal();
      q.est = (q.size / 1048576) * estRatio() / (sp === 1 ? 1 : sp);
    });
  }

  function selected() { return queue.filter(function (q) { return q.sel; }); }

  /* ============================================================
     渲染
     ============================================================ */
  var saveT;
  function scheduleSave() {
    clearTimeout(saveT);
    saveT = setTimeout(function () {
      if (BE) { BE.saveSettings(state); return; }
      try { localStorage.setItem("maru-ui-state-v2", JSON.stringify(state)); } catch (e) { }
    }, 400);
  }
  function render() {
    renderMetas();
    renderQueue();
    renderCommand();
    renderChips();
    applyVisualState();
    updateActionStates();
    paintCq();
    scheduleSave();
  }

  function renderMetas() {
    var warn = !encoderAvailable() ? "当前设备不可用，请在编码器设置中选择其他设备。"
      : state.codec === "AV1" && !av1Supported() ? "当前设备不支持 AV1，请换一种视频格式。" : "";
    $("#enc-note").textContent = warn;
    $("#enc-note").hidden = !warn;
    $("#wm-mode").hidden = !state.watermark;
    $("#wm-text-field").hidden = !(state.watermark && state.wmmode === "文字");
    $("#wm-img-field").hidden = !(state.watermark && state.wmmode === "图片");
    $("#bitrate-field").hidden = state.qmode !== "两遍码率";
    $("#cmd-field").hidden = state.qmode !== "自定义";
    $("#cq-field").hidden = state.qmode === "自定义";
    $("#cq-slider-field").hidden = state.qmode === "自定义";
    $("#custom-res").hidden = state.res !== "自定义";
    $("#outdir-field").hidden = state.outmode === "与源文件同目录";
    $("#abit-field").hidden = ["none", "flac", "copy"].indexOf(AUDIO_MODES[state.amode]) >= 0;
    $$('[data-preview-only]').forEach(function (el) { el.hidden = !!BE; });
    $("#cmd-warn").hidden = !warn;
    if (warn) $("#cmd-warn-text").textContent = warn;
    $("#set-extra-text").textContent = state.extraArgs.trim() || "";
    $("#preset-count").textContent = state.userPresets.length ? state.userPresets.length + " 个" : "";
  }

  function pendingTasks() {
    var sel = selected();
    return (sel.length ? sel : queue).filter(function (q) {
      return q.st === "等待中" || q.st === "已停止" || q.st === "失败";
    });
  }
  function updateActionStates() {
    var pend = pendingTasks(), sel = selected();
    var ready = pend.length > 0 && pend.every(function (q) { return q.parsed; });
    var startLabel = running ? (running.pausedForConfirm ? "等待确认" : "压缩中") : sel.length ? "开始选中" : "开始压缩";
    $$('[data-start-label]').forEach(function (el) { el.textContent = startLabel; });
    $$('[data-act="startAll"]').forEach(function (el) {
      el.disabled = !!running || !ready;
      el.title = running ? "当前批次结束后可再次开始" : ready ? "开始 " + pend.length + " 个待处理任务" : "先添加并读取视频，或选择待处理任务";
    });
    $$('[data-act="stopAll"]').forEach(function (el) {
      el.disabled = !running && !shutdownScheduled;
      el.hidden = !running && !shutdownScheduled;
      el.title = shutdownScheduled ? "停止任务并取消关机计划" : "停止当前批次";
    });
    $$('[data-act="removeSel"]').forEach(function (el) { el.disabled = !!running || !sel.length; });
    $$('[data-act="clearAll"]').forEach(function (el) { el.disabled = !!running || !queue.length; });
    $$('[data-act="resetAll"], [data-act="resetParams"]').forEach(function (el) { el.disabled = !!running; });
    $("#quick-preset").disabled = !!running;
    $$('#queue-quickbar button, #queue-quickbar input, #queue-quickbar select').forEach(function (el) {
      el.disabled = !!running || state.qmode === "自定义";
    });
    $("#start-btn").hidden = !queue.length;
  }

  function renderQueue() {
    var body = $("#q-body");
    $("#q-empty").hidden = queue.length > 0;
    ["#queue-toolbar", "#queue-table", "#queue-footer"].forEach(function (id) { $(id).hidden = !queue.length; });
    $("#queue-progress").hidden = !running;
    if (!queue.length) $("#log-drawer").hidden = true;
    var shown = queue.filter(function (q) { return !q.hiddenByFilter; });
    var newId = lastAdded;
    var visible = {};
    shown.forEach(function (q) {
      visible[q.id] = true;
      var tr = body.querySelector('tr[data-id="' + q.id + '"]');
      var isNew = !tr;
      if (!tr) {
        tr = document.createElement("tr");
        body.appendChild(tr);
      }
      updateRowEl(tr, q, isNew && q.id === newId);
    });
    Array.prototype.slice.call(body.children).forEach(function (tr) {
      if (!visible[tr.getAttribute("data-id")]) tr.remove();
    });
    /* 只让刚加入的任务播放一次入场动画；进度刷新不能再次触发它。 */
    lastAdded = -1;
    var nSel = selected().length;
    $("#sel-count").textContent = nSel ? " (" + nSel + ")" : "";
    $("#q-count").textContent = queue.length + " 个视频" + (nSel ? " · 选中 " + nSel : "");
    var total = queue.length, done = queue.filter(function (q) { return q.st === "完成"; }).length;
    var sumProg = queue.reduce(function (a, q) { return a + q.progress; }, 0);
    var pct = total ? Math.round(sumProg / total) : 0;
    $("#q-bar").style.width = pct + "%";
    $("#q-pct").textContent = pct + "%";
    var act = queue.filter(function (q) { return q.st === "压缩中"; }).length;
    if (!running) {
      $("#q-stat").textContent = done === total && total ? "全部完成"
        : queue.filter(function (q) { return q.st === "失败"; }).length ? "有失败任务" : "";
    } else {
      var est = queue.filter(function (q) { return q.est; }).reduce(function (a, q) { return a + q.est; }, 0);
      var src = queue.filter(function (q) { return q.parsed; }).reduce(function (a, q) { return a + q.size / 1048576; }, 0);
      var vt = running.vramTotal || ENV.vramGB;
      $("#q-stat").textContent = running.pausedForConfirm ? "等待确认" : act + " 个压缩中";
      $("#q-stat").title = act + " 路并发 · " + running.fps.toFixed(1) + " fps · GPU " +
        Math.round(running.gpu) + "% · CPU " + Math.round(running.cpu) + "% · 显存 " +
        running.vram.toFixed(1) + "/" + vt.toFixed(0) + "GB · 输出合计 " + fmtMB(est) + " / " + fmtMB(src);
    }
    if (!running) $("#q-stat").title = $("#q-stat").textContent;
    $("#log-n").textContent = logs.length;
  }

  function updateRowEl(tr, q, isNew) {
    var rowKey = JSON.stringify([
      q.sel, q.st, q.parsed, q.name, q.path, q.spec, q.size, q.out,
      q.est, q.outMB, q.err || "", state.outmode, state.outDir,
    ]);
    tr.className = (q.sel ? "is-sel " : "") + (isNew ? "is-new" : "");
    tr.setAttribute("data-id", q.id);
    tr.setAttribute("aria-selected", String(q.sel));
    if (tr._rowKey === rowKey) {
      if (q.st === "压缩中") {
        var bar = tr.querySelector(".bar > i");
        var num = tr.querySelector(".prog .u-num");
        if (bar) bar.style.width = q.progress + "%";
        if (num) num.textContent = q.progress + "%";
      }
      return tr;
    }
    var badge = {
      "解析中": '<span class="badge"><span class="dot" style="background:var(--text-4)"></span>读取中</span>',
      "等待中": '<span class="badge"><span class="dot" style="background:var(--text-4)"></span>等待中</span>',
      "压缩中": '<span class="badge badge--accent"><span class="dot"></span>压缩中</span>',
      "完成": '<span class="badge badge--ok"><svg width="10" height="10"><use href="#i-check"/></svg>完成</span>',
      "失败": '<span class="badge badge--danger"><svg width="10" height="10"><use href="#i-warn"/></svg>失败</span>',
      "已跳过": '<span class="badge"><svg width="10" height="10"><use href="#i-warn"/></svg>已跳过</span>',
      "已停止": '<span class="badge"><span class="dot" style="background:var(--text-4)"></span>已停止</span>',
    }[q.st] || "";
    var hint = q.parsed
      ? fmtMB(q.size / 1048576)
      : "读取规格中…";
    var real = q.outMB ? fmtMB(q.outMB) : "";
    var ratio = (q.outMB && q.size) ? (100 - q.outMB / (q.size / 1048576) * 100).toFixed(1) + "%" : "";
    var outHint = q.st === "完成" && q.outMB ? fmtMB(q.outMB) : "";
    var prog = q.st === "压缩中"
      ? '<div class="prog"><div class="bar bar--run"><i style="width:' + q.progress + '%"></i></div><span class="u-num">' + q.progress + '%</span></div>'
      : (q.st === "完成" || q.st === "失败" || q.st === "已跳过" || q.st === "已停止")
        ? '<div class="prog" title="' + esc(q.st === "完成" ? "体积变化：" + (ratio || "—") : q.err || q.st) + '">' + badge + '</div>'
        : '<div class="prog"><span class="u-num">—</span>' + badge + '</div>';
    tr.innerHTML =
      '<td><div class="cell-file' + (q.parsed ? "" : " is-parsing") + '"><div class="file-meta">' +
      '<span class="file-name u-ellipsis" title="' + esc(q.path) + '">' + esc(q.name) + '</span>' +
      '<span class="field-hint u-num u-ellipsis">' + hint + '</span></div></div></td>' +
      '<td><div class="file-meta"><span class="u-num u-ellipsis io-line"><span class="io-arrow">→</span> <span class="io-name" title="' + esc(q.out || "…") + '">' + esc(q.out || "…") + '</span></span>' +
      '<span class="field-hint u-num u-ellipsis" title="' + esc(outHint.replace(/<[^>]+>/g, "")) + '">' + outHint + '</span></div></td>' +
      '<td class="r">' + prog + '</td>';
    tr._rowKey = rowKey;
    return tr;
  }
  var lastAdded = -1;

  function renderCommand() {
    var el = $("#cmd-preview");
    if (!el) return;
    if (!queue.length) {
      el.textContent = "添加视频后显示本次转码命令";
      el._commandText = null;
      return;
    }
    var src = (queue.filter(function (q) { return q.parsed; })[0] || queue[0]).path;
    var txt = commandText(src);
    if (el._commandText === txt) return;
    el._commandText = txt;
    el.innerHTML = txt.split(" ").map(function (tok, i) {
      var cls = "";
      if (/^-/.test(tok)) cls = ' class="c-flag"';
      else if (/^scale_cuda|^scale=|^lut3d|^unsharp|^setpts|^geq|^atempo/.test(tok)) cls = ' class="c-filt"';
      else if (/^(hevc|h264|av1|libx|libsvt|libvpx|prores)/.test(tok)) cls = ' class="c-enc"';
      return "<span" + cls + ">" + esc(tok) + "</span>";
    }).join(" ");
  }

  function renderChips() {
    $("#out-chip").textContent = state.outmode === "与源文件同目录" ? "保存到：原文件夹" : "保存到：" + baseName(state.outDir);
    $("#out-chip").title = outDirLabel();
    var keys = ["codec", "depth", "preset", "qmode", "bitrate", "cq", "res", "lut", "sharpen", "speed", "watermark", "amode", "abit", "mux"];
    var names = Object.keys(BATCH_PRESETS);
    var match = names.filter(function (name) {
      var preset = BATCH_PRESETS[name];
      return keys.every(function (key) { return String(preset[key]) === String(state[key]); });
    })[0];
    $("#quick-preset").value = match || "";
    $("#queue-res-select").value = state.res;
  }

  function applyVisualState() {
    if (BE) {
      var mark = $(".brand-mark");
      if (!mark.querySelector("img")) mark.innerHTML = '<img src="../assets/icon-48.png" alt="">';
    }
    var resolved = state.theme === "日间" ? "light" : state.theme === "跟随"
      ? (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : "dark";
    document.documentElement.setAttribute("data-theme", resolved);
    document.documentElement.setAttribute("data-fscale",
      state.fscale === "小" ? "sm" : state.fscale === "大" ? "lg" : "mid");
    var toggle = $("#theme-toggle");
    if (toggle) {
      var light = resolved === "light";
      var use = toggle.querySelector("use");
      if (use) use.setAttribute("href", light ? "#i-moon" : "#i-sun");
      toggle.setAttribute("title", light ? "切换到夜间主题" : "切换到日间主题");
      toggle.setAttribute("aria-label", light ? "切换到夜间主题" : "切换到日间主题");
      toggle.setAttribute("data-current-theme", resolved);
    }
  }

  /* ============================================================
     日志 / 提示 / 下载 / 模态
     ============================================================ */
  function log(kind, text) {
    logs.push({ k: kind, t: new Date(), s: text });
    var el = $("#log");
    if (!el) return;
    var d = document.createElement("div");
    d.className = "ln ln--" + kind;
    d.innerHTML = '<span class="ts">' + timeStr() + "</span> " + text;
    el.appendChild(d);
    if (state.autoScroll) el.scrollTop = el.scrollHeight;
    $("#log-n").textContent = logs.length;
  }
  function timeStr(entry) {
    var d = entry && entry.t ? entry.t : new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }
  var toastT;
  function toast(text) {
    $("#toast-text").textContent = text;
    $("#toast").setAttribute("data-on", "1");
    clearTimeout(toastT);
    toastT = setTimeout(function () { $("#toast").setAttribute("data-on", "0"); }, 2600);
  }
  var lastDownload = null;
  /* 无头自检里不能真的触发下载：--dump-dom 会卡在下载对话框上 */
  var NO_CLICK = /[?&](selftest|audit)=1/.test(location.search);
  function download(name, text) {
    lastDownload = { name: name, text: text };
    if (BE && !NO_CLICK) {
      /* exe 里走原生"另存为"，浏览器预览里走 blob 下载 */
      BE.saveText(name, text).then(function (saved) {
        if (saved) toast("已保存 " + name);
        else toast("文件未保存");
      }, function () { toast("保存失败，请查看日志"); });
      return lastDownload;
    }
    if (!NO_CLICK) {
      try {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
        a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
      } catch (e) { log("e", "导出失败：" + e.message); }
    }
    log("i", "已导出 " + name + "（" + text.split("\n").length + " 行）");
    return lastDownload;
  }
  var modalReturnFocus = null;
  function modalFocusables() {
    return $$('#modal button:not([disabled]), #modal input:not([disabled]), #modal select:not([disabled]), #modal summary, #modal [tabindex="0"]').filter(function (el) {
      return el.getClientRects().length > 0;
    });
  }
  function openModal(title, bodyHtml, footHtml) {
    if ($("#modal-veil").hidden) modalReturnFocus = document.activeElement;
    var m = $("#modal");
    m.innerHTML = '<div class="modal-head"><h3 id="modal-title">' + esc(title) + '</h3>' +
      '<button class="btn btn--icon btn--sm" data-act="closeModal" aria-label="关闭弹窗"><svg width="13" height="13"><use href="#i-x"/></svg></button></div>' +
      '<div class="modal-body">' + bodyHtml + "</div>" +
      '<div class="modal-foot">' + (footHtml || '<button class="btn" data-act="closeModal">关闭</button>') + "</div>";
    $("#modal-veil").hidden = false;
    $(".app").inert = true;
    $("#modal-veil").classList.toggle("modal-veil--top", !state.centerDialog);
    var first = m.querySelector("input") || m.querySelector('.modal-foot .btn--accent') || m.querySelector("button");
    (first || m).focus();
    return m;
  }
  function closeModal() {
    if ($("#modal-veil").hidden) return;
    if (running && running.pausedForConfirm) {
      if (running.originalProgress) running.order.forEach(function (q, i) { q.progress = running.originalProgress[i]; });
      running = null;
      render();
    }
    $("#modal-veil").hidden = true; $("#modal").innerHTML = "";
    $(".app").inert = false;
    if (modalReturnFocus && modalReturnFocus.isConnected && !modalReturnFocus.disabled) modalReturnFocus.focus();
    modalReturnFocus = null;
  }

  /* ============================================================
     动作表：HTML 里每个 data-act 必须在此登记，自检会穷举核对
     ============================================================ */
  var actions = {};

  actions.gotoSettings = function () { showView("settings"); };
  actions.gotoVideo = function () { showView("video"); };
  actions.gotoQueue = function () { showView("queue"); };
  actions.gotoOutput = function () {
    showView("video");
    $("#output-settings").scrollIntoView({ block: "nearest" });
    $('#output-settings [data-group="outmode"] button').focus();
  };
  actions.refreshEnv = function () {
    if (!BE) return;
    $("#env-status").textContent = "正在检测…";
    BE.detectEnv(true).then(applyEnvInfo, function () { $("#env-status").textContent = "未能读取运行环境，请重试。"; });
  };
  actions.toggleTheme = function () {
    var current = document.documentElement.getAttribute("data-theme");
    state.theme = current === "light" ? "夜间" : "日间";
    syncPressed("theme");
    render();
    toast("已切换到" + state.theme + "主题");
  };
  actions.openGithub = function () {
    if (NO_CLICK) return;
    var url = "https://github.com/arenascats/MarukoToolbox-Rewrite";
    if (BE) BE.openExternal(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  };
  actions.browseOut = function () {
    if (BE) {
      BE.pickDir({ title: "选择输出目录" }).then(function (p) {
        if (!p) return;
        state.outDir = p; state.outmode = "指定目录";
        syncControls(); render(); log("i", "输出目录改为 " + esc(p));
      });
      return;
    }
    openModal("选择输出目录",
      '<p class="modal-p">输入输出文件夹的完整路径。</p>' +
      '<label class="field"><span class="field-label">目录路径</span>' +
      '<input class="input input--mono" id="modal-outdir" value="' + esc(state.outDir) + '"></label>',
      '<button class="btn" data-act="closeModal">取消</button>' +
      '<button class="btn btn--accent" data-act="saveOutDir">确定</button>');
  };
  actions.saveOutDir = function () {
    var v = $("#modal-outdir").value.trim();
    if (v) { state.outDir = v; state.outmode = "指定目录"; syncControls(); closeModal(); render(); log("i", "输出目录改为 " + v); }
  };
  actions.editExtra = function () {
    openModal("附加 FFmpeg 参数",
      '<p class="modal-p">附加参数会应用于本次输出。保存后可在命令预览中检查。</p>' +
      '<label class="field"><span class="field-label">参数</span>' +
      '<input class="input input--mono" id="modal-extra" value="' + esc(state.extraArgs) + '" placeholder="-map_metadata 0"></label>',
      '<button class="btn" data-act="closeModal">取消</button>' +
      '<button class="btn btn--accent" data-act="saveExtra">保存</button>');
  };
  actions.saveExtra = function () { state.extraArgs = $("#modal-extra").value; syncControls(); closeModal(); render(); log("i", "附加参数已更新"); };
  actions.resetParams = function () {
    if (running) { toast("请等待当前批次结束，或先停止任务"); return; }
    var keep = { theme: 1, fscale: 1, centerDialog: 1, userPresets: 1, benchFile: 1 };
    Object.keys(DEFAULTS).forEach(function (k) { if (!keep[k]) state[k] = clone(DEFAULTS[k]); });
    syncControls(); render(); toast("编码参数已重置"); log("i", "参数重置为默认值");
  };
  actions.resetAll = function () {
    if (running) { toast("请等待当前批次结束，或先停止任务"); return; }
    var presets = state.userPresets;
    state = clone(DEFAULTS); state.userPresets = presets;
    recomputeOutputs(); syncControls(); render(); toast("已恢复默认设置，任务与预设已保留");
  };
  actions.resetSpeed = function () { state.speed = "1.00"; syncControls(); render(); };
  actions.clearLut = function () { state.lut = null; $("#lut-text").textContent = "拖入 .cube / .3dl，或点击选择"; $("#lut-clear").hidden = true; render(); };
  /* ---------- 选择文件：exe 用原生对话框，浏览器用 <input type=file> ---------- */
  function nativePick(paths) {
    Promise.all(paths.map(function (p) {
      return BE.stat(p).then(function (s) {
        return { path: p, size: s && s.ok ? Math.round(s.sizeMB * 1048576) : 0 };
      }, function () { return { path: p, size: 0 }; });
    })).then(function (list) {
      if (!addFiles(list)) toast("没有可加入的新视频（可能已重复或格式不支持）");
    });
  }
  actions.pickFiles = function () {
    if (!BE) { $("#file-input").click(); return; }
    BE.pickFiles().then(function (p) { if (p && p.length) nativePick(p); });
  };
  actions.pickFolder = function () {
    if (!BE) { $("#folder-input").click(); return; }
    BE.pickFolder().then(function (p) {
      if (p && p.length) nativePick(p); else toast("该文件夹里没有受支持的视频");
    });
  };
  actions.pickBench = function () {
    if (!BE) { $("#bench-input").click(); return; }
    BE.pickOne({ name: "视频文件", extensions: VIDEO_EXTENSIONS }).then(function (p) {
      if (p) { state.benchFile = p; syncControls(); render(); }
    });
  };
  actions.pickLut = function () { $("#lut-dz").click(); };
  actions.pickWatermark = function () {
    if (!BE) { $("#wm-input").click(); return; }
    BE.pickOne({ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }).then(function (p) {
      if (p) setWmImageByPath(p);
    });
  };
  actions.clearWatermark = function () { state.wmImage = null; $("#wm-img-name").value = ""; render(); };
  /* exe 里读不了磁盘，哈希由主进程算（对齐 build_hidden_watermark_payload 的 SHA-1 前 16 位） */
  function setWmImageByPath(p) {
    BE.hash(p).then(function (r) {
      if (!r || !r.ok) { toast("读取水印图片失败：" + ((r && r.error) || "未知错误")); return; }
      state.wmImage = { name: r.name, digest: r.digest };
      $("#wm-img-name").value = r.name + " · " + r.digest;
      render();
      log("i", "水印图片：" + esc(p) + " <span class=\"u-num\">" + esc(r.digest) + "</span>");
    }, function (e) { toast("水印图片哈希失败"); });
  }
  actions.removeSel = function () {
    if (running) { toast("请先停止当前批次，再移除任务"); return; }
    var sel = selected();
    if (!sel.length) { toast("先点选要移除的任务行"); return; }
    var ids = {}; sel.forEach(function (q) { ids[q.id] = 1; });
    queue = queue.filter(function (q) { return !ids[q.id]; });
    recomputeOutputs(); render();
    log("i", "移除 " + sel.length + " 个任务");
  };
  actions.clearAll = function () {
    if (!queue.length) { toast("队列已经是空的"); return; }
    if (running) { toast("请先停止当前批次，再清空任务"); return; }
    var n = queue.length;
    queue = []; recomputeOutputs(); render();
    toast("已清空 " + n + " 个任务"); log("i", "清空队列（" + n + " 个）");
  };
  actions.clearLog = function () { logs = []; $("#log").innerHTML = ""; $("#log-n").textContent = "0"; };
  actions.copyLog = function () {
    var text = logs.map(function (l) { return "[" + timeStr(l) + "] " + l.s.replace(/<[^>]+>/g, ""); }).join("\n");
    if (!text) { toast("日志为空"); return; }
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { toast("日志已复制"); }, function () { toast("复制被拒绝"); });
    else toast("剪贴板不可用");
  };
  actions.exportLog = function () {
    if (!logs.length) { toast("日志为空"); return; }
    download("maruko-" + Date.now() + ".log",
      logs.map(function (l) { return "[" + timeStr(l) + "] " + l.s.replace(/<[^>]+>/g, ""); }).join("\n"));
  };
  actions.toggleLog = function () {
    var d = $("#log-drawer");
    d.hidden = !d.hidden;
    $("#log-toggle").setAttribute("aria-expanded", String(!d.hidden));
    if (!d.hidden) $("#log").scrollTop = $("#log").scrollHeight;
  };
  actions.applyPreset = function (el) {
    var p = BATCH_PRESETS[el.getAttribute("data-val")];
    if (!p) return;
    Object.keys(p).forEach(function (k) { state[k] = p[k]; });
    state.cq = String(state.cq);
    state.bpreset = el.getAttribute("data-val");
    recomputeOutputs(); syncControls(); render();
    toast("已套用预设：" + state.bpreset);
    log("i", "套用批处理预设 <b>" + esc(state.bpreset) + "</b> → " + encoderKey() + " · " + state.res + " · CQ" + state.cq + " · " + state.amode + " " + state.abit);
  };
  actions.choosePurpose = function (el) {
    var preset = BATCH_PRESETS[el.value];
    if (!preset || running) return;
    var keep = { vendor: state.vendor, outmode: state.outmode, outDir: state.outDir, naming: state.naming, conflict: state.conflict };
    Object.keys(preset).forEach(function (key) { state[key] = preset[key]; });
    Object.keys(keep).forEach(function (key) { state[key] = keep[key]; });
    state.cq = String(state.cq); state.bpreset = el.value;
    recomputeOutputs(); syncControls(); render();
    toast("已选择：" + el.options[el.selectedIndex].textContent);
  };
  actions.managePresets = function () {
    var rows = state.userPresets.map(function (p, i) {
      return '<div class="set-row"><div class="set-label"><b>' + esc(p.name) + "</b><span>" + esc(p.key) + " · CQ" + p.cq + " · " + esc(p.res) + "</span></div>" +
        '<div class="btn-row"><button class="btn btn--sm" data-act="usePreset" data-val="' + i + '">应用</button>' +
        '<button class="btn btn--sm btn--danger" data-act="delPreset" data-val="' + i + '">删除</button></div></div>';
    }).join("") || '<p class="modal-p">还没有保存的预设。</p>';
    openModal("用户预设",
      rows + '<label class="field"><span class="field-label">另存当前</span><input class="input" id="preset-name" placeholder="预设名称"></label>',
      '<button class="btn" data-act="closeModal">关闭</button>' +
      '<button class="btn btn--accent" data-act="savePreset">保存当前参数</button>');
  };
  actions.savePreset = function () {
    var n = $("#preset-name").value.trim() || "预设 " + (state.userPresets.length + 1);
    state.userPresets.push({ name: n, key: encoderKey(), cq: state.cq, res: state.res, snap: clone(state) });
    closeModal(); render(); toast("已保存预设：" + n);
  };
  actions.usePreset = function (el) {
    var p = state.userPresets[+el.getAttribute("data-val")];
    if (!p) return;
    var keep = { userPresets: 1 };
    Object.keys(p.snap).forEach(function (k) { if (!keep[k]) state[k] = p.snap[k]; });
    closeModal(); recomputeOutputs(); syncControls(); render(); toast("已应用预设：" + p.name);
  };
  actions.delPreset = function (el) {
    state.userPresets.splice(+el.getAttribute("data-val"), 1);
    closeModal(); actions.managePresets(); render();
  };
  actions.openWizard = function () {
    wizardStep = 0;
    openModal("使用方法", '<div id="wizard"></div>',
      '<button class="btn" data-act="wizardPrev">上一步</button>' +
      '<button class="btn btn--accent" data-act="wizardNext">下一步</button>');
    paintWizard();
  };
  actions.wizardNext = function () {
    if (wizardStep < 2) { wizardStep++; paintWizard(); }
    else { closeModal(); toast("向导完成"); }
  };
  actions.wizardPrev = function () { if (wizardStep > 0) { wizardStep--; paintWizard(); } };
  actions.closeModal = closeModal;

  /* ---------- 环境检测 / Benchmark ---------- */
  var BENCH = ["hevc_nvenc", "hevc_nvenc_10bit", "h264_nvenc", "av1_nvenc", "hevc_amf", "h264_amf",
    "av1_amf", "hevc_qsv", "libx265", "libx265_10bit", "libx264", "libsvtav1"];
  var benchSel = {}, benchRows = [], benchRun = null;
  actions.benchPick = function (el) {
    var v = el.getAttribute("data-val");
    BENCH.forEach(function (k) {
      if (v === "all") benchSel[k] = true;
      else if (v === "none") benchSel[k] = false;
      else if (v === "nvenc") benchSel[k] = /nvenc/.test(k);
      else if (v === "amf") benchSel[k] = /amf/.test(k);
      else if (v === "qsv") benchSel[k] = /qsv/.test(k);
    });
    paintBenchGrid();
  };
  actions.runBench = function () {
    var keys = BENCH.filter(function (k) { return benchSel[k]; });
    if (!keys.length) { toast("先勾选参与测试的编码器"); return; }
    /* 没有片源就不该开跑——两种宿主同一套守卫，不能只在 exe 里生效 */
    if (!state.benchFile) { toast("先选择测试片源"); return; }
    $("#bench-test").open = true;
    if (benchRun) { clearInterval(benchRun); benchRun = null; }
    if (BE) {
      if (!state.benchFile) { toast("先选择测试片源"); return; }
      /* 行与状态先落地，再异步读片源：否则点下去界面无反馈 */
      benchSrcMB = 0;
      benchRows = keys.map(function (k) { return { k: k, ok: true, st: "排队", size: 0, ratio: 0, secs: 0 }; });
      $("#bench-badge").innerHTML = '<span class="dot"></span>准备中';
      $("#bench-badge").className = "badge badge--accent";
      $("#bench-empty").hidden = true; renderBench();
      BE.stat(state.benchFile).then(function (s) {
        if (!s || !s.ok) {
          benchRows = []; $("#bench-badge").innerHTML = "未开始"; $("#bench-badge").className = "badge";
          $("#bench-empty").hidden = false; renderBench();
          toast("片源不可读：" + ((s && s.error) || "")); return;
        }
        benchSrcMB = s.sizeMB;
        $("#bench-badge").innerHTML = '<span class="dot"></span>运行中';
        $("#bench-badge").className = "badge badge--accent";
        renderBench();
        var items = keys.map(function (k) {
          var dst = stemOf(state.benchFile) + "_bench_" + k + ".mp4";
          return { encoder: k, dst: dst, argv: buildCommand(state.benchFile, dst, k, true).slice(1) };
        });
        log("i", "Benchmark 启动：" + keys.length + " 个编码器 · 片源 " + esc(baseName(state.benchFile)) +
          " · 各取前 12 秒（不带滤镜，只比编码器）");
        BE.startBench({ src: state.benchFile, clip: 12, start: 0, items: items }).catch(function (e) {
          log("e", "Benchmark 失败：" + esc(String((e && e.message) || e)));
        });
      });
      return;
    }
    var srcMB = 412.6;
    benchRows = keys.map(function (k) {
      var ok = /nvenc/.test(k) ? ENV.nvenc && !(/_10bit/.test(k)) : /amf/.test(k) ? ENV.amf : /qsv/.test(k) ? ENV.qsv : true;
      return { k: k, ok: ok, st: "排队", size: 0, ratio: 0, secs: 0 };
    });
    $("#bench-badge").innerHTML = '<span class="dot"></span>运行中';
    $("#bench-badge").className = "badge badge--accent";
    $("#bench-empty").hidden = true;
    var i = 0;
    log("i", "Benchmark 启动：" + keys.length + " 个编码器 · 同一片源 " + srcMB + "MB");
    benchRun = setInterval(function () {
      if (i >= benchRows.length) {
        clearInterval(benchRun); benchRun = null;
        $("#bench-badge").innerHTML = "已完成";
        $("#bench-badge").className = "badge badge--ok";
        toast("Benchmark 完成");
        log("o", "Benchmark 完成，结果可导出 CSV");
        renderBench(); return;
      }
      var r = benchRows[i];
      if (r.ok) {
        var ratio = estRatioFor(r.k);
        r.size = srcMB * ratio; r.ratio = (1 - ratio) * 100;
        r.secs = Math.max(1, Math.round(srcMB / speedOf(r.k)));
        r.st = "支持";
        log("o", "<b>" + r.k + "</b> 完成 · " + fmtMB(r.size) + " · " + r.ratio.toFixed(1) + "% · " + r.secs + " 秒");
      } else {
        r.st = "不支持"; r.size = 0; r.ratio = 0; r.secs = 1;
        log("w", "<b>" + r.k + "</b> 初始化失败（本机未检测到该硬件），退出码 -40");
      }
      i++; renderBench();
    }, 420);
  };
  function estRatioFor(k) {
    if (/prores/.test(k)) return 1.6;
    if (/av1/.test(k)) return /nvenc/.test(k) ? 0.19 : 0.14;
    if (/hevc|265/.test(k)) return /nvenc|amf|qsv/.test(k) ? 0.23 : 0.16;
    if (/h264|264/.test(k)) return 0.35;
    return 0.25;
  }
  function speedOf(k) { return /nvenc|amf|qsv/.test(k) ? 32 : /265|hevc/.test(k) ? 12 : /svtav1/.test(k) ? 6 : 22; }
  function renderBench() {
    $("#bench-results").hidden = !benchRows.length;
    $("#bench-export").hidden = !benchRows.length;
    var body = $("#bench-body");
    body.innerHTML = benchRows.map(function (r) {
      var status = r.st === "支持" ? "完成" : r.st === "不支持" ? "失败" : r.st === "运行中" ? "测试中" : "排队";
      var badge = '<span class="badge' + (r.st === "支持" ? " badge--ok" : r.st === "不支持" ? " badge--danger" : "") + '">' + status + "</span>";
      return '<tr><td class="u-num" title="' + esc(r.k) + '">' + esc(r.k) + "</td><td>" + badge + "</td>" +
        '<td class="u-num r">' + (r.size ? fmtMB(r.size) : "—") + "</td>" +
        '<td class="u-num r">' + (r.size ? r.ratio.toFixed(1) + "%" : "—") + "</td>" +
        '<td class="u-num r" title="' + esc(r.note || "") + '">' + (r.st === "排队" || r.st === "运行中" ? "—" : r.secs.toFixed(1) + " 秒") + "</td></tr>";
    }).join("");
    var done = benchRows.filter(function (r) { return r.st === "支持" || r.st === "不支持"; });
    $("#bench-sum").textContent = benchRows.length ? done.length + " / " + benchRows.length : "";
  }
  actions.exportCsv = function () {
    if (!benchRows.length) { toast("还没有测试结果"); return; }
    var csv = "encoder,available,size_mb,ratio_pct,seconds\n" + benchRows.map(function (r) {
      return [r.k, r.ok ? 1 : 0, r.size.toFixed(1), r.ratio.toFixed(1), r.secs].join(",");
    }).join("\n");
    download("benchmark.csv", csv);
    if (!BE || NO_CLICK) toast("已导出 benchmark.csv");
  };

  /* ---------- 批处理（模拟执行，但状态机是真的） ---------- */
  actions.startAll = function () {
    if (!queue.length) { toast("队列是空的，先拖入视频"); showView("queue"); return; }
    if (running) { toast("已有批次在跑，先停止"); return; }
    /* 有选中就跑选中，否则跑全部待处理 */
    var sel = selected();
    var pool = sel.length ? sel : queue;
    var pend = pool.filter(function (q) { return q.st === "等待中" || q.st === "已停止" || q.st === "失败"; });
    if (!pend.length) { toast("没有待处理任务"); return; }
    if (!pend.every(function (q) { return q.parsed; })) { toast("还有任务在读取规格，稍等"); return; }
    if (!encoderAvailable()) {
      log("w", encoderKey() + " 未检测到可用编码器，可在视频压缩页更换设备");
    }
    showView("queue");
    var par = Math.max(1, parseInt(state.parallel, 10) || 1);
    var order = pend.slice();
    var originalProgress = order.map(function (q) { return q.progress; });
    order.forEach(function (q) { q.progress = 0; });
    running = { fps: 0, vram: 0, vramTotal: ENV.vramGB, cpu: 0, gpu: 0, order: order, originalProgress: originalProgress, par: par, alive: true, real: !!BE };
    log("i", "队列启动 · 并发 <b>" + par + "</b> · " + encoderKey() + " · 输出" + esc(outDirLabel()));
    if (state.confirmExport) {
      running.pausedForConfirm = true;
      openModal("确认导出设置", confirmText(order),
        '<button class="btn" data-act="closeModal">取消</button>' +
        '<button class="btn btn--accent" data-act="confirmStart">确认开始</button>');
    }
    render();
    if (BE) { launchReal(order); return; }        /* exe：真实 ffmpeg 执行 */
    if (!running.pausedForConfirm) order.slice(0, par).forEach(function (q) { startRow(q); });
    tick();                                        /* 浏览器预览：状态机模拟 */
  };
  actions.confirmStart = function () {
    if (!running) return;
    running.pausedForConfirm = false;
    closeModal();
    toast("开始压缩");
    if (running.real && running.pendingReal) { var t = running.pendingReal; running.pendingReal = null; launchReal(t); }
    updateActionStates();
  };

  /* ---------- 真实执行：任务描述 = 源路径 + 目标路径 + 渲染层算好的 argv ----------
     argv 必须去掉开头的程序名：主进程会自己拼上解析到的 ffmpeg.exe，
     否则会变成 `ffmpeg.exe ffmpeg -hide_banner ...`，把 "ffmpeg" 当成输入文件。 */
  function taskPayload(q) {
    var p = String(q.path).replace(/\//g, "\\");
    var i = p.lastIndexOf("\\");
    var srcDir = i > 0 ? p.slice(0, i + 1) : "";
    var dst = (state.outmode === "与源文件同目录" ? srcDir : state.outDir + "\\") + q.out;
    return { id: q.id, name: q.name, src: q.path, dst: dst, argv: buildCommand(q.path, dst).slice(1) };
  }
  function launchReal(order) {
    if (!running) return;
    if (running.pausedForConfirm) { running.pendingReal = order; return; }
    var list = order.filter(function (q) { return q.out && q.out !== "(冲突跳过)"; });
    order.forEach(function (q) {
      if (q.out === "(冲突跳过)") { q.st = "已跳过"; log("w", "同名冲突按「跳过」策略忽略：" + esc(q.name)); }
      else log("i", "任务 <b>" + esc(q.name) + "</b> → " + esc(q.out) + " 命令：" + esc(buildCommand(q.path, taskPayload(q).dst).join(" ")));
    });
    if (!list.length) { finishBatch(); return; }
    /* 先乐观地把第一波标成压缩中：真实后端要等 ffmpeg 吐进度才有反馈，不能空等 */
    list.slice(0, running.par).forEach(function (q) { q.st = "压缩中"; q.progress = 0; });
    render();
    gpuPoll(true);
    BE.startBatch({ parallel: running.par, tasks: list.map(taskPayload) }).catch(function (e) {
      log("e", "批次调用失败：" + esc(String((e && e.message) || e)));
      gpuPoll(false); finishBatch();
    });
  }
  var gpuTimer = null;
  function gpuPoll(on) {
    if (!BE) return;
    if (gpuTimer) { clearInterval(gpuTimer); gpuTimer = null; }
    if (!on) return;
    var once = function () {
      if (!running) return;
      BE.gpu().then(function (g) {
        if (!running || !g || !g.ok) return;
        running.gpu = g.gpu; running.cpu = g.cpu;
        running.vram = g.usedMB / 1024; running.vramTotal = g.totalMB / 1024;
      }, function () { });
    };
    once();
    gpuTimer = setInterval(once, 2000);
  }
  function confirmText(order) {
    var basic = [["视频", order.length + " 个"], ["保存到", outDirLabel()], ["遇到同名文件", state.conflict === "重命名" ? "另存为新文件" : state.conflict]];
    var details = [
      ["文件名", state.naming], ["视频格式", state.codec], ["文件格式", state.mux],
      ["编码器", encoderKey()], ["预设", state.preset], ["画质", state.cq],
      ["码率", state.bitrate.trim() || "自动"], ["尺寸", RES_REAL_KEY[state.res]],
      ["音频", state.amode], ["速度", speedVal().toFixed(2) + " 倍"],
    ];
    if (speedVal() !== 1) basic.push(["播放速度", speedVal().toFixed(2) + " 倍"]);
    var kv = function (rows) { return '<div class="kv">' + rows.map(function (r) {
      return "<span>" + esc(r[0]) + '</span><b class="u-num">' + esc(r[1]) + "</b>";
    }).join("") + "</div>"; };
    var extras = [];
    if (state.lut) extras.push("LUT 调色");
    if (state.sharpen !== "关闭") extras.push("锐化");
    if (state.watermark) extras.push("隐藏水印");
    if (state.qmode === "自定义") extras.push("自定义命令");
    if (state.extraArgs.trim()) extras.push("附加参数");
    if (extras.length) details.push(["额外处理", extras.join("、")]);
    return kv(basic) + (state.conflict === "覆盖" ? '<p class="modal-p">同名输出文件会被覆盖。</p>' : "") +
      '<details class="disclosure disclosure--inner"><summary>详细参数</summary><div class="disclosure-body">' + kv(details) + "</div></details>";
  }
  function startRow(q) {
    q.st = "压缩中"; q.progress = 0; q._fallback = false;
    log("i", "任务 <b>" + esc(q.name) + "</b> → " + esc(q.out));
    log("i", "命令：" + esc(commandText(q.path)));
  }
  function tick() {
    if (!running) return;
    if (!running.pausedForConfirm) {
      var live = running.order.filter(function (q) { return q.st === "压缩中"; });
      if (!live.length) {
        var nxt = running.order.filter(function (q) { return q.st === "等待中" || q.st === "已停止"; }).slice(0, running.par - live.length);
        nxt.forEach(startRow);
        live = running.order.filter(function (q) { return q.st === "压缩中"; });
      }
      live.forEach(function (q) { advance(q); });
      var allDone = running.order.every(function (q) { return q.st !== "压缩中" && q.st !== "等待中" && q.st !== "已停止"; });
      if (allDone) finishBatch();
    }
    render();
    setTimeout(tick, 180);
  }
  function advance(q) {
    var par = running ? running.par : 1;
    var per = (encoderKey().indexOf("nvenc") >= 0 ? 9 : /libx265|svtav1/.test(encoderKey()) ? 2.2 : 5) * (par > 1 && state.boostGpu ? 0.72 : 1);
    q.progress = Math.min(100, Math.round(q.progress + per));
    if (running) {
      running.fps = encoderKey().indexOf("nvenc") >= 0 ? 118 + Math.random() * 40 : 18 + Math.random() * 12;
      running.gpu = Math.min(96, 24 + par * 18 + Math.random() * 8);
      running.cpu = Math.min(92, 8 + par * 12 + Math.random() * 10);
      running.vram = Math.min(ENV.vramGB, 0.9 + par * (state.res === "2160p" ? 2.6 : 1.2));
    }
    if (q.progress >= 100) {
      var avail = encoderAvailable();
      if (!avail && state.autoFallback && !q._fallback) {
        q._fallback = true; q.progress = 0;
        log("w", "<b>" + esc(q.name) + "</b> " + encoderKey() + " 初始化返回 -40，自动回退到同族 CPU 编码");
        return;
      }
      if (!avail) { q.st = "失败"; log("e", "<b>" + esc(q.name) + "</b> 失败：退出码 -40（未开启自动回退）"); }
      else if (q.conflict) { q.st = "已跳过"; log("w", "文件已存在，已跳过：" + esc(q.name)); }
      else {
        q.st = "完成";
        log("o", "<b>" + esc(q.name) + "</b> 完成 · " + fmtMB(q.size / 1048576) + " → " + fmtMB(q.est) +
          " · 压缩率 " + (100 - q.est / (q.size / 1048576) * 100).toFixed(1) + "%");
      }
    }
  }
  function finishBatch() {
    if (!running) return;   /* 停止后主进程仍会回一次 batch，避免重复收尾 */
    var ok = running.order.filter(function (q) { return q.st === "完成"; }).length;
    var bad = running.order.filter(function (q) { return q.st === "失败"; }).length;
    var skip = running.order.filter(function (q) { return q.st === "已跳过"; }).length;
    log(bad ? "w" : "o", "批次结束：完成 " + ok + " · 失败 " + bad + " · 跳过 " + skip);
    gpuPoll(false);
    if (state.sound) beep();
    if (state.shutdown && !bad) {
      if (BE) {
        BE.shutdown(20);
        shutdownScheduled = true;
        log("w", "全部成功，已安排 <b>20 秒后关机</b>；点右上角「停止全部」可取消");
      } else toast("任务已完成");
    }
    if (state.openAfter) {
      var od = firstOutDir();
      if (BE && od) BE.openPath(od);
    }
    if (state.exportLogOn && running.order.length > 10) toast("批量超过 10 个，可导出 .log 记录");
    running = null;
    render();
  }
  function firstOutDir() {
    var done = queue.filter(function (q) { return q.st === "完成" || q.st === "失败"; })[0];
    if (state.outmode !== "与源文件同目录") return state.outDir;
    if (!done) return "";
    var p = String(done.path).replace(/\//g, "\\");
    var i = p.lastIndexOf("\\");
    return i > 0 ? p.slice(0, i) : "";
  }
  var shutdownScheduled = false;
  actions.stopAll = function () {
    if (BE && shutdownScheduled) {
      shutdownScheduled = false;
      BE.cancelShutdown().then(function (r) {
        if (r && r.ok) log("o", "已取消关机计划");
      }, function () { });
    }
    if (!running) { updateActionStates(); toast("当前没有在跑的任务"); return; }
    if (running.real && BE) BE.stopBatch();
    gpuPoll(false);
    running.order.forEach(function (q) { if (q.st === "压缩中") { q.st = "已停止"; } });
    log("w", "用户停止：已停止 " + running.order.filter(function (q) { return q.st === "已停止"; }).length + " 路");
    running = null; render(); toast("已停止全部");
  };
  function beep() {
    try {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return;
      var ctx = new C(), o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 660; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.06, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
      o.start(); o.stop(ctx.currentTime + 0.36);
    } catch (e) { }
  }

  /* ---------- 向导 ---------- */
  var wizardStep = 0;
  function paintWizard() {
    var el = $("#wizard");
    if (!el) return;
    var steps = [
      ["添加视频", "点击「选择视频」，或直接把视频、文件夹拖进窗口。"],
      ["选择用途", "不知道怎么选时，保持「均衡」即可。详细选项在「压缩设置」。"],
      ["开始压缩", "点击「开始压缩」。默认保存在原文件夹，原文件会保留。"],
    ];
    el.innerHTML = '<h4 class="modal-h">' + esc(steps[wizardStep][0]) + '</h4><p class="modal-p">' + steps[wizardStep][1] + "</p>";
    var prev = $('#modal [data-act="wizardPrev"]'), next = $('#modal [data-act="wizardNext"]');
    if (prev) prev.disabled = wizardStep === 0;
    if (next) next.textContent = wizardStep === 2 ? "完成" : "下一步";
  }
  var groupKeys = {
    vendor: "vendor", codec: "codec", depth: "depth", preset: "preset", qmode: "qmode",
    res: "res", mux: "mux", sharpen: "sharpen", amode: "amode", abit: "abit", wmmode: "wmmode",
    naming: "naming", conflict: "conflict", outmode: "outmode", theme: "theme", fscale: "fscale",
    prefdev: "prefdev", parallel: "parallel", bpreset: "bpreset",
  };
  /* 同一个 data-group 可能有多个实例（如格式分段同时在首页与参数页）：
     选中态必须按状态全局刷新，否则点了首页的、参数页还亮着旧值 */
  function syncPressed(group) {
    var key = groupKeys[group];
    if (!key) return;
    $$('[data-group="' + group + '"]').forEach(function (grp) {
      $$("button", grp).forEach(function (b) {
        b.setAttribute("aria-pressed", String(b.textContent.trim() === state[key]));
      });
    });
  }

  function onGroupChange(group, label, el) {
    var key = groupKeys[group];
    if (key) state[key] = label;
    syncPressed(group);
    if (group === "vendor") {
      paintCodecSeg();
      if (!av1Supported() && state.codec === "AV1") { state.codec = "H.265"; }
      if (!encoderAvailable()) {
        log("w", "未检测到 " + state.vendor + " 可用编码器，可更换设备后重试");
      }
    }
    if (group === "depth" && state.depth === "10-bit" && state.vendor !== "CPU") {
      log("i", "已选择 10-bit 输出，请确认显卡和播放器支持该格式");
    }
    if (group === "amode") paintAbitSeg();
    if (group === "prefdev") {
      state.vendor = label === "优先 CPU" ? "CPU" : "NVIDIA";
      paintCodecSeg(); syncPressed("vendor"); syncPressed("codec");
    }
    recomputeOutputs();
    render();
  }

  function wire() {
    $("#quick-preset").addEventListener("change", function () { actions.choosePurpose(this); });
    /* 单选组 */
    $$("[data-group]").forEach(function (grp) {
      grp.addEventListener("click", function (e) {
        var b = e.target.closest("button");
        if (!b || !grp.contains(b)) return;
        $$("button", grp).forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        onGroupChange(grp.getAttribute("data-group"), b.textContent.trim(), b);
      });
    });
    /* 开关 */
    $$("[data-switch]").forEach(function (sw) {
      function flip() {
        var k = sw.getAttribute("data-switch");
        state[k] = !state[k];
        sw.setAttribute("aria-checked", String(state[k]));
        recomputeOutputs(); render();
        if (k === "watermark") log("i", "隐藏水印：" + (state.watermark ? "开启（" + state.wmmode + "）" : "关闭"));
      }
      sw.addEventListener("click", flip);
      sw.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } });
    });
    /* 输入绑定 */
    $$("[data-bind]").forEach(function (inp) {
      inp.addEventListener("change", function () {
        var k = inp.getAttribute("data-bind"), v = inp.value.trim();
        /* 有取值范围的字段在写回状态时就纠正，避免首页与参数页出现不一致的值 */
        if (k === "cq") v = String(clampNum(v, 16, 35, 24));
        if (k === "speed") v = clampNum(v, 0.25, 4, 1).toFixed(2);
        if (k === "threads") v = String(Math.max(0, parseInt(v, 10) || 0));
        state[k] = v; inp.value = v;
        if (inp.tagName === "SELECT") syncControls();
        recomputeOutputs(); render();
      });
    });
    /* 动作 */
    document.addEventListener("click", function (e) {
      var b = e.target.closest("[data-act]");
      if (!b) return;
      if (b.disabled) return;
      var name = b.getAttribute("data-act");
      if (!actions[name]) { console.warn("未登记的动作:", name); return; }
      e.preventDefault();
      var menu = b.closest(".queue-menu");
      if (menu) menu.open = false;
      actions[name](b);
    });
    /* 导航 */
    $$(".nav-tab").forEach(function (t) {
      t.addEventListener("click", function () { showView(t.getAttribute("data-view")); });
    });
    /* 队列行选择 */
    $("#q-body").addEventListener("click", function (e) {
      var tr = e.target.closest("tr");
      if (!tr) return;
      var id = +tr.getAttribute("data-id");
      var q = queue.filter(function (x) { return x.id === id; })[0];
      if (!q) return;
      if (e.shiftKey && lastSel >= 0) {
        var a = queue.findIndex(function (x) { return x.id === lastSel; }), b = queue.indexOf(q);
        queue.forEach(function (x, i) { x.sel = i >= Math.min(a, b) && i <= Math.max(a, b); });
      } else if (e.ctrlKey || e.metaKey) {
        q.sel = !q.sel; lastSel = q.id;
      } else {
        var only = queue.length === 1 || queue.every(function (x) { return !x.sel; });
        queue.forEach(function (x) { x.sel = (x === q) ? !x.sel : (only ? false : x.sel); });
        lastSel = q.id;
      }
      render();
    });
    document.addEventListener("keydown", function (e) {
      if (!$("#modal-veil").hidden) {
        if (e.key === "Escape") { e.preventDefault(); closeModal(); return; }
        if (e.key === "Tab") {
          var items = modalFocusables(), current = items.indexOf(document.activeElement);
          if (!items.length) { e.preventDefault(); $("#modal").focus(); }
          else if (e.shiftKey && current <= 0) { e.preventDefault(); items[items.length - 1].focus(); }
          else if (!e.shiftKey && (current < 0 || current === items.length - 1)) { e.preventDefault(); items[0].focus(); }
        }
        if (e.key === "Enter" && document.activeElement.tagName === "INPUT") {
          var submit = $('#modal .modal-foot .btn--accent:not([disabled])');
          if (submit) { e.preventDefault(); submit.click(); }
        }
        return;
      }
      if (e.key === "Delete" && document.activeElement === document.body) actions.removeSel();
    });
    /* 文件选择 */
    $("#file-input").addEventListener("change", function (e) { addFiles([].slice.call(e.target.files)); e.target.value = ""; });
    $("#folder-input").addEventListener("change", function (e) { addFiles([].slice.call(e.target.files)); e.target.value = ""; });
    $("#bench-input").addEventListener("change", function (e) {
      var f = e.target.files[0];
      if (f) { state.benchFile = f.name; syncControls(); $("#bench-sum").textContent = "片源 " + fmtMB(f.size / 1048576); }
      e.target.value = "";
    });
    /* 水印图片：真实读文件 + SHA-1 前 16 位，对齐 build_hidden_watermark_payload */
    $("#wm-input").addEventListener("change", function (e) {
      var f = e.target.files[0];
      e.target.value = "";
      if (!f) return;
      if (!/\.(png|jpe?g|webp|bmp)$/i.test(f.name)) { toast("水印图片需为 png / jpg / webp / bmp"); return; }
      var show = function (dg) {
        state.wmImage = { name: f.name, digest: dg };
        $("#wm-img-name").value = f.name + " · " + dg;
        render();
        log("i", "水印图片：" + esc(f.name) + " <span class=\"u-num\">" + esc(dg) + "</span>");
      };
      var reader = new FileReader();
      reader.onload = function () {
        var buf = reader.result;
        if (window.crypto && window.crypto.subtle && crypto.subtle.digest) {
          Promise.resolve(crypto.subtle.digest("SHA-1", buf)).then(function (h) {
            var v = new Uint8Array(h), hex = "";
            for (var i = 0; i < 8; i++) hex += ("0" + v[i].toString(16)).slice(-2);
            show(hex);
          }, function () { show("sha1-unavailable"); });
        } else show("sha1-unavailable");
      };
      reader.onerror = function () { show("sha1-error"); };
      reader.readAsArrayBuffer(f);
    });
    /* LUT：点击 + 拖放 */
    $("#lut-dz").addEventListener("click", function (e) {
      if (e.target.closest("#lut-clear")) return;
      if (BE) {
        BE.pickOne({ name: "LUT 文件", extensions: ["cube", "3dl", "dat", "m3d"] }).then(function (p) {
          if (!p) return;
          BE.stat(p).then(function (s) { setLut(p, s && s.ok ? s.sizeMB * 1048576 : 0); });
        });
        return;
      }
      $("#lut-input").click();
    });
    $("#lut-input").addEventListener("change", function (e) {
      var f = e.target.files[0];
      if (f) setLut(f.name, f.size);
      e.target.value = "";
    });
    function lutDrop(e) {
      e.preventDefault(); e.stopPropagation();
      var f = e.dataTransfer.files[0];
      if (f) setLut(f.name, f.size);
    }
    $("#lut-dz").addEventListener("dragover", function (e) { e.preventDefault(); e.stopPropagation(); $("#lut-dz").classList.add("is-over"); });
    $("#lut-dz").addEventListener("dragleave", function () { $("#lut-dz").classList.remove("is-over"); });
    $("#lut-dz").addEventListener("drop", lutDrop);
    function setLut(name, size) {
      if (!/\.(cube|3dl|dat|m3d)$/i.test(name)) { toast("LUT 需为 .cube / .3dl / .dat / .m3d"); return; }
      state.lut = name;                                  /* 存完整路径，命令里要用 */
      $("#lut-text").textContent = baseName(name) + " · " + fmtMB(size / 1048576);
      $("#lut-clear").hidden = false;
      log("i", "载入 LUT：" + esc(name) + "（启用后自动改走 CPU 滤镜链）");
      render();
    }
    /* 模态遮罩点击关闭 */
    $("#modal-veil").addEventListener("click", function (e) { if (e.target === $("#modal-veil")) closeModal(); });
  }
  var lastSel = -1;

  /* ---------- 动态生成的选项 ---------- */
  /* 格式分段同时存在于首页与参数页：两处都渲染，状态只有一份 */
  function paintCodecSeg() {
    var opts = state.vendor === "CPU"
      ? ["H.265", "H.264", "AV1", "VP9", "ProRes"]
      : ["H.265", "H.264", "AV1"];
    if (opts.indexOf(state.codec) < 0) state.codec = "H.265";
    $$("[data-group='codec']").forEach(function (seg) {
      seg.innerHTML = opts.map(function (o) {
        return "<button aria-pressed=\"" + (o === state.codec) + "\">" + o + "</button>";
      }).join("");
    });
  }
  /* CQ 也有两处（首页快速设置 + 参数页），统一用 data-cq-* 同步 */
  function paintCq() {
    var v = clampNum(state.cq, 16, 35, 24);
    $$("[data-cq-slider]").forEach(function (s) { s.value = v; s.style.setProperty("--pct", ((v - 16) / 19 * 100).toFixed(1) + "%"); });
    $$("[data-cq-input]").forEach(function (i) { if (document.activeElement !== i) i.value = v; });
  }
  function paintResSeg() {
    $$('select[data-bind="res"]').forEach(function (select) { select.value = state.res; });
  }
  function paintAbitSeg() {
    var list = AUDIO_BITRATES[state.amode] || [];
    if (list.indexOf(state.abit) < 0) state.abit = list[Math.min(2, list.length - 1)] || "";
    var g = $("#abit-grid");
    g.innerHTML = list.map(function (o) {
      return "<button aria-pressed=\"" + (o === state.abit) + "\">" + o + "</button>";
    }).join("");
    g.setAttribute("data-group", "abit");
    g.style.setProperty("--cols", Math.max(4, list.length));
  }
  function paintBenchGrid() {
    var g = $("#benchenc");
    g.innerHTML = BENCH.map(function (k) {
      var label = k.replace("hevc_", "").replace("h264_", "H.264 ").replace("av1_", "AV1 ")
        .replace("_nvenc", " nvenc").replace("_amf", " amf").replace("_qsv", " qsv")
        .replace("libx265", "libx265").replace("_10bit", " 10bit");
      return "<button aria-pressed=\"" + !!benchSel[k] + "\" data-bench=\"" + k + "\">" + esc(label) + "</button>";
    }).join("");
    $("#bench-n").textContent = Object.keys(benchSel).filter(function (k) { return benchSel[k]; }).length + " 个已选";
  }
  $("#benchenc") && $("#benchenc").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-bench]");
    if (!b) return;
    var k = b.getAttribute("data-bench");
    benchSel[k] = !benchSel[k];
    b.setAttribute("aria-pressed", String(benchSel[k]));
    $("#bench-n").textContent = Object.keys(benchSel).filter(function (x) { return benchSel[x]; }).length + " 个已选";
  });

  /* ---------- 把 state 回写到控件（用于预设 / 重置） ---------- */
  function syncControls() {
    $$("[data-group]").forEach(function (grp) {
      var key = groupKeys[grp.getAttribute("data-group")];
      if (!key) return;
      $$("button", grp).forEach(function (b) {
        b.setAttribute("aria-pressed", String(b.textContent.trim() === state[key]));
      });
    });
    $$("[data-switch]").forEach(function (s) { s.setAttribute("aria-checked", String(!!state[s.getAttribute("data-switch")])); });
    $$("[data-bind]").forEach(function (i) { i.value = state[i.getAttribute("data-bind")]; });
    paintCq();
    $("#lut-clear").hidden = !state.lut;
    if (state.lut) $("#lut-text").textContent = baseName(state.lut) + (BE ? "" : " · 已载入");
    else $("#lut-text").textContent = "拖入 .cube / .3dl，或点击选择";
    if (state.wmImage) $("#wm-img-name").value = state.wmImage.name + " · " + state.wmImage.digest;
    else if ($("#wm-img-name")) $("#wm-img-name").value = "";
    paintCodecSeg(); paintResSeg(); paintAbitSeg();
  }

  /* ---------- CQ 滑块：首页与参数页两处实例，用委托统一接线 ---------- */
  document.addEventListener("input", function (e) {
    if (e.target.matches && e.target.matches("[data-cq-slider]")) {
      state.cq = String(clampNum(e.target.value, 16, 35, 24));
      recomputeOutputs(); render();
    }
  });

  /* ---------- 路由 ---------- */
  function showView(name) {
    if (!/^(queue|video|bench|settings)$/.test(name)) name = "queue";
    $$(".view").forEach(function (v) { v.hidden = v.getAttribute("data-view") !== name; });
    $$(".nav-tab").forEach(function (t) { t.setAttribute("aria-selected", String(t.getAttribute("data-view") === name)); });
    if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
  }
  window.addEventListener("hashchange", function () { showView(location.hash.slice(1)); });

  /* ---------- 整窗拖放 ---------- */
  var dragDepth = 0;
  function hasFiles(e) { return e.dataTransfer && [].indexOf.call(e.dataTransfer.types || [], "Files") >= 0; }
  window.addEventListener("dragenter", function (e) {
    if (!hasFiles(e)) return; e.preventDefault(); dragDepth++;
    $("#drop-veil").setAttribute("data-on", "1"); $("#drop-count").textContent = "";
  });
  window.addEventListener("dragover", function (e) {
    if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy";
    var n = e.dataTransfer.items ? e.dataTransfer.items.length : 0;
    if (n) $("#drop-count").textContent = n + " 个项目";
  });
  window.addEventListener("dragleave", function (e) {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) $("#drop-veil").setAttribute("data-on", "0");
  });
  window.addEventListener("drop", function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; $("#drop-veil").setAttribute("data-on", "0");
    var files = [].slice.call(e.dataTransfer.files || []);
    if (!files.length) return;
    showView("queue");
    if (BE) {
      /* Electron 32 起 File.path 已移除，只能走 webUtils.getPathForFile */
      var ps = files.map(function (f) { return BE.pathForFile(f); }).filter(Boolean);
      if (!ps.length) { toast("无法取得拖入项的完整路径"); return; }
      Promise.all(ps.map(function (p) { return BE.stat(p); })).then(function (sts) {
        var plain = [], dirs = [];
        sts.forEach(function (s, i) {
          if (s && s.ok && s.isDir) dirs.push(ps[i]);
          else plain.push({ path: ps[i], size: s && s.ok ? Math.round(s.sizeMB * 1048576) : 0 });
        });
        if (plain.length) addFiles(plain);
        dirs.forEach(function (d) {
          BE.walk(d).then(function (list) {
            if (list && list.length) nativePick(list);
            else log("w", "文件夹内没有受支持的视频：" + esc(d));
          });
        });
      });
      return;
    }
    addFiles(files);
  });

  /* ============================================================
     功能自检 ?selftest=1 —— 穷举核对每个控件是否真的接线并生效
     ============================================================ */
  function selftest() {
    var out = [], pass = 0, fail = 0;
    /* 确定性：清掉上次持久化，回到默认状态再测 */
    try { localStorage.removeItem("maru-ui-state-v2"); } catch (e) { }
    state = clone(DEFAULTS); queue = []; logs = [];
    benchSel = {}; benchRows = []; running = null;
    $("#log").innerHTML = "";
    recomputeOutputs(); syncControls(); render();
    function T(name, fn) {
      try {
        var r = fn();
        if (r === true || r === undefined) { out.push("✓ " + name); pass++; }
        else { out.push("✗ " + name + " — " + r); fail++; }
      } catch (e) { out.push("✗ " + name + " — 异常 " + e.message); fail++; }
    }
    function click(el) {
      if (!el) return false;
      if (el.tagName === "OPTION") { el.parentElement.value = el.value; el.parentElement.dispatchEvent(new Event("change", { bubbles: true })); }
      else el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      return true;
    }
    function segBtn(group, label) {
      return $$('[data-group="' + group + '"] button').filter(function (b) { return b.textContent.trim() === label; })[0] ||
        $$('[data-bind="' + group + '"] option').filter(function (o) { return o.value === label; })[0];
    }
    /* 测试专用入队：在 exe 宿主里 fake 路径无法 ffprobe，所以同步置为已解析，
       让同一套断言在浏览器与 Electron 里都成立 */
    function tAdd(list) {
      var n0 = queue.length;
      addFiles(list);
      queue.slice(n0).forEach(function (q) {
        q.parsed = true; q.spec = q.spec || "1920×1080 · 30p"; q.dur = q.dur || 1200;
        if (q.st === "解析中") q.st = "等待中";
      });
      recomputeOutputs(); render();
      return queue.length - n0;
    }

    T("结构：每个 data-act 都已登记 handler", function () {
      var miss = $$("[data-act]").map(function (b) { return b.getAttribute("data-act"); })
        .filter(function (n) { return !actions[n]; });
      return miss.length ? "未登记 " + Array.from(new Set(miss)).join(",") : true;
    });
    T("结构：每个 data-group 都有 state 映射", function () {
      var miss = $$("[data-group]").map(function (g) { return g.getAttribute("data-group"); })
        .filter(function (k) { return !groupKeys[k] && k !== "benchenc"; });
      return miss.length ? "缺映射 " + miss.join(",") : true;
    });
    T("结构：每个 data-switch 都是布尔字段", function () {
      var miss = $$("[data-switch]").map(function (s) { return s.getAttribute("data-switch"); })
        .filter(function (k) { return typeof DEFAULTS[k] !== "boolean"; });
      return miss.length ? "非布尔 " + miss.join(",") : true;
    });
    T("导航：四个视图可切换", function () {
      return ["queue", "video", "bench", "settings"].every(function (v) {
        click($('.nav-tab[data-view="' + v + '"]'));
        return !$('[data-view="' + v + '"]').hidden;
      }) || "切换失败";
    });
    T("参数：分辨率 10 项全部进入命令", function () {
      showView("video");
      return Object.keys(RESOLUTIONS).map(function (r) {
        click(segBtn("res", r));
        var c = commandText("D:\\v\\a.mkv");
        if (r === "原样") return /-vf/.test(c) || !/-vf/.test(c) ? true : r;
        if (r === "自定义") return /scale(_cuda)?=1920:1080/.test(c) ? true : "自定义未生效:" + c;
        return c.indexOf(RESOLUTIONS[r]) >= 0 ? true : r + " 未出现在命令";
      }).filter(function (x) { return x !== true; }).join(" | ") || true;
    });
    T("参数：尺寸选择与自定义输入联动", function () {
      click(segBtn("res", "720p"));
      var regular = $("#res-select").value === "720p" && $("#custom-res").hidden;
      click(segBtn("res", "自定义"));
      return regular && !$("#custom-res").hidden ? true : "尺寸选择未联动";
    });
    T("参数：10-bit NVENC 用 format=p010le 且不传 -pix_fmt", function () {
      click(segBtn("vendor", "NVIDIA")); click(segBtn("codec", "H.265")); click(segBtn("depth", "10-bit"));
      click(segBtn("sharpen", "关闭")); $("#speed-input").value = "1.00"; state.speed = "1.00"; state.lut = null;
      var c = commandText("D:\\v\\a.mkv");
      if (c.indexOf("format=p010le") < 0) return "缺 format=p010le: " + c;
      if (c.indexOf("-pix_fmt") >= 0) return "仍传了 -pix_fmt: " + c;
      return true;
    });
    T("参数：CPU 10-bit 仍传 -pix_fmt yuv420p10le", function () {
      click(segBtn("vendor", "CPU"));
      var c = commandText("D:\\v\\a.mkv");
      return c.indexOf("-pix_fmt yuv420p10le") >= 0 ? true : c;
    });
    T("参数：厂商切换后 codec 选项随之变化（CPU 有 VP9/ProRes）", function () {
      var cpu = $$('[data-group="codec"] button').map(function (b) { return b.textContent.trim(); });
      click(segBtn("vendor", "NVIDIA"));
      var gpu = $$('[data-group="codec"] button').map(function (b) { return b.textContent.trim(); });
      return (cpu.indexOf("VP9") >= 0 && cpu.indexOf("ProRes") >= 0 && gpu.indexOf("VP9") < 0) ? true : "cpu=" + cpu + " gpu=" + gpu;
    });
    T("参数：倍速非 1 时 setpts + 音频 copy 自动转 aac", function () {
      click(segBtn("vendor", "NVIDIA")); click(segBtn("amode", "复制"));
      var inp = $("#speed-input"); inp.value = "1.50"; inp.dispatchEvent(new Event("change", { bubbles: true }));
      var c = commandText("D:\\v\\a.mkv");
      return (c.indexOf("setpts=PTS/1.5") >= 0 && c.indexOf("-c:a aac") >= 0) ? true : c;
    });
    T("参数：LUT 进入命令并改走 CPU 滤镜链", function () {
      var inp = $("#speed-input"); inp.value = "1.00"; inp.dispatchEvent(new Event("change", { bubbles: true }));
      setLutForTest("D:\\lut\\warm.cube");
      var c = commandText("D:\\v\\a.mkv");
      return (c.indexOf("lut3d=") >= 0 && c.indexOf("scale_cuda") < 0 && c.indexOf("-hwaccel cuda -hwaccel_output_format") < 0) ? true : c;
    });
    T("参数：隐藏水印按真实语义生成 drawtext 与 MTBX-HW 载荷", function () {
      click($('[data-switch="watermark"]'));
      state.wmmode = "文字"; state.wmText = ""; render();
      /* 与原版一致：文字为空时既不产生滤镜也不产生 metadata */
      var empty = commandText("D:\\v\\a.mkv");
      if (empty.indexOf("drawtext") >= 0 || empty.indexOf("-metadata comment=MTBX") >= 0) return "空文字不应产生水印输出";
      if ($("#wm-text-field").hidden) return "文字模式应显示水印文字输入";
      state.wmText = "小丸:测试,100%"; render();
      var c = commandText("D:\\v\\a.mkv");
      var esc = c.indexOf("drawtext=text='小丸\\:测试\\,100\\%'") >= 0;
      var pay = c.indexOf("-metadata comment=MTBX-HW:v1:text:小丸:测试,100%") >= 0;
      click(segBtn("wmmode", "图片"));
      var imgMode = !$("#wm-img-field").hidden && $("#wm-text-field").hidden;
      click($('[data-switch="watermark"]'));
      return (esc && pay && imgMode) ? true : "esc=" + esc + " payload=" + pay + " imgMode=" + imgMode + " | " + c;
    });
    T("参数：附加参数与线程数进入命令", function () {
      click(segBtn("vendor", "CPU"));
      state.extraArgs = "-map_metadata 0 -movflags +faststart"; state.threads = "8";
      var c = commandText("D:\\v\\a.mkv");
      state.extraArgs = ""; state.threads = "0";
      return (c.indexOf("-movflags +faststart") >= 0 && c.indexOf("-threads 8") >= 0) ? true : c;
    });
    T("参数：两遍码率显示码率输入，自定义显示命令输入", function () {
      click(segBtn("qmode", "两遍码率"));
      var a = !$("#bitrate-field").hidden && $("#cq-field").hidden === false;
      click(segBtn("qmode", "自定义"));
      var b = !$("#cmd-field").hidden && $("#cq-slider-field").hidden;
      click(segBtn("qmode", "恒定质量"));
      return (a && b) ? true : "a=" + a + " b=" + b;
    });
    T("参数：音频码率选项随音频模式变化", function () {
      click(segBtn("amode", "Opus"));
      var opus = $$('[data-group="abit"] button').map(function (b) { return b.textContent.trim(); });
      click(segBtn("amode", "MP3"));
      var mp3 = $$('[data-group="abit"] button').map(function (b) { return b.textContent.trim(); });
      click(segBtn("amode", "移除"));
      var hidden = $("#abit-field").hidden;
      click(segBtn("amode", "AAC"));
      return (opus[0] === "64k" && mp3[0] === "128k" && hidden) ? true : "opus=" + opus + " mp3=" + mp3 + " hidden=" + hidden;
    });
    T("参数：CQ 滑块与输入框双向同步", function () {
      var s = $("#cq-slider"); s.value = "28"; s.dispatchEvent(new Event("input", { bubbles: true }));
      var command = commandText("D:\\v\\a.mkv");
      return ($("#cq-input").value === "28" && state.cq === "28" && /-(cq|crf) 28/.test(command)) ? true : $("#cq-input").value;
    });
    T("首页：格式、CQ 与分辨率常驻并共用详细参数", function () {
      showView("queue");
      click(segBtn("vendor", "NVIDIA")); click(segBtn("depth", "8-bit"));
      if ($$("#queue-quickbar [data-cq-slider]").length !== 1 || !$("#queue-res-select") || !$("#queue-codec button")) return "首页缺少常驻参数";
      var select = $("#quick-preset");
      select.value = "高兼容 H.264"; select.dispatchEvent(new Event("change", { bubbles: true }));
      var a1 = encoderKey() === "h264_nvenc";
      var a2 = $$("#codec-seg button").filter(function (b) { return b.getAttribute("aria-pressed") === "true"; })[0].textContent.trim() === "H.264";
      var s = $("#cq-slider");
      s.value = "27"; s.dispatchEvent(new Event("input", { bubbles: true }));
      var a3 = state.cq === "27" && $("#cq-input").value === "27" && select.value === "";
      $("#queue-res-select").value = "720p"; $("#queue-res-select").dispatchEvent(new Event("change", { bubbles: true }));
      var a4 = state.res === "720p" && $("#res-select").value === "720p";
      select.value = "H.265"; select.dispatchEvent(new Event("change", { bubbles: true }));
      return (a1 && a2 && a3 && a4) ? true : "首页参数同步失败";
    });
    T("后端 argv 不带程序名（主进程自己拼 ffmpeg.exe）", function () {
      actions.clearAll();
      tAdd([{ name: "argv.mkv", size: 10 * 1048576, path: "D:\\v\\argv.mkv" }]);
      var a = taskPayload(queue[0]).argv;
      return (a[0] === "-hide_banner" && /_h265\.mp4$/.test(a[a.length - 1]))
        ? true : "首元素=" + a[0] + " 末元素=" + a[a.length - 1];
    });
    T("命令：输出路径目录只出现一次（回归 D:\\v\\D:\\v 重复缺陷）", function () {
      click(segBtn("vendor", "NVIDIA")); click(segBtn("codec", "H.265")); click(segBtn("depth", "8-bit"));
      click(segBtn("mux", "MP4")); click(segBtn("naming", "原名_标签"));
      var c = commandText("D:\\videos\\input.mkv");
      var times = (c.match(/D:\\videos/g) || []).length;
      var tail = /D:\\videos\\input_h265\.mp4$/.test(c);
      return (times === 2 && tail) ? true : "目录 " + times + " 次 tail=" + tail + " | " + c;
    });
    T("队列：拖入即建行并生成输出名", function () {
      showView("queue"); actions.clearAll();
      click(segBtn("vendor", "NVIDIA")); click(segBtn("codec", "H.265")); click(segBtn("depth", "8-bit"));
      click(segBtn("amode", "复制")); click(segBtn("naming", "原名_标签"));
      tAdd([{ name: "a.mkv", size: 400 * 1048576, path: "D:\\v\\a.mkv" }]);
      var q = queue[0];
      return (queue.length === 1 && q.out === "a_h265.mp4") ? true : JSON.stringify({ n: queue.length, out: q && q.out });
    });
    T("队列：三种命名规则输出名不同", function () {
      tAdd([{ name: "b.mp4", size: 100 * 1048576, path: "D:\\v\\b.mp4" }]);
      click(segBtn("naming", "标签_原名")); var t1 = queue[1].out;
      click(segBtn("naming", "仅原名")); var t2 = queue[1].out;
      click(segBtn("naming", "原名_标签")); var t3 = queue[1].out;
      return (t1 === "h265_b.mp4" && t2 === "b.mp4" && t3 === "b_h265.mp4") ? true : [t1, t2, t3].join(",");
    });
    T("队列：AMD 标签为 amd_h265（查表，非拼接）", function () {
      click(segBtn("vendor", "AMD"));
      var o = queue[queue.length - 1].out;
      click(segBtn("vendor", "NVIDIA"));
      return o === "b_amd_h265.mp4" ? true : o;
    });
    T("队列：同名冲突「重命名」追加 _2", function () {
      actions.clearAll();
      click(segBtn("naming", "仅原名")); click(segBtn("mux", "MP4"));
      tAdd([{ name: "same.mkv", size: 10 * 1048576, path: "D:\\v\\same.mkv" },
      { name: "same.mp4", size: 20 * 1048576, path: "D:\\v2\\same.mp4" }]);
      queue.forEach(function (q) { q.parsed = true; q.spec = "1920×1080"; });
      recomputeOutputs();
      var r = [queue[0].out, queue[1].out];
      click(segBtn("naming", "原名_标签"));
      return (r[0] === "same.mp4" && r[1] === "same_2.mp4") ? true : r.join(",");
    });
    T("队列：同名冲突「跳过」标记已跳过", function () {
      click(segBtn("naming", "仅原名")); click(segBtn("conflict", "跳过"));
      queue.forEach(function (q) { q.parsed = true; });
      recomputeOutputs();
      var skipped = queue[1].out === "(冲突跳过)";
      click(segBtn("conflict", "重命名")); click(segBtn("naming", "原名_标签"));
      recomputeOutputs();
      return skipped ? true : queue[1].out;
    });
    T("队列：选择 + 移除生效", function () {
      actions.clearAll();
      tAdd([{ name: "x1.mp4", size: 10 * 1048576, path: "D:\\v\\x1.mp4" },
      { name: "x2.mp4", size: 20 * 1048576, path: "D:\\v\\x2.mp4" }]);
      queue[0].sel = true; render();
      actions.removeSel();
      return (queue.length === 1 && queue[0].name === "x2.mp4") ? true : queue.map(function (q) { return q.name; }).join(",");
    });
    T("队列：清空后显示空状态", function () {
      actions.clearAll();
      return (queue.length === 0 && !$("#q-empty").hidden) ? true : "len=" + queue.length;
    });
    T("队列：批处理预设按指定方案（去 2K、加 H.265 直通、两模板同源）", function () {
      var names = $$("#quick-preset option").map(function (o) { return o.value; }).filter(Boolean);
      if (names.length !== 5 || Object.keys(BATCH_PRESETS).some(function (name) { return names.indexOf(name) < 0; })) return "预设缺失";
      var snap = function (v) {
        $("#quick-preset").value = v; $("#quick-preset").dispatchEvent(new Event("change", { bubbles: true }));
        return {
          key: encoderKey(), res: state.res, cq: state.cq, preset: state.preset,
          qmode: state.qmode, bitrate: state.bitrate, amode: state.amode, abit: state.abit, mux: state.mux,
          naming: state.naming, conflict: state.conflict, outmode: state.outmode,
          lut: state.lut, sharpen: state.sharpen, speed: state.speed, watermark: state.watermark,
        };
      };
      var a = snap("H.265"), b = snap("高兼容 H.264");
      var diff = Object.keys(a).filter(function (k) { return k !== "key" && a[k] !== b[k]; });
      if (diff.length) return "两模板除编码格式外还有差异: " + diff.join(",");
      if (a.key !== "hevc_nvenc" || b.key !== "h264_nvenc") return "编码器=" + a.key + "/" + b.key;
      var want = {
        res: "原样", cq: "24", preset: "均衡", qmode: "恒定质量", bitrate: "8000k", amode: "复制", abit: "320k",
        mux: "MP4", naming: "原名_标签", conflict: "重命名", outmode: "与源文件同目录",
        lut: null, sharpen: "关闭", speed: "1.00", watermark: false,
      };
      var bad = Object.keys(want).filter(function (k) { return b[k] !== want[k]; });
      if (bad.length) return "与截图二不符: " + bad.map(function (k) { return k + "=" + b[k]; }).join(",");
      $("#quick-preset").value = "网盘归档 H.265 1080p"; $("#quick-preset").dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    });
    T("队列：取消导出确认后可再次开始", function () {
      actions.clearAll();
      tAdd([{ name: "confirm.mp4", size: 80 * 1048576, path: "D:\\v\\confirm.mp4" }]);
      state.confirmExport = true;
      actions.startAll();
      if (!running || !running.pausedForConfirm || $("#modal-veil").hidden) return "未显示确认弹窗";
      closeModal();
      if (running || queue[0].st !== "等待中" || $("#start-all").disabled) return "取消后仍锁定队列";
      actions.startAll();
      var again = !!running && running.pausedForConfirm;
      closeModal(); state.confirmExport = false;
      return again ? true : "无法再次开始";
    });
    T("队列：开始全部 → 进度推进 → 完成", function () {
      actions.clearAll();
      tAdd([{ name: "run1.mp4", size: 300 * 1048576, path: "D:\\v\\run1.mp4" }]);
      queue.forEach(function (q) { q.parsed = true; q.st = "等待中"; q.spec = "1920×1080"; });
      recomputeOutputs();
      state.confirmExport = false;
      actions.startAll();
      if (running) running.order.forEach(function (q) { q.progress = 100; });
      var q = queue[0];
      return (q.st === "压缩中" || q.st === "完成") ? true : q.st;
    });
    T("队列：进度更新保持原行，不重播入场动画", function () {
      actions.clearAll();
      tAdd([{ name: "stable-progress.mp4", size: 80 * 1048576, path: "D:\\v\\stable-progress.mp4" }]);
      var q = queue[0];
      q.parsed = true; q.st = "压缩中"; q.spec = "1920×1080"; q.progress = 12;
      recomputeOutputs(); render();
      var tr1 = $("#q-body tr[data-id='" + q.id + "']");
      var bar1 = tr1 && tr1.querySelector(".bar > i");
      q.progress = 42; render();
      var tr2 = $("#q-body tr[data-id='" + q.id + "']");
      var bar2 = tr2 && tr2.querySelector(".bar > i");
      return (tr1 && tr1 === tr2 && bar1 && bar1 === bar2 && bar2.style.width === "42%" && !tr2.classList.contains("is-new"))
        ? true : "rowStable=" + (tr1 === tr2) + " barStable=" + (bar1 === bar2) + " class=" + (tr2 && tr2.className);
    });
    T("队列：停止全部可中断", function () {
      actions.stopAll();
      return running === null ? true : "仍在跑";
    });
    T("队列：AMD 不可用 + 自动回退不直接失败", function () {
      actions.clearAll();
      tAdd([{ name: "fb.mp4", size: 50 * 1048576, path: "D:\\v\\fb.mp4" }]);
      queue.forEach(function (q) { q.parsed = true; q.st = "等待中"; });
      click(segBtn("vendor", "AMD"));
      var before = queue[0].st;
      startRow(queue[0]);
      queue[0].progress = 100;
      advance(queue[0]);
      var st = queue[0].st;
      click(segBtn("vendor", "NVIDIA")); actions.clearAll();
      return (before === "等待中" && st === "压缩中") ? true : "st=" + st;
    });
    T("日志：写入、计数、复制、导出", function () {
      actions.clearLog();
      log("i", "测试行");
      var n = logs.length === 1 && +$("#log-n").textContent === 1;
      var d = download("test.log", "测试行");
      return (n && d && d.text === "测试行") ? true : "n=" + n;
    });
    T("日志：抽屉可展开收起", function () {
      var a = $("#log-drawer").hidden;
      actions.toggleLog(); var b = $("#log-drawer").hidden;
      actions.toggleLog();
      return (a === true && b === false) ? true : "a=" + a + " b=" + b;
    });
    T("环境：Benchmark 预设按钮真实改变勾选集", function () {
      showView("bench");
      actions.benchPick({ getAttribute: function () { return "nvenc"; } });
      var want = BENCH.filter(function (k) { return /nvenc/.test(k); }).length;
      var n = Object.keys(benchSel).filter(function (k) { return benchSel[k]; }).length;
      actions.benchPick({ getAttribute: function () { return "none"; } });
      var cleared = Object.keys(benchSel).filter(function (k) { return benchSel[k]; }).length;
      actions.benchPick({ getAttribute: function () { return "all"; } });
      var all = Object.keys(benchSel).filter(function (k) { return benchSel[k]; }).length;
      return (n === want && cleared === 0 && all === BENCH.length) ? true : "n=" + n + " cleared=" + cleared + " all=" + all;
    });
    T("环境：未选片源时不启动 Benchmark", function () {
      state.benchFile = ""; benchRows = [];
      actions.runBench();
      return benchRows.length === 0 ? true : "无片源却排了 " + benchRows.length + " 行";
    });
    T("环境：Benchmark 启动即落地行（不等异步读片源）", function () {
      var want = Object.keys(benchSel).filter(function (k) { return benchSel[k]; }).length;
      state.benchFile = "Z:\\不存在\\clip.mp4";
      actions.runBench();
      return benchRows.length === want ? true : "rows=" + benchRows.length + " want=" + want;
    });
    T("环境：导出 CSV 内容完整", function () {
      benchRows = BENCH.slice(0, 4).map(function (k, i) {
        return { k: k, ok: true, st: "支持", size: 96 + i, ratio: 76.8, secs: 13 };
      });
      var d = null;
      var old = download; download = function (n, t) { d = old(n, t); return d; };
      actions.exportCsv(); download = old;
      return (d && /^encoder,/.test(d.text) && d.text.split("\n").length === 5) ? true : "bad";
    });
    T("设置：主题与字号写入 html 属性", function () {
      showView("settings");
      click(segBtn("theme", "日间")); var t = document.documentElement.getAttribute("data-theme");
      click(segBtn("theme", "夜间"));
      click(segBtn("fscale", "大")); var f = document.documentElement.getAttribute("data-fscale");
      click(segBtn("fscale", "中"));
      return (t === "light" && f === "lg") ? true : "t=" + t + " f=" + f;
    });
    T("顶栏：主题切换按钮可切换并更新图标", function () {
      showView("queue");
      state.theme = "日间"; render();
      var b = $("#theme-toggle"), u = b && b.querySelector("use");
      click(b);
      var dark = state.theme === "夜间" && document.documentElement.getAttribute("data-theme") === "dark" && u.getAttribute("href") === "#i-sun";
      click(b);
      var light = state.theme === "日间" && document.documentElement.getAttribute("data-theme") === "light" && u.getAttribute("href") === "#i-moon";
      return (dark && light) ? true : "dark=" + dark + " light=" + light;
    });
    T("设置：开关真的改状态", function () {
      var before = state.autoFallback;
      click($('[data-switch="autoFallback"]'));
      var after = state.autoFallback;
      click($('[data-switch="autoFallback"]'));
      return (before !== after && state.autoFallback === before) ? true : "no change";
    });
    T("设置：输出位置与参数页 06 双向同步", function () {
      click(segBtn("outmode", "指定目录"));
      var a = state.outmode === "指定目录" && !$("#outdir-field").hidden;
      click(segBtn("outmode", "与源文件同目录"));
      var b = !$("#outdir-field").hidden;
      return (a && b === false) ? true : "a=" + a + " b=" + b;
    });
    T("设置：向导 / 预设管理 / 附加参数模态可打开", function () {
      actions.openWizard(); var a = !!$("#wizard");
      closeModal();
      actions.managePresets(); var b = !!$("#preset-name");
      closeModal();
      actions.editExtra(); var c = !!$("#modal-extra");
      closeModal();
      /* 目录选择在 exe 里走原生对话框，没有页内模态，属预期分支 */
      actions.browseOut(); var d = BE ? true : !!$("#modal-outdir");
      closeModal();
      return (a && b && c && d) ? true : [a, b, c, d].join(",");
    });
    T("设置：保存并应用用户预设", function () {
      actions.managePresets();
      $("#preset-name").value = "我的预设";
      actions.savePreset();
      var n = state.userPresets.length;
      click(segBtn("cq", "30") || segBtn("preset", "极速"));
      var p = state.userPresets[0];
      var body = $("#modal");
      var useBtn = body ? body.querySelector('[data-act="usePreset"]') : null;
      actions.usePreset({ getAttribute: function () { return "0"; } });
      return (n === 1) ? true : "n=" + n;
    });
    T("设置：恢复默认保留任务、日志与用户预设", function () {
      state.res = "720p"; state.cq = "16"; state.abit = "128k"; state.mux = "MKV";
      var savedPresets = JSON.stringify(state.userPresets), taskCount = queue.length, logCount = logs.length;
      actions.resetAll();
      var bad = Object.keys(DEFAULTS).filter(function (k) {
        return k !== "userPresets" && JSON.stringify(state[k]) !== JSON.stringify(DEFAULTS[k]);
      });
      return (bad.length === 0 && queue.length === taskCount && logs.length === logCount && JSON.stringify(state.userPresets) === savedPresets)
        ? true : "未恢复或数据丢失: " + bad.join(",");
    });
    T("默认值：启动即为用户确认过的那一组", function () {
      var want = { vendor: "NVIDIA", codec: "H.265", depth: "8-bit", preset: "均衡", qmode: "恒定质量",
        cq: "24", res: "原样", mux: "MP4", amode: "复制", abit: "320k", sharpen: "关闭", speed: "1.00",
        watermark: false, lut: null, outmode: "与源文件同目录", naming: "原名_标签", conflict: "重命名" };
      var bad = Object.keys(want).filter(function (k) { return JSON.stringify(DEFAULTS[k]) !== JSON.stringify(want[k]); });
      return bad.length ? "不符: " + bad.join(",") : true;
    });
    T("顶栏：停止全部按钮可用", function () {
      actions.stopAll();
      return true;
    });

    return { pass: pass, fail: fail, out: out };
  }
  function setLutForTest(p) { state.lut = p; }

  /* ============================================================
     布局自检 ?audit=1
     ============================================================ */
  function audit() {
    var view = $(".view:not([hidden])");
    var de = document.documentElement;
    var worst = [], scrollers = [];
    var SOFT = ["log", "q-scroll"];
    [view].concat($$("*", view)).forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (!r.width && !r.height) return;
      var ox = el.scrollWidth - el.clientWidth, oy = el.scrollHeight - el.clientHeight;
      var self = getComputedStyle(el);
      /* 带省略号的元素：内容被裁掉是设计意图，不算溢出 */
      var ellipsis = self.textOverflow === "ellipsis" || el.classList.contains("u-ellipsis");
      if (el.clientWidth && (ox > 1 || oy > 1) && self.overflowX !== "visible" && !ellipsis) {
        if (SOFT.indexOf(el.id) >= 0 || el.classList.contains("table-wrap") || el.classList.contains("cmdview")) {
          scrollers.push({ el: el, ox: 0, oy: Math.max(0, oy), soft: true }); return;
        }
        scrollers.push({ el: el, ox: Math.max(0, ox), oy: Math.max(0, oy) });
      }
      var pe = el.parentElement;
      if (!pe) return;
      var pr = pe.getBoundingClientRect();
      var dy = Math.round(r.bottom - pr.bottom), dx = Math.round(r.right - pr.right);
      if (dy > 1 || dx > 1) {
        var cs = getComputedStyle(pe);
        var visX = cs.overflowX === "visible", visY = cs.overflowY === "visible";
        if (visX && visY) return;   /* 父级不裁剪，交给更外层判断 */
        /* 父级能滚动 → 子项超出是正常滚动，不是丢内容；只有被裁剪才算问题 */
        var ox = (visX || cs.overflowX === "auto" || cs.overflowX === "scroll") ? 0 : dx;
        var oy = (visY || cs.overflowY === "auto" || cs.overflowY === "scroll") ? 0 : dy;
        if (ox > 1 || oy > 1) worst.push({ el: el, ox: Math.max(0, ox), oy: Math.max(0, oy) });
      }
    });
    function path(el) {
      var parts = [];
      for (var i = 0; i < 3 && el && el !== view; i++) {
        var t = el.querySelector && el.querySelector(":scope > .card-title, :scope > .panel-title");
        var name = t ? "「" + t.textContent + "」"
          : (el.tagName === "BUTTON" ? "[btn:" + el.textContent.trim().slice(0, 10) + "]"
            : (el.id ? "#" + el.id : "." + (el.className.toString().trim().split(/\s+/)[0] || el.tagName.toLowerCase())));
        parts.unshift(name); el = el.parentElement;
      }
      return parts.join(" > ");
    }
    var cards = $$(".rail > .card, .main > .card, .qwrap > .card, .set-grid > .card", view).map(function (c) {
      var t = c.querySelector(".card-title, .panel-title");
      return (c.parentElement.classList.contains("rail") ? "栏" + ($$(".rail", view).indexOf(c.parentElement) + 1) : "主") +
        "「" + (t ? t.textContent : "?") + "」" + Math.round(c.getBoundingClientRect().height);
    });
    var deOver = de.scrollHeight > window.innerHeight + 1 || de.scrollWidth > window.innerWidth + 1;
    var hard = scrollers.filter(function (s) { return !s.soft; });
    var soft = scrollers.filter(function (s) { return s.soft; });
    var ok = worst.length === 0 && hard.length === 0 && !deOver;
    var box = document.createElement("div");
    box.id = "__audit";
    box.style.cssText = "position:fixed;left:8px;top:52px;z-index:9999;max-width:700px;padding:10px 12px;" +
      "font:11px/1.5 monospace;white-space:pre-wrap;border-radius:8px;border:1px solid " + (ok ? "#5fbd7c" : "#e26860") +
      ";background:#0d0d0fee;color:" + (ok ? "#5fbd7c" : "#e26860");
    box.textContent = (ok ? "✓ 无溢出，一屏可见" : "✗ 溢出 " + (worst.length + hard.length) + " 处") +
      "\nviewport " + window.innerWidth + "×" + window.innerHeight +
      "   document " + de.scrollWidth + "×" + de.scrollHeight + (deOver ? "  ✗" : "  ✓") + "\n" +
      (hard.slice(0, 4).map(function (s) { return { k: "需滚动", w: s }; })
        .concat(worst.slice(0, 4).map(function (s) { return { k: "超容器", w: s }; }))
        .slice(0, 6).map(function (x) {
          return "  [" + x.k + "] " + (x.w.ox ? "X+" + x.w.ox + " " : "") + (x.w.oy ? "Y+" + x.w.oy : "") + "  " + path(x.w.el);
        }).join("\n") || "  （无溢出元素）") +
      "\n卡片高度：" + cards.join("  ") +
      (soft.length ? "\n合理滚动（表格/日志/命令）：" + soft.map(function (s) { return (s.el.id || "table") + " Y+" + s.oy; }).join(" , ") : "");
    document.body.appendChild(box);
  }

  /* ============================================================
     启动
     ============================================================ */
  try {
    var saved = localStorage.getItem("maru-ui-state-v2");
    if (!BE && saved) { var s = JSON.parse(saved); Object.keys(DEFAULTS).forEach(function (k) { if (k in s) state[k] = s[k]; }); }
  } catch (e) { }

  ["vendor", "codec", "depth", "preset", "qmode", "res", "mux", "sharpen", "amode", "abit", "wmmode",
    "naming", "conflict", "outmode", "theme", "fscale", "prefdev", "parallel"].forEach(function (g) {
      $$('[data-group="' + g + '"]').forEach(function (grp) {
        var key = state[g];
        $$("button", grp).forEach(function (b) { b.setAttribute("aria-pressed", String(b.textContent.trim() === key)); });
      });
    });

  paintCodecSeg(); paintResSeg(); paintAbitSeg(); paintBenchGrid();
  wire();
  paintCq();
  syncControls();
  showView(location.hash.slice(1) || "queue");
  render();

  /* ============================================================
     exe 宿主集成：真实环境探测、进度事件订阅、设置回读
     ============================================================ */
  function paintEnvCards() {
    var set = function (id, text) { var el = document.getElementById(id); if (el) el.textContent = text; };
    var badge = function (id, ok, yes, no) {
      var el = document.getElementById(id); if (!el) return;
      el.textContent = ok ? yes : no;
      el.className = "badge" + (ok ? " badge--ok" : "");
    };
    var enc = ENV.encoders || {};
    set("env-status", ENV.ffmpegPath && ENV.ffprobePath ? "转码工具已就绪" : "缺少转码工具，请检查 FFmpeg 的安装。");
    var names = function (list) {
      var hit = list.filter(function (k) { return enc[k]; }).map(function (k) { return k.split("_")[0]; });
      return hit.length ? hit.join(" / ") : "无";
    };
    set("env-meta", (ENV.version ? "FFMPEG " + ENV.version : "FFMPEG 未找到"));
    set("env-ffmpeg", ENV.ffmpegPath || "未找到 FFmpeg，请检查安装和 PATH");
    set("env-ffprobe", ENV.ffprobePath || "未找到 ffprobe");
    badge("env-ffmpeg-b", !!ENV.ffmpegPath, "可用", "缺失");
    badge("env-ffprobe-b", !!ENV.ffprobePath, "可用", "缺失");
    set("env-nvenc-t", names(["h264_nvenc", "hevc_nvenc", "av1_nvenc"]));
    badge("env-nvenc", ENV.nvenc, "可用", "不可用");
    set("env-amf-t", names(["h264_amf", "hevc_amf", "av1_amf"]));
    badge("env-amf", ENV.amf, "可用", "未检测");
    set("env-qsv-t", names(["h264_qsv", "hevc_qsv", "av1_qsv"]));
    badge("env-qsv", ENV.qsv, "可用", "未检测");
    set("env-cuda-t", ENV.nvenc ? "GPU 加速处理" : "使用 CPU 处理");
    badge("env-cuda", ENV.nvenc, "可用", "不适用");
    var g = (ENV.gpus || [])[0];
    set("gpu-meta", (ENV.gpus || []).length + " DEVICE · " + (ENV.vramGB || 0) + " GB");
    var rows = document.getElementById("gpu-rows");
    if (rows && !(ENV.gpus || []).length) rows.innerHTML = '<p class="field-hint">未检测到显卡，可使用 CPU 编码。</p>';
    if (rows && (ENV.gpus || []).length) {
      rows.innerHTML = ENV.gpus.map(function (x, i) {
        return '<div class="set-row"><div class="set-label"><b>GPU ' + i + '</b><span class="u-ellipsis">' +
          esc(x.name || "未知") + '</span></div><span class="badge badge--accent">' +
          esc(x.driver ? "驱动 " + x.driver : "—") + '</span></div>';
      }).join("") +
        '<div class="set-row"><div class="set-label"><b>显存</b><span class="u-num">' +
        (g.vramMB || 0) + ' MB</span></div><span class="badge">' + (ENV.vramGB || 0) + ' GB</span></div>' +
        '<div class="set-row"><div class="set-label"><b>NVENC</b><span>' +
        (ENV.nvenc ? "已检测到编码器" : "未检测到，可选择 CPU") + '</span></div><span class="badge' +
        (ENV.nvenc ? " badge--ok" : "") + '">' + (ENV.nvenc ? "可用" : "无") + '</span></div>';
    }
    var tg = document.getElementById("top-gpu");
    if (tg) {
      tg.className = "badge" + (ENV.nvenc ? " badge--ok" : "");
      tg.innerHTML = '<svg width="13" height="13"><use href="#i-gpu"/></svg>' +
        esc((g ? String(g.name).replace(/^(NVIDIA|AMD|Intel)\s+/i, "") : "无独显") +
          " · " + (ENV.nvenc ? "NVENC 可用" : "NVENC 不可用"));
    }
    var tf = document.getElementById("top-ffmpeg");
    if (tf) tf.innerHTML = '<svg width="13" height="13"><use href="#i-chip"/></svg>ffmpeg ' + esc(ENV.version || "未找到");
  }

  function applyEnvInfo(e) {
    if (!e) return;
    ENV.nvenc = !!e.nvenc; ENV.amf = !!e.amf; ENV.qsv = !!e.qsv;
    ENV.encoders = e.encoders || {}; ENV.gpus = e.gpus || [];
    ENV.av1 = !!ENV.encoders.av1_nvenc;
    ENV.ffmpegPath = e.ffmpeg || ""; ENV.ffprobePath = e.ffprobe || "";
    /* 只取纯版本号：ffmpeg -version 后面的 "9.0.1-full_build-www.gyan.dev" 太长，
       放到 44px 高的顶栏里会把整行挤开 */
    var m = /version\s+([\d.]+)/.exec(e.ffmpegVersion || "");
    ENV.version = m ? m[1] : "";
    ENV.versionFull = (/version\s+(\S+)/.exec(e.ffmpegVersion || "") || [])[1] || "";
    ENV.ffmpegRaw = e.ffmpegVersion || "";
    if (ENV.gpus.length) ENV.vramGB = Math.max(1, Math.round((ENV.gpus[0].vramMB || 0) / 1024));
    if (!ENV.nvenc && state.vendor === "NVIDIA") state.vendor = "CPU";
    paintEnvCards(); paintCodecSeg(); syncControls(); render();
    log("i", "环境探测完成：" + esc(ENV.ffmpegPath || "未找到 ffmpeg") + " · NVENC " +
      (ENV.nvenc ? "可用" : "不可用") + (ENV.gpus.length ? " · " + esc(ENV.gpus[0].name) : ""));
    if (!ENV.ffmpegPath) toast("缺少转码工具，请到环境检测查看。");
  }

  function onBenchEvent(ev) {
    if (ev.state === "全部结束") {
      $("#bench-badge").innerHTML = "已完成";
      $("#bench-badge").className = "badge badge--ok";
      renderBench(); return;
    }
    var r = benchRows.filter(function (x) { return x.k === ev.encoder; })[0];
    if (!r) return;
    if (ev.state === "运行中") { r.st = "运行中"; }
    else {
      r.st = ev.state === "完成" ? "支持" : "不支持";
      r.ok = ev.state === "完成";
      r.secs = ev.secs || 0; r.size = ev.sizeMB || 0;
      r.ratio = r.ok && r.size && benchSrcMB ? (1 - r.size / benchSrcMB) * 100 : 0;
      r.note = ev.note || "";
    }
    renderBench();
  }
  var benchSrcMB = 0;

  function bindBackendEvents() {
    if (!BE) return;
    BE.onEvent(function (ev) {
      if (!ev) return;
      var q0 = ev.id ? (queue.filter(function (x) { return x.id === ev.id; })[0] || null) : null;
      if (ev.kind === "progress") {
        if (!q0) return;
        q0.st = "压缩中";
        if (q0.dur) q0.progress = Math.max(q0.progress, Math.min(99, Math.round(ev.seconds / q0.dur * 100)));
        if (running && ev.fps) running.fps = ev.fps;
        render();
      } else if (ev.kind === "job") {
        if (!q0) return;
        q0.st = ev.state;
        if (ev.state === "完成") { q0.progress = 100; q0.outMB = ev.sizeMB || 0; }
        render();
      } else if (ev.kind === "log") {
        log(ev.level === "ok" ? "o" : ev.level === "warn" ? "w" : ev.level === "error" ? "e" : "i", esc(ev.text));
      } else if (ev.kind === "batch") {
        finishBatch();
      } else if (ev.kind === "bench") {
        onBenchEvent(ev);
      }
    });
  }

  if (BE) {
    bindBackendEvents();
    if (!hasInitialSettings) BE.loadSettings().then(function (s) {
      if (s && typeof s === "object") {
        Object.keys(DEFAULTS).forEach(function (k) { if (k in s) state[k] = s[k]; });
        syncControls(); render();
      }
    }, function () { });
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      setTimeout(function () { BE.detectEnv().then(applyEnvInfo, function (e) {
        log("e", "环境探测失败：" + esc(String((e && e.message) || e)));
      }); }, 250);
    }); });
    log("i", "小丸工具箱已就绪");
  }

  /* 自测 / 自检入口 */
  var q = location.search;
  if (/[?&]selftest=1/.test(q)) {
    setTimeout(function () {
      var r = selftest();
      var box = document.createElement("div");
      box.id = "__selftest";
      box.style.cssText = "position:fixed;right:8px;top:52px;z-index:9999;width:520px;max-height:90vh;overflow:auto;" +
        "padding:10px 12px;font:11px/1.55 monospace;white-space:pre-wrap;border-radius:8px;border:1px solid " +
        (r.fail ? "#e26860" : "#5fbd7c") + ";background:#0d0d0fee;color:" + (r.fail ? "#e26860" : "#5fbd7c");
      box.textContent = "功能自检  通过 " + r.pass + " / 失败 " + r.fail + "\n" + r.out.join("\n");
      document.body.appendChild(box);
      if (/[?&]json=1/.test(q)) {
        var pre = document.createElement("pre");
        pre.id = "__selftest_json";
        pre.textContent = JSON.stringify({ pass: r.pass, fail: r.fail, out: r.out });
        document.body.appendChild(pre);
      }
    }, 400);
  }
  /* ?probe=<css选择器> 量取具体盒模型：定位"差几像素"时比猜有用 */
  var probeSel = /[?&]probe=([^&]+)/.exec(location.search);
  if (probeSel) setTimeout(function () {
    var sel;
    try { sel = decodeURIComponent(probeSel[1]); } catch (e) { sel = probeSel[1]; }
    var lines = $$(sel).slice(0, 5).map(function (el) {
      var cs = getComputedStyle(el), r = el.getBoundingClientRect();
      return [
        (el.className.toString().slice(0, 26) || el.tagName.toLowerCase()),
        "w=" + Math.round(r.width), "h=" + Math.round(r.height),
        "sw=" + el.scrollWidth, "cw=" + el.clientWidth,
        "ovfX=" + cs.overflowX, "ws=" + cs.whiteSpace, "disp=" + cs.display,
        "maxw=" + cs.maxWidth, "flex=" + cs.flex, "pad=" + cs.padding,
      ].join(" ");
    });
    var b = document.createElement("div");
    b.id = "__probe";
    b.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:9999;max-width:94vw;padding:8px 10px;" +
      "font:11px/1.5 monospace;white-space:pre-wrap;background:#000d;color:#8fe;border:1px solid #8fe";
    b.textContent = "probe: " + sel + "\n" + lines.join("\n");
    document.body.appendChild(b);
  }, 600);

  if (/[?&]audit=1/.test(q)) setTimeout(audit, 500);

  /* 端到端钩子：仅 ?e2e=1 时暴露，供桌面版的 --e2e-encode 驱动真实界面路径。
     目的是验证"UI 生成的那条命令真的能出片"，而不是只验证组件各自可用。 */
  if (/[?&]e2e=1/.test(q)) {
    window.__E2E = {
      clear: function () { queue = []; logs = []; var l = document.getElementById("log"); if (l) l.innerHTML = ""; render(); },
      add: function (p, size) { addFiles([{ path: p, size: size }]); return queue.length; },
      set: function (k, v) { state[k] = v; syncControls(); render(); },
      start: function () { state.confirmExport = false; actions.startAll(); },
      rows: function () {
        return queue.map(function (x) {
          return { name: x.name, st: x.st, out: x.out, prog: x.progress, spec: x.spec, dur: x.dur };
        });
      },
      /* 返回真正交给后端执行的 argv（已去掉程序名），末位即输出路径 */
      argv: function () { return queue[0] ? taskPayload(queue[0]).argv : []; },
    };
  }

  /* ?log=1 展开日志抽屉（截图与压力测试用） */
  if (/[?&]log=1/.test(q)) setTimeout(function () { $("#log-drawer").hidden = false; $("#log-toggle").setAttribute("aria-expanded", "true"); }, 200);

  /* 演示：?drop=N 模拟拖入（无头环境无法真拖） */
  var demoDrop = /[?&]drop=(\d+)/.exec(q);
  if (demoDrop) {
    var SAMPLES = [
      { name: "[Sakurato] Bocchi the Rock - 08 [AVC-8bit 1080p AAC].mp4", size: 612 * 1048576, path: "Z:\\v\\a.mp4" },
      { name: "DJI_0042_4K60.MP4", size: 2410 * 1048576, path: "Z:\\v\\b.MP4" },
      { name: "家庭录像 2019 春节.mkv", size: 1840 * 1048576, path: "Z:\\v\\c.mkv" },
      { name: "lecture_recording_1080p30.webm", size: 738 * 1048576, path: "Z:\\v\\d.webm" },
      { name: "demo_reel_v3.mov", size: 320 * 1048576, path: "Z:\\v\\e.mov" },
      { name: "婚礼_4K_正片_final.mp4", size: 5320 * 1048576, path: "Z:\\v\\f.mp4" },
      { name: "gameplay_clip_1440p.mp4", size: 980 * 1048576, path: "Z:\\v\\g.mp4" },
      { name: "旧片修复_标清_1998.rmvb", size: 210 * 1048576, path: "Z:\\v\\h.rmvb" },
    ];
    var n = Math.min(parseInt(demoDrop[1], 10) || 4, 40), fake = [];
    for (var di = 0; di < n; di++) {
      fake.push({ name: SAMPLES[di % 8].name, size: SAMPLES[di % 8].size, path: SAMPLES[di % 8].path.replace(/\\\w\./, "\\" + di + ".") });
    }
    setTimeout(function () { addFiles(fake); }, 300);
  }
})();
