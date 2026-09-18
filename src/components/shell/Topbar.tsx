import { DepartmentSwitcher } from "./DepartmentSwitcher";
import { UserMenu } from "./UserMenu";

export function Topbar({
  deptSlug,
  userName,
  userEmail,
  isAdmin,
  departments,
}: {
  deptSlug: string;
  userName: string;
  userEmail: string;
  isAdmin: boolean;
  departments: Array<{ slug: string; code: string; name: string }>;
}) {
  return (
    <header className="flex h-14 items-center justify-between gap-4 border-b bg-card px-4 md:px-8">
      <DepartmentSwitcher current={deptSlug} departments={departments} />
      <UserMenu userName={userName} userEmail={userEmail} isAdmin={isAdmin} />
    </header>
  );
}
