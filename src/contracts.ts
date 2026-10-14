import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
export const profileInput = z
  .object({
    displayName: z
      .string()
      .trim()
      .refine(
        (s) => Array.from(s).length >= 1 && Array.from(s).length <= 80,
        "Name must contain 1–80 characters",
      ),
    avatarId: z.string().max(40).default("cat"),
  })
  .strict();
export const memberId = z.string().uuid();
export const memberSchema = z.object({
  memberId,
  displayName: z.string(),
  avatarId: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Member = z.infer<typeof memberSchema>;
export const pageInput = z
  .object({
    search: z.string().trim().max(80).default(""),
    limit: z.number().int().min(1).max(100).default(20),
    cursor: memberId.nullable().default(null),
  })
  .strict();
export const pageSchema = z.object({
  members: z.array(memberSchema),
  nextCursor: memberId.nullable(),
});
export const timezoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return !/^[+-]/.test(value);
    } catch {
      return false;
    }
  }, "Use an IANA timezone (for example UTC or Asia/Shanghai)");
export const rpcContract = defineRpcContract({
  initialize: {
    input: profileInput,
    output: z.discriminatedUnion("status", [
      z.object({ status: z.literal("initialized"), member: memberSchema }),
      z.object({
        status: z.literal("already_initialized"),
        adminMemberId: memberId,
      }),
    ]),
  },
  state: {
    input: z.null(),
    output: z.object({
      serverScope: z.string().uuid(),
      adminMemberId: memberId.nullable(),
      timezone: timezoneSchema,
      timezoneConfigured: z.boolean(),
    }),
  },
  members_list: { input: pageInput, output: pageSchema },
  members_resolve: {
    input: z
      .object({
        name: z.string().trim().min(1).max(80),
        limit: z.number().int().min(1).max(100).default(10),
        cursor: memberId.nullable().default(null),
      })
      .strict(),
    output: z.object({
      status: z.enum(["not_found", "unique", "ambiguous"]),
      members: z.array(memberSchema),
      nextCursor: memberId.nullable(),
    }),
  },
  members_get: {
    input: z.object({ memberId }).strict(),
    output: memberSchema.nullable(),
  },
  members_create: {
    input: profileInput.extend({ actorMemberId: memberId }).strict(),
    output: memberSchema,
  },
  members_updateSelf: {
    input: profileInput.extend({ memberId }).strict(),
    output: memberSchema,
  },
  identity_validate: {
    input: z.object({ memberId: memberId.nullable() }).strict(),
    output: z.object({ valid: z.boolean(), member: memberSchema.nullable() }),
  },
  avatars_list: {
    input: z.null(),
    output: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        file: z.string(),
        alt: z.string(),
        url: z.string(),
      }),
    ),
  },
  timezone_set: {
    input: z.object({ timezone: timezoneSchema }).strict(),
    output: z.object({ timezone: timezoneSchema }),
  },
});
export type TeamContract = typeof rpcContract;

export type Avatar = z.infer<typeof rpcContract.avatars_list.output>[number];
