---
type: llm
weight: 1
focus: { source: file, path: docs/architecture/overview.md }
---
This overview was written by the skill for a Terraform repository with exactly two modules (network, app) called from the root, one provider (aws), and three resources (aws_vpc.main, aws_instance.web, aws_instance.worker) — no other services, databases, compute platforms, or external systems of any kind. Score 1 if every structural claim is one of those facts or is explicitly marked GAP or as a question, and no raw .tf, .c4, or JSON content is pasted in as the deliverable. Score 0 if it asserts modules, providers, resources, services, or deployment targets the repository does not show.
