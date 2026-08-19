import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWhatsAppIntegrationById: vi.fn(),
  getAssistantThreadById: vi.fn(),
  listWhatsAppMessages: vi.fn(),
  expirePendingAgentCommands: vi.fn(),
  listPendingAgentCommands: vi.fn(),
  listAgentRecords: vi.fn(),
  createAgentCommandIdempotently: vi.fn(),
  getAgentCommand: vi.fn(),
  cancelAgentCommand: vi.fn(),
  executeConfirmedAgentCommand: vi.fn(),
  markAgentCommandFailed: vi.fn(),
  getFinancialAdvisorSnapshot: vi.fn(),
}));

vi.mock("./db/agent", () => ({
  AGENT_ENTITY_TYPES: [
    "revenue",
    "company_fixed_cost",
    "company_variable_cost",
    "employee",
    "supplier",
    "supplier_purchase",
    "personal_fixed_cost",
    "personal_variable_cost",
    "debt",
    "investment",
    "reserve_fund",
    "client",
    "service",
  ],
  ...mocks,
}));

vi.mock("./db/whatsapp", () => ({
  getWhatsAppIntegrationById: mocks.getWhatsAppIntegrationById,
  getAssistantThreadById: mocks.getAssistantThreadById,
  listWhatsAppMessages: mocks.listWhatsAppMessages,
}));

vi.mock("./financial-advisor", () => ({
  getFinancialAdvisorSnapshot: mocks.getFinancialAdvisorSnapshot,
}));

import { ENV } from "./_core/env";
import {
  AgentToolError,
  agentToolRequestSchema,
  handleAgentTool,
} from "./n8n-agent";

describe("n8n financial agent tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ENV.n8nAgentSecret = "test-agent-secret-with-more-than-32-characters";
    mocks.getWhatsAppIntegrationById.mockResolvedValue({
      id: 11,
      userId: 7,
      enabled: true,
      timezone: "America/Sao_Paulo",
    });
    mocks.getAssistantThreadById.mockResolvedValue({ id: 22 });
    mocks.expirePendingAgentCommands.mockResolvedValue(undefined);
  });

  it("rejects fields outside the strict tool contract", () => {
    expect(() =>
      agentToolRequestSchema.parse({ action: "health", userId: 999 })
    ).toThrow();
  });

  it("stages a mutation without executing it and returns a six-digit confirmation", async () => {
    mocks.createAgentCommandIdempotently.mockImplementation(async data => ({
      id: 101,
      ...data,
    }));

    const result = await handleAgentTool({
      action: "propose_change",
      integrationId: 11,
      threadId: 22,
      entityType: "revenue",
      operation: "create",
      requestId: "execution-1:create-revenue",
      summary: "Criar receita Projeto Alfa de R$ 1.000,00",
      payload: {
        description: "Projeto Alfa",
        category: "Servicos",
        grossAmount: 1000,
        taxAmount: 60,
        netAmount: 940,
        dueDate: "2026-08-31",
      },
    });

    expect(result).toMatchObject({
      ok: true,
      commandId: 101,
      status: "pending",
      confirmationCode: expect.stringMatching(/^\d{6}$/),
    });
    expect(mocks.executeConfirmedAgentCommand).not.toHaveBeenCalled();
    expect(mocks.createAgentCommandIdempotently).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        integrationId: 11,
        threadId: 22,
        payload: JSON.stringify({
          description: "Projeto Alfa",
          category: "Servicos",
          grossAmount: "1000.00",
          taxAmount: "60.00",
          netAmount: "940.00",
          dueDate: "2026-08-31",
        }),
      })
    );
  });

  it("executes exactly the staged command after the matching confirmation", async () => {
    let storedCommand: Record<string, unknown> | undefined;
    mocks.createAgentCommandIdempotently.mockImplementation(async data => {
      storedCommand = { id: 102, ...data };
      return storedCommand;
    });
    const proposed = await handleAgentTool({
      action: "propose_change",
      integrationId: 11,
      threadId: 22,
      entityType: "reserve_fund",
      operation: "create",
      requestId: "execution-2:reserve",
      summary: "Registrar aporte manual de R$ 500,00 na reserva pessoal",
      payload: {
        type: "pessoal",
        depositAmount: "500.00",
        date: "2026-08-19",
      },
    });
    mocks.getAgentCommand.mockResolvedValue(storedCommand);
    mocks.executeConfirmedAgentCommand.mockResolvedValue({
      commandId: 102,
      operation: "create",
      entityType: "reserve_fund",
      entityId: 55,
      manualOnly: true,
      executedAt: "2026-08-19T12:00:00.000Z",
    });

    const executed = await handleAgentTool({
      action: "execute_change",
      integrationId: 11,
      threadId: 22,
      commandId: 102,
      confirmationCode: String(
        (proposed as { confirmationCode: string }).confirmationCode
      ),
    });

    expect(mocks.executeConfirmedAgentCommand).toHaveBeenCalledOnce();
    expect(executed).toMatchObject({
      ok: true,
      status: "executed",
      message: expect.stringContaining("Nenhuma movimentacao bancaria"),
    });
  });

  it("rejects a wrong confirmation code before touching financial records", async () => {
    mocks.getAgentCommand.mockResolvedValue({
      id: 103,
      userId: 7,
      integrationId: 11,
      threadId: 22,
      requestId: "execution-3:update",
      status: "pending",
      confirmationCodeHash: "a".repeat(64),
    });

    await expect(
      handleAgentTool({
        action: "execute_change",
        integrationId: 11,
        threadId: 22,
        commandId: 103,
        confirmationCode: "123456",
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentToolError>>({
        code: "INVALID_CONFIRMATION",
      })
    );
    expect(mocks.executeConfirmedAgentCommand).not.toHaveBeenCalled();
  });

  it("never accepts a userId from the model and resolves scope from integrationId", async () => {
    mocks.listAgentRecords.mockResolvedValue([
      { id: 9, userId: 7, description: "Conta" },
    ]);
    const result = await handleAgentTool({
      action: "list_records",
      integrationId: 11,
      threadId: 22,
      entityType: "personal_fixed_cost",
      limit: 5,
    });

    expect(mocks.listAgentRecords).toHaveBeenCalledWith(
      7,
      "personal_fixed_cost",
      5
    );
    expect(result).toMatchObject({
      records: [{ id: 9, description: "Conta" }],
    });
    expect(JSON.stringify(result)).not.toContain("userId");
  });
});
