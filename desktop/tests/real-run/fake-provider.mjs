// Scripted fake OpenAI-compatible model provider for the fresh-HOME wording gate (G2). No dependencies, loopback only.
//
// Colony's bundled agent (buzz-agent) talks non-streaming chat completions to OPENAI_COMPAT_BASE_URL. This server answers
// them with tool calls that make the REAL agent run REAL commands in the REAL nest (pwd, ls, cat AGENTS.md, the colony
// command line, a file write, a message post), then a plain text reply that echoes the tool output, posted through the
// same `colony messages send` a real model would use. No credential, no network beyond 127.0.0.1.
//
//   import { startFakeProvider } from "./fake-provider.mjs"; const fake = await startFakeProvider({ logFile });
import { appendFileSync } from "node:fs";
import http from "node:http";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu;
const HEX64 = /[0-9a-f]{64}/gu;

const textOf = (content) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => (typeof part === "string" ? part : (part?.text ?? ""))).join("\n")
      : "";

/** The scripted commands for what the person asked. `ctx` carries ids parsed from the prompt and earlier tool output. */
// 1x1 PNG, used by the dev-tools tour.
const TINY_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export function scenarioFor(human, ctx) {
  const t = human.toLowerCase();
  const channel = ctx.generalId ?? ctx.channelId;
  if (/use every one of your tools/u.test(t))
    return {
      name: "devtools",
      echo: "plain",
      cmds: [
        // shell: make a text file and a tiny PNG in the working folder
        `printf 'tour line one\\ntour line two\\n' > tour.txt; (printf '%s' '${TINY_PNG_B64}' | base64 -d 2>/dev/null || printf '%s' '${TINY_PNG_B64}' | base64 -D) > tour.png; ls -la tour.txt tour.png`,
        { tool: "read_file", args: { path: "tour.txt" } },
        { tool: "str_replace", args: { path: "tour.txt", old_str: "tour line one", new_str: "tour line 1 edited" } },
        { tool: "todo", args: { todos: [{ text: "Check the tour file", done: true }, { text: "Report back", done: false }] } },
        { tool: "view_image", args: { source: "tour.png" } },
      ],
    };
  if (/what commands and tools did you use/u.test(t))
    return { name: "commands", cmds: ["pwd", "colony --help"], echo: "commands" };
  if (/know about our business/u.test(t))
    return { name: "business", cmds: ["pwd", "ls -la", "sed -n 1,40p AGENTS.md"] };
  if (/list the channels/u.test(t)) return { name: "channels", cmds: ["colony channels list"] };
  if (/post a one line hello/u.test(t))
    return {
      name: "post",
      cmds: [
        "colony channels list",
        (res) => {
          const line = String(res[0] ?? "").split("\n").find((l) => /general/iu.test(l) && UUID.test(l));
          UUID.lastIndex = 0;
          const id = line?.match(UUID)?.[0] ?? channel;
          UUID.lastIndex = 0;
          return `colony messages send --channel ${id} --content "Hello team, Scout here."`;
        },
      ],
    };
  if (/create a file called gate-check/u.test(t))
    return {
      name: "file",
      cmds: ["printf '# Gate check\\n\\nWritten by the scripted gate model.\\n' > gate-check.md && cat gate-check.md", "pwd"],
    };
  if (/search our messages/u.test(t))
    return { name: "search", cmds: ["colony messages search --query welcome"] };
  if (/who is on our team/u.test(t)) return { name: "people", cmds: ["colony users list"] };
  return { name: "generic", cmds: ["pwd"] };
}

function pickShell(tools = []) {
  const tool = tools.find((t) => /shell|bash|exec|run_command/iu.test(t?.function?.name ?? ""));
  if (!tool) return null;
  const props = Object.keys(tool.function.parameters?.properties ?? {});
  const key = ["command", "cmd", "script"].find((k) => props.includes(k)) ?? props[0] ?? "command";
  return { name: tool.function.name, key };
}

function pickNamed(tools = [], base) {
  const tool = tools.find((t) => {
    const n = t?.function?.name ?? "";
    return n === base || n.endsWith(`__${base}`);
  });
  return tool ? tool.function.name : null;
}

export async function startFakeProvider({ logFile, port = 0 } = {}) {
  const sessions = { requests: 0, turns: [] };
  const log = (entry) => {
    if (logFile) appendFileSync(logFile, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      sessions.requests += 1;
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      } catch {
        /* keep empty */
      }
      const reply = (message, finish) => {
        const payload = {
          id: `chatcmpl-gate-${sessions.requests}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: body.model ?? "fake-model",
          choices: [{ index: 0, message, finish_reason: finish }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.method === "GET" && /\/models\/?$/u.test(req.url ?? "")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ object: "list", data: [{ id: "fake-model", object: "model", owned_by: "gate" }] }));
        return;
      }
      if (!/chat\/completions/u.test(req.url ?? "")) {
        log({ kind: "other-path", url: req.url, method: req.method });
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "not found" } }));
        return;
      }
      const messages = body.messages ?? [];
      const tools = body.tools ?? [];
      // What the agent is told: the first request that carries tools, in full (system text, tool names and descriptions).
      if (tools.length && !sessions.firstFull) {
        sessions.firstFull = true;
        if (logFile)
          appendFileSync(`${logFile}.first-request.json`, JSON.stringify({ messages, tools }, null, 1));
      }
      // Connection test from onboarding: tool-free, "Reply OK."
      if (!tools.length && messages.some((m) => /reply ok\./iu.test(textOf(m.content)))) {
        log({ kind: "connection-test", model: body.model });
        return reply({ role: "assistant", content: "OK" }, "stop");
      }
      // Find the last user message (the Colony event prompt) and the tool results that followed it.
      let lastUser = -1;
      for (let i = messages.length - 1; i >= 0; i -= 1) if (messages[i].role === "user") { lastUser = i; break; }
      const userText = lastUser >= 0 ? textOf(messages[lastUser].content) : "";
      const after = messages.slice(lastUser + 1);
      const results = after.filter((m) => m.role === "tool").map((m) => textOf(m.content));
      // Everything the agent said and ran earlier in the session, for the "what did you run" turn.
      const ranBefore = messages
        .slice(0, lastUser + 1)
        .flatMap((m) => (m.role === "assistant" ? (m.tool_calls ?? []) : []))
        .map((c) => {
          try {
            return Object.values(JSON.parse(c.function.arguments))[0];
          } catch {
            return "";
          }
        })
        .filter(Boolean);
      const humanMatch = [...userText.matchAll(/Content:\s*([^\n]+)/gu)].pop();
      const human = (humanMatch ? humanMatch[1] : userText).slice(0, 800);
      const replyTo = userText.match(/--reply-to ([0-9a-f]{64})/u)?.[1] ?? userText.match(HEX64)?.[0] ?? null;
      const ids = userText.match(UUID) ?? [];
      const channelId = (userText.match(/--channel ([0-9a-f-]{36})/u) ?? [])[1] ?? ids[0] ?? null;
      const allResults = results.join("\n");
      const generalId = (() => {
        const line = [...messages].reverse().map((m) => textOf(m.content)).join("\n").split("\n").find((l) => /general/iu.test(l) && UUID.test(l));
        UUID.lastIndex = 0;
        return line?.match(UUID)?.[0] ?? null;
      })();
      const ctx = { channelId, generalId, replyTo };
      const scenario = scenarioFor(human, ctx);
      const shell = pickShell(tools);
      const step = results.length;
      log({
        kind: "turn",
        step,
        scenario: scenario.name,
        model: body.model,
        tools: tools.map((t) => t?.function?.name),
        shell,
        messagesCount: messages.length,
        humanText: human.slice(0, 300),
        ctx,
        lastUserHead: userText.slice(0, 1500),
        lastResult: (results[results.length - 1] ?? "").slice(0, 800),
      });
      if (!shell) {
        return reply({ role: "assistant", content: "No shell tool was offered to me in this turn." }, "stop");
      }
      const call = (command) => {
        // A step is a shell command (string) or { tool, args } for one of the other dev tools.
        let name = shell.name;
        let args = { [shell.key]: command };
        if (command && typeof command === "object") {
          const named = pickNamed(tools, command.tool);
          if (!named) return reply({ role: "assistant", content: `The ${command.tool} tool was not offered to me.` }, "stop");
          name = named;
          args = command.args;
        }
        return reply(
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: `call_${sessions.requests}_${step}`,
                type: "function",
                function: { name, arguments: JSON.stringify(args) },
              },
            ],
          },
          "tool_calls",
        );
      };
      const cmds = scenario.cmds.map((c) => (typeof c === "function" ? c(results) : c));
      if (step < cmds.length) return call(cmds[step]);
      if (step === cmds.length) {
        // Compose the plain text reply that echoes what the tools printed, and post it the way a real model would.
        const echo = cmds
          .map((cmd, i) => `$ ${typeof cmd === "object" ? `${cmd.tool} ${JSON.stringify(cmd.args)}` : cmd}\n${(results[i] ?? "").slice(0, 1400)}`)
          .join("\n\n");
        const lead =
          scenario.echo === "commands"
            ? `Here are the commands I used, and the folder I work in.\n\nEarlier in this session: ${ranBefore.slice(-8).join(" ; ")}\n\n`
            : `Here is what I found.\n\n`;
        const text = (scenario.echo === "plain" ? "Tour finished. I ran a command, read a file, edited it, updated the to-do list and looked at an image." : `${lead}${echo}`).replace(/G2EOF/gu, "G2 EOF");
        const where = ctx.replyTo ? ` --reply-to ${ctx.replyTo}` : "";
        const post = `cat > .scratch-reply.txt <<'G2EOF'\n${text}\nG2EOF\ncolony messages send --channel ${ctx.channelId}${where} --content "$(cat .scratch-reply.txt)" && rm -f .scratch-reply.txt`;
        return call(post);
      }
      return reply({ role: "assistant", content: "Done." }, "stop");
    });
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/v1`;
  return { url, stats: () => ({ ...sessions }), close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fake = await startFakeProvider({ logFile: process.argv[2], port: Number(process.argv[3] ?? 0) });
  console.log(`fake provider at ${fake.url}`);
}
