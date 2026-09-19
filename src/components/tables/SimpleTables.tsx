"use client";

import { Badge } from "@/components/ui/badge";
import { columnHelper, DataTable } from "@/components/patterns/DataTable";

// Small list tables of the registry pages; each takes plain rows from its server page.

export interface CourseRow {
  id: string;
  code: string;
  title: string;
  credits: string;
  courseType: string;
  program: string;
  predecessor: string;
  status: string;
  editHref: string;
}
const c = columnHelper<CourseRow>();
const courseColumns = [
  c.accessor("code", {
    header: "Code",
    cell: (x) => (
      <span className="font-mono">
        {x.getValue()}{" "}
        {x.row.original.status === "retired" ? <Badge variant="secondary">retired</Badge> : null}
      </span>
    ),
  }),
  c.accessor("title", { header: "Title" }),
  c.accessor("credits", { header: "Credits" }),
  c.accessor("courseType", { header: "Type" }),
  c.accessor("program", { header: "Program" }),
  c.accessor("predecessor", {
    header: "Predecessor",
    cell: (x) => <span className="font-mono">{x.getValue()}</span>,
  }),
  c.display({
    id: "actions",
    header: "",
    enableHiding: false,
    cell: (x) => (
      <a className="text-xs underline" href={x.row.original.editHref}>
        edit
      </a>
    ),
  }),
];
export function CoursesTable({ rows }: { rows: CourseRow[] }) {
  return (
    <DataTable
      columns={courseColumns}
      data={rows}
      searchPlaceholder="Filter courses"
      rowTestId={(r) => `course-${r.code}`}
      emptyTitle="No courses yet"
      emptyHint="Add the catalogue on the right; a revised course names its predecessor so history follows it."
    />
  );
}

export interface OfferingRow {
  id: string;
  code: string;
  title: string;
  coordinator: string;
  sections: number;
  href: string;
}
const o = columnHelper<OfferingRow>();
const offeringColumns = [
  o.accessor("code", {
    header: "Course",
    cell: (x) => (
      <a className="underline-offset-2 hover:underline" href={x.row.original.href}>
        <span className="font-mono">{x.getValue()}</span> {x.row.original.title}
      </a>
    ),
  }),
  o.accessor("coordinator", { header: "Coordinator" }),
  o.accessor("sections", { header: "Sections" }),
];
export function OfferingsTable({ rows }: { rows: OfferingRow[] }) {
  return (
    <DataTable
      columns={offeringColumns}
      data={rows}
      searchPlaceholder="Filter offerings"
      rowTestId={(r) => `offering-${r.code}`}
      emptyTitle="Nothing offered in this term"
      emptyHint="Offer a course for the term with the form on the right, then add its sections and instructors."
    />
  );
}

export interface ResourceRow {
  id: string;
  code: string;
  name: string;
  kind: string;
  capacity: string;
  responsible: string;
  status: string;
  detail: string;
  editHref: string;
}
const r = columnHelper<ResourceRow>();
const resourceColumns = [
  r.accessor("code", {
    header: "Code",
    cell: (x) => <span className="font-mono">{x.getValue()}</span>,
  }),
  r.accessor("name", {
    header: "Name",
    cell: (x) => (
      <span>
        {x.getValue()}{" "}
        {x.row.original.detail ? (
          <span className="text-xs text-muted-foreground">· {x.row.original.detail}</span>
        ) : null}
      </span>
    ),
  }),
  r.accessor("kind", { header: "Kind" }),
  r.accessor("capacity", { header: "Capacity" }),
  r.accessor("responsible", { header: "Responsible" }),
  r.accessor("status", {
    header: "Status",
    cell: (x) => (
      <Badge variant={x.getValue() === "available" ? "default" : "secondary"}>{x.getValue()}</Badge>
    ),
  }),
  r.display({
    id: "actions",
    header: "",
    enableHiding: false,
    cell: (x) => (
      <a className="text-xs underline" href={x.row.original.editHref}>
        edit
      </a>
    ),
  }),
];
export function ResourcesTable({ rows }: { rows: ResourceRow[] }) {
  return (
    <DataTable
      columns={resourceColumns}
      data={rows}
      searchPlaceholder="Filter rooms and labs"
      rowTestId={(r) => `resource-${r.code}`}
      emptyTitle="No rooms or labs yet"
      emptyHint="Register classrooms, computer labs and halls so timetables and exams can be placed."
    />
  );
}

export interface ProgramRow {
  id: string;
  code: string;
  name: string;
  degree: string;
  years: number;
  students: number;
  editHref: string;
}
const p = columnHelper<ProgramRow>();
const programColumns = [
  p.accessor("code", {
    header: "Code",
    cell: (x) => <span className="font-mono">{x.getValue()}</span>,
  }),
  p.accessor("name", { header: "Name" }),
  p.accessor("degree", { header: "Degree" }),
  p.accessor("years", { header: "Years" }),
  p.accessor("students", { header: "Students" }),
  p.display({
    id: "actions",
    header: "",
    enableHiding: false,
    cell: (x) => (
      <a className="text-xs underline" href={x.row.original.editHref}>
        edit
      </a>
    ),
  }),
];
export function ProgramsTable({ rows }: { rows: ProgramRow[] }) {
  return (
    <DataTable
      columns={programColumns}
      data={rows}
      rowTestId={(r) => `program-${r.code}`}
      emptyTitle="No programs yet"
      emptyHint="Programs group students into cohorts and sections; add the first one on the right."
    />
  );
}
