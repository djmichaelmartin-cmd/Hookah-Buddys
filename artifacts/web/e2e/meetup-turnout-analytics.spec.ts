import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const webRoot = path.resolve(import.meta.dirname, "..");

const trackedFiles = {
  initialPublish: "src/pages/meetups/MeetupCreate.tsx",
  futurePublish: "src/pages/meetups/MeetupCreateEvent.tsx",
  groupRsvp: "src/pages/groups/components/GroupEvents.tsx",
  eventRsvp: "src/pages/EventDetail.tsx",
} as const;

type CompletionEvent =
  | "meetup_published"
  | "meetup_event_published"
  | "meetup_rsvp_completed";

type TrackedCall = {
  event: CompletionEvent;
  payloadKeys: string[];
  payloadText: string;
  enclosingFunctionText: string;
};

function read(relativePath: string) {
  return fs.readFileSync(path.join(webRoot, relativePath), "utf8");
}

function completionCalls(relativePath: string): TrackedCall[] {
  const sourceText = read(relativePath);
  const source = ts.createSourceFile(
    relativePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const calls: TrackedCall[] = [];

  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "trackEvent" &&
      node.arguments.length === 2 &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text.startsWith("meetup_")
    ) {
      const payload = node.arguments[1];
      expect(ts.isObjectLiteralExpression(payload)).toBe(true);
      if (!ts.isObjectLiteralExpression(payload)) return;

      const enclosingFunction = findAncestor(node, ts.isFunctionLike);
      calls.push({
        event: node.arguments[0].text as CompletionEvent,
        payloadKeys: payload.properties.map((property) => {
          expect(ts.isPropertyAssignment(property)).toBe(true);
          if (!ts.isPropertyAssignment(property)) return "";
          return property.name.getText(source);
        }),
        payloadText: payload.getText(source),
        enclosingFunctionText: enclosingFunction?.getText(source) ?? "",
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return calls;
}

function findAncestor<T extends ts.Node>(
  node: ts.Node,
  predicate: (candidate: ts.Node) => candidate is T,
): T | undefined {
  let candidate = node.parent;
  while (candidate) {
    if (predicate(candidate)) return candidate;
    candidate = candidate.parent;
  }
  return undefined;
}

function expectPrivatePayload(call: TrackedCall) {
  expect(call.payloadKeys).toEqual(["host_type"]);
  expect(call.payloadText).toMatch(
    /^\{\s*host_type:\s*meetupHostType\([\s\S]*\),?\s*\}$/,
  );
  expect(call.payloadText).not.toMatch(
    /\b(name|title|handle|username|userId|meetupId|groupId|eventId|businessId|description|content|notes)\s*:/i,
  );
}

test("successful initial Meetup publishing emits one privacy-safe member or Business completion", () => {
  const calls = completionCalls(trackedFiles.initialPublish);
  const source = read(trackedFiles.initialPublish);

  expect(calls).toHaveLength(1);
  expect(calls[0].event).toBe("meetup_published");
  expectPrivatePayload(calls[0]);
  expect(calls[0].payloadText).toContain("meetupHostType(businessId)");
  expect(source).toMatch(
    /await createMeetup\.mutateAsync\([\s\S]*?trackEvent\("meetup_published"/,
  );
  expect(source).toMatch(
    /trackEvent\("meetup_published"[\s\S]*?catch\s*\([^)]*\)\s*\{[\s\S]*?Failed to create meetup/,
  );
});

test("successful future-event publishing emits one privacy-safe member or Business completion", () => {
  const calls = completionCalls(trackedFiles.futurePublish);

  expect(calls).toHaveLength(1);
  expect(calls[0].event).toBe("meetup_event_published");
  expectPrivatePayload(calls[0]);
  expect(calls[0].payloadText).toContain("meetupHostType(businessId)");
  const source = read(trackedFiles.futurePublish);
  expect(source).toMatch(
    /onSuccess:\s*\(\)\s*=>\s*\{[\s\S]*?trackEvent\("meetup_event_published"/,
  );
  expect(source).toMatch(
    /trackEvent\("meetup_event_published"[\s\S]*?onError:\s*\([^)]*\)\s*=>/,
  );
});

test("only confirmed going outcomes emit RSVP completion, never interested, cancelled, or waitlisted outcomes", () => {
  const groupCalls = completionCalls(trackedFiles.groupRsvp);
  const eventCalls = completionCalls(trackedFiles.eventRsvp);

  expect(groupCalls).toHaveLength(1);
  expect(eventCalls).toHaveLength(1);
  for (const call of [...groupCalls, ...eventCalls]) {
    expect(call.event).toBe("meetup_rsvp_completed");
    expectPrivatePayload(call);
  }

  const groupSource = read(trackedFiles.groupRsvp);
  const eventSource = read(trackedFiles.eventRsvp);
  expect(groupSource).toMatch(
    /if \(isMeetup && result\.rsvpStatus === "going"\)\s*\{\s*trackEvent\("meetup_rsvp_completed"/,
  );
  expect(groupSource).not.toMatch(
    /rsvpStatus\s*===\s*["'](interested|not_going|waitlisted)["'][\s\S]*trackEvent/,
  );
  expect(eventSource).toMatch(
    /if \(isMeetup && result\.rsvped && !result\.waitlisted\)\s*\{\s*trackEvent\("meetup_rsvp_completed"/,
  );
});

test("draft saves and failed mutations contain no Meetup completion event", () => {
  const initialSource = read(trackedFiles.initialPublish);
  const saveDraft = initialSource.match(
    /const handleSaveDraft[\s\S]*?(?=\n\s*const handle|\n\s*return\s*\()/,
  )?.[0] ?? "";
  const completionIndex = initialSource.indexOf('trackEvent("meetup_published"');
  const failureIndex = initialSource.indexOf("Failed to create meetup", completionIndex);

  expect(saveDraft).not.toContain("trackEvent");
  expect(completionIndex).toBeGreaterThan(-1);
  expect(failureIndex).toBeGreaterThan(completionIndex);
  expect(initialSource.slice(failureIndex, initialSource.indexOf("finally", failureIndex))).not.toContain(
    "trackEvent",
  );
});

test("the host classifier exposes only the two approved analytics values", () => {
  const analyticsSource = read("src/lib/analytics.ts");

  expect(analyticsSource).toContain(
    'export type MeetupHostType = "member" | "business"',
  );
  expect(analyticsSource).toMatch(
    /return businessId \? "business" : "member"/,
  );
});