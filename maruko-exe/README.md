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

Electron 桌面版及界面源码按仓库根目录的 MIT License 发布；上游 Python 版本的来源和独立许可见根目录 [CREDITS.md](../CREDITS.md)。
