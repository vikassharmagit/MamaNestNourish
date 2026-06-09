import http from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { authConfig, confirmSignUp, login, requireAuth, resendConfirmationCode, signUp, verifyCognitoToken } from "./auth.js";
import { approvePendingUpdate, listPendingUpdates, refreshSourceChecks, rejectPendingUpdate } from "./dataStore.js";
import { createPlanDocx } from "./docxExport.js";
import { runPregnancyPlan } from "./pregnancyAgent.js";
import { listUserRecords, recordAuthEvent, requireAdmin, saveUserPlan } from "./userStore.js";

const PORT = Number(process.env.PORT || 3000);
const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");
const ASSETS_DIR = join(PUBLIC_DIR, "assets");

const CONTENT_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

async function writeEventStream(req, res) {
  const user = await requireAuth(req);
  const input = await readJson(req);
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*"
  });

  for await (const event of runPregnancyPlan(input)) {
    if (event.type === "done" && event.summary === "Plan complete") {
      saveUserPlan({ user, input, plan: event.output });
    }
    res.write(`${JSON.stringify(event)}\n`);
  }
  res.end();
}

async function requireAdminFromRequest(req) {
  const user = await requireAuth(req);
  return requireAdmin(user);
}

async function userFromAuthResult(result) {
  if (!result?.tokens?.IdToken) return {};
  try {
    return await verifyCognitoToken(result.tokens.IdToken);
  } catch {
    return {};
  }
}

function writeJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(body));
}

async function writePlanDocx(req, res) {
  await requireAuth(req);
  const body = await readJson(req);
  const plan = body.plan || body;
  const docx = createPlanDocx(plan);
  const week = plan.profile?.gestationalWeek ?? "plan";
  res.writeHead(200, {
    "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "Content-Disposition": `attachment; filename="MamaNestNourish-week-${week}.docx"`,
    "Access-Control-Allow-Origin": "*"
  });
  res.end(docx);
}

async function writeStaticAsset(req, res, pathname) {
  const assetName = decodeURIComponent(pathname.replace("/assets/", ""));
  const assetPath = normalize(join(ASSETS_DIR, assetName));
  if (!assetPath.startsWith(`${ASSETS_DIR}${sep}`)) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  const content = await readFile(assetPath);
  res.writeHead(200, {
    "Content-Type": CONTENT_TYPES[extname(assetPath).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "public, max-age=86400"
  });
  res.end(req.method === "HEAD" ? undefined : content);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
      });
      res.end();
      return;
    }

    if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/") {
      const html = await readFile(join(PUBLIC_DIR, "index.html"), "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(req.method === "HEAD" ? undefined : html);
      return;
    }

    if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(req.method === "HEAD" ? undefined : JSON.stringify({ ok: true }));
      return;
    }

    if ((req.method === "GET" || req.method === "HEAD") && url.pathname.startsWith("/assets/")) {
      await writeStaticAsset(req, res, url.pathname);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/auth/config") {
      writeJson(res, 200, authConfig());
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/signup") {
      const body = await readJson(req);
      const result = await signUp(body);
      const user = await userFromAuthResult(result);
      recordAuthEvent({
        user,
        identifier: body.identifier || body.email,
        eventType: result.tokens?.IdToken ? "signup-login" : "signup-started",
        confirmed: Boolean(result.confirmed || result.tokens?.IdToken)
      });
      writeJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/confirm") {
      const body = await readJson(req);
      const result = await confirmSignUp(body);
      recordAuthEvent({
        identifier: body.identifier || body.email,
        eventType: "signup-confirmed",
        confirmed: true
      });
      writeJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/resend") {
      writeJson(res, 200, await resendConfirmationCode(await readJson(req)));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/login") {
      const body = await readJson(req);
      const result = await login(body);
      const user = await userFromAuthResult(result);
      recordAuthEvent({
        user,
        identifier: body.identifier || body.email,
        eventType: "login",
        confirmed: Boolean(result.tokens?.IdToken)
      });
      writeJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/plan/stream") {
      await writeEventStream(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/plan/docx") {
      await writePlanDocx(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/admin/pending-updates") {
      await requireAdminFromRequest(req);
      writeJson(res, 200, { updates: listPendingUpdates() });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/admin/users") {
      await requireAdminFromRequest(req);
      writeJson(res, 200, { users: listUserRecords() });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/admin/approve-update") {
      const user = await requireAdminFromRequest(req);
      const body = await readJson(req);
      writeJson(res, 200, { update: approvePendingUpdate(body.id, user.email || user.sub || "admin") });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/admin/reject-update") {
      const user = await requireAdminFromRequest(req);
      const body = await readJson(req);
      writeJson(res, 200, { update: rejectPendingUpdate(body.id, user.email || user.sub || "admin", body.reason || "") });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/admin/refresh-sources") {
      await requireAdminFromRequest(req);
      writeJson(res, 200, await refreshSourceChecks());
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  } catch (error) {
    writeJson(res, error.statusCode || 400, { error: error.message });
  }
});

if (process.argv[1] && (import.meta.url === pathToFileURL(process.argv[1]).href || process.env.pm_id)) {
  server.listen(PORT, () => {
    console.log(`Pregnancy planning API listening on http://localhost:${PORT}`);
  });
}

export { server };
