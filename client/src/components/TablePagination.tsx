import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect } from "react";

export interface TablePaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

interface TablePaginationProps {
  pagination?: TablePaginationMeta;
  onPageChange: (page: number) => void;
  onPageSizeChange: (limit: number) => void;
  pageSizes?: number[];
}

export function TablePagination({
  pagination,
  onPageChange,
  onPageSizeChange,
  pageSizes = [10, 25, 50, 100],
}: TablePaginationProps) {
  const page = pagination?.page ?? 1;
  const totalPages = pagination?.totalPages ?? 0;

  useEffect(() => {
    if (totalPages > 0 && page > totalPages) onPageChange(totalPages);
  }, [onPageChange, page, totalPages]);

  if (!pagination || pagination.total === 0) return null;

  const firstItem = (pagination.page - 1) * pagination.limit + 1;
  const lastItem = Math.min(
    pagination.page * pagination.limit,
    pagination.total
  );

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm text-muted-foreground">
      <span>
        {firstItem}–{lastItem} de {pagination.total} registros
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          <span className="hidden sm:inline">Itens por página</span>
          <select
            aria-label="Itens por página"
            className="h-8 rounded-md border bg-background px-2 text-foreground"
            value={pagination.limit}
            onChange={event => onPageSizeChange(Number(event.target.value))}
          >
            {pageSizes.map(size => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <span className="min-w-24 text-center">
          Página {pagination.page} de {pagination.totalPages}
        </span>
        <Button
          aria-label="Página anterior"
          disabled={pagination.page <= 1}
          onClick={() => onPageChange(pagination.page - 1)}
          size="icon"
          type="button"
          variant="outline"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          aria-label="Próxima página"
          disabled={!pagination.hasMore}
          onClick={() => onPageChange(pagination.page + 1)}
          size="icon"
          type="button"
          variant="outline"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
