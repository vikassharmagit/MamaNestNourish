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

const TRUSTED_SOURCE_HOSTS = [
  "who.int",
  "acog.org",
  "nhs.uk",
  "cdc.gov",
  "fda.gov",
  "usda.gov",
  "nal.usda.gov",
  "medlineplus.gov",
  "niddk.nih.gov"
];

const ALLERGEN_METADATA = {
  dairy: {
    terms: ["dairy", "milk", "curd", "yogurt", "yoghurt", "paneer", "cheese", "raita"],
    substitution: "calcium-fortified dairy-free alternative"
  },
  egg: {
    terms: ["egg", "eggs", "omelet", "omelette", "bhurji"],
    substitution: "dal, beans, tofu, or other tolerated protein"
  },
  fish: {
    terms: ["fish", "seafood", "salmon", "tuna", "sardine", "mackerel"],
    substitution: "clinician-approved omega-3 alternative"
  },
  shellfish: {
    terms: ["shellfish", "shrimp", "prawn", "prawns", "crab", "lobster", "mussel", "mussels"],
    substitution: "beans, lentils, tofu, or other tolerated protein"
  },
  peanut: {
    terms: ["peanut", "peanuts"],
    substitution: "seeds, roasted chana, beans, or tofu if tolerated"
  },
  tree_nut: {
    terms: ["tree nut", "tree nuts", "almond", "cashew", "walnut"],
    substitution: "seeds, roasted chana, beans, or tofu if tolerated"
  },
  soy: {
    terms: ["soy", "soya", "tofu", "edamame"],
    substitution: "beans, lentils, seeds, or other tolerated protein"
  },
  gluten: {
    terms: ["gluten", "wheat", "bread", "toast", "chapati", "roti", "dalia", "whole-grain", "wholemeal"],
    substitution: "gluten-free grain option"
  },
  poultry: {
    terms: ["chicken", "poultry"],
    substitution: "dal, beans, tofu, or other tolerated protein"
  }
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

function trustedSourceUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return TRUSTED_SOURCE_HOSTS.some((trustedHost) => host === trustedHost || host.endsWith(`.${trustedHost}`));
  } catch {
    return false;
  }
}

function textFromHtml(html = "") {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlMatch(html = "", pattern) {
  const cleanedHtml = String(html).replace(/<!--[\s\S]*?-->/g, " ");
  const match = cleanedHtml.match(pattern);
  return match?.[1]?.replace(/\s+/g, " ").trim() || "";
}

function sourceSnapshot(html = "", source = {}) {
  const text = textFromHtml(html);
  const lowerCategory = String(source.category || "").toLowerCase();
  const keywords = [
    "pregnancy",
    "antenatal",
    "nutrition",
    "food",
    "exercise",
    "physical activity",
    "vitamin",
    "mineral",
    "fetal",
    "safety",
    "allergy"
  ];
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => {
      const lower = sentence.toLowerCase();
      return sentence.length >= 40 &&
        sentence.length <= 420 &&
        !/(skip to|select language|search|menu|cookie|log in|subscribe|official website|here's how you know)/i.test(sentence) &&
        (keywords.some((keyword) => lower.includes(keyword)) || lowerCategory.split("-").some((part) => part && lower.includes(part)));
    })
    .map((sentence) => sentence.slice(0, 280))
    .slice(0, 5);

  return {
    title: htmlMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i) || source.name,
    description: htmlMatch(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i),
    guidanceSnippets: sentences,
    fetchedAt: new Date().toISOString()
  };
}

function approved(items) {
  return items.filter((item) => item.reviewStatus === "approved").map(withAllergenMetadata);
}

function withAllergenMetadata(item) {
  const haystack = [item.name, item.portionNotes, item.activity, item.benefit, ...(item.steps || [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const matches = Object.entries(ALLERGEN_METADATA)
    .filter(([, meta]) => meta.terms.some((term) => haystack.includes(term)))
    .map(([allergen, meta]) => ({ allergen, ...meta }));

  return {
    ...item,
    allergens: item.allergens || matches.map((match) => match.allergen),
    avoidTerms: item.avoidTerms || [...new Set(matches.flatMap((match) => match.terms))],
    substitutions: item.substitutions || Object.fromEntries(matches.map((match) => [match.allergen, match.substitution]))
  };
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
      if (!trustedSourceUrl(source.url)) {
        throw new Error(`Source host is not in the trusted allowlist: ${source.url}`);
      }

      const response = await fetch(source.url, {
        method: "GET",
        headers: { "User-Agent": "MamaNestNourish source monitor/1.0" }
      });
      const lastModified = response.headers.get("last-modified") || "";
      const etag = response.headers.get("etag") || "";
      const status = response.status;
      const html = await response.text();
      const snapshot = sourceSnapshot(html, source);
      const changed = Boolean(
        (lastModified && lastModified !== source.lastModified) ||
        (etag && etag !== source.etag) ||
        (snapshot.title && snapshot.title !== source.title) ||
        JSON.stringify(snapshot.guidanceSnippets || []) !== JSON.stringify(source.guidanceSnippets || [])
      );

      if (changed) {
        const id = `source-${source.id}-${Date.now()}`;
        const update = {
          id,
          type: "source-auto-apply",
          status: "approved",
          collection: null,
          createdAt: checkedAt,
          sourceId: source.id,
          sourceName: source.name,
          sourceUrl: source.url,
          summary: "Official source content or metadata changed and was auto-applied after validation.",
          previous: {
            lastModified: source.lastModified || "",
            etag: source.etag || "",
            title: source.title || "",
            guidanceSnippets: source.guidanceSnippets || []
          },
          observed: { status, lastModified, etag, ...snapshot },
          reviewedBy: "automation",
          reviewedAt: checkedAt
        };
        pending.push(update);
        created.push(update);
      }

      source.lastCheckedAt = checkedAt;
      source.lastFetchedAt = checkedAt;
      source.lastStatus = status;
      source.title = snapshot.title;
      source.description = snapshot.description;
      source.guidanceSnippets = snapshot.guidanceSnippets;
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

export function validateTrustedSources(sources = readJson(DATA_FILES.sources)) {
  const invalid = sources.filter((source) => !trustedSourceUrl(source.url));
  if (invalid.length) {
    throw new Error(`Untrusted source URLs: ${invalid.map((source) => source.url).join(", ")}`);
  }
  return true;
}

export { TRUSTED_SOURCE_HOSTS, trustedSourceUrl, sourceSnapshot };
