# PropBrain: Why This Fork Exists

PropBrain is PROPAGANDAnow's operating profile and documentation fork of GBrain.

The codebase, CLI commands, and package name remain `gbrain` on purpose. We did **not** want to spend engineering energy on a cosmetic rename that would create avoidable migration churn across install docs, scripts, habits, and agent prompts. Instead, this fork changes the **framing, default operating assumptions, and contribution target** while preserving upstream compatibility where it is useful.

## One-line definition

**PropBrain is a team- and client-oriented operational memory system for agent deployments.**

Where upstream GBrain is presented primarily through the lens of a powerful personal brain, PropBrain is optimized for deployments where an agent is working on behalf of an operator, a team, or an agency with shared context, recurring workflows, and access boundaries.

## Why the fork exists

The fork exists because the underlying GBrain patterns are strong, but PROPAGANDAnow needs a different default worldview:

- not a single-person life OS
- not a founder-personality product story
- not a brain whose primary subject is one individual's private world
- not access rules that assume only "me vs everyone else"

Instead, PROPAGANDAnow needs a brain that can support:

- shared agency memory
- client and account history
- campaign and launch workstreams
- structured operating docs and internal process memory
- multiple operators and collaborators
- scoped access by deployment, team, client, or workflow
- contributor guidance that keeps PRs aligned with the above

In short: **the motivation was not to replace GBrain's core mechanics, but to retarget them toward operational, multi-actor deployments.**

## What we kept from GBrain

This fork still agrees with the core thesis:

1. **Agents should maintain memory, not humans.**
2. **Markdown remains the human-legible layer.**
3. **Compiled truth + timeline is the right page model.**
4. **Entity-centric enrichment should happen continuously.**
5. **Brain-first lookup should happen before answering.**
6. **Deterministic tooling should handle repeatable brain operations.**

Those ideas are the durable value in the project. PropBrain keeps them.

## What changed in this fork

The initial PropBrain framing was introduced across these commits:

- [`b26237b`](https://github.com/PROPAGANDAnow/gbrain/commit/b26237b6cf960f7116e9156959154d4f85e51cbf) — depersonalize the repo framing for team deployments
- [`0f09e97`](https://github.com/PROPAGANDAnow/gbrain/commit/0f09e97925756a9bfabeb0111f1fd1338a6c33e8) — generalize identity and access control for operators and teams
- [`d76ced7`](https://github.com/PROPAGANDAnow/gbrain/commit/d76ced7ba38b13e35a1551ed76be4f0fe316c081) — propose a PROPAGANDAnow-oriented brain structure

### 1. Personal brain -> deployment brain

The fork shifts the narrative from "your personal brain" to **a deployment's brain**.

That means docs, templates, and examples should work for:

- one operator
- a small internal team
- an agency account team
- a client-serving workflow
- a long-running autonomous agent deployment

This repo should default to those cases without requiring every adopter to mentally translate from a personal-diary frame.

### 2. Owner-only access -> tiered operational access

The fork replaces simplistic personal access assumptions with deployment-oriented access boundaries.

Important examples:

- **Full** access for deployment owners / primary operators
- **Internal** access for trusted internal collaborators
- **Scoped** access for client- or workflow-specific collaborators
- **None** for everyone else

The objective is not to turn GBrain into a heavy enterprise ACL system. The objective is to ensure the docs, templates, and expected workflows acknowledge the real shape of team deployments.

### 3. Generic knowledge base -> agency-operational memory

PropBrain puts more emphasis on operating memory that matters in practice for PROPAGANDAnow-style work:

- client pages
- campaign workstreams
- operations docs
- internal process memory
- cross-functional account history

This is why the schema work adds directories like `clients/`, `campaigns/`, and `operations/`. These are not random taxonomy tweaks. They reflect the reality that an operational brain for client work needs first-class homes for those subjects.

### 4. Mixed agent/world concerns -> hard repo boundary

A key design objective is to keep **agent behavior** separate from **world knowledge**.

- agent repo = skills, config, prompts, cron, identity, state
- brain repo = people, companies, clients, meetings, projects, ideas, decisions

This boundary matters because operational memory should outlive any specific agent runtime. If the deployment swaps Hermes, OpenClaw, Claude Code workflows, or some future harness, the actual knowledge base should survive intact.

### 5. Personality-heavy origin story -> reusable operating system

The repo should not require contributors to buy into a founder-specific story in order to understand the product.

The better frame is:

> a disciplined operating system for agent-maintained memory

That framing is more reusable, more portable across organizations, and more useful for contributors deciding whether a change strengthens or dilutes the project.

## What PropBrain is for

PropBrain is for teams that want agents to maintain a durable, searchable, citation-aware memory layer around ongoing work.

Typical use cases include:

- agency account memory
- client relationship history
- meeting ingestion and action continuity
- people/company dossier maintenance
- operational briefings and daily prep
- campaign memory and launch retrospectives
- research capture that compounds over time
- autonomous maintenance loops that keep the brain current

## What PropBrain is not for

PRs should be skeptical of changes that push the repo toward any of the following:

- a generic chatbot prompt library with no durable knowledge layer
- a purely personal journaling or diary product
- a monolithic system that mixes agent config with world knowledge
- a system that depends on humans manually maintaining cross-links and state
- a branding-only fork with no architectural point of view
- a heavyweight enterprise rewrite that abandons the lightweight markdown + deterministic-tools model

## Contribution guardrails

If you are opening a PR, ask these questions first:

1. **Does this strengthen PropBrain as an operational memory system?**
2. **Does it preserve the distinction between agent behavior and world knowledge?**
3. **Does it help a team, operator, or client-serving deployment more than it helps a purely personal use case?**
4. **Does it preserve compiled truth + timeline, entity-centric enrichment, and brain-first lookup?**
5. **Does it keep the system understandable to both humans and agents?**
6. **Does it avoid unnecessary rename churn when `gbrain` naming is still serving compatibility?**

A strong PR usually improves one of these areas:

- retrieval quality
- indexing and sync reliability
- agent-facing documentation
- operational schemas for real deployments
- contributor clarity
- integration recipes that feed durable memory
- guardrails that reduce drift, duplication, or hallucinated state

A weak PR usually does one of these:

- adds complexity without improving operating memory
- introduces personal-world assumptions as the default
- blurs the repo boundary between behavior and knowledge
- optimizes branding while ignoring migration cost
- adds features that do not reinforce the brain model

## Naming policy

The repo is presented publicly as **PropBrain**, but the implementation continues to use `gbrain` in code, commands, package references, and upgrade paths unless there is a compelling migration plan.

That is deliberate.

The goal of this fork is **alignment**, not vanity refactoring.

## Relationship to upstream GBrain

We still view upstream GBrain as the source of many of the core patterns that make this project good.

This fork is best understood as:

- **upstream GBrain** for the underlying system and mechanics
- **PropBrain** for the deployment philosophy, operational framing, and contribution target

When evaluating future changes, preserve compatibility where possible, but prefer the PropBrain worldview whenever the docs, schema, or workflow defaults need to choose.

## Maintainer intent

This repo should help humans and agents answer the following clearly:

- What is this repo for?
- What kind of deployment is it trying to serve?
- What architectural invariants should PRs preserve?
- Which changes are in-bounds versus out-of-bounds?

If a future contributor reads this doc before opening a PR, they should understand that PropBrain is not just "GBrain with a different name." It is a fork with a specific operating objective: **make agent-maintained memory work for teams, clients, and real operational environments without losing the elegance of the original brain model.**
