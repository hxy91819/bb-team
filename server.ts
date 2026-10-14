import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract, timezoneSchema } from "./src/contracts.js";
import { createMemberService, migrations } from "./src/members.js";
import { runTeamCli, usage } from "./src/cli.js";
import { loadAvatarAssets } from "./src/avatars.js";
export { rpcContract } from "./src/contracts.js";
export default async function plugin(bb: BbPluginApi) {
  const assets = loadAvatarAssets();
  const db = bb.storage.database();
  bb.storage.migrate(db, migrations);
  const members = createMemberService(db, assets, () =>
    bb.realtime.publish("members.changed", null),
  );
  const settings = bb.settings.define({
    timezone: {
      type: "string",
      label: "团队时区",
      description: "IANA timezone; server defaults to UTC when unset.",
      experimental_schema: timezoneSchema,
    },
  });
  settings.onChange(() => bb.realtime.publish("settings.changed", null));
  const timezones = {
    get: async () => ({ timezone: (await settings.get()).timezone ?? "UTC" }),
    set: (timezone: string) =>
      settings
        .experimental_set({ timezone: timezoneSchema.parse(timezone) })
        .then((value) => ({ timezone: value.timezone ?? "UTC" })),
  };
  const avatars = () =>
    assets.map(({ id, name, file, alt, hash }) => ({
      id,
      name,
      file,
      alt,
      url: `/api/v1/plugins/${encodeURIComponent(bb.pluginId)}/http/avatars/${file}?v=${hash}`,
    }));
  for (const avatar of assets) {
    const bytes = avatar.bytes;
    bb.http.route("GET", `/avatars/${avatar.file}`, (context) => {
      const hash = avatar.hash;
      const etag = `"${hash}"`;
      const headers = {
        "Content-Type": "image/png",
        ETag: etag,
        "Cache-Control":
          context.req.query("v") === hash
            ? "public, max-age=31536000, immutable"
            : "no-cache",
        "X-Content-Type-Options": "nosniff",
      };
      return context.req.header("If-None-Match") === etag
        ? new Response(null, { status: 304, headers })
        : new Response(new Uint8Array(bytes), { headers });
    });
  }
  bb.rpc.register(
    rpcContract,
    {
      initialize: (input) => members.initialize(input),
      state: async () => {
        const value = await settings.get();
        return {
          serverScope: members.serverScope,
          adminMemberId: members.admin(),
          timezone: value.timezone ?? "UTC",
          timezoneConfigured: value.timezone !== undefined,
        };
      },
      members_list: (input) => members.list(input),
      members_resolve: (input) => members.resolve(input),
      members_get: (input) => members.get(input.memberId),
      members_create: (input) => members.create(input),
      members_updateSelf: (input) => members.updateSelf(input),
      identity_validate: (input) => members.validate(input.memberId),
      avatars_list: () => avatars(),
      timezone_set: (input) => timezones.set(input.timezone),
    },
    {
      experimental_discoverable: true,
      experimental_description:
        "Trusted team member profiles and identity validation; no thread integration.",
    },
  );
  bb.cli.register({
    name: "team",
    summary: "团队成员与受信身份资料",
    commands: usage
      .split("\n")
      .filter((s) => s.startsWith("bb team"))
      .map((line) => ({
        name: line.split(" ")[2]!,
        summary: line,
        usage: line + " [--json]",
      })),
    run: runTeamCli(members, avatars, timezones),
  });
}
