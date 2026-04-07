import { useEffect, useState } from "react";
import { AIChatBox, type Message as ChatMessage } from "@/components/AIChatBox";
import { trpc } from "@/lib/trpc";

const CHAT_PROMPTS = [
  "Quanto posso gastar hoje sem apertar o restante do mes?",
  "O que vence essa semana e o que eu devo pagar primeiro?",
  "Quais cobrancas eu preciso acompanhar hoje?",
  "Posso tirar R$ 3.000 da empresa este mes?",
  "Posso assumir um custo mensal de R$ 2.500 agora?",
  "Me explique meu mes como um mentor financeiro.",
];

export default function WhatsAppPlanos() {
  const utils = trpc.useUtils();
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const { data: assistantInbox } = trpc.assistantInbox.list.useQuery();

  const askMentorMut = trpc.financialAdvisor.ask.useMutation({
    onSuccess: async response => {
      const parts = [response.reply];

      if (response.alerts.length) {
        parts.push(`**Alertas**\n- ${response.alerts.join("\n- ")}`);
      }

      if (response.requiresConfirmation) {
        parts.push(
          response.persistedToAssistantThread
            ? "Essa resposta ficou registrada com pendencia de confirmacao na inbox do mentor."
            : "Essa resposta exige confirmacao antes de seguir."
        );
      }

      setLocalMessages(prev => [
        ...prev,
        {
          role: "assistant",
          content: parts.join("\n\n"),
        },
      ]);

      await utils.assistantInbox.list.invalidate();
    },
    onError: error => {
      setLocalMessages(prev => [
        ...prev,
        {
          role: "assistant",
          content: `Nao consegui responder agora.\n\n${error.message}`,
        },
      ]);
    },
  });

  function handleSendMentorMessage(content: string) {
    setLocalMessages(prev => [
      ...prev,
      {
        role: "user",
        content,
      },
    ]);

    askMentorMut.mutate({ message: content });
  }

  const latestThread = assistantInbox?.threads[0] ?? null;
  const latestThreadMessages = (assistantInbox?.messages ?? [])
    .filter(message => (latestThread ? message.threadId === latestThread.id : true))
    .slice(0, 20)
    .reverse();

  const persistedConversation: ChatMessage[] = latestThreadMessages.map(message => ({
    role: message.direction === "inbound" ? "user" : "assistant",
    content: String(message.textContent || ""),
  }));

  useEffect(() => {
    if (!localMessages.length || !persistedConversation.length) return;

    const comparableLocalMessages = localMessages.filter(message => message.role !== "system");
    const comparablePersistedMessages = persistedConversation.slice(-comparableLocalMessages.length);

    if (comparablePersistedMessages.length !== comparableLocalMessages.length) return;

    const isSameTail = comparableLocalMessages.every((message, index) => {
      const persistedMessage = comparablePersistedMessages[index];
      return persistedMessage?.role === message.role && persistedMessage?.content === message.content;
    });

    if (isSameTail) {
      setLocalMessages([]);
    }
  }, [localMessages, persistedConversation]);

  const messages = localMessages.length
    ? [...persistedConversation, ...localMessages]
    : persistedConversation;

  return (
    <div className="-mx-4 -my-4 min-h-full bg-[#f4f4f2] md:-mx-6 md:-my-6">
      <div className="h-[calc(100vh-6rem)] p-4 md:p-6 lg:p-8">
        <AIChatBox
          messages={messages}
          onSendMessage={handleSendMentorMessage}
          isLoading={askMentorMut.isPending}
          placeholder="Pergunte algo como: posso tirar R$ 3.000 da empresa este mes?"
          emptyStateMessage="Converse com seu mentor financeiro."
          suggestedPrompts={CHAT_PROMPTS}
          height="100%"
          className="h-full rounded-[28px] border-zinc-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.06)]"
        />
      </div>
    </div>
  );
}
