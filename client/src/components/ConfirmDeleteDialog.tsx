import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { LoaderCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type ConfirmDeleteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  onConfirm: () => void;
  confirmLabel?: string;
  isPending?: boolean;
};

export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  confirmLabel = "Excluir",
  isPending = false,
}: ConfirmDeleteDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <div className="flex items-start gap-4">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <Trash2 className="size-5" aria-hidden="true" />
          </div>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed">
              {description}
            </AlertDialogDescription>
          </AlertDialogHeader>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white shadow-none [background-image:none] hover:translate-y-0 hover:bg-destructive/90 hover:shadow-none"
            disabled={isPending}
            onClick={event => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {isPending ? (
              <LoaderCircle
                className="size-4 animate-spin"
                aria-hidden="true"
              />
            ) : null}
            {isPending ? "Excluindo..." : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type ConfirmDeleteButtonProps = Omit<
  ComponentProps<typeof Button>,
  "onClick"
> & {
  title: string;
  description: ReactNode;
  onConfirm: () => Promise<unknown> | unknown;
  confirmLabel?: string;
  triggerLabel?: string;
};

export function ConfirmDeleteButton({
  title,
  description,
  onConfirm,
  confirmLabel,
  triggerLabel,
  variant = "ghost",
  size = triggerLabel ? "sm" : "icon",
  className,
  disabled,
  ...buttonProps
}: ConfirmDeleteButtonProps) {
  const [open, setOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const confirm = async () => {
    setIsPending(true);
    try {
      await onConfirm();
      if (isMounted.current) setOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível excluir."
      );
    } finally {
      if (isMounted.current) setIsPending(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        disabled={disabled || isPending}
        aria-label={buttonProps["aria-label"] ?? title}
        onClick={() => setOpen(true)}
        {...buttonProps}
      >
        <Trash2 className="size-4" aria-hidden="true" />
        {triggerLabel}
      </Button>
      <ConfirmDeleteDialog
        open={open}
        onOpenChange={nextOpen => {
          if (!isPending) setOpen(nextOpen);
        }}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        isPending={isPending}
        onConfirm={confirm}
      />
    </>
  );
}
