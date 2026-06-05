import { loadApprovedPlanningData } from "./dataStore.js";

const DISCLAIMER =
  "Educational guidance only; this is not a substitute for professional medical advice. For urgent symptoms or moderate/high-risk findings, contact a qualified healthcare provider immediately.";

const REQUIRED_FIELDS = [
  "gestationalWeek",
  "age",
  "heightCm",
  "weightKg",
  "activityLevel",
  "dietaryPreferences"
];

const ACTIVITY_METS = {
  sedentary: [1.5, 2.5],
  light: [2, 3],
  moderate: [2.5, 4],
  active: [3, 5]
};

function normalizeStringArray(value) {
  if (!value) return [];
  const rawValues = Array.isArray(value) ? value : String(value).split(/[,;]/);
  const values = rawValues
    .map(String)
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set(values)];
}

function findNumber(pattern, text) {
  const match = text.match(pattern);
  return match ? Number(match[1]) : null;
}

export function extractProfile(input = {}) {
  const rawText = String(input.profileText || input.raw_text || "");
  const lower = rawText.toLowerCase();

  const profile = {
    gestationalWeek:
      input.gestationalWeek ?? findNumber(/(\d{1,2})\s*(?:weeks|week|wks|wk)\s*pregnant/i, rawText),
    gestationalDay: input.gestationalDay ?? findNumber(/(\d)\s*(?:days|day)\s*pregnant/i, rawText) ?? 0,
    lastPeriodDate: input.lastPeriodDate ?? null,
    expectedDeliveryDate: input.expectedDeliveryDate ?? null,
    age: input.age ?? findNumber(/\b(?:i am|age)\s*(\d{2})\b/i, rawText),
    heightCm: input.heightCm ?? findNumber(/(\d{2,3})\s*cm/i, rawText),
    weightKg: input.weightKg ?? findNumber(/(\d{2,3}(?:\.\d+)?)\s*kg/i, rawText),
    prePregnancyBMI:
      input.prePregnancyBMI ?? findNumber(/(?:pre[- ]pregnancy bmi|bmi)\s*(\d{1,2}(?:\.\d+)?)/i, rawText),
    allergies: normalizeStringArray(input.allergies),
    conditions: normalizeStringArray(input.conditions),
    medications: normalizeStringArray(input.medications),
    activityLevel: input.activityLevel ?? null,
    occupation: input.occupation ?? (lower.includes("desk job") ? "desk job" : ""),
    dietaryPreferences: input.dietaryPreferences ?? null,
    constraints: normalizeStringArray(input.constraints),
    contactClinician: Boolean(input.contactClinician)
  };

  if (!profile.activityLevel) {
    profile.activityLevel = ["sedentary", "light", "moderate", "active"].find((level) => lower.includes(level)) ?? null;
  }

  if (!profile.dietaryPreferences) {
    if (lower.includes("non-vegetarian") || lower.includes("non vegetarian")) {
      profile.dietaryPreferences = "non_vegetarian";
    } else if (lower.includes("eggitarian") || lower.includes("eggetarian")) {
      profile.dietaryPreferences = "eggitarian";
    } else {
      profile.dietaryPreferences = lower.includes("vegetarian") ? "vegetarian" : null;
    }
  }

  if (lower.includes("hypertension") && !profile.conditions.some((c) => c.includes("hypertension"))) {
    profile.conditions.push("gestational_hypertension");
  }

  if (lower.includes("no caffeine after 2pm")) {
    profile.constraints.push("no caffeine after 2pm");
  }
  profile.constraints = [...new Set(profile.constraints)];

  if (!profile.prePregnancyBMI && profile.heightCm && profile.weightKg) {
    const meters = profile.heightCm / 100;
    profile.prePregnancyBMI = Number((profile.weightKg / (meters * meters)).toFixed(1));
  }

  const missingFields = REQUIRED_FIELDS.filter((field) => profile[field] === null || profile[field] === undefined || profile[field] === "");

  return {
    ...profile,
    gestationalAgeLabel: `${profile.gestationalWeek} weeks ${profile.gestationalDay ?? 0} days`,
    missingFields,
    confidence: missingFields.length ? 0.65 : 0.9
  };
}

export function computeTargets(profile) {
  const bmrKcal = 10 * profile.weightKg + 6.25 * profile.heightCm - 5 * profile.age - 161;
  const trimesterAdjustment = profile.gestationalWeek >= 14 ? 300 : 0;
  const hasHypertension = profile.conditions.some((condition) => condition.toLowerCase().includes("hypertension"));
  const activityMultiplier = { sedentary: 1.2, light: 1.35, moderate: 1.45, active: 1.55 }[profile.activityLevel] ?? 1.2;
  const maintenance = bmrKcal * activityMultiplier + trimesterAdjustment;
  const mets = hasHypertension ? [1.8, 3] : ACTIVITY_METS[profile.activityLevel] ?? ACTIVITY_METS.sedentary;

  return {
    bmrKcal: Number(bmrKcal.toFixed(0)),
    recommendedDailyCaloriesMin: Number((maintenance - 100).toFixed(0)),
    recommendedDailyCaloriesMax: Number((maintenance + 150).toFixed(0)),
    recommendedDailyProteinG: Number(Math.max(71, profile.weightKg * 1.1).toFixed(0)),
    hydrationLiters: Number(Math.max(2.3, profile.weightKg * 0.035).toFixed(1)),
    recommendedSleepHours: 8,
    safeExerciseMETs: { min: mets[0], max: mets[1] },
    recommendedExerciseMinutesPerDay: hasHypertension ? 20 : 30,
    notes: hasHypertension
      ? "Gestational hypertension present; keep exercise low intensity and confirm activity targets with the clinician."
      : "Targets use conservative pregnancy adjustments and moderate daily movement."
  };
}

function scaleMeal(meal, targets) {
  return {
    ...meal,
    calories: Math.round(meal.calories * (targets.recommendedDailyCaloriesMin / 1900))
  };
}

function mealLibrary(profile) {
  const { meals } = loadApprovedPlanningData();
  const diet = String(profile.dietaryPreferences).toLowerCase();
  const byType = (mealType) =>
    meals.filter((meal) => meal.mealType === mealType && meal.dietTypes.includes(diet));

  return {
    breakfast: byType("breakfast"),
    lunch: byType("lunch"),
    dinner: byType("dinner")
  };
}

function mealSet(profile, targets, dayIndex) {
  const library = mealLibrary(profile);
  const pick = (items, offset, time) => {
    const meal = items[(dayIndex + offset - 1) % items.length];
    return scaleMeal({
      time,
      name: meal.name,
      calories: meal.calories,
      proteinG: meal.proteinG,
      portionNotes: meal.portionNotes,
      sourceUrls: meal.sourceUrls,
      lastReviewedAt: meal.lastReviewedAt
    }, targets);
  };

  return [
    pick(library.breakfast, 0, "08:00"),
    pick(library.lunch, 1, "13:00"),
    pick(library.dinner, 2, "19:30")
  ];
}

function snackSet(profile, dayIndex) {
  const { snacks } = loadApprovedPlanningData();
  const diet = String(profile.dietaryPreferences).toLowerCase();
  const options = snacks.filter((snack) => snack.dietTypes.includes(diet));

  const first = options[(dayIndex - 1) % options.length];
  const second = options[(dayIndex + 1) % options.length];
  return [
    { time: "10:30", name: first.name, calories: first.calories, proteinG: first.proteinG, portionNotes: first.portionNotes, sourceUrls: first.sourceUrls, lastReviewedAt: first.lastReviewedAt },
    { time: "16:30", name: second.name, calories: second.calories, proteinG: second.proteinG, portionNotes: `${second.portionNotes} Keep caffeine before 14:00 if used at all.`, sourceUrls: second.sourceUrls, lastReviewedAt: second.lastReviewedAt }
  ];
}

function exerciseSet(hasHypertension, targets, dayIndex) {
  const { exercises } = loadApprovedPlanningData();
  const riskMode = hasHypertension ? "hypertension" : "standard";
  const options = exercises.filter((exercise) => exercise.riskMode === riskMode);
  const selected = options[(dayIndex - 1) % options.length];
  const durationMin = Math.min(selected.durationMin, targets.recommendedExerciseMinutesPerDay);

  return [
    {
      time: "17:30",
      activity: selected.activity,
      durationMin,
      intensity: hasHypertension ? "low; able to speak comfortably" : "low-to-moderate; talk-test comfortable",
      steps: selected.steps,
      benefit: selected.benefit,
      sourceUrls: selected.sourceUrls,
      lastReviewedAt: selected.lastReviewedAt,
      sourceBasis: hasHypertension
        ? "Conservative adaptation of ACOG/NHS pregnancy exercise guidance because hypertension is listed; clinician review recommended."
        : "Based on ACOG/NHS guidance for regular moderate activity, pelvic-floor work, and symptom-aware modifications.",
      precautions: "Stop for bleeding, dizziness, chest pain, severe headache, calf swelling, contractions, fluid leakage, shortness of breath before exertion, or reduced fetal movement."
    }
  ];
}

function optionBank(profile) {
  const { nutrients } = loadApprovedPlanningData();
  const library = mealLibrary(profile);
  return {
    breakfast: library.breakfast.map((meal) => meal.name),
    lunch: library.lunch.map((meal) => meal.name),
    dinner: library.dinner.map((meal) => meal.name),
    snacks: snackSet(profile, 1).map((snack) => snack.name),
    healthyFocus: nutrients.healthyFocus
  };
}

function babySizeForWeek(week = 0) {
  const { fetalGrowth } = loadApprovedPlanningData();
  const size = fetalGrowth.find((item) => week <= item.maxWeek) ?? fetalGrowth[fetalGrowth.length - 1];
  return {
    week,
    comparison: size.comparison,
    lengthCm: size.lengthCm,
    weightG: size.weightG,
    color: size.color,
    note: size.note,
    sourceBasis: size.sourceBasis,
    sourceUrls: size.sourceUrls,
    lastReviewedAt: size.lastReviewedAt
  };
}

function nutritionRecommendations(profile) {
  const { nutrients } = loadApprovedPlanningData();
  const dairy = String(profile.dietaryPreferences).toLowerCase() === "vegetarian"
    ? nutrients.nutritionRecommendations.vegetarianDairy
    : nutrients.nutritionRecommendations.nonVegetarianDairy;
  return nutrients.nutritionRecommendations.groups.map((group) => ({
    title: group.title,
    items: group.items.map((item) => item.replace("{{dairy}}", dairy)),
    sourceUrls: nutrients.sourceUrls,
    lastReviewedAt: nutrients.lastReviewedAt
  }));
}

function micronutrientRecommendations(profile) {
  const { nutrients } = loadApprovedPlanningData();
  const week = profile.gestationalWeek ?? 0;
  const trimesterFocus = week < 14
    ? nutrients.micronutrients.firstTrimester
    : week < 28
      ? nutrients.micronutrients.secondTrimester
      : nutrients.micronutrients.thirdTrimester;

  return {
    title: `Week ${week} vitamins and minerals`,
    summary: trimesterFocus,
    items: nutrients.micronutrients.items,
    precautions: nutrients.micronutrients.precautions,
    sourceBasis: nutrients.micronutrients.sourceBasis,
    sourceUrls: nutrients.sourceUrls,
    lastReviewedAt: nutrients.lastReviewedAt
  };
}

function addDaysIso(date, days) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy.toISOString().slice(0, 10);
}

export function generateDailyPlan(profile, targets, dayIndex, startDate = new Date()) {
  const date = addDaysIso(startDate, dayIndex - 1);
  const hasHypertension = profile.conditions.some((condition) => condition.toLowerCase().includes("hypertension"));
  const meals = mealSet(profile, targets, dayIndex);
  const snacks = snackSet(profile, dayIndex);
  const burn = hasHypertension ? 90 : 140;

  return {
    date,
    dayIndex,
    meals,
    snacks,
    exercise: exerciseSet(hasHypertension, targets, dayIndex),
    sleepTargetHours: targets.recommendedSleepHours,
    workRecommendation: {
      hours: "As tolerated",
      breaksSchedule: "Stand, walk, hydrate, or stretch for 3-5 minutes every hour."
    },
    waterSchedule: [
      { time: "07:30", ml: 350 },
      { time: "10:00", ml: 350 },
      { time: "12:30", ml: 400 },
      { time: "15:30", ml: 400 },
      { time: "18:30", ml: 350 },
      { time: "20:30", ml: 250 }
    ],
    estimatedCaloriesBurned: burn,
    totalCaloriesNet: targets.recommendedDailyCaloriesMin - burn,
    safetyNotes: [
      DISCLAIMER,
      hasHypertension ? "Because hypertension is listed, confirm exercise, salt, and blood-pressure monitoring guidance with the clinician." : "Use the talk test and avoid overheating."
    ],
    optionBank: optionBank(profile),
    followUpQuestions: []
  };
}

export function safetyCheck(profile, dailyPlan) {
  const { safetyRules } = loadApprovedPlanningData();
  const conditions = profile.conditions.map((condition) => condition.toLowerCase());
  return safetyRules.filter((rule) => {
    if (!rule.conditionIncludes.length) return true;
    return rule.conditionIncludes.some((needle) =>
      conditions.some((condition) => condition.includes(needle))
    );
  });
}

export function draftChannelCopy(dailyPlan, profile, channels = ["push", "email", "print"]) {
  const copy = {};
  if (channels.includes("push")) {
    copy.push = "Today: hydrate, eat protein-rich meals, walk gently, and contact your clinician for warning symptoms.";
  }
  if (channels.includes("email")) {
    copy.email = {
      subject: `Week ${profile.gestationalWeek} daily plan for {date}`,
      body: `Your plan for {date} focuses on steady meals, ${dailyPlan.sleepTargetHours} hours of sleep, hydration, and safe movement.\n\nPlease use this as educational guidance only and contact {clinicianContact} for symptoms or risk concerns.`
    };
  }
  if (channels.includes("print")) {
    copy.printableChecklist = [
      "Review warning symptoms before exercise.",
      "Drink water across the day.",
      "Include protein at each meal or snack.",
      "Take movement breaks during work.",
      "Call {clinicianContact} for concerning symptoms."
    ];
  }
  return copy;
}

export function explainRationale(recommendationKey, profile, targets) {
  const rationales = {
    calories: `Calorie targets use estimated BMR plus conservative pregnancy energy needs for week ${profile.gestationalWeek}. ACOG-style nutrition guidance supports individualized targets based on BMI, gestational age, and activity level.`,
    exercise: `Exercise is kept within ${targets.safeExerciseMETs.min}-${targets.safeExerciseMETs.max} METs using the talk test. NICE and ACOG-style antenatal exercise guidance supports regular low-to-moderate activity unless symptoms or clinician restrictions apply.`,
    hydration: `Hydration is spread through the day to support pregnancy fluid needs and reduce dehydration risk. WHO-style public health guidance emphasizes adequate fluids and symptom-aware self-monitoring.`
  };

  return {
    rationaleText: rationales[recommendationKey] ?? rationales.calories,
    references: ["ACOG guidance", "NICE antenatal exercise guidance", "WHO hydration guidance"],
    precautions: ["Confirm targets with the clinician if risk conditions are present.", "Stop activity and seek care for red-flag symptoms."]
  };
}

export async function* runPregnancyPlan(input = {}) {
  yield { type: "tool.progress", tool: "extractProfile", message: "Parsing profile", progress: 0.2, meta: {} };
  const profile = extractProfile(input);
  yield { type: "tool.result", tool: "extractProfile", result: profile };

  if (profile.missingFields.length) {
    const output = {
      profile,
      targets: null,
      weeklyPlan: [],
      riskRegister: [],
      ownerChecklists: { user: [], partner: [], clinician: [] },
      channelCopy: {},
      followUpQuestions: profile.missingFields.map((field) => `Please provide ${field}.`),
      disclaimer: DISCLAIMER
    };
    yield { type: "done", summary: "More profile details are needed", outputUrl: null, output };
    return;
  }

  yield { type: "tool.progress", tool: "computeTargets", message: "Calculating targets", progress: 0.35, meta: {} };
  const targets = computeTargets(profile);
  yield { type: "tool.result", tool: "computeTargets", result: targets };

  const weeklyPlan = [];
  const riskRegisterById = new Map();
  const startDate = input.startDate || input.targetWeekStartDate || new Date();
  for (let dayIndex = 1; dayIndex <= 7; dayIndex += 1) {
    yield { type: "tool.progress", tool: "generateDailyPlan", message: `Creating day ${dayIndex}`, progress: 0.35 + dayIndex * 0.07, meta: { dayIndex } };
    const dailyPlan = generateDailyPlan(profile, targets, dayIndex, startDate);
    yield {
      type: "model.delta",
      section: `weeklyPlan.day${dayIndex}`,
      delta: `Day ${dayIndex} - Week ${profile.gestationalWeek}: ${dailyPlan.meals[0].time} ${dailyPlan.meals[0].name}; ${dailyPlan.exercise[0].durationMin} minutes ${dailyPlan.exercise[0].activity}.`
    };
    const riskFlags = safetyCheck(profile, dailyPlan);
    riskFlags
      .filter((flag) => flag.severity !== "green")
      .forEach((flag) => {
        const existing = riskRegisterById.get(flag.id);
        if (existing) {
          existing.dayIndexes.push(dayIndex);
        } else {
          riskRegisterById.set(flag.id, { ...flag, dayIndexes: [dayIndex] });
        }
      });
    weeklyPlan.push({ dayIndex, dailyPlan });
  }

  const riskRegister = [...riskRegisterById.values()];

  if (riskRegister.some((flag) => flag.severity === "red")) {
    yield {
      type: "safety.alert",
      severity: "red",
      message: "A red-flag risk was found; contact a qualified healthcare provider immediately."
    };
  } else if (riskRegister.length) {
    yield {
      type: "safety.alert",
      severity: "yellow",
      message: "A pregnancy risk factor was found; confirm this plan with a qualified healthcare provider."
    };
  }

  const firstPlan = weeklyPlan[0].dailyPlan;
  const channelCopy = draftChannelCopy(firstPlan, profile, ["push", "email", "print"]);
  yield { type: "tool.result", tool: "draftChannelCopy", result: channelCopy };

  const output = {
    profile,
    targets,
    babySize: babySizeForWeek(profile.gestationalWeek),
    weeklyPlan,
    riskRegister,
    ownerChecklists: {
      user: ["Track symptoms and hydration.", "Use the talk test during exercise.", "Keep routine prenatal appointments."],
      partner: ["Help with meals and hydration reminders.", "Know warning symptoms and clinician contact details."],
      clinician: riskRegister.length ? ["Review hypertension-related activity and monitoring guidance."] : []
    },
    channelCopy,
    followUpQuestions: [],
    disclaimer: DISCLAIMER,
    nutritionRecommendations: nutritionRecommendations(profile),
    micronutrientRecommendations: micronutrientRecommendations(profile),
    rationale: {
      calories: explainRationale("calories", profile, targets),
      exercise: explainRationale("exercise", profile, targets),
      hydration: explainRationale("hydration", profile, targets)
    }
  };

  yield { type: "done", summary: "Plan complete", outputUrl: null, output };
}

export { DISCLAIMER };
