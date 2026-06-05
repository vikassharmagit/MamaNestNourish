# MyPregLady

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

## Data Update Workflow

The planner uses approved recommendation data from `data/*.json` instead of hardcoded meal, snack, exercise, nutrient, safety, and fetal-growth libraries in code.

- `data/meals.json`, `data/snacks.json`, and `data/exercises.json` contain approved planning options.
- `data/nutrients.json`, `data/safety-rules.json`, and `data/fetal-growth.json` contain approved guidance and comparison data.
- `data/sources.json` tracks trusted source URLs, last check metadata, and review requirements.
- `data/pending-updates.json` stores source changes or proposed records that require review.

Run source checks with:

```powershell
npm run update:sources
```

This checks trusted source metadata and creates pending review items. Medical guidance is not auto-applied; approved data changes must be reviewed first.

Protected review endpoints:

- `GET /api/admin/pending-updates`
- `POST /api/admin/approve-update` with `{ "id": "pending-update-id" }`
- `POST /api/admin/reject-update` with `{ "id": "pending-update-id", "reason": "..." }`
- `POST /api/admin/refresh-sources`

## Cognito Authentication

Set these environment variables to enable AWS Cognito authentication:

```powershell
$env:COGNITO_REGION="us-east-1"
$env:COGNITO_USER_POOL_ID="your-user-pool-id"
$env:COGNITO_CLIENT_ID="your-app-client-id"
npm start
```

When these variables are present, `POST /api/plan/stream` requires an `Authorization: Bearer <idToken>` header. The app includes signup, confirmation, login, and logout UI backed by Cognito. Configure the Cognito User Pool to allow email and phone-number sign-in aliases if both login methods are required.

## Safety

Every completed output includes a medical disclaimer. Risk factors are surfaced through `safety.alert` events and in the final `riskRegister`. The deterministic implementation uses conservative defaults and asks follow-up questions when required fields are missing.
