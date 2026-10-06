# -*- mode: python ; coding: utf-8 -*-

import shutil
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules


project_dir = Path.cwd()
python_dir = Path(sys.base_prefix)
tcl_root = python_dir / "tcl"
tkdnd_root = python_dir / "Lib" / "site-packages" / "tkinterdnd2" / "tkdnd"


def required_tool(name):
    detected = shutil.which(name)
    fallback = Path(r"E:\Programe Files\FFmpeg\ffmpeg-9.0.1-full_build\bin") / f"{name}.exe"
    candidate = Path(detected) if detected else fallback
    if not candidate.exists():
        raise FileNotFoundError(f"未找到 {name}：请安装 FFmpeg 或将其加入 PATH。")
    return candidate


datas = [(str(project_dir / "gzya5-3b5gl-001.ico"), ".")]
if tcl_root.exists():
    datas.append((str(tcl_root), "tcl"))
if tkdnd_root.exists():
    datas.append((str(tkdnd_root), "tkinterdnd2/tkdnd"))
datas += collect_data_files("tkinterdnd2")

binaries = [
    (str(required_tool("ffmpeg")), "."),
    (str(required_tool("ffprobe")), "."),
]
for runtime_file in ("_tkinter.pyd", "tcl86t.dll", "tk86t.dll"):
    candidate = python_dir / "DLLs" / runtime_file
    if candidate.exists():
        binaries.append((str(candidate), "."))

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
    runtime_hooks=[str(project_dir / "pyi_rth_tk_env.py")],
    excludes=[],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="小丸工具箱粉丝致敬版 v1.1.2",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=[str(project_dir / "gzya5-3b5gl-001.ico")],
)
