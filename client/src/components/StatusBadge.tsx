import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
}

const statusMap: Record<string, { label: string; className: string }> = {
  pago: { label: "Pago", className: "bg-emerald-50 text-emerald-600 border-emerald-100" },
  pendente: { label: "Pendente", className: "bg-rose-50 text-rose-600 border-rose-100" },
  atrasado: { label: "Atrasado", className: "bg-orange-50 text-orange-600 border-orange-100" },
  recebido: { label: "Recebido", className: "bg-emerald-50 text-emerald-600 border-emerald-100" },
  received: { label: "Recebida", className: "bg-emerald-50 text-emerald-600 border-emerald-100" },
  processed: { label: "Processada", className: "bg-sky-50 text-sky-700 border-sky-100" },
  sent: { label: "Enviada", className: "bg-emerald-50 text-emerald-600 border-emerald-100" },
  delivered: { label: "Entregue", className: "bg-emerald-50 text-emerald-600 border-emerald-100" },
  failed: { label: "Falhou", className: "bg-rose-50 text-rose-600 border-rose-100" },
  ignored: { label: "Ignorada", className: "bg-zinc-100 text-zinc-500 border-zinc-200" },
  cancelado: { label: "Cancelado", className: "bg-zinc-100 text-zinc-500 border-zinc-200" },
  concluida: { label: "Concluida", className: "bg-emerald-50 text-emerald-600 border-emerald-100" },
  adiada: { label: "Adiada", className: "bg-amber-50 text-amber-700 border-amber-100" },
  adiado: { label: "Adiado", className: "bg-amber-50 text-amber-700 border-amber-100" },
  descartada: { label: "Descartada", className: "bg-zinc-100 text-zinc-500 border-zinc-200" },
  enviado: { label: "Enviado", className: "bg-emerald-50 text-emerald-600 border-emerald-100" },
  falhou: { label: "Falhou", className: "bg-rose-50 text-rose-600 border-rose-100" },
  agendado: { label: "Agendado", className: "bg-amber-50 text-amber-700 border-amber-100" },
  executado: { label: "Executado", className: "bg-emerald-50 text-emerald-600 border-emerald-100" },
  descartado: { label: "Descartado", className: "bg-zinc-100 text-zinc-500 border-zinc-200" },
  rascunho: { label: "Rascunho", className: "bg-zinc-100 text-zinc-600 border-zinc-200" },
  fechado: { label: "Fechado", className: "bg-sky-50 text-sky-700 border-sky-100" },
  analisado: { label: "Analisado", className: "bg-sky-50 text-sky-700 border-sky-100" },
  aguardando_confirmacao: { label: "Aguardando confirmacao", className: "bg-amber-50 text-amber-700 border-amber-100" },
  sincronizado: { label: "Sincronizado", className: "bg-emerald-50 text-emerald-600 border-emerald-100" },
  erro: { label: "Erro", className: "bg-rose-50 text-rose-600 border-rose-100" },
  ativo: { label: "Ativo", className: "bg-emerald-50 text-emerald-600 border-emerald-100" },
  inativo: { label: "Inativo", className: "bg-zinc-100 text-zinc-500 border-zinc-200" },
  ativa: { label: "Ativa", className: "bg-emerald-50 text-emerald-600 border-emerald-100" },
  atrasada: { label: "Atrasada", className: "bg-rose-50 text-rose-600 border-rose-100" },
  quitada: { label: "Quitada", className: "bg-emerald-50 text-emerald-600 border-emerald-100" },
  renegociada: { label: "Renegociada", className: "bg-orange-50 text-orange-600 border-orange-100" },
  alta: { label: "Alta", className: "bg-orange-50 text-orange-600 border-orange-100" },
  media: { label: "Media", className: "bg-amber-50 text-amber-600 border-amber-100" },
  baixa: { label: "Baixa", className: "bg-emerald-50 text-emerald-600 border-emerald-100" },
  healthy: { label: "Saudavel", className: "bg-emerald-50 text-emerald-600 border-emerald-100" },
  attention: { label: "Atencao", className: "bg-amber-50 text-amber-600 border-amber-100" },
  critical: { label: "Critico", className: "bg-rose-50 text-rose-600 border-rose-100" },
  generated: { label: "Gerado", className: "bg-amber-50 text-amber-600 border-amber-100" },
  confirmed: { label: "Confirmado", className: "bg-emerald-50 text-emerald-600 border-emerald-100" },
  executed: { label: "Executado", className: "bg-emerald-50 text-emerald-600 border-emerald-100" },
  PENDING: { label: "Pendente", className: "bg-rose-50 text-rose-600 border-rose-100" },
  RECEIVED: { label: "Recebido", className: "bg-emerald-50 text-emerald-600 border-emerald-100" },
  CONFIRMED: { label: "Confirmado", className: "bg-emerald-50 text-emerald-600 border-emerald-100" },
  OVERDUE: { label: "Vencido", className: "bg-orange-50 text-orange-600 border-orange-100" },
  DELETED: { label: "Cancelado", className: "bg-zinc-100 text-zinc-500 border-zinc-200" },
  ACTIVE: { label: "Ativa", className: "bg-emerald-50 text-emerald-600 border-emerald-100" },
  INACTIVE: { label: "Inativa", className: "bg-zinc-100 text-zinc-500 border-zinc-200" },
  REMOVED: { label: "Removida", className: "bg-zinc-100 text-zinc-500 border-zinc-200" },
  SCHEDULED: { label: "Agendada", className: "bg-amber-50 text-amber-600 border-amber-100" },
  AUTHORIZED: { label: "Autorizada", className: "bg-emerald-50 text-emerald-600 border-emerald-100" },
  ERROR: { label: "Erro", className: "bg-rose-50 text-rose-600 border-rose-100" },
  ready: { label: "Pronto", className: "bg-emerald-50 text-emerald-600 border-emerald-100" },
  setup_required: { label: "Setup pendente", className: "bg-amber-50 text-amber-700 border-amber-100" },
  manual_only: { label: "Manual", className: "bg-zinc-100 text-zinc-600 border-zinc-200" },
  provider_ready: { label: "Provider pronto", className: "bg-emerald-50 text-emerald-600 border-emerald-100" },
  provider_setup_required: { label: "Provider pendente", className: "bg-amber-50 text-amber-700 border-amber-100" },
  outside_window: { label: "Fora da janela", className: "bg-amber-50 text-amber-700 border-amber-100" },
  already_sent: { label: "Ja enviado", className: "bg-sky-50 text-sky-700 border-sky-100" },
  inactive: { label: "Inativa", className: "bg-zinc-100 text-zinc-500 border-zinc-200" },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusMap[status] || { label: status, className: "" };
  return (
    <Badge
      variant="outline"
      className={cn("rounded-full border px-3 py-1 text-xs font-medium", config.className)}
    >
      {config.label}
    </Badge>
  );
}
