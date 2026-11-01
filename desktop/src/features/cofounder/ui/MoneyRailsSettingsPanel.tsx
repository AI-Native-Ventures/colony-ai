import { useState, type FormEvent } from "react";
import { Check, Copy, Globe2, KeyRound, Plus, X } from "lucide-react";

import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

import {
  providerHost,
  type MoneyRailConnection,
  type MoneyRailRoute,
} from "../moneyRails";
import {
  useMoneyRailsActions,
  useMoneyRailsSnapshot,
} from "../moneyRailsBridge";
import "./moneyRails.css";

const DEFAULT_PROVIDER = "Paystack";
const DEFAULT_PROVIDER_ENTRY = "Paystack · paystack.com";

function parseProviderEntry(value: string) {
  const [name = "", ...hostParts] = value.split("·");
  return {
    name: name.trim(),
    websiteHost: hostParts.join("·").trim(),
  };
}

function apiHostFor(provider: string): string | null {
  switch (provider.trim().toLowerCase()) {
    case "paystack":
      return "api.paystack.co";
    default:
      return null;
  }
}

function websiteHostFor(provider: string): string | null {
  switch (provider.trim().toLowerCase()) {
    case "paystack":
      return "paystack.com";
    case "yoco":
      return "yoco.com";
    default:
      return null;
  }
}

function routeLabel(route: MoneyRailRoute): string {
  return route === "browser" ? "Browser tab" : "API key";
}

function ConnectionRow({
  connection,
  onManage,
}: {
  connection: MoneyRailConnection;
  onManage: () => void;
}) {
  const statusLabel =
    connection.status === "connected"
      ? "Connected"
      : connection.status === "needs_reconnect"
        ? "Reconnect"
        : "Disconnected";
  return (
    <article
      className="cf-money-rail-connection"
      data-testid={`money-rail-connection-${connection.id}`}
    >
      <div className="cf-money-rail-connection-main">
        <div className="cf-money-rail-connection-icon" aria-hidden="true">
          {connection.route === "browser" ? (
            <Globe2 size={18} />
          ) : (
            <KeyRound size={18} />
          )}
        </div>
        <div>
          <h3>{connection.provider}</h3>
          <p>
            {connection.host} · {routeLabel(connection.route)}
          </p>
        </div>
      </div>
      <div className="cf-money-rail-connection-meta">
        <span data-status={connection.status}>{statusLabel}</span>
        <small>Last used · {connection.lastUsed ?? "Never"}</small>
      </div>
      <Button
        className="cf-money-rail-manage"
        onClick={onManage}
        type="button"
        variant="outline"
      >
        Manage
      </Button>
    </article>
  );
}

export function MoneyRailsSettingsPanel() {
  const snapshot = useMoneyRailsSnapshot();
  const { execute } = useMoneyRailsActions();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [providerEntry, setProviderEntry] = useState(DEFAULT_PROVIDER_ENTRY);
  const [route, setRoute] = useState<MoneyRailRoute>("browser");
  const [apiKey, setApiKey] = useState("");
  const [managedConnectionId, setManagedConnectionId] = useState<string | null>(
    null,
  );
  const [connectionNoticeAddress, setConnectionNoticeAddress] = useState<
    string | null
  >(null);
  const [connectedProvider, setConnectedProvider] = useState<string | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const paymentConnections = snapshot.connections.filter(
    (connection) => connection.provider !== "Google Calendar",
  );
  const calendarConnection = snapshot.connections.find(
    (connection) => connection.provider === "Google Calendar",
  );
  const providerDetails = parseProviderEntry(providerEntry);
  const provider = providerDetails.name || DEFAULT_PROVIDER;
  const paystackApi = route === "api" && provider.toLowerCase() === "paystack";
  const apiHost = apiHostFor(providerDetails.name);
  const browserHost = providerDetails.websiteHost;
  const routeHost = route === "browser" ? browserHost : (apiHost ?? "");
  const validHost = providerHost(routeHost);
  const selectedConnection = snapshot.connections.find(
    (connection) => connection.id === managedConnectionId,
  );
  const matchingConnection = snapshot.connections.find(
    (connection) =>
      connectedProvider === connection.provider && connection.route === route,
  );
  const noticeAddress =
    connectionNoticeAddress ||
    selectedConnection?.noticeAddress ||
    matchingConnection?.noticeAddress ||
    null;
  const isConnected = Boolean(
    connectedProvider && (noticeAddress || matchingConnection),
  );
  const canConnect = Boolean(
    providerDetails.name &&
      validHost &&
      !pending &&
      !isConnected &&
      (route === "browser" || apiKey.trim()),
  );

  function closeDialog(open: boolean) {
    if (pending) return;
    setDialogOpen(open);
    if (!open) {
      setApiKey("");
      setError(null);
      setCopied(false);
      setManagedConnectionId(null);
      setConnectionNoticeAddress(null);
      setConnectedProvider(null);
    }
  }

  function addProvider() {
    setProviderEntry(DEFAULT_PROVIDER_ENTRY);
    setRoute("browser");
    setApiKey("");
    setManagedConnectionId(null);
    setConnectionNoticeAddress(null);
    setConnectedProvider(null);
    setError(null);
    setCopied(false);
    setDialogOpen(true);
  }

  function manageConnection(connection: MoneyRailConnection) {
    setProviderEntry(
      `${connection.provider} · ${connection.browserHost ?? websiteHostFor(connection.provider) ?? connection.host}`,
    );
    setRoute(connection.route);
    setManagedConnectionId(connection.id);
    setConnectionNoticeAddress(connection.noticeAddress || null);
    setConnectedProvider(connection.provider);
    setApiKey("");
    setError(null);
    setDialogOpen(true);
  }

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canConnect || !validHost) return;
    setPending(true);
    setError(null);
    try {
      const result = await execute({
        type: "connect",
        provider: provider.trim(),
        host: validHost,
        route,
        ...(route === "api"
          ? {
              apiKey,
              apiHost: validHost,
              authScheme: "bearer",
              ...(providerHost(browserHost)
                ? { browserHost: providerHost(browserHost) ?? undefined }
                : {}),
            }
          : {}),
      });
      if (result && "noticeAddress" in result) {
        setManagedConnectionId(result.id);
        setConnectionNoticeAddress(result.noticeAddress);
      }
      setConnectedProvider(provider.trim());
    } catch (connectError) {
      setError(
        connectError instanceof Error
          ? connectError.message
          : "The provider could not be connected. Try again.",
      );
    } finally {
      setApiKey("");
      setPending(false);
    }
  }

  async function copyNoticeAddress() {
    if (!noticeAddress) return;
    try {
      await navigator.clipboard.writeText(noticeAddress);
      setCopied(true);
    } catch {
      setError("Could not copy the payment notice address.");
    }
  }

  return (
    <div className="cf-money-rails-settings" data-testid="money-rails-settings">
      <header className="cf-money-rails-settings-heading">
        <div>
          <h2>Money and calendar</h2>
          <p>
            Choose where Scout creates payment links. Money goes straight to
            your account.
          </p>
        </div>
        <Button
          className="cf-money-rail-add-button"
          data-testid="money-rail-add-provider"
          onClick={addProvider}
          type="button"
        >
          <Plus aria-hidden="true" size={17} />
          Add provider
        </Button>
      </header>

      <section
        aria-labelledby="money-rail-connections-title"
        className="cf-money-rail-connection-list"
      >
        <h3 id="money-rail-connections-title">Payment providers</h3>
        {snapshot.availability === "loading" ? (
          <p className="cf-money-rail-empty" role="status">
            Loading payment connections…
          </p>
        ) : snapshot.availability === "not_ready" ? (
          <p className="cf-money-rail-empty" role="status">
            Money connections are not enabled on this relay yet.
          </p>
        ) : snapshot.availability === "error" ? (
          <p className="cf-money-rail-field-error" role="alert">
            {snapshot.errorMessage ??
              "Payment connections could not be loaded."}
          </p>
        ) : paymentConnections.length ? (
          paymentConnections.map((connection) => (
            <ConnectionRow
              connection={connection}
              key={connection.id}
              onManage={() => manageConnection(connection)}
            />
          ))
        ) : (
          <p className="cf-money-rail-empty">
            No payment providers connected yet.
          </p>
        )}
      </section>

      <section
        aria-labelledby="money-rail-calendar-title"
        className="cf-money-rail-calendar-note"
      >
        <div className="cf-money-rail-connection-icon" aria-hidden="true">
          <Globe2 size={18} />
        </div>
        <div>
          <h3 id="money-rail-calendar-title">Google Calendar</h3>
          <p>
            {calendarConnection
              ? `${calendarConnection.status === "connected" ? "Connected" : "Reconnect"} · last used ${calendarConnection.lastUsed ?? "Never"}`
              : "Calendar connection settings will appear here."}
          </p>
        </div>
      </section>

      <Dialog onOpenChange={closeDialog} open={dialogOpen}>
        <DialogContent
          className="cf-money-rail-dialog"
          data-testid="money-rail-connect-dialog"
        >
          <DialogHeader className="cf-money-rail-dialog-header">
            <DialogTitle>Add a way to get paid</DialogTitle>
            <DialogDescription>
              Any provider you already use. Money goes straight to your account.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(event) => void connect(event)}>
            <div className="cf-money-rail-dialog-body">
              <label className="cf-money-rail-form-field">
                Provider
                <input
                  aria-label="Provider"
                  autoComplete="off"
                  onChange={(event) =>
                    setProviderEntry(event.currentTarget.value)
                  }
                  value={providerEntry}
                />
              </label>

              <fieldset className="cf-money-rail-route-fieldset">
                <legend>How Scout makes links</legend>
                <div className="cf-money-rail-route-cards">
                  <label
                    className={`cf-money-rail-route-card${route === "browser" ? " is-selected" : ""}`}
                  >
                    <input
                      aria-label="Use a browser tab"
                      checked={route === "browser"}
                      name="money-rail-route"
                      onChange={() => setRoute("browser")}
                      type="radio"
                      value="browser"
                    />
                    <Globe2 aria-hidden="true" size={17} />
                    <strong>Sign in on the web</strong>
                    <span>
                      Scout uses the provider site in a tab you share with it.
                      Works with any provider. Your Mac must be awake.
                    </span>
                  </label>
                  <label
                    className={`cf-money-rail-route-card${route === "api" ? " is-selected" : ""}`}
                  >
                    <input
                      aria-label="Use an API key"
                      checked={route === "api"}
                      name="money-rail-route"
                      onChange={() => setRoute("api")}
                      type="radio"
                      value="api"
                    />
                    <KeyRound aria-hidden="true" size={17} />
                    <strong>Use an API key</strong>
                    <span>
                      Faster, and works while your Mac sleeps. Colony keeps the
                      key, Scout never sees it.
                    </span>
                  </label>
                </div>
              </fieldset>

              {route === "api" ? (
                <>
                  {!apiHostFor(providerDetails.name) ? (
                    <p className="cf-money-rail-field-error" role="status">
                      Use a browser tab for this provider. Its API connection is
                      not set up yet.
                    </p>
                  ) : null}
                  <label className="cf-money-rail-form-field">
                    Secret key
                    <input
                      aria-label="Provider API key"
                      autoComplete="new-password"
                      data-testid="money-rail-api-key"
                      onChange={(event) => setApiKey(event.currentTarget.value)}
                      type="password"
                      value={apiKey}
                    />
                    <span>
                      Locked to {validHost ?? "this provider host"}. Colony
                      never shows it again, to you or Scout.
                    </span>
                  </label>
                </>
              ) : null}

              <section
                aria-labelledby="money-rail-allowed-title"
                className="cf-money-rail-allowed"
              >
                <h3 id="money-rail-allowed-title">What Scout may do with it</h3>
                <div>
                  <Check aria-hidden="true" size={17} />
                  <p>
                    <strong>Create a payment link</strong>
                    <span>
                      {paystackApi
                        ? "POST /paymentrequest · only after you approve each link"
                        : "Only after you approve each link"}
                    </span>
                  </p>
                </div>
                <div>
                  <Check aria-hidden="true" size={17} />
                  <p>
                    <strong>Check whether a payment arrived</strong>
                    <span>
                      {paystackApi
                        ? "GET /transaction/verify"
                        : "Read-only payment lookup"}
                    </span>
                  </p>
                </div>
                <div className="is-blocked">
                  <X aria-hidden="true" size={17} />
                  <p>
                    <strong>Refunds, payouts and transfers</strong>
                    <span>Never allowed, whatever is approved</span>
                  </p>
                </div>
              </section>

              <section
                aria-labelledby="money-rail-notices-title"
                className="cf-money-rail-notice"
              >
                <h3 id="money-rail-notices-title">Payment notices</h3>
                <div className="cf-money-rail-notice-row">
                  <input
                    aria-label="Payment notice address"
                    readOnly
                    value={noticeAddress ?? "Available after connecting"}
                  />
                  <Button
                    aria-label="Copy payment notice address"
                    disabled={!noticeAddress}
                    onClick={() => void copyNoticeAddress()}
                    size="icon"
                    type="button"
                    variant="outline"
                  >
                    {copied ? (
                      <Check aria-hidden="true" size={16} />
                    ) : (
                      <Copy aria-hidden="true" size={16} />
                    )}
                  </Button>
                </div>
                <p>
                  Paste it in {provider || "the provider"} under Settings,
                  Webhooks, or let Scout add it for you. Paid shows on the
                  record once Colony confirms it.
                </p>
              </section>
              {error ? (
                <p className="cf-money-rail-error" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
            <DialogFooter className="cf-money-rail-dialog-footer">
              <Button
                data-testid="money-rail-connect-provider"
                disabled={!canConnect}
                type="submit"
              >
                {pending ? "Connecting" : `Connect ${provider || "provider"}`}
              </Button>
              <Button
                onClick={() => closeDialog(false)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
