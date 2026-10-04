import type { Page } from "@playwright/test";
import { waitForAnimations } from "./animations";

export type SidebarContrastSample = {
  category: string;
  text: string;
  color: string;
  opacity: number;
  x: number;
  y: number;
  width: number;
  height: number;
  ratio: number;
  background: number[];
};

/** Measure text against the actual painted background, including gradients. */
export async function measureSidebarContrast(page: Page, selector: string) {
  const samples = await page.locator(selector).evaluate((sidebar) => {
    const category = (el: Element) => {
      if (el.closest('[data-testid="sidebar-business-switcher"]'))
        return "business";
      if (
        el.closest(
          '[data-testid="sidebar-profile-name"],.w20-nav-person strong,.w20-nav-person small',
        )
      )
        return "user";
      if (
        el.closest(
          '[data-sidebar="group-label"],.sidebar-navigation-group-toggle,.w20-nav-heading',
        )
      )
        return "section";
      if (
        el.closest(
          '[data-sidebar="menu-button"],[data-sidebar="menu-sub-button"],.w20-nav-item',
        )
      )
        return "nav";
      if (el.closest('[data-testid="open-search"],.w20-nav-search'))
        return "search";
      return "other";
    };
    const results: Array<Omit<SidebarContrastSample, "ratio" | "background">> =
      [];
    const add = (
      el: Element,
      text: string,
      rect: DOMRect,
      placeholder = false,
    ) => {
      if (
        !rect.width ||
        !rect.height ||
        rect.y < 0 ||
        rect.bottom > innerHeight ||
        rect.x < 0 ||
        rect.right > innerWidth
      )
        return;
      const hit = document.elementFromPoint(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
      );
      // A scroller can mount text behind the footer. Measure only painted text.
      if (!hit || !(el === hit || el.contains(hit) || hit.contains(el))) return;
      const style = getComputedStyle(
        el,
        placeholder ? "::placeholder" : undefined,
      );
      if (style.visibility !== "visible" || style.display === "none") return;
      let opacity = placeholder ? Number(style.opacity) : 1;
      for (
        let parent: Element | null = el;
        parent;
        parent = parent.parentElement
      )
        opacity *= Number(getComputedStyle(parent).opacity);
      if (!opacity) return;
      results.push({
        category: category(el),
        text,
        color: style.color,
        opacity,
        x: Math.ceil(rect.x),
        y: Math.ceil(rect.y),
        width: Math.max(1, Math.floor(rect.width) - 1),
        height: Math.max(1, Math.floor(rect.height) - 1),
      });
    };
    const walker = document.createTreeWalker(sidebar, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const el = node.parentElement;
      if (
        !el ||
        !node.textContent?.trim() ||
        el.closest(
          'svg,.sr-only,[aria-hidden="true"],[data-slot="avatar-fallback"],.w20-nav-person-avatar',
        )
      )
        continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects())
        add(el, node.textContent.trim(), rect);
    }
    for (const input of sidebar.querySelectorAll<HTMLInputElement>(
      "input[placeholder]",
    )) {
      if (!input.value)
        add(input, input.placeholder, input.getBoundingClientRect(), true);
    }
    return results;
  });
  // Hide only glyph ink. Layout, hover fills, gradients and opacity remain intact.
  const style = await page.addStyleTag({
    content: `${selector}, ${selector} *, ${selector} input::placeholder { -webkit-text-fill-color: transparent !important; }`,
  });
  let backgroundImage: string;
  try {
    await waitForAnimations(page);
    backgroundImage = (
      await page.screenshot({ animations: "disabled", scale: "css" })
    ).toString("base64");
  } finally {
    await style.evaluate((el) => el.remove());
  }
  return page.evaluate(
    async ({ samples, backgroundImage }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${backgroundImage}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Sidebar background canvas is unavailable");
      ctx.drawImage(image, 0, 0);
      const probe = document.createElement("canvas");
      probe.width = probe.height = 1;
      const ink = probe.getContext("2d");
      if (!ink) throw new Error("Sidebar color canvas is unavailable");
      const luminance = (rgb: number[]) =>
        rgb
          .slice(0, 3)
          .map((v) => {
            const c = v / 255;
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          })
          .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      const text = samples.map((sample) => {
        ink.clearRect(0, 0, 1, 1);
        ink.fillStyle = sample.color;
        ink.fillRect(0, 0, 1, 1);
        const fg = [...ink.getImageData(0, 0, 1, 1).data];
        const alpha = (fg[3] / 255) * sample.opacity;
        const pixels = ctx.getImageData(
          sample.x,
          sample.y,
          sample.width,
          sample.height,
        ).data;
        let ratio = Infinity;
        let background: number[] = [];
        // Use the worst pixel under the text bounds, so a gradient's brighter
        // end cannot be missed by sampling only the center of a label.
        for (let i = 0; i < pixels.length; i += 4) {
          const bg = [pixels[i], pixels[i + 1], pixels[i + 2]];
          const rendered = fg
            .slice(0, 3)
            .map((v, channel) => v * alpha + bg[channel] * (1 - alpha));
          const a = luminance(rendered),
            b = luminance(bg);
          const current = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          if (current < ratio) {
            ratio = current;
            background = bg;
          }
        }
        return { ...sample, background, ratio };
      });
      return {
        text,
        frame: {
          top: [...ctx.getImageData(8, 2, 1, 1).data].slice(0, 3),
          bottom: [...ctx.getImageData(8, image.height - 3, 1, 1).data].slice(
            0,
            3,
          ),
        },
      };
    },
    { samples, backgroundImage },
  );
}
