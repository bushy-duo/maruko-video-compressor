param(
    [switch]$NonInteractive
)

$ErrorActionPreference = "Stop"

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pythonPath = "E:\Programe Files\Python313\python.exe"
$venvDir = Join-Path $projectDir ".venv"
$venvPython = Join-Path $venvDir "Scripts\python.exe"
$specPath = Join-Path $projectDir "小丸工具箱粉丝致敬版-onedir.spec"
$outputDir = Join-Path $projectDir "dist"
$releaseDir = Join-Path $outputDir "小丸工具箱粉丝致敬版 v1.1.2 便携版"
$exePath = Join-Path $releaseDir "小丸工具箱粉丝致敬版 v1.1.2.exe"

Set-Location -LiteralPath $projectDir

if (-not (Test-Path -LiteralPath $pythonPath)) {
    throw "未找到打包用 Python：$pythonPath"
}

& $pythonPath -c "import tkinter; print('Tkinter OK')"
if ($LASTEXITCODE -ne 0) {
    throw "Python 缺少 Tkinter，无法生成图形界面程序。"
}

if (-not (Test-Path -LiteralPath $venvPython)) {
    & $pythonPath -m venv $venvDir
    if ($LASTEXITCODE -ne 0) {
        throw "创建打包环境失败。"
    }
}

& $venvPython -m pip install --disable-pip-version-check -r (Join-Path $projectDir "requirements-build.txt")
if ($LASTEXITCODE -ne 0) {
    throw "安装打包依赖失败。"
}

& $venvPython -m PyInstaller --noconfirm --clean $specPath
if ($LASTEXITCODE -ne 0) {
    throw "打包失败。"
}

if (-not (Test-Path -LiteralPath $exePath)) {
    throw "打包结束，但没有找到预期的 EXE：$exePath"
}

$hash = Get-FileHash -LiteralPath $exePath -Algorithm SHA256
$hashLine = "$($hash.Hash)  $([IO.Path]::GetFileName($exePath))"
Set-Content -LiteralPath (Join-Path $releaseDir "SHA256.txt") -Value $hashLine -Encoding utf8

Write-Host ""
Write-Host "打包完成：" -ForegroundColor Green
Write-Host $exePath
Write-Host ""
if (-not $NonInteractive) {
    Read-Host "按回车键关闭"
}
