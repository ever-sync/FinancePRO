import { describe, expect, it } from "vitest";
import {
  RAPHAEL_GOAL_ITEMS,
  RAPHAEL_PROFILE,
  RAPHAEL_RECURRING_CASHFLOWS,
} from "./raphael-template";

describe("Raphael financial template", () => {
  it("preserves the exact monthly living-cost baseline", () => {
    const fixedCents = RAPHAEL_RECURRING_CASHFLOWS.filter(
      item => item.type === "expense"
    ).reduce((sum, item) => sum + item.amountCents, 0);
    expect(fixedCents).toBe(818_000);
    expect(fixedCents + RAPHAEL_PROFILE.monthlyVariableBudgetCents).toBe(
      1_118_000
    );
  });

  it("preserves the family purchase plan and 10% safe margin", () => {
    const baseCents = RAPHAEL_GOAL_ITEMS.reduce(
      (sum, item) => sum + item.estimatedCostCents,
      0
    );
    expect(RAPHAEL_GOAL_ITEMS).toHaveLength(40);
    expect(baseCents).toBe(2_372_500);
    expect(baseCents + Math.round(baseCents * 0.1)).toBe(2_609_750);
  });

  it("preserves mandatory A/B/C priority totals", () => {
    const total = (priority: string) =>
      RAPHAEL_GOAL_ITEMS.filter(item => item.priority === priority).reduce(
        (sum, item) => sum + item.estimatedCostCents,
        0
      );
    expect(total("essential")).toBe(893_500);
    expect(total("important")).toBe(548_000);
    expect(total("optional")).toBe(931_000);
  });
});
