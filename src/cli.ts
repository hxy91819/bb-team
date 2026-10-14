import { parseArgs } from "node:util";
import type { PluginCliResult } from "@get-bb/plugin-sdk";
import { rpcContract } from "./contracts.js";
import type { createMemberService } from "./members.js";
export const usage =
  "bb team initialize --name NAME [--avatar cat]\nbb team list [--search NAME] [--limit 20] [--cursor ID]\nbb team resolve --name NAME [--limit 10] [--cursor ID]\nbb team get --member ID\nbb team create --actor ADMIN_ID --name NAME [--avatar cat]\nbb team update-self --member ID --name NAME [--avatar cat]\nbb team identity --member ID\nbb team avatars\nbb team timezone [--timezone IANA]\nAll commands accept --json; identity is trusted self-selection, not authentication.";
export function runTeamCli(
  service: ReturnType<typeof createMemberService>,
  avatars: () => unknown,
  timezones: {
    get: () => Promise<{ timezone: string }>;
    set: (timezone: string) => Promise<{ timezone: string }>;
  },
) {
  return async (argv: string[]): Promise<PluginCliResult> => {
    try {
      const { values, positionals } = parseArgs({
        args: argv,
        allowPositionals: true,
        options: {
          name: { type: "string" },
          avatar: { type: "string" },
          actor: { type: "string" },
          member: { type: "string" },
          search: { type: "string" },
          limit: { type: "string" },
          cursor: { type: "string" },
          timezone: { type: "string" },
          json: { type: "boolean" },
          help: { type: "boolean" },
        },
      });
      if (values.help || positionals.length === 0 || positionals[0] === "help")
        return { exitCode: 0, stdout: usage };
      if (positionals.length !== 1) throw Error(usage);
      const profile = {
        displayName: values.name,
        avatarId: values.avatar ?? "cat",
      };
      let result: unknown;
      switch (positionals[0]) {
        case "initialize":
          result = service.initialize(profile);
          break;
        case "list":
          result = service.list({
            search: values.search ?? "",
            limit: values.limit === undefined ? 20 : Number(values.limit),
            cursor: values.cursor ?? null,
          });
          break;
        case "resolve":
          result = service.resolve(
            rpcContract.members_resolve.input.parse({
              name: values.name,
              limit: values.limit === undefined ? 10 : Number(values.limit),
              cursor: values.cursor ?? null,
            }),
          );
          break;
        case "get":
          result = service.get(
            rpcContract.members_get.input.parse({ memberId: values.member })
              .memberId,
          );
          break;
        case "create":
          result = service.create(
            rpcContract.members_create.input.parse({
              ...profile,
              actorMemberId: values.actor,
            }),
          );
          break;
        case "update-self":
          result = service.updateSelf(
            rpcContract.members_updateSelf.input.parse({
              ...profile,
              memberId: values.member,
            }),
          );
          break;
        case "identity":
          result = service.validate(
            rpcContract.identity_validate.input.parse({
              memberId: values.member ?? null,
            }).memberId,
          );
          break;
        case "avatars":
          result = avatars();
          break;
        case "timezone":
          result =
            values.timezone === undefined
              ? await timezones.get()
              : await timezones.set(values.timezone);
          break;
        default:
          throw Error(usage);
      }
      return {
        exitCode: 0,
        stdout: JSON.stringify(result, null, values.json ? undefined : 2),
      };
    } catch (error) {
      return {
        exitCode: 1,
        stderr: error instanceof Error ? error.message : String(error),
      };
    }
  };
}
