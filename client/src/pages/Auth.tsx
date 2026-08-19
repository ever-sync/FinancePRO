import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSupabaseAuth } from "@/lib/auth";
import { supabaseConfigurationError } from "@/lib/supabase";
import { DollarSign, Loader2 } from "lucide-react";
import { useState } from "react";

type Mode = "login" | "register";

export default function AuthPage() {
  const { signIn, signUp } = useSupabaseAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    if (mode === "login") {
      const result = await signIn(email, password);
      if (result.error) setError(translateError(result.error));
    } else {
      if (!name.trim()) {
        setError("Informe seu nome.");
        setLoading(false);
        return;
      }
      if (password.length < 8) {
        setError("A senha deve ter pelo menos 8 caracteres.");
        setLoading(false);
        return;
      }
      if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
        setError("A senha deve conter pelo menos uma letra e um número.");
        setLoading(false);
        return;
      }
      const result = await signUp(email, password, name.trim());
      if (result.error) {
        setError(translateError(result.error));
      } else {
        setSuccess(
          "Conta criada! Verifique seu e-mail para confirmar o cadastro."
        );
        setMode("login");
      }
    }

    setLoading(false);
  };

  const switchMode = () => {
    setMode(mode === "login" ? "register" : "login");
    setError(null);
    setSuccess(null);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f4f4f2] p-4">
      <Card className="w-full max-w-md shadow-xl border-zinc-200">
        <CardHeader className="text-center space-y-4 pb-2">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 via-orange-500 to-amber-400 text-white shadow-[0_10px_24px_rgba(249,115,22,0.28)]">
            <DollarSign className="h-8 w-8" />
          </div>
          <div>
            <CardTitle className="text-2xl font-bold tracking-tight">
              FinancePro
            </CardTitle>
            <CardDescription className="mt-1">
              {mode === "login"
                ? "Faça login para acessar o sistema"
                : "Crie sua conta para começar"}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {supabaseConfigurationError && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {supabaseConfigurationError}
              </div>
            )}

            {mode === "register" && (
              <div className="space-y-2">
                <Label htmlFor="name">Nome</Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="Seu nome completo"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                  autoComplete="name"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                placeholder={
                  mode === "register"
                    ? "8+ caracteres, letra e número"
                    : "Sua senha"
                }
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={mode === "register" ? 8 : undefined}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
              />
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {success && (
              <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                {success}
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={loading || Boolean(supabaseConfigurationError)}
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === "login" ? "Entrar" : "Criar conta"}
            </Button>
          </form>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            {mode === "login" ? (
              <>
                Não tem conta?{" "}
                <button
                  type="button"
                  onClick={switchMode}
                  className="font-medium text-orange-600 underline-offset-4 hover:underline"
                >
                  Cadastre-se
                </button>
              </>
            ) : (
              <>
                Já tem conta?{" "}
                <button
                  type="button"
                  onClick={switchMode}
                  className="font-medium text-orange-600 underline-offset-4 hover:underline"
                >
                  Fazer login
                </button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function translateError(msg: string): string {
  if (msg.includes("Invalid login credentials"))
    return "E-mail ou senha incorretos.";
  if (msg.includes("Email not confirmed"))
    return "Confirme seu e-mail antes de fazer login.";
  if (msg.includes("User already registered"))
    return "Este e-mail já está cadastrado.";
  if (msg.includes("Password should be at least"))
    return "A senha deve ter pelo menos 8 caracteres.";
  if (msg.includes("Password should contain")) {
    return "A senha deve conter pelo menos uma letra e um número.";
  }
  if (msg.includes("Unable to validate email")) return "E-mail inválido.";
  if (msg.includes("Email rate limit exceeded"))
    return "Muitas tentativas. Aguarde um momento.";
  return msg;
}
