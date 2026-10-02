(() => {
  const dialog = document.querySelector("#access-dialog");
  const slot = document.querySelector("#early-access-slot");
  if (!dialog || !slot) return;

  const recipient = "basheer@ainative.ventures";
  const subject = "Colony early access application";

  async function loadForm() {
    if (slot.dataset.ready === "true" || slot.dataset.loading === "true") return;
    slot.dataset.loading = "true";
    slot.innerHTML = '<p class="early-access__loading" role="status">Loading the application form…</p>';
    try {
      const response = await fetch("./early-access-dialog.html", { credentials: "same-origin" });
      if (!response.ok) throw new Error(`Early access form request failed (${response.status})`);
      slot.innerHTML = await response.text();
      initializeForm();
      slot.dataset.ready = "true";
    } catch {
      delete slot.dataset.ready;
      slot.innerHTML = '<div class="early-access__load-error" role="alert"><p>The application form could not load.</p><button type="button" data-early-access-retry>Try again</button><button type="button" data-early-access-close>Close</button></div>';
      slot.querySelector("[data-early-access-retry]").addEventListener("click", loadForm, { once: true });
      slot.querySelector("[data-early-access-close]").addEventListener("click", () => dialog.close());
    } finally {
      slot.dataset.loading = "false";
    }
  }

  function initializeForm() {
    const form = slot.querySelector("#early-access-form");
    const draft = slot.querySelector("#early-access-draft");
    const application = slot.querySelector("#early-access-application");
    const mail = slot.querySelector("#early-access-mail");
    const status = slot.querySelector("#early-access-status");
    const work = form.elements.namedItem("work");

    mail.href = `mailto:${recipient}?subject=${encodeURIComponent(subject)}`;
    form.addEventListener("input", () => {
      draft.hidden = true;
      status.textContent = "";
      work.setCustomValidity(work.value.trim() ? "" : "Tell us what you would like help with.");
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      work.setCustomValidity(work.value.trim() ? "" : "Tell us what you would like help with.");
      if (!form.reportValidity()) return;
      const values = new FormData(form);
      const body = [
        "I'd like to apply for early access to Colony.", "",
        `Name: ${values.get("name").trim()}`,
        `Email: ${values.get("email").trim()}`,
        `My business: ${values.get("stage")}`, "",
        "What I'd like help with:", values.get("work").trim(),
      ].join("\r\n");
      application.value = `To: ${recipient}\nSubject: ${subject}\n\n${body}`;
      mail.href = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      draft.hidden = false;
      slot.querySelector("#early-access-draft-title").focus();
    });
    slot.querySelector("#early-access-copy").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(application.value);
        status.textContent = "Copied. Paste it into your email app and send when ready.";
      } catch {
        application.focus(); application.select();
        status.textContent = "Copy is unavailable. Copy the selected text and paste it into your email app.";
      }
    });
    slot.querySelector("#early-access-edit").addEventListener("click", () => {
      draft.hidden = true;
      form.elements.namedItem("name").focus();
    });
    slot.querySelector("[data-early-access-close]").addEventListener("click", () => dialog.close());
  }
  loadForm();
})();
