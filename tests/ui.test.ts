// @vitest-environment jsdom
import { test, expect } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server.js";
import { rpcContract } from "../src/contracts.js";
async function setup() {
  const { bb, harness } = createFakePluginHost({ pluginId: "team" });
  await plugin(bb);
  const app = await loadPluginApp(() => import("../app.js"));
  const slot = renderSlot(
    app.navPanels[0]!,
    { subPath: "" },
    {
      pluginId: "team",
      rpc: {
        state: async () =>
          rpcContract.state.output.parse(
            await harness.behavior.callRpc("state"),
          ),
        avatars_list: async () =>
          rpcContract.avatars_list.output.parse(
            await harness.behavior.callRpc("avatars_list"),
          ),
        initialize: async (input) =>
          rpcContract.initialize.output.parse(
            await harness.behavior.callRpc("initialize", input),
          ),
        members_list: async (input) =>
          rpcContract.members_list.output.parse(
            await harness.behavior.callRpc("members_list", input),
          ),
        identity_validate: async (input) =>
          rpcContract.identity_validate.output.parse(
            await harness.behavior.callRpc("identity_validate", input),
          ),
        members_create: async (input) =>
          rpcContract.members_create.output.parse(
            await harness.behavior.callRpc("members_create", input),
          ),
        members_updateSelf: async (input) =>
          rpcContract.members_updateSelf.output.parse(
            await harness.behavior.callRpc("members_updateSelf", input),
          ),
        timezone_set: async (input) =>
          rpcContract.timezone_set.output.parse(
            await harness.behavior.callRpc("timezone_set", input),
          ),
      },
    },
  );
  return { harness, slot };
}
test("initialization preserves its member when timezone save fails and offers an independent retry", async () => {
  const { harness, slot } = await setup();
  try {
    fireEvent.change(await slot.findByLabelText("Initial team time zone"), {
      target: { value: "Invalid/Timezone" },
    });
    fireEvent.change(slot.getByLabelText("Initialize team name"), {
      target: { value: "Admin" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Initialize team" }));
    await slot.findByText(
      "Member created. Time zone was not saved; retry separately.",
    );
    expect(
      rpcContract.members_list.output.parse(
        await harness.behavior.callRpc("members_list", {}),
      ).members,
    ).toHaveLength(1);
    expect(
      rpcContract.state.output.parse(await harness.behavior.callRpc("state"))
        .timezone,
    ).toBe("UTC");
  } finally {
    slot.lifecycle.unmount();
    await harness.lifecycle.dispose();
  }
});
test("member profile changes refresh after signals and reconnect with stable identity", async () => {
  const { harness, slot } = await setup();
  try {
    fireEvent.change(await slot.findByLabelText("Initialize team name"), {
      target: { value: "Admin" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Initialize team" }));
    await slot.findByRole("button", { name: "Remember Admin" });
    const first = rpcContract.members_list.output.parse(
      await harness.behavior.callRpc("members_list", {}),
    ).members[0]!;
    await harness.behavior.callRpc("members_updateSelf", {
      memberId: first.memberId,
      displayName: "Updated",
      avatarId: "fox",
    });
    await slot.behavior.emitRealtime("members.changed", null);
    await slot.findByRole("button", { name: "Remember Updated" });
    await slot.behavior.setRealtimeConnectionState("reconnecting");
    await harness.behavior.callRpc("members_updateSelf", {
      memberId: first.memberId,
      displayName: "Reconnected",
      avatarId: "owl",
    });
    await slot.behavior.setRealtimeConnectionState("connected");
    await slot.findByRole("button", { name: "Remember Reconnected" });
    await waitFor(() =>
      expect(
        slot.getByRole("button", { name: "Edit my profile" }),
      ).toBeDefined(),
    );
  } finally {
    slot.lifecycle.unmount();
    await harness.lifecycle.dispose();
  }
});

test("losing initialization does not save its timezone or create another member", async () => {
  const { harness, slot } = await setup();
  try {
    fireEvent.change(await slot.findByLabelText("Initial team time zone"), {
      target: { value: "Asia/Shanghai" },
    });
    fireEvent.change(slot.getByLabelText("Initialize team name"), {
      target: { value: "Losing initializer" },
    });
    await harness.behavior.callRpc("initialize", { displayName: "Winner" });
    fireEvent.click(slot.getByRole("button", { name: "Initialize team" }));
    await slot.findByText(
      "Team already initialized. Choose an existing identity.",
    );
    expect(
      rpcContract.state.output.parse(await harness.behavior.callRpc("state"))
        .timezone,
    ).toBe("UTC");
    expect(
      rpcContract.members_list.output
        .parse(await harness.behavior.callRpc("members_list", {}))
        .members.map((m) => m.displayName),
    ).toEqual(["Winner"]);
  } finally {
    slot.lifecycle.unmount();
    await harness.lifecycle.dispose();
  }
});

test("editing and creation drafts survive member signals, settings signals and reconnect", async () => {
  const { harness, slot } = await setup();
  try {
    fireEvent.change(await slot.findByLabelText("Initialize team name"), {
      target: { value: "Admin" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Initialize team" }));
    fireEvent.click(
      await slot.findByRole("button", { name: "Edit my profile" }),
    );
    fireEvent.change(slot.getByLabelText("Save profile name"), {
      target: { value: "Unsaved profile" },
    });
    fireEvent.click(slot.getByRole("button", { name: "狐狸" }));
    const current = rpcContract.members_list.output.parse(
      await harness.behavior.callRpc("members_list", {}),
    ).members[0]!;
    await harness.behavior.callRpc("members_updateSelf", {
      memberId: current.memberId,
      displayName: "Changed elsewhere",
      avatarId: "owl",
    });
    await slot.behavior.emitRealtime("members.changed", null);
    await slot.behavior.emitRealtime("settings.changed", null);
    await slot.behavior.setRealtimeConnectionState("reconnecting");
    await slot.behavior.setRealtimeConnectionState("connected");
    await waitFor(() =>
      expect(
        (slot.getByLabelText("Save profile name") as HTMLInputElement).value,
      ).toBe("Unsaved profile"),
    );
    expect(
      slot.getByRole("button", { name: "狐狸" }).getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(slot.getByRole("button", { name: "Close" }));
    fireEvent.click(slot.getByRole("button", { name: "Create member" }));
    fireEvent.change(slot.getByLabelText("Create member name"), {
      target: { value: "Unsaved new member" },
    });
    await slot.behavior.emitRealtime("members.changed", null);
    await waitFor(() =>
      expect(
        (slot.getByLabelText("Create member name") as HTMLInputElement).value,
      ).toBe("Unsaved new member"),
    );
  } finally {
    slot.lifecycle.unmount();
    await harness.lifecycle.dispose();
  }
});
