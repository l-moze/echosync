const { spawn } = require("node:child_process");
const path = require("node:path");

const isDev = process.argv.includes("--dev");
const electronBin = path.join(
  __dirname,
  "..",
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron.cmd" : "electron"
);

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

if (isDev) {
  env.ECHOSYNC_DESKTOP_RENDERER_URL = "http://127.0.0.1:6001";
}

const child = spawn(electronBin, ["."], {
  cwd: path.join(__dirname, ".."),
  env,
  shell: process.platform === "win32",
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
