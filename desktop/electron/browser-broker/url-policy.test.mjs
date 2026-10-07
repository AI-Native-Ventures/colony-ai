import assert from "node:assert/strict";
import test from "node:test";
import {
  checkAddresses,
  checkUrl,
  classifyIp,
  guardNavigation,
  isOriginAllowed,
  normalizePrivateExceptions,
  originOf,
  parseIPv4,
  parseIPv6,
  resolveAndPin,
} from "./url-policy.mjs";

const denied = (url, code = "private_network_denied", options) => {
  const result = checkUrl(url, options);
  assert.equal(result.ok, false, `${url} should be denied`);
  assert.equal(result.code, code, `${url} code`);
};

test("public https and http URLs pass the syntactic check", () => {
  const result = checkUrl("https://Example.com/a?b=1#c");
  assert.equal(result.ok, true);
  assert.equal(result.origin, "https://example.com");
  assert.equal(result.hostname, "example.com");
  assert.equal(result.port, 443);
  assert.equal(result.needsResolution, true);
  assert.equal(checkUrl("http://example.com:8080/").port, 8080);
  assert.equal(checkUrl("http://93.184.216.34/").ip, "93.184.216.34");
});

test("unsupported schemes are denied by name", () => {
  for (const url of [
    "file:///etc/passwd",
    "chrome://settings",
    "devtools://devtools/bundled/inspector.html",
    "data:text/html,<script>alert(1)</script>",
    "javascript:alert(1)",
    "blob:https://example.com/abc",
    "about:blank",
    "view-source:https://example.com",
    "ftp://example.com/",
    "ws://example.com/",
    "wss://example.com/",
    "chrome-extension://abc/index.html",
    "mailto:a@b.co",
  ]) {
    denied(url, "scheme_denied");
  }
});

test("malformed, oversized and control-character URLs are invalid", () => {
  for (const url of [
    "",
    " https://example.com",
    "https://example.com ",
    "https://exa\nmple.com",
    "java\tscript:alert(1)",
    "not a url",
    "https://",
    `https://example.com/${"a".repeat(9000)}`,
    "https://user:pw@example.com/",
    "https://user@example.com/",
  ]) {
    denied(url, "invalid_input");
  }
  assert.equal(checkUrl(undefined).code, "invalid_input");
  assert.equal(checkUrl(42).code, "invalid_input");
});

test("localhost and local style host names are denied", () => {
  for (const url of [
    "http://localhost/",
    "http://LOCALHOST:3000/",
    "http://localhost./",
    "http://app.localhost/",
    "http://printer.local/",
    "http://metadata.google.internal/",
    "http://router.lan/",
    "http://nas.home.arpa/",
    "http://intranet/",
    "http://router/",
    "http://wiki.corp/",
  ]) {
    denied(url);
  }
});

test("IPv4 private, loopback, link-local and reserved ranges are denied", () => {
  for (const ip of [
    "0.0.0.0",
    "10.0.0.1",
    "10.255.255.255",
    "100.64.0.1",
    "100.127.255.255",
    "127.0.0.1",
    "127.255.255.254",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.1",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.19.255.255",
    "198.51.100.7",
    "203.0.113.9",
    "224.0.0.1",
    "239.255.255.255",
    "240.0.0.1",
    "255.255.255.255",
  ]) {
    denied(`http://${ip}/`);
    assert.equal(classifyIp(ip).allowed, false, ip);
  }
});

test("IPv4 neighbours of denied ranges are allowed", () => {
  for (const ip of [
    "9.255.255.255",
    "11.0.0.1",
    "100.63.255.255",
    "100.128.0.1",
    "126.255.255.255",
    "128.0.0.1",
    "169.253.255.255",
    "169.255.0.1",
    "172.15.255.255",
    "172.32.0.1",
    "192.167.255.255",
    "192.169.0.1",
    "198.17.255.255",
    "198.20.0.1",
    "223.255.255.255",
    "8.8.8.8",
    "93.184.216.34",
  ]) {
    assert.equal(classifyIp(ip).allowed, true, ip);
  }
});

test("obfuscated IPv4 spellings normalize and are denied", () => {
  for (const url of [
    "http://2130706433/",
    "http://0x7f000001/",
    "http://0x7f.1/",
    "http://017700000001/",
    "http://127.1/",
    "http://0177.0.0.1/",
    "http://0/",
    "http://3232235777/",
    "http://0xa9fea9fe/",
  ]) {
    denied(url);
  }
});

test("IPv6 loopback, unique local, link-local and mapped forms are denied", () => {
  for (const url of [
    "http://[::1]/",
    "http://[::]/",
    "http://[fc00::1]/",
    "http://[fd12:3456:789a::1]/",
    "http://[fe80::1]/",
    "http://[febf::1]/",
    "http://[fec0::1]/",
    "http://[ff02::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:10.0.0.1]/",
    "http://[::ffff:169.254.169.254]/",
    "http://[::ffff:a9fe:a9fe]/",
    "http://[2001:db8::1]/",
    "http://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/",
    "http://[2002:7f00:1::1]/",
    "http://[2002:0a00:0001::1]/",
    "http://[64:ff9b::7f00:1]/",
    "http://[64:ff9b:1::1]/",
    "http://[fd00:ec2::254]/",
    "http://[100::1]/",
    "http://[::127.0.0.1]/",
  ]) {
    denied(url);
  }
});

test("global unicast IPv6 and public embedded forms are allowed", () => {
  for (const ip of [
    "2606:4700:4700::1111",
    "2a00:1450:4001:81b::200e",
    "2001:4860:4860::8888",
    "::ffff:8.8.8.8",
    "64:ff9b::808:808",
    "2002:0808:0808::1",
  ]) {
    assert.equal(classifyIp(ip).allowed, true, ip);
  }
  assert.equal(checkUrl("https://[2606:4700:4700::1111]/").ok, true);
});

test("classifyIp fails closed on non-canonical input", () => {
  for (const value of [
    undefined,
    null,
    42,
    "",
    "example.com",
    "1.2.3",
    "01.2.3.4",
    "1.2.3.4.5",
    "256.1.1.1",
    "::1%eth0",
    "1::2::3",
    "12345::1",
    "[::1]",
  ]) {
    assert.equal(classifyIp(value).allowed, false, String(value));
  }
});

test("parseIPv4 and parseIPv6 handle edge forms", () => {
  assert.deepEqual(parseIPv4("1.2.3.4"), [1, 2, 3, 4]);
  assert.equal(parseIPv4("1.2.3.04"), null);
  assert.equal(parseIPv4("1.2.3.256"), null);
  assert.equal(parseIPv6("::").length, 16);
  assert.deepEqual(parseIPv6("::1").slice(14), [0, 1]);
  assert.deepEqual(
    parseIPv6("::ffff:1.2.3.4").slice(10),
    [0xff, 0xff, 1, 2, 3, 4],
  );
  assert.deepEqual(
    parseIPv6("1:2:3:4:5:6:7:8"),
    [0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6, 0, 7, 0, 8],
  );
  assert.equal(parseIPv6("1:2:3:4:5:6:7"), null);
  assert.equal(parseIPv6("1:2:3:4:5:6:7:8:9"), null);
  assert.equal(parseIPv6("1:2:3:4:5:6:7::8"), null);
  assert.equal(parseIPv6(":1:2:3:4:5:6:7"), null);
  assert.equal(parseIPv6("fe80::1%1"), null);
});

test("explicit private exceptions unlock only the named host and port", () => {
  const options = {
    privateExceptions: ["localhost:3000", "192.168.1.20:8080"],
  };
  const local = checkUrl("http://localhost:3000/app", options);
  assert.equal(local.ok, true);
  assert.equal(local.exception, true);
  assert.equal(checkUrl("http://192.168.1.20:8080/", options).ok, true);
  denied("http://localhost:3001/", "private_network_denied", options);
  denied("http://localhost/", "private_network_denied", options);
  denied("http://192.168.1.21:8080/", "private_network_denied", options);
  denied("http://127.0.0.1:3000/", "private_network_denied", options);
});

test("link-local and metadata addresses can never be unlocked", () => {
  const options = {
    privateExceptions: [
      "169.254.169.254:80",
      "0.0.0.0:80",
      "[fe80::1]:80",
      "224.0.0.1:80",
    ],
  };
  denied("http://169.254.169.254/", "private_network_denied", options);
  denied("http://0.0.0.0/", "private_network_denied", options);
  denied("http://[fe80::1]/", "private_network_denied", options);
  denied("http://224.0.0.1/", "private_network_denied", options);
});

test("exception list is validated", () => {
  assert.deepEqual(normalizePrivateExceptions(undefined), []);
  assert.deepEqual(
    normalizePrivateExceptions(["LocalHost:3000", "localhost:3000"]),
    ["localhost:3000"],
  );
  assert.deepEqual(normalizePrivateExceptions(["[::1]:8080"]), ["::1:8080"]);
  for (const bad of [
    "localhost",
    "localhost:0",
    "localhost:70000",
    "a b:1",
    5,
  ]) {
    assert.throws(() => normalizePrivateExceptions([bad]));
  }
  assert.throws(() => normalizePrivateExceptions("localhost:3000"));
});

test("a mixed public and private answer denies the host (rebinding)", () => {
  const mixed = checkAddresses([
    { address: "93.184.216.34", family: 4 },
    { address: "127.0.0.1", family: 4 },
  ]);
  assert.equal(mixed.ok, false);
  assert.equal(mixed.code, "private_network_denied");
  assert.equal(checkAddresses([]).code, "dns_failed");
  assert.equal(checkAddresses(undefined).code, "dns_failed");
  assert.equal(
    checkAddresses([{ address: "not-an-ip" }]).code,
    "private_network_denied",
  );
  const good = checkAddresses([{ address: "93.184.216.34" }]);
  assert.equal(good.ok, true);
  assert.deepEqual(good.addresses, [{ address: "93.184.216.34", family: 4 }]);
});

test("resolveAndPin returns the verified answer and never re-resolves", async () => {
  let calls = 0;
  const resolver = async () => {
    calls += 1;
    return calls === 1
      ? [{ address: "93.184.216.34", family: 4 }]
      : [{ address: "127.0.0.1", family: 4 }];
  };
  const pinned = await resolveAndPin("rebind.example", { resolver });
  assert.equal(pinned.ok, true);
  assert.deepEqual(pinned.addresses, [{ address: "93.184.216.34", family: 4 }]);
  assert.equal(calls, 1);
  const second = await resolveAndPin("rebind.example", { resolver });
  assert.equal(second.ok, false);
});

test("resolver failure is reported as dns_failed", async () => {
  const result = await resolveAndPin("nope.example", {
    resolver: async () => {
      throw new Error("ENOTFOUND");
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "dns_failed");
});

test("guardNavigation combines syntax, resolution and exceptions", async () => {
  const resolver = async (host) =>
    host === "wild.example"
      ? [{ address: "10.0.0.7", family: 4 }]
      : [{ address: "93.184.216.34", family: 4 }];
  const ok = await guardNavigation("https://good.example/x", { resolver });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.pinned, [{ address: "93.184.216.34", family: 4 }]);
  const literal = await guardNavigation("https://93.184.216.34/", {
    resolver: async () => {
      throw new Error("literals must not resolve");
    },
  });
  assert.equal(literal.ok, true);
  assert.deepEqual(literal.pinned, []);
  const rebind = await guardNavigation("https://wild.example/", { resolver });
  assert.equal(rebind.code, "private_network_denied");
  const syntactic = await guardNavigation("file:///etc/passwd", { resolver });
  assert.equal(syntactic.code, "scheme_denied");
  const excepted = await guardNavigation("https://wild.example/", {
    resolver,
    privateExceptions: ["wild.example:443"],
  });
  assert.equal(excepted.ok, true);
});

test("a name that resolves to a metadata address stays denied even with an exception", async () => {
  const result = await guardNavigation("http://sneaky.example/", {
    resolver: async () => [{ address: "169.254.169.254", family: 4 }],
    privateExceptions: ["sneaky.example:80"],
  });
  assert.equal(result.ok, false);
});

test("originOf and isOriginAllowed", () => {
  assert.equal(originOf("https://a.example/x?y"), "https://a.example");
  assert.equal(originOf("http://a.example:80/"), "http://a.example");
  assert.equal(originOf("http://a.example:81/"), "http://a.example:81");
  assert.equal(originOf("file:///x"), null);
  assert.equal(originOf("nope"), null);
  assert.equal(originOf(undefined), null);
  assert.equal(
    isOriginAllowed("https://a.example", ["https://a.example"]),
    true,
  );
  assert.equal(
    isOriginAllowed("https://b.example", ["https://a.example"]),
    false,
  );
  assert.equal(
    isOriginAllowed("https://a.example.evil.test", ["https://a.example"]),
    false,
  );
  assert.equal(isOriginAllowed(null, ["https://a.example"]), false);
});
