# Verification record

## v0.2 identity and Admin work in progress

The next revision moves selection into one public app-wide overlay, with a
persistent identity button, a shared sidebar entry, and the persistent compact
drawer. Default Admin creation is automatic; migration keeps its existing UUID.
The asset-only checkpoint adds 14 ordinary avatars and one dedicated Admin PNG,
with all six original PNGs byte-identical.

Current local evidence is `/tmp/bb-team-v02-pbj6j2khqk`: the real-SQLite
empty-initialization baseline fails for the expected required-profile reason;
the new fixed Admin implementation passes. The complete check now passes
17 tests, lint, formatting, typecheck and the matching e7c/Node 24 build.
The user systemd manager failure and initial same-unit scope refusal are
retained separately. Checks resumed under the shared lock and a real system
scope through the existing runner, with measured 5/7 GiB memory and 300% CPU
limits; no service was restarted. Real browser attempts have not yet completed:
an entry wait matched a hidden dialog, and a corrected second-window run still
had no appOverlay container after 30 seconds although the new sidebar action
was present. A real old-version upgrade preserved Admin UUID, scope, ordinary
profiles, thread metadata and activity, but its frontend overlay was absent
after changed-bundle reload too. These failures were reported to the BB owner;
neither full browser journey is a pass. Owned instances and data were cleaned.
Incremental independent review has no remaining P0/P1 findings.
The BB list contribution v2 SDK and its candidate runtime are still
pending, so avatar-only leading placement and grouping-specific row assertions
remain pending too. The completed v0.1 evidence below is historical and does
not upgrade this revision to a pass.

## Thread integration candidate — 2026-10-14

This phase integrates native thread attribution, grouping and retained
activity. The candidate is not a public release.

- BB/SDK source: `e7c2ef8409d575c463cba97f366a936e724bfd98`.
- Runtime: `bb-fork-v0.46.0-candidate-e7c2ef8409-linux-x64.tar.gz`, Node
  `v24.15.0`, SHA256
  `7793b4d5d8e8fa26467d60730c6b9d3002ef55f123c407501a60aa9299938124`.
- SDK: `bb-plugin-sdk-fork-v0.46.0-candidate-e7c2ef8409.tgz`, SHA256
  `aa3c1cdca3c0219eda176b7216a72a9d8d978a532830c114aade64ad0b9bf412`.
  Its package version remains 0.6.37; stock 0.6.37 is not equivalent.
  Development uses a no-save overlay. Formal URL/integrity pinning and public
  installation/CI are pending the matching BB Release.

Executed checks use the shared `flock` and resource-isolated package profile,
with task-owned npm configuration and the candidate runtime, not the primary
BB service:

- 14 tests passed, including real SQLite, the public SDK plugin harness,
  activity RPC/CLI budgets, Unicode serialization, duplicate-name ambiguity,
  23/25-hour DST days, frozen query cursors across plugin reload, and
  parent-versus-fork-source attribution. Lint, formatting, typecheck and
  candidate backend/frontend builds passed. Production audit: zero findings.
- Cold production-only installation and build passed. Two real installation
  failures were repaired: `cron-parser` belongs in runtime dependencies; the
  shared UUID schema must not pull the backend RPC registration module into
  the frontend. Red and green build logs are retained with the acceptance
  evidence.
- Fresh isolated server/daemon and two Chromium windows exercised persisted
  identities and refresh, profile updates, native creation, manual fork,
  handoff, explicit null, and invalid identity with the draft retained.
  The provider is a deterministic public-protocol fixture. Its real turn
  execution proves integration, not paid AI quality or an independent claim
  that work succeeded. No activity events were inserted directly into the DB.
- Native member grouping and row labels updated from current profiles without
  changing metadata. Delayed and failed metadata requests showed loading and
  failure separately from unassigned, then recovered. Multilevel forks exposed
  local suffix evidence and excluded inherited prefixes; archived activity
  remained queryable.
- Guide navigation opened the metadata card, copied its rich mention and
  pasted it into a normal provider turn. The resolved context included the
  activity and creation-context APIs. Plain clipboard text contains a mention,
  not the expanded API reference.
- Disabling the plugin stopped native creation attribution; enabling retained
  member data. A changed app bundle in a temporary plugin copy was rebuilt and
  reloaded, and its changed sidebar contribution appeared. This does not claim
  that a same-hash server reload recreates the frontend.
- Chromium and WebKit at 390×844 both passed profile drawer open/close,
  member grouping menu selection and native Search input after closing those
  surfaces. This is browser-engine coverage, not physical iOS/Android testing.
  The complete final live run exited successfully and its isolated resource
  scope was inactive after all owned server/daemon/browser processes exited.
- Full-diff review `thr_mx4dj9dhwm` found the production dependency P1;
  incremental review `thr_wy7myj5um6` found the incorrect Guide clipboard
  assertion. Both were verified and fixed. Final incremental review
  `thr_7gwr3pnmp3` reported no P0/P1. Failed attempts remain evidence, not passes.
  Staged source secret scanning found no leaks; the approved commit identity
  and history passed the identity check.

The full development audit still reports five advisories (three high, two
moderate) inside the bundled npm toolchain. Production audit is clean; the
entire development graph is not. No production BB instance was modified.

The candidate core's supplied SQLite/public API tests own event-time selection
for older threads, SQL count/pagination above 10,000 rows, sequence ceilings,
fork boundary gaps and cursor continuation after DB reopen. These are fixture
contract tests, not a claim of yesterday's real user activity in this fresh
instance. Two known core queue-edit baseline failures remain outside this
plugin's scope. The older verify-bb inventory probe reports an unmapped
`browser` CLI family; no inventory baseline was rewritten to hide that drift.

Context cost: the skill description is 121 characters / 19 words; the full
on-demand skill is 1,311 characters / 191 words (roughly 330 tokens at four
characters per token). The discoverable RPC overview is 109 characters /
14 words (roughly 28 tokens). Host catalog formatting and path lengths add
overhead. Ordinary queries add no member roster, activity history, dedicated
tool or dynamic instructions. These are text estimates, not provider usage
measurements across all supported models.

Implementation decisions: metadata contains only a fixed member UUID; each
list demand uses deduplicated batches of at most 200 IDs; activity cursors
carry frozen dates/timezone and the last emitted core cursor; oversized first
items may shorten excerpts, while an envelope that still cannot fit fails
explicitly instead of returning partial JSON. The plugin stores no activity
log copy or whole-query snapshot.

## Historical member baseline

This file records executed checks, not a promise of complete team integration.

## Boundaries and decisions

- Keep the phase independent: no thread creation, list organization, activity
  API, private BB imports, production installation or runtime DB access.
- Use UUID keyset pagination. Duplicate names return bounded exact-match
  candidates; fuzzy search is a separate list operation. Renaming never changes
  identity. Pages are live views, not whole-query snapshots.
- Names use Unicode code points rather than UTF-16 units, matching the 1–80
  character contract for emoji and CJK names.
- Since the current public CLI is server-executed, explicit actor/member flags
  replace the proposed client selection commands. No server file is described
  as client-local configuration.
- Browser scope uses origin and a plugin-owned stable server UUID inside each
  browser profile's storage. Active native profile IDs are absent from the
  public app API; native profiles with shared storage are not claimed isolated.
- The single timezone descriptor is optional so an unset field differs from an
  explicit UTC preference; the server read boundary supplies UTC. Settings
  persistence remains independent of member initialization.
- The existing scaffold supplies MIT-licensed persistent drawer source. Compact
  editors reuse that implementation; desktop editors remain inline.
- Original PNGs and manifest remain the only avatar source. The backend reads
  them through package-relative file URLs; no generated module or lifecycle
  hook is needed under the managed installer's `--ignore-scripts --omit=dev
  --omit=optional` flags. Content-hash URLs and ETags avoid stale images.

## Execution record

Executed locally on 2026-10-14, Node 24.15.0, public Plugin SDK 0.6.37 and
public bb-app 0.46.0:

- `npm run check`: 12 behavior tests across real SQLite/service, real plugin
  entry/RPC/CLI/script SDK and frontend harness; lint, formatting, typecheck,
  public plugin backend/frontend build all passed.
- `npm run audit`: production dependency graph reports zero vulnerabilities.
- A fresh source copy installed with `--ignore-scripts --omit=dev
  --omit=optional` and built with the pinned public CLI. The reviewed commit was then cloned and built under the same production-only
  flags, without generated files.
- `node scripts/live-smoke.mjs`: fresh-data public server actually loaded the
  plugin; HTTP/RPC/CLI/public SDK, initialization timezone, two Chromium windows,
  per-window refresh, profile signals, ordinary timezone writes and DB retention
  across disable/enable all passed.
- Compact 390×844 Chromium and WebKit passed editor opening/closing and root
  search interaction after closing. This is browser-engine testing, not a
  physical iOS/Android device claim.
- The live job held the shared verification lock for its whole lifetime. The
  script now closes the entire isolated process group; after completion the
  shared verification scope was empty. Production BB was not installed,
  restarted or deployed.
- Backend bundle is about 216 KB; app bundle about 31 KB. The PNG inventory
  remains separate package files and is absent from frontend JavaScript.
- Initial independent review `thr_8j3wywuh7z` identified three P1 defects:
  refreshed forms lost drafts, readable storage overrode failed in-memory
  writes, and URL.pathname broke encoded checkout paths. New regressions
  failed before the relevant fixes. Review `thr_w8h8kbq2bm` and its follow-up
  found no remaining P0/P1 defects, including the SDK scan root conversion.
- Final `npm run check` and production audit passed on reviewed code commit
  `736e9a357c1864e254586a00e24a7662c14351c9`. The full live browser journey
  passed again after the fixes.
- The original build entry failed in a directory containing spaces and CJK;
  the repaired entry succeeded in the same directory. A separate clean Git
  clone in such a directory passed managed production installation/build,
  all five member tests (using this repository's pinned development graph),
  and its own build entry. No BB worktree dependencies were used.

GitHub CI runs against the pushed main commit. Its linked run and final remote
SHA are reported with the delivery, rather than inventing a self-referential
commit hash in this file.

Local full dependency audit currently reports five vulnerabilities inside the
npm 12.2.0 development CLI dependency: brace-expansion, http-cache-semantics,
ip-address, postcss-selector-parser and undici (three high, two moderate).
`npm audit fix` explicitly reports these as bundled dependencies that cannot
be updated automatically. The plugin's production dependency audit is enforced
in CI; the full development audit is also executed as a visible advisory step.
These residual findings are not an audit-clean result and need an upstream npm
bundle update. No BB version downgrade, private runtime dependency or lockfile
removal was used to bypass them.
