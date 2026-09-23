import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Store a submission photo and return its public URL and sha256 (used for
 * duplicate detection). Vercel Blob when BLOB_READ_WRITE_TOKEN is set;
 * otherwise a local-dev fallback under public/uploads so the whole flow works
 * before any Vercel account exists.
 */
export async function saveSubmissionImage(
  buffer: Buffer,
  contentType: string,
): Promise<{ url: string; sha256: string }> {
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const ext = EXTENSIONS[contentType] ?? "jpg";
  const name = `submissions/${sha256}.${ext}`;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import("@vercel/blob");
    const blob = await put(name, buffer, {
      access: "public",
      contentType,
      addRandomSuffix: false,
    });
    return { url: blob.url, sha256 };
  }

  const dir = path.join(process.cwd(), "public", "uploads");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${sha256}.${ext}`), buffer);
  return { url: `/uploads/${sha256}.${ext}`, sha256 };
}
