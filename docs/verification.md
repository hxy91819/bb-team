# Member baseline verification

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
