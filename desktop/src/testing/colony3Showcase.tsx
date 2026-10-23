/**
 * Test-only showcase of the Colony 3.0 foundations, built from the app's real
 * primitives (buttons, tabs, inputs, badges, avatars, the field). It is
 * mounted instead of the app when the E2E bridge asks for `showcase:
 * "colony3"`, and exists so the Foundations board can be compared with the
 * components themselves. It is never part of a production build.
 */
import * as React from "react";
import ReactDOM from "react-dom/client";

import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import { ThemeProvider } from "@/shared/theme/ThemeProvider";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { ColonyField } from "@/shared/ui/ColonyField";
import { Input } from "@/shared/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { TooltipProvider } from "@/shared/ui/tooltip";
import {
  CheckIcon,
  CloseIcon,
  UpdateAvailableIcon,
  UpdateReadyIcon,
} from "@/shared/ui/colonyIcons";
import { SidebarRelayConnectionCompactCard } from "@/features/sidebar/ui/SidebarRelayConnectionCard";
import { SidebarCompactActionCard } from "@/shared/ui/sidebar-action-card";

const EYEBROW =
  "text-2xs font-bold uppercase tracking-[0.09em] text-colony-muted";

function TypeRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <span className={EYEBROW}>{label}</span>
      {children}
    </>
  );
}

function Swatch({
  label,
  background,
  ring,
}: {
  label: string;
  background: string;
  ring?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span
        className="h-14 rounded-colony-control-lg"
        style={{
          background,
          boxShadow: ring ? `inset 0 0 0 1px ${ring}` : undefined,
        }}
      />
      <span className="text-2xs font-semibold">{label}</span>
    </div>
  );
}

function FoundationsBoard() {
  return (
    <div
      className="flex h-[1180px] w-[1440px] bg-colony-surface font-sans text-colony-fg"
      data-testid="colony3-foundations"
    >
      <div
        aria-hidden="true"
        className="relative w-75 flex-none overflow-hidden"
      >
        <ColonyField variant="swatch" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-13 px-18 py-16">
        <div className="flex flex-col gap-2.5">
          <span className={EYEBROW}>Colony · Soft Field</span>
          <h1 className="m-0 text-hero font-extrabold">
            Calm room, painted walls.
          </h1>
          <p className="m-0 max-w-[760px] text-lg leading-[1.55] text-colony-fg-secondary">
            The sidebar carries the colour: three soft colours blurred into one
            field, with a little grain. Rose, lilac and periwinkle by default,
            and each founder can change all three. Everything you read sits on
            warm white in Manrope, one size up from today.
          </p>
        </div>

        <section className="grid grid-cols-[200px_1fr] items-baseline gap-x-8 gap-y-4.5">
          <TypeRow label="Display · 52 / 800">
            <span className="text-5xl font-extrabold leading-[1.05] tracking-[-0.042em]">
              Welcome
            </span>
          </TypeRow>
          <TypeRow label="Page title · 36 / 800">
            <span className="text-3xl font-extrabold leading-[1.1] tracking-[-0.035em]">
              Team
            </span>
          </TypeRow>
          <TypeRow label="Section · 21 / 700">
            <span className="text-xl font-bold tracking-[-0.015em]">
              Waiting on you
            </span>
          </TypeRow>
          <TypeRow label="Message · 17 / 500">
            <span className="text-message font-medium leading-[1.6]">
              Hi Lerato! I’m Scout, your Chief of Staff. What shall we tackle
              first?
            </span>
          </TypeRow>
          <TypeRow label="UI · 16 / 600">
            <span className="text-sm font-semibold">
              Channels, buttons, sidebar items
            </span>
          </TypeRow>
          <TypeRow label="Meta · 14 / 500">
            <span className="text-xs font-medium text-colony-muted">
              Chief of Staff · 9:41 · last reply just now
            </span>
          </TypeRow>
        </section>

        <div className="flex flex-wrap gap-14">
          <section className="flex flex-col gap-3.5">
            <h2 className={`m-0 ${EYEBROW}`}>Surface &amp; ink</h2>
            <div className="grid w-90 grid-cols-3 gap-2.5">
              <Swatch background="#FFFDFA" label="Surface" ring="#E0D8E5" />
              <Swatch background="#F8F5F2" label="Raised" ring="#EDE7EF" />
              <Swatch background="#EDE7EF" label="Line" />
              <Swatch background="#25222C" label="Ink" />
              <Swatch background="#68626F" label="Muted" />
              <Swatch background="#5B45BE" label="Accent" />
            </div>
          </section>

          <section className="flex flex-col gap-3.5">
            <h2 className={`m-0 ${EYEBROW}`}>Work states</h2>
            <div className="flex flex-col items-start gap-2.5">
              <Badge variant="working">
                <span className="size-2 rounded-full bg-colony-accent" />
                Working
              </Badge>
              <Badge variant="needs">
                <svg
                  aria-hidden="true"
                  fill="none"
                  height="13"
                  stroke="currentColor"
                  strokeWidth="2.6"
                  viewBox="0 0 24 24"
                  width="13"
                >
                  <path d="M12 8v5M12 16.5v.5" />
                  <circle cx="12" cy="12" r="9" />
                </svg>
                Needs you
              </Badge>
              <Badge variant="done">
                <CheckIcon size={13} />
                Done
              </Badge>
              <Badge variant="blocked">
                <CloseIcon size={13} strokeWidth={2.6} />
                Blocked
              </Badge>
              <Badge variant="idle">
                <span className="box-border size-2 rounded-full border-2 border-colony-muted" />
                Idle
              </Badge>
            </div>
          </section>

          <section className="flex flex-col gap-3.5">
            <h2 className={`m-0 ${EYEBROW}`}>
              People are round, agents are cells
            </h2>
            <div className="flex items-center gap-3">
              <ProfileAvatar
                avatarUrl={null}
                className="size-12 text-[calc(18*var(--colony-px))]"
                label="Lerato"
              />
              {["Scout", "Aya", "Mina", "Penny", "Reese"].map((name) => (
                <ProfileAvatar
                  avatarUrl={null}
                  className="size-13 text-[calc(18*var(--colony-px))]"
                  key={name}
                  label={name}
                  shape="squircle"
                />
              ))}
            </div>
            <span className="max-w-[380px] text-xs leading-[1.5] text-colony-muted">
              Each agent keeps its own soft colour pair, so the colour you see
              in a thread is the colour of who wrote it.
            </span>
          </section>
        </div>

        <section className="flex flex-col gap-3.5">
          <h2 className={`m-0 ${EYEBROW}`}>Controls</h2>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button">Primary action</Button>
            <Button type="button" variant="agent">
              Send to agent
            </Button>
            <Button className="px-5" type="button" variant="outline">
              Secondary
            </Button>
            <Button
              className="rounded-full border-[1.5px] bg-colony-surface px-5 font-bold"
              type="button"
              variant="outline"
            >
              Plan my first week
            </Button>
            <Tabs defaultValue="conversation">
              <TabsList aria-label="Tabs example">
                <TabsTrigger value="conversation">Conversation</TabsTrigger>
                <TabsTrigger value="threads">Threads</TabsTrigger>
                <TabsTrigger value="files">Files</TabsTrigger>
              </TabsList>
            </Tabs>
            <label
              className="flex flex-col gap-1.5 text-xs font-bold text-colony-fg-secondary"
              htmlFor="colony3-channel-name"
            >
              Channel name
              <Input
                className="w-60 font-normal"
                defaultValue="launch-plan"
                id="colony3-channel-name"
              />
            </label>
          </div>
        </section>
      </div>
    </div>
  );
}

function Floating({ children }: { children: React.ReactNode }) {
  return <div className="colony-floating-notice relative">{children}</div>;
}

/**
 * The Connection and Updates column of the ShellNotices board, from the real
 * notice cards in each of their states.
 */
function NoticesBoard() {
  const noop = () => {};
  return (
    <div
      className="flex h-[960px] w-[1440px] bg-colony-surface font-sans text-colony-fg"
      data-testid="colony3-notices"
    >
      <main className="flex-1 bg-[#FBF8F6] p-10">
        <div className="flex w-[342px] flex-col gap-3">
          <h2 className={`m-0 mb-0.5 ${EYEBROW}`}>Connection</h2>
          <Floating>
            <SidebarRelayConnectionCompactCard
              isReconnectPending={false}
              onDismiss={noop}
              onReconnect={noop}
              testId="notice-relay-unreachable"
            />
          </Floating>
          <Floating>
            <SidebarRelayConnectionCompactCard
              isReconnectPending
              onReconnect={noop}
              testId="notice-relay-reconnecting"
            />
          </Floating>
          <Floating>
            <SidebarRelayConnectionCompactCard
              isReconnectPending
              isWaitingOnReconnectHook
              onReconnect={noop}
              testId="notice-relay-waiting"
            />
          </Floating>
          <Floating>
            <SidebarRelayConnectionCompactCard
              isConnected
              isReconnectPending={false}
              onReconnect={noop}
              testId="notice-relay-connected"
            />
          </Floating>
          <h2 className={`m-0 mb-0.5 mt-4.5 ${EYEBROW}`}>Updates</h2>
          <Floating>
            <SidebarCompactActionCard
              actionAriaLabel="Update now"
              description="Click to update"
              icon={<UpdateReadyIcon size={20} />}
              onAction={noop}
              testId="notice-update-ready"
              title="Ready to update!"
              tone="accent"
            />
          </Floating>
          <Floating>
            <SidebarCompactActionCard
              actionAriaLabel="Download update from GitHub"
              description="v[VERSION] available. Download the new version from GitHub."
              icon={<UpdateAvailableIcon size={20} />}
              onAction={noop}
              testId="notice-update-available"
              title="Update available"
              tone="info"
            />
          </Floating>
        </div>
      </main>
    </div>
  );
}

export function renderColony3Showcase(
  which: "foundations" | "notices" = "foundations",
) {
  const root = document.getElementById("root");
  if (!root) return;
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ThemeProvider defaultTheme="buzz">
        <TooltipProvider>
          {which === "notices" ? <NoticesBoard /> : <FoundationsBoard />}
        </TooltipProvider>
      </ThemeProvider>
    </React.StrictMode>,
  );
}
