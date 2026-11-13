import type { TeamMember } from "@/features/company-team/teamModels";
import type {
  FunctionId,
  FunctionSlotView,
} from "@/features/cofounder/cofounderRecords";

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
  summary: CompanyMapSummary | undefined;
  whatsAppChannelId?: string | null;
};
