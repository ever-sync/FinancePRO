import { describe, expect, it } from "vitest";
import {
  createSantanderRowHash,
  parseBrazilianCents,
  parseSantanderStatement,
} from "./santander-statement";

describe("Santander PJ statement parser", () => {
  const latin1 = Buffer.from(
    [
      'AGENCIA;"3733";CONTA;"130091640"',
      "",
      "Data;Histórico;Documento;Valor (R$);Saldo (R$)",
      '"24/08/2026";"Pix Enviado Padaria; Centro";"";"-47,05";"27,62"',
      '"21/08/2026";"Pix Recebido Cliente";"19262730";"1.000,00";"74,67"',
    ].join("\r\n"),
    "latin1"
  );

  it("parses Latin-1, quoted semicolons, Brazilian dates and cents", () => {
    const statement = parseSantanderStatement(latin1);
    expect(statement.encoding).toBe("windows-1252");
    expect(statement.agency).toBe("3733");
    expect(statement.account).toBe("130091640");
    expect(statement.rows).toHaveLength(2);
    expect(statement.rows[0]).toMatchObject({
      date: "2026-08-24",
      description: "Pix Enviado Padaria; Centro",
      amountCents: -4_705,
      balanceAfterCents: 2_762,
    });
    expect(statement.totals).toEqual({
      creditCents: 100_000,
      debitCents: 4_705,
      netCents: 95_295,
      endingBalanceCents: 2_762,
    });
  });

  it("creates a stable, tenant-aware row fingerprint", () => {
    const row = parseSantanderStatement(latin1).rows[0];
    expect(createSantanderRowHash(1, 10, row)).toBe(
      createSantanderRowHash(1, 10, row)
    );
    expect(createSantanderRowHash(2, 10, row)).not.toBe(
      createSantanderRowHash(1, 10, row)
    );
  });

  it("converts Brazilian monetary notation without floating point", () => {
    expect(parseBrazilianCents("53.065,46")).toBe(5_306_546);
    expect(parseBrazilianCents("-285,58")).toBe(-28_558);
  });
});
