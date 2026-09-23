/**
 * Console gate shared by admin routes. The Phase 5 middleware and
 * /agent/unlock cookie flow build on this; until then the passcode itself
 * (header or cookie) is the gate.
 */
export function isAdmin(req: Request): boolean {
  const passcode = process.env.ADMIN_PASSCODE;
  if (!passcode) return false;
  if (req.headers.get("x-admin-passcode") === passcode) return true;
  const cookies = req.headers.get("cookie") ?? "";
  return cookies.split(/;\s*/).includes(`legwork_admin=${passcode}`);
}
