# TAMAMHEALTH EMR — Vision Mind Map

> *"There's so much to do. This is the big elephant. But let us look at the trunk.*
> *The trunk sucks up water and feeds the whole body."*
> — South Sudan Health System Expert

---

## THE PROBLEM

```
                    SOUTH SUDAN HEALTH SYSTEM — CURRENT STATE

    ╔══════════════════════════════════════════════════════════════════╗
    ║                                                                  ║
    ║   67% of facilities do NOT report to DHIS2                       ║
    ║   <33% national reporting rate                                   ║
    ║   No national ID system                                          ║
    ║   Civil salaries unpaid >1 year                                  ║
    ║   Lowest immunization coverage in the world                      ║
    ║   ~2,400 Bomas with zero digital supervision                     ║
    ║   Health workers making diagnoses alone, unreviewed               ║
    ║                                                                  ║
    ╚══════════════════════════════════════════════════════════════════╝

    The data exists. It just never makes it up the chain.
    Not because people don't care — because the tools don't fit.
```

---

## THE VISION

```
    ╔═══════════════════════════════════════════════════════════════════╗
    ║                                                                   ║
    ║   Every patient encounter captured.                               ║
    ║   Every diagnosis AI-assisted.                                    ║
    ║   Every vaccine tracked in real time.                             ║
    ║   Every birth and death registered.                               ║
    ║   Every data point flowing to DHIS2.                              ║
    ║                                                                   ║
    ║   All of it working OFFLINE on a $50 Android phone.               ║
    ║                                                                   ║
    ╚═══════════════════════════════════════════════════════════════════╝
```

---

## THE MIND MAP

```
                                    ┌─────────────┐
                                    │   TAMAMHEALTH EMR  │
                                    │  "The Trunk" │
                                    └──────┬──────┘
                                           │
              ┌────────────────────────────┼────────────────────────────┐
              │                            │                            │
     ┌────────▼────────┐        ┌──────────▼──────────┐      ┌────────▼────────┐
     │  POINT OF CARE   │        │   SUPERVISION &     │      │   NATIONAL      │
     │  (Where healing  │        │   QUALITY CONTROL    │      │   INTELLIGENCE  │
     │   happens)       │        │   (The feedback      │      │   (The big      │
     │                  │        │    loop)              │      │    picture)     │
     └────────┬────────┘        └──────────┬──────────┘      └────────┬────────┘
              │                            │                            │
   ┌──────────┼──────────┐     ┌───────────┼───────────┐    ┌─────────┼─────────┐
   │          │          │     │           │           │    │         │         │
   ▼          ▼          ▼     ▼           ▼           ▼    ▼         ▼         ▼
 BOMA      PAYAM     HOSPITAL REMOTE    DEFAULTER   DATA  DHIS2   EPIDEMIC  FACILITY
 WORKER    PHCU      DOCTOR   REVIEW    TRACKER     QA    EXPORT  INTEL     ASSESS
```

---

## LAYER 1: POINT OF CARE — Where Healing Happens

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   BOMA HEALTH WORKER                   THE DIAGNOSTIC MACHINE               │
│   (Village — 40 households)            (AI Clinical Companion)              │
│                                                                             │
│   "Make it so simple a primary         "If a car has a flat tire, you       │
│    school child can do it"              can fix it roadside. But if the     │
│                                         engine has a problem, you need      │
│   ┌─────────────────────────┐           a diagnostic machine."              │
│   │ 1. WHERE  → Geocode ID │                                               │
│   │ 2. WHO    → Name/Photo │           ┌─────────────────────────┐         │
│   │ 3. WHAT   → Condition  │           │  Symptoms IN            │         │
│   │ 4. ACTION → Treat/Refer│     ──►   │  ─────────────────      │         │
│   │ 5. RESULT → Outcome    │           │  Diagnoses OUT          │         │
│   └─────────────────────────┘           │  + Treatment plan       │         │
│                                         │  + Severity (treat/refer)│        │
│   Binary choices. Icon-driven.          │  + Lab tests to order   │         │
│   Works offline. Voice capture.         │  + WHO references       │         │
│                                         └─────────────────────────┘         │
│                                                                             │
│   VOICE CAPTURE                        CLINICAL SCRIBE                      │
│   ─────────────                        ───────────────                      │
│   "The local person doesn't know       Speech → Structured Data             │
│    this is a recorder. It just         Extracts: vitals, complaints,        │
│    seems like the person has put       diagnoses, medications, labs,        │
│    out his phone."                     treatment plan — automatically       │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   PAYAM PHCU                           HOSPITAL (County/State/Teaching)     │
│   (Sub-county clinic)                  (Full clinical workflow)             │
│                                                                             │
│   ● Clinical officer consultations     ● Doctor command center              │
│   ● ICD-11 diagnosis coding            ● Ward monitoring (6 departments)    │
│   ● Basic lab + pharmacy               ● Full lab: order→accept→result      │
│   ● ANC (WHO 8-contact model)          ● Pharmacy: prescribe→dispense      │
│   ● Immunizations (8 antigens)         ● Inter-facility referrals          │
│   ● Referral management                ● Medical records with attachments   │
│                                        ● Nurse station dashboard            │
│                                        ● Front desk / registration          │
│                                                                             │
│   9 ROLE-BASED DASHBOARDS:                                                  │
│   Doctor | Clinical Officer | Nurse | Lab Tech | Pharmacist                 │
│   Front Desk | Boma Health Worker | Payam Supervisor | Government Admin     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## LAYER 2: SUPERVISION — The Feedback Loop

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   "Play on Payam level first. The Payam supervises Bomas.                   │
│    They need to know which Boma is working and which is not working."       │
│                                                                             │
│   ┌─────────────────────┐    ┌──────────────────────┐    ┌──────────────┐  │
│   │  PAYAM SUPERVISOR   │    │  IMMUNIZATION         │    │  DATA        │  │
│   │  DASHBOARD          │    │  DEFAULTER TRACKER    │    │  QUALITY     │  │
│   │                     │    │                       │    │  MONITOR     │  │
│   │  ● Which BHWs are   │    │  "Even if you don't   │    │              │  │
│   │    active vs idle   │    │   do these other      │    │  ● Complete- │  │
│   │  ● Visits per BHW   │    │   things, do THIS."   │    │    ness %   │  │
│   │  ● Referral rates   │    │                       │    │  ● Timeli-  │  │
│   │  ● Follow-up rates  │    │  ● Per-child tracking │    │    ness %   │  │
│   │  ● Drill into any   │    │  ● Days overdue       │    │  ● Quality  │  │
│   │    BHW's records    │    │  ● Urgency colors     │    │    score    │  │
│   │                     │    │  ● Outreach lists     │    │  ● DHIS2    │  │
│   │  REMOTE REVIEW:     │    │  ● Per-BHW breakdown  │    │    adoption │  │
│   │  ● Review BHW visits│    │                       │    │  ● HIS      │  │
│   │  ● Add clinical     │    │  REAL-TIME.           │    │    workforce│  │
│   │    notes            │    │  Not monthly.         │    │              │  │
│   │  ● Flag for         │    │  Not quarterly.       │    │              │  │
│   │    follow-up        │    │  NOW.                 │    │              │  │
│   │  ● Mentorship loop  │    │                       │    │              │  │
│   └─────────────────────┘    └──────────────────────┘    └──────────────┘  │
│                                                                             │
│   This creates something South Sudan has never had:                         │
│   A supervisor who can see what's happening in every village,               │
│   from their phone, in real time, even without internet.                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## LAYER 3: NATIONAL INTELLIGENCE — The Big Picture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   GOVERNMENT ADMIN DASHBOARD — Ministry of Health                           │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────┐       │
│   │                                                                 │       │
│   │              INTERACTIVE MAP OF ALL 10 STATES                   │       │
│   │                                                                 │       │
│   │     Upper Nile  ●────── Jonglei  ●────── Unity  ●              │       │
│   │         │                  │                │                    │       │
│   │    Northern     ●── Eastern     ●── Lakes  ●                    │       │
│   │    Bahr el Ghazal   Equatoria       │                           │       │
│   │         │                    ┌──────┘                            │       │
│   │    Western      ●── Central ●── Warrap  ●                      │       │
│   │    Bahr el Ghazal   Equatoria                                   │       │
│   │         │                    │                                   │       │
│   │    Western      ●──────────┘                                    │       │
│   │    Equatoria                                                    │       │
│   │                                                                 │       │
│   │    Toggle: Facility Readiness | Immunization | ANC | Disease    │       │
│   │                                                                 │       │
│   └─────────────────────────────────────────────────────────────────┘       │
│                                                                             │
│   ┌───────────────┐  ┌───────────────┐  ┌───────────────┐                  │
│   │ DHIS2 EXPORT  │  │  EPIDEMIC     │  │  VITAL        │                  │
│   │               │  │  INTELLIGENCE │  │  STATISTICS   │                  │
│   │ 50+ indicators│  │               │  │               │                  │
│   │ JSON + CSV    │  │ ● Epi curves  │  │ ● Birth rates │                  │
│   │               │  │ ● Rt estimate │  │ ● Death rates │                  │
│   │ Population    │  │ ● Syndromic   │  │ ● ICD-11 CoD  │                  │
│   │ CRVS          │  │   surveillance│  │ ● Maternal    │                  │
│   │ Immunization  │  │ ● IDSR weekly │  │   mortality   │                  │
│   │ ANC           │  │   reports     │  │ ● Neonatal    │                  │
│   │ Lab           │  │ ● EWARS alerts│  │   mortality   │                  │
│   │ Pharmacy      │  │ ● Geographic  │  │ ● Under-5     │                  │
│   │ Data quality  │  │   spread      │  │   mortality   │                  │
│   │               │  │ ● CFR tracking│  │               │                  │
│   └───────────────┘  └───────────────┘  └───────────────┘                  │
│                                                                             │
│   ┌───────────────┐  ┌───────────────┐  ┌───────────────┐                  │
│   │ FACILITY      │  │  MCH          │  │  DISEASE      │                  │
│   │ ASSESSMENTS   │  │  ANALYTICS    │  │  SURVEILLANCE │                  │
│   │               │  │               │  │               │                  │
│   │ WHO SARA-     │  │ ● ANC4+ rate  │  │ ● IDSR        │                  │
│   │ aligned       │  │ ● Immunization│  │   priority    │                  │
│   │ ● Readiness   │  │   coverage    │  │   diseases    │                  │
│   │ ● Equipment   │  │ ● Skilled     │  │ ● Alert levels│                  │
│   │ ● Staffing    │  │   birth attend│  │ ● Outbreak    │                  │
│   │ ● Medicines   │  │ ● Low birth   │  │   detection   │                  │
│   │ ● Infection   │  │   weight      │  │ ● Trend       │                  │
│   │   control     │  │ ● Stunting    │  │   analysis    │                  │
│   └───────────────┘  └───────────────┘  └───────────────┘                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## THE DATA FLOW — How It All Connects

```
    VILLAGE                    SUB-COUNTY                 NATIONAL
    (Boma)                     (Payam)                    (MoH)

    ┌──────────┐               ┌──────────┐              ┌──────────┐
    │          │               │          │              │          │
    │  BHW     │    Sync       │ Payam    │    Sync      │ National │
    │  records ├──────────────►│ reviews  ├─────────────►│ DHIS2    │
    │  visit   │               │ & QA     │              │ export   │
    │          │               │          │              │          │
    └──────────┘               └──────────┘              └──────────┘
         │                          │                         │
         │   Patient encounter      │   Quality assurance     │   Policy decisions
         │   Geocode ID             │   Defaulter tracking    │   Resource allocation
         │   Photo ID               │   Performance metrics   │   Outbreak response
         │   Symptom → AI Dx        │   Remote clinical       │   WHO reporting
         │   Treat or Refer         │   review                │   Immunization targets
         │   Follow-up scheduled    │   Mentorship            │   CRVS compliance
         │                          │                         │
         ▼                          ▼                         ▼
    ┌──────────────────────────────────────────────────────────────┐
    │                                                              │
    │                    PouchDB (Offline-First)                   │
    │                                                              │
    │   17 databases | Works with NO internet | $50 Android phone  │
    │                                                              │
    │   patients | visits | labs | pharmacy | immunizations | ANC   │
    │   births | deaths | referrals | surveillance | assessments   │
    │   messages | follow-ups | audit log | users | hospitals      │
    │                                                              │
    └──────────────────────────────────────────────────────────────┘
```

---

## THE 5-LEVEL HEALTH SYSTEM

```
    LEVEL 5 ─── NATIONAL ─── Ministry of Health + Teaching Hospitals
    │           ● Government Admin dashboard
    │           ● DHIS2 export (50+ indicators)
    │           ● Epidemic intelligence (Rt, EWARS, IDSR)
    │           ● National vital statistics
    │           ● All 10 states on interactive map
    │
    LEVEL 4 ─── STATE ─── General & Specialist Hospitals (10 states)
    │           ● Specialist care records
    │           ● ICD-11 coding (70+ codes curated for South Sudan)
    │           ● State-level aggregation
    │           ● Facility assessment scoring
    │
    LEVEL 3 ─── COUNTY ─── County Hospitals
    │           ● Full doctor workflow (consultation → diagnosis → treatment)
    │           ● Lab: order → accept → result → critical flagging
    │           ● Pharmacy: prescribe → dispense
    │           ● Surgery records
    │           ● Inter-facility referrals
    │
    LEVEL 2 ─── PAYAM ─── Primary Health Care Centers (PHCCs)
    │           ● Payam Supervisor dashboard (BHW oversight)
    │           ● Clinical officer consultations
    │           ● ANC (WHO 8-contact model)
    │           ● EPI immunizations (8 antigens)
    │           ● Real-time defaulter tracking
    │           ● Remote review of BHW visits
    │
    LEVEL 1 ─── BOMA ─── Primary Health Care Units (PHCUs)
                ● Boma Health Worker (1 per 40 households)
                ● Geocode patient ID (BOMA-XX-HH1001)
                ● Icon-driven, binary-choice interface
                ● Voice capture + AI symptom checker
                ● Treated/Referred toggle
                ● Follow-up queue
                ● Photo-based patient identification
```

---

## THE AI STACK — 4 Tools, All Offline

```
    ┌─────────────────────────────────────────────────────────────────┐
    │                                                                 │
    │  1. SYMPTOM CHECKER                    "The Diagnostic Machine" │
    │     ─────────────────                                           │
    │     8 symptom categories → WHO/IMCI rule engine                 │
    │     → Ranked differential diagnoses (ICD-10)                    │
    │     → Confidence scores (0-100%)                                │
    │     → Severity: treat locally vs. REFER NOW                     │
    │     → Treatment per South Sudan guidelines                      │
    │     → Lab tests to confirm                                      │
    │     → WHO/Lancet learning references                            │
    │                                                                 │
    │  2. CLINICAL SCRIBE                    Voice → Structured Data  │
    │     ────────────────                                            │
    │     Real-time speech recognition (Web Speech API)               │
    │     → Auto-extracts: vitals, complaints, exam, Dx, Rx, labs    │
    │     → SOAP note generation                                      │
    │     → Conflict detection (same field mentioned twice)           │
    │     → One-click apply to consultation form                      │
    │                                                                 │
    │  3. AI CLINICAL EVALUATION             Full Patient Analysis    │
    │     ──────────────────────                                      │
    │     Takes: vitals + exam + complaint + demographics             │
    │     → Severity assessment (LOW / MODERATE / HIGH)               │
    │     → Vital sign anomaly alerts                                 │
    │     → Suggested diagnoses ranked by confidence                  │
    │     → Recommended confirmatory tests                            │
    │     → Clinical reasoning summary                                │
    │                                                                 │
    │  4. ASSISTANT CHAT                     On-Demand Reference      │
    │     ──────────────                                              │
    │     Floating chat bubble — ask anything                         │
    │     → Treatment protocols (malaria, pneumonia, DKA, etc.)       │
    │     → Drug dosing + contraindications                           │
    │     → Emergency management                                      │
    │     → WHO/IMCI clinical decision trees                          │
    │                                                                 │
    │  ALL 4 RUN 100% CLIENT-SIDE. NO INTERNET NEEDED.               │
    │                                                                 │
    └─────────────────────────────────────────────────────────────────┘
```

---

## PUBLIC HEALTH MODULES — Complete Coverage

```
    ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
    │  ANTENATAL CARE  │   │  IMMUNIZATIONS   │   │  BIRTH           │
    │  (ANC)           │   │  (EPI)           │   │  REGISTRATION    │
    │                  │   │                  │   │  (CRVS)          │
    │ WHO 8-contact    │   │ 8 antigens:      │   │                  │
    │ model            │   │ BCG, OPV, Penta, │   │ Certificate #    │
    │                  │   │ PCV, Rota,       │   │ Birth weight     │
    │ Risk factors:    │   │ Measles, Yellow  │   │ Delivery type    │
    │ ● Age <18 / >35 │   │ Fever, Vitamin A │   │ Attendant        │
    │ ● Previous C/S   │   │                  │   │ Mother + child   │
    │ ● Pre-eclampsia  │   │ DEFAULTER        │   │ linked to        │
    │ ● Twins          │   │ TRACKER:         │   │ patient records  │
    │ ● HIV+           │   │ Real-time,       │   │                  │
    │ ● Anemia         │   │ per-child,       │   │ Stats: by gender,│
    │ + 7 more         │   │ urgency-coded    │   │ delivery type,   │
    │                  │   │                  │   │ facility, state  │
    │ IPTp + Iron +    │   │ Coverage by      │   │                  │
    │ Tetanus tracking │   │ antigen          │   │                  │
    │ Birth plan       │   │                  │   │                  │
    └──────────────────┘   └──────────────────┘   └──────────────────┘

    ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
    │  DEATH           │   │  DISEASE         │   │  EPIDEMIC        │
    │  REGISTRATION    │   │  SURVEILLANCE    │   │  INTELLIGENCE    │
    │  (CRVS + ICD-11) │   │                  │   │                  │
    │                  │   │ IDSR priority    │   │ Epidemic curves  │
    │ WHO 4-line       │   │ diseases         │   │ (12-week series) │
    │ certificate      │   │                  │   │                  │
    │ format           │   │ Alert levels:    │   │ Rt estimation    │
    │                  │   │ Emergency /      │   │ (reproduction    │
    │ ICD-11 coding:   │   │ Warning /        │   │  number)         │
    │ ● Immediate      │   │ Watch /          │   │                  │
    │ ● Antecedent     │   │ Normal           │   │ Syndromic        │
    │ ● Underlying     │   │                  │   │ surveillance     │
    │ ● Contributing   │   │ Case + death     │   │                  │
    │                  │   │ counts           │   │ EWARS alerts     │
    │ Maternal death   │   │                  │   │                  │
    │ flagging         │   │ Trend:           │   │ IDSR weekly      │
    │                  │   │ Increasing /     │   │ report generator │
    │ Manner of death  │   │ Stable /         │   │                  │
    │ classification   │   │ Decreasing       │   │ Geographic       │
    │                  │   │                  │   │ spread analysis  │
    └──────────────────┘   └──────────────────┘   └──────────────────┘
```

---

## PATIENT IDENTIFICATION — Without National IDs

```
    ┌─────────────────────────────────────────────────────────────────┐
    │                                                                 │
    │   "This one is Deng. This is Deng. This is Deng."               │
    │   — Expert on the name collision problem                        │
    │                                                                 │
    │   SOLUTION: GEOCODE-BASED IDENTIFICATION                        │
    │                                                                 │
    │   Format:  BOMA-{bomaCode}-HH{householdNumber}                  │
    │   Example: BOMA-KJ-HH1001                                       │
    │                                                                 │
    │   ┌─────────────────────────────────────────────────┐           │
    │   │  geocodeId:       "BOMA-KJ-HH1001"  ← PRIMARY  │            │
    │   │  householdNumber: 1001                          │           │
    │   │  bomaCode:        "KJ" (Kajo-keji)             │            │
    │   │  boma:            "Kajo-keji"                   │           │
    │   │  payam:           "..."                         │           │
    │   │  county:          "..."                         │           │
    │   │  state:           "Central Equatoria"           │           │
    │   │  nationalId:      null (most won't have one)    │           │
    │   └─────────────────────────────────────────────────┘           │
    │                                                                 │
    │   WHY THIS WORKS:                                               │
    │   ● Like a postcode — locates patients geographically           │
    │   ● No documents required (most people have none)               │
    │   ● Family grouping (same household prefix)                     │
    │   ● GPS-trackable for follow-ups                                │
    │   ● Photo capture for visual confirmation                       │
    │   ● Works in IDP camps (reassign geocode)                       │
    │                                                                 │
    └─────────────────────────────────────────────────────────────────┘
```

---

## SECURITY & AUDIT

```
    ┌─────────────────────────────────────────────────────────────────┐
    │                                                                 │
    │  AUTHENTICATION              AUDIT TRAIL                        │
    │  ──────────────              ───────────                        │
    │  ● bcrypt (12 rounds)        Every action logged:               │
    │  ● JWT tokens (24hr)         ● LOGIN / LOGOUT                   │
    │  ● HTTP-only cookies         ● CREATE_PATIENT                   │
    │  ● Rate limiting             ● UPDATE_PATIENT                   │
    │    (5 attempts → 15min       ● CREATE_MEDICAL_RECORD            │
    │     lockout)                 ● UPDATE_MEDICAL_RECORD            │
    │  ● Constant-time comparison  ● REGISTER_BIRTH                   │
    │    (prevents timing attacks) ● REGISTER_DEATH                   │
    │  ● Generic error messages    ● DISPENSE_PRESCRIPTION            │
    │    (prevents enumeration)    ● ORDER_LAB_TEST                   │
    │                              ● CREATE_REFERRAL                  │
    │  AUTHORIZATION               ● SUBMIT_BOMA_VISIT                │
    │  ─────────────               ● + more...                        │
    │  ● 9 roles                                                      │
    │  ● Middleware enforcement     HEADERS                           │
    │  ● Client-side RoleGuard     ───────                            │
    │  ● Route whitelist per role  ● CSP, HSTS, X-Frame-Options       │
    │  ● Default dashboard         ● SameSite cookies (CSRF)          │
    │    redirect per role         ● X-Content-Type-Options           │
    │                                                                 │
    └─────────────────────────────────────────────────────────────────┘
```

---

## TECHNICAL ARCHITECTURE

```
    ┌─────────────────────────────────────────────────────────────────┐
    │                                                                 │
    │  STACK                         DATABASES (17 PouchDB stores)    │
    │  ─────                         ─────────────────────────────    │
    │  Next.js 14 (App Router)       tamamhealth_patients                   │
    │  React 18                      tamamhealth_medical_records            │
    │  TypeScript                    tamamhealth_hospitals                  │
    │  Tailwind CSS                  tamamhealth_referrals                  │
    │  PouchDB (IndexedDB)           tamamhealth_lab_results                │
    │  jose (JWT)                    tamamhealth_prescriptions              │
    │  bcryptjs                      tamamhealth_immunizations              │
    │                                tamamhealth_anc                        │
    │  TESTING                       tamamhealth_births                     │
    │  ───────                       tamamhealth_deaths                     │
    │  Jest + jsdom                  tamamhealth_boma_visits                │
    │  189 tests passing             tamamhealth_follow_ups                 │
    │  12 test suites                tamamhealth_disease_alerts             │
    │  In-memory PouchDB             tamamhealth_facility_assessments       │
    │  for isolated testing          tamamhealth_messages                   │
    │                                tamamhealth_audit_log                  │
    │                                tamamhealth_users                      │
    │                                                                 │
    │                                SERVICES: 22 data access layers  │
    │                                HOOKS: 22 React state hooks      │
    │                                COMPONENTS: 14 shared UI         │
    │                                                                 │
    └─────────────────────────────────────────────────────────────────┘
```

---

## WHO/INTERNATIONAL COMPLIANCE

```
    ┌──────────────────────────────────────────────────────────────────┐
    │                                                                  │
    │  "To ease yourself, you don't need to bother your head.          │
    │   You just make it compatible with DHIS2."                       │
    │                                                                  │
    │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
    │  │ DHIS2       │  │ ICD-11      │  │ WHO         │              │
    │  │             │  │             │  │ Standards   │              │
    │  │ 50+ health  │  │ 70+ codes   │  │             │              │
    │  │ indicators  │  │ curated for │  │ ● IMCI      │              │
    │  │ exported    │  │ South Sudan │  │   (child    │              │
    │  │             │  │             │  │   illness)  │              │
    │  │ JSON + CSV  │  │ 5-level     │  │ ● SARA      │              │
    │  │ format      │  │ diagnosis   │  │   (facility │              │
    │  │             │  │ capability  │  │   readiness)│              │
    │  │ Categories: │  │ mapping     │  │ ● ANC 8-    │              │
    │  │ ● Population│  │             │  │   contact   │              │
    │  │ ● CRVS      │  │ Notifiable  │  │   model     │              │
    │  │ ● MCH       │  │ diseases    │  │ ● CRVS      │              │
    │  │ ● EPI       │  │ auto-flagged│  │   (vital    │              │
    │  │ ● Lab       │  │             │  │   events)   │              │
    │  │ ● Pharmacy  │  │ Searchable  │  │ ● IDSR      │              │
    │  │ ● Surv.     │  │ by code,    │  │   (disease  │              │
    │  │ ● Quality   │  │ title, or   │  │   reporting)│              │
    │  │             │  │ keyword     │  │ ● EPI       │              │
    │  └─────────────┘  └─────────────┘  │   schedule  │              │
    │                                    └─────────────┘              │
    │                                                                  │
    ╚══════════════════════════════════════════════════════════════════╝
```

---

## THE LOGICAL FRAMEWORK

```
    ┌──────────────────────────────────────────────────────────────────┐
    │                                                                  │
    │  INPUT                    OUTPUT                   OUTCOME       │
    │  ─────                    ──────                   ───────       │
    │                                                                  │
    │  ● Symptoms               ● Diagnoses              ● Better     │
    │  ● Patient encounters     ● Treatment plans           quality   │
    │  ● Vaccine records        ● Defaulter lists           of care   │
    │  ● Vital events           ● Supervisor dashboards  ● Fewer      │
    │  ● Lab samples            ● DHIS2 reports             missed    │
    │  ● Prescriptions          ● Epidemic alerts           diagnoses │
    │  ● Facility data          ● Referral tracking      ● Higher     │
    │                           ● Quality scores            immuniz-  │
    │                           ● Vital statistics          ation     │
    │                           ● Learning references       coverage  │
    │                                                    ● Real-time  │
    │                                                       national  │
    │                                                       health    │
    │                                                       picture   │
    │                                                                  │
    │  "What you're looking at is your quality."                       │
    │                                                                  │
    └──────────────────────────────────────────────────────────────────┘
```

---

## ROADMAP — Where We're Going

```
    BUILT & WORKING                  NEAR TERM                    FUTURE
    ════════════════                 ═════════                     ══════

    ✓ 9 role-based dashboards        ○ Multi-language UI           ○ HL7/FHIR
    ✓ 31 functional modules            (Juba Arabic, Dinka, Nuer)  ○ Insurance/billing
    ✓ 4 AI clinical tools            ○ SMS immunization reminders  ○ Census integration
    ✓ Offline-first (PouchDB)        ○ Photo-based patient ID      ○ Veterinary module
    ✓ 17 databases                   ○ Tablet layout (PHCC)          (community gateway)
    ✓ DHIS2 export (50+ indicators)  ○ CouchDB remote sync         ○ Multi-facility
    ✓ ICD-11 (70+ codes)             ○ WhatsApp reminders            replication network
    ✓ WHO/IMCI compliance            ○ Field testing: 1 Payam
    ✓ Geocode patient ID               in Central Equatoria
    ✓ Voice capture
    ✓ 189 automated tests
    ✓ Full audit trail
    ✓ Epidemic intelligence
    ✓ Facility assessments
    ✓ CRVS (births + deaths)
    ✓ ANC (WHO 8-contact)
    ✓ EPI defaulter tracker
    ✓ Offline web app on phones and tablets
```

---

## THE PITCH — In One Sentence

> **TamamHealth is an offline-first EMR that puts AI-assisted diagnosis, real-time immunization tracking, and DHIS2-compatible reporting into the hands of every health worker in South Sudan — from a village volunteer with a $50 phone to the Ministry of Health — and it works without internet.**

---

*"You are contributing to the whole menu of the health management information system. What you're looking at is your quality."*

*Built for South Sudan. Built to work offline. Built to save lives.*
