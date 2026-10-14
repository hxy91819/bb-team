import { fileURLToPath } from "node:url";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { chromium, webkit, expect } from "@playwright/test";
import { BBSdk } from "bb-app";
const root = fileURLToPath(new URL("../", import.meta.url));
const data = await mkdtemp(join(tmpdir(), "bb-team-live-"));
const portServer = createServer();
portServer.listen(0, "127.0.0.1");
await once(portServer, "listening");
const port = portServer.address().port;
await new Promise((resolve) => portServer.close(resolve));
const url = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  BB_DATA_DIR: data,
  BB_SERVER_URL: url,
  BB_CLI: resolve(root, "node_modules/bb-app/host-daemon/dist/bb"),
};
delete env.BB_THREAD_ID;
delete env.BB_PROJECT_ID;
delete env.BB_ENVIRONMENT_ID;
const child = spawn(
  process.execPath,
  [
    resolve(root, "node_modules/bb-app/dist/bb-server.js"),
    "--data-dir",
    data,
    "--server-bind-host",
    "127.0.0.1",
    "--server-port",
    String(port),
  ],
  { env, stdio: "ignore", detached: true },
);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function cli(args) {
  const child = spawn(
    process.execPath,
    [resolve(root, "node_modules/bb-app/dist/bb.js"), ...args],
    { env, cwd: root },
  );
  let out = "",
    err = "";
  child.stdout.on("data", (b) => (out += b));
  child.stderr.on("data", (b) => (err += b));
  const [code] = await once(child, "exit");
  if (code !== 0) throw Error(`${args.join(" ")}: ${out}\n${err}`);
  return out;
}
async function rpc(method, input = null) {
  const response = await fetch(`${url}/api/v1/plugins/team/rpc/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const result = await response.json();
  if (!result.ok) throw Error(JSON.stringify(result));
  return result.result;
}
async function openMembers(page) {
  await page.goto(`${url}/plugins/team/members`);
  const skip = page.getByRole("button", { name: "Skip setup", exact: true });
  await skip
    .or(page.getByLabel("Initialize team name"))
    .or(page.getByLabel("Search members"))
    .first()
    .waitFor();
  if (await skip.isVisible()) {
    await skip.click();
    await page.goto(`${url}/plugins/team/members`);
  }
}
let browser;
let diagnosticPage;
try {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) break;
    } catch {}
    if (attempt > 120)
      throw Error(
        `server startup timed out: ${await readFile(join(data, "logs/server-stdio.log"), "utf8")}`,
      );
    await delay(250);
  }
  console.log("Isolated public bb-app server ready");
  console.log(await cli(["plugin", "install", root, "--yes", "--json"]));
  const state = await rpc("state");
  if (state.adminMemberId !== null || state.timezone !== "UTC")
    throw Error("unexpected initial state");
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  diagnosticPage = page;
  page.on("pageerror", (error) =>
    console.error("Browser error:", error.message),
  );
  await openMembers(page);
  await page.getByLabel("Initialize team name").fill("Admin");
  await page.getByLabel("Initial team time zone").fill("Asia/Shanghai");
  await page
    .getByRole("button", { name: "Initialize team", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Remember Admin", exact: true }),
  ).toBeVisible();
  const admin = (await rpc("members_list", {})).members[0];
  console.log(
    await cli([
      "team",
      "create",
      "--actor",
      admin.memberId,
      "--name",
      "Other",
      "--avatar",
      "fox",
      "--json",
    ]),
  );
  await expect(
    page.getByRole("button", { name: "Remember Other", exact: true }),
  ).toBeVisible();
  const other = (await rpc("members_list", { search: "Other" })).members[0];
  const sdk = new BBSdk({ baseUrl: url });
  const result = await sdk.plugins.callRpc({
    pluginId: "team",
    method: "members_get",
    input: { memberId: other.memberId },
    outputSchema: (await import("zod")).z.object({
      memberId: (await import("zod")).z.string(),
      displayName: (await import("zod")).z.string(),
    }),
  });
  if (result.displayName !== "Other") throw Error("public SDK mismatch");
  const second = await context.newPage();
  await openMembers(second);
  await expect(
    second.getByRole("button", { name: "Edit my profile" }),
  ).toBeVisible();
  await second
    .getByRole("button", { name: "Use Other only in this window" })
    .click();
  await expect(
    second
      .locator("section")
      .filter({ has: second.getByRole("heading", { name: "This window" }) })
      .getByText("Other", { exact: true }),
  ).toBeVisible();
  await expect(
    second.getByText(other.memberId, { exact: false }).first(),
  ).toBeVisible();
  await expect(page.getByText("Admin", { exact: true }).first()).toBeVisible();
  await second.reload();
  await expect(
    second
      .locator("section")
      .filter({ has: second.getByRole("heading", { name: "This window" }) })
      .getByText("Other", { exact: true }),
  ).toBeVisible();
  await expect(
    second.getByRole("button", { name: "Edit my profile" }),
  ).toBeVisible();
  await second.getByRole("button", { name: "Edit my profile" }).click();
  await second.getByLabel("Save profile name").fill("Renamed");
  await second
    .getByRole("button", { name: "Save profile", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Remember Renamed" }),
  ).toBeVisible();
  await rpc("timezone_set", { timezone: "Europe/London" });
  await expect(page.getByLabel("Team time zone", { exact: true })).toHaveValue(
    "Europe/London",
  );
  for (const avatar of await rpc("avatars_list")) {
    const response = await fetch(url + avatar.url);
    if (!response.ok || response.headers.get("content-type") !== "image/png")
      throw Error("avatar HTTP failed");
  }
  await cli(["plugin", "disable", "team"]);
  await cli(["plugin", "enable", "team"]);
  if (
    (await rpc("members_get", { memberId: other.memberId })).displayName !==
    "Renamed"
  )
    throw Error("disable/enable lost profile");
  console.log(
    "PASS: HTTP/RPC, CLI, public SDK, initialization timezone, two Chromium windows, profile signals and retained DB",
  );
  await browser.close();
  browser = null;
  for (const engine of [chromium, webkit]) {
    browser = await engine.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    diagnosticPage = page;
    await openMembers(page);
    await page
      .getByRole("button", { name: "Use Renamed only in this window" })
      .click();
    await page.getByRole("button", { name: "Edit my profile" }).click();
    await expect(
      page.locator("[data-persistent-drawer-content]"),
    ).toBeInViewport();
    const name = page.getByLabel("Save profile name");
    await expect(name).toBeVisible();
    await expect(page.getByLabel("Search members")).toBeEnabled();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(
      page.locator("[data-persistent-drawer-content]"),
    ).not.toBeInViewport();
    await page.getByLabel("Search members").fill("Admin");
    await expect(
      page.getByRole("button", { name: "Remember Admin", exact: true }),
    ).toBeVisible();
    await browser.close();
    browser = null;
    console.log(`PASS: compact persistent drawer ${engine.name()}`);
  }
} catch (error) {
  if (diagnosticPage && !diagnosticPage.isClosed()) {
    try {
      console.error(
        "Browser state:",
        diagnosticPage.url(),
        await diagnosticPage.locator("body").innerText(),
      );
    } catch {}
  }
  throw error;
} finally {
  if (browser) await browser.close();
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  if (child.exitCode === null)
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
        resolve();
      }, 5000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  await rm(data, { recursive: true, force: true });
}
