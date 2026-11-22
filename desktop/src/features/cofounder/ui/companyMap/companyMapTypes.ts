import type { TeamMember } from "@/features/company-team/teamModels";
import type {
  FunctionId,
  FunctionSlotView,
} from "@/features/cofounder/cofounderRecords";
import type { CompanyMapWindowJob } from "@/features/cofounder/companyMapJobRoutes";
import type { CompanyMapOperationsWorkflow } from "@/features/cofounder/companyMapOperations";
import type {
  PrebuiltHireCompletion,
  PrebuiltHireStartup,
} from "@/features/cofounder/prebuiltHireStorage";

export type ProfileLookup = Record<
  string,
  { displayName: string | null; avatarUrl?: string | null }
>;

export type CompanyMapSummary = {
  total: number;
  byPart: Record<FunctionId, number>;
  byJob: Record<string, number>;
};

export type CompanyMapBoardProps = {
  companyId?: string;
  companyName: string;
  relayUrl?: string;
  members: TeamMember[];
  profiles: ProfileLookup;
  slots: FunctionSlotView[];
  liveFunctionIds: readonly FunctionId[];
  ownerName: string;
  ownerPubkey?: string;
  ownerAvatarUrl?: string | null;
  scoutPubkey?: string | null;
  /** Prebuilt heads are an owner-only map action. */
  canHirePrebuiltHeads?: boolean;
  onHireHead?: (functionId: FunctionId) => void;
  /** Retry a failed local agent start after the hire itself has completed. */
  onRetryPrebuiltHireStart?: (functionId: FunctionId) => void;
  /** The newest successful map hire, used to reopen its direct chat. */
  recentPrebuiltHires?: Partial<Record<FunctionId, PrebuiltHireCompletion>>;
  /** Local host startup state for a recently hired head. */
  prebuiltHireStartups?: Partial<Record<FunctionId, PrebuiltHireStartup>>;
  summary: CompanyMapSummary | undefined;
  whatsAppChannelId?: string | null;
  /** Data-backed Operations workflows. Phone keeps the established static map. */
  operationsWorkflows?: readonly CompanyMapOperationsWorkflow[];
  /** A real Scout conversation for the data-backed workflow affordances. */
  scoutChannelId?: string | null;
  /** A scoped client channel when the active company explicitly provides one. */
  clientChannelId?: string | null;
  mapWindowDepth?: number;
  mapWindowJob?: CompanyMapWindowJob | null;
  onMapWindowClose?: () => void;
  onMapWindowFit?: () => void;
};
