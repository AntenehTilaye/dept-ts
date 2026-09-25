import type { ZodType } from "zod";
import { globalSingleton } from "../../lib/singleton";
import type { Db } from "../../lib/db/types";
import type { Actor } from "../identity/can";

// What a report is, in code: who may run it, what it asks for, where its rows come from and
// which template lays them out. Everything else — the formats, the storage, the queue — is the
// framework's, so adding a report is a registration rather than a new way of making a file.

export type ReportFormat = "pdf" | "xlsx" | "csv" | "html";

/** A table the report shows: what a spreadsheet needs and what a page needs, in one shape. */
export interface ReportTable {
  key: string;
  title: string;
  columns: { key: string; label: string; type?: "text" | "number" | "date" }[];
  rows: Record<string, unknown>[];
}

export interface ReportData {
  title: string;
  subtitle?: string;
  /** Headline numbers shown above the tables. */
  stats?: { label: string; value: string | number }[];
  tables: ReportTable[];
  generatedAt: Date;
  departmentName?: string;
}

export interface ReportContext {
  db: Db;
  actor: Actor;
  departmentId: string;
  params: Record<string, unknown>;
}

export interface ReportDef {
  key: string;
  title: string;
  description?: string;
  requiredPermission: string;
  formats: ReportFormat[];
  /** Parameters the form asks for; also what `generate` validates. */
  parameters?: ZodType;
  /** A plain description of the parameters, for the generated form. */
  parameterFields?: {
    name: string;
    label: string;
    type: "text" | "date" | "select" | "number";
    options?: { value: string; label: string }[];
    required?: boolean;
  }[];
  dataSource: (ctx: ReportContext) => Promise<ReportData>;
  /** Which layout renders it; `default` is the standard title-stats-tables page. */
  templateKey?: string;
  featureKey?: string;
}

const reports = globalSingleton("report-definitions", () => new Map<string, ReportDef>());

export function registerReport(definition: ReportDef): void {
  reports.set(definition.key, definition);
}

export function getReport(key: string): ReportDef | undefined {
  return reports.get(key);
}

export function listReports(): ReportDef[] {
  return Array.from(reports.values()).sort((a, b) => a.title.localeCompare(b.title));
}

export class UnknownReportError extends Error {
  constructor(key: string) {
    super(`No report "${key}" is registered`);
    this.name = "UnknownReportError";
  }
}

export function requireReport(key: string): ReportDef {
  const definition = reports.get(key);
  if (!definition) throw new UnknownReportError(key);
  return definition;
}
