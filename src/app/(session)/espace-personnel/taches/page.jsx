"use client";

import AssignedTasks from "@/components/workspace/AssignedTasks";
import PersonalTasks from "@/components/workspace/PersonalTasks";
import { canAny } from "@/lib/access";
import { useAuth } from "@/lib/session";

/**
 * Mes tâches : la liste privée du membre, puis les tâches de projet qui lui
 * sont assignées. Deux sources distinctes, jamais mélangées dans une même liste.
 */
export default function MesTachesPage() {
  const { user } = useAuth();
  const seesAssigned = canAny(user, ["task:read:assigned", "task:read:own"]);
  return (
    <div className="flex flex-col gap-6">
      <PersonalTasks />
      {seesAssigned ? <AssignedTasks /> : null}
    </div>
  );
}
