# bb-team

Independent BB plugin for trusted, self-selected team members. This baseline
implements member profiles, identity selection and a shared RPC/SDK/CLI service.
Thread creation attribution, member grouping, row labels and activity queries
are **next phase**, pending BB's public extensions. There is no npm release or
version tag yet.

## Implemented behavior

- A synchronous SQLite immediate transaction creates exactly one first
  administrator. A losing initializer receives `already_initialized`; rollback
  leaves no orphan member. IDs are server-generated UUIDs and remain fixed.
- Administrator identity controls only member creation. Names are trimmed and
  contain 1–80 Unicode code points; duplicate names are allowed. Exact name
  resolution reports ambiguity, while list search/pagination runs in SQL with
  bounded pages and stable ID cursors. A cursor is the last returned member ID;
  use the same search/name on subsequent pages. Results reflect current data.
- Update-self has one selected `memberId`, with no separate target field.
  Selecting an identity is a team convention, **not authentication**. Anyone
  with a BB session can self-select the administrator; this plugin adds no
  passwords, email login or BB permissions.
- Browser identity is partitioned by app origin, persisted plugin server UUID,
  and the browser's storage profile/container. Persistent defaults use
  `localStorage`; window overrides use `sessionStorage`, including explicit
  `null`. A window pins the initial value, so another window's default change
  does not switch it. Remember writes both; only-this-window writes session
  only; clear writes null; restore rereads the current default and pins it;
  forget deletes the default and clears this window. Storage failure falls
  back to memory and reports that persistence cannot be guaranteed.
- The public SDK does not expose the native app's active profile identifier.
  Browser profiles with separate storage are isolated; native profiles sharing
  both origin and storage currently share that default. Automatic native
  profile isolation needs a public host scope API and is not claimed here.
- CLI runs **on the server** and uses explicit `--actor` / `--member`. It does
  not implement client-local select/show/clear or write a global current user.
  Browser identity and CLI identity never synchronize implicitly.
- Timezone is one ordinary `bb.settings.define` field, validated by an IANA
  schema. The server uses UTC while unset. An absent stored setting is distinct
  from explicitly saved UTC, allowing initialization to suggest the browser's
  timezone without overwriting an existing preference. Only the winning
  initializer saves its confirmed timezone, after creating the member. These
  are two writes: a failed setting save offers an independent retry.
  Later settings/RPC/CLI/SDK edits require no administrator identity.
- Six generated PNG avatars use `assets/avatars/manifest.json` as the only
  inventory. Only the backend reads the committed PNGs, using package-relative file URLs,
  and serves same-origin authenticated plugin HTTP routes. URLs include content hashes;
  matching hashes use immutable caching, and routes support ETag validation.
  The frontend and CLI receive only metadata and URLs.
- Navigation, plugin settings and sidebar footer expose the member UI. Compact
  profile editors use BB's vendored persistent drawer and keep app-root
  controls available. Committed profile changes publish `members.changed`;
  reconnect refetches current state and profiles. No names or avatars are
  copied into thread metadata in this phase.

## Development and installation

Requires Node 24, the exact public Plugin SDK 0.6.37 and the public `bb-app`
0.46.0 development CLI pinned in the lockfile. These requirements cover only
the interfaces used in this member baseline; they do not claim that BB 0.46.0
has the next-phase creation/list/activity extensions.

```bash
git clone https://github.com/hxy91819/bb-team.git
cd bb-team
npm ci
npm run check
```

`build` invokes the installed public `bb plugin build`. Asset loading needs no
npm lifecycle hook: BB managed Git installation disables scripts and omits dev
and optional dependencies. `src/avatars.ts` and `dist/server.js` both sit one
level below the committed `assets/` directory, so runtime URLs work in source
and built packages. `node scripts/check-install.mjs` clones the committed Git tree and checks it
without generated files using those production-only install flags.
The runtime has no BB source checkout dependency. Generated bundles, source
maps, SQLite files and local secrets are not committed. The package is marked
private to prevent accidental npm publication.

For an explicitly chosen **development** BB instance:

```bash
BB_SERVER_URL=http://127.0.0.1:YOUR_DEV_PORT npx bb plugin install . --yes
BB_SERVER_URL=http://127.0.0.1:YOUR_DEV_PORT npx bb plugin dev .
```

Do not interpret these examples as automatic installation into your normal BB
instance. `scripts/live-smoke.mjs` starts the pinned public server with a fresh
temporary data directory, installs this package, exercises real browser and
wire flows, then stops the server and deletes only its own temporary data.

```bash
node scripts/live-smoke.mjs
```

On a shared BB development host, run each entire heavy job under the shared
resource lock and the host-provided resource isolation runner:

```bash
flock /tmp/bb-team-verification.lock "$BB_RESOURCE_RUNNER" -- npm run check
flock /tmp/bb-team-verification.lock "$BB_RESOURCE_RUNNER" -- node scripts/live-smoke.mjs
```

Set `BB_RESOURCE_RUNNER` to that host's `scripts/run-resource-isolated` executable.
Queueing for the lock is expected. Browser smoke needs Playwright Chromium and
WebKit installed (`npx playwright install --with-deps chromium webkit`). It is
separate from the ordinary CI job.

## Commands and SDK

`bb team --help` is the command inventory. All commands accept `--json`.

```bash
bb team initialize --name "Admin" --avatar cat --json
bb team list --search "Name" --limit 20 --json
bb team resolve --name "Name" --limit 10 --json
bb team get --member MEMBER_ID --json
bb team create --actor ADMIN_ID --name "Name" --avatar fox --json
bb team update-self --member MEMBER_ID --name "New name" --avatar owl --json
bb team identity --member MEMBER_ID --json
bb team avatars --json
bb team timezone --timezone Asia/Shanghai --json
```

`src/contracts.ts` exports the typed `rpcContract`. Browser callers use
`useRpc<typeof rpcContract>()`; `src/client.ts` exports `createTeamClient`
for that transport and `createTeamSdkClient` for public `sdk.plugins.callRpc`.
Script callers can pass a public BB SDK with `plugins.callRpc` and its output
schema support. All write methods use the same member service.

```ts
import { createTeamSdkClient } from './src/client.js';
const team = createTeamSdkClient(bb.sdk);
const page = await team.list('Name', 20);
const profile = await team.get(memberId);
await team.updateSelf(memberId, 'New name', 'panda');
```

RPC methods are discoverable through BB's public plugin RPC discovery. No
extra member list, image bytes or tool collection is injected into agent
context. There is no activity command in this phase.

## Data and maintenance

Member data lives only in the plugin's own SQLite database. Migrations are
append-only. Disabling/reloading retains data; there is no member deletion,
merge, administrator transfer, thread ownership reassignment or implicit data
purge. Uninstall/data clearing follows BB's explicit host operations; the
plugin never removes team data as a shutdown side effect.

[AGENTS.md](AGENTS.md) identifies module ownership. [SECURITY.md](SECURITY.md)
describes the trusted boundary. Vendored UI retains BB's actual MIT license in
[licenses/](licenses/README.md); plugin code is copyright hxy91819.

CI performs locked dependency installation, behavior tests, lint, formatting,
typecheck, plugin build, production dependency audit and secret scanning. The full development audit
also runs and currently reports known advisories bundled inside npm, which
upstream npm cannot auto-fix; this advisory step is visible and non-blocking. Verification
results and implementation choices are recorded in
[docs/verification.md](docs/verification.md).
