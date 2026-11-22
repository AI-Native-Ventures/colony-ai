/* @vitest-environment jsdom */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OperatorAdminApp } from "./admin-dashboard";
import type { AdminSigninConfig } from "./api";

const passwordConfig: AdminSigninConfig = {
  googleClientId: "runtime-google-client",
  emailCode: true,
  password: true,
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function signInRequired(): Response {
  return jsonResponse(
    { error: { code: "unauthorized", message: "sign in" } },
    401,
  );
}

function requestPath(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function installFetch({
  configResponse = () => jsonResponse(passwordConfig),
  passwordResponse = () => signInRequired(),
}: {
  configResponse?: () => Response | Promise<Response>;
  passwordResponse?: () => Response | Promise<Response>;
} = {}) {
  const passwordBodies: unknown[] = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = requestPath(input);
    if (path.endsWith("/probe")) return Promise.resolve(signInRequired());
    if (path.endsWith("/session/config"))
      return Promise.resolve(configResponse());
    if (path.endsWith("/session/password")) {
      passwordBodies.push(JSON.parse(String(init?.body)));
      return Promise.resolve(passwordResponse());
    }
    return Promise.resolve(jsonResponse({ error: { code: "not_found" } }, 404));
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, passwordBodies };
}

function renderPasswordSignIn({
  config = passwordConfig,
  buildTimeGoogleClientId = "build-time-google-client",
  passwordResponse,
}: {
  config?: AdminSigninConfig;
  buildTimeGoogleClientId?: string;
  passwordResponse?: () => Response | Promise<Response>;
} = {}) {
  const fetch = installFetch({ passwordResponse });
  const configLoader = vi.fn(async () => config);
  render(
    <OperatorAdminApp
      path="/overview"
      buildTimeGoogleClientId={buildTimeGoogleClientId}
      signInConfigLoader={configLoader}
    />,
  );
  return { ...fetch, configLoader };
}

function fillPasswordForm() {
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "operator@example.test" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "correct horse battery staple" },
  });
}

function deferred<T>() {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return {
    promise,
    resolve(value: T) {
      if (!resolve) throw new Error("Deferred promise is not initialized.");
      resolve(value);
    },
  };
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("admin sign-in options", () => {
  it("shows the password form only when the runtime config enables it", async () => {
    renderPasswordSignIn();

    const passwordForm = await screen.findByRole("form", {
      name: "Sign in with email and password",
    });
    expect(passwordForm).toBeTruthy();
    expect(screen.getByLabelText("Email")).toHaveProperty(
      "autocomplete",
      "username",
    );
    expect(screen.getByLabelText("Password")).toHaveProperty(
      "autocomplete",
      "current-password",
    );
    expect(
      screen.getByRole("button", { name: "Sign in with a code instead" }),
    ).toBeTruthy();

    cleanup();
    renderPasswordSignIn({
      config: { googleClientId: null, emailCode: true, password: false },
    });

    await screen.findByRole("form", { name: "Sign in with a code" });
    expect(
      screen.queryByRole("form", { name: "Sign in with email and password" }),
    ).toBeNull();
  });

  it("submits the password form from Enter and its submit button", async () => {
    const { passwordBodies } = renderPasswordSignIn();
    const passwordForm = await screen.findByRole("form", {
      name: "Sign in with email and password",
    });
    const passwordInput = screen.getByLabelText("Password");

    fillPasswordForm();
    fireEvent.keyDown(passwordInput, { key: "Enter", code: "Enter" });
    fireEvent.submit(passwordForm);
    await waitFor(() => expect(passwordBodies).toHaveLength(1));

    await screen.findByText(
      "Email or password not accepted. Try again, or sign in with a code.",
    );
    fillPasswordForm();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(passwordBodies).toHaveLength(2));

    expect(passwordBodies).toEqual([
      {
        email: "operator@example.test",
        password: "correct horse battery staple",
      },
      {
        email: "operator@example.test",
        password: "correct horse battery staple",
      },
    ]);
  });

  it("clears and refocuses the password after a generic failure", async () => {
    renderPasswordSignIn();
    await screen.findByRole("form", {
      name: "Sign in with email and password",
    });
    fillPasswordForm();
    const passwordInput = screen.getByLabelText("Password") as HTMLInputElement;

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByRole("alert");

    expect(passwordInput.value).toBe("");
    expect(document.activeElement).toBe(passwordInput);
    expect(screen.getByLabelText("Email")).toHaveProperty(
      "value",
      "operator@example.test",
    );
  });

  it("refocuses password after a repeated empty submission", async () => {
    const { passwordBodies } = renderPasswordSignIn();
    const passwordForm = await screen.findByRole("form", {
      name: "Sign in with email and password",
    });
    const passwordInput = screen.getByLabelText("Password");

    fireEvent.submit(passwordForm);
    await screen.findByRole("alert");
    expect(document.activeElement).toBe(passwordInput);

    screen.getByRole("button", { name: "Sign in" }).focus();
    fireEvent.submit(passwordForm);
    await waitFor(() => expect(document.activeElement).toBe(passwordInput));
    expect(passwordBodies).toHaveLength(0);
  });

  it("blocks a second password submission while the first is in flight", async () => {
    const response = deferred<Response>();
    const { passwordBodies } = renderPasswordSignIn({
      passwordResponse: () => response.promise,
    });
    const passwordForm = await screen.findByRole("form", {
      name: "Sign in with email and password",
    });
    fillPasswordForm();

    fireEvent.submit(passwordForm);
    fireEvent.submit(passwordForm);
    await waitFor(() => expect(passwordBodies).toHaveLength(1));
    expect(
      screen.getByRole("button", { name: "Signing in..." }),
    ).toHaveProperty("disabled", true);

    await act(async () => {
      response.resolve(signInRequired());
      await response.promise;
    });
  });

  it("uses the runtime Google client and falls back to the build-time client", async () => {
    renderPasswordSignIn({ buildTimeGoogleClientId: "" });
    const runtimeButton = await screen.findByRole("button", {
      name: "Continue with Google",
    });
    expect(runtimeButton).toHaveProperty("disabled", false);

    cleanup();
    renderPasswordSignIn({
      config: { googleClientId: null, emailCode: true, password: false },
      buildTimeGoogleClientId: "build-time-google-client",
    });
    const fallbackButton = await screen.findByRole("button", {
      name: "Continue with Google",
    });
    expect(fallbackButton).toHaveProperty("disabled", false);
  });

  it("keeps code and NIP-98 available when config loading fails, then retries", async () => {
    const responses = [
      jsonResponse({ error: { code: "not_found" } }, 404),
      jsonResponse(passwordConfig),
    ];
    const { fetchMock } = installFetch({
      configResponse: () => responses.shift() ?? jsonResponse(passwordConfig),
    });
    render(
      <OperatorAdminApp
        path="/overview"
        buildTimeGoogleClientId="build-time-google-client"
      />,
    );

    await screen.findByText(/Could not load sign-in options/);
    expect(screen.getByLabelText("Operator email address")).toBeTruthy();
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Continue with Google" }),
    ).toHaveProperty("disabled", false);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("form", {
      name: "Sign in with email and password",
    });
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        requestPath(input as RequestInfo | URL).endsWith("/session/config"),
      ),
    ).toHaveLength(2);
  });

  it("ignores an older config response after a newer request begins", async () => {
    installFetch();
    const first = deferred<AdminSigninConfig>();
    const second = deferred<AdminSigninConfig>();
    const firstLoader = vi.fn(() => first.promise);
    const secondLoader = vi.fn(() => second.promise);
    const view = render(
      <OperatorAdminApp path="/overview" signInConfigLoader={firstLoader} />,
    );

    await waitFor(() => expect(firstLoader).toHaveBeenCalledTimes(1));
    view.rerender(
      <OperatorAdminApp path="/overview" signInConfigLoader={secondLoader} />,
    );
    await waitFor(() => expect(secondLoader).toHaveBeenCalledTimes(1));

    await act(async () => {
      second.resolve({
        googleClientId: null,
        emailCode: true,
        password: false,
      });
      await second.promise;
    });
    await screen.findByRole("form", { name: "Sign in with a code" });

    await act(async () => {
      first.resolve(passwordConfig);
      await first.promise;
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("form", {
          name: "Sign in with email and password",
        }),
      ).toBeNull();
    });
  });
});
