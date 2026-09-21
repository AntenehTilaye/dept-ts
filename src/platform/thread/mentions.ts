// Mention markup inside comment bodies: `@[Full Name](person:<id>)`. The composer inserts it,
// the panel renders it, the service extracts the ids to notify.

export const MENTION_RE = /@\[([^\]\n]{1,120})\]\(person:([a-z0-9]{10,40})\)/g;

export interface Mention {
  name: string;
  personId: string;
}

export function extractMentions(body: string): Mention[] {
  const out: Mention[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(MENTION_RE)) {
    const personId = m[2]!;
    if (seen.has(personId)) continue;
    seen.add(personId);
    out.push({ name: m[1]!, personId });
  }
  return out;
}

/** Plain-text rendering (notifications, previews): `@Full Name`. */
export function stripMentions(body: string): string {
  return body.replace(MENTION_RE, "@$1");
}

/** Splits a body into text and mention segments for rendering. */
export function segmentMentions(
  body: string,
): Array<{ type: "text"; text: string } | { type: "mention"; name: string; personId: string }> {
  const segments: ReturnType<typeof segmentMentions> = [];
  let last = 0;
  for (const m of body.matchAll(MENTION_RE)) {
    const start = m.index ?? 0;
    if (start > last) segments.push({ type: "text", text: body.slice(last, start) });
    segments.push({ type: "mention", name: m[1]!, personId: m[2]! });
    last = start + m[0].length;
  }
  if (last < body.length) segments.push({ type: "text", text: body.slice(last) });
  return segments;
}
