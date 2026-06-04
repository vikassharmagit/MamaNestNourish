# MyPregLeady

Streaming pregnancy-plan API based on the provided Pregnant Women Scope agent specification.

## Run

```powershell
npm start
```

The server listens on `http://localhost:3000`.

## Endpoint

`POST /api/plan/stream`

The response is newline-delimited JSON events:

- `tool.progress`
- `tool.result`
- `model.delta`
- `safety.alert`
- `done`

Example:

```powershell
$body = @{
  profileText = "I am 29, 22 weeks pregnant, vegetarian, moderate activity, gestational hypertension. I work a desk job."
  gestationalWeek = 22
  age = 29
  heightCm = 165
  weightKg = 68
  prePregnancyBMI = 25
  activityLevel = "moderate"
  dietaryPreferences = "vegetarian"
  conditions = @("gestational_hypertension")
  allergies = @("peanuts")
  constraints = @("no high impact exercise", "no caffeine after 2pm")
} | ConvertTo-Json

Invoke-WebRequest -Uri "http://localhost:3000/api/plan/stream" -Method Post -Body $body -ContentType "application/json"
```

## Test

```powershell
npm test
```

## Safety

Every completed output includes a medical disclaimer. Risk factors are surfaced through `safety.alert` events and in the final `riskRegister`. The deterministic implementation uses conservative defaults and asks follow-up questions when required fields are missing.
