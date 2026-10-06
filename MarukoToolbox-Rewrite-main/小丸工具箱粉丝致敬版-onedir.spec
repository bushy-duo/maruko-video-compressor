# -*- mode: python ; coding: utf-8 -*-

import shutil
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules


project_dir = Path.cwd()


def required_tool(name):
    detected = shutil.which(name)
    fallback = Path(r"E:\Programe Files\FFmpeg\ffmpeg-9.0.1-full_build\bin") / f"{name}.exe"
    candidate = Path(detected) if detected else fallback
    if not candidate.exists():
        raise FileNotFoundError(f"未找到 {name}：请安装 FFmpeg 或将其加入 PATH。")
    return candidate


datas = [(str(project_dir / "gzya5-3b5gl-001.ico"), ".")]
datas += collect_data_files("tkinterdnd2")

binaries = [
    (str(required_tool("ffmpeg")), "."),
    (str(required_tool("ffprobe")), "."),
]

hiddenimports = [
    "tkinter",
    "tkinter.ttk",
    "tkinter.filedialog",
    "tkinter.messagebox",
    "tkinter.simpledialog",
    "tkinterdnd2",
    "tkinterdnd2.TkinterDnD",
]
hiddenimports += collect_submodules("tkinterdnd2")

a = Analysis(
    ["main.py"],
    pathex=[str(project_dir)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="小丸工具箱粉丝致敬版 v1.1.2",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=[str(project_dir / "gzya5-3b5gl-001.ico")],
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="小丸工具箱粉丝致敬版 v1.1.2 便携版",
)
