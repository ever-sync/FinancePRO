/**
 * Utilitários de Paginação para o Sistema Financeiro
 * Padroniza a paginação em todas as queries do banco de dados
 */

export interface PaginationParams {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

export const MAX_PAGE_SIZE = 100;

export function normalizePagination(
  page: number,
  limit: number
): Pick<PaginationParams, "page" | "limit"> {
  const normalizedPage = Number.isFinite(page) ? Math.floor(page) : 1;
  const normalizedLimit = Number.isFinite(limit) ? Math.floor(limit) : 20;

  return {
    page: Math.max(1, normalizedPage),
    limit: Math.max(1, Math.min(normalizedLimit, MAX_PAGE_SIZE)),
  };
}

/**
 * A paginação só é aplicada quando o chamador a solicita explicitamente.
 * Chamadas internas de dashboard/calendário recebem todos os registros para
 * que somas financeiras nunca sejam truncadas pelo tamanho padrão da página.
 */
export function resolvePagination(
  pagination: PaginationParams | undefined,
  total: number
): Pick<PaginationParams, "page" | "limit"> {
  if (pagination) {
    return normalizePagination(pagination.page, pagination.limit);
  }

  return {
    page: 1,
    limit: Math.max(1, Math.floor(Number.isFinite(total) ? total : 0)),
  };
}

export function calculatePagination(
  page: number,
  limit: number,
  total: number
): {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
} {
  const safePage = Math.max(1, Number.isFinite(page) ? Math.floor(page) : 1);
  const safeLimit = Math.max(1, Number.isFinite(limit) ? Math.floor(limit) : 1);
  const safeTotal = Math.max(0, Number.isFinite(total) ? Math.floor(total) : 0);
  const totalPages = Math.ceil(safeTotal / safeLimit);

  return {
    page: safePage,
    limit: safeLimit,
    total: safeTotal,
    totalPages,
    hasMore: safePage < totalPages,
  };
}

export function getDefaultPagination(): PaginationParams {
  return {
    page: 1,
    limit: 20,
    sortBy: "createdAt",
    sortOrder: "desc",
  };
}
