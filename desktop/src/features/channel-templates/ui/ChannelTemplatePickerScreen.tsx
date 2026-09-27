import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";

import { useAppShell } from "@/app/AppShellContext";
import { useChannelTemplatesQuery } from "@/features/channel-templates/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import { Button } from "@/shared/ui/button";

export function ChannelTemplatePickerScreen() {
  const navigate = useNavigate();
  const templatesQuery = useChannelTemplatesQuery();
  const templates = templatesQuery.data ?? [];
  const { openCreateChannelFromTemplate } = useAppShell();
  const { activeCommunity } = useCommunities();

  useEffect(() => {
    if (!templatesQuery.isLoading && templates.length === 0) {
      void navigate({ to: "/" });
    }
  }, [navigate, templates.length, templatesQuery.isLoading]);

  if (templates.length === 0) return null;

  return (
    <main
      className="flex h-full min-h-0 flex-col"
      data-testid="channel-template-picker"
    >
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-6">
        <span className="text-xs text-muted-foreground">New channel</span>
        {activeCommunity?.name ? (
          <span className="rounded-md border border-border bg-background px-3 py-1 text-2xs text-muted-foreground">
            {activeCommunity.name}
          </span>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-11 pb-10 pt-9.5">
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
                  openCreateChannelFromTemplate(
                    template.id,
                    template.channelType,
                  )
                }
                type="button"
              >
                Use template
              </Button>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}
