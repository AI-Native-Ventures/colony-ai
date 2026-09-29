import * as React from "react";

import { useCompanyWorkTrackingHeadsQuery } from "./companyWorkTrackingRelay";
import type { CompanyWorkTrackingHeadRecord } from "./companyWorkTrackingModels";

type CompanyWorkTrackingContextValue = {
  records: CompanyWorkTrackingHeadRecord[];
};

const CompanyWorkTrackingContext =
  React.createContext<CompanyWorkTrackingContextValue | null>(null);

export function CompanyWorkTrackingProvider({
  children,
  enabled,
}: {
  children: React.ReactNode;
  enabled: boolean;
}) {
  const query = useCompanyWorkTrackingHeadsQuery(enabled);
  const value = React.useMemo(
    () => ({ records: query.data ?? [] }),
    [query.data],
  );
  return (
    <CompanyWorkTrackingContext.Provider value={value}>
      {children}
    </CompanyWorkTrackingContext.Provider>
  );
}

export function useCompanyWorkTrackingContext() {
  return React.useContext(CompanyWorkTrackingContext);
}
