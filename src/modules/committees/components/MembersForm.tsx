"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateMembersAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

// Membership changes hands often — somebody leaves, somebody joins, the chair passes on — so it
// is edited here rather than by re-running the process that constituted the committee. Each save
// closes the memberships that ended and opens the new ones, which is what the derived grants
// follow.

export interface MemberOption {
  personId: string;
  fullName: string;
}

export function MembersForm({
  dept,
  recordId,
  staff,
  selected,
  chairId,
}: {
  dept: string;
  recordId: string;
  staff: MemberOption[];
  selected: string[];
  chairId: string | null;
}) {
  const router = useRouter();
  const [members, setMembers] = useState<string[]>(selected);
  const [chair, setChair] = useState<string>(chairId ?? "");
  const [pending, startTransition] = useTransition();

  const toggle = (personId: string, on: boolean) =>
    setMembers((current) =>
      on ? Array.from(new Set([...current, personId])) : current.filter((p) => p !== personId),
    );

  const save = () => {
    startTransition(async () => {
      const result = await updateMembersAction({
        dept,
        recordId,
        members,
        chair: chair || null,
      });
      if (result.ok) {
        toast.success("Membership updated.");
        router.refresh();
        return;
      }
      toast.error(result.message);
    });
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4" data-testid="members-form">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Who is on it</legend>
        {staff.map((person) => (
          <Label key={person.personId} className="flex items-center gap-2 text-sm font-normal">
            <Checkbox
              checked={members.includes(person.personId)}
              onCheckedChange={(value) => toggle(person.personId, value === true)}
            />
            {person.fullName}
          </Label>
        ))}
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="committee-chair">Chair</Label>
        <NativeSelect
          id="committee-chair"
          value={chair}
          onChange={(e) => setChair(e.target.value)}
        >
          <option value="">(nobody)</option>
          {staff.map((person) => (
            <option key={person.personId} value={person.personId}>
              {person.fullName}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div>
        <Button type="button" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save membership"}
        </Button>
      </div>
    </div>
  );
}
