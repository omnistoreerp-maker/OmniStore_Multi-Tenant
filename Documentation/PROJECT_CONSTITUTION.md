# Project Constitution

**Repository:** E:\Projects\ESO
**Created:** 2026-08-05
**Status:** Permanent Governance Document

---

## Documentation Policy

All documentation MUST remain inside `E:\Projects\ESO\Documentation`. Never create documentation on Desktop, Downloads, Documents, Temp, AppData, or any external folder.

Documentation structure:
```
Documentation/
├── README.md
├── INDEX.md
├── PROJECT_CONSTITUTION.md
├── Phase21/
├── Phase22/
├── Phase22C/
├── Phase23/
├── Phase23C/
├── Phase23D/
├── Phase23E/
└── Phase23F/
```

Future phases must follow the same layout.

---

## Phase Workflow

Every future phase must follow this workflow:

1. **Investigation** — Generate Investigation Report
2. **Roadmap** — Generate Roadmap (tasks justified by Investigation)
3. **Master Prompt** — Generate Master Prompt (instructions for implementation)
4. **Checklist** — Generate Checklist (task tracking)

**NEVER implement a phase before all four documents are approved.**

---

## Review Workflow

Before implementation:
1. Verify all documentation is internally consistent
2. Verify all tasks are justified by the Investigation Report
3. Verify no invented work exists
4. Output APPROVED only when fully consistent

---

## Git Workflow

- Current Stable Tag: phase23b-stable
- Current HEAD: e66b6fd32922162f0932d96fee7a71f264d7d4ef
- Never commit during documentation phases
- Never push during documentation phases
- Never tag during documentation phases

---

## Safety Rules

- Do NOT modify source code during documentation phases
- Do NOT create commits during documentation phases
- Do NOT create tags during documentation phases
- Do NOT push during documentation phases
- Desktop paths are forbidden
- Every document must reference only `E:\Projects\ESO`

---

## Architecture Rules

Architecture phases must NOT contain:
- Implementation
- Cleanup
- HTML merge
- Optimization

Architecture phases MAY contain:
- Architecture assessment
- Runtime architecture
- Adapter architecture
- Layer separation
- Dependency graph
- Configuration architecture
- Security architecture planning
- Technical debt analysis
- Design decisions
- Migration planning
- Documentation

---

## Performance Rules

Measure → Benchmark → Identify bottleneck → Optimize

Never optimize first. Always measure before making changes.

---

## Legacy Cleanup Policy

Deprecate → Archive → Delete

Never delete directly. Always deprecate first, then archive, then delete.

---

## Implementation Rules

Every implementation task must be justified by the Investigation Report. If the Investigation does not prove a task is needed, remove it. Never invent work.

---

*Constitution created: 2026-08-05*
*Tag: phase23b-stable*
*Commit: e66b6fd*
