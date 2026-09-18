import { signOutAction } from "@/app/(auth)/select-department/actions";
import { Button } from "@/components/ui/button";

export function UserMenu({
  userName,
  userEmail,
  isAdmin,
}: {
  userName: string;
  userEmail: string;
  isAdmin: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="hidden text-right sm:block">
        <p className="text-sm font-medium">{userName}</p>
        <p className="text-xs text-muted-foreground">{userEmail}</p>
      </div>
      {isAdmin ? (
        <Button asChild variant="outline" size="sm">
          <a href="/admin">Admin</a>
        </Button>
      ) : null}
      <form action={signOutAction}>
        <Button variant="ghost" size="sm" type="submit">
          Sign out
        </Button>
      </form>
    </div>
  );
}
