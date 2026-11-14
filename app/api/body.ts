// Reading an untrusted request body with a size bound. Nothing past the bound is kept in memory or parsed.

/** The body as text, or `tooLarge` when it is longer than `max` bytes (by its Content-Length, or while it is read). */
export async function readText(req: Request, max: number): Promise<{ text: string } | { tooLarge: true }> {
  if (Number(req.headers.get("content-length") ?? 0) > max) return { tooLarge: true };
  const reader = req.body?.getReader();
  if (!reader) return { text: "" };
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return { tooLarge: true };
    }
    chunks.push(value);
  }
  return { text: Buffer.concat(chunks).toString("utf8") };
}

/** The body as JSON (null when it is not JSON), with the same bound. */
export async function readJson(req: Request, max: number): Promise<{ json: unknown } | { tooLarge: true }> {
  const r = await readText(req, max);
  if ("tooLarge" in r) return r;
  try {
    return { json: JSON.parse(r.text) };
  } catch {
    return { json: null };
  }
}
