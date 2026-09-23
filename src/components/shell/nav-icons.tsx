import {
  BellIcon,
  BookOpenIcon,
  BriefcaseIcon,
  CalendarDaysIcon,
  ClipboardListIcon,
  ClockIcon,
  DoorOpenIcon,
  FileTextIcon,
  FilesIcon,
  GraduationCapIcon,
  HomeIcon,
  LayersIcon,
  ListChecksIcon,
  MailIcon,
  ScrollTextIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UsersIcon,
  WorkflowIcon,
  type LucideIcon,
} from "lucide-react";

/** Icon per navigation key; unknown keys fall back to a generic list icon. */
export const NAV_ICONS: Record<string, LucideIcon> = {
  overview: HomeIcon,
  inbox: BellIcon,
  upcoming: ClockIcon,
  people: UsersIcon,
  sections: GraduationCapIcon,
  calendar: CalendarDaysIcon,
  programs: LayersIcon,
  courses: BookOpenIcon,
  offerings: BriefcaseIcon,
  resources: DoorOpenIcon,
  documents: FilesIcon,
  tasks: ListChecksIcon,
  "my-work": ClipboardListIcon,
  settings: SettingsIcon,
  users: UsersIcon,
  departments: LayersIcon,
  permissions: ShieldCheckIcon,
  workflows: WorkflowIcon,
  audit: ScrollTextIcon,
  templates: FileTextIcon,
  forms: ClipboardListIcon,
  reminders: MailIcon,
  jobs: ListChecksIcon,
};

export function iconFor(key: string): LucideIcon {
  return NAV_ICONS[key] ?? ListChecksIcon;
}
