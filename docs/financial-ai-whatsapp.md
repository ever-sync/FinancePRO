# Analista financeiro via WhatsApp

O FinancePRO recebe mensagens pelo gateway Baileys, resolve o titular pela integração autorizada e usa o n8n para interpretar a conversa. O backend continua sendo a autoridade sobre identidade, saldo, regras financeiras e escrita no banco.

## Fluxo

1. O gateway envia o evento ao webhook do FinancePRO com `Authorization: Bearer <WHATSAPP_WEBHOOK_SECRET>`.
2. O backend valida segredo, instância, número autorizado e idempotência do evento.
3. O FinancePRO cria ou reutiliza contato, conversa e mensagem recebida.
4. Uma sessão curta e assinada, presa à integração e à conversa, acompanha a chamada ao n8n.
5. O agente consulta o snapshot atual e chama ferramentas privadas com essa sessão.
6. O backend valida o contrato, aplica `tenantId + userId`, grava a mutação e sua auditoria.
7. A resposta entra na outbox persistente antes de ser enviada pelo gateway.
8. Se o n8n falhar, o assistente interno continua disponível como fallback.

O modelo não recebe autorização para movimentar dinheiro e não pode fornecer um `userId` alternativo. Toda transferência é somente um par de registros internos no FinancePRO.

## Configuração do gateway Baileys

Publique `services/baileys-gateway` como serviço separado. Variáveis obrigatórias:

```dotenv
DATABASE_URL=postgresql://...
AUTH_ENCRYPTION_KEY=<32 bytes em hex ou base64>
GATEWAY_API_KEY=<segredo com pelo menos 32 bytes>
FINANCEPRO_WEBHOOK_URL=https://app.example.com/api/whatsapp/baileys/webhook
FINANCEPRO_WEBHOOK_SECRET=<mesmo WHATSAPP_WEBHOOK_SECRET do app>
SESSION_ID=financepro
LOG_LEVEL=info
```

No serviço FinancePRO:

```dotenv
BAILEYS_GATEWAY_URL=https://gateway.example.com
BAILEYS_GATEWAY_API_KEY=<mesmo GATEWAY_API_KEY>
WHATSAPP_WEBHOOK_SECRET=<segredo diferente dos demais>
```

Depois:

1. abra **WhatsApp > Integração**;
2. escolha `Baileys`;
3. informe URL do gateway, chave e número autorizado com DDI/DDD;
4. salve a integração;
5. clique em **Solicitar código** e vincule em _WhatsApp > Aparelhos conectados_;
6. confira o status e envie uma mensagem de teste.

O gateway guarda as credenciais de sessão criptografadas e persiste eventos destinados ao FinancePRO em uma outbox própria. O serviço não deve ser escalado para várias réplicas com o mesmo `SESSION_ID`.

## Configuração do n8n

Importe [financepro-agent.workflow.json](../n8n/financepro-agent.workflow.json) como inativo. Configure:

- credencial do modelo de IA;
- credencial Header Auth de entrada `X-Agent-Secret` com o mesmo `N8N_AGENT_SECRET` do FinancePRO;
- credencial Header Auth de saída `Authorization: Bearer <N8N_AGENT_SECRET>`;
- webhook de produção do workflow;
- URL HTTPS do FinancePRO no nó de ferramentas quando os serviços estiverem em projetos Railway diferentes; use a URL privada somente no mesmo projeto.

No FinancePRO:

```dotenv
N8N_AGENT_WEBHOOK_URL=http://n8n-webhook.railway.internal:5678/webhook/financepro-agent
N8N_AGENT_SECRET=<segredo com pelo menos 32 bytes>
N8N_AGENT_TIMEOUT_MS=45000
```

Antes de ativar, valide o health da ferramenta com a credencial configurada. Nunca grave segredo diretamente no JSON versionado do workflow.

## API privada do agente

`POST /api/n8n/finance/tool`

Cabeçalhos obrigatórios, exceto sessão para `health`:

```http
X-Agent-Secret: <N8N_AGENT_SECRET>
X-Agent-Session: <token curto emitido pelo FinancePRO>
Content-Type: application/json
```

Ferramentas canônicas:

- consultas: `get_financial_snapshot`, `get_registration_context`, `list_financial_items`, `list_financial_calendar`, `get_upcoming_cashflow`, `get_budget_status`, `list_financial_transactions`, `get_lifelong_plan`;
- agenda: `create_financial_account`, `update_financial_account`, `archive_financial_account`, `create_payable`, `create_receivable`, `create_recurrence`, `create_installment_plan`, `create_card_purchase`, `settle_payable`, `settle_receivable`, `update_financial_item`, `update_recurrence`, `cancel_financial_item`, `undo_financial_action`;
- movimentos confirmados: `record_income`, `record_expense`, `create_transfer`, além dos contratos canônicos anteriores de saldo, transação, transferência e categoria;
- plano vitalício: `propose_income_allocation`, `confirm_income_allocation`, `confirm_financial_phase`, `set_income_2027_confirmation`, `record_credit_health`, `update_credit_cleanup_task`;
- patrimônio: `upsert_asset`, `record_car_quote`, `set_investment_policy`, `upsert_investment_position`, `record_dividend`;
- metas e projetos: `create_financial_goal`, `update_financial_goal_item`, `update_recurring_cashflow`, `update_financial_debt`, `update_financial_task`, `create_financial_project`, `confirm_project_payment`;
- decisão: `simulate_purchase`, `simulate_car`;
- automação: `create_reminder`, `pause_notifications`, `set_notification_preference`.

Os valores dessas ferramentas são centavos inteiros. Uma expressão ambígua como “5000 mil” retorna erro de ambiguidade para o agente pedir confirmação. Toda escrita V3 recebe `requestId` único e devolve `action_id`, `entity_id`, `human_summary`, impactos confirmados/esperados, avisos e a informação de que não houve movimentação bancária.

Ao registrar uma receita confirmada, o backend cria uma proposta determinística de alocação conforme a fase atual. A proposta não transfere o dinheiro: `confirm_income_allocation` apenas registra a concordância do usuário. Ativos, posições, dividendos e cotações também são registros internos; o agente não compra, vende, investe nem solicita crédito.

## Confirmação e desfazer

Escritas explícitas de baixo risco — cadastro, lançamento, categoria, saldo, meta, projeto, tarefa e confirmação de pagamento — podem ser executadas diretamente e ficam auditadas. O agente deve informar o resultado e oferecer `desfazer` quando a resposta trouxer uma janela válida.

O comando operacional `undo_financial_action` restaura o estado dentro da janela indicada e registra uma nova auditoria. O comando legado `undo_financial_transaction` continua aceito por 15 minutos e cria uma transação de reversão; o histórico original não é apagado.

Exigem confirmação adicional:

- retirada ou redução de conta protegida;
- cancelamento amplo de recorrência, arquivamento de ativo e mudanças destrutivas do cadastro legado;
- ativação de política de investimentos após suitability;
- mudança de fase financeira;
- qualquer pedido cujo valor, conta ou intenção esteja ambíguo.

As frases exigidas pela API para reserva não devem ser inferidas pelo agente. Mesmo após confirmação, nenhum PIX, TED ou pagamento externo é executado.

## Opt-in, pausa e silêncio

As frases “parar mensagens”, “não quero mais lembretes” e equivalentes registram opt-out antes de chamar a IA. “Voltar mensagens” ou equivalente reativa o opt-in. A conversa iniciada pelo usuário continua disponível mesmo com mensagens proativas desligadas.

Por padrão, mensagens agendadas ficam em silêncio das 21h às 8h no timezone do perfil. Durante esse período elas são adiadas, não descartadas. `pause_notifications` cria uma pausa temporária; `set_notification_preference` controla o consentimento contínuo.

## Scheduler e filas

Chame a cada 15 minutos:

```http
POST /api/cron/financial-automation
Authorization: Bearer <CRON_SECRET>
```

O endpoint:

- agenda contas, recebimentos esperados e tarefas;
- alerta envelopes em 70%, 85% e 100%;
- gera ocorrências recorrentes por 90 dias, atualiza atrasos e sincroniza o protocolo de risco;
- produz revisão semanal e resumo de pequenos gastos;
- cobra pipeline de projetos na segunda, quarta e sexta;
- produz fechamento mensal;
- despacha notificações vencidas;
- drena a outbox do WhatsApp.

O workflow [financepro-automation.workflow.json](../n8n/financepro-automation.workflow.json) executa esse endpoint a cada 15 minutos. Associe a ele uma credencial Header Auth `Authorization: Bearer <CRON_SECRET>`, publique-o e reinicie o processo principal do n8n para registrar o gatilho.

`scheduled_notifications` e `whatsapp_outbox` possuem chaves idempotentes. Falhas usam backoff exponencial; após oito tentativas o item vai para `dead_letter`. O modelo de entrega é pelo menos uma vez, porque nenhum provedor externo consegue participar da mesma transação PostgreSQL.

## Endpoints públicos protegidos

- `POST /api/whatsapp/baileys/webhook`;
- `POST /api/whatsapp/uazapi/webhook` para compatibilidade;
- `POST /api/cron/financial-automation`;
- `POST /api/cron/financial-daily`;
- `POST /api/cron/financial-month-start`;
- `POST /api/cron/financial-month-end`.

Webhook aceita Bearer ou `X-Webhook-Secret`; cron aceita Bearer ou `X-Cron-Secret`. Com segredo ausente ou menor que 32 caracteres, os endpoints falham fechados.

## Diagnóstico

- HTTP 400 no pareamento: salve a integração antes, confira DDI/DDD, status do gateway e se a sessão já está vinculada;
- HTTP 401 no webhook: confira se os dois serviços usam o mesmo `WHATSAPP_WEBHOOK_SECRET`;
- HTTP 401 na ferramenta n8n: confira Header Auth e se `X-Agent-Session` chegou do webhook atual;
- mensagem recebida sem resposta: confira execução do workflow, `N8N_AGENT_WEBHOOK_URL` e outbox;
- mensagens proativas ausentes: confira opt-in, pausa, horário silencioso, cron e itens `dead_letter`;
- saldo divergente: confirme data do saldo e importe/reconcilie o extrato antes de simular compras.

Os endpoints `/health`, `/ready` e `/metrics` ajudam a separar falha de app, banco e autenticação.

## Segurança operacional

- segredos independentes para cron, webhook, gateway e n8n;
- comparação de segredo em tempo constante;
- rate limiting nos endpoints públicos;
- URLs externas validadas contra SSRF;
- dados canônicos sempre filtrados por tenant e usuário;
- payloads e tokens não são escritos em logs;
- credenciais do gateway criptografadas;
- mudanças financeiras e consentimentos auditados.

Em produção, mantenha `ALLOW_PRIVATE_UAZAPI_URLS=false`. Defina `ALLOW_PRIVATE_BAILEYS_URLS=true` apenas para o domínio privado controlado do gateway Railway; gateways públicos HTTPS não precisam dessa exceção.
