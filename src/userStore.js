import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const DEFAULT_STORE_PATH = join(process.cwd(), "runtime", "user-records.json");
const USER_STORE_FILE = process.env.USER_STORE_FILE || DEFAULT_STORE_PATH;
const ADMIN_EMAILS = new Set(
  String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
);

function nowIso() {
  return new Date().toISOString();
}

function emptyStore() {
  return { users: [] };
}

function readStore() {
  try {
    return JSON.parse(readFileSync(USER_STORE_FILE, "utf8"));
  } catch {
    return emptyStore();
  }
}

function writeStore(store) {
  mkdirSync(dirname(USER_STORE_FILE), { recursive: true });
  writeFileSync(USER_STORE_FILE, `${JSON.stringify(store, null, 2)}\n`);
}

function normalizeIdentifier(identifier = "") {
  return String(identifier || "").trim().toLowerCase();
}

function userEmail(user = {}) {
  return normalizeIdentifier(user.email || user["cognito:username"] || user.username);
}

function userKey(user = {}, fallbackIdentifier = "") {
  return String(user.sub || userEmail(user) || normalizeIdentifier(fallbackIdentifier) || "unknown-user");
}

function publicUser(user = {}) {
  return {
    sub: user.sub || null,
    email: userEmail(user) || null,
    username: user["cognito:username"] || user.username || null
  };
}

function upsertByKey(store, key, update) {
  const index = store.users.findIndex((record) => record.key === key);
  if (index >= 0) {
    store.users[index] = {
      ...store.users[index],
      ...update,
      updatedAt: nowIso()
    };
    return store.users[index];
  }

  const record = {
    key,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    authEvents: [],
    savedPlans: [],
    ...update
  };
  store.users.push(record);
  return record;
}

export function isAdminUser(user = {}) {
  if (!ADMIN_EMAILS.size && user.sub === "local-dev") return true;
  return ADMIN_EMAILS.has(userEmail(user));
}

export function requireAdmin(user = {}) {
  if (isAdminUser(user)) return user;
  const error = new Error("Admin access required");
  error.statusCode = 403;
  throw error;
}

export function recordAuthEvent({ user = {}, identifier = "", eventType = "login", confirmed = null } = {}) {
  const store = readStore();
  const key = userKey(user, identifier);
  const record = upsertByKey(store, key, {
    user: publicUser(user),
    identifier: normalizeIdentifier(identifier),
    lastAuthAt: nowIso(),
    lastAuthEvent: eventType
  });
  record.authEvents = [
    ...(record.authEvents || []),
    { type: eventType, confirmed, at: nowIso() }
  ].slice(-25);
  writeStore(store);
  return record;
}

export function saveUserPlan({ user = {}, input = {}, plan = {} } = {}) {
  const store = readStore();
  const key = userKey(user, input.identifier);
  const profile = plan.profile || {};
  const savedPlan = {
    id: `plan-${Date.now()}`,
    createdAt: nowIso(),
    profile,
    input,
    summary: {
      gestationalAge: profile.gestationalAgeLabel || null,
      gestationalWeek: profile.gestationalWeek ?? null,
      dietaryPreferences: profile.dietaryPreferences || null,
      allergies: profile.allergies || [],
      conditions: profile.conditions || [],
      planDays: Array.isArray(plan.weeklyPlan) ? plan.weeklyPlan.length : 0
    },
    plan
  };

  const record = upsertByKey(store, key, {
    user: publicUser(user),
    lastProfile: profile,
    lastPlanAt: savedPlan.createdAt
  });
  record.savedPlans = [savedPlan, ...(record.savedPlans || [])].slice(0, 10);
  writeStore(store);
  return savedPlan;
}

export function listUserRecords() {
  const store = readStore();
  return store.users
    .map((record) => ({
      key: record.key,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      identifier: record.identifier || null,
      user: record.user || {},
      lastAuthAt: record.lastAuthAt || null,
      lastAuthEvent: record.lastAuthEvent || null,
      lastPlanAt: record.lastPlanAt || null,
      lastProfile: record.lastProfile || null,
      savedPlans: record.savedPlans || [],
      planCount: (record.savedPlans || []).length
    }))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
