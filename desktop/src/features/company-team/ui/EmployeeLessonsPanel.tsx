import * as React from "react";
import { ArrowLeft } from "lucide-react";

import {
  useEmployeeLessonsQuery,
  useLessonActionMutation,
  type LessonHeadRecord,
  type LessonSnapshot,
} from "@/features/company-team/employeeDutiesLessons";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";

type LessonView =
  | { kind: "list" }
  | { kind: "new" }
  | { kind: "detail"; lessonId: string }
  | { kind: "edit"; lessonId: string };

function displayStatus(status: string) {
  return status.replaceAll("_", " ");
}

function emptySnapshot(
  lessonId: string,
  employeePubkey: string,
): LessonSnapshot {
  return {
    schemaVersion: 1,
    lessonId,
    employeePubkey,
    lesson: "",
    evidence: [],
    confidence: "unassessed",
  };
}

function evidenceIds(text: string) {
  return text
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function evidenceText(record: LessonHeadRecord) {
  return record.head.snapshot.evidence
    .map((reference) => reference.eventId)
    .join("\n");
}

export function EmployeeLessonsPanel({
  employeePubkey,
  actorPubkey,
  canManage,
}: {
  employeePubkey: string;
  actorPubkey: string;
  canManage: boolean;
}) {
  const lessonsQuery = useEmployeeLessonsQuery(employeePubkey);
  const mutation = useLessonActionMutation(employeePubkey);
  const [view, setView] = React.useState<LessonView>({ kind: "list" });
  const [draft, setDraft] = React.useState<LessonSnapshot | null>(null);
  const [evidenceDraft, setEvidenceDraft] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const selectedLessonId =
    view.kind === "detail" || view.kind === "edit" ? view.lessonId : null;
  const record = lessonsQuery.data?.find(
    (item) => item.head.lessonId === selectedLessonId,
  );

  React.useEffect(() => {
    if (view.kind === "new") {
      setDraft(
        emptySnapshot(crypto.randomUUID(), employeePubkey.toLowerCase()),
      );
      setEvidenceDraft("");
      setError(null);
    } else if (view.kind === "edit" && record) {
      setDraft({
        ...record.head.snapshot,
        confidence: "unassessed",
        evidence: record.head.snapshot.evidence.map(({ eventId }) => ({
          eventId,
        })),
      });
      setEvidenceDraft(evidenceText(record));
      setError(null);
    }
  }, [employeePubkey, record, view.kind]);

  async function saveLesson(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !actorPubkey) return;
    const ids = evidenceIds(evidenceDraft);
    if (
      ids.length === 0 ||
      ids.length > 100 ||
      ids.some((id) => !/^[0-9a-f]{64}$/.test(id)) ||
      new Set(ids).size !== ids.length
    ) {
      setError(
        "Supporting evidence must contain unique 64-character event IDs.",
      );
      return;
    }
    const snapshot: LessonSnapshot = {
      ...draft,
      employeePubkey: employeePubkey.toLowerCase(),
      lesson: draft.lesson.trim(),
      evidence: ids.map((eventId) => ({ eventId })),
      confidence: "unassessed",
    };
    setError(null);
    try {
      if (view.kind === "edit" && record) {
        await mutation.mutateAsync({
          schemaVersion: 1,
          lessonId: record.head.lessonId,
          action: "update",
          expectedHeadEventId: record.event.id,
          snapshot,
        });
        setView({ kind: "detail", lessonId: record.head.lessonId });
      } else if (view.kind === "new") {
        await mutation.mutateAsync({
          schemaVersion: 1,
          lessonId: snapshot.lessonId,
          action: "create",
          snapshot,
        });
        setView({ kind: "detail", lessonId: snapshot.lessonId });
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The lesson could not be saved.",
      );
    }
  }

  async function setLessonStatus(action: "deprecate" | "restore_candidate") {
    if (!record || !canManage) return;
    setError(null);
    try {
      await mutation.mutateAsync({
        schemaVersion: 1,
        lessonId: record.head.lessonId,
        action,
        expectedHeadEventId: record.event.id,
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The lesson could not be updated.",
      );
    }
  }

  if (lessonsQuery.isPending) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Loading lessons
      </p>
    );
  }
  if (lessonsQuery.isError) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {lessonsQuery.error.message}
      </p>
    );
  }
  if (lessonsQuery.subscriptionError) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {lessonsQuery.subscriptionError.message}
      </p>
    );
  }
  if (selectedLessonId && !record) {
    return (
      <section data-testid="employee-lessons-records">
        <Button
          className="mb-4 px-0"
          onClick={() => setView({ kind: "list" })}
          type="button"
          variant="link"
        >
          <ArrowLeft aria-hidden="true" /> Back to lessons
        </Button>
        <p className="text-sm text-muted-foreground">
          This lesson is unavailable.
        </p>
      </section>
    );
  }

  if ((view.kind === "new" || view.kind === "edit") && draft) {
    const editing = view.kind === "edit";
    return (
      <section className="max-w-[46rem]" data-testid="employee-lesson-editor">
        <Button
          className="mb-4 px-0"
          onClick={() =>
            setView(
              editing && record
                ? { kind: "detail", lessonId: record.head.lessonId }
                : { kind: "list" },
            )
          }
          type="button"
          variant="link"
        >
          <ArrowLeft aria-hidden="true" /> Lessons
        </Button>
        <h2 className="mb-6 text-xl font-semibold tracking-tight">
          {editing ? "Edit lesson" : "Propose a lesson"}
        </h2>
        <form
          className="space-y-4"
          onSubmit={(event) => void saveLesson(event)}
        >
          <label
            className="block space-y-2 text-sm font-medium"
            htmlFor="lesson-text"
          >
            <span>Lesson</span>
            <Input
              id="lesson-text"
              maxLength={4000}
              onChange={(event) =>
                setDraft({ ...draft, lesson: event.currentTarget.value })
              }
              required
              value={draft.lesson}
            />
          </label>
          <label
            className="block space-y-2 text-sm font-medium"
            htmlFor="lesson-evidence"
          >
            <span>Supporting evidence</span>
            <Textarea
              id="lesson-evidence"
              maxLength={100 * 65}
              onChange={(event) => setEvidenceDraft(event.currentTarget.value)}
              required
              value={evidenceDraft}
            />
          </label>
          <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
            New and edited lessons need review before becoming active. They
            cannot grant tools or spending access.
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
            <Button disabled={mutation.isPending || !actorPubkey} type="submit">
              {mutation.isPending ? "Saving" : "Save candidate"}
            </Button>
            <Button
              onClick={() =>
                setView(
                  editing && record
                    ? { kind: "detail", lessonId: record.head.lessonId }
                    : { kind: "list" },
                )
              }
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
          </div>
        </form>
      </section>
    );
  }

  if (view.kind === "detail" && record) {
    const { head } = record;
    const mayEdit =
      canManage ||
      head.proposedByPubkey.toLowerCase() === actorPubkey.toLowerCase();
    const helpful = head.snapshot.evidence.filter(
      (reference) => reference.assessment === "helpful",
    ).length;
    const harmful = head.snapshot.evidence.filter(
      (reference) => reference.assessment === "harmful",
    ).length;
    return (
      <section data-testid="employee-lesson-detail">
        <Button
          className="mb-4 px-0"
          onClick={() => setView({ kind: "list" })}
          type="button"
          variant="link"
        >
          <ArrowLeft aria-hidden="true" /> Lessons with evidence
        </Button>
        <h2 className="text-lg font-semibold">Lesson review</h2>
        <h3 className="mt-4 text-base font-semibold">{head.snapshot.lesson}</h3>
        <div className="my-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <Badge variant="outline">{displayStatus(head.status)}</Badge>
          <span>{head.snapshot.evidence.length} evidence records</span>
          <span>Confidence: {head.snapshot.confidence}</span>
        </div>
        <div className="mb-5 rounded-lg border border-border p-4 text-sm">
          <p>Evidence: {head.snapshot.evidence.length} records</p>
          <p className="mt-2">
            Helpful: {helpful} · Harmful: {harmful}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {mayEdit && head.status !== "deprecated" ? (
            <Button
              onClick={() => setView({ kind: "edit", lessonId: head.lessonId })}
              type="button"
              variant="outline"
            >
              Edit lesson
            </Button>
          ) : null}
          {canManage && head.status !== "deprecated" ? (
            <Button
              disabled={mutation.isPending}
              onClick={() => void setLessonStatus("deprecate")}
              type="button"
              variant="outline"
            >
              Deprecate lesson
            </Button>
          ) : null}
          {canManage && head.status === "deprecated" ? (
            <Button
              disabled={mutation.isPending}
              onClick={() => void setLessonStatus("restore_candidate")}
              type="button"
              variant="outline"
            >
              Restore as candidate
            </Button>
          ) : null}
        </div>
        {error ? (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <p className="mt-6 text-xs text-muted-foreground">
          Lessons never grant new tool, money or secret permissions. Sensitive
          policy changes still need human approval.
        </p>
      </section>
    );
  }

  return (
    <section data-testid="employee-lessons-records">
      <div className="mb-3 mt-6 flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold">Lessons with evidence</h2>
        <Button
          disabled={!actorPubkey}
          onClick={() => setView({ kind: "new" })}
          type="button"
          variant="outline"
        >
          Propose lesson
        </Button>
      </div>
      {lessonsQuery.data?.length ? (
        <div className="divide-y divide-border">
          {lessonsQuery.data.map(({ head }) => (
            <button
              className="flex w-full items-center gap-4 py-4 text-left hover:bg-muted/40"
              data-testid={`employee-lesson-${head.lessonId}`}
              key={head.lessonId}
              onClick={() =>
                setView({ kind: "detail", lessonId: head.lessonId })
              }
              type="button"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">
                  {head.snapshot.lesson}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {head.snapshot.evidence.length} evidence records
                </span>
              </span>
              <Badge variant="outline">{displayStatus(head.status)}</Badge>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No lessons yet.</p>
      )}
    </section>
  );
}
