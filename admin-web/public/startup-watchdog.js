(() => {
  const recoveryId = "colony-admin-startup-recovery";
  const rootId = "root";
  let recoveryShown = false;

  function addText(parent, tag, text) {
    const element = document.createElement(tag);
    element.textContent = text;
    parent.append(element);
    return element;
  }

  function showRecovery(kind) {
    if (recoveryShown || document.getElementById(recoveryId)) return;
    recoveryShown = true;

    const page = document.createElement("main");
    page.id = recoveryId;
    page.className = "admin-startup-recovery";
    const card = document.createElement("section");
    card.className = "admin-startup-recovery-card";
    card.setAttribute("role", "alert");
    const heading = addText(
      card,
      "h1",
      kind === "out-of-date"
        ? "This page is out of date, reload"
        : "Admin could not start. Reload, or open in a private window.",
    );
    heading.tabIndex = -1;
    addText(
      card,
      "p",
      kind === "out-of-date"
        ? "The latest Colony admin bundle could not load. Reload to get the current version."
        : "Colony admin did not mount within three seconds.",
    );
    const reload = addText(card, "button", "Reload");
    reload.type = "button";
    reload.addEventListener("click", () => window.location.reload());
    page.append(card);

    const root = document.getElementById(rootId);
    if (root) {
      root.replaceChildren(page);
    } else {
      document.body.append(page);
    }
    heading.focus();
  }

  window.addEventListener(
    "error",
    (event) => {
      const target = event.target;
      if (
        target instanceof HTMLScriptElement &&
        target.type === "module" &&
        new URL(target.src, window.location.href).pathname.startsWith(
          "/assets/",
        )
      ) {
        showRecovery("out-of-date");
      }
    },
    true,
  );

  window.setTimeout(() => {
    const root = document.getElementById(rootId);
    if (!root?.hasChildNodes()) showRecovery("not-started");
  }, 3_000);
})();
