import { describe, expect, it } from "vitest";
import { calculatePagination, resolvePagination } from "./pagination";

describe("financial pagination", () => {
  it("returns every row when pagination was not explicitly requested", () => {
    expect(resolvePagination(undefined, 137)).toEqual({ page: 1, limit: 137 });
    expect(calculatePagination(1, 137, 137)).toEqual({
      page: 1,
      limit: 137,
      total: 137,
      totalPages: 1,
      hasMore: false,
    });
  });

  it("bounds explicit page sizes used by public list endpoints", () => {
    expect(resolvePagination({ page: -3, limit: 5_000 }, 20_000)).toEqual({
      page: 1,
      limit: 100,
    });
  });
});
