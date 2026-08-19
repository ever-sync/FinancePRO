type HealthFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Pick<Response, "ok" | "status">>;

export type SupabaseAuthHealth =
  | { connected: true }
  | { connected: false; error: string };

type SupabaseHealthOptions = {
  supabaseUrl: string;
  supabaseAuthKey: string;
  fetchImpl?: HealthFetch;
  timeoutMs?: number;
};

function isAllowedSupabaseProtocol(url: URL) {
  if (url.protocol === "https:") return true;
  return (
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
  );
}

export async function checkSupabaseAuthConnection({
  supabaseUrl,
  supabaseAuthKey,
  fetchImpl = fetch,
  timeoutMs = 3_000,
}: SupabaseHealthOptions): Promise<SupabaseAuthHealth> {
  if (!supabaseUrl || !supabaseAuthKey) {
    return {
      connected: false,
      error: "Supabase authentication is not configured",
    };
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(supabaseUrl);
  } catch {
    return { connected: false, error: "Supabase URL is invalid" };
  }

  if (
    !isAllowedSupabaseProtocol(baseUrl) ||
    baseUrl.username ||
    baseUrl.password
  ) {
    return { connected: false, error: "Supabase URL is invalid" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(
      new URL("/auth/v1/health", baseUrl.origin),
      {
        method: "GET",
        headers: {
          apikey: supabaseAuthKey,
          authorization: `Bearer ${supabaseAuthKey}`,
        },
        redirect: "error",
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      return {
        connected: false,
        error: `Supabase authentication returned HTTP ${response.status}`,
      };
    }

    return { connected: true };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { connected: false, error: "Supabase authentication timed out" };
    }
    return {
      connected: false,
      error: "Supabase authentication is unreachable",
    };
  } finally {
    clearTimeout(timeout);
  }
}
