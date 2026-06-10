const ALLERGEN_RULES = {
  peanut: {
    aliases: ["peanut", "peanuts"],
    pattern: /\bpeanuts?\b/gi,
    replacement: "seeds, roasted chana, beans, or tofu if tolerated"
  },
  nuts: {
    aliases: ["tree nut", "tree nuts", "nut", "nuts", "almond", "cashew", "walnut"],
    pattern: /\b(tree nuts?|nuts?|almonds?|cashews?|walnuts?)\b/gi,
    replacement: "seeds, roasted chana, beans, or tofu if tolerated"
  },
  dairy: {
    aliases: ["dairy", "milk", "curd", "yogurt", "yoghurt", "paneer", "cheese", "raita"],
    pattern: /\b(dairy(?!-free)|milk|curd|yogurts?|yoghurts?|paneer|cheese|raita)\b/gi,
    replacement: "calcium-fortified dairy-free alternative"
  },
  egg: {
    aliases: ["egg", "eggs", "omelet", "omelette", "bhurji"],
    pattern: /\b(eggs?|omelets?|omelettes?|bhurji)\b/gi,
    replacement: "dal, beans, tofu, or other tolerated protein"
  },
  fish: {
    aliases: ["fish", "seafood", "salmon", "tuna", "sardine", "mackerel"],
    pattern: /\b(fish|seafood|salmon|tuna|sardines?|mackerel)\b/gi,
    replacement: "clinician-approved omega-3 alternative"
  },
  shellfish: {
    aliases: ["shellfish", "shrimp", "prawn", "prawns", "crab", "lobster", "mussel", "mussels"],
    pattern: /\b(shellfish|shrimp|prawns?|crab|lobster|mussels?)\b/gi,
    replacement: "beans, lentils, tofu, or other tolerated protein"
  },
  soy: {
    aliases: ["soy", "soya", "tofu", "edamame"],
    pattern: /\b(soy|soya|tofu|edamame)\b/gi,
    replacement: "beans, lentils, seeds, or other tolerated protein"
  },
  gluten: {
    aliases: ["gluten", "wheat", "bread", "toast", "chapati", "roti", "dalia", "whole-grain", "wholemeal"],
    pattern: /\b(gluten(?!-free)|wheat|bread|toast|chapati|roti|dalia|whole-grain|wholemeal)\b/gi,
    replacement: "gluten-free grain option"
  },
  chicken: {
    aliases: ["chicken", "poultry"],
    pattern: /\b(chicken|poultry)\b/gi,
    replacement: "dal, beans, tofu, or other tolerated protein"
  }
};

function normalize(value = "") {
  return String(value || "").trim().toLowerCase();
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchedAllergenKeys(allergies = []) {
  const normalized = allergies.map(normalize).filter(Boolean);
  const keys = new Set();
  for (const allergy of normalized) {
    for (const [key, rule] of Object.entries(ALLERGEN_RULES)) {
      if (rule.aliases.some((alias) => allergy.includes(alias))) {
        keys.add(key);
      }
    }
  }
  return [...keys];
}

export function sanitizeTextForAllergies(text = "", allergies = []) {
  const keys = matchedAllergenKeys(allergies);
  let safeText = String(text || "");
  for (const key of keys) {
    const rule = ALLERGEN_RULES[key];
    safeText = safeText.replace(rule.pattern, rule.replacement);
  }
  for (const allergy of allergies.map(normalize).filter(Boolean)) {
    if (!keys.some((key) => ALLERGEN_RULES[key].aliases.some((alias) => allergy.includes(alias)))) {
      safeText = safeText.replace(new RegExp(`\\b${escapeRegExp(allergy)}\\b`, "gi"), "approved alternative");
    }
  }
  return safeText;
}

function sanitizeValue(value, allergies, keyName = "") {
  if (typeof value === "string") {
    if (keyName === "allergies" || keyName === "allergyNotes") {
      return sanitizeTextForAllergies(value, allergies).replace(/selected food allerg(?:y|ies):?\s*/gi, "selected food allergies");
    }
    return sanitizeTextForAllergies(value, allergies);
  }

  if (Array.isArray(value)) {
    if (keyName === "allergies") {
      return value.length ? value.map(() => "selected food allergy") : [];
    }
    return value.map((item) => sanitizeValue(item, allergies, keyName));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeValue(item, allergies, key)])
    );
  }

  return value;
}

export function sanitizePlanForAllergies(plan = {}) {
  const allergies = plan.profile?.allergies || [];
  const sanitized = sanitizeValue(plan, allergies);
  if (sanitized.profile && allergies.length) {
    sanitized.profile.allergies = allergies.map(() => "selected food allergy");
  }
  return sanitized;
}

export function forbiddenPatternForAllergies(allergies = []) {
  const keys = matchedAllergenKeys(allergies);
  const patterns = keys.map((key) => ALLERGEN_RULES[key].pattern.source);
  for (const allergy of allergies.map(normalize).filter(Boolean)) {
    if (!keys.some((key) => ALLERGEN_RULES[key].aliases.some((alias) => allergy.includes(alias)))) {
      patterns.push(`\\b${escapeRegExp(allergy)}\\b`);
    }
  }
  return patterns.length ? new RegExp(patterns.join("|"), "i") : null;
}

export function assertAllergySafeText(text = "", allergies = []) {
  const pattern = forbiddenPatternForAllergies(allergies);
  if (pattern?.test(String(text || ""))) {
    throw new Error("Generated plan contains a selected allergen term.");
  }
}
