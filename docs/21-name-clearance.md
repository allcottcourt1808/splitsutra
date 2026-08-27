# 21 — Name Clearance

**Settl is dead.** Three live expense-splitting products already ship under that name, and
two of them are on the same app stores we'd be listing in. This document records the
verdicts on the recorded runners-up, screens fourteen fresh candidates, and names a pick.

**Method, stated up front so nobody over-reads the conclusions.** Everything below is
**search evidence only** — public web results, app-store listings, company directories.
No registry lookups, no `whois`, no authoritative trademark search. What that buys us is a
reliable answer to _"is there a live product sitting on this name in our category?"_, which
is the question that actually kills names. What it cannot answer is _"is there a registered
mark we'd infringe?"_ — see [How to finish clearance](#how-to-finish-clearance). Where the
evidence was thin I have written **could not determine** rather than guessing.

**The constraint that shaped the list:** a name must be a valid Firebase project ID
(lowercase, 6–30 chars, `[a-z0-9-]`, leading letter) _and_ still read well with `-dev` /
`-prod` suffixes — see [08-firebase-setup.md](08-firebase-setup.md) — _and_ work as an npm
scope for `@name/core` ([01-requirements.md](01-requirements.md), ADR-01). That rules out
anything under six characters as a bare project ID, which is why the list has no `tab`,
`pot` or `chit`.

**Patterns deliberately excluded** because the owner has already exhausted them: dropped
vowels (`settl`, `splitr`, `tabl`), `split*` / `settle*` prefixes, and `-ly` / `-io`
endings. The list is weighted toward **coined words** — 8 of 14 — because the screening
below demonstrates the general rule: real words in this space are already spoken for.

---

## Part 1 — Verdicts on the recorded runners-up

### ⛔ Dutch — **DEAD**

The semantics are perfect and that is exactly the problem: everyone else got there first.

| Evidence                                                                            | Where                                                                                                                                                  |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **"Go Dutch Split"** — live iOS bill splitter                                       | [App Store id6751196017](https://apps.apple.com/us/app/go-dutch-split/id6751196017)                                                                    |
| **"Go Dutch — Simplify shared spending"** — live Android                            | [Play `com.godutch.godutchapp`](https://play.google.com/store/apps/details?id=com.godutch.godutchapp&hl=en_CA)                                         |
| **"Split Bill: Go Dutch"** — live iOS, receipt-scan + itemised assignment           | [App Store id6749756337](https://apps.apple.com/us/app/split-bill-go-dutch/id6749756337)                                                               |
| **"GoDutch: split group expenses"** — live iOS, notable enough for a Wikipedia page | [App Store id1363868328](https://apps.apple.com/us/app/godutch-split-group-expenses/id1363868328)                                                      |
| An app _literally named Dutch_, shipped, with a build writeup                       | ["Split Bills with Dutch: From Idea To App Release"](https://medium.com/@alexsoong_33845/split-bills-with-dutch-from-idea-to-app-release-be5db9a8e066) |

`dutch.com`: **could not determine** — search returned only Netherlands app-dev agencies.
It doesn't matter. Four-plus live competitors carry this name, and "going Dutch" is a
generic descriptor for the exact service, which makes it both undiscoverable in store
search and close to unregistrable as a mark. **Worse than Settl, not better.**

### ⛔ Reckon — **DEAD. The worst of the three.**

[Reckon Limited](<https://en.wikipedia.org/wiki/Reckon_(company)>) (ASX: **RKN**), founded
1987, North Sydney, ~180 staff, **100,000+ customers**, operating on `reckon.com`. Product
line: Reckon One (cloud accounting + payroll), Reckon Payroll, Reckon Invoice, **Reckon
Payments**, Reckon Business Loans, Reckon Insights. Trades in AU, NZ and the US (via
subsidiary nQ Zebraworks) and is indexed in
[fintech company directories](https://internationalfintech.com/company/reckon/).

This is not adjacency, it is a **bullseye**: accounting software plus payments, the
neighbouring category to ours, with ~40 years of continuous use and near-certain
registrations in classes 9 and 36. **Do not spend another hour on this name.**

### 🟠 Parity — **RISKY, effectively dead**

[Parity Technologies](https://uk.linkedin.com/company/paritytech), London, founded 2015,
`parity.io` — core blockchain infrastructure, builders of Substrate and the Polkadot SDK,
and classified under **fintech** in
[Dealroom](https://app.dealroom.co/companies/parity) and
[Tracxn](https://tracxn.com/d/companies/parity-technologies). `parity.com`: **could not
determine**; Parity Tech themselves sit on `.io`, which suggests `.com` was not obtainable
even for a well-funded company.

Not an expense splitter, so the direct-confusion argument is weaker than for Reckon. Two
things still sink it: it is a **famous money-adjacent tech brand** with the budget to
defend a mark, and "parity" is a **generic finance term** (purchasing-power parity, parity
price), which is descriptively weak. Also barred: `-io` endings are on the exhausted list,
and `parity.io` is the incumbent's own address.

---

## Part 2 — Fresh candidates, screened

All fourteen were checked for: an existing app of the name, an existing
fintech/accounting/payments company, and whether `.app` / `.com` show a live site.
**Category collision is what kills a name here** — a same-name business in an unrelated
field is a much smaller problem than a same-name business in money.

Firebase column assumes the bare name as project ID base; all listed names are lowercase,
`[a-z]`-leading, and 6–8 chars, so `<name>-dev` / `<name>-prod` land inside 30 chars.

### The survivors

| Name         | Type                                              | App collision                                                                                                                                                                                                                                     | Fintech/accounting collision                                                                                                                                                                                              | `.app`                      | `.com`                                                                                                                    | npm                                                                              | Verdict                      |
| ------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------- |
| **Fairden**  | coined (_fair_ + _-den_)                          | **None found**                                                                                                                                                                                                                                    | **None found**. Only prior use: [Fairden](https://tracxn.com/d/companies/fairden), a Jakarta apparel e-commerce founded 2014 — **defunct** ("not active anymore")                                                         | No result — **likely free** | **Parked, [listed for sale](https://www.fairden.com/)** via Atom                                                          | No `fairden` package (nearest: `faircode`, `@fairdex/*`)                         | 🟢 **Viable**                |
| **Tuppence** | real, archaic (2d)                                | **None found** across three searches                                                                                                                                                                                                              | **None found**                                                                                                                                                                                                            | No result — **likely free** | Could not determine                                                                                                       | No package; word appears only as sample output in `generate-passphrase-cli` docs | 🟢 **Viable**                |
| **Skifta**   | coined-feel (Old Norse _skifta_, to divide/share) | [Skifta](https://en.wikipedia.org/wiki/Skifta) — Qualcomm Atheros DLNA media-shifting app, 2009, **service shut down 1 July 2014**                                                                                                                | **None found**                                                                                                                                                                                                            | Could not determine         | **Was `skifta.com`** — Qualcomm-held, status unknown                                                                      | No `skifta` (`skift` exists — different)                                         | 🟡 **Viable, with a caveat** |
| **Halvsy**   | coined (_halvsies_)                               | Exact spelling returns **nothing**                                                                                                                                                                                                                | **Adjacent**: [Halvsies](https://www.suncommercial.com/brazil_times/archives/article_1645709a-6edb-5e0d-aefe-5be456b553c6.html), a US fundraising platform that takes 4% of goal — money movement, phonetically identical | No result — **likely free** | Could not determine                                                                                                       | No package                                                                       | 🟡 **Risky**                 |
| **Halvora**  | coined (_halve_)                                  | None found                                                                                                                                                                                                                                        | **None found**                                                                                                                                                                                                            | Could not determine         | **Occupied-adjacent**: live storefront [shophalvora.com](https://shophalvora.com/), household goods, claims 40k customers | No package                                                                       | 🟡 **Risky**                 |
| **Potluck**  | real word                                         | **Crowded**: [potluck.us](https://www.potluck.us/) event planner, ["The Potluck"](https://apps.apple.com/us/app/the-potluck/id6478000032), [Dopotluck](https://apps.apple.com/us/app/dopotluck/id1492017540), [Potluckly](https://potluckly.com/) | None found                                                                                                                                                                                                                | Could not determine         | Occupied (`.us` in use, `.com` unknown)                                                                                   | Not checked                                                                      | 🟡 **Risky**                 |

### The dead — recorded so nobody re-proposes them

| Name          | Killed by                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Chippin**   | ⛔ **Direct category.** [Chippin](https://www.crunchbase.com/organization/chippin) (Coventry UK, 2016, Charlie Curson) was _literally an online payment-splitting service_ — now deadpooled, but the mark and the history exist. Meanwhile [Chippin Turkey](https://play.google.com/store/apps/details?id=com.tani.chippin) is a **live mobile payments + loyalty app with 1M+ users**.                                                                    |
| **Tessera**   | ⛔ **Direct category, four ways.** [Tessera Financial Software](https://pitchbook.com/profiles/company/471802-60) (Fort Lauderdale, $28.4M raised); Tessera by Mysten Labs, a **B2B payment settlement network**; Tessera Venture Partners; plus near-homophone [Tesser](https://www.prnewswire.com/news-releases/tesser-raises-4-5m-seed-round-to-bring-instant-cross-border-payments-to-banks-and-psps-302590774.html), stablecoin payments, $4.5M seed. |
| **Quidra**    | ⛔ **Direct category.** [quidrafinance.com](https://quidrafinance.com/) trades as "QuidraFinance Bank". Also crowded by [Quid](https://en.wikipedia.org/wiki/Quid_Inc.), an 8M-user Indian lending fintech.                                                                                                                                                                                                                                                |
| **Solvara**   | ⛔ **Category + `.app` gone.** [Solvara Capital](https://solvara-capital.webflow.io/) is an investment bank; two Solvara Tech firms exist; and [`solvara.app`](https://apps.apple.com/au/app/solvara/id6761028492) is a live iOS app.                                                                                                                                                                                                                      |
| **Equipoise** | ⛔ **Class 36 everywhere.** [Equipoise Financial Services](https://www.equipoisefs.com/), Equipoise Wealth (Denver, 1999), GW Equipoise (asset management), Equipoise Software (oil & gas). Elegant word, thoroughly claimed by advisors.                                                                                                                                                                                                                  |
| **Halven**    | ⛔ **`.app` is gone.** [halven.app](https://halven.app/) is a live iOS+Android renovation before/after photo app. Category is unrelated, so the trademark risk is mild — but losing the `.app` is the one domain outcome we said we would not accept.                                                                                                                                                                                                      |
| **Tabora**    | ⛔ **`.app` is gone.** [tabora.app](https://tabora.app/) resolves to a live site. (Also a city in Tanzania — permanently noisy search.)                                                                                                                                                                                                                                                                                                                    |
| **Evenza**    | ⛔ **Crowded to uselessness.** [evenza.ai](https://evenza.ai/), [evenza.com](https://www.evenza.com/contact-us), [evenza.net](https://evenza.net/), evenza.co.za, a Product Hunt launch and a GitHub project — none in fintech, all in the way.                                                                                                                                                                                                            |

**Read the pattern.** Every name killed on _category_ was a real word or a
Latin/Italianate near-word (Tessera, Equipoise, Quidra, Solvara). Every coined-from-English
name (Fairden, Halvsy, Halvora, Tuppence) survived the category test and died, if at all,
on a domain. That is the argument for coining, and it is why the shortlist looks the way it
does.

---

## Part 3 — Shortlist

| #     | Name         | The one-line argument                                                                                                                                                                                                                              |
| ----- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | **Fairden**  | The only candidate that came back clean on **all four** checks — no app, no fintech company, `.app` apparently free, `.com` parked and _buyable_ — and "fair" is the product's actual promise, not a description of its mechanism.                 |
| **2** | **Tuppence** | The quietest namespace of the fourteen; money-flavoured without being descriptive, and impossible to confuse with an accounting package — but it's 8 characters, reads British, and the sparse results are as much low signal as proven clearance. |
| **3** | **Skifta**   | Best sound in the list and the best hidden meaning (Old Norse "to divide"), spoiled by Qualcomm having shipped and shuttered a product on it — dormant, not dead, and `.com` is theirs.                                                            |
| **4** | **Halvsy**   | Playful, instantly legible as "halvsies", exact spelling unclaimed — but a US fundraising platform is phonetically identical **and handles money**, which is the one adjacency we cannot shrug off.                                                |
| **5** | **Halvora**  | Clean in our category and clean on trademark-relevant classes, but a live consumer storefront already answers to the name, so we would be sharing search results forever.                                                                          |

### Top pick: **Fairden**

**Why:** it is the only name here where every check came back either clean or _purchasable_.
No expense, budgeting, payments, banking or accounting entity uses it. The single prior
commercial user — a Jakarta apparel shop — has been dead for a decade and is a
different class in a different country. `fairden.app` shows no live site; `fairden.com` is
parked with a for-sale listing, which is a **price problem, not a clearance problem**, and
`.com` was never the requirement. No npm package blocks `@fairden/core`. `fairden`,
`fairden-dev` and `fairden-prod` are all valid Firebase project IDs at 7/11/12 characters.

It also passes the tests that killed everything else: coined rather than real, so it can be
owned; two syllables and phonetically obvious, so it survives being said aloud in a bar;
semantically about **fairness** — the thing the split engine
([04-split-engine.md](04-split-engine.md)) actually guarantees — rather than about
splitting or settling, the two wells that are now poisoned.

**What would change my mind:** a USPTO hit in class 9 or 36, or `fairden.app` turning out to
be registered-but-parked. Both are cheap to check and neither is checkable from here.

**Fallback order:** Tuppence → Skifta. If the owner wants the shortest possible name,
Skifta is the one to fight for; if they want the safest, Tuppence.

---

## How to finish clearance

Nothing above is a legal opinion, and **no authoritative trademark search was performed** —
that is not something a web search can do. Before any money is spent on design, domains or
an App Store listing, run these four, in order. Budget an afternoon.

1. **USPTO TESS / Global Brand Database — classes 9 and 36.** Class 9 covers downloadable
   software, class 36 covers financial services; an expense-splitting app plausibly touches
   both. Search the exact string _and_ obvious phonetic equivalents (`fairden`, `farden`,
   `fairdan`). **Flag in priority order — these most need a real search:**
   **Skifta** (does Qualcomm's mark survive, or was it abandoned after the 2014 shutdown?),
   **Halvsy** (is "Halvsies" registered by the fundraising platform — class 36?),
   **Halvora** and **Potluck** (live commercial users, classes unknown), then **Fairden**
   (expected clean; confirm the Indonesian entity never filed in the US/EU).
2. **Domain status, properly.** Registrar lookup on `<name>.app` and `<name>.com` — this is
   the step that needs a real registry query, not a search engine. Buy `.app` first; treat
   `.com` as negotiable. Note `.app` is a Google TLD and **HSTS-preloaded**: HTTPS is
   mandatory, which suits Firebase Hosting fine ([10-deployment.md](10-deployment.md)).
3. **App store namespace sweep.** Search the exact name in both stores _and_ the store
   search-suggest dropdowns, which surface near-misses that web search misses entirely.
   Check that the intended bundle ID (`com.<name>.app` or similar) is unused.
4. **Handle + registry sweep.** npm (`@<name>` scope — note scopes are claimed by _user or
   org_, not by package name), GitHub org, and the social handles worth having. Then, and
   only then, create the Firebase project: **project IDs are globally unique across all of
   Firebase**, so a name can pass every check above and still be taken at creation
   ([08-firebase-setup.md](08-firebase-setup.md)). Claim `<name>-dev` and `<name>-prod`
   in the same sitting.

**One caution on process.** Settl failed after the codename was already in the repo, the
docs and the project ID. Whatever the owner picks, do steps 1–4 **before** the rename lands
anywhere, and rename once. The cost of this document is a morning; the cost of doing it
again after launch is the App Store listing, the domain, the Firebase project IDs, and
every URL anyone has ever shared.
