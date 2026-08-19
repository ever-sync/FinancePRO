import { StatusBadge } from "@/components/StatusBadge";
import { TablePagination } from "@/components/TablePagination";
import { useTablePagination } from "@/hooks/useTablePagination";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatCurrency, formatPercent } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, Plus, Trash2, TrendingDown } from "lucide-react";
import { useState } from "react";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";

export default function Dividas() {
  const utils = trpc.useUtils();
  const { page, limit, setPage, setLimit } = useTablePagination();
  const { data: items, isLoading } = trpc.debts.list.useQuery({ page, limit });
  const rows = items?.data ?? [];
  const createMut = trpc.debts.create.useMutation({
    onSuccess: () => {
      utils.debts.list.invalidate();
      toast.success("Dívida adicionada");
      setOpen(false);
    },
  });
  const updateMut = trpc.debts.update.useMutation({
    onSuccess: () => {
      utils.debts.list.invalidate();
      toast.success("Atualizado");
    },
  });
  const deleteMut = trpc.debts.delete.useMutation({
    onSuccess: () => {
      utils.debts.list.invalidate();
      toast.success("Removida");
    },
  });
  const [open, setOpen] = useState(false);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createMut.mutate({
      creditor: fd.get("creditor") as string,
      description: fd.get("description") as string,
      originalAmount: (
        parseFloat(fd.get("originalAmount") as string) || 0
      ).toFixed(2),
      currentBalance: (
        parseFloat(fd.get("currentBalance") as string) || 0
      ).toFixed(2),
      monthlyPayment: (
        parseFloat(fd.get("monthlyPayment") as string) || 0
      ).toFixed(2),
      interestRate: (parseFloat(fd.get("interestRate") as string) || 0).toFixed(
        2
      ),
      totalInstallments: parseInt(fd.get("totalInstallments") as string) || 1,
      paidInstallments: parseInt(fd.get("paidInstallments") as string) || 0,
      dueDay: parseInt(fd.get("dueDay") as string) || 1,
      status:
        (fd.get("status") as
          | "ativa"
          | "atrasada"
          | "quitada"
          | "renegociada") || "ativa",
      priority: (fd.get("priority") as "alta" | "media" | "baixa") || "media",
    });
  };

  const payInstallment = (item: (typeof rows)[number]) => {
    const newPaid = item.paidInstallments + 1;
    const newBalance = Math.max(
      parseFloat(item.currentBalance) - parseFloat(item.monthlyPayment),
      0
    );

    updateMut.mutate({
      id: item.id,
      paidInstallments: newPaid,
      currentBalance: newBalance.toFixed(2),
      status: newPaid >= item.totalInstallments ? "quitada" : item.status,
    });
  };

  const openDebts = rows.filter(item => item.status !== "quitada");
  const totalBalance = Number(items?.summary.totalBalance ?? 0);
  const totalMonthly = Number(items?.summary.totalMonthly ?? 0);

  const avalancheOrder = [...openDebts].sort(
    (a, b) => parseFloat(b.interestRate) - parseFloat(a.interestRate)
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Plano de Quitação de Dívidas
          </h1>
          <p className="text-sm text-muted-foreground">
            Organize e elimine suas dívidas com o Método Avalanche
          </p>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-1 h-4 w-4" /> Nova Dívida
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Nova Dívida</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label>Credor</Label>
                  <Input name="creditor" required />
                </div>
                <div>
                  <Label>Descrição</Label>
                  <Input name="description" required />
                </div>
                <div>
                  <Label>Valor Original (R$)</Label>
                  <Input
                    name="originalAmount"
                    type="number"
                    step="0.01"
                    required
                  />
                </div>
                <div>
                  <Label>Saldo Atual (R$)</Label>
                  <Input
                    name="currentBalance"
                    type="number"
                    step="0.01"
                    required
                  />
                </div>
                <div>
                  <Label>Parcela Mensal (R$)</Label>
                  <Input
                    name="monthlyPayment"
                    type="number"
                    step="0.01"
                    required
                  />
                </div>
                <div>
                  <Label>Taxa Juros (% a.m.)</Label>
                  <Input name="interestRate" type="number" step="0.01" />
                </div>
                <div>
                  <Label>Total Parcelas</Label>
                  <Input
                    name="totalInstallments"
                    type="number"
                    min="1"
                    required
                  />
                </div>
                <div>
                  <Label>Parcelas Pagas</Label>
                  <Input
                    name="paidInstallments"
                    type="number"
                    min="0"
                    defaultValue="0"
                  />
                </div>
                <div>
                  <Label>Dia Vencimento</Label>
                  <Input
                    name="dueDay"
                    type="number"
                    min="1"
                    max="31"
                    required
                  />
                </div>
                <div>
                  <Label>Status</Label>
                  <Select name="status" defaultValue="ativa">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ativa">Ativa</SelectItem>
                      <SelectItem value="atrasada">Atrasada</SelectItem>
                      <SelectItem value="renegociada">Renegociada</SelectItem>
                      <SelectItem value="quitada">Quitada</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Prioridade</Label>
                  <Select name="priority" defaultValue="media">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="alta">Alta</SelectItem>
                      <SelectItem value="media">Média</SelectItem>
                      <SelectItem value="baixa">Baixa</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={createMut.isPending}
              >
                {createMut.isPending ? "Salvando..." : "Adicionar"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center justify-between pt-6">
            <div>
              <p className="text-xs uppercase text-muted-foreground">
                Dívida Total
              </p>
              <p className="mt-1 text-2xl font-bold text-destructive">
                {formatCurrency(totalBalance)}
              </p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/10">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase text-muted-foreground">
              Parcelas Mensais
            </p>
            <p className="mt-1 text-2xl font-bold">
              {formatCurrency(totalMonthly)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase text-muted-foreground">
              Dívidas em Aberto
            </p>
            <p className="mt-1 text-2xl font-bold">
              {items?.summary.openCount ?? 0}
            </p>
          </CardContent>
        </Card>
      </div>

      {avalancheOrder.length > 0 && (
        <Card className="border-chart-3/30 bg-chart-3/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <TrendingDown className="h-4 w-4" /> Método Avalanche - Ordem de
              Prioridade
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-muted-foreground">
              Pague primeiro as dívidas com maior taxa de juros para economizar
              mais no longo prazo.
            </p>
            <div className="space-y-3">
              {avalancheOrder.map((debt, i) => {
                const progress =
                  debt.totalInstallments > 0
                    ? (debt.paidInstallments / debt.totalInstallments) * 100
                    : 0;
                return (
                  <div key={debt.id} className="flex items-center gap-4">
                    <span className="w-6 text-lg font-bold text-muted-foreground">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="truncate text-sm font-medium">
                          {debt.creditor} - {debt.description}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatPercent(debt.interestRate)} a.m.
                        </span>
                      </div>
                      <Progress value={progress} className="h-2" />
                      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                        <span>
                          {debt.paidInstallments}/{debt.totalInstallments}{" "}
                          parcelas
                        </span>
                        <span>
                          Saldo: {formatCurrency(debt.currentBalance)}
                        </span>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => payInstallment(debt)}
                      disabled={updateMut.isPending}
                    >
                      Pagar Parcela
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Credor</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="text-right">Original</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
                <TableHead className="text-right">Parcela</TableHead>
                <TableHead>Juros</TableHead>
                <TableHead>Progresso</TableHead>
                <TableHead>Prioridade</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[60px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={10}
                    className="py-8 text-center text-muted-foreground"
                  >
                    Carregando...
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={10}
                    className="py-8 text-center text-muted-foreground"
                  >
                    Nenhuma dívida cadastrada
                  </TableCell>
                </TableRow>
              ) : (
                rows.map(item => (
                  <TableRow
                    key={item.id}
                    className={cn(
                      item.status === "quitada" && "opacity-50",
                      item.status === "atrasada" && "bg-rose-50/50"
                    )}
                  >
                    <TableCell className="font-medium">
                      {item.creditor}
                    </TableCell>
                    <TableCell>{item.description}</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(item.originalAmount)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(item.currentBalance)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(item.monthlyPayment)}
                    </TableCell>
                    <TableCell>{formatPercent(item.interestRate)}</TableCell>
                    <TableCell>
                      {item.paidInstallments}/{item.totalInstallments}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={item.priority} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={item.status} />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => deleteMut.mutate({ id: item.id })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <TablePagination
            pagination={items?.pagination}
            onPageChange={setPage}
            onPageSizeChange={setLimit}
          />
        </CardContent>
      </Card>
    </div>
  );
}
