import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  verifyEvent,
} from 'nostr-tools';

const relayHttp = process.env.INTEROP_RELAY_HTTP ?? 'http://localhost:3000';
const relayWs = relayHttp.replace(/^http/, 'ws');
const keyFile = process.env.ANDROID_INTEROP_KEY_FILE;
const starterNamespace = '3ce33bea-8f09-5f1b-9c85-8a7d2659e6b0';
const maxWatchReconnects = 12;

function fail(message) {
  throw new Error(message);
}

function assertLocalRelay() {
  let url;
  try {
    url = new URL(relayHttp);
  } catch {
    fail('interop relay URL is invalid');
  }
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.port !== '3000' ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    fail('Android interop is restricted to the disposable HTTP relay on port 3000');
  }
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key.startsWith('--')) fail(`unexpected argument: ${key}`);
    const value = values[index + 1];
    if (value === undefined || value.startsWith('--')) {
      fail(`missing value for ${key}`);
    }
    result[key.slice(2)] = value;
    index += 1;
  }
  return result;
}

function uuidV5(namespace, name) {
  const namespaceBytes = Buffer.from(namespace.replaceAll('-', ''), 'hex');
  if (namespaceBytes.length !== 16) fail('UUID namespace must be 16 bytes');
  const digest = createHash('sha1')
    .update(Buffer.concat([namespaceBytes, Buffer.from(name, 'utf8')]))
    .digest();
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function channelIdFor(relayOrigin, slug) {
  const scope = relayOrigin.trim().replace(/\/+$/, '');
  return uuidV5(starterNamespace, `starter-channel:v1:${scope}:${slug}`);
}

function assertChannelContract() {
  const general = channelIdFor('https://relay.example.com/', 'general');
  if (general !== '9ed9563a-84d6-586d-8007-ae294a6dfdaf') {
    fail(`starter channel UUID contract changed: ${general}`);
  }
  const welcome = channelIdFor('https://relay.example.com', 'welcome-everyone');
  if (welcome !== '1e288e10-2f7d-5c2c-9a9f-dee58c8daa7a') {
    fail(`starter channel UUID contract changed: ${welcome}`);
  }
}

function loadKey(file = keyFile) {
  if (!file) fail('ANDROID_INTEROP_KEY_FILE is not set');
  const record = JSON.parse(readFileSync(file, 'utf8'));
  if (
    typeof record.secretKeyHex !== 'string' ||
    !/^[0-9a-f]{64}$/.test(record.secretKeyHex) ||
    typeof record.pubkey !== 'string' ||
    !/^[0-9a-f]{64}$/.test(record.pubkey)
  ) {
    fail('peer key file has an invalid shape');
  }
  const secretKey = Uint8Array.from(Buffer.from(record.secretKeyHex, 'hex'));
  if (getPublicKey(secretKey) !== record.pubkey) {
    fail('peer key file public key does not match its secret key');
  }
  return { secretKey, secretKeyHex: record.secretKeyHex, pubkey: record.pubkey };
}

function writeJson(file, value, mode = 0o600) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode });
  chmodSync(file, mode);
}

function writeLine(file, value) {
  appendFileSync(file, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

async function provision(keyPath, invitePath, githubEnvPath) {
  assertChannelContract();
  const secretKey = generateSecretKey();
  const secretKeyHex = Buffer.from(secretKey).toString('hex');
  const pubkey = getPublicKey(secretKey);
  writeJson(keyPath, { secretKeyHex, pubkey });
  writeJson(invitePath, { relay: relayWs, code: '', channelId: '' });

  if (githubEnvPath && existsSync(githubEnvPath)) {
    appendFileSync(
      githubEnvPath,
      [
        `BUZZ_RELAY_PRIVATE_KEY=${secretKeyHex}`,
        `ANDROID_INTEROP_KEY_FILE=${resolve(keyPath)}`,
        `ANDROID_INTEROP_INVITE_PATH=${resolve(invitePath)}`,
        '',
      ].join('\n'),
    );
  }
  console.log(`PASS peer-key-ready pubkey=${pubkey}`);
}

async function mintInvite(outputPath) {
  const { secretKey } = loadKey();
  const url = new URL('/api/invites', relayHttp).toString();
  const body = Buffer.from(JSON.stringify({ ttl_secs: 3600, max_uses: 1 }));
  const authEvent = finalizeEvent(
    {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['u', url],
        ['method', 'POST'],
        ['payload', createHash('sha256').update(body).digest('hex')],
        ['nonce', randomUUID()],
      ],
      content: '',
    },
    secretKey,
  );
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Nostr ${Buffer.from(JSON.stringify(authEvent)).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    fail(`invite mint failed: HTTP ${response.status} ${result.error ?? ''}`);
  }
  if (typeof result.code !== 'string' || !result.code.startsWith('v2.')) {
    fail('relay returned an unexpected invite contract');
  }
  const relayOrigin = new URL(relayHttp).origin;
  writeJson(outputPath, {
    relay: relayWs,
    code: result.code,
    channelId: channelIdFor(relayOrigin, 'welcome-everyone'),
  });
  console.log('PASS invite-minted uses=1 ttl_seconds=3600');
}

function readInvite(file) {
  const invite = JSON.parse(readFileSync(file, 'utf8'));
  if (
    typeof invite.code !== 'string' ||
    !invite.code.startsWith('v2.') ||
    typeof invite.relay !== 'string' ||
    typeof invite.channelId !== 'string'
  ) {
    fail('invite file is incomplete');
  }
  return invite;
}

function inviteLink(file) {
  const invite = readInvite(file);
  const query = new URLSearchParams({ relay: invite.relay, code: invite.code });
  console.log(`buzz://join?${query.toString()}`);
}

function channelLink(file) {
  const invite = readInvite(file);
  console.log(`buzz://channel/${invite.channelId}`);
}

async function openRelayConnection(onFrame, timeoutMs = 20_000) {
  if (typeof WebSocket !== 'function') fail('Node WebSocket is unavailable');
  const { secretKey } = loadKey();
  const socket = new WebSocket(relayWs);
  let authEventId;
  let authenticated = false;
  let closed = false;
  let resolveAuth;
  let rejectAuth;
  let resolveClose;
  const authPromise = new Promise((resolve, reject) => {
    resolveAuth = resolve;
    rejectAuth = reject;
  });
  const closedPromise = new Promise((resolve) => {
    resolveClose = resolve;
  });
  const authTimer = setTimeout(() => {
    if (!authenticated) rejectAuth(new Error('NIP-42 authentication timed out'));
    socket.close();
  }, timeoutMs);

  socket.addEventListener('message', (message) => {
    let frame;
    try {
      const raw = typeof message.data === 'string'
        ? message.data
        : Buffer.from(message.data).toString('utf8');
      frame = JSON.parse(raw);
    } catch {
      rejectAuth(new Error('relay sent malformed JSON'));
      socket.close();
      return;
    }
    if (!Array.isArray(frame) || typeof frame[0] !== 'string') return;

    if (frame[0] === 'AUTH' && typeof frame[1] === 'string') {
      const authEvent = finalizeEvent(
        {
          kind: 22242,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['relay', relayWs],
            ['challenge', frame[1]],
          ],
          content: '',
        },
        secretKey,
      );
      authEventId = authEvent.id;
      socket.send(JSON.stringify(['AUTH', authEvent]));
      return;
    }

    if (frame[0] === 'OK' && frame[1] === authEventId) {
      if (frame[2] !== true) {
        rejectAuth(new Error(`relay rejected NIP-42 auth: ${String(frame[3] ?? '')}`));
        socket.close();
        return;
      }
      authenticated = true;
      clearTimeout(authTimer);
      resolveAuth();
      return;
    }

    onFrame(frame);
  });

  socket.addEventListener('error', () => {
    if (!authenticated) rejectAuth(new Error('relay WebSocket failed'));
  });
  socket.addEventListener('close', () => {
    closed = true;
    clearTimeout(authTimer);
    if (!authenticated) rejectAuth(new Error('relay closed before NIP-42 auth'));
    resolveClose();
  });

  await authPromise;
  return {
    send(frame) {
      if (closed || socket.readyState !== WebSocket.OPEN) {
        fail('relay WebSocket is not open');
      }
      socket.send(JSON.stringify(frame));
    },
    close() {
      if (!closed) socket.close();
    },
    closed: closedPromise,
  };
}

async function publish({ channelId, content, replyTo, resultPath }) {
  if (!/^[0-9a-f-]{36}$/i.test(channelId)) fail('channel id must be a UUID');
  if (!content || content.length > 180 || content.includes('\n')) {
    fail('message content must be one non-empty line of at most 180 characters');
  }
  if (replyTo && !/^[0-9a-f]{64}$/i.test(replyTo)) {
    fail('reply root must be a 64-character event id');
  }
  const { secretKey, pubkey } = loadKey();
  const tags = [['h', channelId]];
  if (replyTo) {
    tags.push(['e', replyTo, '', 'root']);
    tags.push(['e', replyTo, '', 'reply']);
  }
  const event = finalizeEvent(
    {
      kind: 9,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content,
    },
    secretKey,
  );
  if (event.pubkey !== pubkey || !verifyEvent(event)) {
    fail('nostr-tools produced an invalid kind 9 event');
  }

  let resolveOk;
  let rejectOk;
  const accepted = new Promise((resolve, reject) => {
    resolveOk = resolve;
    rejectOk = reject;
  });
  const connection = await openRelayConnection((frame) => {
    if (frame[0] === 'OK' && frame[1] === event.id) {
      if (frame[2] === true) resolveOk();
      else rejectOk(new Error(`relay rejected event: ${String(frame[3] ?? '')}`));
    }
  });
  const timer = setTimeout(() => rejectOk(new Error('relay EVENT OK timed out')), 20_000);
  try {
    connection.send(['EVENT', event]);
    await accepted;
  } finally {
    clearTimeout(timer);
    connection.close();
  }

  const result = {
    id: event.id,
    pubkey: event.pubkey,
    kind: event.kind,
    content: event.content,
    tags: event.tags,
    channelId,
  };
  if (resultPath) writeJson(resultPath, result, 0o600);
  console.log(
    `PASS peer-publish id=${event.id} kind=9 channel=${channelId} reply_to=${replyTo ?? 'none'}`,
  );
}

function parseEventFile(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function waitReady(eventsPath, count, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const readyCount = parseEventFile(eventsPath).filter(
      (entry) => entry.type === 'ready',
    ).length;
    if (readyCount >= count) {
      console.log(`PASS peer-ready subscriptions=${readyCount}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail(`peer did not establish subscription ${count} within ${timeoutSeconds}s`);
}

async function waitEvent({
  eventsPath,
  content,
  channelId,
  timeoutSeconds,
  replyRoot,
  excludePubkey,
}) {
  if (excludePubkey && !/^[0-9a-f]{64}$/i.test(excludePubkey)) {
    fail('excluded author must be a 64-character public key');
  }
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    for (const entry of parseEventFile(eventsPath)) {
      const event = entry.event;
      if (
        entry.type !== 'event' ||
        event?.kind !== 9 ||
        event.content !== content ||
        (excludePubkey && event.pubkey?.toLowerCase() === excludePubkey.toLowerCase()) ||
        !verifyEvent(event) ||
        !event.tags.some((tag) => tag[0] === 'h' && tag[1] === channelId)
      ) {
        continue;
      }
      if (replyRoot) {
        const hasRoot = event.tags.some(
          (tag) => tag[0] === 'e' && tag[1] === replyRoot && tag[3] === 'root',
        );
        const hasReply = event.tags.some(
          (tag) => tag[0] === 'e' && tag[1] === replyRoot && tag[3] === 'reply',
        );
        if (!hasRoot || !hasReply) continue;
      }
      console.log(
        `PASS relay-event id=${event.id} kind=9 channel=${channelId} content=${content} reply_root=${replyRoot ?? 'none'}`,
      );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail(`relay peer did not receive expected event content=${content}`);
}

async function watch(channelId, eventsPath) {
  if (!/^[0-9a-f-]{36}$/i.test(channelId)) fail('channel id must be a UUID');
  mkdirSync(dirname(eventsPath), { recursive: true });
  writeFileSync(eventsPath, '', { mode: 0o600 });
  chmodSync(eventsPath, 0o600);
  let stop = false;
  let activeConnection;
  let reconnects = 0;
  process.once('SIGTERM', () => {
    stop = true;
    activeConnection?.close();
  });
  process.once('SIGINT', () => {
    stop = true;
    activeConnection?.close();
  });

  while (!stop) {
    let subscribed = false;
    const subscriptionId = `android-interop-${randomUUID()}`;
    try {
      const connection = await openRelayConnection((frame) => {
        if (frame[0] === 'EOSE' && frame[1] === subscriptionId && !subscribed) {
          subscribed = true;
          writeLine(eventsPath, {
            type: 'ready',
            channelId,
            at: new Date().toISOString(),
          });
          console.log(`WATCH_READY channel=${channelId} subscription=${subscriptionId}`);
          return;
        }
        if (frame[0] === 'EVENT' && frame[1] === subscriptionId) {
          const event = frame[2];
          if (
            event?.kind !== 9 ||
            !Array.isArray(event.tags) ||
            !event.tags.some((tag) => tag[0] === 'h' && tag[1] === channelId) ||
            !verifyEvent(event)
          ) {
            console.error('WATCH_REJECTED invalid or out-of-scope event');
            process.exitCode = 1;
            connection.close();
            return;
          }
          writeLine(eventsPath, { type: 'event', event });
          console.log(`WATCH_EVENT id=${event.id} kind=9 channel=${channelId}`);
          return;
        }
        if (frame[0] === 'CLOSED' && frame[1] === subscriptionId) {
          console.error(`WATCH_CLOSED ${String(frame[2] ?? '')}`);
          connection.close();
        }
      });
      activeConnection = connection;
      connection.send([
        'REQ',
        subscriptionId,
        { kinds: [9], '#h': [channelId] },
      ]);
      await connection.closed;
      activeConnection = undefined;
      if (stop) break;
      writeLine(eventsPath, { type: 'disconnected', at: new Date().toISOString() });
      console.log('WATCH_DISCONNECTED');
    } catch (error) {
      activeConnection = undefined;
      if (stop) break;
      console.error(`WATCH_RECONNECT_ERROR ${String(error)}`);
    }
    if (stop) break;
    reconnects += 1;
    if (reconnects > maxWatchReconnects) {
      fail(`peer exceeded ${maxWatchReconnects} reconnect attempts`);
    }
    const delayMs = Math.min(1000 * 2 ** Math.min(reconnects - 1, 4), 15_000);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

async function main() {
  assertLocalRelay();
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  switch (command) {
    case 'verify':
      assertChannelContract();
      if (typeof WebSocket !== 'function') fail('Node WebSocket is unavailable');
      console.log('PASS peer-contract uuidv5 kind9 nip10 websocket');
      break;
    case 'provision':
      if (!args.key || !args.invite) {
        fail('provision requires --key and --invite');
      }
      await provision(args.key, args.invite, process.env.GITHUB_ENV);
      break;
    case 'pubkey':
      console.log(loadKey().pubkey);
      break;
    case 'mint-invite':
      if (!args.output) fail('mint-invite requires --output');
      await mintInvite(args.output);
      break;
    case 'invite-link':
      if (!args.input) fail('invite-link requires --input');
      inviteLink(args.input);
      break;
    case 'channel-link':
      if (!args.input) fail('channel-link requires --input');
      channelLink(args.input);
      break;
    case 'publish':
      if (!args.channel || !args.content) {
        fail('publish requires --channel and --content');
      }
      await publish({
        channelId: args.channel,
        content: args.content,
        replyTo: args['reply-to'],
        resultPath: args.result,
      });
      break;
    case 'watch':
      if (!args.channel || !args.events) {
        fail('watch requires --channel and --events');
      }
      await watch(args.channel, args.events);
      break;
    case 'wait-ready':
      if (!args.events) fail('wait-ready requires --events');
      await waitReady(args.events, Number(args.count ?? 1), Number(args.timeout ?? 45));
      break;
    case 'wait-event':
      if (!args.events || !args.content || !args.channel) {
        fail('wait-event requires --events, --content, and --channel');
      }
      await waitEvent({
        eventsPath: args.events,
        content: args.content,
        channelId: args.channel,
        timeoutSeconds: Number(args.timeout ?? 45),
        replyRoot: args['reply-root'],
        excludePubkey: args['exclude-pubkey'],
      });
      break;
    default:
      fail('expected verify, provision, pubkey, mint-invite, invite-link, channel-link, publish, watch, wait-ready, or wait-event');
  }
}

main().catch((error) => {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
