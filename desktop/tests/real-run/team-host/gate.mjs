#!/usr/bin/env node
// Phase 0 gate: the host runs the team by itself (plan part D, Task 4.15).
// A real relay, real AI, the packaged host and clean app data. Writes a JSON
// report. Read README.md first.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import * as api from "./relay-api.mjs";
import * as driver from "./host-driver.mjs";
import {
  FAIL,
  NOT_OBSERVED,
  PASS,
  completeRows,
  completes,
  createChannel,
  dutyTime,
  employeeMessages,
  employeesForHire,
  hellos,
  hireAction,
  hireProposal,
  journalEntry,
  profileAction,
  businessProfile,
  relayWakes,
  row,
  verdictOf,
} from "./steps.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const TIME_ZONE = "Africa/Johannesburg";

function refuse(message) {
  console.error(`team-host gate: ${message}`);
  process.exit(2);
}

if (process.env.COLONY_REAL_RUN !== "1")
  refuse("set COLONY_REAL_RUN=1: this gate uses a real relay and real AI");
if (process.env.CI) refuse("the real-run gate never runs in CI");
const binary =
  process.env.COLONY_GATE_HOST_BINARY ?? refuse("set COLONY_GATE_HOST_BINARY");
const relayBase = (
  process.env.COLONY_GATE_RELAY_URL ?? refuse("set COLONY_GATE_RELAY_URL")
).replace(/\/+$/, "");
const email =
  process.env.COLONY_GATE_EMAIL ??
  refuse("set COLONY_GATE_EMAIL to a fresh address you can read");
const runtimeId = process.env.COLONY_GATE_RUNTIME ?? "claude";
const termsVersion = process.env.COLONY_GATE_TERMS_VERSION ?? "2026-10-11";
const dutyDelayMinutes = Number(
  process.env.COLONY_GATE_DUTY_DELAY_MINUTES ?? "40",
);
const identifier =
  process.env.COLONY_GATE_APP_IDENTIFIER ??
  JSON.parse(
    await readFile(
      path.join(here, "../../../src-tauri/tauri.conf.json"),
      "utf8",
    ),
  ).identifier;

class NotObserved extends Error {}
const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

async function until(what, timeoutMs, probe, everyMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe().catch(() => null);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(everyMs);
  }
}

const rows = [];
const context = {};
const startedAt = new Date().toISOString();

async function step(id, needs, run) {
  const blocked = needs.find(
    (need) => rows.find((item) => item.id === need)?.status !== PASS,
  );
  if (blocked) {
    rows.push(row(id, NOT_OBSERVED, `needs ${blocked}`, 0));
    return;
  }
  const started = Date.now();
  console.log(`team-host gate: ${id} ...`);
  try {
    rows.push(row(id, PASS, await run(), Date.now() - started));
  } catch (error) {
    const status = error instanceof NotObserved ? NOT_OBSERVED : FAIL;
    rows.push(
      row(id, status, String(error?.message ?? error), Date.now() - started),
    );
  }
  console.log(
    `team-host gate: ${id} ${rows.at(-1).status}: ${rows.at(-1).detail}`,
  );
}

const startA = () =>
  driver.startHost({
    binary,
    profile: context.profileA,
    nsec: context.owner.nsec,
    extraEnv: context.hostEnv,
  });

async function hireHead(hireId, accept) {
  return until(
    `hire ${hireId}`,
    30_000,
    async () => {
      const [event] = await api.query(context.relayUrl, context.owner, [
        {
          kinds: [30650],
          authors: [context.relaySelf],
          "#d": [`company:hire:${hireId}`],
          limit: 1,
        },
      ]);
      if (!event) return null;
      const head = { ...JSON.parse(event.content), eventId: event.id };
      return accept(head) ? head : null;
    },
    2_000,
  );
}

/** Create a conversation and an approved owner-direct hire for the fixture. */
async function approvedHire(host, displayName, channelName) {
  const channelId = randomUUID();
  await api.publish(
    context.relayUrl,
    context.owner,
    createChannel(channelId, channelName),
  );
  const personas = await host.invoke("list_personas");
  const persona = personas.find((item) => item.id === "builtin:test-employee");
  if (!persona)
    throw new Error(
      "the host has no Test Employee: COLONY_FIXTURE_ROLE_PACKS=1 did not reach it",
    );
  const hireId = randomUUID();
  const proposal = hireProposal({
    hireId,
    persona,
    displayName,
    channelId,
    runtimeId,
  });
  await api.publish(
    context.relayUrl,
    context.owner,
    hireAction({ hireId, action: "create", proposal }),
  );
  let head = await hireHead(hireId, (item) => Boolean(item.status));
  if (head.status !== "approved") {
    await api.publish(
      context.relayUrl,
      context.owner,
      hireAction({
        hireId,
        action: "approve",
        expectedHeadEventId: head.eventId,
      }),
    );
    head = await hireHead(hireId, (item) => item.status === "approved");
  }
  return {
    hireId,
    channelId,
    marker: `company-hire:${hireId}:introduction`,
    input: {
      relayUrl: context.relayUrl,
      hireId,
      personaId: persona.id,
      displayName,
      homeChannelId: channelId,
    },
  };
}

async function channelMessages(channelId, sinceSec) {
  return api.query(context.relayUrl, context.owner, [
    { kinds: [9], "#h": [channelId], since: sinceSec, limit: 200 },
  ]);
}

async function answers(hire, sinceSec) {
  return employeeMessages(await channelMessages(hire.channelId, sinceSec), {
    employee: hire.employee,
    channelId: hire.channelId,
    sinceSec,
    helloMarker: hire.marker,
  });
}

try {
  await step("sign_in", [], async () => {
    const sent = await api.startEmailCode(relayBase, email);
    const prompt = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const code = (await prompt.question(`Code sent to ${email}: `)).trim();
    prompt.close();
    const session = await api.verifyEmailCode(relayBase, {
      email,
      code,
      termsVersion,
      displayName: "Gate Owner",
    });
    if (session?.created !== true)
      throw new Error("this email already had an account; use a fresh one");
    context.owner = api.keysFromNsec(session.nsec);
    return `new account ${context.owner.pubkey.slice(0, 8)}; resend allowed after ${sent.resendAfterSeconds} s`;
  });

  await step("create_company", ["sign_in"], async () => {
    const slug =
      process.env.COLONY_GATE_COMPANY_SLUG ?? `gate-${Date.now().toString(36)}`;
    const company = await api.createCompany(relayBase, context.owner, slug);
    context.relayUrl = company.relayUrl;
    context.relaySelf = await api.relaySelf(company.relayUrl);
    return `${slug} at ${company.host}`;
  });

  await step("set_profile", ["create_company"], async () => {
    const { message } = await api.publish(
      context.relayUrl,
      context.owner,
      profileAction(businessProfile(TIME_ZONE)),
    );
    const head = await until(
      "the profile head",
      30_000,
      async () => {
        const [event] = await api.query(context.relayUrl, context.owner, [
          {
            kinds: [30657],
            authors: [context.relaySelf],
            "#d": ["business-profile"],
            limit: 1,
          },
        ]);
        return event ?? null;
      },
      2_000,
    );
    const zone = JSON.parse(head.content).timeZone;
    if (zone !== TIME_ZONE) throw new Error(`the profile head says ${zone}`);
    return `saved (${message}); time zone ${zone}`;
  });

  await step("claim", ["set_profile"], async () => {
    context.duty = dutyTime(Date.now(), dutyDelayMinutes, TIME_ZONE);
    context.profileA = driver.newProfileId();
    context.dataA = driver.appDataDir(identifier, context.profileA);
    context.hostEnv = {
      COLONY_FIXTURE_DUTY_TIME: context.duty.clock,
      COLONY_TEAM_GATE_HOLD_AFTER: "employee_created",
    };
    context.hostA = await startA();
    await context.hostA.invoke("team_set_companies", {
      companies: [
        { relayUrl: context.relayUrl, ownerPubkey: context.owner.pubkey },
      ],
    });
    const status = await until(
      "this computer to hold the team",
      60_000,
      async () => {
        const current = await context.hostA.invoke("team_claim_status", {
          relayUrl: context.relayUrl,
        });
        return current?.isThisComputer ? current : null;
      },
      3_000,
    );
    context.computerA = status.thisComputerId;
    return `held by ${status.holder.computerName}; daily note at ${context.duty.clock} ${TIME_ZONE}`;
  });

  await step("hire", ["claim"], async () => {
    const first = await approvedHire(context.hostA, "Gate Tester", "gate-one");
    first.sinceSec = Math.floor(Date.now() / 1000) - 5;
    const result = await context.hostA.invoke("team_hire_complete", {
      input: first.input,
    });
    if (result?.state !== "started")
      throw new Error(`the hire answered ${JSON.stringify(result)}`);
    first.employee = result.agentPubkey;
    context.first = first;
    const posted = hellos(
      await channelMessages(first.channelId, first.sinceSec),
      first.marker,
    );
    if (posted.length !== 1) throw new Error(`${posted.length} hellos`);
    return `employee ${first.employee.slice(0, 8)} hired, said hello and started`;
  });

  await step("kickoff_answer", ["hire"], async () => {
    const begun = Date.now();
    const found = await until(
      "the answer to the kickoff",
      5 * 60_000,
      async () => {
        const list = await answers(context.first, context.first.sinceSec);
        return list.length > 0 ? list : null;
      },
      10_000,
    );
    return `answered after ${Math.round((Date.now() - begun) / 1000)} s: "${found[0].content.slice(0, 80)}"`;
  });

  await step("interrupted_hire", ["hire"], async () => {
    const second = await approvedHire(
      context.hostA,
      "Gate Tester Two",
      "gate-two",
    );
    second.sinceSec = Math.floor(Date.now() / 1000) - 5;
    context.second = second;
    const journalFile = path.join(context.dataA, "team", "hire-journal.json");
    const pending = context.hostA
      .invoke("team_hire_complete", { input: second.input })
      .catch((error) => error);
    await until(
      "the employee to be created",
      120_000,
      async () =>
        journalEntry(await driver.readJson(journalFile), second.hireId)
          ?.step === "employee_created",
      1_000,
    );
    await context.hostA.kill();
    await pending;
    context.hostA = await startA();
    await until(
      "the hire to finish by itself",
      180_000,
      async () =>
        journalEntry(await driver.readJson(journalFile), second.hireId)
          ?.step === "started",
      3_000,
    );
    const again = await context.hostA.invoke("team_hire_complete", {
      input: second.input,
    });
    if (again?.state !== "already_complete")
      throw new Error(`a second call answered ${JSON.stringify(again)}`);
    second.employee = again.agentPubkey;
    const store = await driver.readJson(
      path.join(context.dataA, "agents", "managed-agents.json"),
    );
    const made = employeesForHire(store, second.hireId).length;
    const posted = hellos(
      await channelMessages(second.channelId, second.sinceSec),
      second.marker,
    ).length;
    const head = await hireHead(
      second.hireId,
      (item) => item.status === "hired",
    );
    const actions = await api.query(context.relayUrl, context.owner, [
      { kinds: [47039], "#d": [`company:hire:${second.hireId}`], limit: 100 },
    ]);
    const completed = completes(actions, second.hireId).length;
    if (
      made !== 1 ||
      posted !== 1 ||
      completed !== 1 ||
      head.employeePubkey !== second.employee
    ) {
      throw new Error(
        `${made} employees, ${posted} hellos, ${completed} Complete actions, hired employee ${head.employeePubkey}`,
      );
    }
    return "killed after the employee was created; restarted: one employee, one hello, one Complete";
  });

  await step("no_interface", ["interrupted_hire"], async () => {
    await context.hostA.kill();
    context.hostA = await startA();
    // From here on the gate only reads `team_status`: nothing is saved, opened or started.
    const employees = [context.first.employee, context.second.employee];
    const list = await until(
      "both employees to run",
      120_000,
      async () => {
        const statuses = await context.hostA.invoke("team_status", {
          relayUrl: context.relayUrl,
        });
        const running = statuses.filter(
          (status) =>
            employees.includes(status.agentPubkey) &&
            status.state === "running",
        );
        return running.length === employees.length ? statuses : null;
      },
      5_000,
    );
    return list.map((status) => `${status.name} ${status.state}`).join(", ");
  });

  await step("missed_routine", ["no_interface"], async () => {
    const hires = [context.first, context.second];
    // The second employee answers its own kickoff before the stop, so the
    // only message after the restart is the daily note.
    await until(
      "the second employee's kickoff answer",
      5 * 60_000,
      async () =>
        (await answers(context.second, context.second.sinceSec)).length > 0,
      10_000,
    );
    const { atMs, clock } = context.duty;
    if (Date.now() > atMs - 10 * 60_000) {
      throw new NotObserved(
        `the routine at ${clock} came too soon; raise COLONY_GATE_DUTY_DELAY_MINUTES`,
      );
    }
    await sleep(atMs - 10 * 60_000 - Date.now());
    await context.hostA.close();
    await sleep(atMs + 10 * 60_000 - Date.now());
    const restartedSec = Math.floor(Date.now() / 1000);
    context.hostA = await startA();
    const count = async () =>
      Promise.all(
        hires.map(async (hire) => (await answers(hire, restartedSec)).length),
      );
    await until(
      "one daily note from each employee",
      10 * 60_000,
      async () => (await count()).every((notes) => notes >= 1),
      15_000,
    );
    await sleep(2 * 60_000);
    const settled = await count();
    if (settled.some((notes) => notes !== 1)) {
      throw new Error(
        `notes after the restart: ${settled.join(", ")}; each must be exactly 1`,
      );
    }
    const wakeSec = Math.floor(atMs / 1000);
    const wakes = await Promise.all(
      hires.map(
        async (hire) =>
          relayWakes(await channelMessages(hire.channelId, wakeSec - 60), {
            relaySelf: context.relaySelf,
            employee: hire.employee,
            channelId: hire.channelId,
            fromSec: wakeSec - 60,
            toSec: wakeSec + 120,
          }).length,
      ),
    );
    return `stopped from 10 minutes before ${clock} to 10 minutes after; one note each; relay wakes seen near ${clock}: ${wakes.join(", ")}`;
  });

  await step("second_computer", ["claim"], async () => {
    const hostB = await driver.startHost({
      binary,
      profile: driver.newProfileId(),
      nsec: context.owner.nsec,
      extraEnv: context.hostEnv,
    });
    try {
      await hostB.invoke("team_set_companies", {
        companies: [
          { relayUrl: context.relayUrl, ownerPubkey: context.owner.pubkey },
        ],
      });
      const status = await until(
        "the second computer to read the record",
        60_000,
        async () => {
          const current = await hostB.invoke("team_claim_status", {
            relayUrl: context.relayUrl,
          });
          return current?.holder ? current : null;
        },
        3_000,
      );
      if (
        status.isThisComputer ||
        status.holder.computerId !== context.computerA
      ) {
        throw new Error(
          `the record names ${status.holder.computerId}, not the first computer`,
        );
      }
      const third = await approvedHire(
        hostB,
        "Gate Tester Three",
        "gate-three",
      );
      const refused = await hostB
        .invoke("team_hire_complete", { input: third.input })
        .then(
          (result) => `not refused: ${JSON.stringify(result)}`,
          (error) => String(error),
        );
      if (!refused.includes("Your team runs on")) throw new Error(refused);
      const statusesB = await hostB.invoke("team_status", {
        relayUrl: context.relayUrl,
      });
      if (statusesB.some((item) => item.state !== "away"))
        throw new Error("the second computer runs an employee");
      const statusesA = await context.hostA.invoke("team_status", {
        relayUrl: context.relayUrl,
      });
      if (statusesA.some((item) => item.state !== "running"))
        throw new Error("the first computer stopped its team");
      return `the record still names the first computer; the second refused: "${refused}"`;
    } finally {
      await hostB.close().catch(() => {});
    }
  });
} finally {
  await context.hostA?.close().catch(() => {});
}

const steps = completeRows(rows);
const report = {
  gate: "phase-0-team-host",
  startedAt,
  finishedAt: new Date().toISOString(),
  platform: `${process.platform}-${process.arch}`,
  hostBinary: path.basename(binary),
  relay: context.relayUrl ?? null,
  timeZone: TIME_ZONE,
  runtime: runtimeId,
  steps,
  verdict: verdictOf(steps),
};
const out =
  process.env.COLONY_GATE_REPORT ??
  path.join(here, "out", `report-${Date.now()}.json`);
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(`team-host gate: ${report.verdict}; report at ${out}`);
process.exit(report.verdict === "PASS" ? 0 : 1);
