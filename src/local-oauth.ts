import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const random = () => randomBytes(32).toString("base64url");
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
type Client = { redirect_uris: string[]; client_name: string };
type Grant = {
  scope?: string;
  client: string;
  redirect: string;
  challenge: string;
  resource: string;
  expires: number;
};
type State = {
  clients: Record<string, Client>;
  codes: Record<string, Grant>;
  tokens: Record<string, { expires: number; client: string; scope?: string }>;
};
export interface LocalOAuthConfig {
  allowWrites?: boolean;
  file: string;
  passwordHash: string;
  username: string;
  redirects: string[];
}
export function createLocalOAuth(config: LocalOAuthConfig, resource: URL) {
  mkdirSync(dirname(config.file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(config.file);
  chmodSync(config.file, 0o600);
  db.exec(
    "PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS oauth_state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)",
  );
  type Pending = {
    grant: Grant;
    state: string;
    cookie: string;
    expires: number;
  };
  type Stored = State & {
    pending: [string, Pending][];
    failures: number;
    blockedUntil: number;
  };
  const initial: Stored = {
    clients: {},
    codes: {},
    tokens: {},
    pending: [],
    failures: 0,
    blockedUntil: 0,
  };
  db.prepare("INSERT OR IGNORE INTO oauth_state VALUES (1, ?)").run(
    JSON.stringify(initial),
  );
  const read = () =>
    JSON.parse(
      (
        db.prepare("SELECT value FROM oauth_state WHERE id=1").get() as {
          value: string;
        }
      ).value,
    ) as Stored;
  let state = initial;
  let pending = new Map<string, Pending>();
  let failures = 0,
    blockedUntil = 0;
  const save = () => {
    const now = Date.now();
    for (const [key, value] of Object.entries(state.codes))
      if (value.expires < now) delete state.codes[key];
    for (const [key, value] of Object.entries(state.tokens))
      if (value.expires < now) delete state.tokens[key];
  };
  const send = (res: ServerResponse, code: number, data: unknown) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };
  async function body(req: IncomingMessage) {
    let data = "";
    for await (const chunk of req) {
      data += chunk.toString();
      if (Buffer.byteLength(data) > 16384) throw new Error("body too large");
    }
    return data;
  }
  const issuer = resource.origin;
  const validScope = (scope: string) => {
    const parts = scope.split(/\s+/);
    return parts.includes('mcp:read') && parts.every(value => value === 'mcp:read' || (config.allowWrites && value === 'mcp:write'));
  };
  return {
    close() {
      db.close();
    },
    verify(token: string) {
      return (read().tokens[hash(token)]?.expires ?? 0) > Date.now();
    },
    authorize(token: string) {
      const grant = read().tokens[hash(token)];
      if (!grant || grant.expires <= Date.now()) return undefined;
      return { actor: 'local:' + hash(grant.client), canWrite: Boolean(config.allowWrites && grant.scope?.split(/\s+/).includes('mcp:write')) };
    },
    async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
      const url = new URL(req.url!, issuer),
        path = url.pathname;
      if (
        ![
          "/.well-known/oauth-authorization-server",
          "/oauth/register",
          "/oauth/authorize",
          "/oauth/consent",
          "/oauth/token",
          "/oauth/revoke",
        ].includes(path)
      )
        return false;
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      );
      res.setHeader("Referrer-Policy", "no-referrer");
      let raw: string;
      try {
        raw = req.method === "POST" ? await body(req) : "";
      } catch {
        send(res, 413, { error: "invalid_request" });
        return true;
      }
      db.exec("BEGIN IMMEDIATE");
      state = read();
      pending = new Map(state.pending);
      failures = state.failures;
      blockedUntil = state.blockedUntil;
      try {
        if (
          path === "/.well-known/oauth-authorization-server" &&
          req.method === "GET"
        ) {
          send(res, 200, {
            issuer,
            authorization_endpoint: issuer + "/oauth/authorize",
            token_endpoint: issuer + "/oauth/token",
            registration_endpoint: issuer + "/oauth/register",
            revocation_endpoint: issuer + "/oauth/revoke",
            authorization_response_iss_parameter_supported: true,
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code"],
            token_endpoint_auth_methods_supported: ["none"],
            code_challenge_methods_supported: ["S256"],
            scopes_supported: ["mcp:read", ...(config.allowWrites ? ["mcp:write"] : [])],
          });
          return true;
        }
        if (path === "/oauth/register" && req.method === "POST") {
          const input = JSON.parse(raw);
          // Log only fixed reason codes, never submitted values or credentials.
          const invalid: string[] = [];
          if (!input || typeof input !== "object" || Array.isArray(input)) {
            console.error("OAuth registration rejected: metadata_shape");
            send(res, 400, { error: "invalid_client_metadata" });
            return true;
          }
          if (!Array.isArray(input.redirect_uris) || !input.redirect_uris.length || input.redirect_uris.length > 5)
            invalid.push("redirect_uris_shape");
          else if (input.redirect_uris.some((v: unknown) => typeof v !== "string" || !config.redirects.includes(v)))
            invalid.push("redirect_uri_not_allowed");
          if (input.token_endpoint_auth_method && input.token_endpoint_auth_method !== "none") invalid.push("token_endpoint_auth_method");
          if (input.grant_types && JSON.stringify(input.grant_types) !== '["authorization_code"]') invalid.push("grant_types");
          if (input.response_types && JSON.stringify(input.response_types) !== '["code"]') invalid.push("response_types");
          if (input.scope && (typeof input.scope !== 'string' || !validScope(input.scope))) invalid.push("scope");
          if (invalid.length) {
            console.error("OAuth registration rejected: " + invalid.join(","));
            send(res, 400, { error: "invalid_client_metadata", error_description: "Rejected fields: " + invalid.join(", ") });
            return true;
          }
          if (Object.keys(state.clients).length >= 100) {
            send(res, 429, { error: "registration_limit" });
            return true;
          }
          const id = random(),
            client = {
              redirect_uris: input.redirect_uris,
              client_name: String(input.client_name || "MCP client").slice(
                0,
                100,
              ),
            };
          state.clients[id] = client;
          save();
          send(res, 201, {
            client_id: id,
            ...client,
            token_endpoint_auth_method: "none",
            grant_types: ["authorization_code"],
            response_types: ["code"],
          });
          return true;
        }
        if (path === "/oauth/authorize" && req.method === "GET") {
          const q = url.searchParams,
            client = q.get("client_id") || "",
            redirect = q.get("redirect_uri") || "",
            challenge = q.get("code_challenge") || "";
          if (
            !(
              Object.hasOwn(state.clients, client) &&
              state.clients[client]?.redirect_uris.includes(redirect)
            ) ||
            q.get("response_type") !== "code" ||
            q.get("code_challenge_method") !== "S256" ||
            !/^[A-Za-z0-9_-]{43}$/.test(challenge) ||
            q.get("resource") !== resource.href ||
            !validScope(q.get("scope") || '')
          )
            throw new Error("invalid authorization");
          for (const [key, value] of pending)
            if (value.expires < Date.now()) pending.delete(key);
          if (pending.size >= 100) {
            send(res, 429, { error: "too_many_requests" });
            return true;
          }
          const ticket = random(),
            cookie = random(),
            expires = Date.now() + 300000;
          pending.set(ticket, {
            grant: {
              scope: [...new Set(q.get('scope')!.split(/\s+/))].sort().join(' '),
              client,
              redirect,
              challenge,
              resource: resource.href,
              expires,
            },
            state: q.get("state") || "",
            cookie: hash(cookie),
            expires,
          });
          res.setHeader(
            "Set-Cookie",
            `oauth_consent=${cookie}; HttpOnly; SameSite=Lax; Path=/oauth; Max-Age=300${resource.protocol === "https:" ? "; Secure" : ""}`,
          );
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(
            `<!doctype html><html lang="pl"><meta charset="utf-8"><title>SeoHost MCP — dostęp</title><h1>SeoHost MCP</h1><p>Aplikacja: ${escape(state.clients[client]!.client_name)}</p><p>Adres powrotu: ${escape(redirect)}</p><p>${q.get('scope')!.split(/\s+/).includes('mcp:write') ? 'Zezwalasz na odczyt oraz zmiany hostingu i DNS (mcp:read mcp:write), w granicach ustawień konta.' : 'Zezwalasz na odczyt informacji MCP (mcp:read).'}</p><form method="post" action="/oauth/consent"><input type="hidden" name="ticket" value="${ticket}"><label>Login <input name="username" autocomplete="username" required></label><label>Hasło <input type="password" name="password" autocomplete="current-password" required></label><button name="decision" value="allow">Zaloguj i zezwól</button><button name="decision" value="deny" formnovalidate>Odmów</button></form></html>`,
          );
          return true;
        }
        if (path === "/oauth/consent" && req.method === "POST") {
          const q = new URLSearchParams(raw),
            ticket = q.get("ticket") || "",
            item = pending.get(ticket);
          const cookie =
            req.headers.cookie?.match(/(?:^|;\s*)oauth_consent=([^;]+)/)?.[1] ||
            "";
          if (
            !item ||
            item.expires < Date.now() ||
            hash(cookie) !== item.cookie ||
            req.headers.origin !== issuer
          )
            throw new Error("invalid consent");
          const target = new URL(item.grant.redirect);
          if (q.get("decision") === "deny") {
            pending.delete(ticket);
            target.searchParams.set("error", "access_denied");
          } else {
            if (q.get("decision") !== "allow")
              throw new Error("invalid decision");
            if (blockedUntil > Date.now()) {
              send(res, 429, { error: "try_later" });
              return true;
            }
            const [salt, digest] = config.passwordHash.split(":");
            const actual = scryptSync(
                (q.get("password") || "").slice(0, 1024),
                salt!,
                64,
              ),
              expected = Buffer.from(digest!, "hex");
            if (
              q.get("username") !== config.username ||
              !timingSafeEqual(actual, expected)
            ) {
              failures++;
              if (failures >= 5) {
                blockedUntil = Date.now() + 60000;
                failures = 0;
              }
              send(res, 401, { error: "invalid_login" });
              return true;
            }
            failures = 0;
            pending.delete(ticket);
            const code = random();
            state.codes[hash(code)] = item.grant;
            save();
            target.searchParams.set("code", code);
          }
          target.searchParams.set("state", item.state);
          target.searchParams.set("iss", issuer);
          res.writeHead(303, {
            Location: target.href,
            "Set-Cookie":
              "oauth_consent=; HttpOnly; SameSite=Lax; Path=/oauth; Max-Age=0",
          });
          res.end();
          return true;
        }
        if (path === "/oauth/token" && req.method === "POST") {
          const q = new URLSearchParams(raw),
            key = hash(q.get("code") || ""),
            grant = state.codes[key];
          if (
            !grant ||
            grant.expires < Date.now() ||
            q.get("grant_type") !== "authorization_code" ||
            q.get("client_id") !== grant.client ||
            q.get("redirect_uri") !== grant.redirect ||
            q.get("resource") !== grant.resource ||
            !/^[A-Za-z0-9._~-]{43,128}$/.test(q.get("code_verifier") || "") ||
            createHash("sha256")
              .update(q.get("code_verifier")!)
              .digest("base64url") !== grant.challenge
          ) {
            send(res, 400, { error: "invalid_grant" });
            return true;
          }
          delete state.codes[key];
          const token = random();
          state.tokens[hash(token)] = {
            scope: grant.scope || 'mcp:read',
            client: grant.client,
            expires: Date.now() + 3600000,
          };
          save();
          send(res, 200, {
            access_token: token,
            token_type: "Bearer",
            expires_in: 3600,
            scope: grant.scope || 'mcp:read',
          });
          return true;
        }
        if (path === "/oauth/revoke" && req.method === "POST") {
          const q = new URLSearchParams(raw);
          delete state.tokens[hash(q.get("token") || "")];
          save();
          send(res, 200, {});
          return true;
        }
        send(res, 405, { error: "method_not_allowed" });
        return true;
      } catch {
        send(res, 400, { error: "invalid_request" });
        return true;
      } finally {
        save();
        state.pending = [...pending];
        state.failures = failures;
        state.blockedUntil = blockedUntil;
        try {
          db.prepare("UPDATE oauth_state SET value=? WHERE id=1").run(
            JSON.stringify(state),
          );
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      }
    },
  };
}
