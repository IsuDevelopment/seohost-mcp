import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomBytes, scryptSync, createHash } from "node:crypto";
import { createHttpServer } from "../src/http.js";
import { createLocalOAuth } from "../src/local-oauth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadSettings } from "../src/config.js";

for (const requestedScope of ["mcp:read", "mcp:read mcp:write"]) {
test(`local OAuth: consent, PKCE, single-use code and revocation (${requestedScope})`, async () => {
  const dir = await mkdtemp(tmpdir() + "/seohost-oauth-");
  const salt = randomBytes(16).toString("hex"),
    password = randomBytes(24).toString("hex");
  const settings = await loadSettings({ MCP_AUTH_TOKEN: "a".repeat(32) });
  settings.localOAuth = {
    allowWrites: true,
    file: dir + "/state.json",
    username: "owner",
    passwordHash: salt + ":" + scryptSync(password, salt, 64).toString("hex"),
    redirects: ["https://client.example/callback"],
  };
  const server = createHttpServer(settings);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  settings.publicUrl = new URL(`http://127.0.0.1:${address.port}/mcp`);
  settings.allowedOrigins.add(settings.publicUrl.origin);
  // Factory binds the resource URL at construction; rebuild using the actual bound port.
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const app = createHttpServer(settings);
  await new Promise<void>((resolve) =>
    app.listen(address.port, "127.0.0.1", resolve),
  );
  const base = settings.publicUrl.origin;
  const post = (path: string, data: Record<string, string>) =>
    fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(data),
      redirect: "manual",
    });
  try {
    assert.equal(
      (await fetch(base + "/.well-known/oauth-authorization-server")).status,
      200,
    );
    const denied = await fetch(base + "/oauth/register", {
      method: "POST",
      body: JSON.stringify({
        redirect_uris: ["https://evil.example/callback"],
      }),
    });
    assert.equal(denied.status, 400);
    const registration = await fetch(base + "/oauth/register", {
      method: "POST",
      body: JSON.stringify({
        redirect_uris: ["https://client.example/callback"],
      }),
    });
    const client = (await registration.json()) as { client_id: string };
    assert.equal(registration.status, 201);
    const verifier = randomBytes(32).toString("base64url");
    const params = {
      client_id: client.client_id,
      redirect_uri: "https://client.example/callback",
      resource: settings.publicUrl.href,
      scope: requestedScope,
      response_type: "code",
      code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      state: "original",
    };
    const page = await fetch(
      base + "/oauth/authorize?" + new URLSearchParams(params),
    );
    assert.equal(page.status, 200);
    const cookie = page.headers.get("set-cookie")!.split(";")[0]!;
    const ticket = (await page.text()).match(
      /name="ticket" value="([^"]+)"/,
    )![1]!;
    const consent = (pass: string) =>
      fetch(base + "/oauth/consent", {
        method: "POST",
        headers: {
          Origin: base,
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          ticket,
          username: "owner",
          password: pass,
          decision: "allow",
        }),
        redirect: "manual",
      });
    assert.equal((await consent("wrong")).status, 401);
    const csrf = await fetch(base + "/oauth/consent", {
      method: "POST",
      body: new URLSearchParams({ ticket, decision: "allow" }),
      redirect: "manual",
    });
    assert.equal(csrf.status, 400);
    const approved = await consent(password);
    assert.equal(approved.status, 303);
    const location = new URL(approved.headers.get("location")!);
    assert.equal(location.searchParams.get("state"), "original");
    const exchange = {
      grant_type: "authorization_code",
      client_id: client.client_id,
      redirect_uri: params.redirect_uri,
      resource: params.resource,
      code: location.searchParams.get("code")!,
      code_verifier: verifier,
    };
    assert.equal(
      (
        await post("/oauth/token", {
          ...exchange,
          code_verifier: "x".repeat(43),
        })
      ).status,
      400,
    );
    const result = await post("/oauth/token", { ...exchange, scope: "mcp:read mcp:write" });
    assert.equal(result.status, 200);
    const granted = (await result.json()) as { access_token: string; scope: string };
    assert.equal(granted.scope, requestedScope);
    const token = granted.access_token;
    assert.equal((await post("/oauth/token", exchange)).status, 400);
    assert.equal(
      (
        await fetch(base + "/mcp", {
          headers: { Authorization: "Bearer " + token },
        })
      ).status,
      405,
    );
    const peer = createLocalOAuth(settings.localOAuth!, settings.publicUrl);
    assert.equal(peer.verify(token), true);
    assert.equal(peer.authorize(token)?.canWrite, requestedScope.includes("mcp:write"));
    const mcp = new Client({ name: "oauth-test", version: "1" });
    await mcp.connect(
      new StreamableHTTPClientTransport(settings.publicUrl, {
        requestInit: { headers: { Authorization: "Bearer " + token } },
      }),
    );
    assert.equal((await mcp.listTools()).tools.length, 20);
    const rejected = await mcp.callTool({ name: 'plan_hosting_change', arguments: { serverId: 'primary', change: { operation: 'create_domain', domain: 'new.example' } } });
    assert.equal(rejected.isError, true);
    assert.equal((rejected.structuredContent as { error: { code: string } }).error.code, requestedScope.includes('mcp:write') ? 'WRITE_DISABLED' : 'WRITE_SCOPE_REQUIRED');
    await mcp.close();
    await post("/oauth/revoke", { token });
    assert.equal(peer.verify(token), false);
    peer.close();
    assert.equal(
      (
        await fetch(base + "/mcp", {
          headers: { Authorization: "Bearer " + token },
        })
      ).status,
      401,
    );
  } finally {
    await new Promise<void>((resolve) => app.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

}
