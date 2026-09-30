import * as React from "react";

import type {
  CreatePersonaInput,
  UpdatePersonaInput,
} from "@/shared/api/types";
import { useCommunities } from "@/features/communities/useCommunities";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import {
  companyRoleDraftFromMetadata,
  type CompanyRoleDraft,
} from "./CompanyRoleFields";
import {
  readCompanyRoleDraft,
  writeCompanyRoleDraft,
} from "../companyRoleDraftStore";

export function useCompanyRoleEditorState({
  companyRoleMode,
  open,
  displayName,
  initialValues,
  setDisplayName,
  setHasUserChanges,
}: {
  companyRoleMode: boolean;
  open: boolean;
  displayName: string;
  initialValues: CreatePersonaInput | UpdatePersonaInput | null;
  setDisplayName: React.Dispatch<React.SetStateAction<string>>;
  setHasUserChanges: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const { activeCommunity } = useCommunities();
  const roleDraftRelayUrl = activeCommunity?.relayUrl ?? null;
  const roleDraftPersonaId =
    initialValues && "id" in initialValues ? initialValues.id : "new";
  const membershipQuery = useMyRelayMembershipQuery();
  const [companyRoleDraft, setCompanyRoleDraft] = React.useState(() =>
    companyRoleDraftFromMetadata(null),
  );
  const companyRoleRequested = Boolean(
    companyRoleMode || initialValues?.companyRole,
  );
  const canCurateCompanyRoles =
    membershipQuery.data?.role === "owner" ||
    membershipQuery.data?.role === "admin";
  const rolePackEditorVisible = companyRoleRequested && canCurateCompanyRoles;
  const rolePackAccessPending = companyRoleMode && membershipQuery.isPending;
  const rolePackAccessDenied =
    companyRoleMode &&
    !membershipQuery.isPending &&
    !membershipQuery.isError &&
    !canCurateCompanyRoles;

  React.useEffect(() => {
    if (!open || !initialValues) return;
    const storedRoleDraft = readCompanyRoleDraft(
      roleDraftRelayUrl,
      roleDraftPersonaId,
    );
    setCompanyRoleDraft(
      storedRoleDraft?.roleDraft ??
        companyRoleDraftFromMetadata(initialValues.companyRole),
    );
    if (storedRoleDraft) setDisplayName(storedRoleDraft.displayName);
  }, [
    initialValues,
    open,
    roleDraftPersonaId,
    roleDraftRelayUrl,
    setDisplayName,
  ]);

  const updateCompanyRoleDraft = (next: CompanyRoleDraft) => {
    setHasUserChanges(true);
    setCompanyRoleDraft(next);
    writeCompanyRoleDraft(roleDraftRelayUrl, roleDraftPersonaId, {
      displayName,
      roleDraft: next,
    });
  };
  const updateCompanyRoleTitle = (next: string) => {
    setHasUserChanges(true);
    setDisplayName(next);
    writeCompanyRoleDraft(roleDraftRelayUrl, roleDraftPersonaId, {
      displayName: next,
      roleDraft: companyRoleDraft,
    });
  };

  return {
    canCurateCompanyRoles,
    companyRoleDraft,
    companyRoleRequested,
    membershipQuery,
    roleDraftPersonaId,
    roleDraftRelayUrl,
    rolePackAccessDenied,
    rolePackAccessPending,
    rolePackEditorVisible,
    setCompanyRoleDraft,
    updateCompanyRoleDraft,
    updateCompanyRoleTitle,
  };
}
