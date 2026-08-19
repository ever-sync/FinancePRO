import { trpc } from "@/lib/trpc";
import { StatusBadge } from "@/components/StatusBadge";
import { TablePagination } from "@/components/TablePagination";
import { useTablePagination } from "@/hooks/useTablePagination";
import { formatCurrency } from "@/lib/format";
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
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Pencil, Users, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type ContractType = "clt" | "pj";

interface FormState {
  name: string;
  role: string;
  salary: string;
  paymentDay: string;
  admissionDate: string;
  contractType: ContractType;
  status: string;
}

const EMPTY: FormState = {
  name: "",
  role: "",
  salary: "",
  paymentDay: "5",
  admissionDate: "",
  contractType: "clt",
  status: "ativo",
};

export default function Funcionarios() {
  const utils = trpc.useUtils();
  const { page, limit, setPage, setLimit } = useTablePagination();
  const { data: items, isLoading } = trpc.employees.list.useQuery({
    page,
    limit,
  });
  const rows = items?.data ?? [];
  const createMut = trpc.employees.create.useMutation({
    onSuccess: () => {
      utils.employees.list.invalidate();
      toast.success("Funcionário adicionado");
      closeDialog();
    },
  });
  const updateMut = trpc.employees.update.useMutation({
    onSuccess: () => {
      utils.employees.list.invalidate();
      toast.success("Funcionário atualizado");
      closeDialog();
    },
  });
  const deleteMut = trpc.employees.delete.useMutation({
    onSuccess: () => {
      utils.employees.list.invalidate();
      toast.success("Removido");
    },
  });

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);

  const set = (field: keyof FormState, val: string) =>
    setForm(prev => ({ ...prev, [field]: val }));

  const closeDialog = () => {
    setOpen(false);
    setEditingId(null);
    setForm(EMPTY);
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY);
    setOpen(true);
  };

  const openEdit = (item: (typeof rows)[number]) => {
    setEditingId(item.id);
    setForm({
      name: item.name,
      role: item.role,
      salary: parseFloat(item.salary).toFixed(2),
      paymentDay: String(item.paymentDay ?? 5),
      admissionDate: item.admissionDate ?? "",
      contractType: item.contractType as ContractType,
      status: item.status,
    });
    setOpen(true);
  };

  const salaryNum = parseFloat(form.salary) || 0;
  const isCLT = form.contractType === "clt";
  const fgts = isCLT ? salaryNum * 0.08 : 0;
  const thirteenth = isCLT ? salaryNum / 12 : 0;
  const vacation = isCLT ? (salaryNum * 1.3333) / 12 : 0;
  const totalCost = isCLT
    ? salaryNum + fgts + thirteenth + vacation
    : salaryNum;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      name: form.name,
      role: form.role,
      contractType: form.contractType,
      salary: salaryNum.toFixed(2),
      fgtsAmount: fgts.toFixed(2),
      thirteenthProvision: thirteenth.toFixed(2),
      vacationProvision: vacation.toFixed(2),
      totalCost: totalCost.toFixed(2),
      paymentDay: parseInt(form.paymentDay) || 5,
      admissionDate: form.admissionDate || undefined,
    };

    if (editingId !== null) {
      updateMut.mutate({
        id: editingId,
        ...payload,
        status: form.status as any,
      });
    } else {
      createMut.mutate(payload);
    }
  };

  const toggleStatus = (item: (typeof rows)[number]) => {
    updateMut.mutate({
      id: item.id,
      status: item.status === "ativo" ? "inativo" : "ativo",
    });
  };

  const isPending = createMut.isPending || updateMut.isPending;
  const activeEmployeeCount = items?.summary.activeCount ?? 0;
  const totalPayroll = Number(items?.summary.totalActiveCost ?? 0);
  const totalSalaries = Number(items?.summary.totalActiveSalary ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Funcionários</h1>
          <p className="text-sm text-muted-foreground">
            Folha de pagamento com cálculos automáticos de encargos
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1 h-4 w-4" /> Novo Funcionário
        </Button>
      </div>

      {/* ── Dialog ── */}
      <Dialog open={open} onOpenChange={v => !v && closeDialog()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingId !== null ? "Editar Funcionário" : "Novo Funcionário"}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            {/* Tipo de Contrato */}
            <div>
              <Label>Tipo de Contrato</Label>
              <div className="mt-1 flex gap-2">
                {(["clt", "pj"] as ContractType[]).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => set("contractType", t)}
                    className={`flex-1 rounded-md border py-2 text-sm font-medium transition-colors ${
                      form.contractType === t
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    {t === "clt" ? "CLT" : "PJ / CNPJ"}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <Label>Nome</Label>
                <Input
                  value={form.name}
                  onChange={e => set("name", e.target.value)}
                  required
                />
              </div>
              <div>
                <Label>Cargo</Label>
                <Input
                  value={form.role}
                  onChange={e => set("role", e.target.value)}
                  required
                />
              </div>
              <div>
                <Label>
                  {isCLT ? "Salário (R$)" : "Valor do Contrato (R$)"}
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.salary}
                  onChange={e => set("salary", e.target.value)}
                  required
                />
              </div>
              <div>
                <Label>Dia do Pagamento</Label>
                <Input
                  type="number"
                  min="1"
                  max="31"
                  value={form.paymentDay}
                  onChange={e => set("paymentDay", e.target.value)}
                  required
                />
              </div>
              <div>
                <Label>Data Admissão</Label>
                <Input
                  type="date"
                  value={form.admissionDate}
                  onChange={e => set("admissionDate", e.target.value)}
                />
              </div>
              {/* Status — só na edição */}
              {editingId !== null && (
                <div className="md:col-span-2">
                  <Label>Status</Label>
                  <Select
                    value={form.status}
                    onValueChange={v => set("status", v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ativo">Ativo</SelectItem>
                      <SelectItem value="inativo">Inativo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* Cálculo automático */}
            {salaryNum > 0 && (
              <Card className="bg-muted/50">
                <CardContent className="pb-4 pt-4">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    {isCLT ? "Cálculo Automático (CLT)" : "Resumo PJ"}
                  </p>
                  {isCLT ? (
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <span className="text-muted-foreground">FGTS (8%):</span>
                      <span className="text-right">{formatCurrency(fgts)}</span>
                      <span className="text-muted-foreground">
                        Provisão 13º:
                      </span>
                      <span className="text-right">
                        {formatCurrency(thirteenth)}
                      </span>
                      <span className="text-muted-foreground">
                        Provisão Férias:
                      </span>
                      <span className="text-right">
                        {formatCurrency(vacation)}
                      </span>
                      <span className="border-t pt-1 font-medium">
                        Custo Total:
                      </span>
                      <span className="border-t pt-1 text-right font-bold text-primary">
                        {formatCurrency(totalCost)}
                      </span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <span className="text-muted-foreground">
                        Sem FGTS / encargos
                      </span>
                      <span className="text-right text-muted-foreground">
                        -
                      </span>
                      <span className="border-t pt-1 font-medium">
                        Valor do Contrato:
                      </span>
                      <span className="border-t pt-1 text-right font-bold text-primary">
                        {formatCurrency(salaryNum)}
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={closeDialog}
              >
                Cancelar
              </Button>
              <Button type="submit" className="flex-1" disabled={isPending}>
                {isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Salvando...
                  </>
                ) : editingId !== null ? (
                  "Salvar alterações"
                ) : (
                  "Adicionar"
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Cards resumo */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center justify-between pt-6">
            <div>
              <p className="text-xs uppercase text-muted-foreground">
                Funcionários Ativos
              </p>
              <p className="mt-1 text-xl font-bold">{activeEmployeeCount}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <Users className="h-5 w-5 text-primary" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase text-muted-foreground">
              Total Salários / Contratos
            </p>
            <p className="mt-1 text-xl font-bold">
              {formatCurrency(totalSalaries)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase text-muted-foreground">
              Custo Total Folha
            </p>
            <p className="mt-1 text-xl font-bold text-destructive">
              {formatCurrency(totalPayroll)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabela */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Cargo</TableHead>
                <TableHead>Contrato</TableHead>
                <TableHead>Pagamento</TableHead>
                <TableHead className="text-right">Salário / Contrato</TableHead>
                <TableHead className="text-right">FGTS</TableHead>
                <TableHead className="text-right">13º Prov.</TableHead>
                <TableHead className="text-right">Férias Prov.</TableHead>
                <TableHead className="text-right">Custo Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[90px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={11}
                    className="py-8 text-center text-muted-foreground"
                  >
                    Carregando...
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={11}
                    className="py-8 text-center text-muted-foreground"
                  >
                    Nenhum funcionário cadastrado
                  </TableCell>
                </TableRow>
              ) : (
                rows.map(item => (
                  <TableRow
                    key={item.id}
                    className={item.status === "inativo" ? "opacity-50" : ""}
                  >
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>{item.role}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          item.contractType === "pj" ? "outline" : "secondary"
                        }
                        className="text-xs"
                      >
                        {item.contractType === "pj" ? "PJ" : "CLT"}
                      </Badge>
                    </TableCell>
                    <TableCell>Dia {item.paymentDay || 5}</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(item.salary)}
                    </TableCell>
                    <TableCell className="text-right">
                      {item.contractType === "pj" ? (
                        <span className="text-muted-foreground">-</span>
                      ) : (
                        formatCurrency(item.fgtsAmount)
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {item.contractType === "pj" ? (
                        <span className="text-muted-foreground">-</span>
                      ) : (
                        formatCurrency(item.thirteenthProvision)
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {item.contractType === "pj" ? (
                        <span className="text-muted-foreground">-</span>
                      ) : (
                        formatCurrency(item.vacationProvision)
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(item.totalCost)}
                    </TableCell>
                    <TableCell>
                      <button onClick={() => toggleStatus(item)}>
                        <StatusBadge status={item.status} />
                      </button>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEdit(item)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => deleteMut.mutate({ id: item.id })}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
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
