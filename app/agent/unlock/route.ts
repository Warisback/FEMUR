import { NextResponse } from "next/server";

export const runtime = "nodejs";

const FORM = (wrong: boolean) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Legwork console</title>
<style>
  body{margin:0;display:grid;place-items:center;min-height:100dvh;background:#f6f5f0;color:#1c1e24;font:16px/1.5 system-ui}
  form{display:flex;flex-direction:column;gap:12px;width:min(320px,90vw)}
  input{font:inherit;padding:10px 12px;border:1px solid #dad8d0;border-radius:6px;background:#f6f5f0}
  button{font:inherit;font-weight:500;padding:10px 12px;border:1px solid #1c1e24;border-radius:6px;background:#1c1e24;color:#f6f5f0;cursor:pointer}
  p{margin:0;font-size:14px;color:${"#c0392b"}}
</style></head><body>
<form method="get" action="/agent/unlock">
  <h1 style="font-size:20px;margin:0">Legwork console</h1>
  ${wrong ? "<p>That passcode is not right.</p>" : ""}
  <input name="code" type="password" placeholder="Passcode" autofocus autocomplete="current-password">
  <button type="submit">Open the console</button>
</form>
</body></html>`;

export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code");
  const passcode = process.env.ADMIN_PASSCODE;
  if (code && passcode && code === passcode) {
    const res = NextResponse.redirect(new URL("/agent", req.url));
    res.cookies.set("legwork_admin", passcode, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return res;
  }
  return new Response(FORM(code !== null), {
    status: code !== null ? 401 : 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
