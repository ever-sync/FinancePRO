import { useEffect, useState } from "react";

export function useTablePagination(resetKey?: string, initialLimit = 25) {
  const [page, setPage] = useState(1);
  const [limit, setLimitState] = useState(initialLimit);

  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  const setLimit = (nextLimit: number) => {
    setLimitState(nextLimit);
    setPage(1);
  };

  return { page, limit, setPage, setLimit };
}
