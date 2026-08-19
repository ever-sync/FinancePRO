import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import * as db from "./db";

// Mock the database module
vi.mock("./db", () => {
  const mockSettings = {
    id: 1,
    userId: 1,
    taxPercent: "6",
    tithePercent: "10",
    investmentPercent: "10",
    proLaboreGross: "5000.00",
    companyReserveMonths: 3,
    personalReserveMonths: 6,
    companyName: "Empresa Teste",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockRevenue = {
    id: 1,
    userId: 1,
    description: "Serviço de consultoria",
    category: "Consultoria",
    grossAmount: "10000.00",
    taxAmount: "600.00",
    netAmount: "9400.00",
    client: "Cliente A",
    dueDate: "2026-03-15",
    receivedDate: null,
    status: "pendente",
    month: 3,
    year: 2026,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockEmployee = {
    id: 1,
    userId: 1,
    name: "João Silva",
    role: "Desenvolvedor",
    salary: "3000.00",
    fgtsAmount: "240.00",
    thirteenthProvision: "250.00",
    vacationProvision: "333.33",
    totalCost: "3823.33",
    paymentDay: 5,
    admissionDate: "2025-01-15",
    status: "ativo",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockDebt = {
    id: 1,
    userId: 1,
    creditor: "Banco X",
    description: "Empréstimo",
    originalAmount: "50000.00",
    currentBalance: "30000.00",
    monthlyPayment: "2000.00",
    interestRate: "1.5",
    totalInstallments: 24,
    paidInstallments: 10,
    dueDay: 15,
    priority: "alta",
    status: "ativa",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return {
    getSettings: vi.fn().mockResolvedValue(mockSettings),
    upsertSettings: vi.fn().mockResolvedValue(undefined),
    getRevenues: vi.fn().mockResolvedValue({
      data: [mockRevenue],
      pagination: {
        page: 1,
        limit: 25,
        total: 1,
        totalPages: 1,
        hasMore: false,
      },
      summary: {
        totalGross: "10000.00",
        totalNet: "9400.00",
        totalReceived: "0.00",
      },
    }),
    createRevenue: vi.fn().mockResolvedValue(mockRevenue),
    updateRevenue: vi.fn().mockResolvedValue(undefined),
    deleteRevenue: vi.fn().mockResolvedValue(undefined),
    getCompanyFixedCosts: vi.fn().mockResolvedValue([]),
    createCompanyFixedCost: vi.fn().mockResolvedValue({ id: 1 }),
    updateCompanyFixedCost: vi.fn().mockResolvedValue(undefined),
    deleteCompanyFixedCost: vi.fn().mockResolvedValue(undefined),
    getCompanyVariableCosts: vi.fn().mockResolvedValue({
      data: [],
      pagination: {
        page: 1,
        limit: 1,
        total: 0,
        totalPages: 0,
        hasMore: false,
      },
      summary: { totalAmount: "0.00" },
    }),
    createCompanyVariableCost: vi.fn().mockResolvedValue({ id: 1 }),
    updateCompanyVariableCost: vi.fn().mockResolvedValue(undefined),
    deleteCompanyVariableCost: vi.fn().mockResolvedValue(undefined),
    getEmployees: vi.fn().mockResolvedValue({
      data: [mockEmployee],
      pagination: {
        page: 1,
        limit: 25,
        total: 1,
        totalPages: 1,
        hasMore: false,
      },
      summary: {
        activeCount: 1,
        totalActiveSalary: "3000.00",
        totalActiveCost: "3823.33",
      },
    }),
    createEmployee: vi.fn().mockResolvedValue(mockEmployee),
    updateEmployee: vi.fn().mockResolvedValue(undefined),
    deleteEmployee: vi.fn().mockResolvedValue(undefined),
    getSuppliers: vi.fn().mockResolvedValue([]),
    createSupplier: vi.fn().mockResolvedValue({ id: 1 }),
    deleteSupplier: vi.fn().mockResolvedValue(undefined),
    getSupplierPurchases: vi.fn().mockResolvedValue([]),
    createSupplierPurchase: vi.fn().mockResolvedValue({ id: 1 }),
    updateSupplierPurchase: vi.fn().mockResolvedValue(undefined),
    deleteSupplierPurchase: vi.fn().mockResolvedValue(undefined),
    getPersonalFixedCosts: vi.fn().mockResolvedValue([]),
    createPersonalFixedCost: vi.fn().mockResolvedValue({ id: 1 }),
    updatePersonalFixedCost: vi.fn().mockResolvedValue(undefined),
    deletePersonalFixedCost: vi.fn().mockResolvedValue(undefined),
    getPersonalVariableCosts: vi.fn().mockResolvedValue({
      data: [],
      pagination: {
        page: 1,
        limit: 1,
        total: 0,
        totalPages: 0,
        hasMore: false,
      },
      summary: { totalAmount: "0.00" },
    }),
    createPersonalVariableCost: vi.fn().mockResolvedValue({ id: 1 }),
    updatePersonalVariableCost: vi.fn().mockResolvedValue(undefined),
    deletePersonalVariableCost: vi.fn().mockResolvedValue(undefined),
    getDebts: vi.fn().mockResolvedValue([mockDebt]),
    getDebtsPage: vi.fn().mockResolvedValue({
      data: [mockDebt],
      pagination: {
        page: 1,
        limit: 25,
        total: 1,
        totalPages: 1,
        hasMore: false,
      },
      summary: {
        openCount: 1,
        totalBalance: "30000.00",
        totalMonthly: "2000.00",
      },
    }),
    createDebt: vi.fn().mockResolvedValue(mockDebt),
    updateDebt: vi.fn().mockResolvedValue(undefined),
    deleteDebt: vi.fn().mockResolvedValue(undefined),
    getInvestments: vi.fn().mockResolvedValue([]),
    getInvestmentsPage: vi.fn().mockResolvedValue({
      data: [],
      pagination: {
        page: 1,
        limit: 25,
        total: 0,
        totalPages: 0,
        hasMore: false,
      },
      summary: {
        totalDeposited: "0.00",
        totalBalance: "0.00",
        totalYield: "0.00",
      },
    }),
    createInvestment: vi.fn().mockResolvedValue({ id: 1 }),
    deleteInvestment: vi.fn().mockResolvedValue(undefined),
    getReserveFunds: vi.fn().mockResolvedValue([]),
    getReserveFundsPage: vi.fn().mockResolvedValue({
      data: [],
      pagination: {
        page: 1,
        limit: 25,
        total: 0,
        totalPages: 0,
        hasMore: false,
      },
      summary: { totalAmount: "0.00" },
    }),
    getClientsPage: vi.fn().mockResolvedValue({
      data: [],
      pagination: {
        page: 1,
        limit: 25,
        total: 0,
        totalPages: 0,
        hasMore: false,
      },
      summary: { categoryCount: 0 },
    }),
    getServicesPage: vi.fn().mockResolvedValue({
      data: [],
      pagination: {
        page: 1,
        limit: 25,
        total: 0,
        totalPages: 0,
        hasMore: false,
      },
      summary: { activeCount: 0, totalPortfolio: "0.00" },
    }),
    createReserveFund: vi.fn().mockResolvedValue({ id: 1 }),
    deleteReserveFund: vi.fn().mockResolvedValue(undefined),
    getCalendarData: vi.fn().mockResolvedValue([]),
    getCompanyDashboardData: vi.fn().mockResolvedValue({
      revenue: {
        items: [],
        totalGross: "10000.00",
        totalTax: "600.00",
        totalNet: "9400.00",
      },
      fixedCosts: { items: [], total: "3000.00" },
      variableCosts: { items: [], total: "500.00" },
      employees: { items: [], totalSalary: "3000.00", totalCost: "3823.33" },
      purchases: { items: [], total: "1000.00" },
    }),
    getPersonalDashboardData: vi.fn().mockResolvedValue({
      settings: {
        proLaboreGross: "5000.00",
        tithePercent: "10",
        investmentPercent: "10",
      },
      fixedCosts: { items: [], total: "2000.00" },
      variableCosts: { items: [], total: "500.00" },
      debts: { items: [], totalMonthly: "2000.00", totalBalance: "30000.00" },
      investments: { items: [], totalDeposited: "0", totalBalance: "0" },
    }),
    getUserByOpenId: vi.fn().mockResolvedValue(undefined),
    upsertUser: vi.fn().mockResolvedValue(undefined),
  };
});

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-123",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Settings Router", () => {
  it("returns user settings", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.settings.get();
    expect(result).toBeDefined();
    expect(result?.taxPercent).toBe("6");
    expect(result?.tithePercent).toBe("10");
    expect(result?.investmentPercent).toBe("10");
    expect(result?.proLaboreGross).toBe("5000.00");
  });

  it("upserts settings with new values", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.settings.upsert({
        taxPercent: "8",
        proLaboreGross: "6000.00",
        companyName: "Nova Empresa",
      })
    ).resolves.not.toThrow();
  });
});

describe("Revenues Router", () => {
  it("lists revenues for a given month", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.revenues.list({ month: 3, year: 2026 });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].grossAmount).toBe("10000.00");
    expect(result.data[0].taxAmount).toBe("600.00");
    expect(db.getRevenues).toHaveBeenCalledWith(1, 3, 2026, {
      page: 1,
      limit: 25,
    });
  });

  it("creates a new revenue entry", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.revenues.create({
      description: "Novo serviço",
      category: "Serviço",
      grossAmount: "5000.00",
      taxAmount: "300.00",
      netAmount: "4700.00",
      dueDate: "2026-03-20",
    });
    expect(result).toBeDefined();
  });

  it("rejects revenue creation with empty description", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.revenues.create({
        description: "",
        category: "Serviço",
        grossAmount: "5000.00",
        taxAmount: "300.00",
        netAmount: "4700.00",
        dueDate: "2026-03-20",
      })
    ).rejects.toThrow();
  });

  it("rejects invalid money and calendar values before reaching the database", async () => {
    const caller = appRouter.createCaller(createAuthContext());

    await expect(
      caller.revenues.create({
        description: "Valor invalido",
        category: "Servico",
        grossAmount: "-1.00",
        taxAmount: "0.00",
        netAmount: "-1.00",
        dueDate: "2026-02-30",
      })
    ).rejects.toThrow();
    expect(db.createRevenue).not.toHaveBeenCalled();
  });
});

describe("Employees Router", () => {
  it("lists employees with bounded pagination", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.employees.list();
    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe("João Silva");
    expect(result.data[0].totalCost).toBe("3823.33");
    expect(result.summary.activeCount).toBe(1);
    expect(db.getEmployees).toHaveBeenCalledWith(1, {
      page: 1,
      limit: 25,
    });
  });

  it("rejects page sizes above the server limit", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    await expect(
      caller.employees.list({ page: 1, limit: 101 })
    ).rejects.toThrow();
    expect(db.getEmployees).not.toHaveBeenCalled();
  });

  it("creates a new employee", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.employees.create({
      name: "Maria Santos",
      role: "Designer",
      salary: "4000.00",
      fgtsAmount: "320.00",
      thirteenthProvision: "333.33",
      vacationProvision: "444.44",
      totalCost: "5097.77",
      paymentDay: 7,
    });
    expect(result).toBeDefined();
    expect(db.createEmployee).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        paymentDay: 7,
      })
    );
  });
});

describe("Variable Costs Router", () => {
  it("creates a company variable cost with installments", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    await caller.companyVariableCosts.create({
      description: "Compra parcelada",
      category: "Material",
      amount: "1200.00",
      date: "2026-03-10",
      installmentCount: 6,
    });

    expect(db.createCompanyVariableCost).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        description: "Compra parcelada",
        installmentCount: 6,
      })
    );
  });

  it("creates a personal variable cost with installments", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    await caller.personalVariableCosts.create({
      description: "Assinatura anual",
      category: "Outros",
      amount: "600.00",
      date: "2026-03-10",
      installmentCount: 12,
    });

    expect(db.createPersonalVariableCost).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        description: "Assinatura anual",
        installmentCount: 12,
      })
    );
  });
});

describe("Financial Imports Router", () => {
  it("loads reconciliation data through one protected endpoint", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const result = await caller.financialImports.reconciliationData();

    expect(result.revenues).toHaveLength(1);
    expect(result.debts).toHaveLength(1);
    expect(result.truncated).toBe(false);
    expect(db.getRevenues).toHaveBeenCalledWith(1);
    expect(db.getCompanyVariableCosts).toHaveBeenCalledWith(1);
    expect(db.getPersonalVariableCosts).toHaveBeenCalledWith(1);
  });
});

describe("Debts Router", () => {
  it("lists debts with global summary", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.debts.list();
    expect(result.data).toHaveLength(1);
    expect(result.data[0].creditor).toBe("Banco X");
    expect(result.data[0].status).toBe("ativa");
    expect(result.summary.totalBalance).toBe("30000.00");
  });

  it("creates a new debt", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.debts.create({
      creditor: "Financeira Y",
      description: "Financiamento",
      originalAmount: "20000.00",
      currentBalance: "18000.00",
      monthlyPayment: "1500.00",
      interestRate: "2.0",
      totalInstallments: 12,
      paidInstallments: 0,
      dueDay: 10,
      status: "atrasada",
      priority: "media",
    });
    expect(result).toBeDefined();
  });
});

describe("Dashboard Router", () => {
  it("rejects months outside the financial calendar", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    await expect(
      caller.dashboard.company({ month: 13, year: 2026 })
    ).rejects.toThrow();
    expect(db.getCompanyDashboardData).not.toHaveBeenCalled();
  });

  it("returns company dashboard data", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.dashboard.company({ month: 3, year: 2026 });
    expect(result).toBeDefined();
    expect(result.revenue).toBeDefined();
    expect(result.fixedCosts).toBeDefined();
    expect(result.variableCosts).toBeDefined();
    expect(result.employees).toBeDefined();
  });

  it("returns personal dashboard data", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.dashboard.personal({ month: 3, year: 2026 });
    expect(result).toBeDefined();
    expect(result.settings).toBeDefined();
    expect(result.fixedCosts).toBeDefined();
    expect(result.variableCosts).toBeDefined();
  });
});
