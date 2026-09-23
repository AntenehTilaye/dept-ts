"use client";

import type { ReactNode } from "react";
import { ClockIcon } from "lucide-react";
import type { AvailableAction } from "@/platform/workflow/engine";
import { AuditPanel } from "@/components/AuditPanel";
import type { HistoryEntry } from "@/platform/audit/history";
import { AttachmentSlots, type SlotCard } from "@/components/documents/AttachmentSlots";
import { PageHeader } from "@/components/patterns/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActionBar, type TransitionAction } from "./ActionBar";
import { FieldRenderer, type FieldValue } from "./FieldRenderer";
import { StateBadge, type StateCategory } from "./StateBadge";
import { StepTimeline, type TimelineStep } from "./StepTimeline";

// The record page shell every process-type feature reuses (P9 composes it from a compiled
// definition; P7 uses it for tasks): header with state and actions, then the tabs
// Details / Deliverables / Comments / History / Acknowledgements. `extras` lets a module add
// panels without forking the shell.

export interface AcknowledgementRow {
  personId: string;
  name: string;
  role?: string;
  via?: string | null;
  status: "acknowledged" | "declined" | "pending";
  at?: string | null;
  reason?: string | null;
}

export interface RecordDetailProps {
  dept: string;
  title: string;
  description?: ReactNode;
  crumbs?: { label: string; href?: string }[];
  state: {
    key: string;
    label: string;
    category?: StateCategory;
    terminalCategory?: "success" | "rejected" | "cancelled";
  };
  overdue?: boolean;
  dueLabel?: string | null;
  fields: FieldValue[];
  steps: TimelineStep[];
  actions: AvailableAction[];
  onAct: TransitionAction;
  slots?: SlotCard[];
  slotSubject?: { subjectType: string; subjectId: string };
  canUploadSlots?: boolean;
  acknowledgements?: AcknowledgementRow[];
  history?: HistoryEntry[];
  comments?: ReactNode;
  documents?: ReactNode;
  extras?: { key: string; label: string; content: ReactNode }[];
}

const ACK_VARIANT = {
  acknowledged: "outline",
  declined: "destructive",
  pending: "secondary",
} as const;

export function RecordDetail({
  dept,
  title,
  description,
  crumbs,
  state,
  overdue,
  dueLabel,
  fields,
  steps,
  actions,
  onAct,
  slots,
  slotSubject,
  canUploadSlots,
  acknowledgements,
  history,
  comments,
  documents,
  extras,
}: RecordDetailProps) {
  return (
    <div className="flex flex-col gap-6" data-testid="record-detail">
      <PageHeader
        crumbs={crumbs}
        title={title}
        description={description}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StateBadge
              state={state.key}
              label={state.label}
              category={state.category}
              terminalCategory={state.terminalCategory}
            />
            {dueLabel ? (
              <Badge variant={overdue ? "destructive" : "secondary"} data-testid="due-badge">
                <ClockIcon /> {dueLabel}
              </Badge>
            ) : null}
          </div>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>What happens next</CardTitle>
          <CardDescription>
            Only the actions your role allows in this state are shown; disabled ones explain why.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActionBar actions={actions} onAct={onAct} />
        </CardContent>
      </Card>

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          {slots?.length ? <TabsTrigger value="deliverables">Deliverables</TabsTrigger> : null}
          {documents ? <TabsTrigger value="documents">Documents</TabsTrigger> : null}
          {comments ? <TabsTrigger value="comments">Comments</TabsTrigger> : null}
          {acknowledgements?.length ? (
            <TabsTrigger value="acks">Acknowledgements</TabsTrigger>
          ) : null}
          {history ? <TabsTrigger value="history">History</TabsTrigger> : null}
          {extras?.map((e) => (
            <TabsTrigger key={e.key} value={e.key}>
              {e.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="details">
          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <Card>
              <CardHeader>
                <CardTitle>Details</CardTitle>
              </CardHeader>
              <CardContent>
                <FieldRenderer fields={fields} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Progress</CardTitle>
              </CardHeader>
              <CardContent>
                <StepTimeline steps={steps} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {slots?.length && slotSubject ? (
          <TabsContent value="deliverables">
            <Card>
              <CardHeader>
                <CardTitle>Deliverables</CardTitle>
                <CardDescription>
                  Required slots must hold a file before the work can be submitted.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AttachmentSlots
                  dept={dept}
                  subject={slotSubject}
                  slots={slots}
                  canUpload={!!canUploadSlots}
                />
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}

        {documents ? (
          <TabsContent value="documents">
            <Card>
              <CardHeader>
                <CardTitle>Documents</CardTitle>
              </CardHeader>
              <CardContent>{documents}</CardContent>
            </Card>
          </TabsContent>
        ) : null}

        {comments ? (
          <TabsContent value="comments">
            <Card>
              <CardHeader>
                <CardTitle>Comments</CardTitle>
              </CardHeader>
              <CardContent>{comments}</CardContent>
            </Card>
          </TabsContent>
        ) : null}

        {acknowledgements?.length ? (
          <TabsContent value="acks">
            <Card>
              <CardHeader>
                <CardTitle>Acknowledgements</CardTitle>
                <CardDescription>
                  Who has seen the assignment; declining records a reason.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="divide-y text-sm" data-testid="acknowledgements">
                  {acknowledgements.map((a) => (
                    <li
                      key={`${a.personId}-${a.role ?? ""}`}
                      className="flex flex-wrap items-center justify-between gap-2 py-2"
                    >
                      <span>
                        {a.name}
                        {a.role ? (
                          <span className="text-xs text-muted-foreground"> · {a.role}</span>
                        ) : null}
                        {a.via ? (
                          <span className="text-xs text-muted-foreground"> · via {a.via}</span>
                        ) : null}
                        {a.reason ? (
                          <span className="text-xs text-muted-foreground"> · {a.reason}</span>
                        ) : null}
                      </span>
                      <span className="flex items-center gap-2">
                        {a.at ? (
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {a.at.slice(0, 16).replace("T", " ")}
                          </span>
                        ) : null}
                        <Badge variant={ACK_VARIANT[a.status]}>{a.status}</Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}

        {history ? (
          <TabsContent value="history">
            <Card>
              <CardHeader>
                <CardTitle>History</CardTitle>
              </CardHeader>
              <CardContent>
                <AuditPanel entries={history} />
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}

        {extras?.map((e) => (
          <TabsContent key={e.key} value={e.key}>
            {e.content}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
