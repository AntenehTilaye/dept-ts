import { headers } from "next/headers";
import { AlertTriangleIcon, LockIcon } from "lucide-react";
import { withTenantTx } from "@/lib/db/tenant";
import { clientKey, rateLimiter } from "@/lib/rate-limit";
import { bootstrap } from "@/lib/bootstrap";
import { CampaignError, departmentOfToken, openLink } from "@/platform/campaign";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PublicForm } from "./PublicForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Respond" };

// The one page that needs no session: a campaign invitation link. The token is the credential,
// so the page is rate limited per address and never reveals anything about an unknown token
// beyond "not valid".

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center gap-6 p-6">
      {children}
      <p className="text-center text-xs text-muted-foreground">Department Management Tool Suite</p>
    </main>
  );
}

export default async function PublicCampaignPage(props: PageProps<"/c/[token]">) {
  bootstrap();
  const { token } = await props.params;
  const gate = rateLimiter("campaign:open", { capacity: 20, refillPerSecond: 0.5 }).take(
    clientKey(await headers()),
  );
  if (!gate.ok)
    return (
      <Shell>
        <Alert variant="destructive" role="alert">
          <AlertTriangleIcon />
          <span>Too many attempts from this address. Please wait a moment and reload.</span>
        </Alert>
      </Shell>
    );

  const departmentId = await departmentOfToken(token);
  if (!departmentId)
    return (
      <Shell>
        <Alert variant="destructive" role="alert" data-testid="link-unknown">
          <AlertTriangleIcon />
          <span>This link is not valid. Please use the link from your invitation email.</span>
        </Alert>
      </Shell>
    );

  let link;
  try {
    link = await withTenantTx(departmentId, (tx) => openLink(tx, token));
  } catch (error) {
    const message =
      error instanceof CampaignError ? error.message : "This link cannot be opened right now.";
    return (
      <Shell>
        <Alert variant="destructive" role="alert" data-testid="link-refused">
          <AlertTriangleIcon />
          <span>{message}</span>
        </Alert>
      </Shell>
    );
  }

  const anonymous = link.campaign.anonymityMode === "anonymous";
  return (
    <Shell>
      <Card>
        <CardHeader>
          <CardTitle>{link.campaign.title}</CardTitle>
          <CardDescription>
            Open until {link.campaign.resolvedClosesAt.toISOString().slice(0, 10)}.
            {anonymous ? (
              <span className="mt-1 flex items-center gap-1 text-foreground">
                <LockIcon className="size-3.5" aria-hidden="true" /> Anonymous: your answers are
                stored without any link to you.
              </span>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PublicForm
            token={token}
            fields={link.fields}
            initialAnswers={link.answers}
            anonymous={anonymous}
            editing={link.editing}
          />
        </CardContent>
      </Card>
    </Shell>
  );
}
