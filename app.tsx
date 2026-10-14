import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { FormEvent } from "react";
import {
  definePluginApp,
  useBbNavigate,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract, Member, Avatar } from "./src/contracts.js";
import { createIdentityStore } from "./src/identity.js";
import { PersistentResponsiveDrawerShell } from "./components/ui/responsive-overlay.js";
import { useIsCompactViewport } from "./components/ui/hooks/use-compact-viewport.js";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";

type TeamState = {
  adminMemberId: string | null;
  serverScope: string;
  timezone: string;
  timezoneConfigured: boolean;
};
const identities = new Map<string, ReturnType<typeof createIdentityStore>>();
function identityFor(scope: string) {
  let identity = identities.get(scope);
  if (!identity) {
    identity = createIdentityStore(
      scope,
      () => window.localStorage,
      () => window.sessionStorage,
    );
    identities.set(scope, identity);
  }
  return identity;
}
function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
function useTeam() {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<TeamState | null>(null);
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const fetchEpoch = useRef(0);
  const report = useCallback(
    (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    [],
  );
  const refresh = useCallback(() => {
    const epoch = ++fetchEpoch.current;
    setRevision((v) => v + 1);
    void Promise.all([rpc.call("state"), rpc.call("avatars_list")]).then(
      ([next, list]) => {
        if (epoch !== fetchEpoch.current) return;
        setState(next);
        setAvatars(list);
        setError(null);
      },
      (cause) => {
        if (epoch === fetchEpoch.current) report(cause);
      },
    );
  }, [rpc, report]);
  useRealtime("members.changed", refresh);
  useRealtime("settings.changed", refresh);
  const connection = useRealtimeConnectionState();
  useEffect(() => {
    if (connection === "connected") refresh();
  }, [connection, refresh]);
  return { rpc, state, avatars, error, report, refresh, revision };
}
function AvatarImage({
  member,
  avatars,
}: {
  member: Member;
  avatars: Avatar[];
}) {
  const avatar = avatars.find((a) => a.id === member.avatarId);
  return avatar ? (
    <img
      src={avatar.url}
      alt=""
      width={40}
      height={40}
      className="size-10 shrink-0 rounded-full"
    />
  ) : null;
}
function ProfileForm({
  avatars,
  member,
  title,
  submit,
  error,
  active = true,
}: {
  avatars: Avatar[];
  member?: Member;
  title: string;
  submit: (profile: { displayName: string; avatarId: string }) => Promise<void>;
  error?: string | null;
  active?: boolean;
}) {
  const [displayName, setName] = useState(member?.displayName ?? "");
  const [avatarId, setAvatar] = useState(member?.avatarId ?? "cat");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    if (!active) {
      setName(member?.displayName ?? "");
      setAvatar(member?.avatarId ?? "cat");
      setFailure(null);
    }
  }, [active, member]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setFailure(null);
    try {
      await submit({ displayName, avatarId });
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="space-y-4" onSubmit={save}>
      <label className="block space-y-1 text-sm">
        Name
        <Input
          value={displayName}
          onChange={(e) => setName(e.target.value)}
          required
          aria-label={`${title} name`}
        />
      </label>
      <fieldset>
        <legend className="mb-2 text-sm">Avatar</legend>
        <div className="flex flex-wrap gap-2">
          {avatars.map((a) => (
            <button
              key={a.id}
              type="button"
              aria-label={a.name}
              aria-pressed={avatarId === a.id}
              onClick={() => setAvatar(a.id)}
              className={`rounded-full p-1 ring-2 ${avatarId === a.id ? "ring-ring" : "ring-transparent"}`}
            >
              <img
                src={a.url}
                alt={a.alt}
                width={48}
                height={48}
                className="size-12 rounded-full"
              />
            </button>
          ))}
        </div>
      </fieldset>
      {failure || error ? (
        <p role="alert" className="text-sm text-destructive">
          {failure || error}
        </p>
      ) : null}
      <Button
        type="submit"
        disabled={
          pending || !displayName.trim() || [...displayName.trim()].length > 80
        }
      >
        {pending ? "Saving…" : title}
      </Button>
    </form>
  );
}
function IdentityPanel({
  team,
}: {
  team: ReturnType<typeof useTeam> & { state: TeamState };
}) {
  const { rpc, state, avatars, report, revision, refresh } = team;
  const identity = identityFor(
    JSON.stringify([location.origin, state.serverScope]),
  );
  const choice = useSyncExternalStore(identity.subscribe, identity.getSnapshot);
  const [selectedProfile, setSelected] = useState<Member | null>(null);
  const selected =
    selectedProfile?.memberId === choice.memberId ? selectedProfile : null;
  const [invalid, setInvalid] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [search, setSearch] = useState("");
  const [after, setAfter] = useState<string | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [timezone, setTimezone] = useState(state.timezone);
  useEffect(() => setTimezone(state.timezone), [state.timezone]);
  useEffect(() => {
    let active = true;
    setBusy(true);
    void rpc.call("members_list", { search, cursor: after, limit: 20 }).then(
      (page) => {
        if (active) {
          setMembers(page.members);
          setNext(page.nextCursor);
          setBusy(false);
        }
      },
      (cause) => {
        if (active) {
          setBusy(false);
          report(cause);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [rpc, search, after, revision, report]);
  useEffect(() => {
    let active = true;
    setInvalid(false);
    void rpc
      .call("identity_validate", { memberId: choice.memberId })
      .then((value) => {
        if (active) {
          setSelected(value.member);
          setInvalid(!value.valid);
        }
      }, report);
    return () => {
      active = false;
    };
  }, [choice.memberId, rpc, revision, report]);
  const choose = (memberId: string, remember: boolean) => {
    if (remember) identity.select(memberId, true);
    else identity.select(memberId, false);
  };
  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h2 className="text-base font-medium">This window</h2>
        <div className="flex items-center gap-3">
          {selected && <AvatarImage member={selected} avatars={avatars} />}
          <div className="min-w-0">
            <p className="break-words text-sm font-medium">
              {selected?.displayName ??
                (invalid ? "Choose an identity again" : "No identity selected")}
            </p>
            {selected && (
              <p className="break-all font-mono text-xs text-muted-foreground">
                {selected.memberId}
                {selected.memberId === state.adminMemberId
                  ? " · Administrator"
                  : ""}
              </p>
            )}
          </div>
        </div>
        {choice.warning && (
          <p role="alert" className="text-sm text-destructive">
            {choice.warning}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => identity.select(null, false)}
          >
            Clear this window
          </Button>
          <Button variant="outline" onClick={identity.restoreDefault}>
            Restore default
          </Button>
          <Button variant="ghost" onClick={identity.forgetDefault}>
            Forget default
          </Button>
          {selected && (
            <>
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                Edit my profile
              </Button>

              <ProfileEditor
                open={editOpen}
                onOpenChange={setEditOpen}
                title="Edit my profile"
              >
                <p>
                  Update the selected trusted identity, not an authenticated
                  account.
                </p>

                <ProfileForm
                  key={selected.memberId}
                  active={editOpen}
                  member={selected}
                  avatars={avatars}
                  title="Save profile"
                  submit={async (value) => {
                    await rpc.call("members_updateSelf", {
                      ...value,
                      memberId: selected.memberId,
                    });
                    setEditOpen(false);
                    refresh();
                  }}
                />
              </ProfileEditor>
            </>
          )}
        </div>
      </section>
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-medium">Members</h2>
          {selected?.memberId === state.adminMemberId && (
            <>
              <Button onClick={() => setCreateOpen(true)}>Create member</Button>

              <ProfileEditor
                open={createOpen}
                onOpenChange={setCreateOpen}
                title="Create member"
              >
                <p>
                  Only the selected administrator can create a member. Names may
                  be shared.
                </p>

                <ProfileForm
                  avatars={avatars}
                  active={createOpen}
                  title="Create member"
                  submit={async (value) => {
                    await rpc.call("members_create", {
                      ...value,
                      actorMemberId: selected.memberId,
                    });
                    setCreateOpen(false);
                    refresh();
                  }}
                />
              </ProfileEditor>
            </>
          )}
        </div>
        <Input
          aria-label="Search members"
          placeholder="Search members by name…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setAfter(null);
          }}
        />
        <p className="text-xs text-muted-foreground">
          Remember changes the default for future windows. Only this window
          leaves other windows unchanged.
        </p>
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {members.map((member) => (
            <li
              key={member.memberId}
              className="flex flex-wrap items-center gap-3 p-3"
            >
              <AvatarImage member={member} avatars={avatars} />
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-medium">
                  {member.displayName}
                </p>
                <p className="break-all font-mono text-xs text-muted-foreground">
                  {member.memberId}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => choose(member.memberId, false)}
                  aria-label={`Use ${member.displayName} only in this window`}
                >
                  Only this window
                </Button>
                <Button
                  onClick={() => choose(member.memberId, true)}
                  aria-label={`Remember ${member.displayName}`}
                >
                  Remember
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {busy ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading members…
          </p>
        ) : members.length === 0 ? (
          <p role="status" className="text-sm text-muted-foreground">
            No matching members.
          </p>
        ) : null}
        <div className="flex gap-2">
          {after && (
            <Button variant="outline" onClick={() => setAfter(null)}>
              First page
            </Button>
          )}
          {next && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setAfter(next)}
            >
              Next page
            </Button>
          )}
        </div>
      </section>
      <form
        className="space-y-2 border-t border-border pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          void rpc.call("timezone_set", { timezone }).then(refresh, report);
        }}
      >
        <label className="block text-sm">
          Team time zone
          <Input
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            aria-label="Team time zone"
          />
        </label>
        <p className="text-xs text-muted-foreground">
          An ordinary BB plugin setting. Administrator selection is not
          required.
        </p>
        <Button variant="outline">Save time zone</Button>
      </form>
    </div>
  );
}
function TeamPage() {
  const team = useTeam();
  const [timezone, setTimezone] = useState(browserTimezone);
  const initializedTimezone = useRef(false);
  const [timezoneRetry, setTimezoneRetry] = useState<string | null>(null);
  const [initializeNotice, setInitializeNotice] = useState<string | null>(null);
  useEffect(() => {
    if (team.state && !initializedTimezone.current) {
      initializedTimezone.current = true;
      if (team.state.timezoneConfigured) setTimezone(team.state.timezone);
    }
  }, [team.state]);
  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-5">
        <p className="text-sm text-muted-foreground">
          Choose a trusted team identity. This is not login or proof of who
          performed an action. Thread attribution, grouping and activity are not
          connected yet.
        </p>
        {team.error && (
          <p role="alert" className="text-sm text-destructive">
            {team.error}
          </p>
        )}
        {initializeNotice && <p role="status">{initializeNotice}</p>}
        {timezoneRetry && (
          <section className="space-y-2 rounded-lg border border-border p-3">
            <p role="alert" className="text-sm">
              Member created. Time zone was not saved; retry separately.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                void team.rpc
                  .call("timezone_set", { timezone: timezoneRetry })
                  .then(() => {
                    setTimezoneRetry(null);
                    team.refresh();
                  }, team.report);
              }}
            >
              Retry time zone save
            </Button>
          </section>
        )}
        {!team.state ? (
          <p role="status">Loading team…</p>
        ) : team.state.adminMemberId === null ? (
          <section className="space-y-4 rounded-lg border border-border bg-card p-4">
            <h2 className="text-base font-medium">Initialize your team</h2>
            <p className="text-sm text-muted-foreground">
              The first successful initialization creates the only
              administrator.
            </p>
            <label className="block text-sm">
              Team time zone
              <Input
                aria-label="Initial team time zone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              />
            </label>
            <ProfileForm
              avatars={team.avatars}
              title="Initialize team"
              submit={async (profile) => {
                const result = await team.rpc.call("initialize", profile);
                if (result.status === "initialized") {
                  identityFor(
                    JSON.stringify([location.origin, team.state!.serverScope]),
                  ).select(result.member.memberId, true);
                  try {
                    await team.rpc.call("timezone_set", { timezone });
                  } catch {
                    setTimezoneRetry(timezone);
                  }
                } else {
                  setInitializeNotice(
                    "Team already initialized. Choose an existing identity.",
                  );
                }
                team.refresh();
              }}
            />
          </section>
        ) : (
          <IdentityPanel team={{ ...team, state: team.state }} />
        )}
      </div>
    </div>
  );
}
function ProfileEditor({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: import("react").ReactNode;
}) {
  const compact = useIsCompactViewport();
  const content = (
    <div className="space-y-3 p-4">
      <h2 className="text-base font-medium">{title}</h2>
      {children}
      <Button variant="ghost" onClick={() => onOpenChange(false)}>
        Close
      </Button>
    </div>
  );
  return compact ? (
    <PersistentResponsiveDrawerShell
      open={open}
      onOpenChange={onOpenChange}
      srLabel={title}
      contentClassName="bg-background text-foreground"
    >
      {content}
    </PersistentResponsiveDrawerShell>
  ) : open ? (
    <section className="w-full rounded-lg border border-border bg-card">
      {content}
    </section>
  ) : null;
}
function Footer() {
  const navigate = useBbNavigate();
  return (
    <div className="space-y-3 p-3 text-sm">
      <p>Choose or edit your trusted team identity.</p>
      <Button onClick={() => navigate.toPluginPanel("members")}>
        Open team members
      </Button>
    </div>
  );
}
export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "members",
    title: "Team",
    icon: "Users",
    path: "members",
    component: TeamPage,
  });
  app.slots.settingsSection({
    id: "members",
    title: "Team members",
    component: TeamPage,
  });
  app.experimental_sidebarFooter.register({
    id: "identity",
    kind: "disclosure",
    label: "Team identity",
    icon: "Users",
    component: Footer,
  });
});
