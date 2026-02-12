import { GoalsView } from "@/components/goals-view";
import { SchedulingRules } from "@/components/scheduling-rules";

export default function GoalsPage() {
  return (
    <div className="space-y-8">
      <GoalsView />
      <SchedulingRules />
    </div>
  );
}
