import { beforeEach, describe, expect, it, vi } from "vitest";

const { listFinancialAdvisorSnapshots } = vi.hoisted(() => ({
  listFinancialAdvisorSnapshots: vi.fn(),
}));

const { listAssistantRuns, listFinancialPlanActions } = vi.hoisted(() => ({
  listAssistantRuns: vi.fn(),
  listFinancialPlanActions: vi.fn(),
}));

vi.mock("./db/financial-advisor", () => ({
  listFinancialAdvisorSnapshots,
}));

vi.mock("./db/whatsapp", () => ({
  listAssistantRuns,
  listFinancialPlanActions,
}));

import { getFinancialAdvisorMemory } from "./financial-advisor";

describe("financial advisor behavioral memory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects low execution discipline when confirmations are often snoozed", async () => {
    listFinancialAdvisorSnapshots.mockResolvedValue([
      {
        snapshotPayload: JSON.stringify({
          month: 3,
          year: 2026,
          safeToSpendMonth: 4200,
          companyReserveRecommendation: 600,
          personalReserveRecommendation: 300,
          cashRiskLevel: "attention",
          counts: {
            overdueItems: 2,
            overdueCharges: 1,
            pendingCharges: 2,
          },
        }),
      },
      {
        snapshotPayload: JSON.stringify({
          month: 2,
          year: 2026,
          safeToSpendMonth: 3900,
          companyReserveRecommendation: 700,
          personalReserveRecommendation: 400,
          cashRiskLevel: "attention",
          counts: {
            overdueItems: 1,
            overdueCharges: 1,
            pendingCharges: 1,
          },
        }),
      },
    ]);
    listAssistantRuns.mockResolvedValue([
      { requiresConfirmation: true, status: "executado", executedActions: JSON.stringify([{ type: "confirmed_in_app" }]) },
      { requiresConfirmation: true, status: "executado", executedActions: JSON.stringify([{ type: "snoozed_in_app" }]) },
      { requiresConfirmation: true, status: "executado", executedActions: JSON.stringify([{ type: "snoozed" }]) },
      { requiresConfirmation: true, status: "executado", executedActions: JSON.stringify([{ type: "snoozed_in_app" }]) },
      { requiresConfirmation: true, status: "executado", executedActions: JSON.stringify([{ type: "snoozed" }]) },
    ]);
    listFinancialPlanActions.mockResolvedValue([
      { status: "adiada" },
      { status: "adiada" },
      { status: "adiada" },
      { status: "pendente" },
    ]);

    const memory = await getFinancialAdvisorMemory(7);

    expect(memory.historyMonths).toBe(2);
    expect(memory.executionScore).toBeLessThan(48);
    expect(memory.profileLabel).toContain("pouca execucao");
    expect(memory.signals.find(signal => signal.id === "execution")).toMatchObject({
      status: "critical",
    });
  });
});
