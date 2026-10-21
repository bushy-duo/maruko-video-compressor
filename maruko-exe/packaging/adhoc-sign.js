/* macOS 打包的兜底签名（electron-builder afterPack 钩子）。
 *
 * 背景：Apple 芯片要求所有可执行代码至少带 ad-hoc 签名，否则系统会直接终止进程。
 * 本项目没有 Apple 开发者证书，electron-builder 会跳过签名（package.json 里 mac.identity = null），
 * 于是这里在应用目录组装完成后，用系统自带的 codesign 做一次 ad-hoc 签名，
 * 让未公证的安装包至少能在 Apple 芯片上正常启动。
 *
 * 如果配置了真实证书（CSC_LINK / CSC_NAME），本钩子什么都不做，
 * 由 electron-builder 按正常流程签名。
 */
const { execFileSync } = require("child_process");
const path = require("path");

const CODESIGN = "/usr/bin/codesign";

function hasDeveloperCertificate() {
  return Boolean(
    process.env.CSC_LINK || process.env.CSC_NAME || process.env.MAC_CSC_LINK || process.env.MAC_CSC_NAME
  );
}

async function adhocSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  if (process.platform !== "darwin") return;
  if (hasDeveloperCertificate()) return;

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log("[adhoc-sign] ad-hoc 签名：" + appPath);
  execFileSync(CODESIGN, ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
  execFileSync(CODESIGN, ["--verify", "--deep", "--strict", "--verbose=2", appPath], { stdio: "inherit" });
  console.log("[adhoc-sign] 签名校验通过");
}

module.exports = adhocSign;
module.exports.default = adhocSign;
