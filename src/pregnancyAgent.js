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
  const diet = String(profile.dietaryPreferences).toLowerCase();
  const vegetarian = diet === "vegetarian";
  const eggitarian = diet === "eggitarian";

  const breakfast = vegetarian
    ? [
        ["Vegetable upma with curd", 380, 18, "Add peas, carrots, and curd for protein and calcium."],
        ["Moong dal chilla with mint curd", 410, 22, "Use less oil; pair with tomato or cucumber."],
        ["Oats porridge with pasteurized milk, chia, and fruit", 390, 17, "Use milk or calcium-fortified soy milk; skip nuts if allergic."],
        ["Paneer vegetable poha", 420, 21, "Add lemon for iron absorption and keep salt moderate."]
      ]
    : eggitarian
      ? [
          ["Vegetable upma with boiled egg or curd", 400, 22, "Choose fully cooked egg; avoid runny yolks."],
          ["Egg bhurji with whole-grain toast", 430, 25, "Add spinach or capsicum for micronutrients."],
          ["Oats porridge with pasteurized milk and fruit", 390, 17, "Use milk or calcium-fortified soy milk; add seeds if tolerated."],
          ["Moong dal chilla with egg on the side", 450, 28, "Keep egg fully cooked and use minimal oil."]
        ]
      : [
          ["Oats with egg or curd", 400, 24, "Choose fully cooked egg or pasteurized curd."],
          ["Chicken vegetable sandwich on whole grain", 440, 30, "Use freshly cooked chicken and plenty of salad."],
          ["Poha with curd and cooked sprouts", 390, 19, "Use pasteurized curd and cooked sprouts if food safety is a concern."],
          ["Idli with sambar and boiled egg", 430, 27, "Keep egg fully cooked; add vegetables to sambar."]
        ];

  const lunch = vegetarian
    ? [
        ["Dal, rice, vegetables, curd", 560, 28, "Half plate vegetables; steady salt unless clinician advises otherwise."],
        ["Rajma or chole bowl with brown rice", 590, 30, "Add salad and lemon; keep portions comfortable."],
        ["Paneer/tofu tikka wrap with salad", 570, 32, "Use whole-grain roti and grilled filling."],
        ["Vegetable khichdi with curd and salad", 540, 25, "Gentle option for nausea or digestion days."]
      ]
    : eggitarian
      ? [
          ["Egg or dal bowl with rice and vegetables", 570, 32, "Fully cook eggs; add greens and curd."],
          ["Paneer/tofu wrap with salad", 570, 32, "Use whole-grain roti and a curd dip."],
          ["Vegetable khichdi with boiled egg", 560, 29, "Gentle option with extra protein."],
          ["Chole salad bowl with egg", 590, 34, "Balance legumes with vegetables and lemon."]
        ]
      : [
          ["Lean protein bowl with rice and vegetables", 580, 34, "Use freshly cooked chicken, fish, eggs, or beans."],
          ["Chicken dalia with vegetables", 570, 35, "Cook thoroughly and keep spice comfortable."],
          ["Fish curry with rice and vegetables", 590, 33, "Use low-mercury fish and cook thoroughly."],
          ["Dal, rice, vegetables, curd with grilled chicken", 610, 38, "Keep portions balanced and salt moderate."]
        ];

  const dinner = vegetarian
    ? [
        ["Chapati with paneer/tofu and salad", 520, 26, "Finish 2-3 hours before sleep when possible."],
        ["Millet dosa with sambar", 500, 23, "Add extra dal or tofu for protein."],
        ["Vegetable pulao with raita and dal", 540, 25, "Keep vegetables varied and spice comfortable."],
        ["Soup, chapati, and sprouted moong salad", 500, 24, "Use cooked sprouts if advised for food safety."]
      ]
    : eggitarian
      ? [
          ["Chapati with egg curry or paneer and salad", 540, 30, "Use fully cooked egg curry."],
          ["Millet dosa with sambar and egg", 530, 29, "Add vegetables to sambar."],
          ["Vegetable pulao with raita and boiled egg", 550, 30, "Keep dinner moderate for reflux comfort."],
          ["Soup, chapati, and omelet", 520, 31, "Cook omelet firm; add vegetables."]
        ]
      : [
          ["Chapati with protein and salad", 540, 32, "Use chicken, fish, egg, dal, or paneer based on preference."],
          ["Chicken soup with chapati and vegetables", 520, 34, "Good lighter dinner option."],
          ["Fish or chicken curry with millet roti", 570, 35, "Cook thoroughly and avoid high-mercury fish."],
          ["Vegetable pulao with raita and grilled protein", 580, 36, "Keep salt and spice moderate."]
        ];

  return { breakfast, lunch, dinner };
}

function mealSet(profile, targets, dayIndex) {
  const library = mealLibrary(profile);
  const pick = (items, offset, time) => {
    const [name, calories, proteinG, portionNotes] = items[(dayIndex + offset - 1) % items.length];
    return scaleMeal({ time, name, calories, proteinG, portionNotes }, targets);
  };

  return [
    pick(library.breakfast, 0, "08:00"),
    pick(library.lunch, 1, "13:00"),
    pick(library.dinner, 2, "19:30")
  ];
}

function snackSet(profile, dayIndex) {
  const diet = String(profile.dietaryPreferences).toLowerCase();
  const options = [
    ["Fruit with roasted chana or seeds", 180, 7, "Skip allergens; seeds or chana work when nuts are avoided."],
    ["Pasteurized milk or curd with fruit and cinnamon", 210, 10, "Choose pasteurized milk/curd or calcium-fortified soy milk."],
    ["Whole-grain toast with paneer spread", 230, 12, "Add cucumber or tomato."],
    ["Vegetable soup with dal or beans", 190, 11, "Useful on lower-appetite days."],
    ["Low-fat yogurt with oats and berries", 220, 12, "Use pasteurized yogurt; choose lower-sugar options."]
  ];

  if (diet === "eggitarian" || diet === "non_vegetarian") {
    options.push(["Fully cooked egg with fruit", 210, 13, "Avoid raw or runny eggs."]);
  }

  const first = options[(dayIndex - 1) % options.length];
  const second = options[(dayIndex + 1) % options.length];
  return [
    { time: "10:30", name: first[0], calories: first[1], proteinG: first[2], portionNotes: first[3] },
    { time: "16:30", name: second[0], calories: second[1], proteinG: second[2], portionNotes: `${second[3]} Keep caffeine before 14:00 if used at all.` }
  ];
}

function exerciseSet(hasHypertension, targets, dayIndex) {
  const lowIntensityPlan = [
    {
      activity: "Easy walk plus pelvic-floor breathing",
      durationMin: 20,
      steps: ["5 min slow warm-up walk", "10 min easy flat-surface walk", "5 min pelvic-floor breathing and ankle circles"],
      benefit: "Maintains circulation and mobility while keeping intensity conservative."
    },
    {
      activity: "Prenatal mobility and side-lying stretches",
      durationMin: 18,
      steps: ["Cat-cow x 8", "Seated shoulder rolls x 10", "Side-lying hip comfort stretch 30 sec each side", "Pelvic-floor contractions: 2 sets of 8"],
      benefit: "Supports posture, hips, and pelvic floor without raising exertion much."
    },
    {
      activity: "Gentle indoor walk with posture resets",
      durationMin: 20,
      steps: ["4 rounds: 4 min easy walk + 1 min posture reset", "Finish with calf raises x 8 holding support"],
      benefit: "Breaks up sedentary desk time and supports lower-leg circulation."
    },
    {
      activity: "Breathing practice plus ankle and calf mobility",
      durationMin: 16,
      steps: ["Diaphragmatic breathing 3 min", "Ankle circles x 10 each side", "Supported calf raises x 8", "Pelvic tilts x 8", "Pelvic-floor contractions: 2 sets of 8"],
      benefit: "A low-demand recovery day that still keeps movement in the plan."
    },
    {
      activity: "Water walk or shaded easy walk",
      durationMin: 20,
      steps: ["5 min easy warm-up", "10 min comfortable walking", "5 min cool-down and hydration"],
      benefit: "Gentle aerobic movement with lower overheating risk when paced carefully."
    },
    {
      activity: "Supported prenatal yoga basics",
      durationMin: 18,
      steps: ["Seated breathing", "Supported cat-cow", "Wall-supported side stretch", "Child pose variation if comfortable", "Pelvic-floor relaxation"],
      benefit: "Encourages mobility and relaxation while avoiding strenuous positions."
    },
    {
      activity: "Restorative movement and symptom check",
      durationMin: 15,
      steps: ["5 min easy walk", "5 min gentle stretching", "5 min symptom check and hydration"],
      benefit: "Keeps the weekly rhythm without pushing intensity."
    }
  ];

  const standardPlan = [
    {
      activity: "Brisk walk plus prenatal mobility",
      durationMin: 30,
      steps: ["5 min warm-up", "20 min talk-test brisk walk", "5 min hip and calf mobility"],
      benefit: "Builds toward ACOG-style 150 min/week moderate aerobic activity."
    },
    {
      activity: "Low-impact prenatal strength circuit",
      durationMin: 25,
      steps: ["Supported squats x 8", "Wall push-ups x 8", "Bird-dog x 6 each side", "Side steps x 10 each side", "Repeat 2 rounds"],
      benefit: "Supports posture and muscular endurance without jumping or heavy strain."
    },
    {
      activity: "Stationary cycling or flat walking",
      durationMin: 30,
      steps: ["5 min easy pace", "20 min moderate talk-test pace", "5 min cool-down"],
      benefit: "Provides low-impact aerobic work with easy intensity control."
    },
    {
      activity: "Prenatal yoga and pelvic floor",
      durationMin: 25,
      steps: ["Breathing warm-up", "Cat-cow", "Supported warrior stance", "Seated hip mobility", "Pelvic-floor contractions and relaxation"],
      benefit: "Adds flexibility, balance support, and pelvic-floor awareness."
    },
    {
      activity: "Walk intervals",
      durationMin: 30,
      steps: ["5 min warm-up", "5 rounds: 3 min moderate + 1 min easy", "5 min cool-down"],
      benefit: "Adds variety while staying inside the talk-test range."
    },
    {
      activity: "Light resistance and mobility",
      durationMin: 25,
      steps: ["Band rows x 10", "Supported sit-to-stand x 8", "Standing hip abduction x 8 each side", "Wall angels x 8", "Repeat 2 rounds"],
      benefit: "Strengthens back, hips, and legs for daily comfort."
    },
    {
      activity: "Easy recovery walk and stretch",
      durationMin: 20,
      steps: ["15 min easy walk", "5 min calf, chest, and hip mobility"],
      benefit: "Recovery-focused day that keeps movement consistent."
    }
  ];

  const selected = hasHypertension ? lowIntensityPlan[dayIndex - 1] : standardPlan[dayIndex - 1];
  const durationMin = Math.min(selected.durationMin, targets.recommendedExerciseMinutesPerDay);

  return [
    {
      time: "17:30",
      activity: selected.activity,
      durationMin,
      intensity: hasHypertension ? "low; able to speak comfortably" : "low-to-moderate; talk-test comfortable",
      steps: selected.steps,
      benefit: selected.benefit,
      sourceBasis: hasHypertension
        ? "Conservative adaptation of ACOG/NHS pregnancy exercise guidance because hypertension is listed; clinician review recommended."
        : "Based on ACOG/NHS guidance for regular moderate activity, pelvic-floor work, and symptom-aware modifications.",
      precautions: "Stop for bleeding, dizziness, chest pain, severe headache, calf swelling, contractions, fluid leakage, shortness of breath before exertion, or reduced fetal movement."
    }
  ];
}

function optionBank(profile) {
  const library = mealLibrary(profile);
  return {
    breakfast: library.breakfast.map(([name]) => name),
    lunch: library.lunch.map(([name]) => name),
    dinner: library.dinner.map(([name]) => name),
    snacks: snackSet(profile, 1).map((snack) => snack.name),
    healthyFocus: [
      "Include pasteurized milk, curd, yogurt, cheese, or calcium-fortified soy alternatives for calcium and protein.",
      "Rotate legumes, dairy/curd, tofu/paneer, eggs, poultry, or low-mercury fish according to diet.",
      "Use varied vegetables and fruit across colors during the week.",
      "Prefer whole grains such as oats, brown rice, millet, dalia, chapati, and idli/dosa batter."
    ]
  };
}

function babySizeForWeek(week = 0) {
  const sizes = [
    { max: 4, comparison: "poppy seed", lengthCm: 0.2, weightG: 1, color: "#8f6a52" },
    { max: 8, comparison: "kidney bean", lengthCm: 1.6, weightG: 1, color: "#9b4c45" },
    { max: 12, comparison: "lime", lengthCm: 5.4, weightG: 14, color: "#86b84f" },
    { max: 16, comparison: "avocado", lengthCm: 11.6, weightG: 100, color: "#7aa35a" },
    { max: 20, comparison: "banana", lengthCm: 25.6, weightG: 300, color: "#e6c84d" },
    { max: 24, comparison: "corn cob", lengthCm: 30, weightG: 600, color: "#f0cc4f" },
    { max: 28, comparison: "eggplant", lengthCm: 37.6, weightG: 1000, color: "#6d4b8d" },
    { max: 32, comparison: "squash", lengthCm: 42.4, weightG: 1700, color: "#d99b3d" },
    { max: 36, comparison: "honeydew melon", lengthCm: 47.4, weightG: 2600, color: "#b8d978" },
    { max: 42, comparison: "watermelon", lengthCm: 51, weightG: 3400, color: "#579b68" }
  ];
  const size = sizes.find((item) => week <= item.max) ?? sizes[sizes.length - 1];
  return {
    week,
    comparison: size.comparison,
    lengthCm: size.lengthCm,
    weightG: size.weightG,
    color: size.color,
    note: "Approximate visual comparison; fetal growth varies and ultrasound/clinician measurements are more precise.",
    sourceBasis: "General week-by-week fetal growth ranges and public pregnancy trackers such as March of Dimes; comparison objects are illustrative."
  };
}

function nutritionRecommendations(profile) {
  const dairy = String(profile.dietaryPreferences).toLowerCase() === "vegetarian"
    ? "Pasteurized milk, curd, yogurt, paneer, cheese, or calcium-fortified soy milk."
    : "Pasteurized milk, curd, yogurt, cheese, eggs, lean protein, or calcium-fortified soy milk.";
  return [
    {
      title: "Milk and calcium",
      items: [dairy, "Prefer pasteurized dairy; use lower-fat/lower-sugar choices when suitable.", "If dairy-free, choose unsweetened calcium-fortified soy drinks or yogurt."]
    },
    {
      title: "Daily healthy foods",
      items: ["5 portions of varied fruit and vegetables.", "Whole grains such as oats, brown rice, millet, chapati, dalia, and wholemeal bread.", "Protein foods such as dal, beans, tofu, paneer, eggs, poultry, fish, nuts/seeds if not allergic."]
    },
    {
      title: "Key nutrients",
      items: ["Iron: beans, peas, leafy greens, fortified cereals, poultry/fish/meat if eaten.", "Vitamin D: fortified milk, egg yolk, low-mercury fatty fish if eaten, plus clinician-advised supplement.", "Choline: milk, eggs, soy foods, peanuts if not allergic."]
    }
  ];
}

function micronutrientRecommendations(profile) {
  const week = profile.gestationalWeek ?? 0;
  const trimesterFocus = week < 14
    ? "First trimester focus: folate, iodine, vitamin D, and nausea-tolerant iron/protein foods."
    : week < 28
      ? "Second trimester focus: iron, calcium, vitamin D, iodine, choline, omega-3, and steady protein for fetal growth."
      : "Third trimester focus: iron, calcium, vitamin D, iodine, choline, omega-3, hydration, and protein for growth and recovery.";

  return {
    title: `Week ${week} vitamins and minerals`,
    summary: trimesterFocus,
    items: [
      "Folate/folic acid: supports neural-tube and placental development; continue prenatal vitamin as clinician advised.",
      "Iron: supports expanding blood volume and helps lower anemia risk; pair beans/greens/fortified cereals with vitamin C foods.",
      "Calcium: supports fetal bones and teeth; include pasteurized milk, curd/yogurt, paneer, cheese, or fortified soy alternatives.",
      "Vitamin D: helps calcium absorption and bone health; use fortified foods and clinician-advised supplementation if needed.",
      "Iodine: supports fetal brain and thyroid development; use iodized salt in clinician-appropriate amounts.",
      "Choline: supports fetal brain development; sources include milk, eggs, soy foods, beans, and peanuts if not allergic.",
      "Omega-3 DHA: supports brain and eye development; consider low-mercury fish if eaten or clinician-approved vegetarian DHA."
    ],
    precautions: [
      "Do not start high-dose supplements without clinician approval.",
      "Avoid retinol/high-dose vitamin A supplements in pregnancy unless specifically prescribed.",
      "If hypertension, diabetes, anemia, thyroid disease, vomiting, or food restrictions are present, ask the clinician to individualize supplements."
    ],
    sourceBasis: "Based on guideline-level pregnancy nutrition themes from ACOG, NHS, and public health prenatal nutrition guidance."
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
  const flags = [
    {
      id: "routine-prenatal-review",
      severity: "green",
      description: "Plan uses conservative pregnancy activity and nutrition defaults.",
      immediateAction: "Continue routine prenatal follow-up.",
      recommendedOwner: "user",
      urgency: "days",
      rationale: "Routine monitoring is consistent with guideline-level antenatal care."
    }
  ];

  if (profile.conditions.some((condition) => condition.toLowerCase().includes("hypertension"))) {
    flags.unshift({
      id: "gestational-hypertension",
      severity: "yellow",
      description: "Gestational hypertension can change exercise, diet, and monitoring needs.",
      immediateAction: "Consult your clinician before increasing exercise intensity; seek urgent care for severe headache, visual symptoms, chest pain, severe swelling, or high blood pressure readings.",
      recommendedOwner: "clinician",
      urgency: "24-48 hours",
      rationale: "ACOG-style guidance treats hypertensive disorders in pregnancy as needing individualized clinician oversight."
    });
  }

  return flags;
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
