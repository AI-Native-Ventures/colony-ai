return await S.page.evaluate(async () => {
  const h = window.colonyBrowserHost; const tabs = await h.listTabs(); const t = tabs[0];
  const vp = document.querySelector(".colony-browser-viewport"); const r = vp.getBoundingClientRect();
  const bounds = { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  let res;
  try { const s = await h.attach(t.id, bounds, true); res = { ok: true, attached: s?.attached, visible: s?.visible }; } catch (e) { res = { err: String(e?.message ?? e).slice(0, 400) }; }
  return { bounds, controlOwner: t.controlOwner ?? null, attachedBefore: t.attached, res, win: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio } };
});
