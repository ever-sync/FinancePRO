import { describe, expect, it } from "vitest";
import {
  detectImportDelimiter,
  inferFinancialImportMapping,
  parseImportCsv,
  parseImportSource,
  parseSignedImportAmount,
  parseSignedImportAmountFromColumns,
  resolveFinancialImportPreset,
  suggestFinancialImportCategory,
  suggestFinancialStatementDestination,
  suggestInvestmentType,
} from "./financial-import";

describe("financial import helpers", () => {
  it("detects delimiter and parses csv rows", () => {
    const csv = "data;descricao;valor\n2026-04-01;Meta Ads;890,50";
    expect(detectImportDelimiter(csv)).toBe(";");

    const parsed = parseImportCsv(csv, ";");
    expect(parsed.headers).toEqual(["data", "descricao", "valor"]);
    expect(parsed.records[0]?.descricao).toBe("Meta Ads");
  });

  it("infers mapping for debt-related headers", () => {
    const mapping = inferFinancialImportMapping(
      ["Credor", "Saldo Atual", "Parcela Mensal", "Juros", "Dia Vencimento"],
      "debts"
    );

    expect(mapping.counterparty).toBe("Credor");
    expect(mapping.balance).toBe("Saldo Atual");
    expect(mapping.monthlyPayment).toBe("Parcela Mensal");
    expect(mapping.interestRate).toBe("Juros");
    expect(mapping.dueDay).toBe("Dia Vencimento");
  });

  it("infers credit and debit headers for statement imports", () => {
    const mapping = inferFinancialImportMapping(
      ["Data", "Historico", "Credito", "Debito", "Saldo"],
      "company_variable_costs"
    );

    expect(mapping.date).toBe("Data");
    expect(mapping.description).toBe("Historico");
    expect(mapping.credit).toBe("Credito");
    expect(mapping.debit).toBe("Debito");
    expect(mapping.balance).toBe("Saldo");
  });

  it("suggests categories and investment type from description", () => {
    expect(
      suggestFinancialImportCategory({
        target: "company_variable_costs",
        description: "Meta Ads abril",
      })
    ).toBe("Marketing");

    expect(
      suggestFinancialImportCategory({
        target: "personal_variable_costs",
        description: "Mercado do bairro",
      })
    ).toBe("Alimentacao");

    expect(suggestInvestmentType({ description: "Tesouro Selic 2029" })).toBe(
      "Tesouro Direto"
    );
  });

  it("resolves reserve preset into target and reserve type", () => {
    expect(resolveFinancialImportPreset("reserve_company")).toMatchObject({
      target: "reserve_funds",
      reserveFundType: "empresa",
    });
  });

  it("parses signed amounts and classifies statement rows", () => {
    expect(parseSignedImportAmount("-245,90")).toBe(-245.9);
    expect(parseSignedImportAmount("(1.500,00)")).toBe(-1500);
    expect(parseSignedImportAmount("1500,00")).toBe(1500);
    expect(parseSignedImportAmountFromColumns({ credit: "1500,00" })).toBe(1500);
    expect(parseSignedImportAmountFromColumns({ debit: "245,90" })).toBe(-245.9);
    expect(
      parseSignedImportAmountFromColumns({
        amount: "",
        credit: "0,00",
        debit: "89,90",
      })
    ).toBe(-89.9);

    expect(
      suggestFinancialStatementDestination({
        amount: -890.5,
        scope: "misto",
        description: "Meta Ads abril",
      })
    ).toMatchObject({
      suggestedTarget: "company_variable_costs",
      confidence: "alta",
    });

    expect(
      suggestFinancialStatementDestination({
        amount: -245.9,
        scope: "misto",
        description: "Mercado do bairro",
      })
    ).toMatchObject({
      suggestedTarget: "personal_variable_costs",
      confidence: "alta",
    });

    expect(
      suggestFinancialStatementDestination({
        amount: 1500,
        scope: "empresa",
        description: "Pix cliente ACME",
      })
    ).toMatchObject({
      suggestedTarget: "revenues",
    });
  });

  it("parses ofx statements into importable rows", () => {
    const ofx = `
      <OFX>
        <BANKMSGSRSV1>
          <STMTTRNRS>
            <STMTRS>
              <BANKTRANLIST>
                <STMTTRN>
                  <TRNTYPE>CREDIT
                  <DTPOSTED>20260401120000[-3:BRT]
                  <TRNAMT>1500.00
                  <FITID>abc123
                  <NAME>CLIENTE ACME
                  <MEMO>PIX CLIENTE ACME
                </STMTTRN>
                <STMTTRN>
                  <TRNTYPE>DEBIT
                  <DTPOSTED>20260402120000[-3:BRT]
                  <TRNAMT>-245.90
                  <FITID>def456
                  <NAME>MERCADO DO BAIRRO
                  <MEMO>COMPRA CARTAO
                </STMTTRN>
              </BANKTRANLIST>
            </STMTRS>
          </STMTTRNRS>
        </BANKMSGSRSV1>
      </OFX>
    `;

    const parsed = parseImportSource(ofx, ";");
    expect(parsed.format).toBe("ofx");
    expect(parsed.data.headers).toEqual([
      "data",
      "descricao",
      "valor",
      "contraparte",
      "tipo",
      "documento",
    ]);
    expect(parsed.data.records).toHaveLength(2);
    expect(parsed.data.records[0]).toMatchObject({
      data: "2026-04-01",
      descricao: "PIX CLIENTE ACME",
      valor: "1500.00",
      contraparte: "CLIENTE ACME",
      tipo: "CREDIT",
      documento: "abc123",
    });
    expect(parsed.data.records[1]).toMatchObject({
      data: "2026-04-02",
      descricao: "COMPRA CARTAO",
      valor: "-245.90",
      contraparte: "MERCADO DO BAIRRO",
      tipo: "DEBIT",
      documento: "def456",
    });
  });
});
