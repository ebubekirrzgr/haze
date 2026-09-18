// haze-terminal: bağımlılıksız statik sunucu (index.html + kit fontları)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
const PORT = Number(process.env.PORT ?? 3001);
const ROOT = new URL(".", import.meta.url).pathname;
const FONTS = join(ROOT, "../web/public/fonts");
const TYPES = { ".html": "text/html; charset=utf-8", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".js": "text/javascript" };
createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  let file = url.pathname === "/" ? join(ROOT, "index.html") : url.pathname.startsWith("/fonts/") ? join(FONTS, normalize(url.pathname.slice(7))) : join(ROOT, normalize(url.pathname));
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(PORT, () => console.log(`haze-terminal http://localhost:${PORT}`));
