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
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Trash2, Pencil, Loader2, Link2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const categories = [
  "Serviço",
  "Produto",
  "Consultoria",
  "Projeto",
  "Comissão",
  "Outros",
];

interface FormState {
  description: string;
  category: string;
  grossAmount: string;
  client: string;
  dueDate: string;
  status: string;
}
const EMPTY: FormState = {
  description: "",
  category: "",
  grossAmount: "",
  client: "",
  dueDate: "",
  status: "pendente",
};

function buildRecurrenceDates(startDate: string, recurrence: string): string[] {
  if (!startDate || recurrence === "unico") return [startDate];
  const cfg: Record<string, { count: number; step: number }> = {
    pacote3: { count: 3, step: 1 },
    mensal: { count: 12, step: 1 },
    trimestral: { count: 4, step: 3 },
    semestral: { count: 2, step: 6 },
  };
  const { count, step } = cfg[recurrence] ?? { count: 1, step: 1 };
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(startDate + "T12:00:00");
    d.setMonth(d.getMonth() + i * step);
    return d.toISOString().split("T")[0];
  });
}

export default function Receitas() {
  const { month, year, monthName, goToPrevMonth, goToNextMonth } =
    useMonthYear();
  const utils = trpc.useUtils();
  const { page, limit, setPage, setLimit } = useTablePagination(
    `${year}-${month}`
  );
  const { data: items, isLoading } = trpc.revenues.list.useQuery({
    month,
    year,
    page,
    limit,
  });
  const rows = items?.data ?? [];
  const { data: settings } = trpc.settings.get.useQuery();
  const { data: clientsData } = trpc.clients.list.useQuery({
    page: 1,
    limit: 100,
  });
  const { data: servicesData } = trpc.services.list.useQuery({
    page: 1,
    limit: 100,
  });
  const clients = clientsData?.data ?? [];
  const services = servicesData?.data ?? [];

  const createMutation = trpc.revenues.create.useMutation();
  const updateMutation = trpc.revenues.update.useMutation({
    onSuccess: () => {
      utils.revenues.list.invalidate();
      toast.success("Receita atualizada");
      closeDialog();
    },
  });
  const updateSeriesMut = trpc.revenues.updateSeries.useMutation({
    onSuccess: () => {
      utils.revenues.list.invalidate();
      toast.success("Toda a série atualizada");
      closeDialog();
      setSeriesEditDialog(null);
    },
  });
  const deleteMutation = trpc.revenues.delete.useMutation({
    onSuccess: () => {
      utils.revenues.list.invalidate();
      toast.success("Receita removida");
      setDeleteDialog(null);
    },
    onError: error => toast.error(error.message),
  });
  const deleteSeriesMut = trpc.revenues.deleteSeries.useMutation({
    onSuccess: () => {
      utils.revenues.list.invalidate();
      toast.success("Série removida");
      setDeleteDialog(null);
    },
    onError: error => toast.error(error.message),
  });

  // ── form state ──
  const [open, setOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<(typeof rows)[number] | null>(
    null
  );
  const [form, setForm] = useState<FormState>(EMPTY);
  const [selectedService, setSelectedService] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [recurrence, setRecurrence] = useState("unico");
  const [submitting, setSubmitting] = useState(false);

  // ── series dialogs ──
  const [deleteDialog, setDeleteDialog] = useState<
    (typeof rows)[number] | null
  >(null);
  const [seriesEditDialog, setSeriesEditDialog] = useState<{
    payload: Parameters<typeof updateMutation.mutate>[0];
    seriesId: string;
  } | null>(null);

  const taxRate = parseFloat(settings?.taxPercent || "6") / 100;

  const closeDialog = () => {
    setOpen(false);
    setEditingItem(null);
    setForm(EMPTY);
    setSelectedService("");
    setQuantity("1");
    setRecurrence("unico");
  };

  const openCreate = () => {
    setEditingItem(null);
    setForm(EMPTY);
    setSelectedService("");
    setQuantity("1");
    setRecurrence("unico");
    setOpen(true);
  };

  const openEdit = (item: (typeof rows)[number]) => {
    setEditingItem(item);
    setForm({
      description: item.description,
      category: item.category,
      grossAmount: parseFloat(item.grossAmount).toFixed(2),
      client: item.client ?? "",
      dueDate: item.dueDate,
      status: item.status,
    });
    setSelectedService("");
    setQuantity("1");
    setRecurrence("unico");
    setOpen(true);
  };

  const set = (field: keyof FormState, val: string) =>
    setForm(prev => ({ ...prev, [field]: val }));

  const selectedSvc = services.find(s => String(s.id) === selectedService);
  const isHourly = selectedSvc?.unit === "hora";

  const handleServiceChange = (val: string) => {
    setSelectedService(val);
    setQuantity("1");
    if (val === "__none__") {
      setSelectedService("");
      return;
    }
    const svc = services.find(s => String(s.id) === val);
    if (svc) {
      setForm(prev => ({
        ...prev,
        description: svc.name,
        grossAmount: parseFloat(svc.basePrice).toFixed(2),
        category: prev.category || "Serviço",
      }));
      setRecurrence(svc.recurrence ?? "unico");
    }
  };

  const handleQuantityChange = (val: string) => {
    setQuantity(val);
    if (selectedSvc && val)
      setForm(prev => ({
        ...prev,
        grossAmount: (
          parseFloat(selectedSvc.basePrice) * (parseFloat(val) || 0)
        ).toFixed(2),
      }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const gross = parseFloat(form.grossAmount) || 0;
    const tax = gross * taxRate;
    const net = gross - tax;
    const client =
      form.client && form.client !== "__none__" ? form.client : undefined;

    // ── EDIÇÃO ──
    if (editingItem !== null) {
      const payload = {
        id: editingItem.id,
        description: form.description,
        category: form.category,
        grossAmount: gross.toFixed(2),
        taxAmount: tax.toFixed(2),
        netAmount: net.toFixed(2),
        client: client ?? null,
        dueDate: form.dueDate,
        status: form.status as any,
      };
      // Se pertence a uma série, perguntar o escopo
      if (editingItem.seriesId) {
        setSeriesEditDialog({ payload, seriesId: editingItem.seriesId });
        return;
      }
      updateMutation.mutate(payload);
      return;
    }

    // ── CRIAÇÃO com recorrência ──
    const dates = buildRecurrenceDates(form.dueDate, recurrence);
    const seriesId = dates.length > 1 ? crypto.randomUUID() : undefined;
    setSubmitting(true);
    try {
      await Promise.all(
        dates.map(dueDate =>
          createMutation.mutateAsync({
            description: form.description,
            category: form.category,
            grossAmount: gross.toFixed(2),
            taxAmount: tax.toFixed(2),
            netAmount: net.toFixed(2),
            client,
            dueDate,
            status: "pendente",
            seriesId,
          })
        )
      );
      utils.revenues.list.invalidate();
      toast.success(
        dates.length > 1
          ? `${dates.length} receitas criadas e vinculadas`
          : "Receita adicionada"
      );
      closeDialog();
    } catch {
      toast.error("Erro ao salvar");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (item: (typeof rows)[number]) => {
    setDeleteDialog(item);
  };

  const toggleStatus = (item: (typeof rows)[number]) => {
    const next =
      item.status === "recebido"
        ? "pendente"
        : item.status === "cancelado"
          ? "pendente"
          : "recebido";
    updateMutation.mutate({
      id: item.id,
      status: next,
      receivedDate:
        next === "recebido" ? new Date().toISOString().split("T")[0] : null,
    });
  };

  const isPending =
    submitting || updateMutation.isPending || updateSeriesMut.isPending;
  const gross = parseFloat(form.grossAmount) || 0;
  const totalGross = Number(items?.summary.totalGross ?? 0);
  const totalNet = Number(items?.summary.totalNet ?? 0);
  const totalReceived = Number(items?.summary.totalReceived ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Receitas</h1>
          <p className="text-sm text-muted-foreground">
            Faturamento da empresa (imposto de {(taxRate * 100).toFixed(0)}%
            calculado automaticamente)
          </p>
        </div>
        <div className="flex items-center gap-3">
          <MonthSelector
            monthName={monthName}
            year={year}
            onPrev={goToPrevMonth}
            onNext={goToNextMonth}
          />
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" /> Nova Receita
          </Button>
        </div>
      </div>

      {/* ────── Dialog cadastro/edição ────── */}
      <Dialog open={open} onOpenChange={v => !v && closeDialog()}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingItem ? "Editar Receita" : "Nova Receita"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            {!editingItem && (
              <div className="space-y-1">
                <Label>Serviço</Label>
                <Select
                  value={selectedService}
                  onValueChange={handleServiceChange}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecionar serviço..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Sem serviço</SelectItem>
                    {services
                      .filter(s => s.status === "ativo")
                      .map(s => (
                        <SelectItem key={s.id} value={String(s.id)}>
                          {s.name} — {formatCurrency(s.basePrice)}/{s.unit}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {!editingItem && isHourly && (
              <div className="space-y-1">
                <Label>Horas neste mês</Label>
                <div className="flex items-center gap-3">
                  <Input
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={quantity}
                    onChange={e => handleQuantityChange(e.target.value)}
                    className="w-32"
                  />
                  <span className="text-sm text-muted-foreground">
                    × {formatCurrency(selectedSvc!.basePrice)}/h ={" "}
                    <span className="font-medium text-foreground">
                      {formatCurrency(gross)}
                    </span>
                  </span>
                </div>
              </div>
            )}

            <div className="space-y-1">
              <Label>Descrição</Label>
              <Input
                value={form.description}
                onChange={e => set("description", e.target.value)}
                required
              />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Categoria</Label>
                <Select
                  value={form.category}
                  onValueChange={v => set("category", v)}
                  required
                >
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
              <div className="space-y-1">
                <Label>Valor Bruto (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.grossAmount}
                  onChange={e => set("grossAmount", e.target.value)}
                  disabled={isHourly && !editingItem}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label>Cliente</Label>
                <Select
                  value={form.client || "__none__"}
                  onValueChange={v => set("client", v === "__none__" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecionar cliente..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Sem cliente</SelectItem>
                    {clients.map(c => (
                      <SelectItem key={c.id} value={c.name}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Data Vencimento</Label>
                <Input
                  type="date"
                  value={form.dueDate}
                  onChange={e => set("dueDate", e.target.value)}
                  required
                />
              </div>
              {editingItem && (
                <div className="space-y-1 md:col-span-2">
                  <Label>Status</Label>
                  <Select
                    value={form.status}
                    onValueChange={v => set("status", v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pendente">Pendente</SelectItem>
                      <SelectItem value="recebido">Recebido</SelectItem>
                      <SelectItem value="atrasado">Atrasado</SelectItem>
                      <SelectItem value="cancelado">Cancelado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {!editingItem && (
              <div className="space-y-1 border-t pt-4">
                <Label>Recorrência</Label>
                <Select value={recurrence} onValueChange={setRecurrence}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unico">Somente este mês</SelectItem>
                    <SelectItem value="pacote3">
                      Pacote 3 meses (mensal)
                    </SelectItem>
                    <SelectItem value="mensal">Mensal (12 meses)</SelectItem>
                    <SelectItem value="trimestral">
                      Trimestral (a cada 3 meses)
                    </SelectItem>
                    <SelectItem value="semestral">
                      Semestral (a cada 6 meses)
                    </SelectItem>
                  </SelectContent>
                </Select>
                {recurrence !== "unico" && (
                  <p className="text-xs text-muted-foreground pt-1">
                    {recurrence === "pacote3" &&
                      "3 receitas criadas e vinculadas entre si."}
                    {recurrence === "mensal" &&
                      "12 receitas mensais criadas e vinculadas entre si."}
                    {recurrence === "trimestral" &&
                      "4 receitas trimestrais criadas e vinculadas entre si."}
                    {recurrence === "semestral" &&
                      "2 receitas semestrais criadas e vinculadas entre si."}
                  </p>
                )}
              </div>
            )}

            {editingItem?.seriesId && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground border rounded px-3 py-2">
                <Link2 className="h-3.5 w-3.5" /> Esta receita faz parte de uma
                série — ao salvar você poderá escolher o escopo.
              </p>
            )}

            {gross > 0 && (
              <p className="text-xs text-muted-foreground">
                Imposto ({(taxRate * 100).toFixed(0)}%):{" "}
                {formatCurrency(gross * taxRate)} → Líquido:{" "}
                <span className="font-medium text-foreground">
                  {formatCurrency(gross * (1 - taxRate))}
                </span>
              </p>
            )}

            <div className="flex flex-col gap-2 pt-1 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                className="w-full sm:flex-1"
                onClick={closeDialog}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className="w-full sm:flex-1"
                disabled={isPending}
              >
                {isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Salvando...
                  </>
                ) : editingItem ? (
                  "Salvar alterações"
                ) : (
                  "Adicionar Receita"
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ────── Dialog: escopo de edição de série ────── */}
      <Dialog
        open={!!seriesEditDialog}
        onOpenChange={v => !v && setSeriesEditDialog(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Alterar receita da série</DialogTitle>
            <DialogDescription>
              Esta receita faz parte de uma série vinculada. O que deseja
              alterar?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              className="w-full"
              onClick={() => {
                if (seriesEditDialog) {
                  updateMutation.mutate(seriesEditDialog.payload);
                  setSeriesEditDialog(null);
                }
              }}
              disabled={updateMutation.isPending}
            >
              Somente esta receita
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                if (!seriesEditDialog) return;
                const { payload, seriesId } = seriesEditDialog;
                updateSeriesMut.mutate({
                  seriesId,
                  description: payload.description,
                  category: payload.category,
                  grossAmount: payload.grossAmount,
                  taxAmount: payload.taxAmount,
                  netAmount: payload.netAmount,
                  client: payload.client,
                });
                // Também atualiza este item individualmente (status/data)
                updateMutation.mutate(payload);
              }}
              disabled={updateSeriesMut.isPending}
            >
              Toda a série (todos os meses)
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => setSeriesEditDialog(null)}
            >
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ────── Dialog: escopo de exclusão de série ────── */}
      <Dialog
        open={!!deleteDialog}
        onOpenChange={v => {
          if (!v && !deleteMutation.isPending && !deleteSeriesMut.isPending) {
            setDeleteDialog(null);
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {deleteDialog?.seriesId
                ? "Excluir receita recorrente?"
                : "Excluir receita?"}
            </DialogTitle>
            <DialogDescription>
              {deleteDialog?.seriesId ? (
                <>
                  <strong>{deleteDialog.description}</strong> faz parte de uma
                  série. Escolha se deseja excluir este lançamento ou toda a
                  série. Esta ação não pode ser desfeita.
                </>
              ) : (
                <>
                  A receita <strong>{deleteDialog?.description}</strong> será
                  removida definitivamente. Esta ação não pode ser desfeita.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              variant={deleteDialog?.seriesId ? "outline" : "destructive"}
              className="w-full"
              onClick={() => {
                if (deleteDialog)
                  deleteMutation.mutate({ id: deleteDialog.id });
              }}
              disabled={deleteMutation.isPending || deleteSeriesMut.isPending}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              {deleteMutation.isPending
                ? "Excluindo..."
                : deleteDialog?.seriesId
                  ? "Excluir somente esta receita"
                  : "Excluir receita"}
            </Button>
            {deleteDialog?.seriesId ? (
              <Button
                variant="destructive"
                className="w-full"
                onClick={() => {
                  if (deleteDialog.seriesId)
                    deleteSeriesMut.mutate({
                      seriesId: deleteDialog.seriesId,
                    });
                }}
                disabled={deleteSeriesMut.isPending || deleteMutation.isPending}
              >
                {deleteSeriesMut.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {deleteSeriesMut.isPending
                  ? "Excluindo série..."
                  : "Excluir toda a série"}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => setDeleteDialog(null)}
              disabled={deleteMutation.isPending || deleteSeriesMut.isPending}
            >
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Cards resumo ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground uppercase">Bruto</p>
            <p className="text-xl font-bold mt-1">
              {formatCurrency(totalGross)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground uppercase">
              Líquido (após imposto)
            </p>
            <p className="text-xl font-bold mt-1 text-primary">
              {formatCurrency(totalNet)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground uppercase">Recebido</p>
            <p className="text-xl font-bold mt-1 text-chart-1">
              {formatCurrency(totalReceived)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Tabela ── */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Descrição</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead className="text-right">Bruto</TableHead>
                <TableHead className="text-right">Imposto</TableHead>
                <TableHead className="text-right">Líquido</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="text-center py-8 text-muted-foreground"
                  >
                    Carregando...
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="text-center py-8 text-muted-foreground"
                  >
                    Nenhuma receita neste mês
                  </TableCell>
                </TableRow>
              ) : (
                rows.map(item => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-1.5">
                        {item.seriesId && (
                          <Link2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        )}
                        {item.description}
                      </span>
                    </TableCell>
                    <TableCell>{item.category}</TableCell>
                    <TableCell>{item.client || "-"}</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(item.grossAmount)}
                    </TableCell>
                    <TableCell className="text-right text-destructive">
                      {formatCurrency(item.taxAmount)}
                    </TableCell>
                    <TableCell className="text-right text-primary font-medium">
                      {formatCurrency(item.netAmount)}
                    </TableCell>
                    <TableCell>{formatDate(item.dueDate)}</TableCell>
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
                          onClick={() => handleDelete(item)}
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
