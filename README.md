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

### macOS（Apple 芯片）

macOS 安装包必须在 macOS 上生成：electron-builder 不支持在 Windows 上打 mac 包，Apple 芯片还要求应用带代码签名。两种方式任选：

有 Mac 时，在本机打包：

```bash
cd maruko-exe
npm ci
npm run dist:mac
```

产物为 `maruko-exe/release-1.2.7-mac/小丸工具箱-1.2.7-arm64.dmg`，同时生成同版本 `.zip`。

没有 Mac 时，用 GitHub Actions 云端构建：把仓库推到 GitHub 后，在 Actions 里运行「构建 macOS（Apple 芯片）」（改动 `maruko-exe/` 并推送到 `main` 时也会自动运行），完成后在该次运行的 Artifacts 中下载 `maruko-macos-arm64`。

安装与首次启动：

1. 打开 dmg，把「小丸工具箱」拖进「应用程序」。
2. 首次启动若提示无法验证开发者：右键点应用选「打开」，或到「系统设置 → 隐私与安全性」点「仍要打开」；也可以在终端执行 `xattr -dr com.apple.quarantine /Applications/小丸工具箱.app`。
3. 应用本身不自带 FFmpeg，需要先安装：`brew install ffmpeg`。从访达启动时，应用会自动到 `/opt/homebrew/bin`、`/usr/local/bin` 查找 `ffmpeg` 和 `ffprobe`。

本项目没有 Apple 开发者证书，macOS 版使用 ad-hoc 签名、未做公证，因此首次启动会出现上述提示。

## Python 版本

`MarukoToolbox-Rewrite-main/` 保留了 [ArenasCats/MarukoToolbox-Rewrite](https://github.com/arenascats/MarukoToolbox-Rewrite) 的 Python 版本，包含更多独立媒体处理页面。该目录保留原项目 README 和 Apache License 2.0。请按该目录文档配置运行环境。

## 项目目录

- `ui-redesign/`：Electron 桌面版界面源码及可直接打开的静态界面预览。
- `maruko-exe/`：Electron 窗口、FFmpeg 集成，以及 Windows 便携版与 macOS Apple 芯片版构建配置。
- `.github/workflows/build-macos.yml`：在 GitHub 的 Apple 芯片 runner 上构建 macOS 安装包。
- `MarukoToolbox-Rewrite-main/`：致敬并保留许可的 Python 版本。
- `CREDITS.md`：项目来源与致谢。

## 致谢

感谢经典小丸工具箱的原作者与社区贡献者；特别感谢 [ArenasCats](https://github.com/arenascats) 开源 Python 重写项目及其后续贡献。完整来源和许可说明见 [CREDITS.md](CREDITS.md)。本项目为独立社区版本，并非原项目官方发布。

## 许可

本仓库 Electron 桌面版和界面源码采用 MIT License，见根目录 `LICENSE`。`MarukoToolbox-Rewrite-main/` 是单独保留的上游 Python 项目，继续适用其目录中的 Apache License 2.0 及原有版权声明。
