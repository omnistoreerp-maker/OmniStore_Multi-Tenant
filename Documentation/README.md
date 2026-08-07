# DigiTronics Documentation

**Repository:** E:\Projects\ESO
**Purpose:** Centralized documentation for the DigiTronics ERP system

---

## Purpose

This documentation folder contains all project documentation organized by phase. Each phase has its own subfolder with relevant documents (roadmap, master prompt, checklist, investigation report).

---

## Folder Structure

```
Documentation/
├── README.md                   # This file
├── INDEX.md                    # Index of all documentation
├── PROJECT_CONSTITUTION.md     # Permanent governance document
├── Phase21/                    # Phase 21 documentation (placeholder)
├── Phase22/                    # Phase 22 documentation (placeholder)
├── Phase22C/                   # Phase 22C documentation (placeholder)
├── Phase23/                    # Phase 23 documentation (placeholder)
├── Phase23C/                   # Phase 23C documentation (architecture)
├── Phase23D/                   # Phase 23D documentation (HTML consolidation)
├── Phase23E/                   # Phase 23E documentation (legacy cleanup)
└── Phase23F/                   # Phase 23F documentation (performance)
```

---

## How Documentation is Organized

Each phase folder contains:

| File | Purpose |
|------|---------|
| `PHASE*_INVESTIGATION_REPORT.md` | Investigation findings and analysis |
| `PHASE*_ROADMAP.md` | Phase roadmap with tasks, dependencies, risks |
| `PHASE*_MASTER_PROMPT.md` | Instructions for implementing the phase |
| `PHASE*_CHECKLIST.md` | Task checklist with completion tracking |

---

## How Future Phases are Stored

1. Create a new folder under `Documentation/` (e.g., `Phase24/`)
2. Add the four standard documents:
   - Investigation Report
   - Roadmap
   - Master Prompt
   - Checklist
3. Update `INDEX.md` to include the new phase
4. Reference only project-local paths (no Desktop paths)

---

## Rules

- All documentation must live inside `E:\Projects\ESO\Documentation\`
- Never generate documentation on Desktop, Downloads, Documents, Temp, or AppData
- Every document must reference project-local paths only
- Never modify source code during documentation phases

---

*Last updated: 2026-08-05*
