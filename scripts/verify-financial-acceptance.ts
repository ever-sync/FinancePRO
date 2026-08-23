import { readFile } from "node:fs/promises";
import { closeDb, getUserByOpenId, upsertUser } from "../server/db";
import * as financialDb from "../server/db/financial-core";
import { parseSantanderStatement } from "../server/finance/santander-statement";
import {
  bootstrapRaphaelFinancialProfile,
  getCanonicalFifthBusinessDay,
} from "../server/financial-core";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Acceptance check failed: ${message}`);
}

async function main() {
  assert(process.env.DATABASE_URL, "DATABASE_URL is required");
  const statementPath = process.argv
    .slice(2)
    .find(argument => argument !== "--");
  assert(statementPath, "pass the Santander CSV path as the first argument");

  const openId = "financial-acceptance-raphael";
  await upsertUser({
    openId,
    name: "Raphael Acceptance",
    loginMethod: "acceptance",
    lastSignedIn: new Date(),
  });
  const user = await getUserByOpenId(openId);
  assert(user, "acceptance user was not created");
  await bootstrapRaphaelFinancialProfile(user.id, user.tenantId);
  const scope = await financialDb.resolveFinancialScope(user.id, user.tenantId);
  const accounts = await financialDb.listFinancialAccounts(scope);
  const businessAccount = accounts.find(
    account => account.seedKey === "account-pj"
  );
  const personalAccount = accounts.find(
    account => account.seedKey === "account-pf"
  );
  assert(businessAccount && personalAccount, "PF/PJ accounts are missing");

  const statement = parseSantanderStatement(await readFile(statementPath));
  const firstImport = await financialDb.importSantanderStatement(scope, {
    accountId: businessAccount.id,
    fileName: statementPath.split("/").pop() ?? "extrato.csv",
    statement,
    actor: { type: "import", id: "acceptance" },
  });
  const repeatedImport = await financialDb.importSantanderStatement(scope, {
    accountId: businessAccount.id,
    fileName: statementPath.split("/").pop() ?? "extrato.csv",
    statement,
    actor: { type: "import", id: "acceptance" },
  });
  assert(statement.rows.length === 353, "Santander row count must be 353");
  assert(
    statement.totals.creditCents === 5_306_546,
    "Santander credits total differs"
  );
  assert(
    statement.totals.debitCents === 5_335_104,
    "Santander debits total differs"
  );
  assert(statement.totals.netCents === -28_558, "Santander net total differs");
  assert(
    statement.totals.endingBalanceCents === 2_762,
    "Santander ending balance differs"
  );
  assert(
    firstImport.importedCount === 353,
    "first import must insert 353 rows"
  );
  assert(
    repeatedImport.alreadyProcessed && repeatedImport.duplicateCount === 353,
    "second import must be idempotent"
  );

  const income = await financialDb.recordFinancialTransaction(scope, {
    accountId: personalAccount.id,
    type: "income",
    amountCents: 100_000,
    occurredAt: new Date(),
    description: "Receita de teste de aceitacao",
    status: "received",
    source: "system",
    idempotencyKey: "acceptance:income:1",
    actor: { type: "system", id: "acceptance" },
  });
  const goals = await financialDb.listFinancialGoals(scope);
  assert(goals[0], "seed goal is missing");
  const allocation = await financialDb.allocateConfirmedIncome(scope, {
    transactionId: income.transaction.id,
    allocations: [
      {
        allocationType: "priority_goals",
        amountCents: 25_000,
        goalId: goals[0].id,
      },
    ],
    requestId: "acceptance:allocation:1",
    actor: { type: "system", id: "acceptance" },
  });
  const repeatedAllocation = await financialDb.allocateConfirmedIncome(scope, {
    transactionId: income.transaction.id,
    allocations: [
      {
        allocationType: "priority_goals",
        amountCents: 25_000,
        goalId: goals[0].id,
      },
    ],
    requestId: "acceptance:allocation:1",
    actor: { type: "system", id: "acceptance" },
  });
  assert(
    "allocatedCents" in allocation && allocation.allocatedCents === 25_000,
    "income allocation failed"
  );
  assert(repeatedAllocation.alreadyProcessed, "allocation is not idempotent");

  await financialDb.upsertBusinessHoliday(
    scope,
    {
      date: "2026-09-01",
      name: "Feriado de teste",
      holidayScope: "acceptance",
      source: "acceptance",
    },
    { type: "system", id: "acceptance" }
  );
  const fifthBusinessDay = await getCanonicalFifthBusinessDay(user.id, {
    year: 2026,
    month: 9,
    expectedTenantId: user.tenantId,
  });
  assert(
    fifthBusinessDay.date === "2026-09-09",
    "custom holiday did not recalculate the fifth business day"
  );
  const recurringAfterHoliday = await financialDb.listRecurringCashflows(scope);
  assert(
    recurringAfterHoliday.find(
      item => item.seedKey === "income-complement-fifth-business-day"
    )?.nextDueDate === fifthBusinessDay.date,
    "stored fifth-business-day income was not recalculated"
  );

  const secondOpenId = "financial-acceptance-other-tenant";
  await upsertUser({
    openId: secondOpenId,
    name: "Other Tenant",
    loginMethod: "acceptance",
    lastSignedIn: new Date(),
  });
  const secondUser = await getUserByOpenId(secondOpenId);
  assert(secondUser, "second tenant user was not created");
  const secondScope = await financialDb.resolveFinancialScope(
    secondUser.id,
    secondUser.tenantId
  );
  let tenantIsolationWorked = false;
  try {
    await financialDb.recordFinancialTransaction(secondScope, {
      accountId: personalAccount.id,
      type: "expense",
      amountCents: 100,
      occurredAt: new Date(),
      description: "Must not cross tenants",
      status: "paid",
      source: "system",
      idempotencyKey: "acceptance:cross-tenant",
      actor: { type: "system", id: "acceptance" },
    });
  } catch {
    tenantIsolationWorked = true;
  }
  assert(tenantIsolationWorked, "cross-tenant account access was accepted");

  process.stdout.write(
    `${JSON.stringify(
      {
        rows: statement.rows.length,
        creditCents: statement.totals.creditCents,
        debitCents: statement.totals.debitCents,
        netCents: statement.totals.netCents,
        endingBalanceCents: statement.totals.endingBalanceCents,
        duplicateRows: repeatedImport.duplicateCount,
        allocationIdempotent: repeatedAllocation.alreadyProcessed,
        fifthBusinessDay: fifthBusinessDay.date,
        tenantIsolationWorked,
      },
      null,
      2
    )}\n`
  );
}

main()
  .catch(error => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
    );
    process.exitCode = 1;
  })
  .finally(() => closeDb());
