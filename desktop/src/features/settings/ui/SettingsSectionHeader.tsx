import type { ReactNode } from "react";

import { PageHeader } from "@/shared/ui/PageHeader";

/**
 * Page title for a Settings card. The R19 settings route applies its page
 * geometry to this marker while other settings surfaces keep their own layout.
 */
export function SettingsSectionHeader({
  action,
  description,
  title,
}: {
  action?: ReactNode;
  description?: ReactNode;
  title: ReactNode;
}) {
  return (
    <PageHeader
      action={action}
      className="mb-12 w20-r19-page-heading"
      description={
        description ? (
          <span data-settings-subcopy className="text-muted-foreground/70">
            {description}
          </span>
        ) : undefined
      }
      title={title}
    />
  );
}
