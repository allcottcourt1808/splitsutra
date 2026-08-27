# 08 — Firebase Setup

## Prerequisites (none installed on this machine yet — verified)

| Tool         | Version          | Why                                    | Status                         |
| ------------ | ---------------- | -------------------------------------- | ------------------------------ |
| Node.js      | 20 LTS or 22 LTS | Runtime for everything                 | ❌ **not installed**           |
| pnpm         | 9+               | Workspace manager                      | ❌ (via `corepack enable`)     |
| Java JDK     | 11+              | **Required by the Firestore emulator** | ❌ **not installed**           |
| Firebase CLI | 13+              | Deploy, emulators                      | ❌ (`npm i -g firebase-tools`) |
| Git          | any              | Present: 2.55.0                        | ✅                             |

> Java catches people out — the Firestore and Auth emulators are Java processes. Without a
> JDK, `firebase emulators:start` fails with an unhelpful error. Install Temurin 21.

---

## Firebase projects

Create **two** projects. Do not develop against production.

| Project ID        | Purpose                                       |
| ----------------- | --------------------------------------------- |
| `splitsutra-dev`  | Deployed dev/staging, real devices, test data |
| `splitsutra-prod` | Real users                                    |

Wire both as CLI aliases:

```bash
firebase use --add splitsutra-dev --alias dev
```

### Per-project console configuration

**1. Authentication → Sign-in method** — enable:

- Email/Password (also enable _Email link_ if you want passwordless later)
- Phone
- Google (set the public-facing name and support email)

**2. Authentication → Settings → User actions**

- Enable _Email enumeration protection_ (prevents probing which emails are registered).

**3. Phone auth test numbers (dev project)**
Add fixed test numbers with fixed OTP codes, e.g. `+91 9999999999` → `123456`.
**Real SMS costs money and has a low free quota — use test numbers for all development.**

**4. Authorized domains**
Add `localhost` and your Hosting domains. Google sign-in and phone auth both fail with an
opaque error if the origin isn't authorised.

**3b. SMS region policy 🔴 — do this the moment Phone is enabled**
Authentication → Settings → **SMS region policy**: deny all, **allow `US` only**.

SMS toll fraud is the single largest realistic cost risk on this project — attackers drive
phone-auth flows to premium-rate international numbers and take a cut of the carrier fee.
Restricting destinations removes essentially the whole attack surface. Add countries as you
actually get users there. Also set a **phone auth quota** (start at 50 SMS/day). See
[18-cost-control.md](18-cost-control.md) §5.

**5. Firestore**

- Create the database in **Native mode**.
- Location **`us-central1`** (Iowa) to match the Functions region. ⚠️ **Location is
  permanent — choose deliberately.**
- Single-region `us-central1` is chosen over multi-region `nam5`: lower cost, lower write
  latency, colocated with Functions. Multi-region buys durability this app doesn't need.
- Start in **locked mode**; rules are deployed from the repo, never edited in the console.

**6. Billing — ⚠️ NOT YET**

> **Create both projects on the free Spark plan and leave them there.**
>
> Nothing before Phase 11 touches a cloud resource — Phases 00–10 run entirely on the local
> emulator suite. Linking billing early creates exposure for no benefit. The upgrade to
> Blaze, together with budget alerts and a hard kill switch, happens in
> [phase-11-deploy.md](../checklists/phase-11-deploy.md).
>
> The _choice_ of Blaze is unchanged (ADR-04 — Spark has no Cloud Functions, which would
> break server-authoritative balances). Only the timing moved. Full reasoning and the
> modelled cost ladder: [18-cost-control.md](18-cost-control.md).

**7. App Check** (Phase 10, not day one)

- Register the web app with reCAPTCHA Enterprise.
- Run in **monitoring mode** first to confirm legitimate traffic passes, and only then
  enforce on Firestore and Functions. Enforcing immediately will lock you out of your own app.

---

## Local emulator suite

`firebase.json`:

```json
{
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "functions": [{ "source": "functions", "codebase": "default" }],
  "hosting": {
    "public": "../apps/web/dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }]
  },
  "emulators": {
    "auth": { "port": 9099 },
    "firestore": { "port": 8080 },
    "functions": { "port": 5001 },
    "hosting": { "port": 5000 },
    "ui": { "enabled": true, "port": 4000 },
    "singleProjectMode": true
  }
}
```

The SPA rewrite (`** → /index.html`) is required or every deep link 404s on refresh.

### Connecting the client to emulators

```ts
// packages/core/src/firebase/init.ts
if (import.meta.env.VITE_USE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}
```

Use `127.0.0.1`, not `localhost` — Node 18+ resolves `localhost` to IPv6 `::1` first, and
the emulators bind IPv4 by default. This causes a confusing `ECONNREFUSED`.

### Persisting emulator data between runs

```bash
firebase emulators:start --import=./.emulator-data --export-on-exit
```

Add `.emulator-data/` to `.gitignore`.

### Seed script

`firebase/seed.ts` — creates 3 test users, 2 groups, ~10 expenses across all four split
methods, and one settlement. Run against the emulator so a fresh clone gets a realistic
app in one command. **Worth the 30 minutes; you will run it hundreds of times.**

---

## Environment configuration

`apps/web/.env.local` (gitignored):

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=splitsutra-dev.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=splitsutra-dev
VITE_FIREBASE_STORAGE_BUCKET=splitsutra-dev.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_USE_EMULATORS=true
```

Commit `.env.example` with the keys and empty values.

> **On "leaking" the Firebase config:** these values are public identifiers, not secrets.
> They ship in every Firebase web app's bundle by design. Security comes from Security
> Rules and App Check. Do not waste effort hiding them — but _do_ keep service-account
> JSON keys out of the repo entirely; those **are** secrets.

---

## Deploy commands

```bash
firebase deploy --only firestore:rules --project dev
firebase deploy --only firestore:indexes --project dev
firebase deploy --only functions --project dev
firebase deploy --only hosting --project dev
```

Always deploy **rules and indexes before** the code that depends on them, or the first
users hit permission-denied and missing-index errors.
