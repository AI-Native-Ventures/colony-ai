import { ColonySteps } from "@/shared/ui/ColonySteps";
import { HashIcon, PrivateChannelIcon } from "@/shared/ui/colonyIcons";

/**
 * Header of the compose step: the destination chip, the title and the step
 * tracker (standard asks), or the read-only chip and subtitle (Propose a hire).
 */
export function AskComposeHeader({
  hire,
  privateChannel,
  destination,
  title,
  locked,
  onChangeDestination,
}: {
  hire: boolean;
  privateChannel: boolean;
  destination: string;
  title: string;
  locked: boolean;
  onChangeDestination: () => void;
}) {
  const ChannelMark = privateChannel ? PrivateChannelIcon : HashIcon;
  return (
    <header className="ask3-head-row">
      <div className="ask3-head" data-gap="10">
        {hire ? (
          <span className="ask3-chip">
            <ChannelMark size={14} strokeWidth={2.2} />
            {destination}
          </span>
        ) : (
          <button
            className="ask3-chip"
            disabled={locked}
            onClick={onChangeDestination}
            type="button"
          >
            <ChannelMark size={14} strokeWidth={2.2} />
            {destination}
            <span className="ask3-chip-change">Change</span>
          </button>
        )}
        <h1 className="ask3-title" id="ask-create-title">
          {title}
        </h1>
        {hire ? (
          <span className="ask3-sub">
            Describe the role you need. An owner reviews it, then the founder
            signs off.
          </span>
        ) : null}
      </div>
      {hire ? null : (
        <ColonySteps
          align="end"
          current={2}
          label="Ask steps"
          onStepSelect={onChangeDestination}
          steps={["Destination", "Ask"]}
        />
      )}
    </header>
  );
}
