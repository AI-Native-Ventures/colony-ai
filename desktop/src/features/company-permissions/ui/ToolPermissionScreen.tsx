import * as React from "react";
import { Link, useNavigate } from "@tanstack/react-router";

import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useClientDirectoryQuery } from "@/features/clients/useBusinessRecords";
import { Button } from "@/shared/ui/button";
import { GoalRouteHeader } from "@/features/goals/ui/GoalRouteHeader";

import {
  resolveToolPermissionScope,
  resolveToolPermissionAction,
  toolPermissionActionLabel,
  toolPermissionScopeLabel,
  toolPermissionState,
  type ToolPermissionAction,
  type ToolPermissionRecord,
  type ToolPermissionScope,
} from "../toolPermissions";
import {
  useToolPermissionActionMutation,
  useToolPermissionsQuery,
} from "../toolPermissionsRelay";

type PermissionScreenMode = "detail" | "grant" | "edit" | "revoke";

function PermissionAccessState({ message }: { message: string }) {
  return (
    <section className="mx-auto w-full max-w-[1230px] px-8 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">
        Permission unavailable
      </h1>
      <p className="mt-5 text-sm text-muted-foreground">{message}</p>
      <Button asChild className="mt-5" variant="outline">
        <Link search={{}} to="/agents">
          Back to agents
        </Link>
      </Button>
    </section>
  );
}

function scopeText(
  scope: ToolPermissionScope,
  channels: readonly { id: string; name: string }[],
  customers: readonly { clientId: string; displayName: string }[],
) {
  if (scope.kind === "thread") return `thread:${scope.id}`;
  if (scope.kind === "channel") {
    const channel = channels.find(
      (candidate) => candidate.id.toLowerCase() === scope.id,
    );
    return channel ? `#${channel.name}` : `channel:${scope.id}`;
  }
  const customer = customers.find(
    (candidate) => candidate.clientId.toLowerCase() === scope.id,
  );
  return customer?.displayName ?? `customer:${scope.id}`;
}

function PermissionRouteBack({ agentPubkey }: { agentPubkey?: string }) {
  return (
    <Link
      className="mb-5 inline-flex items-center gap-1 pt-4 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      search={
        agentPubkey ? { agent: agentPubkey, agentTab: "tools-access" } : {}
      }
      to="/agents"
    >
      <span aria-hidden="true">‹</span> Back to Tools & access
    </Link>
  );
}

export function ToolPermissionScreen({
  mode,
  permissionId,
  agentPubkey: routeAgentPubkey,
}: {
  mode: PermissionScreenMode;
  permissionId?: string;
  agentPubkey?: string;
}) {
  const membershipQuery = useMyRelayMembershipQuery();
  const permissionsQuery = useToolPermissionsQuery();
  const channelsQuery = useChannelsQuery();
  const clientsQuery = useClientDirectoryQuery();
  const mutation = useToolPermissionActionMutation();
  const navigate = useNavigate();
  const [action, setAction] = React.useState("");
  const [scopeInput, setScopeInput] = React.useState("");
  const [expires, setExpires] = React.useState("");
  const [confirmed, setConfirmed] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const authorized =
    membershipQuery.data?.role === "owner" ||
    membershipQuery.data?.role === "admin";
  const existing = permissionsQuery.data?.find(
    (record) => record.head.permissionId === permissionId,
  );
  const record = existing?.head.permission;
  const channels = React.useMemo(
    () => (channelsQuery.data ?? []).map(({ id, name }) => ({ id, name })),
    [channelsQuery.data],
  );
  const customers = React.useMemo(
    () =>
      (clientsQuery.data ?? []).map(({ value }) => ({
        clientId: value.clientId,
        displayName: value.displayName,
      })),
    [clientsQuery.data],
  );

  React.useEffect(() => {
    if (!record || mode !== "edit") return;
    setAction(toolPermissionActionLabel(record.action));
    setScopeInput(scopeText(record.scope, channels, customers));
    setExpires(record.expiresAt.slice(0, 10));
  }, [channels, customers, mode, record]);

  const title =
    mode === "detail"
      ? "Standing permission"
      : mode === "grant"
        ? "Grant scoped permission"
        : mode === "edit"
          ? "Edit standing permission"
          : "Revoke standing permission?";
  const scope = record
    ? toolPermissionScopeLabel(record.scope, { channels, customers })
    : null;
  const state = existing ? toolPermissionState(existing) : null;
  const agentPubkey = record?.agentPubkey ?? routeAgentPubkey;

  const unavailable =
    membershipQuery.isError ||
    permissionsQuery.isError ||
    (mode !== "grant" && permissionsQuery.isSuccess && !existing) ||
    ((mode === "grant" || mode === "edit") &&
      (channelsQuery.isError || clientsQuery.isError));
  const loading =
    membershipQuery.isPending ||
    permissionsQuery.isPending ||
    ((mode === "grant" || mode === "edit") &&
      (channelsQuery.isPending || clientsQuery.isPending));

  const perform = async () => {
    if (!authorized || !existing || !record || mutation.isPending) return;
    setError(null);
    const command: ToolPermissionAction = {
      schemaVersion: 1,
      permissionId: record.permissionId,
      action: "revoke",
      expectedHeadEventId: existing.event.id,
      reason: "Revoked from the company permission screen.",
    };
    try {
      await mutation.mutateAsync({ action: command });
      await navigate({
        to: "/permission/$",
        params: { _splat: record.permissionId },
        search: { agent: record.agentPubkey },
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The permission was not revoked. Try again.",
      );
    }
  };

  const submitForm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!authorized || mutation.isPending) return;
    setError(null);
    const targetScope = resolveToolPermissionScope(scopeInput, {
      channels,
      customers,
    });
    if (!targetScope) {
      setError(
        "Enter one existing channel, customer or thread as the exact scope.",
      );
      return;
    }
    if (!action.trim()) {
      setError("Enter the exact action this permission covers.");
      return;
    }
    const targetAction = resolveToolPermissionAction(action);
    if (!targetAction) {
      setError("Enter one of the four sensitive actions.");
      return;
    }
    const targetAgent = record?.agentPubkey ?? routeAgentPubkey;
    if (!targetAgent) {
      setError(
        "Open Tools & access for an employee before granting permission.",
      );
      return;
    }
    const expiryDate = new Date(`${expires}T23:59:59.000Z`);
    if (
      !Number.isFinite(expiryDate.getTime()) ||
      expiryDate.getTime() <= Date.now()
    ) {
      setError("Choose an expiry date in the future.");
      return;
    }
    const permission: ToolPermissionRecord = {
      schemaVersion: 1,
      permissionId: record?.permissionId ?? crypto.randomUUID(),
      agentPubkey: targetAgent.toLowerCase(),
      action: targetAction,
      scope: targetScope,
      expiresAt: expiryDate.toISOString(),
    };
    const command: ToolPermissionAction = {
      schemaVersion: 1,
      permissionId: permission.permissionId,
      action: mode === "edit" ? "update" : "grant",
      ...(existing ? { expectedHeadEventId: existing.event.id } : {}),
      permission,
    };
    try {
      await mutation.mutateAsync({ action: command });
      await navigate({
        to: "/permission/$",
        params: { _splat: permission.permissionId },
        search: { agent: permission.agentPubkey },
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The permission was not saved. Your entries are kept; try again.",
      );
    }
  };

  return (
    <>
      <GoalRouteHeader title={title} />
      <section
        className="mx-auto w-full max-w-[1230px] px-8 pb-8 pt-7"
        data-testid="permission-screen"
      >
        <PermissionRouteBack agentPubkey={agentPubkey} />
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {loading ? (
          <p className="mt-6 text-sm text-muted-foreground" role="status">
            Loading permission
          </p>
        ) : unavailable ? (
          <div className="mt-6">
            <PermissionAccessState message="Permission details or authority could not be verified. Try again after the relay is available." />
          </div>
        ) : !authorized ? (
          <div className="mt-6">
            <PermissionAccessState message="Only company owners and admins can manage standing permissions." />
          </div>
        ) : mode !== "grant" && !existing ? (
          <p className="mt-6 text-sm text-muted-foreground" role="status">
            This permission is unavailable in the current community.
          </p>
        ) : mode === "detail" && existing && record ? (
          <div className="mt-8" data-testid="permission-detail">
            <h2 className="mb-7 text-base font-semibold">
              {toolPermissionActionLabel(record.action)}
            </h2>
            <dl className="mb-6 grid grid-cols-2 gap-x-5">
              <dt className="border-b border-border py-3.5 text-xs text-muted-foreground">
                Scope
              </dt>
              <dd className="border-b border-border py-3.5 text-xs font-semibold">
                {scope}
              </dd>
              <dt className="border-b border-border py-3.5 text-xs text-muted-foreground">
                Expires
              </dt>
              <dd className="border-b border-border py-3.5 text-xs font-semibold">
                {record.expiresAt.slice(0, 10)}
              </dd>
              <dt className="border-b border-border py-3.5 text-xs text-muted-foreground">
                State
              </dt>
              <dd className="border-b border-border py-3.5 text-xs font-semibold">
                {state}
              </dd>
            </dl>
            {state === "Active" ? (
              <div className="mt-8 flex flex-wrap gap-3">
                <Button asChild variant="outline">
                  <Link
                    params={{ _splat: `${record.permissionId}/edit` }}
                    search={{ agent: record.agentPubkey }}
                    to="/permission/$"
                  >
                    Edit scope
                  </Link>
                </Button>
                <Button asChild variant="destructive">
                  <Link
                    params={{ _splat: `${record.permissionId}/revoke` }}
                    search={{ agent: record.agentPubkey }}
                    to="/permission/$"
                  >
                    Revoke permission
                  </Link>
                </Button>
              </div>
            ) : null}
          </div>
        ) : mode === "revoke" && existing ? (
          <div className="mt-8" data-testid="permission-revoke-confirmation">
            <h2 className="mb-7 text-base font-semibold">
              {toolPermissionActionLabel(existing.head.permission.action)}
            </h2>
            <dl className="mb-6 grid grid-cols-2 gap-x-5">
              <dt className="border-b border-border py-3.5 text-xs text-muted-foreground">
                Scope
              </dt>
              <dd className="border-b border-border py-3.5 text-xs font-semibold">
                {toolPermissionScopeLabel(existing.head.permission.scope, {
                  channels,
                  customers,
                })}
              </dd>
              <dt className="border-b border-border py-3.5 text-xs text-muted-foreground">
                Expires
              </dt>
              <dd className="border-b border-border py-3.5 text-xs font-semibold">
                {existing.head.permission.expiresAt.slice(0, 10)}
              </dd>
              <dt className="border-b border-border py-3.5 text-xs text-muted-foreground">
                State
              </dt>
              <dd className="border-b border-border py-3.5 text-xs font-semibold">
                {toolPermissionState(existing)}
              </dd>
            </dl>
            <p className="my-5 border-l-2 border-border bg-muted px-4 py-4 text-xs">
              Future actions covered by this grant will need approval again.
              Past activity remains in history.
            </p>
            {error ? (
              <p className="mt-4 text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <Button
                disabled={mutation.isPending}
                onClick={() => void perform()}
                variant="destructive"
              >
                {mutation.isPending ? "Revoking…" : "Revoke permission"}
              </Button>
              <Button asChild variant="outline">
                <Link
                  params={{ _splat: existing.head.permissionId }}
                  search={{ agent: existing.head.permission.agentPubkey }}
                  to="/permission/$"
                >
                  Cancel
                </Link>
              </Button>
            </div>
          </div>
        ) : mode === "grant" || mode === "edit" ? (
          <form
            className="mt-8 grid max-w-[740px] gap-5"
            data-testid="permission-form"
            onSubmit={(event) => void submitForm(event)}
          >
            <label
              className="grid gap-2 text-xs font-semibold"
              htmlFor="permission-action"
            >
              Allowed action
              <input
                autoComplete="off"
                className="h-[42px] rounded-md border border-input bg-background px-3 text-sm font-normal"
                id="permission-action"
                maxLength={180}
                onChange={(event) => setAction(event.target.value)}
                readOnly={mode === "edit"}
                required
                value={action}
              />
            </label>
            <label
              className="grid gap-2 text-xs font-semibold"
              htmlFor="permission-scope"
            >
              Exact scope and limits
              <textarea
                className="min-h-[84px] rounded-md border border-input bg-background px-3 py-2 text-sm font-normal"
                id="permission-scope"
                maxLength={500}
                onChange={(event) => setScopeInput(event.target.value)}
                placeholder="Which resources, actions and limits are covered?"
                required
                value={scopeInput}
              />
            </label>
            <label
              className="grid gap-2 text-xs font-semibold"
              htmlFor="permission-expires"
            >
              Expires
              <input
                className="h-[42px] w-full rounded-md border border-input bg-background px-3 text-sm font-normal"
                id="permission-expires"
                min={new Date(Date.now() + 86_400_000)
                  .toISOString()
                  .slice(0, 10)}
                onChange={(event) => setExpires(event.target.value)}
                required
                type="date"
                value={expires}
              />
            </label>
            <label
              className="flex items-start gap-3 border-b border-border px-1 py-4 text-sm"
              htmlFor="permission-confirm"
            >
              <input
                checked={confirmed}
                className="mt-1 size-4"
                id="permission-confirm"
                onChange={(event) => setConfirmed(event.target.checked)}
                required
                type="checkbox"
              />
              <span>
                As Lerato, I approve only this action and scope until the expiry
                date.
              </span>
            </label>
            <p className="my-3 text-xs leading-6 text-muted-foreground">
              Anything outside this grant still requires a new approval. The
              grant can be revoked at any time.
            </p>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-3 border-t border-border pt-5">
              <Button disabled={!confirmed || mutation.isPending} type="submit">
                {mutation.isPending ? "Saving…" : "Confirm permission"}
              </Button>
              {mode === "edit" && permissionId ? (
                <Button asChild variant="outline">
                  <Link
                    params={{ _splat: permissionId }}
                    search={{ agent: agentPubkey }}
                    to="/permission/$"
                  >
                    Cancel
                  </Link>
                </Button>
              ) : (
                <Button asChild variant="outline">
                  <Link
                    search={{ agent: agentPubkey, agentTab: "tools-access" }}
                    to="/agents"
                  >
                    Cancel
                  </Link>
                </Button>
              )}
            </div>
          </form>
        ) : null}
      </section>
    </>
  );
}

export function ToolPermissionList({ agentPubkey }: { agentPubkey: string }) {
  const permissionsQuery = useToolPermissionsQuery(agentPubkey);
  const channelsQuery = useChannelsQuery();
  const clientsQuery = useClientDirectoryQuery();
  const membershipQuery = useMyRelayMembershipQuery();
  const permissions = permissionsQuery.data ?? [];
  const resources = React.useMemo(
    () => ({
      channels: (channelsQuery.data ?? []).map(({ id, name }) => ({
        id,
        name,
      })),
      customers: (clientsQuery.data ?? []).map(({ value }) => ({
        clientId: value.clientId,
        displayName: value.displayName,
      })),
    }),
    [channelsQuery.data, clientsQuery.data],
  );
  const canManage =
    membershipQuery.data?.role === "owner" ||
    membershipQuery.data?.role === "admin";

  return (
    <section className="mt-5" data-testid="standing-permissions">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Standing permissions</h2>
        {canManage ? (
          <Button asChild size="sm" variant="outline">
            <Link
              params={{ _splat: "new" }}
              search={{ agent: agentPubkey }}
              to="/permission/$"
            >
              Grant permission
            </Link>
          </Button>
        ) : null}
      </div>
      {permissionsQuery.isPending ? (
        <p className="mt-3 text-sm text-muted-foreground" role="status">
          Loading permissions
        </p>
      ) : permissionsQuery.isError ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          Standing permissions could not be loaded.
        </p>
      ) : permissions.length === 0 ? null : (
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
          {permissions.map((record) => {
            const permission = record.head.permission;
            const label = toolPermissionActionLabel(permission.action);
            const status = toolPermissionState(record);
            return (
              <li key={record.head.permissionId}>
                <Link
                  className="flex min-h-12 items-center justify-between gap-4 px-4 py-3 text-sm hover:bg-accent/50"
                  params={{ _splat: record.head.permissionId }}
                  search={{ agent: agentPubkey }}
                  to="/permission/$"
                >
                  <span className="min-w-0 truncate font-medium">
                    {label} · {status}
                  </span>
                  <span className="sr-only">
                    {toolPermissionScopeLabel(permission.scope, resources)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
