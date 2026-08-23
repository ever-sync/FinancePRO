# Plano vitalício V3

Esta implementação transforma o plano de Raphael em dados e regras determinísticas do FinancePRO. O modelo de IA interpreta a conversa e explica o resultado; valores, datas, recorrências, portões do carro, fases, alocações e projeções são calculados pelo backend.

## Estado inicial

O botão **Aplicar plano vitalício Raphael V3** cria o perfil de forma idempotente. Entradas futuras permanecem `expected`, saldos não confirmados usam `needs_confirmation` e nenhuma dívida é marcada como quitada sem evidência do usuário.

O onboarding começa por:

1. confirmar a dívida manual e as datas da renda;
2. confirmar saldos PF/PJ e a data de conciliação;
3. validar valores e vencimentos das recorrências candidatas;
4. confirmar a renda líquida disponível em 2027;
5. revisar preferências de alertas.

## Livro operacional

As tabelas `financial_items`, `recurrence_rules`, `financial_settlements`, `installment_plans` e `financial_actions` formam o livro de contas a pagar e receber. Elas suportam baixa parcial, recorrência por dia do mês ou dia útil, parcelas, cartão, edição/cancelamento por escopo e desfazer auditado.

O saldo livre conservador considera somente saldos confirmados e subtrai vencidos, obrigações até a próxima renda e o piso operacional. Recebíveis esperados aparecem na projeção, mas não aumentam o saldo disponível.

## Plano vitalício

O motor acompanha as fases:

- `CLEANUP`;
- `CAR_PREPARATION`;
- `CAR_PURCHASE_READY`;
- `POST_CAR_RESERVE`;
- `WEALTH_WITH_CAR_DEBT`;
- `WEALTH_ACCUMULATION`;
- `FINANCIAL_INDEPENDENCE`.

Uma fase sugerida só passa a ser a fase oficial depois da confirmação do usuário. Toda receita confirmada pode gerar uma proposta de alocação com precedência para vencidos, essenciais, piso, reserva, meta crítica, fundos, investimento e amortização. Confirmar a proposta não movimenta dinheiro no banco.

## Carro, crédito e patrimônio

O simulador do carro usa dados persistidos de reserva, entrada, custos iniciais, ativo de troca, saúde de crédito, renda 2027, conciliação, veículo, seguro e financiamento. Um portão vermelho bloqueia a recomendação; a reserva de emergência nunca é usada como entrada.

Ativos, avaliações e cotações são versionados por novos registros e auditados. Uma cotação marcada como consulta dura apenas registra o fato informado; o FinancePRO não solicita crédito.

## Investimentos e independência

A política de investimento ativa exige suitability confirmado e alocação total de 10.000 pontos-base. Contas de emergência e longo prazo são separadas. Atualizar uma posição cria um snapshot da carteira, e dividendos ficam registrados com valor bruto, retenção, líquido e reinvestimento informado.

Na fase de acumulação, dividendos não reinvestidos geram aviso. O sistema nunca envia ordem de compra ou venda. A meta real de independência usa gasto anual e taxa de retirada configurada; projeções exibem hipóteses e não prometem retorno.

## Operação após atualizar o código

1. execute a migração `0023_furry_living_tribunal.sql`;
2. reimporte `n8n/financepro-agent.workflow.json` no n8n e preserve as credenciais;
3. publique o workflow atualizado;
4. aplique o perfil V3 no painel;
5. responda às confirmações do onboarding pelo WhatsApp;
6. valide criação, baixa parcial, edição, cancelamento e desfazer com registros de teste.

O scheduler de 15 minutos gera ocorrências por 90 dias, marca atrasos, atualiza o semáforo de risco e agenda alertas idempotentes. O módulo Asaas antigo não participa dessas operações.
