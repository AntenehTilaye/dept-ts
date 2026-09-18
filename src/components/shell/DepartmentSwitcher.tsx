import { selectDepartmentAction } from "@/app/(auth)/select-department/actions";
import { Select } from "@/components/ui/select";

/** Switching departments goes through the server action so the session records the choice. */
export function DepartmentSwitcher({
  current,
  departments,
}: {
  current: string;
  departments: Array<{ slug: string; code: string; name: string }>;
}) {
  if (departments.length <= 1) {
    const only = departments[0];
    return <span className="text-sm font-medium">{only ? `${only.name} (${only.code})` : ""}</span>;
  }
  return (
    <form action={selectDepartmentAction} className="flex items-center gap-2">
      <label htmlFor="dept-switch" className="text-sm text-muted-foreground">
        Department
      </label>
      <Select id="dept-switch" name="slug" defaultValue={current} className="w-56">
        {departments.map((d) => (
          <option key={d.slug} value={d.slug}>
            {d.name} ({d.code})
          </option>
        ))}
      </Select>
      <button type="submit" className="text-sm underline">
        Switch
      </button>
    </form>
  );
}
