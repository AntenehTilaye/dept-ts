import { describe, expect, it } from "vitest";
import linear from "../../fixtures/workflows/linear.json";
import compound from "../../fixtures/workflows/compound_review.json";
import {
  GuardFailedError,
  RequiredInputError,
  TransitionNotAllowedError,
  UnknownTransitionError,
} from "@/platform/workflow/errors";
import {
  applicableTransitions,
  initialSnapshot,
  step,
  type Snapshot,
} from "@/platform/workflow/machine";
import { WorkflowDefinitionInput, type Definition } from "@/platform/workflow/schema";

function def(raw: unknown): Definition {
  const i = WorkflowDefinitionInput.parse(raw);
  return {
    key: i.key,
    version: 1,
    subjectType: i.subjectType,
    initialState: i.initialState,
    states: i.states,
    transitions: i.transitions,
  };
}
const now = new Date("2026-09-18T10:00:00Z");
const L = def(linear);
const C = def(compound);

describe("linear machine", () => {
  it("starts in the initial state and lists the applicable transitions", () => {
    const s = initialSnapshot(L, now);
    expect(s).toEqual({ currentState: "draft", branchStates: null });
    expect(applicableTransitions(L, s).map((a) => a.transition.key)).toEqual([
      "draft.start",
      "draft.cancel",
    ]);
  });

  it("applies transitions, returns effects in declared order and detects terminals", () => {
    const r1 = step(L, initialSnapshot(L, now), { transitionKey: "draft.start", now });
    expect(r1.next.currentState).toBe("in_progress");
    expect(r1.applied[0]!.effects.map((e) => e.kind)).toEqual(["emit"]);
    expect(r1.terminal).toBe(false);
    const r2 = step(L, r1.next, {
      transitionKey: "in_progress.submit",
      now,
      fields: { summary: "done" },
    });
    expect(r2.next.currentState).toBe("review");
    const r3 = step(L, r2.next, { transitionKey: "review.approve", now, comment: "ok" });
    expect(r3).toMatchObject({ terminal: true, terminalCategory: "success" });
    expect(r3.applied[0]!.effects[0]!.kind).toBe("notify");
  });

  it("refuses unknown actions and actions from the wrong state", () => {
    const s = initialSnapshot(L, now);
    expect(() => step(L, s, { transitionKey: "nope", now })).toThrow(UnknownTransitionError);
    expect(() => step(L, s, { transitionKey: "review.approve", now, comment: "x" })).toThrow(
      TransitionNotAllowedError,
    );
  });

  it("raises typed errors for missing comment and fields", () => {
    const inReview: Snapshot = { currentState: "review", branchStates: null };
    expect(() => step(L, inReview, { transitionKey: "review.approve", now })).toThrow(
      RequiredInputError,
    );
    try {
      step(L, inReview, { transitionKey: "review.approve", now });
    } catch (e) {
      expect((e as RequiredInputError).missing).toEqual({ comment: true });
    }
    const inProgress: Snapshot = { currentState: "in_progress", branchStates: null };
    try {
      step(L, inProgress, { transitionKey: "in_progress.submit", now, fields: { summary: "" } });
    } catch (e) {
      expect((e as RequiredInputError).missing).toEqual({ fields: ["summary"] });
    }
  });

  it("evaluates guards by name and reports the failing guard", () => {
    const inProgress: Snapshot = { currentState: "in_progress", branchStates: null };
    const evaluator = (g: string) =>
      g === "never" ? { ok: false as const, reason: "blocked" } : true;
    expect(() =>
      step(L, inProgress, { transitionKey: "in_progress.cancel", now }, evaluator),
    ).toThrow(GuardFailedError);
    const ok = step(L, inProgress, { transitionKey: "in_progress.cancel", now }, () => true);
    expect(ok.next.currentState).toBe("cancelled");
    expect(ok.terminalCategory).toBe("cancelled");
  });

  it("supports revision loops", () => {
    const inReview: Snapshot = { currentState: "review", branchStates: null };
    const back = step(L, inReview, { transitionKey: "review.revise", now, comment: "again" });
    expect(back.next.currentState).toBe("in_progress");
    const again = step(L, back.next, {
      transitionKey: "in_progress.submit",
      now,
      fields: { summary: "v2" },
    });
    expect(again.next.currentState).toBe("review");
  });
});

describe("compound states", () => {
  const entered = step(C, initialSnapshot(C, now), { transitionKey: "request.submit", now }).next;

  it("entering a compound state instantiates active branches", () => {
    expect(entered.currentState).toBe("review");
    expect(Object.keys(entered.branchStates!)).toEqual(["chair", "head"]);
    expect(entered.branchStates!.chair).toMatchObject({
      state: "review.chair.pending",
      status: "active",
    });
    const actions = applicableTransitions(C, entered).map(
      (a) => `${a.transition.key}@${a.branchKey}`,
    );
    expect(actions).toEqual([
      "review.chair.pending.approve@chair",
      "review.chair.pending.reject@chair",
      "review.head.pending.approve@head",
      "review.head.pending.reject@head",
    ]);
  });

  it("quorum(1) joins on the first done branch, marks siblings skipped and emits the declared $join effects", () => {
    const r = step(C, entered, {
      transitionKey: "review.chair.pending.approve",
      now,
      branchKey: "chair",
    });
    expect(r.applied.map((a) => a.transitionKey)).toEqual([
      "review.chair.pending.approve",
      "review.$join",
    ]);
    expect(r.applied[1]!.effects.map((e) => e.kind)).toEqual(["emit"]);
    expect(r.next).toEqual({ currentState: "approved", branchStates: null });
    expect(r.terminal).toBe(true);
  });

  it("a rejected branch with onReject moves to revision and the loop re-enters the review", () => {
    const r = step(C, entered, {
      transitionKey: "review.head.pending.reject",
      now,
      branchKey: "head",
      comment: "no",
    });
    expect(r.applied.map((a) => a.transitionKey)).toEqual([
      "review.head.pending.reject",
      "review.$reject",
    ]);
    expect(r.next.currentState).toBe("revision");
    const again = step(C, r.next, { transitionKey: "revision.resubmit", now });
    expect(again.next.currentState).toBe("review");
    expect(again.next.branchStates!.head!.status).toBe("active");
  });

  it("refuses branch actions on the wrong branch, a non-active branch or outside the compound state", () => {
    expect(() =>
      step(C, entered, { transitionKey: "review.chair.pending.approve", now, branchKey: "head" }),
    ).toThrow(TransitionNotAllowedError);
    const skipped: Snapshot = {
      currentState: "review",
      branchStates: {
        ...entered.branchStates!,
        head: { ...entered.branchStates!.head!, status: "skipped" },
      },
    };
    expect(() =>
      step(C, skipped, { transitionKey: "review.head.pending.approve", now, branchKey: "head" }),
    ).toThrow(/skipped/);
    expect(() =>
      step(C, initialSnapshot(C, now), {
        transitionKey: "review.head.pending.approve",
        now,
        branchKey: "head",
      }),
    ).toThrow(/not in a compound state/);
    expect(() =>
      step(C, entered, { transitionKey: "review.head.pending.approve", now, branchKey: "ghost" }),
    ).toThrow(/does not exist/);
  });

  it("all waits for every branch; any joins on the first; a rejection without onReject keeps waiting", () => {
    const all = structuredClone(C);
    all.states[1]!.compound!.completion = { rule: "all" };
    delete all.states[1]!.compound!.onReject;
    const s0 = step(all, initialSnapshot(all, now), { transitionKey: "request.submit", now }).next;
    const s1 = step(all, s0, {
      transitionKey: "review.chair.pending.approve",
      now,
      branchKey: "chair",
    });
    expect(s1.next.currentState).toBe("review");
    expect(s1.applied).toHaveLength(1);
    const s2 = step(all, s1.next, {
      transitionKey: "review.head.pending.approve",
      now,
      branchKey: "head",
    });
    expect(s2.next.currentState).toBe("approved");
    const rejected = step(all, s0, {
      transitionKey: "review.head.pending.reject",
      now,
      branchKey: "head",
      comment: "x",
    });
    expect(rejected.next.currentState).toBe("review");
    expect(rejected.next.branchStates!.head!.status).toBe("rejected");

    const any = structuredClone(C);
    any.states[1]!.compound!.completion = { rule: "any" };
    const a0 = step(any, initialSnapshot(any, now), { transitionKey: "request.submit", now }).next;
    expect(
      step(any, a0, { transitionKey: "review.head.pending.approve", now, branchKey: "head" }).next
        .currentState,
    ).toBe("approved");
  });

  it("dynamic compound states instantiate one $person branch per resolved person", () => {
    const dyn = structuredClone(C);
    const c = dyn.states[1]!.compound!;
    c.dynamic = true;
    c.completion = { rule: "all" };
    c.branches = [
      {
        key: "$person",
        label: "Reviewer",
        initialState: "review.p.pending",
        states: ["review.p.pending", "review.p.done", "review.p.rejected"],
        doneState: "review.p.done",
        rejectedState: "review.p.rejected",
      },
    ];
    dyn.transitions = [
      dyn.transitions[0]!,
      {
        ...dyn.transitions[1]!,
        key: "review.p.pending.approve",
        from: "review.p.pending",
        to: "review.p.done",
        branch: "$person",
      },
      {
        ...dyn.transitions[2]!,
        key: "review.p.pending.reject",
        from: "review.p.pending",
        to: "review.p.rejected",
        branch: "$person",
      },
      dyn.transitions[6]!,
    ];
    const s0 = step(dyn, initialSnapshot(dyn, now), {
      transitionKey: "request.submit",
      now,
      personIds: ["p1", "p2"],
    }).next;
    expect(Object.keys(s0.branchStates!)).toEqual(["p1", "p2"]);
    expect(s0.branchStates!.p1).toMatchObject({ actorPersonId: "p1", status: "active" });
    expect(() => step(dyn, s0, { transitionKey: "review.p.pending.approve", now })).toThrow(
      /needs a branchKey/,
    );
    const s1 = step(dyn, s0, {
      transitionKey: "review.p.pending.approve",
      now,
      branchKey: "p1",
    }).next;
    expect(s1.currentState).toBe("review");
    const s2 = step(dyn, s1, { transitionKey: "review.p.pending.approve", now, branchKey: "p2" });
    expect(s2.next.currentState).toBe("approved");
    const rej = step(dyn, s0, {
      transitionKey: "review.p.pending.reject",
      now,
      branchKey: "p2",
      comment: "no",
    });
    expect(rej.next.currentState).toBe("revision");
  });
});
