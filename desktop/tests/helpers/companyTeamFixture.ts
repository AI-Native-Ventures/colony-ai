import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import { KIND_MEMBER_POSITION_HEAD } from "../../src/shared/constants/kinds";
import { installMockBridge, TEST_IDENTITIES } from "./bridge";

type Opts = {
  minaStatus?: "active" | "paused" | "terminated";
  identity?: "tyler" | "alice";
  relaySelf?: "null" | "delay";
  noPositions?: boolean;
  emptyRoster?: boolean;
};

/** Seed a signed mixed roster for Team recovery and lifecycle browser tests. */
export async function setup(
  page: import("@playwright/test").Page,
  o: Opts = {},
) {
  const relaySecret = generateSecretKey();
  const minaPk = getPublicKey(generateSecretKey());
  const owner = TEST_IDENTITIES.tyler.pubkey;
  const people = [
    { pubkey: owner, name: "Lerato Molefe", title: "Founder", kind: "human" },
    {
      pubkey: minaPk,
      name: "Mina",
      title: "Social Media Manager",
      kind: "employee",
      managerPubkey: owner,
    },
    {
      pubkey: TEST_IDENTITIES.alice.pubkey,
      name: "Noluthando Khumalo",
      title: "Account Manager",
      kind: "human",
      managerPubkey: minaPk,
    },
    {
      pubkey: getPublicKey(generateSecretKey()),
      name: "Noor",
      title: "Bookkeeper",
      kind: "employee",
      managerPubkey: owner,
    },
    {
      pubkey: getPublicKey(generateSecretKey()),
      name: "Aya",
      title: "Business Development",
      kind: "employee",
      managerPubkey: owner,
    },
    {
      pubkey: getPublicKey(generateSecretKey()),
      name: "Theo",
      title: "Software Engineer",
      kind: "employee",
      managerPubkey: owner,
    },
    {
      pubkey: TEST_IDENTITIES.bob.pubkey,
      name: "Sam Patel",
      title: "Designer",
      kind: "human",
      managerPubkey: minaPk,
    },
    {
      pubkey: TEST_IDENTITIES.charlie.pubkey,
      name: "Jules Adams",
      title: "Client Partner",
      kind: "human",
      managerPubkey: owner,
    },
  ] as const;
  const identity = TEST_IDENTITIES[o.identity ?? "tyler"];
  await page.addInitScript((id) => {
    localStorage.setItem("buzz:e2e-identity-override.v1", JSON.stringify(id));
  }, identity);
  const status = o.minaStatus ?? "active";
  await installMockBridge(page, {
    companyMemberRelayPrivateKeyHex: Buffer.from(relaySecret).toString("hex"),
    relaySelf: o.relaySelf === "null" ? null : getPublicKey(relaySecret),
    ...(o.relaySelf === "delay" ? { relaySelfDelayMs: 20000 } : {}),
    searchProfiles: people.map((p) => ({
      pubkey: p.pubkey,
      displayName: p.name,
    })),
    relayMembers: o.emptyRoster
      ? []
      : people
          .filter((p) => p.kind === "human")
          .map((p) => ({
            pubkey: p.pubkey,
            role: p.pubkey === owner ? "owner" : "member",
          })),
    relayAgents: o.emptyRoster
      ? []
      : people
          .filter((p) => p.kind === "employee")
          .map((p) => ({
            pubkey: p.pubkey,
            ownerPubkey: owner,
            name: p.name,
            agentType: "agent",
          })),
    managedAgents: o.emptyRoster
      ? []
      : [
          {
            pubkey: minaPk,
            name: "Mina",
            status: status === "terminated" ? "stopped" : "running",
            channelNames: ["general"],
          },
        ],
    companyMemberPositionEvents: o.noPositions
      ? []
      : people.map((p) =>
          finalizeEvent(
            {
              kind: KIND_MEMBER_POSITION_HEAD,
              created_at: Math.floor(Date.now() / 1000),
              tags: [["d", `company:member:${p.pubkey}`]],
              content: JSON.stringify({
                schemaVersion: 1,
                pubkey: p.pubkey,
                title: p.title,
                kind: p.kind,
                status: p.pubkey === minaPk ? status : "active",
                ...(p.pubkey === minaPk && status !== "active"
                  ? { reason: "Reviewing the workload." }
                  : {}),
                ...("managerPubkey" in p
                  ? { managerPubkey: p.managerPubkey }
                  : {}),
                sourceActionEventId: "b".repeat(64),
                updatedAt: new Date().toISOString(),
              }),
            },
            relaySecret,
          ),
        ),
  } as never);
  return { minaPk, owner, people };
}
