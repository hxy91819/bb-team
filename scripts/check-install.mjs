import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url)),
  dir = await mkdtemp(join(tmpdir(), "bb-team-install-"));
async function run(command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      BB_CLI: resolve(root, "node_modules/bb-app/host-daemon/dist/bb"),
    },
  });
  const [code] = await once(child, "exit");
  if (code !== 0) throw Error(`${command} failed: ${code}`);
}
try {
  await run("git", ["clone", "--no-hardlinks", "--quiet", root, dir], root);
  await run(
    "npm",
    [
      "install",
      "--prefix",
      dir,
      "--ignore-scripts",
      "--omit=dev",
      "--omit=optional",
      "--no-fund",
      "--no-audit",
    ],
    dir,
  );

  await run(
    process.execPath,
    [resolve(root, "node_modules/bb-app/dist/bb.js"), "plugin", "build", dir],
    dir,
  );
  console.log(
    "PASS: clean committed Git checkout without generated files, production-only installation with scripts disabled, public plugin build",
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
