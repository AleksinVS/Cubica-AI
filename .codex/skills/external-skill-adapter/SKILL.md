---
name: external-skill-adapter
description: Adapt or update a third-party Agent Skill for this repository without importing conflicting workflow rules. Use when evaluating, importing, refreshing, or recording lessons about skills from agent-skills, superpowers, or another external skill repository.
---

# External Skill Adapter

Adapt one narrow external capability at a time. Preserve useful domain guidance, but materialize a project-owned `SKILL.md` that obeys the nearest `AGENTS.md` and current architecture decisions.

## Workflow

1. Read `docs/agents/external-skills/compatibility-policy.json`, `adaptation-memory.json`, and `registry.json`.
2. Prepare a bounded evidence packet:

   ```bash
   node .codex/skills/external-skill-adapter/scripts/prepare-adaptation.mjs \
     --skill <upstream-SKILL.md> --tags <comma-separated-tags> --output .tmp/<name>-adaptation.json
   ```

3. Treat packet signals as search hints, never as compatibility decisions. Read the complete candidate skill. If meaning remains unclear, read only the relevant project sections or code and record why that context was needed.
4. Classify the candidate: adapt a narrow capability, block a meta-skill that installs its own process, or defer a capability whose value or compatibility cannot yet be demonstrated.
5. Write a clean project-owned skill. Do not keep a conflicting upstream instruction beside a corrective wrapper. Keep the exact upstream snapshot outside `.codex/skills/` and register its origin and hashes.
6. Validate structure, policy, unique capabilities, source drift, and behavior. A passing script proves structural consistency only; the adapting agent remains responsible for semantic review.
7. Add a reviewed, reusable lesson with `record-experience.mjs` when a new failure pattern or practice would improve later adaptations. Do not record one-off observations.

## Update Cadence

Use `check-updates.mjs` for planned upstream checks. It skips sources checked within the last 30 days unless the user explicitly requests a refresh or a security issue requires it. The command reports changes but never installs or applies them.

When upstream changed, compare the changed candidate with its stored snapshot, rebuild the evidence packet, review the affected semantics, update the materialized skill, then refresh hashes. Never overwrite an active skill directly from upstream.

## Required Checks

```bash
node .codex/skills/external-skill-adapter/scripts/validate-external-skills.mjs
node --test .codex/skills/external-skill-adapter/scripts/external-skill-adapter.test.mjs
python3 /home/abc/ai-agents/.codex/skills/.system/skill-creator/scripts/quick_validate.py <skill-directory>
```

Use `--refresh-source-hashes` only after reviewing changed project policy sections. Use `--refresh-artifact-hashes` only after reviewing the upstream snapshot and active materialized skill.
