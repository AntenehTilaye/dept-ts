"use client";

import { useRouter } from "next/navigation";
import { RecordDetail, type RecordDetailProps } from "@/components/feature/RecordDetail";
import { transitionTaskAction } from "./actions";

/**
 * Binds the task's server actions to the shared record shell. Everything else is plain data
 * from the page, so the same shell serves the generic feature runtime in P9.
 */
export function TaskRecord({
  dept,
  taskId,
  ...rest
}: Omit<RecordDetailProps, "onAct"> & { taskId: string }) {
  const router = useRouter();
  return (
    <RecordDetail
      {...rest}
      dept={dept}
      onAct={async (input) => {
        const result = await transitionTaskAction({
          dept,
          taskId,
          transitionKey: input.transitionKey,
          comment: input.comment,
          fields: input.fields,
        });
        if (result.ok) router.refresh();
        return result;
      }}
    />
  );
}
