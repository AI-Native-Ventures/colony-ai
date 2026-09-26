import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";

import { useAppShell } from "@/app/AppShellContext";
import { useChannelTemplatesQuery } from "@/features/channel-templates/hooks";
import { Button } from "@/shared/ui/button";

export function ChannelTemplatePickerScreen() {
  const navigate = useNavigate();
  const templatesQuery = useChannelTemplatesQuery();
  const templates = templatesQuery.data ?? [];
  const { openCreateChannelFromTemplate } = useAppShell();

  useEffect(() => {
    if (!templatesQuery.isLoading && templates.length === 0) {
      void navigate({ to: "/" });
    }
  }, [navigate, templates.length, templatesQuery.isLoading]);

  if (templates.length === 0) return null;

  return (
    <main
      className="h-full min-h-0 overflow-y-auto px-11 pb-10 pt-9.5"
      data-testid="channel-template-picker"
    >
      <div className="pb-[30px]">
        <h1 className="text-settings-title font-semibold text-foreground">
          Create from a template
        </h1>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {templates.map((template) => (
          <article
            className="flex flex-col rounded-[9px] border border-border bg-card p-6"
            data-testid="channel-template-card"
            key={template.id}
          >
            <h2 className="mb-4 text-base font-semibold text-foreground">
              {template.name}
            </h2>
            {template.description ? (
              <p className="text-sm text-muted-foreground">
                {template.description}
              </p>
            ) : null}
            <Button
              className="mt-5 self-start"
              data-testid="channel-template-use"
              onClick={() =>
                openCreateChannelFromTemplate(template.id, template.channelType)
              }
              type="button"
            >
              Use template
            </Button>
          </article>
        ))}
      </div>
    </main>
  );
}
