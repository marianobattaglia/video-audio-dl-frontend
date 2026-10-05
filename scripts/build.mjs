import { cp, mkdir, writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);

export async function build({ local = false } = {}) {
  const raw = process.env.API_BASE_URL || (local ? "http://localhost:3000" : "");
  if (!raw) throw new Error("Set API_BASE_URL to the backend origin before building.");
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" || !["http:", "https:"].includes(url.protocol)) {
    throw new Error("API_BASE_URL must be an HTTP/HTTPS origin without credentials, path, query or fragment.");
  }
  if (!local && url.protocol !== "https:") throw new Error("Deployed API_BASE_URL must use HTTPS.");
  if (local && url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Local HTTP API must use a loopback origin.");
  const output = new URL("dist/", root);
  await mkdir(output, { recursive: true });
  await cp(new URL("public/", root), output, { recursive: true });
  const policy = `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ${url.origin}; base-uri 'none'; form-action 'self'`;
  const attribute = policy.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const source = await readFile(new URL("public/index.html", root), "utf8");
  if (!source.includes('<meta charset="utf-8">')) throw new Error("Missing document charset for CSP insertion.");
  await writeFile(new URL("index.html", output), source.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n    <meta http-equiv="Content-Security-Policy" content="${attribute}">`));
  // Only this public setting is serialized. Never serialize process.env.
  await writeFile(new URL("config.js", output), `window.APP_CONFIG = Object.freeze(${JSON.stringify({ apiBaseUrl: url.origin })});\n`);
  return fileURLToPath(output);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await build();
  process.stdout.write("Static frontend built in dist/\n");
}
