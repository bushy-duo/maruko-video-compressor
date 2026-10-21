# Electron 桌面版

这是小丸工具箱的 Electron 桌面实现。界面源码位于 `../ui-redesign/`，FFmpeg 桌面集成和便携版构建配置位于本目录。

## 运行

需要 Node.js、npm，以及可从命令行访问的 `ffmpeg` 和 `ffprobe`。在本目录执行：

```powershell
npm ci
npm start
```

## 构建 Windows 便携版

```powershell
npm run dist
```

生成的单文件 EXE 位于 `release-1.2.7/`。FFmpeg 不随本仓库提供。

## 构建 macOS（Apple 芯片）

macOS 包只能在 macOS 上构建（electron-builder 不允许跨平台打 mac 包，Apple 芯片还要求代码签名）。在 Apple 芯片 Mac 上执行：

```bash
npm ci
npm run dist:mac
```

产物位于 `release-1.2.7-mac/`：`小丸工具箱-1.2.7-arm64.dmg` 和同名 `.zip`。

没有 Mac 时，可用仓库根目录的 GitHub Actions 工作流 `build-macos.yml`，在 GitHub 的 Apple 芯片 runner 上构建并下载 Artifacts。

本项目没有 Apple 开发者证书：`package.json` 里 `mac.identity` 设为 `null`，由 `packaging/adhoc-sign.js` 在打包后做 ad-hoc 签名，保证应用能在 Apple 芯片上启动，但未公证，首次打开需要右键「打开」或在系统设置里允许。运行还需要自行安装 FFmpeg（`brew install ffmpeg`），应用会自动在 `/opt/homebrew/bin`、`/usr/local/bin` 中查找。

Electron 桌面版及界面源码按仓库根目录的 MIT License 发布；上游 Python 版本的来源和独立许可见根目录 [CREDITS.md](../CREDITS.md)。
