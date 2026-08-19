import { trpc } from "@/lib/trpc";
import { useMonthYear } from "@/hooks/useMonthYear";
import { MonthSelector } from "@/components/MonthSelector";
import { TablePagination } from "@/components/TablePagination";
import { StatusBadge } from "@/components/StatusBadge";
import { useTablePagination } from "@/hooks/useTablePagination";
import { formatCurrency, formatDate } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const categories = [
  "Material",
  "Transporte",
  "Alimentacao",
  "Manutencao",
  "Combustivel",
  "Frete",
  "Comissao",
  "Outros",
];

export default function CustosVariaveis() {
  const { month, year, monthName, goToPrevMonth, goToNextMonth } =
    useMonthYear();
  const utils = trpc.useUtils();
  const { page, limit, setPage, setLimit } = useTablePagination(
    `${year}-${month}`
  );
  const { data: items, isLoading } = trpc.companyVariableCosts.list.useQuery({
    month,
    year,
    page,
    limit,
  });
  const [open, setOpen] = useState(false);
  const [installmentMode, setInstallmentMode] = useState(false);
  const rows = items?.data ?? [];

  const createMut = trpc.companyVariableCosts.create.useMutation({
    onSuccess: () => {
      utils.companyVariableCosts.list.invalidate();
      utils.dashboard.company.invalidate();
      utils.calendar.data.invalidate();
      toast.success("Custo adicionado");
      setOpen(false);
      setInstallmentMode(false);
    },
  });
  const updateMut = trpc.companyVariableCosts.update.useMutation({
    onSuccess: () => {
      utils.companyVariableCosts.list.invalidate();
      utils.dashboard.company.invalidate();
      utils.calendar.data.invalidate();
    },
  });
  const deleteMut = trpc.companyVariableCosts.delete.useMutation({
    onSuccess: () => {
      utils.companyVariableCosts.list.invalidate();
      utils.dashboard.company.invalidate();
      utils.calendar.data.invalidate();
      toast.success("Removido");
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const installmentCount = installmentMode
      ? Math.max(2, parseInt(fd.get("installmentCount") as string) || 2)
      : 1;

    createMut.mutate({
      description: fd.get("description") as string,
      category: fd.get("category") as string,
      amount: (parseFloat(fd.get("amount") as string) || 0).toFixed(2),
      date: fd.get("date") as string,
      supplier: (fd.get("supplier") as string) || undefined,
      installmentCount,
    });
  };

  const toggleStatus = (item: (typeof rows)[number]) => {
    const next = item.status === "pago" ? "pendente" : "pago";
    updateMut.mutate({ id: item.id, status: next });
  };

  const total = Number(items?.summary.totalAmount ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Custos Variaveis - Empresa
          </h1>
          <p className="text-sm text-muted-foreground">
            Despesas pontuais, parceladas e variaveis da empresa
          </p>
        </div>
        <div className="flex items-center gap-3">
          <MonthSelector
            monthName={monthName}
            year={year}
            onPrev={goToPrevMonth}
            onNext={goToNextMonth}
          />
          <Dialog
            open={open}
            onOpenChange={next => {
              setOpen(next);
              if (!next) setInstallmentMode(false);
            }}
          >
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-1 h-4 w-4" /> Novo Custo
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Novo Custo Variavel</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <Label>Descricao</Label>
                    <Input name="description" required />
                  </div>
                  <div>
                    <Label>Categoria</Label>
                    <Select name="category" required>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map(category => (
                          <SelectItem key={category} value={category}>
                            {category}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>
                      {installmentMode ? "Valor total (R$)" : "Valor (R$)"}
                    </Label>
                    <Input name="amount" type="number" step="0.01" required />
                  </div>
                  <div>
                    <Label>Data da 1a parcela</Label>
                    <Input name="date" type="date" required />
                  </div>
                  <div className="md:col-span-2 rounded-2xl border border-zinc-200 bg-zinc-50/80 px-4 py-3">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-zinc-900">
                          Compra parcelada
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Cada parcela sera lancada no mes correspondente.
                        </p>
                      </div>
                      <Switch
                        checked={installmentMode}
                        onCheckedChange={setInstallmentMode}
                      />
                    </div>
                  </div>
                  {installmentMode ? (
                    <div>
                      <Label>N de parcelas</Label>
                      <Input
                        name="installmentCount"
                        type="number"
                        min="2"
                        max="120"
                        defaultValue={2}
                        required
                      />
                    </div>
                  ) : null}
                  <div>
                    <Label>Fornecedor</Label>
                    <Input name="supplier" />
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
      </div>

      <Card>
        <CardContent className="pt-6">
          <p className="text-xs uppercase text-muted-foreground">
            Total do Mes
          </p>
          <p className="mt-1 text-xl font-bold">{formatCurrency(total)}</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Descricao</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Fornecedor</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Data</TableHead>
                <TableHead className="text-center">Parcelas</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[60px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-8 text-center text-muted-foreground"
                  >
                    Carregando...
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-8 text-center text-muted-foreground"
                  >
                    Nenhum custo variavel neste mes
                  </TableCell>
                </TableRow>
              ) : (
                rows.map(item => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      <div>{item.description}</div>
                      {item.installmentCount > 1 ? (
                        <p className="text-xs text-muted-foreground">
                          Compra parcelada
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>{item.category}</TableCell>
                    <TableCell>{item.supplier || "-"}</TableCell>
                    <TableCell className="text-right">
                      <div className="font-medium">
                        {formatCurrency(item.amount)}
                      </div>
                      {item.installmentCount > 1 ? (
                        <p className="text-xs text-muted-foreground">
                          Total estimado{" "}
                          {formatCurrency(
                            Number(item.amount) * item.installmentCount
                          )}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>{formatDate(item.date)}</TableCell>
                    <TableCell className="text-center">
                      {item.installmentCount > 1 ? (
                        <Badge
                          variant="outline"
                          className="rounded-full border-orange-100 bg-orange-50 text-orange-600"
                        >
                          {item.installmentNumber}/{item.installmentCount}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <button onClick={() => toggleStatus(item)}>
                        <StatusBadge status={item.status} />
                      </button>
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
