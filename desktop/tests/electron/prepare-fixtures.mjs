import { mkdirSync, chmodSync, writeFileSync } from "node:fs";
import path from "node:path";

import { generateSecretKey, getPublicKey } from "nostr-tools";
import { nsecEncode } from "nostr-tools/nip19";

const output = process.argv[2] ?? process.env.COLONY_ELECTRON_FIXTURE_FILE;
if (!output) {
  throw new Error("Pass a private output path for generated relay identities");
}

const names = [
  "onboarding-member",
  "send-member",
  "receive-member",
  "receive-publisher",
  "restart-member",
  "restart-publisher",
  "reconnect-member",
  "reconnect-publisher",
];
const identities = Object.fromEntries(
  names.map((name) => {
    const secretKey = generateSecretKey();
    return [
      name,
      {
        publicKey: getPublicKey(secretKey),
        nsec: nsecEncode(secretKey),
        secretKeyHex: Buffer.from(secretKey).toString("hex"),
      },
    ];
  }),
);

const outputPath = path.resolve(output);
mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
writeFileSync(outputPath, `${JSON.stringify({ identities }, null, 2)}\n`, {
  mode: 0o600,
});
chmodSync(outputPath, 0o600);
console.log(
  `Generated ${names.length} isolated relay identities at ${outputPath}`,
);
