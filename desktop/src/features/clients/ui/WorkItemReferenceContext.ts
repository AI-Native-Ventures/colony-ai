import * as React from "react";

import type {
  EventRecord,
  WorkItemHead,
} from "@/features/clients/lib/businessRecords";

export type WorkItemReferenceContextValue = {
  channelId: string | null;
  records: readonly EventRecord<WorkItemHead>[];
};

export const WorkItemReferenceContext =
  React.createContext<WorkItemReferenceContextValue | null>(null);
