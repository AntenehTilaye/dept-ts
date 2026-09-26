// The scales a programme's marks are read against. A scale is data, not code: a department that
// marks out of a hundred and a programme that reports on four points are the same arithmetic with
// different bands, and the band a total fell into is recorded on the result so that changing a
// scale later is visible rather than silent.

export interface GradeBand {
  /** Inclusive lower bound of the total, as a percentage. */
  min: number;
  letter: string;
  /** What the letter is worth, where a programme reports points. */
  points?: number;
  /** A band below this is a fail. */
  pass: boolean;
}

export interface GradeScale {
  key: string;
  label: string;
  /** Highest band first; `bandFor` takes the first band the total reaches. */
  bands: GradeBand[];
}

const DEFAULT: GradeScale = {
  key: "default",
  label: "Percentage bands (A–F)",
  bands: [
    { min: 90, letter: "A+", points: 4, pass: true },
    { min: 85, letter: "A", points: 4, pass: true },
    { min: 80, letter: "A-", points: 3.75, pass: true },
    { min: 75, letter: "B+", points: 3.5, pass: true },
    { min: 70, letter: "B", points: 3, pass: true },
    { min: 65, letter: "B-", points: 2.75, pass: true },
    { min: 60, letter: "C+", points: 2.5, pass: true },
    { min: 50, letter: "C", points: 2, pass: true },
    { min: 45, letter: "C-", points: 1.75, pass: false },
    { min: 40, letter: "D", points: 1, pass: false },
    { min: 0, letter: "F", points: 0, pass: false },
  ],
};

/** A postgraduate programme where anything under half is a fail and the bands are wider. */
const POSTGRADUATE: GradeScale = {
  key: "postgraduate",
  label: "Postgraduate bands (A–F, pass at 60)",
  bands: [
    { min: 85, letter: "A", points: 4, pass: true },
    { min: 75, letter: "B+", points: 3.5, pass: true },
    { min: 70, letter: "B", points: 3, pass: true },
    { min: 60, letter: "C", points: 2, pass: true },
    { min: 0, letter: "F", points: 0, pass: false },
  ],
};

const SCALES: Record<string, GradeScale> = {
  default: DEFAULT,
  postgraduate: POSTGRADUATE,
};

/** The named scale, or the default one — a programme naming a scale nobody defined is not a reason
 * to refuse to report on its marks. */
export function gradeScale(key: string | null | undefined): GradeScale {
  return SCALES[key ?? "default"] ?? DEFAULT;
}

export function listGradeScales(): GradeScale[] {
  return Object.values(SCALES);
}

/** The band a total falls into. A total above every band still lands in the highest one. */
export function bandFor(scale: GradeScale, total: number): GradeBand {
  return scale.bands.find((band) => total >= band.min) ?? scale.bands[scale.bands.length - 1]!;
}

/** Every letter the scale can produce, highest first — the columns of a distribution. */
export function lettersOf(scale: GradeScale): string[] {
  return scale.bands.map((band) => band.letter);
}
