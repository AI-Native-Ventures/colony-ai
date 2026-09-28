import * as React from "react";

export type CompanyWorkMessageContextValue = {
  channelId: string;
  sourceEventId: string;
  threadRootEventId: string;
};

const CompanyWorkMessageContext =
  React.createContext<CompanyWorkMessageContextValue | null>(null);

export const CompanyWorkMessageProvider = CompanyWorkMessageContext.Provider;

export function useCompanyWorkMessageContext() {
  return React.useContext(CompanyWorkMessageContext);
}
