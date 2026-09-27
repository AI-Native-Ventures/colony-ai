import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import {
  BUSINESS_RECORD_SCHEMA_VERSION,
  buildWorkItemActionTemplate,
  type EventRecord,
  type BusinessEventTemplate,
  type ClientHead,
  isBusinessRecordCommandRejection,
} from "@/features/clients/lib/businessRecords";
import { businessRecordService } from "@/features/clients/lib/businessRecords";
import {
  useClientRecordsQuery,
  useSubmitBusinessRecordMutation,
} from "@/features/clients/useBusinessRecords";
import { useIdentityQuery } from "@/shared/api/hooks";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { RecordMessage } from "@/features/clients/ui/ClientWorkspace";

type CreateWorkDialogProps = {
  clients: readonly EventRecord<ClientHead>[];
  initialClientId?: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

export function CreateWorkDialog({
  clients,
  initialClientId,
  onOpenChange,
  open,
}: CreateWorkDialogProps) {
  const [clientId, setClientId] = React.useState(initialClientId ?? "");
  const [title, setTitle] = React.useState("");
  const workItemIdRef = React.useRef<string | null>(null);
  const templateRef = React.useRef<BusinessEventTemplate | null>(null);
  const signedEventRef = React.useRef<Awaited<
    ReturnType<typeof businessRecordService.sign>
  > | null>(null);
  const [hasPreparedEvent, setHasPreparedEvent] = React.useState(false);
  const [signingError, setSigningError] = React.useState<unknown>(null);
  const identityPubkey = useIdentityQuery().data?.pubkey.toLowerCase() ?? "";
  const clientRecords = useClientRecordsQuery(clientId || null);
  const submitMutation = useSubmitBusinessRecordMutation();
  const { goWorkItem } = useAppNavigation();
  const activeClients = clients.filter(
    ({ value }) => value.status !== "archived",
  );
  const currentMember = clientRecords.membersQuery.data?.find(
    (member) => member.pubkey.toLowerCase() === identityPubkey,
  );
  const canCreate =
    Boolean(identityPubkey) &&
    (currentMember?.role === "owner" || currentMember?.role === "admin") &&
    clientRecords.clientQuery.isSuccess &&
    clientRecords.clientQuery.data?.value.status !== "archived";

  React.useEffect(() => {
    if (!open) {
      workItemIdRef.current = null;
      templateRef.current = null;
      signedEventRef.current = null;
      setHasPreparedEvent(false);
      setSigningError(null);
      setTitle("");
      setClientId(initialClientId ?? "");
      submitMutation.reset();
      return;
    }
    workItemIdRef.current ??= crypto.randomUUID();
  }, [initialClientId, open, submitMutation.reset]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (submitMutation.isPending && !nextOpen) return;
    if (
      hasPreparedEvent &&
      !nextOpen &&
      !isBusinessRecordCommandRejection(submitMutation.error)
    )
      return;
    onOpenChange(nextOpen);
  };

  const cancel = () => {
    if (
      hasPreparedEvent &&
      !isBusinessRecordCommandRejection(submitMutation.error)
    )
      return;
    submitMutation.discardPending();
    templateRef.current = null;
    signedEventRef.current = null;
    setHasPreparedEvent(false);
    onOpenChange(false);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedTitle = title.trim();
    const clientRecord = clientRecords.clientQuery.data;
    if (
      !workItemIdRef.current ||
      !normalizedTitle ||
      !clientRecord ||
      !canCreate
    ) {
      return;
    }
    const stableWorkItemId = workItemIdRef.current;
    const client = clientRecord.value;
    try {
      if (!templateRef.current) {
        templateRef.current = buildWorkItemActionTemplate({
          schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
          clientId: client.clientId,
          workItemId: stableWorkItemId,
          action: "create",
          expectedHeadEventId: null,
          head: {
            schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
            clientId: client.clientId,
            workItemId: stableWorkItemId,
            title: normalizedTitle,
            status: "active",
            assignedPubkeys: [identityPubkey],
            approverPubkeys: client.approverPubkeys,
            deliverables: [],
          },
        });
      }
      if (!signedEventRef.current) {
        signedEventRef.current = await businessRecordService.sign(
          templateRef.current,
        );
        setHasPreparedEvent(true);
      }
      if (!signedEventRef.current) return;
      setSigningError(null);
      submitMutation.mutate(signedEventRef.current, {
        onSuccess: () => {
          templateRef.current = null;
          signedEventRef.current = null;
          setHasPreparedEvent(false);
          onOpenChange(false);
          void goWorkItem(stableWorkItemId, client.clientId);
        },
      });
    } catch (error) {
      setSigningError(error);
    }
  };

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Create work</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-5" onSubmit={submit}>
          {submitMutation.isError ? (
            <RecordMessage kind="error">
              {submitMutation.error.message}
            </RecordMessage>
          ) : null}
          {signingError ? (
            <RecordMessage kind="error">
              {signingError instanceof Error
                ? signingError.message
                : "Work could not be signed."}
            </RecordMessage>
          ) : null}
          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="new-work-title">
              Work title
            </label>
            <Input
              autoFocus
              disabled={hasPreparedEvent || submitMutation.isPending}
              id="new-work-title"
              maxLength={180}
              onChange={(event) => setTitle(event.target.value)}
              required
              value={title}
            />
          </div>
          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="new-work-client">
              Client
            </label>
            <select
              className="h-9 rounded-lg border border-input/40 bg-background px-3 text-sm"
              id="new-work-client"
              disabled={hasPreparedEvent || submitMutation.isPending}
              onChange={(event) => {
                setClientId(event.target.value);
                submitMutation.reset();
              }}
              required
              value={clientId}
            >
              <option value="">Select a client</option>
              {activeClients.map(({ value }) => (
                <option key={value.clientId} value={value.clientId}>
                  {value.displayName}
                </option>
              ))}
            </select>
          </div>
          {clientRecords.channelsQuery.isError ? (
            <RecordMessage kind="error">
              Client channel could not be loaded.
            </RecordMessage>
          ) : null}
          {clientId && clientRecords.clientQuery.isError ? (
            <RecordMessage kind="error">
              Client record could not be loaded.
            </RecordMessage>
          ) : null}
          {clientRecords.clientQuery.isSuccess &&
          clientRecords.clientQuery.data?.value.status === "archived" ? (
            <RecordMessage kind="error">
              Restore this client before creating work.
            </RecordMessage>
          ) : null}
          {clientRecords.membersQuery.isSuccess && !canCreate ? (
            <RecordMessage kind="error">
              Only a client channel admin can create work.
            </RecordMessage>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              disabled={
                submitMutation.isPending ||
                (hasPreparedEvent &&
                  !isBusinessRecordCommandRejection(submitMutation.error))
              }
              onClick={cancel}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={
                submitMutation.isPending ||
                !title.trim() ||
                !clientId ||
                !canCreate
              }
              type="submit"
            >
              {submitMutation.isPending
                ? "Saving"
                : hasPreparedEvent
                  ? "Retry"
                  : signingError
                    ? "Retry"
                    : "Create work"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
