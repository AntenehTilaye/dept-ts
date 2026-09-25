import type { Db } from "../../lib/db/types";
import { can } from "../identity/can";
import { dbPolicyStore } from "../identity/policy-store";
import type { Actor } from "../identity/can";
import { url as subjectUrl } from "../subject-registry";
import { tokensForActor } from "./acl";

// Asking the index a question. Two gates, on purpose: the ACL tokens narrow the rows in the
// database (cheap, and an index can use it), and `can()` has the last word on everything that
// comes back (exact, and the only thing that may be trusted). A person never sees a hit they
// could not open.

export interface SearchHit {
  subjectType: string;
  subjectId: string;
  title: string;
  snippet: string;
  rank: number;
  url: string | null;
}

export interface SearchOptions {
  types?: string[];
  limit?: number;
  /** Skip the per-hit permission check (only for a caller that has already made it). */
  trusted?: boolean;
}

/**
 * `websearch_to_tsquery` understands what people type — quoted phrases, `or`, a leading `-` —
 * and, unlike `to_tsquery`, never throws on punctuation. It is still given a cleaned string so
 * a stray backslash cannot reach the parser.
 */
export function sanitise(query: string): string {
  return query.replace(/[\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
}

export async function search(
  db: Db,
  actor: Actor,
  rawQuery: string,
  opts: SearchOptions = {},
): Promise<SearchHit[]> {
  const query = sanitise(rawQuery);
  if (!query) return [];
  const tokens = await tokensForActor(db, actor);
  const limit = Math.min(opts.limit ?? 20, 100);
  const types = opts.types?.length ? opts.types : null;

  const rows = await db.$queryRaw<
    { subject_type: string; subject_id: string; title: string; snippet: string; rank: number }[]
  >`
    SELECT subject_type, subject_id, title,
           ts_headline('simple', body_text, websearch_to_tsquery('simple', ${query}),
                       'MaxWords=18, MinWords=6, ShortWord=2, MaxFragments=1, FragmentDelimiter=" … "') AS snippet,
           ts_rank(search, websearch_to_tsquery('simple', ${query})) AS rank
      FROM search_index_entry
     WHERE search @@ websearch_to_tsquery('simple', ${query})
       AND acl_tokens && ${tokens}::text[]
     ORDER BY rank DESC, title ASC
     LIMIT ${limit * 3}
  `;

  const hits: SearchHit[] = [];
  const deptSlug = await slugOf(db, actor.departmentId);
  for (const row of rows) {
    if (types && !types.includes(row.subject_type)) continue;
    const ref = { subjectType: row.subject_type, subjectId: row.subject_id };
    if (!opts.trusted) {
      const decision = await can(dbPolicyStore, actor, `${row.subject_type}.view`, ref, {
        verb: "read",
      });
      if (!decision.allowed) continue;
    }
    hits.push({
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      title: row.title,
      snippet: stripMarks(row.snippet),
      rank: Number(row.rank),
      url: deptSlug ? subjectUrl(ref, deptSlug) : null,
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

/** What the command palette offers while somebody is still typing. */
export async function suggest(
  db: Db,
  actor: Actor,
  prefix: string,
  opts: { types?: string[]; limit?: number } = {},
): Promise<SearchHit[]> {
  const query = sanitise(prefix);
  if (query.length < 2) return [];
  const tokens = await tokensForActor(db, actor);
  const limit = Math.min(opts.limit ?? 8, 25);

  const rows = await db.$queryRaw<
    { subject_type: string; subject_id: string; title: string; similarity: number }[]
  >`
    SELECT subject_type, subject_id, title, similarity(title, ${query}) AS similarity
      FROM search_index_entry
     WHERE (title ILIKE ${`%${query}%`} OR similarity(title, ${query}) > 0.2)
       AND acl_tokens && ${tokens}::text[]
     ORDER BY similarity DESC, title ASC
     LIMIT ${limit * 2}
  `;

  const deptSlug = await slugOf(db, actor.departmentId);
  const out: SearchHit[] = [];
  for (const row of rows) {
    if (opts.types?.length && !opts.types.includes(row.subject_type)) continue;
    out.push({
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      title: row.title,
      snippet: "",
      rank: Number(row.similarity),
      url: deptSlug
        ? subjectUrl({ subjectType: row.subject_type, subjectId: row.subject_id }, deptSlug)
        : null,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** How many hits there are of each kind, for the facet strip. */
export async function countsByType(
  db: Db,
  actor: Actor,
  rawQuery: string,
): Promise<Record<string, number>> {
  const hits = await search(db, actor, rawQuery, { limit: 100 });
  const counts: Record<string, number> = {};
  for (const hit of hits) counts[hit.subjectType] = (counts[hit.subjectType] ?? 0) + 1;
  return counts;
}

async function slugOf(db: Db, departmentId: string): Promise<string | null> {
  const department = await db.department.findUnique({
    where: { id: departmentId },
    select: { code: true },
  });
  return department?.code.toLowerCase() ?? null;
}

/** ts_headline marks matches with <b>; the page renders text, so the marks come out. */
function stripMarks(snippet: string): string {
  return snippet.replaceAll("<b>", "").replaceAll("</b>", "");
}
