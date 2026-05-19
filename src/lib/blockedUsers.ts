export const BLOCKED_USER_IDS: ReadonlySet<string> = new Set([
  "d259b282-dd5f-4b7c-8bd0-33029ae578b5",
]);

export function isBlockedUser(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return BLOCKED_USER_IDS.has(userId);
}
