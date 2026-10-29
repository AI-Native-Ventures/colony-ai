const ID_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_LABELS = 32;
const MAX_NAME_LENGTH = 80;
const IDLE_FADE_MS = 3_000;
const GLIDE_MS = 320;

const COLORS = ["#7355bd", "#20846a", "#b76c36", "#3676a8", "#b34467"];

function cursorColor(agentId, name) {
  const label = name.toLowerCase();
  if (label === "scout") return COLORS[0];
  if (label === "moss") return COLORS[1];
  let hash = 0;
  for (const character of agentId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return COLORS[hash % COLORS.length];
}

function checkedLabels(labels) {
  if (!Array.isArray(labels) || labels.length > MAX_LABELS)
    throw new Error("Invalid browser cursor labels");
  return labels.map((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      !ID_PATTERN.test(entry.agentId) ||
      typeof entry.name !== "string"
    )
      throw new Error("Invalid browser cursor labels");
    const name = Array.from(entry.name, (character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? " " : character;
    })
      .join("")
      .trim();
    if (!name || name.length > MAX_NAME_LENGTH)
      throw new Error("Invalid browser cursor labels");
    return { agentId: entry.agentId, name };
  });
}

const overlayDocument = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent}
body{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
#layer{position:absolute;inset:0;overflow:hidden;pointer-events:none}
.cursor{position:absolute;top:0;left:0;display:flex;align-items:flex-start;width:max-content;opacity:0;pointer-events:none;filter:drop-shadow(0 2px 4px rgb(0 0 0 / 24%));transform:translate3d(18px,18px,0);transition:transform ${GLIDE_MS}ms cubic-bezier(.2,.82,.22,1),opacity 320ms ease}
.cursor[data-visible="true"]{opacity:1}.pointer{position:relative;z-index:2;width:22px;height:26px;flex:none;margin:0 -1px 0 -2px;overflow:visible}
.pointer path{fill:var(--agent-color);stroke:white;stroke-linejoin:round;stroke-width:2.4}
.name{position:relative;z-index:1;display:inline-flex;min-height:21px;align-items:center;gap:5px;margin:1px 0 0 -1px;padding:2px 8px 2px 7px;border:2px solid white;border-radius:99px;background:var(--agent-color);color:white;box-shadow:0 2px 6px rgb(23 18 32 / 25%);font-size:10px;font-weight:800;white-space:nowrap}
.name i{width:5px;height:5px;border-radius:50%;background:rgb(255 255 255 / 84%)}
.ring{position:absolute;z-index:3;top:0;left:0;width:34px;height:34px;border:2px solid var(--ring-color);border-radius:50%;background:var(--ring-fill);opacity:0;pointer-events:none;transform:translate(-50%,-50%) scale(.45)}
.ring.pulse{animation:click-pulse 360ms ease-out both}.ring.static{transform:translate(-50%,-50%) scale(1);opacity:.9}
@keyframes click-pulse{0%{opacity:.92;transform:translate(-50%,-50%) scale(.45)}70%{opacity:.65}100%{opacity:0;transform:translate(-50%,-50%) scale(1.38)}}
.focus{position:absolute;z-index:1;border:2px solid var(--focus-color);border-radius:5px;box-shadow:0 0 0 3px color-mix(in srgb,var(--focus-color) 22%,transparent);pointer-events:none;opacity:0;transition:opacity 120ms ease}
.focus.visible{opacity:1}.scroll{position:absolute;right:18px;bottom:22px;display:flex;align-items:center;gap:6px;padding:6px 9px;border:1px solid rgb(255 255 255 / 90%);border-radius:99px;background:rgb(39 45 39 / 80%);color:white;font-size:8px;font-weight:800;letter-spacing:.1em;opacity:0;transform:translateY(4px);transition:opacity 140ms ease,transform 140ms ease;pointer-events:none}
.scroll.visible{opacity:1;transform:translateY(0)}
@media(prefers-reduced-motion:reduce){.cursor,.focus,.scroll{transition:none!important}.ring.pulse{animation:none!important;transform:translate(-50%,-50%) scale(1);opacity:.9}}
</style></head><body><div id="layer" aria-hidden="true"><div id="cursors"></div><div id="focus" class="focus"></div><div id="scroll" class="scroll">↕ SCROLL</div></div>
<script>
(()=>{
const host=document.getElementById('cursors'),focus=document.getElementById('focus'),scroll=document.getElementById('scroll'),items=new Map(),reduced=matchMedia('(prefers-reduced-motion: reduce)');
const wait=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
function make(id,name,color){const el=document.createElement('div');el.className='cursor';el.dataset.visible='false';el.setAttribute('aria-hidden','true');el.style.setProperty('--agent-color',color);el.innerHTML='<svg class="pointer" viewBox="0 0 22 27" aria-hidden="true"><path d="M2 1.8v18.8l5.3-5.2 4.1 9 3.2-1.5-4-8.7 7.2.1L2 1.8Z"/></svg><span class="name"><i></i></span><div class="ring" aria-hidden="true"></div>';el.querySelector('.name').append(document.createTextNode(name));host.append(el);const item={el,ring:el.querySelector('.ring'),id,name,color,position:null,generation:0,timer:null};items.set(id,item);return item}
async function run(detail){const item=items.get(detail.agentId)||make(detail.agentId,detail.name,detail.color);item.name=detail.name;item.el.querySelector('.name').lastChild.textContent=detail.name;item.el.style.setProperty('--agent-color',detail.color);item.ring.style.setProperty('--ring-color',detail.color);item.ring.style.setProperty('--ring-fill',detail.color+'22');item.generation++;const generation=item.generation;if(item.timer)clearTimeout(item.timer);item.el.dataset.visible='true';item.ring.className='ring';if(!detail.focus)focus.classList.remove('visible');const point={x:detail.x,y:detail.y};const motionReduced=reduced.matches;item.el.style.transition=motionReduced?'none':'transform '+(detail.duration||${GLIDE_MS})+'ms cubic-bezier(.2,.82,.22,1),opacity 320ms ease';if(!item.position){item.el.style.transform='translate3d(18px,18px,0)';void item.el.offsetWidth}await new Promise(resolve=>requestAnimationFrame(resolve));item.el.style.transform='translate3d('+point.x+'px,'+point.y+'px,0)';item.position=point;if(!motionReduced)await wait(detail.duration||${GLIDE_MS});if(generation!==item.generation)return false;if(detail.focus){focus.style.setProperty('--focus-color',detail.color);focus.style.left=detail.focus.x+'px';focus.style.top=detail.focus.y+'px';focus.style.width=detail.focus.width+'px';focus.style.height=detail.focus.height+'px';focus.classList.add('visible')}if(detail.action==='scroll'){scroll.classList.add('visible');setTimeout(()=>scroll.classList.remove('visible'),650)}if(detail.action==='click'){item.ring.style.left=point.x+'px';item.ring.style.top=point.y+'px';void item.ring.offsetWidth;item.ring.classList.add(motionReduced?'static':'pulse');await wait(motionReduced?280:360);if(generation!==item.generation)return false;item.ring.className='ring'}item.timer=setTimeout(()=>{if(generation!==item.generation)return;item.el.dataset.visible='false';focus.classList.remove('visible');item.ring.className='ring'},${IDLE_FADE_MS});return true}
window.addEventListener('resize',()=>focus.classList.remove('visible'));
function hide(agentId){const targets=agentId?[items.get(agentId)]:[...items.values()];for(const item of targets){if(!item)continue;item.generation++;if(item.timer)clearTimeout(item.timer);item.el.dataset.visible='false';item.ring.className='ring'}if(![...items.values()].some(item=>item.el.dataset.visible==='true')){focus.classList.remove('visible');scroll.classList.remove('visible')}}
window.__colonyAgentCursor={run,hide,reduced:()=>reduced.matches,positions:()=>[...items.values()].map(item=>{const matrix=new DOMMatrixReadOnly(getComputedStyle(item.el).transform);return{agentId:item.id,name:item.name,color:item.color,position:item.position,displayPoint:{x:matrix.m41,y:matrix.m42},visible:item.el.dataset.visible==='true',ringClass:item.ring.className}}),focusVisible:()=>focus.classList.contains('visible'),scrollVisible:()=>scroll.classList.contains('visible')};
})();
</script></body></html>`;

function documentUrl() {
  return `data:text/html;charset=utf-8,${encodeURIComponent(overlayDocument)}`;
}

/** A transparent, click-through native window kept above the selected page view. */
export function createAgentCursorOverlayManager({ BrowserWindow, getTab }) {
  const overlays = new Map();
  const ownerListeners = new Map();

  function keyFor(ownerWindow) {
    return ownerWindow;
  }

  function boundsFor(tab) {
    const origin = tab.ownerWindow.getContentBounds();
    const bounds = tab.bounds;
    return {
      x: Math.round(origin.x + bounds.x),
      y: Math.round(origin.y + bounds.y),
      width: Math.max(1, Math.round(bounds.width)),
      height: Math.max(1, Math.round(bounds.height)),
    };
  }

  function sync(entry) {
    const tab = getTab(entry.tabId);
    if (
      !tab?.attached ||
      !tab.visible ||
      !tab.bounds ||
      tab.ownerWindow.isDestroyed() ||
      !tab.ownerWindow.isVisible() ||
      tab.ownerWindow.isMinimized()
    ) {
      entry.window.hide();
      return false;
    }
    entry.window.setBounds(boundsFor(tab));
    if (!entry.window.isVisible()) entry.window.showInactive();
    return true;
  }

  function ensure(tab) {
    if (typeof BrowserWindow !== "function") return null;
    const key = keyFor(tab.ownerWindow);
    let entry = overlays.get(key);
    if (entry && !entry.window.isDestroyed()) {
      entry.tabId = tab.id;
      return entry;
    }
    const window = new BrowserWindow({
      parent: tab.ownerWindow,
      show: false,
      x: 0,
      y: 0,
      width: Math.max(1, tab.bounds?.width ?? 1),
      height: Math.max(1, tab.bounds?.height ?? 1),
      useContentSize: true,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      focusable: false,
      skipTaskbar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
        devTools: false,
      },
    });
    window.setIgnoreMouseEvents(true, { forward: true });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    const url = documentUrl();
    let initialNavigation = true;
    window.webContents.on("will-navigate", (event, target) => {
      if (initialNavigation && target === url) {
        initialNavigation = false;
        return;
      }
      event.preventDefault();
    });
    const ready = new Promise((resolve, reject) => {
      window.webContents.once("did-finish-load", resolve);
      window.webContents.once("did-fail-load", (_event, code, description) =>
        reject(
          new Error(`Cursor overlay failed to load (${code}): ${description}`),
        ),
      );
      window.webContents.once("render-process-gone", reject);
    });
    ready.catch(() => undefined);
    void window.loadURL(url).catch(() => undefined);
    entry = { key, window, tabId: tab.id, ready };
    overlays.set(key, entry);
    const update = () => sync(entry);
    for (const event of [
      "move",
      "resize",
      "enter-full-screen",
      "leave-full-screen",
    ]) {
      tab.ownerWindow.on(event, update);
    }
    ownerListeners.set(key, { ownerWindow: tab.ownerWindow, update });
    window.once("closed", () => {
      if (overlays.get(key) === entry) overlays.delete(key);
    });
    return entry;
  }

  async function move(tabId, action) {
    const tab = getTab(tabId);
    if (!tab?.attached || !tab.visible || !tab.bounds) return false;
    const entry = ensure(tab);
    if (!entry || !sync(entry)) return false;
    const identity = tab.agentCursorLabels?.get(action.agentId) ?? {
      name: "AI employee",
    };
    const zoom = tab.webContents.getZoomFactor?.() ?? 1;
    const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
    const focus = action.focus
      ? {
          x: action.focus.x * scale,
          y: action.focus.y * scale,
          width: action.focus.width * scale,
          height: action.focus.height * scale,
        }
      : undefined;
    const payload = {
      agentId: action.agentId,
      name: identity.name,
      color: cursorColor(action.agentId, identity.name),
      x: action.x * scale,
      y: action.y * scale,
      action: action.action,
      focus,
    };
    await entry.ready;
    if (entry.window.isDestroyed() || !sync(entry)) return false;
    const script = `window.__colonyAgentCursor.run(${JSON.stringify(payload)})`;
    const result = await entry.window.webContents.executeJavaScript(
      script,
      true,
    );
    return result === true;
  }

  async function hide(tabId, agentId) {
    const tab = getTab(tabId);
    if (!tab) return;
    const entry = overlays.get(keyFor(tab.ownerWindow));
    if (!entry || entry.window.isDestroyed()) return;
    try {
      await entry.ready;
      if (!entry.window.isDestroyed())
        await entry.window.webContents.executeJavaScript(
          `window.__colonyAgentCursor.hide(${JSON.stringify(agentId ?? null)})`,
          true,
        );
    } catch {
      // Closing the tab or its window also removes the cursor layer.
    }
  }

  function attach(tab) {
    const entry = overlays.get(keyFor(tab.ownerWindow));
    if (entry) {
      if (entry.tabId !== tab.id) {
        entry.window.hide();
        void entry.window.webContents
          .executeJavaScript("window.__colonyAgentCursor.hide()", true)
          .catch(() => undefined);
      }
      entry.tabId = tab.id;
      sync(entry);
    }
  }

  function detach(tabId) {
    const tab = getTab(tabId);
    if (!tab) return;
    const entry = overlays.get(keyFor(tab.ownerWindow));
    if (!entry || entry.tabId !== tabId) return;
    entry.window.hide();
    void entry.window.webContents
      .executeJavaScript("window.__colonyAgentCursor.hide()", true)
      .catch(() => undefined);
  }

  function close(tabId) {
    for (const [key, entry] of overlays) {
      if (entry.tabId !== tabId) continue;
      entry.window.hide();
      entry.tabId = null;
      const listener = ownerListeners.get(key);
      if (listener) {
        for (const event of [
          "move",
          "resize",
          "enter-full-screen",
          "leave-full-screen",
        ])
          listener.ownerWindow.removeListener(event, listener.update);
        ownerListeners.delete(key);
      }
      if (!entry.window.isDestroyed()) entry.window.close();
      overlays.delete(key);
    }
  }

  function dispose() {
    for (const [key, entry] of overlays) {
      const listener = ownerListeners.get(key);
      if (listener) {
        for (const event of [
          "move",
          "resize",
          "enter-full-screen",
          "leave-full-screen",
        ])
          listener.ownerWindow.removeListener(event, listener.update);
        ownerListeners.delete(key);
      }
      if (!entry.window.isDestroyed()) entry.window.close();
    }
    overlays.clear();
  }

  return {
    attach,
    close,
    detach,
    dispose,
    hide,
    move,
    syncOwner(ownerWindow) {
      const entry = overlays.get(keyFor(ownerWindow));
      if (entry) sync(entry);
    },
  };
}

export function validateAgentCursorLabels(labels) {
  return checkedLabels(labels);
}
