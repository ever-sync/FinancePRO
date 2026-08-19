# Sistema Financeiro Empresarial - TODO

## Infraestrutura

- [x] Schema do banco de dados (todas as tabelas)
- [x] Migrações SQL executadas
- [x] API backend (tRPC routers e db helpers)
- [x] Tema visual e design system (cores, fontes)
- [x] Layout Dashboard com sidebar navegação
- [x] Testes unitários (vitest)

## Páginas - Empresa (PJ)

- [x] Dashboard Empresa (faturamento, custos, lucro, caixa, gráficos)
- [x] Receitas (lançamento com deduções automáticas: 6% imposto)
- [x] Custos Fixos Empresa (aluguel, contador, software, etc.)
- [x] Custos Variáveis Empresa (gastos operacionais do dia a dia)
- [x] Funcionários (folha de pagamento, FGTS 8%, provisão 13º/férias)
- [x] Fornecedores (controle de compras, prazos, CNPJ)
- [x] Fundo de Reserva Empresa (meta: 3 meses de custos operacionais)

## Páginas - Pessoal (PF)

- [x] Dashboard Pessoal (pró-labore, dízimo, investimentos, saldo)
- [x] Contas Fixas Pessoais (aluguel casa, plano saúde, etc.)
- [x] Contas Variáveis Pessoais (mercado, lazer, etc.)
- [x] Dívidas Pessoais (plano de quitação, método avalanche)
- [x] Investimentos (10% do pró-labore, rendimentos, saldo acumulado)
- [x] Fundo de Reserva Pessoal (meta: 6 meses de despesas)

## Páginas - Geral

- [x] DRE Simplificado (demonstrativo de resultado)
- [x] Calendário de Pagamentos (visão mensal de vencimentos)
- [x] Configurações (percentuais, pró-labore, categorias)

## Funcionalidades Transversais

- [x] Separação PJ/PF (todo dinheiro entra na empresa primeiro)
- [x] Cálculo automático de imposto 6% sobre receitas
- [x] Cálculo automático de dízimo 10% sobre pró-labore líquido
- [x] Cálculo automático de investimento 10% sobre pró-labore líquido
- [x] Pró-labore como salário fixo do empresário
- [x] Filtros por mês/ano em todas as páginas
- [x] Status de pagamento com cores (pago/pendente/atrasado)
- [x] Responsividade desktop-first (funcional no mobile)

---

## 🚀 Melhorias Futuras (Ver IMPROVEMENT_PLAN.md para detalhes completos)

### Fase 1: Fundação & Performance (Sprints 1-3)

- [ ] Modularizar db.ts em repositórios menores
- [x] Implementar paginação em todas as listas
- [x] Criar índices no banco de dados
- [ ] Implementar Repository Pattern
- [ ] Criar Service Layer para lógica de negócio
- [ ] Validação rigorosa de inputs no backend
- [x] Rate limiting nas rotas da API
- [ ] CSRF Protection
- [ ] Padronizar error handling
- [ ] Audit logs para ações críticas
- [ ] Aumentar cobertura de testes para >80%
- [ ] Testes de integração
- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Husky pre-commit hooks

### Fase 2: Experiência do Usuário (Sprints 4-6)

- [ ] Optimistic updates nas mutations
- [ ] Skeletons específicos por página
- [ ] Validação em tempo real
- [x] Confirmação para delete
- [ ] Toast notifications melhorados
- [ ] Busca global (Ctrl+K)
- [ ] Atalhos de teclado
- [ ] Sistema de undo/redo
- [ ] Tooltips explicativos
- [ ] Onboarding/tutorial
- [ ] Acessibilidade (ARIA, contraste, navegação por teclado)

### Fase 3: Funcionalidades Financeiras (Sprints 7-10)

- [ ] Exportação de relatórios em PDF
- [ ] Exportação Excel/CSV
- [ ] DRE avançado com comparativos
- [ ] Gráficos avançados (heatmaps, treemaps)
- [ ] Dashboards customizáveis
- [ ] Fluxo de caixa projetado
- [ ] Budget vs Realizado
- [ ] Comparativos MoM e YoY
- [ ] Forecast automático
- [ ] Metas financeiras
- [ ] Alertas de vencimento
- [ ] Notificações por email
- [ ] Push notifications
- [ ] Cálculo de impostos por regime
- [ ] Guias de impostos (DARF, DAS, GPS)

### Fase 4: Infraestrutura & DevOps (Sprints 11-12)

- [ ] Dockerizar aplicação
- [ ] Docker Compose para stack completa
- [ ] Ambiente de staging
- [ ] Health checks
- [ ] Backup automático do banco
- [ ] Sentry integration
- [ ] Centralized logging
- [ ] Monitoramento de performance
- [ ] Documentação de deploy

### Fase 5: Internacionalização & Mobile (Sprints 13-15)

- [ ] i18n (i18next)
- [ ] Traduções PT-BR e EN
- [ ] Locale formatting (data, moeda)
- [ ] PWA setup
- [ ] Offline support
- [ ] Responsive mobile-first
- [ ] Touch gestures

### Fase 6: Integrações Avançadas (Sprints 16-18)

- [ ] Open Banking integration
- [ ] Conciliação bancária automática
- [ ] API de boletos
- [ ] PIX integration
- [ ] Webhook payments
- [ ] IA para detecção de anomalias
- [ ] Predictive analytics

### Agente Financeiro n8n + WhatsApp

- [x] Workflow n8n com AI Agent e modelo OpenAI isolado
- [x] API de contexto e CRUD financeiro escopada pela integração
- [x] Sessão curta assinada contra troca de usuário por prompt injection
- [x] Confirmação única para criar, editar, baixar e excluir
- [x] Auditoria e idempotência de comandos do agente
- [x] Registros de transferências/aportes explicitamente manuais
- [x] Fallback para o assistente interno quando o n8n falhar
- [x] Testes automatizados de autorização, confirmação e escopo
- [ ] Cadastrar a instância Uazapi e o número autorizado na conta do titular

---

## 📋 Quick Wins (Próximas 2 Semanas)

Prioridade máxima para entrega rápida de valor:

1. [x] Paginação em listas (4h)
2. [x] Confirmação de delete (2h)
3. [ ] Skeletons específicos (4h)
4. [ ] Validação em tempo real (5h)
5. [x] Índices no banco (3h)
6. [x] Rate limiting básico (3h)
7. [ ] Error boundaries (3h)

**Total estimado: 24h (3 dias)**

---

_Para o plano completo e detalhado, consulte: [IMPROVEMENT_PLAN.md](./IMPROVEMENT_PLAN.md)_
