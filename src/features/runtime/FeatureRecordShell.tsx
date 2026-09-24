"use client";

import { useRouter } from "next/navigation";
import { RecordDetail, type RecordDetailProps } from "@/components/feature/RecordDetail";
import { actOnStepAction } from "@/app/(app)/d/[dept]/f/[featureKey]/actions";

/**
 * Binds the generic runtime's one action to the shared record shell. The transition key carries
 * the step and the action, which is how a single server action serves every feature.
 */
export function FeatureRecordShell({
  dept,
  featureKey,
  recordId,
  ...rest
}: Omit<RecordDetailProps, "onAct"> & {
  featureKey: string;
  recordId: string;
}) {
  const router = useRouter();
  return (
    <RecordDetail
      {...rest}
      dept={dept}
      onAct={async (input) => {
        const [stepKey = "", actionKey = ""] = input.transitionKey.split(".");
        const result = await actOnStepAction({
          dept,
          featureKey,
          recordId,
          stepKey,
          actionKey,
          branchKey: input.branchKey,
          comment: input.comment,
          answers: input.fields,
        });
        if (result.ok) router.refresh();
        return result;
      }}
    />
  );
}
