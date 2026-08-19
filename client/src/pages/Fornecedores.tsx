import { trpc } from "@/lib/trpc";
import { useMonthYear } from "@/hooks/useMonthYear";
import { MonthSelector } from "@/components/MonthSelector";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCurrency, formatDate } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus,
  Trash2,
  Truck,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type PurchaseOrderBy =
  | "supplierId"
  | "description"
  | "amount"
  | "dueDate"
  | "status";

export default function Fornecedores() {
  const { month, year, monthName, goToPrevMonth, goToNextMonth } =
    useMonthYear();
  const utils = trpc.useUtils();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [orderBy, setOrderBy] = useState<PurchaseOrderBy>("dueDate");
  const [orderDirection, setOrderDirection] = useState<"asc" | "desc">("asc");

  const { data: suppliersData, isLoading: loadingSuppliers } =
    trpc.suppliers.list.useQuery();
  const { data: purchasesData, isLoading: loadingPurchases } =
    trpc.supplierPurchases.list.useQuery({
      month,
      year,
      page,
      limit,
      orderBy,
      orderDirection,
    });
  const suppliers = Array.isArray(suppliersData)
    ? suppliersData
    : (suppliersData?.data ?? []);
  const purchases = purchasesData?.data || [];
  const pagination = purchasesData?.pagination;
  const createSupplier = trpc.suppliers.create.useMutation({
    onSuccess: () => {
      utils.suppliers.list.invalidate();
      toast.success("Fornecedor adicionado");
      setOpenSupplier(false);
    },
  });
  const deleteSupplier = trpc.suppliers.delete.useMutation({
    onSuccess: () => {
      utils.suppliers.list.invalidate();
      toast.success("Removido");
    },
  });
  const createPurchase = trpc.supplierPurchases.create.useMutation({
    onSuccess: () => {
      utils.supplierPurchases.list.invalidate();
      toast.success("Compra adicionada");
      setOpenPurchase(false);
    },
  });
  const updatePurchase = trpc.supplierPurchases.update.useMutation({
    onSuccess: () => {
      utils.supplierPurchases.list.invalidate();
    },
  });
  const deletePurchase = trpc.supplierPurchases.delete.useMutation({
    onSuccess: () => {
      utils.supplierPurchases.list.invalidate();
      toast.success("Removido");
    },
  });
  const [openSupplier, setOpenSupplier] = useState(false);
  const [openPurchase, setOpenPurchase] = useState(false);

  const handleSupplierSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createSupplier.mutate({
      name: fd.get("name") as string,
      cnpj: (fd.get("cnpj") as string) || undefined,
      category: (fd.get("category") as string) || undefined,
      contact: (fd.get("contact") as string) || undefined,
      phone: (fd.get("phone") as string) || undefined,
      email: (fd.get("email") as string) || undefined,
    });
  };

  const handlePurchaseSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createPurchase.mutate({
      supplierId: parseInt(fd.get("supplierId") as string),
      description: fd.get("description") as string,
      amount: (parseFloat(fd.get("amount") as string) || 0).toFixed(2),
      dueDate: fd.get("dueDate") as string,
      paymentMethod: (fd.get("paymentMethod") as string) || undefined,
    });
  };

  const totalPurchases = Number(purchasesData?.totalAmount ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Fornecedores</h1>
          <p className="text-sm text-muted-foreground">
            Cadastro de fornecedores e controle de compras
          </p>
        </div>
      </div>

      <Tabs defaultValue="purchases">
        <TabsList>
          <TabsTrigger value="purchases">Compras</TabsTrigger>
          <TabsTrigger value="suppliers">Cadastro</TabsTrigger>
        </TabsList>

        <TabsContent value="purchases" className="space-y-4 mt-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <MonthSelector
              monthName={monthName}
              year={year}
              onPrev={goToPrevMonth}
              onNext={goToNextMonth}
            />
            <Dialog open={openPurchase} onOpenChange={setOpenPurchase}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" /> Nova Compra
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Nova Compra</DialogTitle>
                </DialogHeader>
                <form onSubmit={handlePurchaseSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="md:col-span-2">
                      <Label>Fornecedor</Label>
                      <Select name="supplierId" required>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent>
                          {suppliers.map(s => (
                            <SelectItem key={s.id} value={s.id.toString()}>
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="md:col-span-2">
                      <Label>Descrição</Label>
                      <Input name="description" required />
                    </div>
                    <div>
                      <Label>Valor (R$)</Label>
                      <Input name="amount" type="number" step="0.01" required />
                    </div>
                    <div>
                      <Label>Vencimento</Label>
                      <Input name="dueDate" type="date" required />
                    </div>
                    <div>
                      <Label>Forma Pgto</Label>
                      <Input
                        name="paymentMethod"
                        placeholder="PIX, Boleto..."
                      />
                    </div>
                  </div>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={createPurchase.isPending}
                  >
                    {createPurchase.isPending ? "Salvando..." : "Adicionar"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          <Card>
            <CardContent className="pt-6">
              <p className="text-xs text-muted-foreground uppercase">
                Total Compras do Mês
              </p>
              <p className="text-xl font-bold mt-1">
                {formatCurrency(totalPurchases)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => {
                        if (orderBy === "supplierId") {
                          setOrderDirection(
                            orderDirection === "asc" ? "desc" : "asc"
                          );
                        } else {
                          setOrderBy("supplierId");
                          setOrderDirection("asc");
                        }
                      }}
                    >
                      Fornecedor
                      {orderBy === "supplierId" &&
                        (orderDirection === "asc" ? (
                          <ArrowUp className="inline h-4 w-4 ml-1" />
                        ) : (
                          <ArrowDown className="inline h-4 w-4 ml-1" />
                        ))}
                    </TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead
                      className="text-right cursor-pointer hover:bg-muted/50"
                      onClick={() => {
                        if (orderBy === "amount") {
                          setOrderDirection(
                            orderDirection === "asc" ? "desc" : "asc"
                          );
                        } else {
                          setOrderBy("amount");
                          setOrderDirection("asc");
                        }
                      }}
                    >
                      Valor
                      {orderBy === "amount" &&
                        (orderDirection === "asc" ? (
                          <ArrowUp className="inline h-4 w-4 ml-1" />
                        ) : (
                          <ArrowDown className="inline h-4 w-4 ml-1" />
                        ))}
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => {
                        if (orderBy === "dueDate") {
                          setOrderDirection(
                            orderDirection === "asc" ? "desc" : "asc"
                          );
                        } else {
                          setOrderBy("dueDate");
                          setOrderDirection("asc");
                        }
                      }}
                    >
                      Vencimento
                      {orderBy === "dueDate" &&
                        (orderDirection === "asc" ? (
                          <ArrowUp className="inline h-4 w-4 ml-1" />
                        ) : (
                          <ArrowDown className="inline h-4 w-4 ml-1" />
                        ))}
                    </TableHead>
                    <TableHead>Pgto</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[60px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingPurchases ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="text-center py-8 text-muted-foreground"
                      >
                        Carregando...
                      </TableCell>
                    </TableRow>
                  ) : purchases.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="text-center py-8 text-muted-foreground"
                      >
                        Nenhuma compra neste mês
                      </TableCell>
                    </TableRow>
                  ) : (
                    purchases.map(item => {
                      const supplier = suppliers.find(
                        s => s.id === item.supplierId
                      );
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">
                            {supplier?.name || "-"}
                          </TableCell>
                          <TableCell>{item.description}</TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(item.amount)}
                          </TableCell>
                          <TableCell>{formatDate(item.dueDate)}</TableCell>
                          <TableCell>{item.paymentMethod || "-"}</TableCell>
                          <TableCell>
                            <button
                              onClick={() =>
                                updatePurchase.mutate({
                                  id: item.id,
                                  status:
                                    item.status === "pago"
                                      ? "pendente"
                                      : "pago",
                                })
                              }
                            >
                              <StatusBadge status={item.status} />
                            </button>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              onClick={() =>
                                deletePurchase.mutate({ id: item.id })
                              }
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
              {pagination && pagination.totalPages > 1 && (
                <div className="flex items-center justify-between p-4 border-t">
                  <p className="text-sm text-muted-foreground">
                    Página {pagination.page} de {pagination.totalPages} (
                    {pagination.total} registros)
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={pagination.page <= 1}
                    >
                      Anterior
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setPage(p => Math.min(pagination.totalPages, p + 1))
                      }
                      disabled={pagination.page >= pagination.totalPages}
                    >
                      Próxima
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="suppliers" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Dialog open={openSupplier} onOpenChange={setOpenSupplier}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" /> Novo Fornecedor
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Novo Fornecedor</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSupplierSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="md:col-span-2">
                      <Label>Nome</Label>
                      <Input name="name" required />
                    </div>
                    <div>
                      <Label>CNPJ</Label>
                      <Input name="cnpj" />
                    </div>
                    <div>
                      <Label>Categoria</Label>
                      <Input name="category" />
                    </div>
                    <div>
                      <Label>Contato</Label>
                      <Input name="contact" />
                    </div>
                    <div>
                      <Label>Telefone</Label>
                      <Input name="phone" />
                    </div>
                    <div className="md:col-span-2">
                      <Label>Email</Label>
                      <Input name="email" type="email" />
                    </div>
                  </div>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={createSupplier.isPending}
                  >
                    {createSupplier.isPending ? "Salvando..." : "Adicionar"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>CNPJ</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Contato</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead className="w-[60px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingSuppliers ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="text-center py-8 text-muted-foreground"
                      >
                        Carregando...
                      </TableCell>
                    </TableRow>
                  ) : suppliers.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="text-center py-8 text-muted-foreground"
                      >
                        Nenhum fornecedor cadastrado
                      </TableCell>
                    </TableRow>
                  ) : (
                    suppliers.map(item => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">
                          {item.name}
                        </TableCell>
                        <TableCell>{item.cnpj || "-"}</TableCell>
                        <TableCell>{item.category || "-"}</TableCell>
                        <TableCell>{item.contact || "-"}</TableCell>
                        <TableCell>{item.phone || "-"}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() =>
                              deleteSupplier.mutate({ id: item.id })
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
