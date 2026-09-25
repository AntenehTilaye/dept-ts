"use server";

import { z } from "zod";
import { safeAction } from "@/lib/actions/safe-action";
import { actorOf } from "@/lib/auth/require";
import { suggest } from "@/platform/search";

// What the command palette asks while somebody types. It is the same ACL-filtered index the
// search page reads, so nothing is suggested that could not be opened.

export const suggestAction = safeAction(
  z.object({ prefix: z.string().max(200), types: z.array(z.string()).optional() }),
  async ({ input, ctx, db }) => {
    const hits = await suggest(db, actorOf(ctx), input.prefix, {
      ...(input.types ? { types: input.types } : {}),
      limit: 8,
    });
    return hits.map((hit) => ({
      subjectType: hit.subjectType,
      subjectId: hit.subjectId,
      title: hit.title,
      url: hit.url,
    }));
  },
);
