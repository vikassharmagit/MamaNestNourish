import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAuthIdentifier } from "../src/auth.js";
import { loadApprovedPlanningData } from "../src/dataStore.js";
import { createPlanDocumentXml } from "../src/docxExport.js";
import { server } from "../src/server.js";
import { runPregnancyPlan } from "../src/pregnancyAgent.js";

function listen(serverInstance) {
  return new Promise((resolve) => {
    serverInstance.listen(0, "127.0.0.1", () => {
      resolve(serverInstance.address());
    });
  });
}

function close(serverInstance) {
  return new Promise((resolve, reject) => {
    serverInstance.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

test("auth identifier accepts email or international phone number", () => {
  assert.deepEqual(normalizeAuthIdentifier("USER@Example.com"), {
    username: "user@example.com",
    attribute: { Name: "email", Value: "user@example.com" },
    delivery: "email"
  });
  assert.deepEqual(normalizeAuthIdentifier("+15551234567"), {
    username: "+15551234567",
    attribute: { Name: "phone_number", Value: "+15551234567" },
    delivery: "phone"
  });
  assert.deepEqual(normalizeAuthIdentifier("98765 43210"), {
    username: "+919876543210",
    attribute: { Name: "phone_number", Value: "+919876543210" },
    delivery: "phone"
  });
  assert.throws(
    () => normalizeAuthIdentifier("555123"),
    /international format/
  );
});

test("approved planning data is loaded from data files", () => {
  const data = loadApprovedPlanningData();
  assert.ok(data.meals.length >= 12);
  assert.ok(data.snacks.length >= 5);
  assert.ok(data.exercises.length >= 7);
  assert.ok(data.fetalGrowth.length >= 10);
  assert.ok(data.safetyRules.some((rule) => rule.id === "gestational-hypertension"));
  assert.ok(data.sources.some((source) => source.id === "usda-fdc"));
  assert.ok(data.meals.every((meal) => meal.reviewStatus === "approved"));
});

test("streaming pregnancy planner emits required events and final schema", async () => {
  const sample = {
    profileText: "I am 29, 22 weeks pregnant, vegetarian, pre-pregnancy BMI 25, moderate activity, gestational hypertension, no caffeine after 2pm. I work a desk job.",
    gestationalWeek: 22,
    gestationalDay: 1,
    lastPeriodDate: "2026-01-01",
    expectedDeliveryDate: "2026-10-08",
    age: 29,
    heightCm: 165,
    weightKg: 68,
    prePregnancyBMI: 25,
    activityLevel: "moderate",
    dietaryPreferences: "vegetarian",
    conditions: ["gestational_hypertension"],
    allergies: ["peanuts"],
    medications: [],
    constraints: ["no high impact exercise", "no caffeine after 2pm"]
  };

  const events = [];
  for await (const event of runPregnancyPlan(sample)) {
    events.push(event);
  }

  assert.ok(events.some((event) => event.type === "tool.progress"));
  assert.ok(events.some((event) => event.type === "model.delta"));
  assert.ok(events.some((event) => event.type === "safety.alert"));

  const done = events.find((event) => event.type === "done");
  assert.equal(done.summary, "Plan complete");
  assert.equal(done.output.profile.gestationalWeek, 22);
  assert.equal(done.output.profile.gestationalDay, 1);
  assert.equal(done.output.profile.lastPeriodDate, "2026-01-01");
  assert.equal(done.output.profile.expectedDeliveryDate, "2026-10-08");
  assert.equal(done.output.profile.gestationalAgeLabel, "22 weeks 1 days");
  assert.equal(done.output.babySize.week, 22);
  assert.ok(done.output.babySize.comparison);
  assert.ok(done.output.nutritionRecommendations.some((group) => group.title === "Milk and calcium"));
  assert.equal(done.output.micronutrientRecommendations.title, "Week 22 vitamins and minerals");
  assert.match(done.output.micronutrientRecommendations.items.join(" "), /Iron|Calcium|Vitamin D|Choline/);
  assert.equal(done.output.weeklyPlan.length, 7);
  assert.ok(done.output.targets.bmrKcal > 0);
  assert.ok(done.output.weeklyPlan[0].dailyPlan.meals.length >= 3);
  assert.notEqual(
    done.output.weeklyPlan[0].dailyPlan.meals[0].name,
    done.output.weeklyPlan[1].dailyPlan.meals[0].name
  );
  assert.ok(done.output.weeklyPlan[0].dailyPlan.optionBank.breakfast.length >= 4);
  assert.notEqual(
    done.output.weeklyPlan[0].dailyPlan.exercise[0].activity,
    done.output.weeklyPlan[1].dailyPlan.exercise[0].activity
  );
  assert.ok(done.output.weeklyPlan[0].dailyPlan.exercise[0].steps.length >= 3);
  assert.match(done.output.weeklyPlan[0].dailyPlan.exercise[0].sourceBasis, /ACOG|NHS/);
  assert.ok(done.output.riskRegister.some((flag) => flag.id === "gestational-hypertension"));
  assert.match(done.output.disclaimer, /not a substitute/i);
});

test("missing required fields pauses planning with follow-up questions", async () => {
  const events = [];
  for await (const event of runPregnancyPlan({ profileText: "I am pregnant." })) {
    events.push(event);
  }

  const done = events.find((event) => event.type === "done");
  assert.equal(done.summary, "More profile details are needed");
  assert.equal(done.output.weeklyPlan.length, 0);
  assert.ok(done.output.followUpQuestions.length > 0);
});

test("non-vegetarian diet uses non-vegetarian meal suggestions", async () => {
  const events = [];
  for await (const event of runPregnancyPlan({
    gestationalWeek: 22,
    age: 29,
    heightCm: 165,
    weightKg: 68,
    activityLevel: "moderate",
    dietaryPreferences: "non_vegetarian",
    conditions: [],
    allergies: []
  })) {
    events.push(event);
  }

  const done = events.find((event) => event.type === "done");
  const firstMeal = done.output.weeklyPlan[0].dailyPlan.meals[0];
  assert.match(firstMeal.name, /egg|curd/i);
  assert.match(done.output.weeklyPlan[0].dailyPlan.optionBank.lunch.join(" "), /chicken|fish/i);
});

test("diet plan text respects listed allergies across recommendations", async () => {
  const events = [];
  for await (const event of runPregnancyPlan({
    gestationalWeek: 22,
    age: 29,
    heightCm: 165,
    weightKg: 68,
    activityLevel: "moderate",
    dietaryPreferences: "non_vegetarian",
    conditions: [],
    allergies: ["dairy", "egg", "fish", "peanuts"]
  })) {
    events.push(event);
  }

  const done = events.find((event) => event.type === "done");
  const firstPlan = done.output.weeklyPlan[0].dailyPlan;
  const weeklyText = done.output.weeklyPlan
    .flatMap(({ dailyPlan }) => [
      ...dailyPlan.meals.map((meal) => `${meal.name} ${meal.portionNotes}`),
      ...dailyPlan.snacks.map((snack) => `${snack.name} ${snack.portionNotes}`),
      ...dailyPlan.optionBank.breakfast,
      ...dailyPlan.optionBank.lunch,
      ...dailyPlan.optionBank.dinner,
      ...dailyPlan.optionBank.snacks,
      ...dailyPlan.optionBank.healthyFocus
    ])
    .join(" ");
  const recommendationText = [
    ...done.output.nutritionRecommendations.flatMap((group) => group.items),
    ...done.output.micronutrientRecommendations.items
  ].join(" ");

  assert.doesNotMatch(weeklyText, /\b(egg|fish|peanuts?|milk|curd|yogurt|paneer|cheese)\b/i);
  assert.doesNotMatch(recommendationText, /\b(egg|fish|peanuts?|milk|curd|yogurt|paneer|cheese)\b/i);
  assert.ok(firstPlan.optionBank.allergyNotes.some((note) => note.includes("dairy")));
  assert.match(weeklyText, /soy|tofu|omega-3 alternative|seeds/i);
});

test("server starts and allows local planning when Cognito is not configured", async () => {
  const address = await listen(server);
  try {
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const configResponse = await fetch(`${baseUrl}/api/auth/config`);
    assert.equal(configResponse.status, 200);
    assert.equal((await configResponse.json()).configured, false);

    const pageResponse = await fetch(`${baseUrl}/`);
    const pageHtml = await pageResponse.text();
    assert.equal(pageResponse.status, 200);
    assert.match(pageHtml, /data-step="0"/);
    assert.match(pageHtml, /Pregnancy details/);
    assert.match(pageHtml, /Health & allergies/);
    assert.match(pageHtml, /Food & lifestyle/);
    assert.match(pageHtml, /Step 3 of 3/);
    assert.doesNotMatch(pageHtml, /data-step="3"/);
    assert.doesNotMatch(pageHtml, />Review<\/div>/);
    assert.match(pageHtml, /id="languageSelect"/);
    assert.match(pageHtml, /id="conditionChips"/);
    assert.match(pageHtml, /id="allergyChips"/);
    assert.match(pageHtml, /id="printPlanBtn"/);
    assert.match(pageHtml, /id="downloadPlanBtn"/);
    assert.match(pageHtml, /id="resetPlanBtn"/);
    assert.doesNotMatch(pageHtml, /id="regenerateBtn"/);
    assert.match(pageHtml, /<textarea id="profileText" readonly>/);
    assert.match(pageHtml, /download: "Download"/);

    const logoResponse = await fetch(`${baseUrl}/assets/MamaNestNourish.png`);
    assert.equal(logoResponse.status, 200);
    assert.equal(logoResponse.headers.get("content-type"), "image/png");

    const planResponse = await fetch(`${baseUrl}/api/plan/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        gestationalWeek: 22,
        gestationalDay: 1,
        age: 29,
        heightCm: 165,
        weightKg: 68,
        activityLevel: "moderate",
        dietaryPreferences: "vegetarian",
        conditions: [],
        allergies: []
      })
    });
    const events = (await planResponse.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(planResponse.status, 200);
    assert.equal(events.at(-1).type, "done");
    assert.equal(events.at(-1).summary, "Plan complete");

    const usersResponse = await fetch(`${baseUrl}/api/admin/users`);
    assert.equal(usersResponse.status, 200);
    const usersBody = await usersResponse.json();
    assert.ok(usersBody.users.some((user) =>
      user.key === "local-dev" &&
      user.lastProfile?.gestationalWeek === 22 &&
      user.savedPlans?.[0]?.summary?.planDays === 7
    ));

    const currentUserResponse = await fetch(`${baseUrl}/api/user/me`);
    assert.equal(currentUserResponse.status, 200);
    const currentUserBody = await currentUserResponse.json();
    assert.equal(currentUserBody.user.key, "local-dev");
    assert.equal(currentUserBody.user.savedPlans[0].input.gestationalWeek, 22);
    assert.equal(currentUserBody.user.savedPlans[0].plan.profile.gestationalWeek, 22);
    assert.equal(currentUserBody.user.savedPlans[0].plan.weeklyPlan.length, 7);

    const docxResponse = await fetch(`${baseUrl}/api/plan/docx`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: events.at(-1).output })
    });
    const docx = Buffer.from(await docxResponse.arrayBuffer());
    assert.equal(docxResponse.status, 200);
    assert.equal(
      docxResponse.headers.get("content-type"),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    assert.equal(docx.subarray(0, 2).toString(), "PK");
    assert.match(docx.toString("latin1"), /word\/document\.xml/);

    const documentXml = createPlanDocumentXml(events.at(-1).output);
    assert.match(documentXml, /Today(&apos;|')s Plan/);
    assert.match(documentXml, /Seven-Day Plan/);
    assert.match(documentXml, /Healthy Variety Options/);
    assert.match(documentXml, /Healthy Focus/);
    assert.match(documentXml, /Milk and Healthy Food Recommendations/);
    assert.match(documentXml, /Nutrition Recommendations/);

    const pendingResponse = await fetch(`${baseUrl}/api/admin/pending-updates`);
    assert.equal(pendingResponse.status, 200);
    assert.ok(Array.isArray((await pendingResponse.json()).updates));
  } finally {
    await close(server);
  }
});
