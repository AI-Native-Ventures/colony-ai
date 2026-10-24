import type { CSSProperties } from "react";

export const POPOVER_SURFACE_CLASS = "border-0 bg-colony-pop text-colony-fg";

/** Menu panel: white, 18px radius, 8px padding, rows 1px apart. */
export const MENU_CONTENT_CLASS =
  "flex flex-col gap-px rounded-colony-menu p-2";

/** One menu row: 40px, 10px radius, 15px bold; hover and open take the track tint. */
export const MENU_ITEM_CLASS =
  "relative flex h-10 min-h-10 cursor-default select-none items-center gap-2.5 rounded-colony-menu-item px-3 text-menu font-bold text-colony-fg outline-hidden transition-colors focus:bg-colony-track data-[highlighted]:bg-colony-track data-[state=open]:bg-colony-track data-[state=open]:font-extrabold data-[disabled]:pointer-events-none data-[disabled]:text-colony-faint [&>svg]:size-4 [&>svg]:shrink-0";

export const MENU_SEPARATOR_CLASS = "mx-1.5 my-1 h-px bg-colony-border";

export const POPOVER_RADIX_MOTION_CLASS =
  "duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] data-[state=closed]:duration-100 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 motion-reduce:animate-none";

export const POPOVER_RADIX_SIDE_MOTION_CLASS =
  "data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1";

export const POPOVER_CUSTOM_ENTER_MOTION_CLASS =
  "animate-in fade-in-0 zoom-in-95 duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:animate-none";

export const POPOVER_SHADOW = "var(--colony-shadow-menu)";

export const POPOVER_SHADOW_STYLE: CSSProperties = {
  boxShadow: POPOVER_SHADOW,
};
