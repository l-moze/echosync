const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");
const exeName = "echosync-wasapi-sidecar.exe";
const candidates = [
  path.join(repoRoot, "apps", "wasapi-sidecar", "target", "release", exeName),
  path.join(repoRoot, ".tmp", "wasapi-target", "release", exeName)
];
const source = process.env.ECHOSYNC_WASAPI_SIDECAR_BUILD_PATH || candidates.find((candidate) => fs.existsSync(candidate));

if (!source || !fs.existsSync(source)) {
  console.error("未找到 WASAPI sidecar release 产物。请先运行 npm run build:wasapi-sidecar，或设置 ECHOSYNC_WASAPI_SIDECAR_BUILD_PATH。");
  process.exit(1);
}

const targetDir = path.join(repoRoot, "apps", "desktop", "resources", "wasapi-sidecar");
const target = path.join(targetDir, exeName);
fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, target);
console.log(`已复制 WASAPI sidecar: ${source} -> ${target}`);
