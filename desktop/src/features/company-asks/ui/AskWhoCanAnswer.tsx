import { AskAvatar } from "./AskPeople";

/** The "Who can answer?" side panel of the AskCompose board. */
export function AskWhoCanAnswer({
  channelName,
  raisedBy,
  responseFrom,
}: {
  channelName: string;
  raisedBy: { label: string; avatarUrl?: string | null; pubkey?: string };
  responseFrom: {
    label: string;
    avatarUrl?: string | null;
    isAgent?: boolean;
    pubkey?: string;
  } | null;
}) {
  return (
    <>
      <h2 className="ask3-aside-title" id="who-can-answer">
        Who can answer?
      </h2>
      <dl className="ask3-facts">
        <div className="ask3-fact" data-gap="6">
          <dt>Raised by</dt>
          <dd data-strong="true">
            <AskAvatar
              avatarUrl={raisedBy.avatarUrl}
              label={raisedBy.label}
              pubkey={raisedBy.pubkey}
            />
            {raisedBy.label}
          </dd>
        </div>
        {responseFrom ? (
          <div className="ask3-fact" data-gap="6">
            <dt>Response from</dt>
            <dd data-strong="true">
              <AskAvatar
                avatarUrl={responseFrom.avatarUrl}
                isAgent={responseFrom.isAgent}
                label={responseFrom.label}
                pubkey={responseFrom.pubkey}
              />
              {responseFrom.label}
            </dd>
          </div>
        ) : null}
        <div className="ask3-fact">
          <dt>Visibility</dt>
          <dd>People in #{channelName}</dd>
        </div>
        <div className="ask3-fact">
          <dt>After a response</dt>
          <dd data-prose="true">
            The answer is recorded in this thread for everyone in the channel to
            see.
          </dd>
        </div>
      </dl>
    </>
  );
}
