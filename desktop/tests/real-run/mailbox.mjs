import { randomBytes } from "node:crypto";

async function request(endpoint, options = {}) {
  const response = await fetch(`https://api.mail.tm${endpoint}`, {
    ...options,
    signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (!response.ok) throw new Error(`Disposable inbox HTTP ${response.status}`);
  return response.json();
}

export async function createSmokeInbox() {
  const domains = await request("/domains");
  const domain = domains["hydra:member"]?.find(
    (item) => item.isActive && !item.isPrivate,
  )?.domain;
  if (!domain) throw new Error("No disposable inbox domain available.");
  const email = `colony-launch-check-${randomBytes(6).toString("hex")}@${domain}`;
  const password = `${randomBytes(24).toString("base64url")}aA9!`;
  const body = JSON.stringify({ address: email, password });
  await request("/accounts", { method: "POST", body });
  const { token } = await request("/token", { method: "POST", body });
  if (!token) throw new Error("Disposable inbox authentication failed.");
  return {
    email,
    password,
    async verificationCode(timeoutMs = 90000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const headers = { Authorization: `Bearer ${token}` };
        const messages = await request("/messages", { headers });
        for (const message of (messages["hydra:member"] ?? []).slice(0, 10)) {
          const detail = await request(
            `/messages/${encodeURIComponent(message.id)}`,
            { headers },
          );
          const text = `${detail.subject ?? ""} ${detail.text ?? ""} ${(detail.html ?? []).join(" ")}`;
          const code = text.match(/\b([0-9]{6})\b/)?.[1];
          if (code) return code;
        }
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
      throw new Error("Verification inbox deadline reached. No code recorded.");
    },
  };
}
