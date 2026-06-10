import { loadApprovedPlanningData, validateTrustedSources } from "../src/dataStore.js";
import { assertAllergySafeText } from "../src/allergySafety.js";
import { runPregnancyPlan } from "../src/pregnancyAgent.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function validateRecord(record, collection) {
  assert(record.id, `${collection} record is missing id`);
  assert(record.reviewStatus === "approved", `${collection}:${record.id} is not approved`);
  assert(Array.isArray(record.sourceUrls) && record.sourceUrls.length, `${collection}:${record.id} is missing sourceUrls`);
  assert(record.lastReviewedAt, `${collection}:${record.id} is missing lastReviewedAt`);
  assert(Array.isArray(record.allergens), `${collection}:${record.id} is missing allergen metadata`);
  assert(Array.isArray(record.avoidTerms), `${collection}:${record.id} is missing avoid terms`);
  assert(record.substitutions && typeof record.substitutions === "object", `${collection}:${record.id} is missing substitutions`);
}

async function planFor(allergy) {
  const events = [];
  for await (const event of runPregnancyPlan({
    gestationalWeek: 22,
    gestationalDay: 1,
    age: 29,
    heightCm: 165,
    weightKg: 68,
    activityLevel: "moderate",
    dietaryPreferences: "non_vegetarian",
    conditions: [],
    allergies: [allergy]
  })) {
    events.push(event);
  }
  return events.find((event) => event.type === "done").output;
}

validateTrustedSources();

const data = loadApprovedPlanningData();
assert(data.sources.length >= 8, "Expected official source coverage for all output sections");
for (const source of data.sources) {
  assert(source.sourceCategory, `Source ${source.id} is missing sourceCategory`);
  assert(source.sourcePriority, `Source ${source.id} is missing sourcePriority`);
  assert(source.reviewStatus === "approved", `Source ${source.id} must be approved`);
}

data.meals.forEach((record) => validateRecord(record, "meals"));
data.snacks.forEach((record) => validateRecord(record, "snacks"));

for (const allergy of ["peanuts", "dairy", "egg", "fish", "shellfish", "soy", "gluten", "chicken"]) {
  const plan = await planFor(allergy);
  const outputText = JSON.stringify({
    weeklyPlan: plan.weeklyPlan,
    nutritionRecommendations: plan.nutritionRecommendations,
    micronutrientRecommendations: plan.micronutrientRecommendations,
    rationale: plan.rationale
  });
  assertAllergySafeText(outputText, [allergy]);
}

console.log("Source data and allergy safety validation passed.");
