import { spawn } from "node:child_process";
import { ensureElectron } from "./ensure-electron.mjs";

async function main() {
  const electronPath = await ensureElectron();
  const child = spawn(electronPath, ["."], {
    stdio: "inherit",
    windowsHide: false,
    env: process.env,
  });

  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
}

main().catch((error) => {
  console.error(error?.message || error);
  console.error("\n可尝试: npm run fix:electron");
  process.exit(1);
});
