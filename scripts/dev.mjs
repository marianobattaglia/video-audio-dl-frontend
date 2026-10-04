import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { build } from "./build.mjs";

const output = await build({ local: true });
const port = Number(process.env.FRONTEND_PORT || 5173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid FRONTEND_PORT");
const files = new Map([["/", "index.html"], ["/index.html", "index.html"], ["/app.js", "app.js"], ["/config.js", "config.js"], ["/styles.css", "styles.css"]]);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
http.createServer(async (req, res) => {
  const name = files.get(new URL(req.url, "http://localhost").pathname);
  if (!name || !["GET", "HEAD"].includes(req.method)) { res.writeHead(404); res.end(); return; }
  try {
    const body = await readFile(path.join(output, name));
    res.writeHead(200, { "Content-Type": `${types[path.extname(name)]}; charset=utf-8`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch { res.writeHead(500); res.end("No se pudo cargar la página."); }
}).listen(port, "127.0.0.1", () => process.stdout.write(`Frontend: http://localhost:${port}\n`));
