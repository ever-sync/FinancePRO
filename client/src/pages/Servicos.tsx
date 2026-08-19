import { trpc } from "@/lib/trpc";
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
import { Plus, Trash2, Pencil, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const UNITS = ["hora", "projeto", "mensal", "diária", "pacote"] as const;

const RECURRENCES = [
  { value: "unico", label: "Único (sem recorrência)" },
  { value: "pacote3", label: "Pacote 3 meses" },
  { value: "mensal", label: "Mensal (12 meses)" },
  { value: "trimestral", label: "Trimestral" },
  { value: "semestral", label: "Semestral" },
] as const;

interface FormData {
  name: string;
  description: string;
  category: string;
  basePrice: string;
  unit: string;
  recurrence: string;
  status: string;
}
interface FormErrors {
  name?: string;
  basePrice?: string;
}

const EMPTY: FormData = {
  name: "",
  description: "",
  category: "",
  basePrice: "",
  unit: "projeto",
  recurrence: "unico",
  status: "ativo",
};

function validate(f: FormData): FormErrors {
  const e: FormErrors = {};
  if (!f.name.trim()) e.name = "Nome é obrigatório";
  if (
    !f.basePrice ||
    isNaN(parseFloat(f.basePrice)) ||
    parseFloat(f.basePrice) < 0
  )
    e.basePrice = "Informe um preço válido";
  return e;
}

export default function Servicos() {
  const utils = trpc.useUtils();
  const { page, limit, setPage, setLimit } = useTablePagination();
  const { data: servicesData, isLoading } = trpc.services.list.useQuery({
    page,
    limit,
  });
  const services = servicesData?.data ?? [];
  const createService = trpc.services.create.useMutation({
    onSuccess: () => {
      utils.services.list.invalidate();
      toast.success("Serviço adicionado");
      closeDialog();
    },
  });
  const updateService = trpc.services.update.useMutation({
    onSuccess: () => {
      utils.services.list.invalidate();
      toast.success("Serviço atualizado");
      closeDialog();
    },
  });
  const toggleStatus = trpc.services.update.useMutation({
    onSuccess: () => utils.services.list.invalidate(),
  });
  const deleteService = trpc.services.delete.useMutation({
    onSuccess: () => {
      utils.services.list.invalidate();
      toast.success("Removido");
    },
  });

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<
    Partial<Record<keyof FormData, boolean>>
  >({});

  function closeDialog() {
    setOpen(false);
    setEditingId(null);
    setForm(EMPTY);
    setErrors({});
    setTouched({});
  }

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY);
    setErrors({});
    setTouched({});
    setOpen(true);
  }

  function openEdit(s: (typeof services)[0]) {
    setEditingId(s.id);
    setForm({
      name: s.name,
      description: s.description ?? "",
      category: s.category ?? "",
      basePrice: parseFloat(s.basePrice).toFixed(2),
      unit: s.unit,
      recurrence: s.recurrence ?? "unico",
      status: s.status,
    });
    setErrors({});
    setTouched({});
    setOpen(true);
  }

  const set = (field: keyof FormData, value: string) => {
    const next = { ...form, [field]: value };
    setForm(next);
    if (touched[field]) setErrors(validate(next));
  };

  const touch = (field: keyof FormData) => {
    setTouched(p => ({ ...p, [field]: true }));
    setErrors(validate(form));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(Object.fromEntries(Object.keys(form).map(k => [k, true])));
    const errs = validate(form);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    const payload = {
      name: form.name.trim(),
      description: form.description || undefined,
      category: form.category || undefined,
      basePrice: parseFloat(form.basePrice).toFixed(2),
      unit: form.unit,
      recurrence: form.recurrence,
      status: form.status,
    };

    if (editingId !== null) {
      updateService.mutate({ id: editingId, ...payload });
    } else {
      createService.mutate(payload);
    }
  };

  const isPending = createService.isPending || updateService.isPending;
  const serviceCount = servicesData?.pagination.total ?? 0;
  const activeServiceCount = servicesData?.summary.activeCount ?? 0;
  const totalPortfolio = Number(servicesData?.summary.totalPortfolio ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Serviços</h1>
          <p className="text-sm text-muted-foreground">
            Catálogo de serviços oferecidos pela empresa
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" /> Novo Serviço
        </Button>
      </div>

      {/* ── Dialog ── */}
      <Dialog open={open} onOpenChange={v => !v && closeDialog()}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingId !== null ? "Editar Serviço" : "Novo Serviço"}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-5 mt-2">
            {/* Nome */}
            <div className="space-y-1">
              <Label>
                Nome do Serviço <span className="text-destructive">*</span>
              </Label>
              <Input
                value={form.name}
                onChange={e => set("name", e.target.value)}
                onBlur={() => touch("name")}
                placeholder="Ex: Consultoria de TI"
                className={
                  touched.name && errors.name ? "border-destructive" : ""
                }
              />
              {touched.name && errors.name && (
                <p className="text-xs text-destructive">{errors.name}</p>
              )}
            </div>

            {/* Descrição */}
            <div className="space-y-1">
              <Label>Descrição</Label>
              <Input
                value={form.description}
                onChange={e => set("description", e.target.value)}
                placeholder="Descreva brevemente o serviço"
              />
            </div>

            {/* Categoria + Unidade */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Categoria</Label>
                <Input
                  value={form.category}
                  onChange={e => set("category", e.target.value)}
                  placeholder="Ex: Consultoria, TI..."
                />
              </div>
              <div className="space-y-1">
                <Label>Unidade de Cobrança</Label>
                <Select value={form.unit} onValueChange={v => set("unit", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNITS.map(u => (
                      <SelectItem key={u} value={u}>
                        {u.charAt(0).toUpperCase() + u.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Recorrência padrão */}
            <div className="space-y-1">
              <Label>Recorrência padrão</Label>
              <Select
                value={form.recurrence}
                onValueChange={v => set("recurrence", v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RECURRENCES.map(r => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Ao selecionar este serviço em uma receita, a recorrência será
                preenchida automaticamente.
              </p>
            </div>

            {/* Preço + Status */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <Label>
                  Preço Base (R$) <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.basePrice}
                  onChange={e => set("basePrice", e.target.value)}
                  onBlur={() => touch("basePrice")}
                  placeholder="0,00"
                  className={
                    touched.basePrice && errors.basePrice
                      ? "border-destructive"
                      : ""
                  }
                />
                {touched.basePrice && errors.basePrice && (
                  <p className="text-xs text-destructive">{errors.basePrice}</p>
                )}
              </div>
              <div className="space-y-1">
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
            </div>

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
                ) : editingId !== null ? (
                  "Salvar alterações"
                ) : (
                  "Cadastrar"
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Resumo */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground uppercase">
              Total de Serviços
            </p>
            <p className="text-xl font-bold mt-1">{serviceCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground uppercase">
              Serviços Ativos
            </p>
            <p className="text-xl font-bold mt-1">{activeServiceCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground uppercase">
              Preço Médio
            </p>
            <p className="text-xl font-bold mt-1">
              {formatCurrency(serviceCount ? totalPortfolio / serviceCount : 0)}
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
                <TableHead>Serviço</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="text-right">Preço Base</TableHead>
                <TableHead>Unidade</TableHead>
                <TableHead>Recorrência</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[90px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center py-8 text-muted-foreground"
                  >
                    Carregando...
                  </TableCell>
                </TableRow>
              ) : services.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center py-8 text-muted-foreground"
                  >
                    Nenhum serviço cadastrado
                  </TableCell>
                </TableRow>
              ) : (
                services.map(item => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>{item.category || "-"}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-muted-foreground">
                      {item.description || "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(item.basePrice)}
                    </TableCell>
                    <TableCell>{item.unit}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {RECURRENCES.find(
                        r => r.value === (item.recurrence ?? "unico")
                      )?.label ?? "Único"}
                    </TableCell>
                    <TableCell>
                      <button
                        onClick={() =>
                          toggleStatus.mutate({
                            id: item.id,
                            status:
                              item.status === "ativo" ? "inativo" : "ativo",
                          })
                        }
                      >
                        <Badge
                          variant={
                            item.status === "ativo" ? "default" : "secondary"
                          }
                        >
                          {item.status}
                        </Badge>
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
                          onClick={() => deleteService.mutate({ id: item.id })}
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
            pagination={servicesData?.pagination}
            onPageChange={setPage}
            onPageSizeChange={setLimit}
          />
        </CardContent>
      </Card>
    </div>
  );
}
