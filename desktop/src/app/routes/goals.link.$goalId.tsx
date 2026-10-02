import { createFileRoute } from "@tanstack/react-router";
import { GoalWorkLinkScreen } from "@/features/goals/ui/GoalWorkLinkScreen";

export const Route = createFileRoute("/goals/link/$goalId")({
  component: GoalWorkLinkRouteComponent,
});

function GoalWorkLinkRouteComponent() {
  const { goalId } = Route.useParams();
  return <GoalWorkLinkScreen goalId={goalId} key={goalId} />;
}
