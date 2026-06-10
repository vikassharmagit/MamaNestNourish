const encoder = new TextEncoder();

function xmlEscape(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function textRun(text, options = {}) {
  const bold = options.bold ? "<w:b/>" : "";
  return `<w:r><w:rPr>${bold}</w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
}

function paragraph(text, options = {}) {
  const style = options.style ? `<w:pStyle w:val="${options.style}"/>` : "";
  const spacing = options.spacing === false ? "" : '<w:spacing w:after="120"/>';
  const pPr = style || spacing ? `<w:pPr>${style}${spacing}</w:pPr>` : "";
  return `<w:p>${pPr}${textRun(text, options)}</w:p>`;
}

function heading(text, level = 1) {
  return paragraph(text, { style: level === 1 ? "Heading1" : "Heading2", bold: true });
}

function bullet(text) {
  return paragraph(`- ${text}`, { style: "ListParagraph" });
}

function labelValue(label, value) {
  if (value === undefined || value === null || value === "") return "";
  return paragraph(`${label}: ${value}`);
}

function safeArray(items) {
  return Array.isArray(items) ? items.filter(Boolean) : [];
}

function unique(items) {
  return [...new Set(safeArray(items))];
}

function caloriesLabel(targets = {}) {
  const min = targets.recommendedDailyCaloriesMin;
  const max = targets.recommendedDailyCaloriesMax;
  return min && max ? `${min}-${max} kcal/day` : "";
}

function profileSummary(profile = {}, targets = {}) {
  const rows = [
    labelValue("Gestational age", profile.gestationalAgeLabel || `${profile.gestationalWeek || ""} weeks`),
    labelValue("Expected delivery date", profile.expectedDeliveryDate),
    labelValue("Diet preference", profile.dietaryPreferences),
    labelValue("Activity level", profile.activityLevel),
    labelValue("Allergies", safeArray(profile.allergies).join(", ") || "None listed"),
    labelValue("Health conditions", safeArray(profile.conditions).join(", ") || "None listed"),
    labelValue("Daily calories", caloriesLabel(targets)),
    labelValue("Daily protein", targets.recommendedDailyProteinG ? `${targets.recommendedDailyProteinG} g` : ""),
    labelValue("Hydration", targets.hydrationLiters ? `${targets.hydrationLiters} L` : "")
  ].filter(Boolean);
  return rows.length ? rows : [paragraph("Profile details were not available.")];
}

function safetyText(plan = {}) {
  const flags = safeArray(plan.riskRegister);
  if (!flags.length) {
    return ["No major risk flag was found from the details provided. Keep using this as educational guidance and contact your care provider for new symptoms or concerns."];
  }
  return flags.map((flag) => `${flag.description || ""} ${flag.immediateAction || ""}`.trim());
}

function mealLines(dailyPlan = {}) {
  const meals = safeArray(dailyPlan.meals).map((meal) => {
    const nutrition = [meal.calories ? `${meal.calories} kcal` : "", meal.proteinG ? `${meal.proteinG} g protein` : ""]
      .filter(Boolean)
      .join(", ");
    return `${meal.time || "Meal"} - ${meal.name || ""}${nutrition ? ` (${nutrition})` : ""}${meal.portionNotes ? `. ${meal.portionNotes}` : ""}`;
  });
  const snacks = safeArray(dailyPlan.snacks).map((snack) =>
    `${snack.time || "Snack"} - ${snack.name || ""}${snack.portionNotes ? `. ${snack.portionNotes}` : ""}`
  );
  return [...meals, ...snacks];
}

function exerciseLines(dailyPlan = {}) {
  return safeArray(dailyPlan.exercise).flatMap((exercise) => [
    `${exercise.durationMin || ""} min ${exercise.activity || ""}`.trim(),
    ...safeArray(exercise.steps)
  ]).filter(Boolean);
}

function optionBankSections(optionBank = {}) {
  const sections = [
    ["Breakfast", optionBank.breakfast],
    ["Lunch", optionBank.lunch],
    ["Dinner", optionBank.dinner],
    ["Snacks", optionBank.snacks]
  ];
  return sections.flatMap(([title, items]) => safeArray(items).length
    ? [paragraph(title, { bold: true }), ...safeArray(items).map(bullet)]
    : []
  );
}

function daySection(entry = {}) {
  const dailyPlan = entry.dailyPlan || {};
  return [
    heading(`Day ${entry.dayIndex || ""}${dailyPlan.date ? ` - ${dailyPlan.date}` : ""}`, 2),
    paragraph("Meals and snacks", { bold: true }),
    ...mealLines(dailyPlan).map(bullet),
    paragraph("Exercise", { bold: true }),
    ...exerciseLines(dailyPlan).map(bullet)
  ];
}

function nutritionSections(plan = {}) {
  const nutrition = safeArray(plan.nutritionRecommendations).flatMap((group) => [
    paragraph(group.title || "Recommendation", { bold: true }),
    ...safeArray(group.items).map(bullet)
  ]);
  const micronutrients = plan.micronutrientRecommendations
    ? [
        paragraph(plan.micronutrientRecommendations.title || "Vitamins and minerals", { bold: true }),
        ...safeArray(plan.micronutrientRecommendations.items).map(bullet)
      ]
    : [];
  return [...nutrition, ...micronutrients];
}

export function createPlanDocumentXml(plan = {}) {
  const weeklyPlan = safeArray(plan.weeklyPlan);
  const today = weeklyPlan[0]?.dailyPlan || {};
  const profile = plan.profile || {};
  const targets = plan.targets || {};
  const firstOptionBank = today.optionBank || {};
  const babySize = plan.babySize || {};
  const healthyFocus = unique(weeklyPlan.flatMap(({ dailyPlan }) => safeArray(dailyPlan?.optionBank?.healthyFocus)));
  const milkRecommendations = safeArray(plan.nutritionRecommendations)
    .filter((group) => /milk|calcium|food/i.test(group.title || ""))
    .flatMap((group) => safeArray(group.items));

  const body = [
    paragraph("MamaNestNourish Weekly Plan", { style: "Title", bold: true }),
    heading("Profile Summary"),
    ...profileSummary(profile, targets),
    heading("Baby Size And Current Week"),
    labelValue("Week", babySize.week || profile.gestationalWeek),
    labelValue("Baby-size comparison", babySize.comparison),
    labelValue("Approximate length", babySize.lengthCm ? `${babySize.lengthCm} cm` : ""),
    labelValue("Approximate weight", babySize.weightG ? `${babySize.weightG} g` : ""),
    babySize.note ? paragraph(babySize.note) : "",
    heading("Safety Banner"),
    ...safetyText(plan).map(bullet),
    heading("Today's Plan"),
    paragraph("Meals and snacks", { bold: true }),
    ...mealLines(today).map(bullet),
    paragraph("Exercise", { bold: true }),
    ...exerciseLines(today).map(bullet),
    heading("Seven-Day Plan"),
    ...weeklyPlan.flatMap(daySection),
    heading("Healthy Variety Options"),
    ...optionBankSections(firstOptionBank),
    heading("Healthy Focus"),
    ...(healthyFocus.length ? healthyFocus.map(bullet) : [paragraph("Healthy focus options were not available for this plan.")]),
    heading("Calcium and Healthy Food Recommendations"),
    ...(milkRecommendations.length ? milkRecommendations.map(bullet) : [paragraph("Follow the nutrition recommendations below and choose allergy-safe milk or calcium alternatives as needed.")]),
    heading("Nutrition Recommendations"),
    ...nutritionSections(plan),
    heading("Disclaimer"),
    paragraph(plan.disclaimer || "Educational guidance only; not a substitute for professional medical advice.")
  ].filter(Boolean).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${body}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:rPr><w:sz w:val="22"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:after="280"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="34"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="260" w:after="140"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="28"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="180" w:after="100"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="24"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph">
    <w:name w:val="List Paragraph"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:ind w:left="360"/><w:spacing w:after="80"/></w:pPr>
  </w:style>
</w:styles>`;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function le16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function le32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

function zip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [name, content] of files) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(content);
    const crc = crc32(data);
    const localHeader = Buffer.concat([
      le32(0x04034b50), le16(20), le16(0), le16(0), le16(0), le16(0), le32(crc),
      le32(data.length), le32(data.length), le16(nameBytes.length), le16(0), nameBytes
    ]);
    localParts.push(localHeader, data);

    centralParts.push(Buffer.concat([
      le32(0x02014b50), le16(20), le16(20), le16(0), le16(0), le16(0), le16(0), le32(crc),
      le32(data.length), le32(data.length), le16(nameBytes.length), le16(0), le16(0), le16(0),
      le16(0), le32(0), le32(offset), nameBytes
    ]));

    offset += localHeader.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.concat([
    le32(0x06054b50), le16(0), le16(0), le16(files.length), le16(files.length),
    le32(centralDirectory.length), le32(offset), le16(0)
  ]);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

export function createPlanDocx(plan) {
  return zip([
    ["[Content_Types].xml", encoder.encode(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`)],
    ["_rels/.rels", encoder.encode(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`)],
    ["word/_rels/document.xml.rels", encoder.encode(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`)],
    ["word/document.xml", encoder.encode(createPlanDocumentXml(plan))],
    ["word/styles.xml", encoder.encode(stylesXml())]
  ]);
}
