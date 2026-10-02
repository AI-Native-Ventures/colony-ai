import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, KeyRound } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import { useRelaySelfQuery } from "@/features/moderation/hooks";
import { useIdentityQuery } from "@/shared/api/hooks";
import { invokeTauri } from "@/shared/api/tauri";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  activateSecretBinding,
  createSecretBinding,
  fetchSecretAsk,
  fetchSecretBindings,
  revokeSecretBinding,
  type SecretBindingRecord,
  type SecretBindingSpec,
} from "../secretBindings";
import {
  GoalRouteBackLink,
  GoalRouteHeader,
} from "@/features/goals/ui/GoalRouteHeader";

export type SecretRouteState =
  | "list"
  | "empty"
  | "loading"
  | "unavailable"
  | "denied"
  | "request"
  | "entry"
  | "device"
  | "server"
  | "failed"
  | "saved"
  | "revoke"
  | "revoked";

const SECRET_BINDINGS_QUERY_KEY = ["company-secret-bindings"] as const;

function isCompanyAdmin(role: string | undefined) {
  return role === "owner" || role === "admin";
}

function StateMessage({
  children,
  role = "status",
}: {
  children: React.ReactNode;
  role?: "alert" | "status";
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
      <span className="flex size-14 items-center justify-center rounded-xl bg-secondary text-secondary-foreground">
        <KeyRound aria-hidden="true" className="size-6" />
      </span>
      <p className="max-w-md text-sm text-muted-foreground" role={role}>
        {children}
      </p>
    </div>
  );
}

function CredentialStoreUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-[440px] flex-col items-center justify-center gap-3 text-center">
      <span className="flex size-14 items-center justify-center rounded-xl bg-secondary text-secondary-foreground">
        <KeyRound aria-hidden="true" className="size-6" />
      </span>
      <h1 className="text-base font-semibold">Credential store unavailable</h1>
      <p className="max-w-md text-sm text-muted-foreground" role="alert">
        Names and bindings could not be loaded. No secret values are exposed.
      </p>
      <Button className="mt-3" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function BindingRow({
  record,
  employee,
  onOpen,
}: {
  record: SecretBindingRecord;
  employee: string;
  onOpen: () => void;
}) {
  const { binding } = record.head;
  const status = record.head.status === "active" ? "Bound" : record.head.status;
  const location =
    binding.storage === "device" ? "This device" : "Server storage";
  return (
    <button
      aria-label={
        record.head.status === "revoked"
          ? `Binding ${binding.name} is revoked`
          : `Review and revoke binding ${binding.name}`
      }
      className="flex w-full items-center gap-4 border-b border-border px-3 py-4 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid={`secret-binding-${binding.bindingId}`}
      disabled={record.head.status === "revoked"}
      onClick={onOpen}
      type="button"
    >
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-sm font-medium text-secondary-foreground"
      >
        {binding.name.slice(0, 1).toLocaleUpperCase() || "•"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">
          {binding.name}
        </span>
        <span className="mt-1 block truncate text-xs text-muted-foreground">
          {employee} · {binding.toolName} · {location}
        </span>
      </span>
      <span className="inline-flex rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">
        {status}
      </span>
      <ArrowUpRight
        aria-hidden="true"
        className="size-4 text-muted-foreground"
      />
    </button>
  );
}

export function SecretBindingsScreen({
  state,
  channelId,
  askId,
  bindingId,
}: {
  state: SecretRouteState;
  channelId: string | null;
  askId: string | null;
  bindingId: string | null;
}) {
  const navigate = useNavigate();
  const raiseAsk = React.useCallback(() => {
    void navigate({
      to: "/asks/new",
      search: { channelId: null, threadRootEventId: null },
    });
  }, [navigate]);
  const queryClient = useQueryClient();
  const identityQuery = useIdentityQuery();
  const membershipQuery = useMyRelayMembershipQuery();
  const relaySelfQuery = useRelaySelfQuery();
  const canManage = isCompanyAdmin(membershipQuery.data?.role);
  const relaySelfPubkey = relaySelfQuery.data ?? null;
  const currentPubkey = identityQuery.data?.pubkey ?? "";
  const bindingsQuery = useQuery({
    queryKey: [...SECRET_BINDINGS_QUERY_KEY, relaySelfPubkey],
    queryFn: () => {
      if (!relaySelfPubkey)
        throw new Error("The relay identity is unavailable.");
      return fetchSecretBindings(relaySelfPubkey);
    },
    enabled: canManage && Boolean(relaySelfPubkey),
    staleTime: 10_000,
  });
  const askQuery = useQuery({
    queryKey: ["company-secret-ask", channelId, askId, relaySelfPubkey],
    queryFn: () => {
      if (!channelId || !askId || !relaySelfPubkey) {
        throw new Error("The secret request is unavailable.");
      }
      return fetchSecretAsk(channelId, askId, relaySelfPubkey);
    },
    enabled:
      ["request", "entry", "device", "server", "failed", "saved"].includes(
        state,
      ) && Boolean(channelId && askId && relaySelfPubkey),
    staleTime: 5_000,
  });
  const [connectionName, setConnectionName] = React.useState("");
  const [credential, setCredential] = React.useState("");
  const [formError, setFormError] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isRevoking, setIsRevoking] = React.useState(false);
  const ask = askQuery.data;
  const secretRequest = ask?.head.ask.secretRequest;
  const linkedBinding = bindingsQuery.data?.find(
    (record) =>
      record.head.binding.sourceAsk?.channelId === channelId &&
      record.head.binding.sourceAsk.askId === askId,
  );
  const selectedBinding =
    bindingsQuery.data?.find(
      (record) => record.head.binding.bindingId === bindingId,
    ) ?? linkedBinding;
  const employeePubkeys = React.useMemo(
    () => [
      ...new Set([
        ...(bindingsQuery.data ?? []).map(
          (record) => record.head.binding.employeePubkey,
        ),
        ...(ask ? [ask.head.askerPubkey] : []),
      ]),
    ],
    [ask, bindingsQuery.data],
  );
  const profilesQuery = useUsersBatchQuery(employeePubkeys, {
    enabled: employeePubkeys.length > 0,
  });

  const navigateTo = React.useCallback(
    (nextState: SecretRouteState, nextBindingId?: string) => {
      void navigate({
        to: "/secrets",
        search: {
          state: nextState,
          channelId,
          askId,
          bindingId: nextBindingId ?? bindingId,
        },
      });
    },
    [askId, bindingId, channelId, navigate],
  );

  const backToRequest = React.useCallback(() => {
    if (channelId && askId) {
      navigateTo("request");
    } else {
      navigateTo("list");
    }
  }, [askId, channelId, navigateTo]);

  const cancelEntry = React.useCallback(() => {
    setCredential("");
    setFormError(null);
    backToRequest();
  }, [backToRequest]);

  const refreshBindings = React.useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: SECRET_BINDINGS_QUERY_KEY,
    });
  }, [queryClient]);

  const saveBinding = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      isSaving ||
      !canManage ||
      !relaySelfPubkey ||
      !channelId ||
      !askId ||
      !secretRequest
    ) {
      return;
    }
    const name = connectionName.trim();
    if (!name || !credential) {
      setFormError("Add a connection name and credential.");
      return;
    }
    setIsSaving(true);
    setFormError(null);
    let attemptedBindingId: string | null = null;
    let deviceWriteSucceeded = false;
    try {
      let current = linkedBinding;
      if (!current) {
        const latest = await fetchSecretBindings(relaySelfPubkey);
        queryClient.setQueryData(
          [...SECRET_BINDINGS_QUERY_KEY, relaySelfPubkey],
          latest,
        );
        current = latest.find(
          (record) =>
            record.head.binding.sourceAsk?.channelId === channelId &&
            record.head.binding.sourceAsk.askId === askId,
        );
      }
      if (current?.head.status === "active") {
        setCredential("");
        navigateTo("saved", current.head.binding.bindingId);
        return;
      }
      if (!current) {
        const binding: SecretBindingSpec = {
          schemaVersion: 1,
          bindingId: crypto.randomUUID(),
          name,
          employeePubkey: ask.head.askerPubkey,
          toolName: secretRequest.toolName,
          allowedUse: secretRequest.allowedUse,
          storage: "device",
          sourceAsk: { channelId, askId },
        };
        attemptedBindingId = binding.bindingId;
        await createSecretBinding(binding);
        const refreshed = await fetchSecretBindings(relaySelfPubkey);
        queryClient.setQueryData(
          [...SECRET_BINDINGS_QUERY_KEY, relaySelfPubkey],
          refreshed,
        );
        current = refreshed.find(
          (record) => record.head.binding.bindingId === binding.bindingId,
        );
      }
      if (current?.head.status !== "pending") {
        throw new Error("The binding could not be prepared.");
      }
      attemptedBindingId = current.head.binding.bindingId;
      await invokeTauri<void>("store_company_secret", {
        relayPubkey: relaySelfPubkey,
        bindingId: current.head.binding.bindingId,
        secretValue: credential,
      });
      deviceWriteSucceeded = true;
      await activateSecretBinding(
        current.head.binding.bindingId,
        current.event.id,
      );
      await refreshBindings();
      setCredential("");
      navigateTo("saved", current.head.binding.bindingId);
    } catch {
      let failureMessage =
        "Binding failed. Re-enter the credential and retry. Non-secret fields are kept.";
      if (attemptedBindingId) {
        try {
          const latest = await fetchSecretBindings(relaySelfPubkey);
          queryClient.setQueryData(
            [...SECRET_BINDINGS_QUERY_KEY, relaySelfPubkey],
            latest,
          );
          const latestBinding = latest.find(
            (record) => record.head.binding.bindingId === attemptedBindingId,
          );
          if (deviceWriteSucceeded && latestBinding?.head.status === "active") {
            setCredential("");
            navigateTo("saved", attemptedBindingId);
            return;
          }
          if (latestBinding?.head.status !== "active") {
            await invokeTauri<void>("delete_company_secret", {
              relayPubkey: relaySelfPubkey,
              bindingId: attemptedBindingId,
            });
            failureMessage =
              "No value was saved. Re-enter the credential and retry. Non-secret fields are kept.";
          }
        } catch {
          failureMessage =
            "Binding failed. Re-enter the credential and retry. Non-secret fields are kept.";
        }
      }
      setCredential("");
      setFormError(failureMessage);
      await refreshBindings();
      navigateTo(
        "failed",
        attemptedBindingId ?? linkedBinding?.head.binding.bindingId,
      );
    } finally {
      setIsSaving(false);
    }
  };

  const revokeBinding = async () => {
    if (!selectedBinding || !canManage || isRevoking) return;
    setIsRevoking(true);
    setFormError(null);
    try {
      await revokeSecretBinding(
        selectedBinding.head.binding.bindingId,
        selectedBinding.event.id,
      );
      await refreshBindings();
      navigateTo("revoked", selectedBinding.head.binding.bindingId);
    } catch {
      setFormError("The binding could not be revoked. Try again.");
    } finally {
      setIsRevoking(false);
    }
  };

  const selectedEmployee = selectedBinding
    ? resolveUserLabel({
        currentPubkey,
        profiles: profilesQuery.data?.profiles,
        pubkey: selectedBinding.head.binding.employeePubkey,
        preferResolvedSelfLabel: true,
      })
    : "";
  const rows = (bindingsQuery.data ?? []).map((record) => {
    const employee = resolveUserLabel({
      currentPubkey,
      profiles: profilesQuery.data?.profiles,
      pubkey: record.head.binding.employeePubkey,
      preferResolvedSelfLabel: true,
    });
    return (
      <BindingRow
        employee={employee}
        key={record.head.binding.bindingId}
        onOpen={() => navigateTo("revoke", record.head.binding.bindingId)}
        record={record}
      />
    );
  });

  if (state === "loading") {
    return (
      <>
        <GoalRouteHeader title="Secret bindings" />
        <main className="mx-auto w-full max-w-[1100px] px-8 py-10">
          <div
            className="rounded-lg border-l-2 border-primary bg-muted/60 p-5"
            role="status"
          >
            <h1 className="text-sm font-semibold">Loading secret bindings</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Checking the latest shared record. Controls will be available when
              it arrives.
            </p>
          </div>
          <div aria-hidden="true" className="mt-5 space-y-3">
            <div className="h-16 animate-pulse rounded-lg bg-muted" />
            <div className="h-16 animate-pulse rounded-lg bg-muted" />
            <div className="h-16 animate-pulse rounded-lg bg-muted" />
          </div>
        </main>
      </>
    );
  }

  if (
    relaySelfQuery.isPending ||
    membershipQuery.isPending ||
    identityQuery.isPending
  ) {
    return (
      <>
        <GoalRouteHeader title="Secret bindings" />
        <StateMessage>Loading secret bindings…</StateMessage>
      </>
    );
  }

  if (
    relaySelfQuery.isError ||
    membershipQuery.isError ||
    identityQuery.isError ||
    !relaySelfPubkey
  ) {
    return (
      <>
        <GoalRouteHeader title="Secret bindings" />
        <main className="mx-auto w-full max-w-[1100px] px-8 py-10">
          <CredentialStoreUnavailable
            onRetry={() => {
              void relaySelfQuery.refetch();
              void membershipQuery.refetch();
              void identityQuery.refetch();
            }}
          />
        </main>
      </>
    );
  }

  if (!canManage || state === "denied") {
    return (
      <>
        <GoalRouteHeader title="Secret bindings" />
        <main className="mx-auto w-full max-w-[1100px] px-8 py-10">
          <div className="mb-8 flex justify-end">
            <Button onClick={raiseAsk} variant="outline">
              Raise an ask
            </Button>
          </div>
          <div className="flex min-h-[440px] flex-col items-center justify-center gap-3 text-center">
            <span className="flex size-14 items-center justify-center rounded-xl bg-secondary text-secondary-foreground">
              <KeyRound aria-hidden="true" className="size-6" />
            </span>
            <h1 className="text-base font-semibold">
              Only authorized people can bind secrets
            </h1>
            <p className="text-sm text-muted-foreground">
              Ask an owner or administrator to connect the requested account.
            </p>
            <Button className="mt-3" onClick={backToRequest} variant="outline">
              Back to request
            </Button>
          </div>
        </main>
      </>
    );
  }

  if (state === "unavailable") {
    return (
      <>
        <GoalRouteHeader title="Secret bindings" />
        <main className="mx-auto w-full max-w-[1100px] px-8 py-10">
          <CredentialStoreUnavailable
            onRetry={() => void bindingsQuery.refetch()}
          />
        </main>
      </>
    );
  }

  if (bindingsQuery.isError && state !== "request") {
    return (
      <>
        <GoalRouteHeader title="Secret bindings" />
        <main className="mx-auto w-full max-w-[1100px] px-8 py-10">
          <CredentialStoreUnavailable
            onRetry={() => void bindingsQuery.refetch()}
          />
        </main>
      </>
    );
  }

  if (
    state === "request" ||
    state === "entry" ||
    state === "device" ||
    state === "failed" ||
    (state === "server" && Boolean(channelId && askId))
  ) {
    if (state !== "request" && bindingsQuery.isPending) {
      return (
        <>
          <GoalRouteHeader title="Secret bindings" />
          <StateMessage>Loading secret bindings…</StateMessage>
        </>
      );
    }
    if (state !== "request" && bindingsQuery.isError) {
      return (
        <>
          <GoalRouteHeader title="Secret bindings unavailable" />
          <main className="mx-auto w-full max-w-[1100px] px-8 py-10">
            <StateMessage role="alert">
              Secret bindings could not be loaded. Check the connection and try
              again.
            </StateMessage>
            <div className="flex justify-center">
              <Button
                onClick={() => void bindingsQuery.refetch()}
                variant="outline"
              >
                Try again
              </Button>
            </div>
          </main>
        </>
      );
    }
    if (askQuery.isPending) {
      return (
        <>
          <GoalRouteHeader title="Secret bindings" />
          <StateMessage>Loading the secret request…</StateMessage>
        </>
      );
    }
    if (askQuery.isError || !ask || !secretRequest) {
      return (
        <>
          <GoalRouteHeader title="Secret bindings unavailable" />
          <main className="mx-auto w-full max-w-[1100px] px-8 py-10">
            <StateMessage role="alert">
              The secret request could not be loaded from this conversation.
            </StateMessage>
          </main>
        </>
      );
    }
    if (ask.head.status !== "open" || ask.head.ask.category !== "secret") {
      return (
        <>
          <GoalRouteHeader title="Secret bindings unavailable" />
          <main className="mx-auto w-full max-w-[1100px] px-8 py-10">
            <StateMessage role="alert">
              This secret request is no longer open.
            </StateMessage>
          </main>
        </>
      );
    }
    const employee = resolveUserLabel({
      currentPubkey,
      profiles: profilesQuery.data?.profiles,
      pubkey: ask.head.askerPubkey,
      preferResolvedSelfLabel: true,
    });
    const onServer = state === "server";
    const showEntry = state !== "request";
    return (
      <>
        <GoalRouteHeader title="Secret bindings" />
        <main className="mx-auto w-full max-w-[1100px] px-8 pb-12 pt-8">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <GoalRouteBackLink label="Back" onClick={cancelEntry} />
              <h1 className="text-2xl font-semibold tracking-tight">
                Secret bindings
              </h1>
            </div>
            <Button onClick={raiseAsk} variant="outline">
              Raise an ask
            </Button>
          </div>
          {!showEntry ? (
            <section className="rounded-xl border border-border p-6">
              <h2 className="text-lg font-semibold">
                {employee} needs a connection
              </h2>
              <p className="mt-3 text-sm text-muted-foreground">
                {ask.head.ask.body ??
                  "Bind the requested credential so this employee can work within the approved scope."}
              </p>
              <dl className="mt-6 divide-y divide-border border-y border-border">
                <DetailRow
                  label="Requested tool"
                  value={secretRequest.toolName}
                />
                <DetailRow label="Employee" value={employee} />
                {secretRequest.clientName ? (
                  <DetailRow label="Client" value={secretRequest.clientName} />
                ) : null}
                <DetailRow
                  label="Requested by"
                  value={`${employee} · ${ask.head.ask.title}`}
                />
              </dl>
              <Button className="mt-6" onClick={() => navigateTo("entry")}>
                Enter securely
              </Button>
            </section>
          ) : (
            <div className="grid items-start gap-6 lg:grid-cols-[1.2fr_0.8fr]">
              <section className="rounded-xl border border-border p-6">
                <h2 className="text-lg font-semibold">
                  Enter a credential securely
                </h2>
                <form className="mt-6 space-y-5" onSubmit={saveBinding}>
                  <label
                    className="block space-y-2 text-sm font-medium"
                    htmlFor="secret-connection-name"
                  >
                    <span>Connection name</span>
                    <Input
                      autoComplete="off"
                      id="secret-connection-name"
                      maxLength={120}
                      onChange={(event) =>
                        setConnectionName(event.target.value)
                      }
                      value={connectionName}
                    />
                  </label>
                  <label
                    className="block space-y-2 text-sm font-medium"
                    htmlFor="secret-credential"
                  >
                    <span>Credential</span>
                    <Input
                      autoComplete="new-password"
                      data-testid="secret-credential-input"
                      id="secret-credential"
                      onChange={(event) => {
                        setCredential(event.target.value);
                        if (state === "failed") navigateTo("entry");
                        setFormError(null);
                      }}
                      type="password"
                      value={credential}
                    />
                  </label>
                  <label
                    className="block space-y-2 text-sm font-medium"
                    htmlFor="secret-storage"
                  >
                    <span>Store on</span>
                    <select
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      disabled={onServer}
                      id="secret-storage"
                      value={onServer ? "server" : "device"}
                    >
                      <option value="device">This device</option>
                      <option disabled value="server">
                        Company server
                      </option>
                    </select>
                  </label>
                  <dl className="divide-y divide-border border-y border-border text-sm">
                    <DetailRow label="Tool" value={secretRequest.toolName} />
                    <DetailRow label="Employee" value={employee} />
                    <DetailRow
                      label="Allowed use"
                      value={secretRequest.allowedUse}
                    />
                  </dl>
                  {state === "failed" ? (
                    <div
                      className="rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200"
                      role="alert"
                    >
                      <strong>Binding failed</strong>
                      <p className="mt-1">
                        {formError ??
                          "No value was saved. Re-enter the credential and retry. Non-secret fields are kept."}
                      </p>
                    </div>
                  ) : null}
                  {formError && state !== "failed" ? (
                    <p className="text-sm text-destructive" role="alert">
                      {formError}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-3">
                    <Button
                      disabled={
                        isSaving ||
                        onServer ||
                        bindingsQuery.isPending ||
                        bindingsQuery.isError
                      }
                      type="submit"
                    >
                      {isSaving ? "Binding…" : "Bind securely"}
                    </Button>
                    <Button
                      onClick={cancelEntry}
                      type="button"
                      variant="outline"
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              </section>
              <aside className="rounded-xl border border-border p-6">
                <h2 className="text-base font-semibold">
                  Choose where it is available
                </h2>
                <h3 className="mt-6 text-sm font-semibold">This device</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  The credential stays in this device's secure store. Other
                  devices cannot access it.
                </p>
                <h3 className="mt-6 text-sm font-semibold">Company server</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Unavailable. This relay does not have an encrypted secret
                  store.
                </p>
                <p className="mt-5 text-xs text-muted-foreground">
                  The binding list shows names, employees and scopes, never
                  values.
                </p>
              </aside>
            </div>
          )}
        </main>
      </>
    );
  }

  if (state === "server") {
    return (
      <>
        <GoalRouteHeader title="Secret bindings" />
        <main className="mx-auto w-full max-w-[1100px] px-8 py-10">
          <div className="mb-8 flex justify-end">
            <Button onClick={raiseAsk} variant="outline">
              Raise an ask
            </Button>
          </div>
          <StateMessage role="alert">
            Company server storage is unavailable because this relay does not
            have an encrypted secret store.
          </StateMessage>
        </main>
      </>
    );
  }

  if (state === "revoke") {
    if (!selectedBinding) {
      return (
        <>
          <GoalRouteHeader title="Secret bindings unavailable" />
          <main className="mx-auto w-full max-w-[1100px] px-8 py-10">
            <StateMessage role="alert">
              This binding could not be found.
            </StateMessage>
          </main>
        </>
      );
    }
    return (
      <>
        <GoalRouteHeader title="Secret bindings" />
        <main className="mx-auto w-full max-w-[1100px] px-8 py-10">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <GoalRouteBackLink
                label="Back"
                onClick={() => navigateTo("list")}
              />
              <h1 className="text-2xl font-semibold tracking-tight">
                Secret bindings
              </h1>
            </div>
            <Button onClick={raiseAsk} variant="outline">
              Raise an ask
            </Button>
          </div>
          <section className="rounded-xl border border-border p-6">
            <h1 className="text-lg font-semibold">Revoke this binding?</h1>
            <p className="mt-3 text-sm text-muted-foreground">
              This changes the binding status to revoked. The stored credential
              remains in the device secure store.
            </p>
            {formError ? (
              <p className="mt-3 text-sm text-destructive" role="alert">
                {formError}
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap gap-3">
              <Button
                disabled={isRevoking}
                onClick={() => void revokeBinding()}
              >
                {isRevoking ? "Revoking…" : "Revoke binding"}
              </Button>
              <Button onClick={() => navigateTo("list")} variant="outline">
                Keep binding
              </Button>
            </div>
          </section>
        </main>
      </>
    );
  }

  if (state === "revoked") {
    return (
      <>
        <GoalRouteHeader title="Secret bindings" />
        <main className="mx-auto w-full max-w-[1100px] px-8 py-10">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <GoalRouteBackLink
                label="Back"
                onClick={() => navigateTo("list")}
              />
              <h1 className="text-2xl font-semibold tracking-tight">
                Secret bindings
              </h1>
            </div>
            <Button onClick={raiseAsk} variant="outline">
              Raise an ask
            </Button>
          </div>
          <section
            className="mb-5 rounded-lg border-l-2 border-emerald-600 bg-muted/60 p-5 text-sm"
            role="status"
          >
            <strong>Binding revoked</strong>
            <p className="mt-1">
              {selectedBinding?.head.binding.name ?? "The selected binding"} is
              marked revoked.
            </p>
          </section>
          <div className="mt-6 rounded-xl border border-border p-6">
            <h1 className="text-lg font-semibold">Available bindings</h1>
            {rows}
          </div>
          <Button className="mt-5" data-testid="add-secret-binding" disabled>
            Add a binding
          </Button>
        </main>
      </>
    );
  }

  if (bindingsQuery.isPending) {
    return (
      <>
        <GoalRouteHeader title="Secret bindings" />
        <StateMessage>Loading secret bindings…</StateMessage>
      </>
    );
  }

  const bindings = state === "empty" ? [] : (bindingsQuery.data ?? []);
  const isEmpty = bindings.length === 0;
  return (
    <>
      <GoalRouteHeader title="Secret bindings" />
      <main
        className="mx-auto w-full max-w-[1100px] px-8 py-10"
        data-testid="secret-bindings-screen"
      >
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <GoalRouteBackLink
              label="Back"
              onClick={() => navigateTo("list")}
            />
            <h1 className="text-2xl font-semibold tracking-tight">
              Secret bindings
            </h1>
          </div>
          <Button onClick={raiseAsk} variant="outline">
            Raise an ask
          </Button>
        </div>
        {state === "saved" ? (
          <section
            className="mb-5 rounded-lg border-l-2 border-emerald-600 bg-muted/60 p-5 text-sm"
            role="status"
          >
            <strong>Binding created</strong>
            <p className="mt-1">
              The credential value is never placed in chat.
            </p>
          </section>
        ) : null}
        {isEmpty ? (
          <div className="flex min-h-[440px] flex-col items-center justify-center gap-3 text-center">
            <span className="flex size-14 items-center justify-center rounded-xl bg-secondary text-secondary-foreground">
              <KeyRound aria-hidden="true" className="size-6" />
            </span>
            <h2 className="text-base font-semibold">No secrets bound</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              Connect only what your agents need for their current work.
            </p>
            <Button className="mt-3" data-testid="add-secret-binding" disabled>
              Add a binding
            </Button>
          </div>
        ) : (
          <>
            <section className="rounded-xl border border-border p-6">
              <h2 className="mb-4 text-base font-semibold">
                Available bindings
              </h2>
              {rows}
            </section>
            <Button className="mt-5" data-testid="add-secret-binding" disabled>
              Add a binding
            </Button>
          </>
        )}
        {state === "saved" && selectedBinding ? (
          <p className="mt-4 text-sm text-muted-foreground">
            {selectedBinding.head.binding.name} · {selectedEmployee}
          </p>
        ) : null}
      </main>
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(120px,1fr)_2fr] gap-4 py-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{value}</dd>
    </div>
  );
}
