import { createServer } from "node:http";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";

const HOST = "127.0.0.1";
const PORT = Number(process.env.COLONY_TEST_GOOGLE_JWKS_PORT ?? "8765");
const MAX_BODY_BYTES = 4096;
const kid = randomUUID();
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const jwk = {
  ...publicKey.export({ format: "jwk" }),
  alg: "RS256",
  kid,
  use: "sig",
};

function sendJson(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function encodePart(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new RangeError("request body too large");
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/healthz") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (request.method === "GET" && request.url === "/.well-known/jwks.json") {
    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
    });
    response.end(JSON.stringify({ keys: [jwk] }));
    return;
  }

  if (request.method === "POST" && request.url === "/token") {
    try {
      const input = await readJson(request);
      const email = typeof input.email === "string" ? input.email : "";
      const audience = typeof input.audience === "string" ? input.audience : "";
      const subject = typeof input.subject === "string" ? input.subject : "";
      if (
        email.length < 3 ||
        email.length > 254 ||
        !email.includes("@") ||
        audience.length === 0 ||
        audience.length > 256 ||
        subject.length === 0 ||
        subject.length > 255
      ) {
        sendJson(response, 400, { error: "invalid_request" });
        return;
      }

      const now = Math.floor(Date.now() / 1000);
      const signingInput = `${encodePart({ alg: "RS256", kid, typ: "JWT" })}.${encodePart({
        aud: audience,
        email,
        email_verified: true,
        exp: now + 300,
        iat: now,
        iss: "https://accounts.google.com",
        sub: subject,
      })}`;
      const signature = sign("RSA-SHA256", Buffer.from(signingInput), privateKey).toString(
        "base64url",
      );
      sendJson(response, 200, { id_token: `${signingInput}.${signature}` });
    } catch (error) {
      sendJson(response, error instanceof RangeError ? 413 : 400, {
        error: "invalid_request",
      });
    }
    return;
  }

  sendJson(response, 404, { error: "not_found" });
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`test JWKS server ready on ${HOST}:${PORT}\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
