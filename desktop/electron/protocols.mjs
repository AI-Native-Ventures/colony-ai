const MEDIA_PATH =
  /^\/media\/[a-f\d]{64}(?:\.thumb)?\.(?:jpg|png|gif|webp|mp4|webm|mov)$/i;

function response(status, message) {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export function createBuzzMediaProtocolHandler({ host, fetch }) {
  return async function handleBuzzMedia(request) {
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return response(400, "invalid media URL");
    }
    if (url.hostname !== "localhost" || !MEDIA_PATH.test(url.pathname)) {
      return response(404, "not found");
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return response(405, "method not allowed");
    }

    let port;
    try {
      port = await host.request("invoke", {
        command: "get_media_proxy_port",
        args: {},
      });
    } catch {
      return response(503, "media proxy is unavailable");
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return response(503, "media proxy is not ready");
    }

    const headers = new Headers();
    for (const name of ["accept", "range", "if-range"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    try {
      return await fetch(
        `http://127.0.0.1:${port}${url.pathname}${url.search}`,
        { method: request.method, headers, redirect: "manual" },
      );
    } catch {
      return response(502, "media proxy request failed");
    }
  };
}
