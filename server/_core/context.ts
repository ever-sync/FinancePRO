import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

let supabaseAdmin: SupabaseClient | null = null;

function getSupabaseAdmin() {
  if (supabaseAdmin) return supabaseAdmin;
  if (!ENV.supabaseUrl || !ENV.supabaseAuthKey) {
    return null;
  }

  try {
    supabaseAdmin = createClient(ENV.supabaseUrl, ENV.supabaseAuthKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    return supabaseAdmin;
  } catch (error) {
    console.error("[Auth] Failed to initialize Supabase client:", error);
    return null;
  }
}
const AUTH_CACHE_TTL_MS = 30_000;
const MAX_AUTH_CACHE_ENTRIES = 1_000;
const authCache = new Map<string, { expiresAt: number; user: User }>();
const pendingAuthLookups = new Map<string, Promise<User | null>>();

function getTokenCacheKey(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}

function cacheAuthenticatedUser(cacheKey: string, user: User) {
  const now = Date.now();
  authCache.forEach((value, key) => {
    if (value.expiresAt <= now) authCache.delete(key);
  });

  while (authCache.size >= MAX_AUTH_CACHE_ENTRIES) {
    const oldestKey = authCache.keys().next().value;
    if (!oldestKey) break;
    authCache.delete(oldestKey);
  }

  authCache.set(cacheKey, {
    expiresAt: now + AUTH_CACHE_TTL_MS,
    user,
  });
}

async function resolveAppUserFromToken(token: string): Promise<User | null> {
  if (token.length < 20 || token.length > 16_384) return null;

  const client = getSupabaseAdmin();
  if (!client) {
    console.warn(
      "[Auth] Supabase client is not configured in runtime environment"
    );
    return null;
  }

  const cacheKey = getTokenCacheKey(token);
  const cached = authCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }
  if (cached) authCache.delete(cacheKey);

  const inFlight = pendingAuthLookups.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const lookup = (async () => {
    const {
      data: { user: supaAuthUser },
      error,
    } = await client.auth.getUser(token);

    if (error || !supaAuthUser) return null;

    const openId = supaAuthUser.id;
    const name =
      supaAuthUser.user_metadata?.name ||
      supaAuthUser.email?.split("@")[0] ||
      "Usuario";
    const email = supaAuthUser.email ?? null;

    await db.upsertUser({
      openId,
      name,
      email,
      loginMethod: "supabase",
      lastSignedIn: new Date(),
    });

    const appUser = await db.getUserByOpenId(openId);
    if (appUser) {
      cacheAuthenticatedUser(cacheKey, appUser);
    }

    return appUser ?? null;
  })().finally(() => {
    pendingAuthLookups.delete(cacheKey);
  });

  pendingAuthLookups.set(cacheKey, lookup);
  return lookup;
}

async function authenticateSupabaseRequest(
  req: CreateExpressContextOptions["req"]
): Promise<User | null> {
  const authHeader = (req.headers as Record<string, string | undefined>)[
    "authorization"
  ];
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  return resolveAppUserFromToken(token);
}

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    user = await authenticateSupabaseRequest(opts.req);
  } catch {
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
