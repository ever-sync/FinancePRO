import { trpc } from "@/lib/trpc";
import { useMonthYear } from "@/hooks/useMonthYear";
import { MonthSelector } from "@/components/MonthSelector";
import { TablePagination } from "@/components/TablePagination";
import { StatusBadge } from "@/components/StatusBadge";
import { useTablePagination } from "@/hooks/useTablePagination";
import { formatCurrency, formatDate } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
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
  "Aluguel",
  "Contador",
  "Internet",
  "Telefone",
  "Software/SaaS",
  "Energia",
  "Água",
  "Seguro",
  "Marketing",
  "Taxas Bancárias",
  "Outros",
];

export default function CustosFixos() {
  const { month, year, monthName, goToPrevMonth, goToNextMonth } =
    useMonthYear();
  const utils = trpc.useUtils();
  const { page, limit, setPage, setLimit } = useTablePagination(
    `${year}-${month}`
  );
  const { data: items, isLoading } = trpc.companyFixedCosts.list.useQuery({
    month,
    year,
    page,
    limit,
  });
  const rows = items?.data ?? [];
  const createMut = trpc.companyFixedCosts.create.useMutation({
    onSuccess: () => {
      utils.companyFixedCosts.list.invalidate();
      toast.success("Custo adicionado");
      setOpen(false);
    },
  });
  const updateMut = trpc.companyFixedCosts.update.useMutation({
    onSuccess: () => {
      utils.companyFixedCosts.list.invalidate();
      toast.success("Atualizado");
    },
  });
  const deleteMut = trpc.companyFixedCosts.delete.useMutation({
    onSuccess: () => {
      utils.companyFixedCosts.list.invalidate();
      toast.success("Removido");
    },
  });
  const [open, setOpen] = useState(false);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createMut.mutate({
      description: fd.get("description") as string,
      category: fd.get("category") as string,
      amount: (parseFloat(fd.get("amount") as string) || 0).toFixed(2),
      dueDay: parseInt(fd.get("dueDay") as string) || 1,
      month,
      year,
    });
  };

  const toggleStatus = (item: (typeof rows)[number]) => {
    const next = item.status === "pago" ? "pendente" : "pago";
    updateMut.mutate({ id: item.id, status: next });
  };

  const total = Number(items?.summary.totalAmount ?? 0);
  const totalPaid = Number(items?.summary.paidAmount ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Custos Fixos - Empresa
          </h1>
          <p className="text-sm text-muted-foreground">
            Despesas recorrentes mensais da empresa
          </p>
        </div>
        <div className="flex items-center gap-3">
          <MonthSelector
            monthName={monthName}
            year={year}
            onPrev={goToPrevMonth}
            onNext={goToNextMonth}
          />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" /> Novo Custo
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Novo Custo Fixo</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <Label>Descrição</Label>
                    <Input name="description" required />
                  </div>
                  <div>
                    <Label>Categoria</Label>
                    <Select name="category" required>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map(c => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Valor (R$)</Label>
                    <Input name="amount" type="number" step="0.01" required />
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground uppercase">
              Total Mensal
            </p>
            <p className="text-xl font-bold mt-1">{formatCurrency(total)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground uppercase">Pago</p>
            <p className="text-xl font-bold mt-1 text-primary">
              {formatCurrency(totalPaid)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Descrição</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Dia Venc.</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[60px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center py-8 text-muted-foreground"
                  >
                    Carregando...
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center py-8 text-muted-foreground"
                  >
                    Nenhum custo fixo neste mês
                  </TableCell>
                </TableRow>
              ) : (
                rows.map(item => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      {item.description}
                    </TableCell>
                    <TableCell>{item.category}</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(item.amount)}
                    </TableCell>
                    <TableCell>Dia {item.dueDay}</TableCell>
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
