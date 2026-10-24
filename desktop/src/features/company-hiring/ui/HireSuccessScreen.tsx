import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { usePersonasQuery } from "@/features/agents/hooks";
import { useChannelsQuery } from "@/features/channels/hooks";
import { EmployeeAvatar } from "@/features/company-team/ui/EmployeeAvatar";
import { useCompanyTeamQuery } from "@/features/company-team/teamRelay";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { useCompanyHireHeadQuery } from "../hireRelay";
import { hireIntroductionText } from "../hireIntroduction";
import { HireButton, HirePage, HireSteps } from "./HirePresentation";
import { memberName } from "./hireMembers";

export function HireSuccessScreen({ hireId }: { hireId: string }) {
  const hireQuery = useCompanyHireHeadQuery(hireId);
  const teamQuery = useCompanyTeamQuery();
  const channelsQuery = useChannelsQuery();
  const personasQuery = usePersonasQuery();
  const { goChannel, goTeam, goTeamMember } = useAppNavigation();
  const members = teamQuery.data?.members ?? [];
  const managerPubkey = hireQuery.data?.head.proposal.managerPubkey;
  const profilesQuery = useUsersBatchQuery(
    members.map((member) => member.pubkey),
    { enabled: members.length > 0 },
  );
  if (hireQuery.isError) throw hireQuery.error;
  const record = hireQuery.data;
  if (record?.head.status !== "hired" || !record.head.employeePubkey)
    return null;

  const proposal = record.head.proposal;
  const name = proposal.displayName;
  const employeePubkey = record.head.employeePubkey;
  const profiles = profilesQuery.data?.profiles ?? {};
  const manager = managerPubkey
    ? members.find(
        (member) => member.pubkey.toLowerCase() === managerPubkey.toLowerCase(),
      )
    : members.find((member) => member.role === "owner");
  const managerLabel = manager
    ? memberName(manager, profiles)
    : "the company owner";
  const channelName =
    channelsQuery.data?.find(
      (channel) => channel.id === proposal.introductionChannelId,
    )?.name ?? "";
  const persona = personasQuery.data?.find(
    (candidate) => candidate.id === proposal.rolePack.personaId,
  );

  return (
    <HirePage centered testId="hire-success">
      <HireSteps centered current={4} />
      <div className="colony-hire-hero">
        <EmployeeAvatar
          className="colony-hire-avatar-104"
          definition={persona?.avatarUrl}
          name={name}
          personaId={persona?.id}
        />
        <h1>{name} joined the team.</h1>
        <span>
          {proposal.title} · reports to {managerLabel} · #{channelName}
        </span>
      </div>
      <section aria-labelledby="intro-preview" className="colony-hire-intro">
        <h2 className="colony-hire-eyebrow" id="intro-preview">
          Introduction in #{channelName}
        </h2>
        <article className="colony-hire-intro-card">
          <EmployeeAvatar
            className="colony-hire-avatar-44"
            definition={persona?.avatarUrl}
            name={name}
            personaId={persona?.id}
          />
          <div>
            <div className="colony-hire-intro-meta">
              <strong>{name}</strong>
              <span>{proposal.title} · just now</span>
            </div>
            <p>{hireIntroductionText(proposal.title)}</p>
          </div>
        </article>
      </section>
      <div className="colony-hire-success-actions">
        <HireButton
          onClick={() => void goTeamMember(employeePubkey)}
          testId="hire-open-profile"
        >
          Open employee profile
        </HireButton>
        <HireButton
          onClick={() => void goTeam()}
          testId="hire-view-team"
          variant="outline"
        >
          View team
        </HireButton>
        <HireButton
          onClick={() => void goChannel(proposal.introductionChannelId)}
          testId="hire-open-introduction"
          variant="outline"
        >
          Open introduction channel
        </HireButton>
      </div>
    </HirePage>
  );
}
