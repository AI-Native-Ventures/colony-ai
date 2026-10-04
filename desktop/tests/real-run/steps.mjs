import { expect } from "@playwright/test";
import { createSmokeInbox } from "./mailbox.mjs";
import { SETUP_NOTICE } from "./safety.mjs";

export async function driveFirstRun({
  page,
  evidence,
  website,
  replyTimeoutMs,
  inspectWithoutAi = false,
  realEnv = false,
}) {
  evidence.metadata.website = website;
  if (
    !(await evidence.step("Account", page, async () => {
      await page
        .getByTestId("machine-onboarding-gate")
        .waitFor({ timeout: 30000 });
      const text = await page.locator("body").innerText();
      const google = /Continue with Google/iu.test(text);
      evidence.observed["Account screen text"] = text.slice(0, 2000);
      evidence.metadata.continueWithGooglePresent = google;
      return {
        reason: `Packaged Account UI rendered without injected frontend state. Continue with Google present: ${google}.`,
      };
    }))
  )
    return;
  // Signup is driven through the actual app, not the setup API.
  let inbox;
  if (
    !(await evidence.step("Account verification", page, async () => {
      inbox = await createSmokeInbox();
      evidence.metadata.smokeAccount = inbox.email;
      const name = page.getByLabel("Your name", { exact: true });
      if (!(await name.isVisible())) {
        await page.getByRole("button", { name: /Create an account/iu }).click();
      }
      if (await name.isVisible()) await name.fill("Launch smoke");
      await page.getByLabel(/Email/iu).first().fill(inbox.email);
      await page
        .getByLabel(/Password/iu)
        .first()
        .fill(inbox.password);
      await page.getByRole("button", { name: /^Create account$/iu }).click();
      await page
        .getByTestId("account-auth-screen-verify")
        .waitFor({ timeout: 25000 });
      return {
        reason: "Production signup reached the real email verification screen.",
      };
    }))
  )
    return;
  if (
    !(await evidence.step("Business", page, async () => {
      const code = await inbox.verificationCode();
      const digits = page.locator('input[maxlength="1"]');
      if ((await digits.count()) === 6) {
        for (let index = 0; index < 6; index++)
          await digits.nth(index).fill(code[index]);
      } else
        await page.getByLabel(/Verification code|6-digit code/iu).fill(code);
      await page
        .getByRole("button", { name: /Continue|Verify/iu })
        .first()
        .click();
      await page
        .getByLabel("Business name", { exact: true })
        .waitFor({ timeout: 25000 });
      const suffix = inbox.email
        .split("@")[0]
        .replace("colony-launch-check-", "");
      evidence.metadata.smokeBusinessName = `Launch smoke ${suffix}`;
      await page
        .getByLabel("Business name", { exact: true })
        .fill(evidence.metadata.smokeBusinessName);
      await page.getByLabel("Website", { exact: false }).fill(website);
      return {
        reason:
          "Real signup, inbox code and account verification reached Business.",
      };
    }))
  )
    return;
  if (
    !(await evidence.step("Read website", page, async () => {
      await page
        .getByRole("button", { name: "Read website", exact: true })
        .click();
      await expect(
        page.getByLabel("What does your business do?"),
      ).not.toHaveValue(/^\s*$/u, { timeout: 30000 });
      const description = await page
        .getByLabel("What does your business do?")
        .inputValue();
      if (!description.trim())
        return {
          status: "FAIL",
          reason: "Website read produced no business description.",
        };
      return {
        reason: "Real website read populated the business description.",
        descriptionLength: description.length,
      };
    }))
  )
    return;
  if (
    !(await evidence.step("Create business", page, async () => {
      const continueButton = page.getByRole("button", { name: /^Continue$/iu });
      await expect(continueButton).toBeEnabled({ timeout: 30000 });
      await continueButton.click();
      await page
        .getByTestId("onboarding-connect-runtime-claude")
        .waitFor({ timeout: 45000 });
      return {
        reason:
          "Unique smoke business was provisioned through the real app and Connect opened.",
      };
    }))
  )
    return;
  if (
    !(await evidence.step("Connect Claude Code", page, async () => {
      const runtime = page.getByTestId("onboarding-connect-runtime-claude");
      await runtime.waitFor({ timeout: 45000 });
      await runtime.getByRole("button", { name: /Claude Code/iu }).click();
      evidence.metadata.claudeReadiness = (await runtime.innerText()).slice(
        0,
        500,
      );
      // Plan text as shown to the owner, verbatim.
      evidence.observed["Connect screen text (plan text)"] = (
        await page.locator("body").innerText()
      ).slice(0, 3000);
      return {
        reason:
          "Real runtime discovery offered Claude Code and it was selected. Authentication is tested separately.",
      };
    }))
  )
    return;
  const connected = await evidence.step("Test connection", page, async () => {
    const start = Date.now();
    const runtime = page.getByTestId("onboarding-connect-runtime-claude");
    if (
      !realEnv &&
      /Sign-in needed|Authentication not checked/iu.test(
        await runtime.innerText(),
      )
    ) {
      return {
        status: "BLOCKED",
        reason:
          "The packaged Claude Code card does not report a signed-in runtime under the no-keychain policy. No sign-in or credential override attempted. Product causality is unproven.",
      };
    }
    const test = page.getByRole("button", {
      name: /^(Connect Claude Code|Test connection)$/iu,
    });
    await test.scrollIntoViewIfNeeded();
    await test.click();
    await page
      .getByTestId("onboarding-scene-connected")
      .waitFor({ timeout: replyTimeoutMs });
    const reply = (await page.locator(".reply").innerText()).trim();
    if (!reply)
      return {
        status: "FAIL",
        reason: "Connected scene had no actual reply.",
      };
    evidence.metadata.connectionReplyMs = Date.now() - start;
    evidence.observed["Connection test reply (verbatim)"] = reply;
    evidence.observed["Connected screen text"] = (
      await page.locator("body").innerText()
    ).slice(0, 2000);
    return {
      reason: "Actual Claude Code connection test returned a reply.",
      replyLength: reply.length,
    };
  });
  evidence.metadata.connectionVerified = connected;
  if (!connected) {
    if (!inspectWithoutAi) return;
    evidence.metadata.exploratoryWithoutAi = true;
    const opened = await evidence.step("Open my Colony", page, async () => {
      const skip = page.getByRole("button", {
        name: "Skip for now",
        exact: true,
      });
      await skip.scrollIntoViewIfNeeded();
      evidence.metadata.appOpenedAt = Date.now();
      await skip.click();
      await page.getByTestId("app-sidebar").waitFor({ timeout: 45000 });
      return {
        status: "BLOCKED",
        reason:
          "Exploratory app entry via Skip for now was observed. Connected entry and notice removal remain unproven because there was no successful Claude reply.",
      };
    });
    const row = evidence.rows.find((item) => item.name === "Open my Colony");
    if (!opened && !row.reason.startsWith("Exploratory app entry")) return;
    const { driveWorkspace } = await import("./workspace.mjs");
    await driveWorkspace({ page, evidence, replyTimeoutMs });
    return;
  }
  if (
    !(await evidence.step("Open my Colony", page, async () => {
      evidence.metadata.appOpenedAt = Date.now();
      await page
        .getByRole("button", { name: "Open my Colony", exact: true })
        .click();
      await page.getByTestId("app-sidebar").waitFor({ timeout: 45000 });
      if (SETUP_NOTICE.test(await page.locator("body").innerText()))
        return {
          status: "FAIL",
          reason:
            "Connection notice remains after an observed successful reply.",
        };
      return {
        reason:
          "Full app opened after the real reply, with no connection notice.",
      };
    }))
  )
    return;
  // Remaining release gates are independent read-only inspections plus one smoke message.
  const { driveWorkspace } = await import("./workspace.mjs");
  await driveWorkspace({ page, evidence, replyTimeoutMs });
}
