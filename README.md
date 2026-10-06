# 小丸工具箱

一个延续经典小丸工具箱思路的社区项目，提供紧凑的 Windows 视频压缩桌面界面。

## Electron 桌面版

当前桌面版提供视频任务队列、编码与画质设置、环境检测和软件设置。它使用本机 FFmpeg 执行转码；仓库不包含 FFmpeg。

需要 Node.js 与 npm。安装好 FFmpeg 并确保 `ffmpeg`、`ffprobe` 可从命令行访问后，在项目目录运行：

```powershell
cd maruko-exe
npm ci
npm start
```

构建 Windows 单文件便携版：

```powershell
npm run dist
```

生成的 EXE 位于 `maruko-exe/release-1.2.7/`。界面源码以 `ui-redesign/` 为准；打包前会同步到 Electron 宿主。

## Python 版本

`MarukoToolbox-Rewrite-main/` 保留了 [ArenasCats/MarukoToolbox-Rewrite](https://github.com/arenascats/MarukoToolbox-Rewrite) 的 Python 版本，包含更多独立媒体处理页面。该目录保留原项目 README 和 Apache License 2.0。请按该目录文档配置运行环境。

## 项目目录

- `ui-redesign/`：Electron 桌面版界面源码及可直接打开的静态界面预览。
- `maruko-exe/`：Electron 窗口、FFmpeg 集成和 Windows 便携版构建配置。
- `MarukoToolbox-Rewrite-main/`：致敬并保留许可的 Python 版本。
- `CREDITS.md`：项目来源与致谢。

## 致谢

感谢经典小丸工具箱的原作者与社区贡献者；特别感谢 [ArenasCats](https://github.com/arenascats) 开源 Python 重写项目及其后续贡献。完整来源和许可说明见 [CREDITS.md](CREDITS.md)。本项目为独立社区版本，并非原项目官方发布。

## 许可

本仓库 Electron 桌面版和界面源码采用 MIT License，见根目录 `LICENSE`。`MarukoToolbox-Rewrite-main/` 是单独保留的上游 Python 项目，继续适用其目录中的 Apache License 2.0 及原有版权声明。
