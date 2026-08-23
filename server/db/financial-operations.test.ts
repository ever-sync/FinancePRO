import { describe, expect, it } from "vitest";
import { recurrenceDatesInWindow } from "./financial-operations";

describe("financial operations V3 recurrence engine", () => {
  it("generates monthly dates and clamps day 31", () => {
    expect(
      recurrenceDatesInWindow(
        {
          frequency: "monthly",
          interval: 1,
          startDate: "2026-01-31",
          byMonthDay: 31,
          businessDayOrdinal: null,
          byWeekday: null,
        },
        "2026-01-01",
        "2026-04-30"
      )
    ).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("generates the fifth business day with a custom holiday", () => {
    expect(
      recurrenceDatesInWindow(
        {
          frequency: "business_day_rule",
          interval: 1,
          startDate: "2026-08-01",
          byMonthDay: null,
          businessDayOrdinal: 5,
          byWeekday: null,
        },
        "2026-08-01",
        "2026-08-31",
        ["2026-08-07"]
      )
    ).toEqual(["2026-08-10"]);
  });

  it("honors weekly interval, weekdays and end date", () => {
    expect(
      recurrenceDatesInWindow(
        {
          frequency: "weekly",
          interval: 2,
          startDate: "2026-08-03",
          endDate: "2026-08-24",
          byMonthDay: null,
          businessDayOrdinal: null,
          byWeekday: [1, 3],
        },
        "2026-08-01",
        "2026-09-01"
      )
    ).toEqual(["2026-08-03", "2026-08-05", "2026-08-17", "2026-08-19"]);
  });
});
