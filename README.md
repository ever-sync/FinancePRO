# FinancePRO

SaaS financeiro multi-tenant com painel web e analista financeiro pelo WhatsApp. O núcleo canônico separa PF, PJ, reserva e fundo do carro; usa centavos inteiros; distingue valores esperados de confirmados; registra todas as alterações relevantes em auditoria; e nunca movimenta dinheiro no banco.

## O que está implementado

- cockpit em `/planejamento` com resumo, projeções, orçamento, transações, reserva, dívidas, metas familiares, projetos, carro, importação Santander e auditoria;
- perfil idempotente de Raphael, aplicado explicitamente pelo painel, com contas, categorias, recorrências, dívida Asaas manual, metas A/B/C e tarefas de confirmação;
- transações e transferências internas auditáveis, proteção da reserva e `desfazer` por reversão em até 15 minutos;
- motor “posso comprar?”, simulador completo do carro e projeções conservadora/base/crescimento/agressiva;
- projetos com pipeline, parcelas e split configurável, inicialmente 15% impostos, 10% custos e 75% metas;
- importador Santander PJ em CSV Windows-1252/UTF-8, valores em centavos, revisão de ambiguidades e deduplicação por hash;
- agenda com contas e recebimentos, orçamento, revisão semanal, pequenos gastos, pipeline comercial, fechamento mensal, horário silencioso, opt-in/opt-out e retry;
- Baileys em serviço separado e n8n como orquestrador do agente;
- exportação de dados, solicitação segura de exclusão e trilha de auditoria para LGPD.

O módulo Asaas antigo permanece apenas por compatibilidade. O núcleo novo é manual ou operado pelo agente e não chama PIX, TED, boleto nem transferência bancária.

## Arquitetura

```text
WhatsApp
   │
   ▼
Gateway Baileys ──webhook assinado──► FinancePRO
                                         │
                         sessão curta    │    ferramentas privadas
                                         ▼
                                       n8n + IA
                                         │
                                         ▼
                                  PostgreSQL canônico
                     tenant + usuário + auditoria + filas
```

O FinancePRO resolve o usuário pela integração autorizada. O modelo nunca escolhe `userId` ou `tenantId`. O n8n recebe uma sessão curta assinada e só acessa o backend pela API de ferramentas.

## Rodar localmente

Requisitos: Node.js 20+, Corepack/pnpm e PostgreSQL 15+.

```bash
cp .env.example .env
corepack pnpm install
corepack pnpm db:migrate
corepack pnpm dev
```

Configure no mínimo `DATABASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL` e `SUPABASE_ANON_KEY`. As variáveis `VITE_*` precisam existir também durante o build.

Validação completa:

```bash
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```

Aceitação integrada do extrato real em um banco descartável:

```bash
DATABASE_URL=postgresql://usuario:senha@host:5432/banco_teste \
  corepack pnpm test:integration:financial /caminho/extrato-santander.csv
```

O script exige banco de teste vazio porque cria usuários e registros de aceitação.

## Banco e migrações

As migrações novas são:

- `0019_financial_saas_core.sql`: tenants e núcleo financeiro canônico;
- `0020_financial_notification_consent.sql`: opt-in de notificações;
- `0021_whatsapp_outbox.sql`: fila persistente de saída do WhatsApp;
- `0022_confused_thunderbolt_ross.sql`: idempotência de operações auditadas.

O deploy Railway executa `corepack pnpm db:migrate` antes de iniciar. Valores monetários canônicos são `bigint` em centavos, lidos pelo ORM como inteiros seguros; não use `float` ou valores em reais nesses contratos.

## Perfil de Raphael e Santander

Após entrar no app, abra **Planejamento IA** e selecione **Aplicar plano de Raphael**. A operação é idempotente e não sobrescreve saldos ou progresso já confirmados.

Na aba **Santander PJ**:

1. selecione a conta PJ;
2. escolha o CSV exportado pelo Santander;
3. revise o resumo e os lançamentos sem categoria.

O arquivo de referência da especificação resulta em 353 linhas, créditos de R$ 53.065,46, débitos de R$ 53.351,04, líquido de -R$ 285,58 e saldo final de R$ 27,62. Reimportar o mesmo arquivo não duplica lançamentos.

## WhatsApp com Baileys

O gateway fica em `services/baileys-gateway` e deve ser publicado como outro serviço, com volume/banco persistente. Use [services/baileys-gateway/.env.example](services/baileys-gateway/.env.example) como referência.

No gateway, configure:

- `DATABASE_URL`;
- `AUTH_ENCRYPTION_KEY` com exatamente 32 bytes em hexadecimal ou Base64;
- `GATEWAY_API_KEY` com pelo menos 32 bytes;
- `FINANCEPRO_WEBHOOK_URL=https://<financepro>/api/whatsapp/baileys/webhook`;
- `FINANCEPRO_WEBHOOK_SECRET`, igual ao `WHATSAPP_WEBHOOK_SECRET` do FinancePRO.

No FinancePRO, configure `BAILEYS_GATEWAY_URL` e `BAILEYS_GATEWAY_API_KEY`. Depois abra **WhatsApp > Integração**, escolha Baileys, informe o número com DDI/DDD, salve e solicite o código de pareamento. O erro HTTP 400 nessa etapa normalmente indica integração ainda não salva, número inválido, sessão já vinculada ou gateway indisponível; a tela mostra a mensagem normalizada do backend.

Mensagens recebidas são deduplicadas. Mensagens de saída entram em `whatsapp_outbox` antes do envio, com claim, retry exponencial e dead-letter após oito tentativas. A entrega é pelo menos uma vez; em uma falha rara entre o aceite do provedor e a gravação local, o provedor pode receber uma repetição.

## n8n

Importe [n8n/financepro-agent.workflow.json](n8n/financepro-agent.workflow.json) inicialmente como inativo. Configure no n8n:

- uma credencial do modelo de IA;
- uma credencial Header Auth com `X-Agent-Secret: <N8N_AGENT_SECRET>`;
- acesso ao FinancePRO, preferencialmente pela URL privada Railway `http://financepro.railway.internal:8080`.

No FinancePRO, configure `N8N_AGENT_WEBHOOK_URL` e `N8N_AGENT_SECRET`. O endpoint privado é `POST /api/n8n/finance/tool` e exige simultaneamente o segredo e `X-Agent-Session` assinado pelo FinancePRO.

As ferramentas canônicas cobrem snapshot, fluxo, orçamento, transações, transferências, categorização, desfazer, alocação, recorrências, dívidas, tarefas, metas, projetos, compra, carro, lembretes e preferências de mensagens. Escritas explícitas de baixo risco são diretas e auditadas. Reserva e exclusões destrutivas exigem confirmação adicional.

Detalhes do canal: [docs/financial-ai-whatsapp.md](docs/financial-ai-whatsapp.md).

## Scheduler

Execute a cada 15 minutos:

```http
POST /api/cron/financial-automation
Authorization: Bearer <CRON_SECRET>
```

Esse endpoint agenda notificações canônicas, despacha as vencidas e drena a outbox. Todos os alertas respeitam timezone, opt-in, pausa e silêncio das 21h às 8h. As chaves idempotentes evitam alertas duplicados. Também permanecem disponíveis os endpoints legados `financial-daily`, `financial-month-start` e `financial-month-end`.

## Railway

O [railway.json](railway.json) já define build, migração pré-deploy, start, healthcheck `/ready` e reinício em falha. No serviço principal:

1. conecte este repositório;
2. configure as variáveis de [.env.example](.env.example) sem incluir segredos no Git;
3. gere um domínio público;
4. valide `/health` e `/ready` após o deploy;
5. configure um cron externo ou serviço Railway para chamar `financial-automation` a cada 15 minutos.

O gateway Baileys usa seu próprio [railway.json](services/baileys-gateway/railway.json) e healthcheck `/healthz`.

## Segurança e privacidade

- isolamento obrigatório por `tenantId + userId` em todas as tabelas canônicas;
- autenticação web pelo Supabase e sessão n8n curta, assinada e vinculada à conversa;
- webhooks, cron e ferramentas protegidos por segredos fortes;
- validação de URLs contra SSRF e rate limiting nos endpoints públicos;
- histórico financeiro revertido, nunca apagado silenciosamente;
- logs operacionais sem tokens, payload financeiro completo ou segredos;
- exportação JSON e solicitação de exclusão sujeita a revisão segura.

Não use `ALLOW_PRIVATE_UAZAPI_URLS` ou `ALLOW_PRIVATE_BAILEYS_URLS` em produção.
