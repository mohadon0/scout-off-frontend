/**
 * In-memory JWT blocklist.
 *
 * Stores revoked token identifiers (jti). When a token has no jti the full
 * token string is used as the key so arbitrary tokens can still be revoked.
 *
 * This is intentionally a module-level singleton so the same set is shared
 * across all Next.js API route invocations within the same Node.js process.
 * In a multi-instance deployment you would replace this with a shared store
 * (Redis, DB row, etc.) — the interface is kept deliberately small so that
 * swap is straightforward.
 */

const blocklist = new Set<string>();

/**
 * Mark a token as revoked. Pass the token's `jti` claim when present;
 * otherwise pass the raw token string.
 */
export function revokeToken(key: string): void {
  blocklist.add(key);
}

/**
 * Returns `true` if the token has been revoked.
 * @param key - The token's `jti` claim, or the raw token string if no jti.
 */
export function isRevoked(key: string): boolean {
  return blocklist.has(key);
}

/**
 * Remove a token from the blocklist (useful in tests or explicit un-revoke
 * flows). Returns `true` if the key was present and removed.
 */
export function removeRevocation(key: string): boolean {
  return blocklist.delete(key);
}

/** Clear all revocations. Intended for use in tests only. */
export function clearBlocklist(): void {
  blocklist.clear();
}
