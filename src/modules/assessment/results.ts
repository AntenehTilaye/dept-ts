import { bandFor, gradeScale } from "./grade-scales";

// What one student ended up with. A component is marked out of its own maximum and carries its own
// weight, so the total is the weighted percentage — and a student who did not sit the final has no
// total at all, because a course cannot be passed on the pieces that were easy to attend.

export interface ComponentDef {
  key: string;
  name: string;
  maxMark: number;
  weightPercent: number;
  isFinal: boolean;
  excludedFromConsolidation?: boolean;
}

export interface MarkInput {
  componentKey: string;
  /** null when the student did not sit it. */
  mark: number | null;
}

export interface ComputedResult {
  total: number;
  letterGrade: string;
  outcome: "pass" | "fail" | "incomplete";
  gradeScaleKey: string;
  /** Components with no mark, so a page can say what is missing rather than only that it is. */
  missing: string[];
}

/** The weight a scheme declares, over the components that count towards the course. */
export function declaredWeight(components: ComponentDef[]): number {
  return round2(
    components.filter((c) => !c.excludedFromConsolidation).reduce((sum, c) => sum + c.weightPercent, 0),
  );
}

/** Whether the scheme can be marked against at all: its components have to add up to a hundred. */
export function weightsAddUp(components: ComponentDef[]): boolean {
  return Math.abs(declaredWeight(components) - 100) < 0.01;
}

/**
 * The weighted total out of a hundred, and what it is worth on the programme's scale.
 *
 * A missing mark is not a zero: it is counted as unearned, so a student missing a 30% component
 * cannot score above 70. Missing the final makes the result `incomplete` however high the rest is,
 * because the course has not been examined.
 */
export function computeResult(
  components: ComponentDef[],
  marks: MarkInput[],
  gradeScaleKey: string,
): ComputedResult {
  const scale = gradeScale(gradeScaleKey);
  const byKey = new Map(marks.map((m) => [m.componentKey, m.mark]));
  const counted = components.filter((c) => !c.excludedFromConsolidation);

  let earned = 0;
  const missing: string[] = [];
  for (const component of counted) {
    const mark = byKey.get(component.key) ?? null;
    if (mark === null) {
      missing.push(component.key);
      continue;
    }
    const fraction = component.maxMark > 0 ? Math.min(mark / component.maxMark, 1) : 0;
    earned += fraction * component.weightPercent;
  }

  // The weights are percentage points, so the earned sum IS the total out of a hundred. It is not
  // rescaled to the weight actually declared: that would hide both a missing mark and a scheme
  // whose components do not add up, and `weightsAddUp` is what refuses the second.
  const total = round2(earned);

  const finalMissing = counted.some((c) => c.isFinal && byKey.get(c.key) == null);
  const band = bandFor(scale, total);
  return {
    total,
    letterGrade: finalMissing ? "I" : band.letter,
    outcome: finalMissing ? "incomplete" : band.pass ? "pass" : "fail",
    gradeScaleKey: scale.key,
    missing,
  };
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
