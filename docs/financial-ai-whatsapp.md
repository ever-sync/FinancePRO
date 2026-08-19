# Assistente financeiro via WhatsApp

O FinancePro usa uma integração Uazapi para conversar com o titular pelo WhatsApp e o n8n para orquestrar o agente. O backend continua sendo a única autoridade sobre identidade, dados e mudanças: o modelo lê somente o usuário vinculado à instância autorizada e toda mutação exige um código temporário.

## Arquitetura

1. A Uazapi envia a mensagem ao webhook protegido do FinancePRO.
2. O FinancePRO valida instância, token, número autorizado e idempotência.
3. O backend cria uma sessão assinada, curta e presa à integração/conversa e chama o webhook privado do n8n.
4. O agente consulta o contexto ou os registros pela API de ferramentas do FinancePRO.
5. Leituras retornam imediatamente. Criação, edição e exclusão geram um comando pendente.
6. O titular responde `CONFIRMAR NNNNNN`; somente então a API executa a mudança em transação e grava o resultado na auditoria.
7. Se o n8n estiver indisponível, o FinancePRO usa automaticamente o assistente interno existente.

## Pré-requisitos

- PostgreSQL com as migrações aplicadas;
- projeto Supabase para autenticação;
- instância Uazapi com URL pública HTTPS, `instanceId` e token;
- endpoint de IA compatível com a configuração em `BUILT_IN_FORGE_API_*`;
- n8n com o workflow [financepro-agent.workflow.json](../n8n/financepro-agent.workflow.json), uma credencial OpenAI e uma credencial Header Auth exclusivas;
- domínio público HTTPS da aplicação.

Use [.env.example](../.env.example) como referência. Em Railway, `APP_URL` pode ser omitida quando `RAILWAY_PUBLIC_DOMAIN` estiver disponível. As chaves `VITE_SUPABASE_*` precisam estar presentes durante o build do frontend.

Gere segredos independentes, com pelo menos 32 caracteres:

```bash
openssl rand -hex 32
```

Configure valores diferentes em `CRON_SECRET`, `WHATSAPP_WEBHOOK_SECRET` e `N8N_AGENT_SECRET`.

No FinancePRO, configure também:

```dotenv
N8N_AGENT_WEBHOOK_URL=http://n8n-webhook.railway.internal:5678/webhook/financepro-agent
N8N_AGENT_TIMEOUT_MS=45000
```

O workflow de produção chama o FinancePRO pela rede privada da Railway em `http://financepro.railway.internal:8080`. O segredo nunca deve ser colocado no JSON versionado do workflow; ele fica em credencial criptografada do n8n.

## Configuração da integração

1. Entre em **WhatsApp > Integração**.
2. Informe o `instanceId`, a URL HTTPS da Uazapi, o token e o número autorizado com DDI/DDD.
3. Salve e execute **Testar conexão**.
4. O backend registra automaticamente o webhook público, incluindo o segredo necessário para validar as chamadas.

A aplicação rejeita URLs locais/privadas para evitar SSRF. Para uma Uazapi local durante desenvolvimento, habilite explicitamente `ALLOW_PRIVATE_UAZAPI_URLS=true`; essa opção não deve ser usada em produção.

## Endpoints protegidos

### Webhook Uazapi

`POST /api/whatsapp/uazapi/webhook`

O segredo é configurado automaticamente na URL cadastrada na Uazapi. Integrações que suportem cabeçalho também podem enviar `Authorization: Bearer <segredo>` ou `X-Webhook-Secret`.

Mensagens repetidas são ignoradas pelo identificador do provedor. Apenas o número salvo como autorizado pode conversar com o agente e provocar ações financeiras.

### Automações

- `POST /api/cron/financial-daily`
- `POST /api/cron/financial-month-start`
- `POST /api/cron/financial-month-end`

Envie `Authorization: Bearer <CRON_SECRET>` ou `X-Cron-Secret`. Sem um segredo forte configurado, os endpoints falham fechados com HTTP 503.

### Ferramentas do agente n8n

`POST /api/n8n/finance/tool`

O endpoint exige simultaneamente:

- `X-Agent-Secret`, configurado como credencial Header Auth do n8n;
- `X-Agent-Session`, token assinado pelo FinancePRO e válido por poucos minutos.

As ações disponíveis são `health`, `get_context`, `list_records`, `propose_change`, `execute_change` e `cancel_change`. O escopo vem exclusivamente da sessão assinada; `userId`, `integrationId` ou `threadId` enviados pelo modelo não podem ampliar o acesso.

Entidades suportadas: receitas, custos fixos e variáveis PJ/PF, funcionários, fornecedores e compras, dívidas, investimentos, reservas, clientes e serviços.

## Confirmação de mudanças

- toda criação, edição, baixa ou exclusão é preparada em `agent_commands`;
- o código tem seis dígitos, expira em 15 minutos e só pode ser usado uma vez;
- a combinação `userId + requestId` impede propostas duplicadas;
- execução e mudança financeira ocorrem na mesma transação do banco;
- códigos inválidos, expirados, de outra conversa ou já usados são recusados;
- registros de reserva e investimento são lançamentos manuais. O sistema não faz PIX, TED, boleto nem qualquer transferência bancária.

## Segurança operacional

- autenticação de usuário validada pelo Supabase;
- isolamento de dados pelo `userId` autenticado;
- webhook e cron protegidos por segredos com comparação em tempo constante;
- rate limiting nos endpoints públicos;
- URL externa da Uazapi validada antes de cada chamada;
- mensagens recebidas idempotentes no banco;
- segredos da Uazapi mascarados nas respostas do frontend;
- ações financeiras sensíveis passam pelos fluxos de confirmação do agente.
- sessão n8n assinada impede que prompt injection selecione outro usuário;
- ferramentas não aceitam `userId` fornecido pelo modelo;
- credenciais n8n são isoladas das demais automações da instância;
- sucesso de execução é idempotente e auditável.

## Migração necessária

Antes de publicar esta versão, execute:

```bash
corepack pnpm db:migrate
```

As migrações relevantes são:

- `0016_security_and_accuracy.sql`: remove eventuais duplicatas antigas e cria a restrição de idempotência do webhook;
- `0017_adorable_king_cobra.sql`: cria os comandos auditáveis do agente e seus índices.

## Publicação e rollback do workflow

Importe o workflow primeiro como inativo, confirme as credenciais e publique somente após `/ready` responder com sucesso:

```bash
n8n import:workflow --input=financepro-agent.workflow.json --activeState=fromJson
n8n publish:workflow --id=financepro-agent-v1
```

Para interromper apenas o n8n, despublique/desative o workflow. Para rollback imediato no FinancePRO, remova temporariamente `N8N_AGENT_WEBHOOK_URL`; o assistente interno continuará atendendo. Nunca remova `N8N_AGENT_SECRET` enquanto houver comandos pendentes, pois os códigos são derivados desse segredo.
