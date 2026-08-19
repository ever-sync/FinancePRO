import { trpc } from "@/lib/trpc";
import { TablePagination } from "@/components/TablePagination";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteDialog";
import { useTablePagination } from "@/hooks/useTablePagination";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Plus,
  Pencil,
  Search,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

// ─── CNPJ / CPF helpers ───────────────────────────────────────────────────────

function onlyDigits(v: string) {
  return v.replace(/\D/g, "");
}

function autoMaskDocument(raw: string) {
  const d = onlyDigits(raw);
  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1-$2");
  }
  return d
    .slice(0, 14)
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

function validateCNPJ(cnpj: string) {
  const d = onlyDigits(cnpj);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (s: string, w: number[]) => {
    const r = s.split("").reduce((a, n, i) => a + +n * w[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return (
    calc(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === +d[12] &&
    calc(d.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === +d[13]
  );
}

function validateCPF(cpf: string) {
  const d = onlyDigits(cpf);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const calc = (s: string, len: number) => {
    const r =
      (s.split("").reduce((a, n, i) => a + +n * (len + 1 - i), 0) * 10) % 11;
    return r >= 10 ? 0 : r;
  };
  return calc(d, 10) === +d[9] && calc(d, 11) === +d[10];
}

function docIsValid(doc: string) {
  const d = onlyDigits(doc);
  if (d.length === 14) return validateCNPJ(d);
  if (d.length === 11) return validateCPF(d);
  return false;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface FormData {
  name: string;
  document: string;
  category: string;
  contact: string;
  phone: string;
  email: string;
  address: string;
}
interface FormErrors {
  name?: string;
  document?: string;
  email?: string;
}

const EMPTY: FormData = {
  name: "",
  document: "",
  category: "",
  contact: "",
  phone: "",
  email: "",
  address: "",
};

function validate(f: FormData): FormErrors {
  const e: FormErrors = {};
  if (!f.name.trim()) e.name = "Nome é obrigatório";
  if (f.document && !docIsValid(f.document))
    e.document = "CNPJ ou CPF inválido";
  if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email))
    e.email = "E-mail inválido";
  return e;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Clientes() {
  const utils = trpc.useUtils();
  const { page, limit, setPage, setLimit } = useTablePagination();
  const { data: clientsData, isLoading } = trpc.clients.list.useQuery({
    page,
    limit,
  });
  const clients = clientsData?.data ?? [];
  const createClient = trpc.clients.create.useMutation({
    onSuccess: () => {
      utils.clients.list.invalidate();
      toast.success("Cliente adicionado");
      closeDialog();
    },
  });
  const updateClient = trpc.clients.update.useMutation({
    onSuccess: () => {
      utils.clients.list.invalidate();
      toast.success("Cliente atualizado");
      closeDialog();
    },
  });
  const deleteClient = trpc.clients.delete.useMutation({
    onSuccess: () => {
      utils.clients.list.invalidate();
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
  const [cnpjLoading, setCnpjLoading] = useState(false);
  const [cnpjStatus, setCnpjStatus] = useState<"idle" | "found" | "notfound">(
    "idle"
  );

  function closeDialog() {
    setOpen(false);
    setEditingId(null);
    setForm(EMPTY);
    setErrors({});
    setTouched({});
    setCnpjStatus("idle");
  }

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY);
    setErrors({});
    setTouched({});
    setCnpjStatus("idle");
    setOpen(true);
  }

  function openEdit(c: (typeof clients)[0]) {
    setEditingId(c.id);
    setForm({
      name: c.name,
      document: c.document ?? "",
      category: c.category ?? "",
      contact: c.contact ?? "",
      phone: c.phone ?? "",
      email: c.email ?? "",
      address: c.address ?? "",
    });
    setErrors({});
    setTouched({});
    setCnpjStatus("idle");
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

  const handleDocumentChange = async (raw: string) => {
    const masked = autoMaskDocument(raw);
    set("document", masked);
    setCnpjStatus("idle");
    const digits = onlyDigits(masked);
    if (digits.length === 14 && validateCNPJ(digits)) {
      setCnpjLoading(true);
      try {
        const res = await fetch(
          `https://brasilapi.com.br/api/cnpj/v1/${digits}`
        );
        if (!res.ok) throw new Error();
        const data = await res.json();
        const phone = (data.ddd_telefone_1 ?? "")
          .replace(/\D/g, "")
          .replace(/^(\d{2})(\d{4,5})(\d{4})$/, "($1) $2-$3");
        const address = [
          data.logradouro,
          data.numero,
          data.complemento,
          data.bairro,
          data.municipio,
          data.uf,
        ]
          .filter(Boolean)
          .join(", ");
        setForm(prev => ({
          ...prev,
          document: masked,
          name: prev.name || (data.razao_social ?? ""),
          phone: prev.phone || phone,
          email: prev.email || (data.email ?? ""),
          address: prev.address || address,
        }));
        setCnpjStatus("found");
        toast.success("Dados do CNPJ carregados");
      } catch {
        setCnpjStatus("notfound");
        toast.error("CNPJ não encontrado na Receita Federal");
      } finally {
        setCnpjLoading(false);
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(Object.fromEntries(Object.keys(form).map(k => [k, true])));
    const errs = validate(form);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    const payload = {
      name: form.name.trim(),
      document: form.document || undefined,
      category: form.category || undefined,
      contact: form.contact || undefined,
      phone: form.phone || undefined,
      email: form.email || undefined,
      address: form.address || undefined,
    };

    if (editingId !== null) {
      updateClient.mutate({ id: editingId, ...payload });
    } else {
      createClient.mutate(payload);
    }
  };

  const isPending = createClient.isPending || updateClient.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Clientes</h1>
          <p className="text-sm text-muted-foreground">
            Cadastro de clientes da empresa
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" /> Novo Cliente
        </Button>
      </div>

      {/* ── Dialog ── */}
      <Dialog open={open} onOpenChange={v => !v && closeDialog()}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingId !== null ? "Editar Cliente" : "Cadastrar Cliente"}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-5 mt-2">
            {/* CNPJ / CPF */}
            <div className="space-y-1">
              <Label>CNPJ / CPF</Label>
              <div className="relative">
                <Input
                  value={form.document}
                  onChange={e => handleDocumentChange(e.target.value)}
                  onBlur={() => touch("document")}
                  placeholder="00.000.000/0001-00 ou 000.000.000-00"
                  className={
                    touched.document && errors.document
                      ? "border-destructive pr-9"
                      : cnpjStatus === "found"
                        ? "border-green-500 pr-9"
                        : "pr-9"
                  }
                />
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                  {cnpjLoading && (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                  {!cnpjLoading && cnpjStatus === "found" && (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  )}
                  {!cnpjLoading && cnpjStatus === "notfound" && (
                    <AlertCircle className="h-4 w-4 text-destructive" />
                  )}
                  {!cnpjLoading &&
                    cnpjStatus === "idle" &&
                    onlyDigits(form.document).length === 14 &&
                    validateCNPJ(form.document) && (
                      <Search className="h-4 w-4 text-muted-foreground" />
                    )}
                </div>
              </div>
              {touched.document && errors.document && (
                <p className="text-xs text-destructive">{errors.document}</p>
              )}
            </div>

            {/* Nome */}
            <div className="space-y-1">
              <Label>
                Razão Social / Nome <span className="text-destructive">*</span>
              </Label>
              <Input
                value={form.name}
                onChange={e => set("name", e.target.value)}
                onBlur={() => touch("name")}
                placeholder="Nome do cliente"
                className={
                  touched.name && errors.name ? "border-destructive" : ""
                }
              />
              {touched.name && errors.name && (
                <p className="text-xs text-destructive">{errors.name}</p>
              )}
            </div>

            {/* Categoria + Contato */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Categoria</Label>
                <Input
                  value={form.category}
                  onChange={e => set("category", e.target.value)}
                  placeholder="Ex: Varejo, Indústria..."
                />
              </div>
              <div className="space-y-1">
                <Label>Pessoa de Contato</Label>
                <Input
                  value={form.contact}
                  onChange={e => set("contact", e.target.value)}
                  placeholder="Nome do contato"
                />
              </div>
            </div>

            {/* Telefone + Email */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Telefone</Label>
                <Input
                  value={form.phone}
                  onChange={e => set("phone", e.target.value)}
                  placeholder="(00) 00000-0000"
                />
              </div>
              <div className="space-y-1">
                <Label>E-mail</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={e => set("email", e.target.value)}
                  onBlur={() => touch("email")}
                  placeholder="email@empresa.com"
                  className={
                    touched.email && errors.email ? "border-destructive" : ""
                  }
                />
                {touched.email && errors.email && (
                  <p className="text-xs text-destructive">{errors.email}</p>
                )}
              </div>
            </div>

            {/* Endereço */}
            <div className="space-y-1">
              <Label>Endereço</Label>
              <Input
                value={form.address}
                onChange={e => set("address", e.target.value)}
                placeholder="Rua, número, bairro, cidade - UF"
              />
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
                disabled={isPending || cnpjLoading}
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

      {/* Tabela */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>CNPJ / CPF</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Contato</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead className="w-[140px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center py-8 text-muted-foreground"
                  >
                    Carregando...
                  </TableCell>
                </TableRow>
              ) : clients.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center py-8 text-muted-foreground"
                  >
                    Nenhum cliente cadastrado
                  </TableCell>
                </TableRow>
              ) : (
                clients.map(item => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {item.document || "-"}
                    </TableCell>
                    <TableCell>{item.category || "-"}</TableCell>
                    <TableCell>{item.contact || "-"}</TableCell>
                    <TableCell>{item.phone || "-"}</TableCell>
                    <TableCell>{item.email || "-"}</TableCell>
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
                        <ConfirmDeleteButton
                          className="h-8 w-8 text-destructive"
                          title="Excluir cliente?"
                          description={
                            <>
                              O cliente <strong>{item.name}</strong> será
                              removido definitivamente. Os lançamentos
                              financeiros já registrados não serão excluídos.
                            </>
                          }
                          onConfirm={() =>
                            deleteClient.mutateAsync({ id: item.id })
                          }
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <TablePagination
            pagination={clientsData?.pagination}
            onPageChange={setPage}
            onPageSizeChange={setLimit}
          />
        </CardContent>
      </Card>

      {/* Resumo */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground uppercase">
              Total de Clientes
            </p>
            <p className="text-xl font-bold mt-1">
              {clientsData?.pagination.total ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground uppercase">
              Categorias
            </p>
            <p className="text-xl font-bold mt-1">
              {clientsData?.summary.categoryCount ?? 0}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
