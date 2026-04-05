import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, TrendingUp } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const types = ["CDB", "Tesouro Direto", "LCI/LCA", "Ações", "FII", "Poupança", "Crypto", "Previdência", "Outros"];

export default function Investimentos() {
  const utils = trpc.useUtils();
  const { data: items, isLoading } = trpc.investments.list.useQuery();
  const rows = items ?? [];
  const createMut = trpc.investments.create.useMutation({ onSuccess: () => { utils.investments.list.invalidate(); toast.success("Investimento adicionado"); setOpen(false); } });
  const deleteMut = trpc.investments.delete.useMutation({ onSuccess: () => { utils.investments.list.invalidate(); toast.success("Removido"); } });
  const [open, setOpen] = useState(false);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const deposit = parseFloat(fd.get("depositAmount") as string) || 0;
    createMut.mutate({
      description: fd.get("description") as string,
      institution: fd.get("institution") as string,
      type: fd.get("type") as string,
      depositAmount: deposit.toFixed(2),
      currentBalance: deposit.toFixed(2),
      date: fd.get("date") as string,
    });
  };

  const totalDeposited = rows.reduce((sum, item) => sum + parseFloat(item.depositAmount), 0);
  const totalBalance = rows.reduce((sum, item) => sum + parseFloat(item.currentBalance), 0);
  const totalYield = rows.reduce((sum, item) => sum + parseFloat(item.yieldAmount), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Investimentos</h1>
          <p className="text-sm text-muted-foreground">Controle dos seus investimentos pessoais (10% do pró-labore)</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" /> Novo Investimento</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Novo Investimento</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="md:col-span-2"><Label>Descrição</Label><Input name="description" required /></div>
                <div><Label>Instituição</Label><Input name="institution" required /></div>
                <div><Label>Tipo</Label>
                  <Select name="type" required>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>{types.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Valor Depositado (R$)</Label><Input name="depositAmount" type="number" step="0.01" required /></div>
                <div><Label>Data</Label><Input name="date" type="date" required /></div>
              </div>
              <Button type="submit" className="w-full" disabled={createMut.isPending}>
                {createMut.isPending ? "Salvando..." : "Adicionar"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card><CardContent className="pt-6 flex items-center justify-between">
          <div><p className="text-xs text-muted-foreground uppercase">Total Depositado</p><p className="text-xl font-bold mt-1">{formatCurrency(totalDeposited)}</p></div>
          <div className="h-10 w-10 rounded-xl bg-chart-2/10 flex items-center justify-center"><TrendingUp className="h-5 w-5 text-chart-2" /></div>
        </CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground uppercase">Saldo Atual</p><p className="text-xl font-bold mt-1 text-primary">{formatCurrency(totalBalance)}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground uppercase">Rendimentos</p><p className="text-xl font-bold mt-1 text-chart-1">{formatCurrency(totalYield)}</p></CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Descrição</TableHead>
                <TableHead>Instituição</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Depositado</TableHead>
                <TableHead className="text-right">Saldo Atual</TableHead>
                <TableHead className="text-right">Rendimento</TableHead>
                <TableHead>Data</TableHead>
                <TableHead className="w-[60px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Nenhum investimento cadastrado</TableCell></TableRow>
              ) : rows.map(item => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.description}</TableCell>
                  <TableCell>{item.institution}</TableCell>
                  <TableCell>{item.type}</TableCell>
                  <TableCell className="text-right">{formatCurrency(item.depositAmount)}</TableCell>
                  <TableCell className="text-right text-primary font-medium">{formatCurrency(item.currentBalance)}</TableCell>
                  <TableCell className="text-right text-chart-1">{formatCurrency(item.yieldAmount)}</TableCell>
                  <TableCell>{formatDate(item.date)}</TableCell>
                  <TableCell><Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteMut.mutate({ id: item.id })}><Trash2 className="h-4 w-4" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
