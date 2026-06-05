import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");

const DATA_FILES = {
  meals: "meals.json",
  snacks: "snacks.json",
  exercises: "exercises.json",
  nutrients: "nutrients.json",
  safetyRules: "safety-rules.json",
  fetalGrowth: "fetal-growth.json",
  sources: "sources.json",
  pendingUpdates: "pending-updates.json"
};

function dataPath(fileName) {
  return join(DATA_DIR, fileName);
}

function readJson(fileName) {
  return JSON.parse(readFileSync(dataPath(fileName), "utf8"));
}

function writeJson(fileName, value) {
  writeFileSync(dataPath(fileName), `${JSON.stringify(value, null, 2)}\n`);
}

function approved(items) {
  return items.filter((item) => item.reviewStatus === "approved");
}

export function loadApprovedPlanningData() {
  return {
    meals: approved(readJson(DATA_FILES.meals)),
    snacks: approved(readJson(DATA_FILES.snacks)),
    exercises: approved(readJson(DATA_FILES.exercises)),
    nutrients: readJson(DATA_FILES.nutrients),
    safetyRules: approved(readJson(DATA_FILES.safetyRules)),
    fetalGrowth: approved(readJson(DATA_FILES.fetalGrowth)),
    sources: readJson(DATA_FILES.sources)
  };
}

export function listPendingUpdates() {
  return readJson(DATA_FILES.pendingUpdates);
}

function collectionFile(collection) {
  const fileName = DATA_FILES[collection];
  if (!fileName || collection === "pendingUpdates") {
    const error = new Error(`Unsupported update collection: ${collection}`);
    error.statusCode = 400;
    throw error;
  }
  return fileName;
}

export function approvePendingUpdate(updateId, reviewer = "admin") {
  const pending = listPendingUpdates();
  const update = pending.find((item) => item.id === updateId);
  if (!update) {
    const error = new Error("Pending update not found");
    error.statusCode = 404;
    throw error;
  }

  if (update.status !== "pending") {
    const error = new Error(`Pending update is already ${update.status}`);
    error.statusCode = 400;
    throw error;
  }

  if (update.collection && update.record) {
    const fileName = collectionFile(update.collection);
    const records = readJson(fileName);
    const nextRecord = {
      ...update.record,
      reviewStatus: "approved",
      lastReviewedAt: new Date().toISOString().slice(0, 10)
    };
    const existingIndex = records.findIndex((record) => record.id === nextRecord.id);
    if (existingIndex >= 0) {
      records[existingIndex] = { ...records[existingIndex], ...nextRecord };
    } else {
      records.push(nextRecord);
    }
    writeJson(fileName, records);
  }

  const reviewedAt = new Date().toISOString();
  const updated = pending.map((item) =>
    item.id === updateId
      ? { ...item, status: "approved", reviewedBy: reviewer, reviewedAt }
      : item
  );
  writeJson(DATA_FILES.pendingUpdates, updated);
  return updated.find((item) => item.id === updateId);
}

export function rejectPendingUpdate(updateId, reviewer = "admin", reason = "") {
  const pending = listPendingUpdates();
  const update = pending.find((item) => item.id === updateId);
  if (!update) {
    const error = new Error("Pending update not found");
    error.statusCode = 404;
    throw error;
  }

  const reviewedAt = new Date().toISOString();
  const updated = pending.map((item) =>
    item.id === updateId
      ? { ...item, status: "rejected", reviewedBy: reviewer, reviewedAt, rejectionReason: reason }
      : item
  );
  writeJson(DATA_FILES.pendingUpdates, updated);
  return updated.find((item) => item.id === updateId);
}

export async function refreshSourceChecks() {
  const sources = readJson(DATA_FILES.sources);
  const pending = listPendingUpdates();
  const checkedAt = new Date().toISOString();
  const created = [];

  for (const source of sources) {
    try {
      const response = await fetch(source.url, { method: "HEAD" });
      const lastModified = response.headers.get("last-modified") || "";
      const etag = response.headers.get("etag") || "";
      const status = response.status;
      const changed = Boolean(
        (lastModified && lastModified !== source.lastModified) ||
        (etag && etag !== source.etag)
      );

      if (changed) {
        const id = `source-${source.id}-${Date.now()}`;
        const update = {
          id,
          type: "source-check",
          status: "pending",
          collection: null,
          createdAt: checkedAt,
          sourceId: source.id,
          sourceName: source.name,
          sourceUrl: source.url,
          summary: "Source metadata changed. Review official guidance before changing approved recommendation data.",
          previous: {
            lastModified: source.lastModified || "",
            etag: source.etag || ""
          },
          observed: { status, lastModified, etag }
        };
        pending.push(update);
        created.push(update);
      }

      source.lastCheckedAt = checkedAt;
      source.lastStatus = status;
      if (lastModified) source.lastModified = lastModified;
      if (etag) source.etag = etag;
    } catch (error) {
      const id = `source-error-${source.id}-${Date.now()}`;
      const update = {
        id,
        type: "source-check-error",
        status: "pending",
        collection: null,
        createdAt: checkedAt,
        sourceId: source.id,
        sourceName: source.name,
        sourceUrl: source.url,
        summary: `Unable to check source: ${error.message}`
      };
      pending.push(update);
      created.push(update);
    }
  }

  writeJson(DATA_FILES.sources, sources);
  writeJson(DATA_FILES.pendingUpdates, pending);
  return { checkedAt, created };
}
