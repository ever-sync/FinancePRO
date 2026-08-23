import { describe, expect, it } from "vitest";
import { nextReminderOccurrence } from "./financial-automation";

describe("financial reminder recurrence", () => {
  it("supports daily, weekly and monthly rules", () => {
    const reference = new Date("2026-01-31T12:30:00.000Z");

    expect(nextReminderOccurrence(reference, "daily")?.toISOString()).toBe(
      "2026-02-01T12:30:00.000Z"
    );
    expect(nextReminderOccurrence(reference, "weekly")?.toISOString()).toBe(
      "2026-02-07T12:30:00.000Z"
    );
    expect(nextReminderOccurrence(reference, "monthly")?.toISOString()).toBe(
      "2026-02-28T12:30:00.000Z"
    );
  });

  it("supports an RRULE interval and rejects unsupported rules", () => {
    const reference = new Date("2026-08-23T18:00:00.000Z");

    expect(
      nextReminderOccurrence(reference, "FREQ=WEEKLY;INTERVAL=2")?.toISOString()
    ).toBe("2026-09-06T18:00:00.000Z");
    expect(nextReminderOccurrence(reference, "FREQ=YEARLY")).toBeNull();
  });
});
