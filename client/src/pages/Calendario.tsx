import { MonthSelector } from "@/components/MonthSelector";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCurrency } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, CalendarDays } from "lucide-react";
import { useMonthYear } from "@/hooks/useMonthYear";

interface PaymentItem {
  id: string;
  description: string;
  amount: string;
  dueDay: number;
  status: string;
  type: string;
}

export default function Calendario() {
  const { month, year, monthName, goToPrevMonth, goToNextMonth } =
    useMonthYear();
  const { data: calendarItems = [] } = trpc.calendar.data.useQuery({
    month,
    year,
  });

  const today = new Date().getDate();
  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();
  const isCurrentMonth = month === currentMonth && year === currentYear;
  const payments: PaymentItem[] = calendarItems.map((item, index) => ({
    id: `${item.sourceType ?? item.type}-${item.sourceId ?? index}`,
    description: item.description,
    amount: item.amount,
    dueDay: item.day,
    status: item.status,
    type: item.type,
  }));

  const totalMonth = payments.reduce(
    (sum, payment) => sum + parseFloat(payment.amount),
    0
  );
  const totalPending = payments
    .filter(payment => payment.status !== "pago")
    .reduce((sum, payment) => sum + parseFloat(payment.amount), 0);
  const overdue = isCurrentMonth
    ? payments.filter(
        payment => payment.status !== "pago" && payment.dueDay < today
      )
    : [];

  const grouped: Record<number, PaymentItem[]> = {};
  payments.forEach(payment => {
    if (!grouped[payment.dueDay]) grouped[payment.dueDay] = [];
    grouped[payment.dueDay].push(payment);
  });

  const typeColor = (type: string) => {
    switch (type) {
      case "empresa-fixo":
      case "empresa-variavel":
        return "bg-primary/10 text-primary";
      case "empresa-folha":
        return "bg-blue-50 text-blue-600";
      case "pessoal-fixo":
      case "pessoal-variavel":
        return "bg-chart-2/10 text-chart-2";
      case "divida":
        return "bg-destructive/10 text-destructive";
      case "fornecedor":
        return "bg-chart-3/10 text-chart-3";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Calendário de Pagamentos
          </h1>
          <p className="text-sm text-muted-foreground">
            Visão mensal de todos os compromissos financeiros
          </p>
        </div>
        <MonthSelector
          monthName={monthName}
          year={year}
          onPrev={goToPrevMonth}
          onNext={goToNextMonth}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase text-muted-foreground">
              Total do Mês
            </p>
            <p className="mt-1 text-xl font-bold">
              {formatCurrency(totalMonth)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase text-muted-foreground">Pendente</p>
            <p className="mt-1 text-xl font-bold text-chart-3">
              {formatCurrency(totalPending)}
            </p>
          </CardContent>
        </Card>
        <Card className={overdue.length > 0 ? "border-destructive/30" : ""}>
          <CardContent className="flex items-center justify-between pt-6">
            <div>
              <p className="text-xs uppercase text-muted-foreground">
                Atrasados
              </p>
              <p className="mt-1 text-xl font-bold text-destructive">
                {overdue.length}
              </p>
            </div>
            {overdue.length > 0 && (
              <AlertTriangle className="h-5 w-5 text-destructive" />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-3 text-xs">
        <span className="flex items-center gap-1">
          <span className="h-3 w-3 rounded bg-primary/30" /> Empresa
        </span>
        <span className="flex items-center gap-1">
          <span className="h-3 w-3 rounded bg-blue-300" /> Folha
        </span>
        <span className="flex items-center gap-1">
          <span className="h-3 w-3 rounded bg-chart-2/30" /> Pessoal
        </span>
        <span className="flex items-center gap-1">
          <span className="h-3 w-3 rounded bg-destructive/30" /> Dívida
        </span>
        <span className="flex items-center gap-1">
          <span className="h-3 w-3 rounded bg-chart-3/30" /> Fornecedor
        </span>
      </div>

      <div className="space-y-3">
        {Object.entries(grouped)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([day, items]) => {
            const dayNum = Number(day);
            const isPast = isCurrentMonth && dayNum < today;
            const isToday = isCurrentMonth && dayNum === today;
            const dayTotal = items.reduce(
              (sum, item) => sum + parseFloat(item.amount),
              0
            );

            return (
              <Card
                key={day}
                className={`${isToday ? "border-primary ring-1 ring-primary/20" : ""} ${isPast ? "opacity-60" : ""}`}
              >
                <CardContent className="px-4 py-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold ${isToday ? "bg-primary text-primary-foreground" : "bg-muted"}`}
                      >
                        {day}
                      </div>
                      <span className="text-sm font-medium">
                        {isToday ? "Hoje" : `Dia ${day}`}
                      </span>
                    </div>
                    <span className="text-sm font-bold">
                      {formatCurrency(dayTotal)}
                    </span>
                  </div>
                  <div className="ml-10 space-y-1.5">
                    {items.map(item => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between text-sm"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] ${typeColor(item.type)}`}
                          >
                            {item.type.includes("empresa")
                              ? "EMP"
                              : item.type === "divida"
                                ? "DIV"
                                : "PES"}
                          </span>
                          <span className="max-w-[200px] truncate sm:max-w-none">
                            {item.description.replace(
                              /^\[(EMP|PES|DIV)\]\s*/,
                              ""
                            )}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-xs">
                            {formatCurrency(item.amount)}
                          </span>
                          <StatusBadge status={item.status} />
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}

        {payments.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <CalendarDays className="mx-auto mb-3 h-12 w-12 opacity-30" />
              <p>Nenhum pagamento agendado para este mês</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
