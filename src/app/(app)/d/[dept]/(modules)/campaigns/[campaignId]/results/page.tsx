import { notFound } from "next/navigation";
import { BarChart3Icon, LockIcon, UsersIcon } from "lucide-react";
import { dbOf, pageContextCan } from "@/lib/auth/page";
import { results } from "@/platform/campaign";
import { EmptyState } from "@/components/patterns/EmptyState";
import { PageHeader } from "@/components/patterns/PageHeader";
import { StatCard } from "@/components/patterns/StatCard";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ExportButton } from "./ExportButton";

export const dynamic = "force-dynamic";

type Stats = NonNullable<Awaited<ReturnType<typeof results>>["cells"][number]["stats"]>;

function renderStats(stats: Stats | null) {
  if (!stats) return <span className="text-muted-foreground">withheld</span>;
  switch (stats.kind) {
    case "numeric":
      return (
        <span className="tabular-nums">
          mean {stats.mean} <span className="text-muted-foreground">(sd {stats.sd})</span>
        </span>
      );
    case "choice":
      return (
        <span className="flex flex-wrap gap-1">
          {Object.entries(stats.counts).map(([k, v]) => (
            <Badge key={k} variant="secondary">
              {k}: {v}
            </Badge>
          ))}
        </span>
      );
    case "ranked":
      return (
        <span className="flex flex-wrap gap-1">
          {Object.entries(stats.bordaByOption)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => (
              <Badge key={k} variant="outline">
                {k}: {v}
              </Badge>
            ))}
        </span>
      );
    case "text":
      return stats.samples.length ? (
        <ul className="list-disc pl-4 text-xs">
          {stats.samples.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      ) : (
        <span className="text-muted-foreground">free text is not released</span>
      );
    default:
      return <span className="text-muted-foreground">—</span>;
  }
}

/** Read-only participation and results of one campaign (the lifecycle lives in the runtime). */
export default async function CampaignResultsPage(
  props: PageProps<"/d/[dept]/campaigns/[campaignId]/results">,
) {
  const { dept, campaignId } = await props.params;
  const ctx = await pageContextCan(dept, "campaign.manage");
  const db = dbOf(ctx);
  const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) notFound();
  const view = await results(db, campaignId);
  const anonymous = view.campaign.anonymityMode === "anonymous";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumbs={[{ label: "Campaigns" }, { label: view.campaign.title }]}
        title={view.campaign.title}
        description={
          anonymous
            ? "Responses are anonymous: nothing here can be traced back to a respondent."
            : "Responses are recorded under the respondent's name."
        }
        actions={<ExportButton dept={dept} campaignId={campaignId} />}
      />
      <section aria-label="Participation" className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Invited" value={view.participation.invited} icon={<UsersIcon />} />
        <StatCard label="Responded" value={view.participation.submitted} />
        <StatCard
          label="Response rate"
          value={`${Math.round(view.participation.rate * 100)}%`}
          icon={<BarChart3Icon />}
        />
        <StatCard
          label="Opened, not sent"
          value={view.participation.opened}
          hint="Invitations opened without a submitted response"
        />
      </section>

      {view.belowReportThreshold ? (
        <Card className="border-amber-500/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <LockIcon className="size-4" aria-hidden="true" /> Below the reporting threshold
            </CardTitle>
            <CardDescription>
              {view.participation.responses} of at least {view.campaign.minResponsesForReport}{" "}
              responses. Individual cells are still suppressed until enough people answer.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Results</CardTitle>
          <CardDescription>
            A cell computed from fewer responses than the k-anonymity threshold is withheld.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {view.cells.length === 0 ? (
            <EmptyState
              icon={<BarChart3Icon />}
              title="No results yet"
              hint="Results are computed when the campaign closes, or on demand from the export."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Question</TableHead>
                  {view.cells.some((c) => c.subjectLabel) ? <TableHead>Subject</TableHead> : null}
                  {view.cells.some((c) => c.groupByKey) ? <TableHead>Group</TableHead> : null}
                  <TableHead>Responses</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.cells.map((c) => (
                  <TableRow
                    key={`${c.questionStableKey}-${c.subjectId ?? ""}-${c.groupByKey}`}
                    data-testid={`result-${c.questionStableKey}`}
                    data-suppressed={c.suppressed ? "true" : "false"}
                  >
                    <TableCell>{c.questionLabel}</TableCell>
                    {view.cells.some((x) => x.subjectLabel) ? (
                      <TableCell>{c.subjectLabel ?? "—"}</TableCell>
                    ) : null}
                    {view.cells.some((x) => x.groupByKey) ? (
                      <TableCell>{c.groupByKey || "all"}</TableCell>
                    ) : null}
                    <TableCell className="tabular-nums">{c.n}</TableCell>
                    <TableCell>
                      {c.suppressed ? (
                        <Badge variant="secondary">
                          <LockIcon /> suppressed
                        </Badge>
                      ) : (
                        renderStats(c.stats)
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
