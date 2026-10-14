import { fileURLToPath } from "node:url";
import {
  mkdtemp,
  rm,
  readFile,
  mkdir,
  writeFile,
  cp,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { chromium, webkit, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { node, cli, server, env, provenance, runtime } from "./runtime.mjs";
const require = createRequire(join(runtime, "package.json"));
const { BBSdk } = require("bb-app");
const bbCli = cli;

const root = fileURLToPath(new URL("../", import.meta.url));
const evidence = process.env.BB_TEAM_EVIDENCE_DIR;
if (evidence) await mkdir(evidence, { recursive: true });
const data = await mkdtemp(join(tmpdir(), "bb-team-live-"));
await writeFile(join(data, "bb-team-owner"), String(process.pid));
const livePlugin = join(data, "plugin");
await mkdir(livePlugin);
for (const entry of [
  "package.json",
  "server.ts",
  "app.tsx",
  "src",
  "components",
  "lib",
  "assets",
  "skills",
])
  await cp(join(root, entry), join(livePlugin, entry), { recursive: true });
await symlink(
  join(root, "node_modules"),
  join(livePlugin, "node_modules"),
  "dir",
);
const portServer = createServer();
portServer.listen(0, "127.0.0.1");
await once(portServer, "listening");
const port = portServer.address().port;
await new Promise((resolve) => portServer.close(resolve));
const url = `http://127.0.0.1:${port}`;

const serverEnv = { ...env, BB_DATA_DIR: data, BB_SERVER_URL: url };
delete serverEnv.BB_THREAD_ID;
delete serverEnv.BB_PROJECT_ID;
delete serverEnv.BB_ENVIRONMENT_ID;

const child = spawn(
  node,
  [
    server,
    "--data-dir",
    data,
    "--server-bind-host",
    "127.0.0.1",
    "--server-port",
    String(port),
  ],
  { env: serverEnv, stdio: "ignore", detached: true },
);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function stopGroup(child) {
  if (!child?.pid) return;
  const signal = (value) => {
    try {
      process.kill(-child.pid, value);
      return true;
    } catch (error) {
      if (error.code === "ESRCH") return false;
      throw error;
    }
  };
  if (!signal("SIGTERM")) return;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!signal(0)) return;
    if (attempt === 50) signal("SIGKILL");
    await delay(100);
  }
  throw Error(`Owned process group ${child.pid} did not exit`);
}

async function runCli(args) {
  const child = spawn(node, [bbCli, ...args], { env: serverEnv, cwd: root });
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
  if (!result.ok) {
    console.error(`RPC ${method} failed:`, JSON.stringify(result));
    throw Error(JSON.stringify(result));
  }
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
let daemon;
let nativeThreadUrl;
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
  console.log(`Isolated BB fork ${provenance.source} server ready`);
  console.log(
    await runCli(["plugin", "install", livePlugin, "--yes", "--json"]),
  );
  if (process.env.BB_TEAM_TEST_PROVIDER_DIR) {
    console.log(
      await runCli([
        "plugin",
        "install",
        process.env.BB_TEAM_TEST_PROVIDER_DIR,
        "--yes",
        "--json",
      ]),
    );
    const enrollment = await fetch(`${url}/internal/hosts/enroll-key`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (!enrollment.ok) throw Error("Isolated host enrollment failed");
    const { hostId, enrollKey } = await enrollment.json();
    const daemonPortServer = createServer();
    daemonPortServer.listen(0, "127.0.0.1");
    await once(daemonPortServer, "listening");
    const daemonPort = daemonPortServer.address().port;
    await new Promise((resolve) => daemonPortServer.close(resolve));
    serverEnv.BB_HOST_DAEMON_PORT = String(daemonPort);
    daemon = spawn(
      node,
      [join(runtime, "node_modules/bb-app/dist/bb-host-daemon.js")],
      {
        env: {
          ...serverEnv,
          BB_HOST_ID: hostId,
          BB_HOST_ENROLL_KEY: enrollKey,
        },
        detached: true,
        stdio: "ignore",
      },
    );
    await expect
      .poll(
        async () => {
          const hosts = await new BBSdk({ baseUrl: url }).hosts.list();
          return hosts.find((host) => host.id === hostId)?.status;
        },
        { timeout: 60000 },
      )
      .toBe("connected");
    console.log("PASS: isolated candidate daemon connected");
  }
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
  page.on("response", async (response) => {
    if (response.status() >= 400 && response.url().startsWith(url))
      console.error(
        "HTTP failure",
        response.status(),
        response.url(),
        await response.text().catch(() => ""),
      );
  });
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
    await runCli([
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
  if (evidence)
    await page.screenshot({ path: join(evidence, "members-desktop.png") });
  if (process.env.BB_TEAM_TEST_PROVIDER_DIR) {
    const host = (await sdk.hosts.list()).find(
      (host) => host.status === "connected",
    );
    const projectPath = join(data, "project");
    await mkdir(projectPath);
    const project = await sdk.projects.create({
      name: "Team acceptance",
      source: { type: "local_path", hostId: host.id, path: projectPath },
    });
    const seed = await sdk.threads.spawn({
      projectId: project.id,
      origin: "app",
      providerId: "team-echo",
      model: "fake-model",
      reasoningLevel: "medium",
      permissionMode: "full",
      environment: { type: "project-default" },
      prompt: "Seed fixture",
    });
    await page.goto(`${url}/projects/${project.id}`);
    const editor = (target) =>
      target.locator(
        '[data-app-composer-role="primary"] [contenteditable="true"]',
      );
    const submit = (target) =>
      target.locator(
        '[data-app-composer-role="primary"] button[data-promptbox-submit-action][type="submit"]',
      );
    await expect(editor(page)).toBeVisible({ timeout: 30000 });
    if (evidence)
      await page.screenshot({ path: join(evidence, "native-compose.png") });
    await editor(page).fill("Admin native fixture");
    await expect(submit(page)).toBeEnabled({ timeout: 30000 });
    await submit(page).click();
    await page.waitForURL(/\/threads\//, { timeout: 30000 });
    const firstId = page.url().split("/threads/")[1].split(/[?#]/)[0];
    nativeThreadUrl = page.url();
    expect(
      await sdk.threads.getPluginMetadata({
        threadId: firstId,
        pluginId: "team",
      }),
    ).toEqual({ memberId: admin.memberId });
    await second.goto(`${url}/projects/${project.id}`);
    await editor(second).fill("Other native fixture");
    await expect(submit(second)).toBeEnabled({ timeout: 30000 });
    await submit(second).click();
    await second.waitForURL(/\/threads\//, { timeout: 30000 });
    const secondId = second.url().split("/threads/")[1].split(/[?#]/)[0];
    expect(
      await sdk.threads.getPluginMetadata({
        threadId: secondId,
        pluginId: "team",
      }),
    ).toEqual({ memberId: other.memberId });
    expect(
      await sdk.threads.getPluginMetadata({
        threadId: seed.id,
        pluginId: "team",
      }),
    ).toEqual({});
    console.log(
      "PASS: native two-window creation attribution and unassigned SDK creation; deterministic echo fixture, not real AI",
    );
    await expect(
      page.getByText("Response to: Admin native fixture", { exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      page.getByLabel("Thread member: Renamed", { exact: true }).first(),
    ).toBeVisible({ timeout: 15000 });
    await page.getByText("Threads", { exact: true }).first().hover();
    await page
      .getByRole("button", { name: "Threads actions", exact: true })
      .press("Enter");
    await page.getByRole("menuitem", { name: "Organize", exact: true }).hover();
    await page
      .getByRole("menuitemradio", { name: "Team members", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(
      page.getByLabel("Thread member: Admin", { exact: true }).first(),
    ).toBeVisible();
    let releaseMetadata;
    const metadataGate = new Promise((resolve) => {
      releaseMetadata = resolve;
    });
    const metadataRoute = "**/api/v1/threads/plugin-metadata";
    await page.route(metadataRoute, async (route) => {
      await metadataGate;
      await route.abort();
    });
    await page.reload();
    await expect(
      page.getByLabel("Thread member is loading").first(),
    ).toBeVisible();
    releaseMetadata();
    await expect(
      page.getByLabel("Thread member lookup failed").first(),
    ).toBeVisible();
    await page.unroute(metadataRoute);
    await page.reload();
    await expect(
      page.getByLabel("Thread member: Admin", { exact: true }).first(),
    ).toBeVisible();
    console.log(
      "PASS: member loading, failed lookup and recovery stay distinct from unassigned",
    );
    await rpc("members_updateSelf", {
      memberId: other.memberId,
      displayName: "Renamed live",
      avatarId: "owl",
    });
    await expect(
      page.getByLabel("Thread member: Renamed live", { exact: true }).first(),
    ).toBeVisible();
    expect(
      await sdk.threads.getPluginMetadata({
        threadId: secondId,
        pluginId: "team",
      }),
    ).toEqual({ memberId: other.memberId });
    if (evidence)
      await page.screenshot({
        path: join(evidence, "member-groups-desktop.png"),
      });
    await rpc("members_updateSelf", {
      memberId: other.memberId,
      displayName: "Renamed",
      avatarId: "owl",
    });
    await openMembers(page);
    await page
      .getByRole("button", { name: "Use Renamed only in this window" })
      .click();
    await page.goto(`${url}/projects/${project.id}/threads/${firstId}`);
    await page
      .getByText("Response to: Admin native fixture", { exact: true })
      .hover();
    await page
      .getByRole("button", { name: "Message actions", exact: true })
      .last()
      .click();
    console.log(
      "Fork source state",
      JSON.stringify(await sdk.threads.get({ threadId: firstId })),
    );
    await page
      .getByRole("menuitem", { name: "Fork into new thread", exact: true })
      .click();
    await page.waitForURL(
      (value) =>
        value.pathname.includes("/threads/") &&
        !value.pathname.endsWith(firstId),
    );
    const forkId = page.url().split("/threads/")[1].split(/[?#]/)[0];
    expect(
      await sdk.threads.getPluginMetadata({
        threadId: forkId,
        pluginId: "team",
      }),
    ).toEqual({ memberId: other.memberId });
    await editor(page).fill("Fork local suffix");
    await submit(page).click();
    await expect(
      page.getByText("Response to: Fork local suffix", { exact: true }),
    ).toBeVisible({ timeout: 30000 });
    const forkReport = await rpc("activity", {
      mode: "details",
      memberId: other.memberId,
      threadId: forkId,
    });
    expect(
      forkReport.items.some((item) =>
        item.excerpt.includes("Fork local suffix"),
      ),
    ).toBe(true);
    expect(
      forkReport.items.some((item) =>
        item.excerpt.includes("Admin native fixture"),
      ),
    ).toBe(false);
    const nestedFork = await sdk.threads.fork({
      sourceThreadId: forkId,
      experimental_pluginContext: { team: { memberId: other.memberId } },
      input: [{ type: "text", text: "Nested fork suffix", mentions: [] }],
    });
    await expect
      .poll(
        async () => (await sdk.threads.get({ threadId: nestedFork.id })).status,
        { timeout: 30000 },
      )
      .toBe("idle");
    const nestedReport = await rpc("activity", {
      mode: "details",
      memberId: other.memberId,
      threadId: nestedFork.id,
    });
    expect(
      nestedReport.items.some((item) =>
        item.excerpt.includes("Nested fork suffix"),
      ),
    ).toBe(true);
    expect(
      nestedReport.items.some(
        (item) =>
          item.excerpt.includes("Fork local suffix") ||
          item.excerpt.includes("Admin native fixture"),
      ),
    ).toBe(false);
    await sdk.threads.archive({ threadId: nestedFork.id });
    const archivedReport = await rpc("activity", {
      memberId: other.memberId,
      projectId: project.id,
    });
    expect(
      archivedReport.items.some((item) => item.threadId === nestedFork.id),
    ).toBe(true);
    console.log(
      "PASS: multilevel fork excludes inherited prefixes and archived local activity remains queryable",
    );
    console.log(
      "PASS: native member grouping, live profile/metadata separation, manual fork attribution and local-only retained evidence",
    );
    await page
      .getByRole("button", { name: /^Provider, model and reasoning/ })
      .click();
    await page
      .getByRole("button", { name: "Handoff to new thread", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await editor(page).fill("Handoff fixture");
    await submit(page).click();
    await page.waitForURL(
      (value) =>
        value.pathname.includes("/threads/") &&
        !value.pathname.endsWith(forkId),
    );
    const handoffId = page.url().split("/threads/")[1].split(/[?#]/)[0];
    expect(
      await sdk.threads.getPluginMetadata({
        threadId: handoffId,
        pluginId: "team",
      }),
    ).toEqual({ memberId: other.memberId });
    expect(
      (await sdk.threads.get({ threadId: handoffId })).originKind,
    ).toBeNull();
    await openMembers(page);
    await page
      .getByRole("button", { name: "Clear this window", exact: true })
      .click();
    await page.goto(`${url}/projects/${project.id}`);
    await editor(page).fill("Unassigned native fixture");
    await submit(page).click();
    await page.waitForURL(/\/threads\//);
    const unassignedId = page.url().split("/threads/")[1].split(/[?#]/)[0];
    expect(
      await sdk.threads.getPluginMetadata({
        threadId: unassignedId,
        pluginId: "team",
      }),
    ).toEqual({});
    await page.evaluate((scope) => {
      sessionStorage.setItem(
        `bb-plugin-team:identity:v1:${JSON.stringify([location.origin, scope])}`,
        JSON.stringify("00000000-0000-4000-8000-000000000000"),
      );
    }, state.serverScope);
    await page.goto(`${url}/projects/${project.id}`);
    await editor(page).fill("Preserve invalid identity draft");
    const rejected = page.waitForResponse(
      (response) =>
        response.url() === `${url}/api/v1/threads` &&
        response.request().method() === "POST",
    );
    await submit(page).click();
    expect((await rejected).ok()).toBe(false);
    await expect(editor(page)).toHaveText("Preserve invalid identity draft");
    await expect(
      page.getByText("Creation context failed: team", { exact: false }).first(),
    ).toBeVisible();
    if (evidence)
      await page.screenshot({
        path: join(evidence, "invalid-identity-draft.png"),
      });
    console.log(
      "PASS: native handoff attribution, explicit null and failed prepare preserves draft",
    );
    const report = await rpc("activity", {
      memberId: admin.memberId,
      date: "today",
    });
    expect(report.items.some((item) => item.threadId === firstId)).toBe(true);
    expect(report.items.some((item) => item.threadId === secondId)).toBe(false);
    if (evidence) {
      await writeFile(
        join(evidence, "activity-fixture.json"),
        JSON.stringify(report, null, 2),
      );
      await page.goto(`${url}/projects/${project.id}/threads/${forkId}`);
      await expect(
        page.getByText("Response to: Fork local suffix", { exact: true }),
      ).toBeVisible();
      await page.screenshot({ path: join(evidence, "native-thread.png") });
    }
    await openMembers(page);
  }
  await runCli(["plugin", "enable", "plugin-api-docs"]);
  await page.goto(`${url}/plugins/plugin-api-docs/plugin-api/headless`);
  await page
    .getByRole("link", {
      name: "Thread plugin metadata — jump to details",
      exact: true,
    })
    .click();
  await expect(
    page
      .getByText(
        "Read agent, batch and ancestor metadata; query dated facts for archived and hidden threads",
        { exact: true },
      )
      .first(),
  ).toBeVisible();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page
    .getByRole("button", { name: "Copy for agent", exact: true })
    .click();
  const guideReference = await page.evaluate(() =>
    navigator.clipboard.readText(),
  );
  expect(guideReference).toContain("@Thread plugin metadata");
  if (evidence)
    await page.screenshot({ path: join(evidence, "plugin-guide.png") });
  if (nativeThreadUrl) {
    await page.goto(nativeThreadUrl);
    const composer = page.locator(
      '[data-app-composer-role="primary"] [contenteditable="true"]',
    );
    await composer.click();
    await page.keyboard.press("Control+V");
    await expect(composer).toContainText("Thread plugin metadata");
    await page
      .locator(
        '[data-app-composer-role="primary"] button[data-promptbox-submit-action][type="submit"]',
      )
      .click();
    await expect(
      page.getByText(/Response to:.*experimental_activity/s).last(),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      page
        .getByText(/Response to:.*experimental_threadCreationContext/s)
        .last(),
    ).toBeVisible();
    if (evidence)
      await page.screenshot({
        path: join(evidence, "plugin-guide-resolved.png"),
      });
    console.log(
      "PASS: Guide card and copied rich mention resolve new SDK symbols in a normal provider turn",
    );
  }
  await openMembers(page);
  await rpc("timezone_set", { timezone: "Europe/London" });
  await expect(page.getByLabel("Team time zone", { exact: true })).toHaveValue(
    "Europe/London",
  );
  for (const avatar of await rpc("avatars_list")) {
    const response = await fetch(url + avatar.url);
    if (!response.ok || response.headers.get("content-type") !== "image/png")
      throw Error("avatar HTTP failed");
  }
  await runCli(["plugin", "disable", "team"]);
  if (nativeThreadUrl) {
    await page.goto(nativeThreadUrl.split("/threads/")[0]);
    const composer = page.locator(
      '[data-app-composer-role="primary"] [contenteditable="true"]',
    );
    await composer.fill("Disabled plugin native fixture");
    await page
      .locator(
        '[data-app-composer-role="primary"] button[data-promptbox-submit-action][type="submit"]',
      )
      .click();
    await page.waitForURL(/\/threads\//);
    const threadId = page.url().split("/threads/")[1].split(/[?#]/)[0];
    expect(
      await sdk.threads.getPluginMetadata({ threadId, pluginId: "team" }),
    ).toEqual({});
    console.log(
      "PASS: disabled plugin stops marking native thread attribution",
    );
  }
  await runCli(["plugin", "enable", "team"]);
  if (
    (await rpc("members_get", { memberId: other.memberId })).displayName !==
    "Renamed"
  )
    throw Error("disable/enable lost profile");
  const appSource = join(livePlugin, "app.tsx");
  await writeFile(
    appSource,
    (await readFile(appSource, "utf8")).replace(
      'label: "Team identity"',
      'label: "Team identity reloaded"',
    ),
  );
  await runCli(["plugin", "build", livePlugin]);
  await runCli(["plugin", "reload", "team"]);
  await expect(
    page.getByText("Team identity reloaded", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  console.log(
    "PASS: changed frontend bundle reload re-registers the sidebar contribution",
  );
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
    if (evidence)
      await page.screenshot({
        path: join(evidence, `drawer-${engine.name()}.png`),
      });
    await expect(page.getByLabel("Search members")).toBeEnabled();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(
      page.locator("[data-persistent-drawer-content]"),
    ).not.toBeInViewport();
    await page.getByLabel("Search members").fill("Admin");
    await expect(
      page.getByRole("button", { name: "Remember Admin", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /^Toggle sidebar(?: \(|$)/ })
      .click();
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "Search threads", exact: true })
      .click();
    await expect(
      page.getByRole("combobox", { name: "Search threads", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    const sidebarToggle = page.getByRole("button", {
      name: /^Toggle sidebar(?: \(|$)/,
    });
    await expect(page.locator("main[data-sidebar-shelf]")).toHaveAttribute(
      "data-sidebar-shelf",
      "closed",
    );
    await sidebarToggle.click();
    await expect(page.locator("main[data-sidebar-shelf]")).toHaveAttribute(
      "data-sidebar-shelf",
      "open",
    );
    await page
      .getByRole("button", { name: /^(Threads|Unassigned) actions$/ })
      .press("Enter");
    await page.getByRole("menuitem", { name: "Organize", exact: true }).click();
    await expect(
      page.getByRole("menuitemradio", { name: "Team members", exact: true }),
    ).toBeVisible();
    if (evidence)
      await page.screenshot({
        path: join(evidence, `member-menu-${engine.name()}.png`),
      });
    await page
      .getByRole("menuitemradio", { name: "Team members", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(page.locator("main[data-sidebar-shelf]")).toHaveAttribute(
      "data-sidebar-shelf",
      "closed",
    );
    await sidebarToggle.click();
    await expect(page.locator("main[data-sidebar-shelf]")).toHaveAttribute(
      "data-sidebar-shelf",
      "open",
    );
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "Search threads", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Search threads", exact: true })
      .fill("fixture");
    await expect(
      page.getByRole("combobox", { name: "Search threads", exact: true }),
    ).toHaveValue("fixture");
    await browser.close();
    browser = null;
    console.log(`PASS: compact persistent drawer ${engine.name()}`);
  }
  console.log(`PASS: candidate BB fork ${provenance.source} integration`);
} catch (error) {
  if (diagnosticPage && !diagnosticPage.isClosed()) {
    try {
      console.error(
        "Browser state:",
        diagnosticPage.url(),
        await diagnosticPage.locator("body").innerText(),
      );
      if (evidence) {
        await diagnosticPage.screenshot({
          path: join(evidence, "failure.png"),
        });
        await writeFile(
          join(evidence, "failure.html"),
          await diagnosticPage.content(),
        );
      }
    } catch {}
  }
  throw error;
} finally {
  if (browser) await browser.close();
  await Promise.all([stopGroup(daemon), stopGroup(child)]);
  await rm(data, { recursive: true, force: true });
}
