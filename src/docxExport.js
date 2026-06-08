const encoder = new TextEncoder();

function xmlEscape(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function paragraph(text) {
  return `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

function heading(text) {
  return `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${xmlEscape(text)}</w:t></w:r></w:p>`;
}

function bullet(text) {
  return paragraph(`- ${text}`);
}

function buildDocumentXml(plan) {
  const weeklyPlan = plan.weeklyPlan || [];
  const profile = plan.profile || {};
  const targets = plan.targets || {};
  const body = [
    heading("MamaNestNourish Weekly Plan"),
    paragraph(`Gestational age: ${profile.gestationalAgeLabel || `${profile.gestationalWeek || ""} weeks`}`),
    paragraph(`Calories: ${targets.recommendedDailyCaloriesMin || ""}-${targets.recommendedDailyCaloriesMax || ""}`),
    paragraph(`Protein: ${targets.recommendedDailyProteinG || ""}g`),
    paragraph(`Hydration: ${targets.hydrationLiters || ""}L`),
    plan.riskRegister?.length
      ? paragraph(`Safety note: ${plan.riskRegister[0].description} ${plan.riskRegister[0].immediateAction}`)
      : paragraph("Safety note: No major risk flag was found from the details provided."),
    heading("Seven-Day Plan"),
    ...weeklyPlan.flatMap(({ dayIndex, dailyPlan }) => {
      const exercise = dailyPlan.exercise?.[0] || {};
      return [
        heading(`Day ${dayIndex}`),
        paragraph(`Date: ${dailyPlan.date || ""}`),
        paragraph("Meals"),
        ...(dailyPlan.meals || []).map((meal) =>
          bullet(`${meal.time} ${meal.name} - ${meal.calories} kcal, ${meal.proteinG}g protein. ${meal.portionNotes || ""}`)
        ),
        ...(dailyPlan.snacks?.length
          ? [paragraph("Snacks"), ...dailyPlan.snacks.map((snack) => bullet(`${snack.time} ${snack.name}. ${snack.portionNotes || ""}`))]
          : []),
        paragraph(`Exercise: ${exercise.durationMin || ""} min ${exercise.activity || ""}`),
        ...(exercise.steps || []).map((step) => bullet(step))
      ];
    }),
    heading("Healthy Variety Options"),
    ...["breakfast", "lunch", "dinner", "snacks"].flatMap((key) => {
      const options = weeklyPlan[0]?.dailyPlan?.optionBank?.[key] || [];
      return options.length ? [paragraph(key[0].toUpperCase() + key.slice(1)), ...options.map(bullet)] : [];
    }),
    heading("Nutrition Recommendations"),
    ...(plan.nutritionRecommendations || []).flatMap((group) => [
      paragraph(group.title),
      ...(group.items || []).map(bullet)
    ]),
    heading("Disclaimer"),
    paragraph(plan.disclaimer || "Educational guidance only; not a substitute for professional medical advice.")
  ].join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${body}
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`;
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
</Types>`)],
    ["_rels/.rels", encoder.encode(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`)],
    ["word/document.xml", encoder.encode(buildDocumentXml(plan))]
  ]);
}
