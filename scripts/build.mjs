import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
const env = { ...process.env };
delete env.BB_CLI;
delete env.BB_CLI_REEXEC;
const cli = new URL("../node_modules/bb-app/dist/bb.js", import.meta.url);
const child = spawn(
  process.execPath,
  [
    fileURLToPath(cli),
    "plugin",
    "build",
    fileURLToPath(new URL("../", import.meta.url)),
  ],
  { env, stdio: "inherit" },
);
const [code] = await once(child, "exit");
process.exitCode = code ?? 1;
