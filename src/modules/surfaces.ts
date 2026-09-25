import type { ReactNode } from "react";
import type { DeptCtx } from "@/lib/auth/require";
import type { Db } from "@/lib/db/types";
import { globalSingleton } from "@/lib/singleton";
import type { SlotCard } from "@/components/documents/AttachmentSlots";
import type { AcknowledgementRow } from "@/components/feature/RecordDetail";

// A surface is what a module adds to the generic pages of its feature. The runtime renders every
// process the same way; a module that has something more to show — the deliverable slots of a
// task, the assessment grid of a portfolio — registers it here instead of forking a page.

export interface SurfaceContext {
  ctx: DeptCtx;
  db: Db;
  record: {
    id: string;
    departmentId: string;
    title: string;
    taskId: string | null;
    data: unknown;
  };
}

export interface RecordExtras {
  /** Deliverable slots to render above the tabs, with the subject uploads attach to. */
  slots?: SlotCard[];
  slotSubject?: { subjectType: string; subjectId: string };
  canUploadSlots?: boolean;
  /** What to call the slots tab; “Deliverables” unless the module says otherwise. */
  slotsLabel?: string;
  acknowledgements?: AcknowledgementRow[];
  /** Extra panels, each its own tab. */
  panels?: { key: string; label: string; content: ReactNode }[];
}

export interface FeatureSurface {
  featureKey: string;
  recordExtras?: (input: SurfaceContext) => Promise<RecordExtras>;
}

const surfaces = globalSingleton("feature-surfaces", () => new Map<string, FeatureSurface>());

export function registerSurface(surface: FeatureSurface): void {
  surfaces.set(surface.featureKey, surface);
}

export function surfaceFor(featureKey: string): FeatureSurface | undefined {
  return surfaces.get(featureKey);
}

/** Feature key -> the step renderer keys a definition may name (validation reads this). */
export function surfaceKeys(): Record<string, string[]> {
  return Object.fromEntries(Array.from(surfaces.keys()).map((key) => [key, []]));
}
