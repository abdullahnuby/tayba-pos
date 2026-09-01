/**
 * Cloudflare KV-backed cache with a safe local fallback.
 *
 * IMPORTANT:
 * Do not use a static `cloudflare:workers` import here.
 * Vinext/Rolldown can try to resolve that module during the build,
 * which causes:
 *
 *   failed to resolve import "cloudflare:workers"
 *
 * The runtime environment is obtained indirectly through globalThis
 * when available. In normal Cloudflare Worker execution, the env
 * binding can be exposed by the request/runtime layer.
 */

type KVLike = {
  get(key: string, type?: 'text' | 'json'): Promise<any>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number }
  ): Promise<void>;
  delete(key: string): Promise<void>;
};

type CloudflareEnv = {
  VINEXT_KV_CACHE?: KVLike;
  SHEETS_CACHE_TTL_SECONDS?: string;
};

type RuntimeWithEnv = {
  env?: CloudflareEnv;
};

let localCache = new Map<
  string,
  {
    value: string;
    expiresAt: number;
  }
>();

/**
 * Get Cloudflare environment without importing `cloudflare:workers`.
 *
 * This function intentionally avoids both:
 *
 *   import 'cloudflare:workers'
 *
 * and
 *
 *   import('cloudflare:workers')
 *
 * because Rolldown/Vinext may attempt to resolve the module while
 * building the application.
 *
 * We first check known runtime globals. If no runtime environment
 * is available, we simply use the local in-memory cache.
 */
function getRuntimeEnv(): CloudflareEnv {
  try {
    const runtime = globalThis as typeof globalThis & {
      __ENV__?: CloudflareEnv;
      __cloudflare_env__?: CloudflareEnv;
      __vinext_env__?: CloudflareEnv;
      env?: CloudflareEnv;
    };

    if (runtime.__ENV__) {
      return runtime.__ENV__;
    }

    if (runtime.__cloudflare_env__) {
      return runtime.__cloudflare_env__;
    }

    if (runtime.__vinext_env__) {
      return runtime.__vinext_env__;
    }

    if (runtime.env) {
      return runtime.env;
    }
  } catch {
    // Ignore runtime detection errors.
  }

  return {};
}

/**
 * Optional runtime environment setter.
 *
 * If the Cloudflare/Vinext request layer provides the Worker env,
 * it can register it here without this module knowing anything
 * about Cloudflare's special module system.
 */
export function setCacheRuntimeEnv(env: CloudflareEnv | undefined): void {
  if (!env) return;

  try {
    const runtime = globalThis as typeof globalThis & {
      __ENV__?: CloudflareEnv;
    };

    runtime.__ENV__ = env;
  } catch {
    // Ignore environments where globalThis cannot be extended.
  }
}

/**
 * Read a cached value.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const env = getRuntimeEnv();

  if (env.VINEXT_KV_CACHE) {
    try {
      const value = await env.VINEXT_KV_CACHE.get(key, 'json');

      return value ?? null;
    } catch {
      // If KV is unavailable, fall back to local cache.
    }
  }

  const hit = localCache.get(key);

  if (!hit) {
    return null;
  }

  if (hit.expiresAt < Date.now()) {
    localCache.delete(key);
    return null;
  }

  try {
    return JSON.parse(hit.value) as T;
  } catch {
    localCache.delete(key);
    return null;
  }
}

/**
 * Store a cached value.
 */
export async function cachePut(
  key: string,
  value: unknown,
  ttlSeconds?: number
): Promise<void> {
  const env = getRuntimeEnv();

  const configuredTtl = Number(
    env.SHEETS_CACHE_TTL_SECONDS || 60
  );

  const ttl =
    ttlSeconds !== undefined && Number.isFinite(ttlSeconds)
      ? ttlSeconds
      : Number.isFinite(configuredTtl)
        ? configuredTtl
        : 60;

  const safeTtl = Math.max(30, ttl);

  if (env.VINEXT_KV_CACHE) {
    try {
      await env.VINEXT_KV_CACHE.put(
        key,
        JSON.stringify(value),
        {
          expirationTtl: safeTtl,
        }
      );

      return;
    } catch {
      // Fall through to local cache.
    }
  }

  localCache.set(key, {
    value: JSON.stringify(value),
    expiresAt: Date.now() + safeTtl * 1000,
  });
}

/**
 * Delete a cached value.
 */
export async function cacheDelete(key: string): Promise<void> {
  const env = getRuntimeEnv();

  if (env.VINEXT_KV_CACHE) {
    try {
      await env.VINEXT_KV_CACHE.delete(key);
    } catch {
      // Continue and delete local copy as well.
    }
  }

  localCache.delete(key);
}

/**
 * Invalidate a cache namespace.
 *
 * We intentionally do not enumerate/delete all KV keys because that
 * would be expensive on the request path.
 *
 * Versioned invalidation can be consumed by callers as needed.
 */
export async function cacheInvalidate(prefix: string): Promise<void> {
  await cachePut(
    `tayba:cache-version:${prefix}`,
    Date.now().toString(),
    86400
  );
}