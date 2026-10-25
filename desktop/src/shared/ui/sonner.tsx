import { Toaster as Sonner } from "sonner";

import { useTheme } from "@/shared/theme/ThemeProvider";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { isDark } = useTheme();

  return (
    <Sonner
      theme={isDark ? "dark" : "light"}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:rounded-2xl group-[.toaster]:border-0 group-[.toaster]:bg-colony-pop group-[.toaster]:text-colony-fg group-[.toaster]:font-extrabold group-[.toaster]:shadow-[0_0_0_1px_hsl(var(--colony-border)),0_12px_30px_-20px_rgba(40,20,60,0.35)]",
          description:
            "group-[.toast]:font-medium group-[.toast]:text-colony-fg-secondary",
          actionButton:
            "group-[.toast]:bg-colony-fg group-[.toast]:text-colony-surface",
          cancelButton:
            "group-[.toast]:bg-colony-track group-[.toast]:text-colony-fg-secondary",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
