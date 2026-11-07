# Vision Document: PHACT — Public Health AI Curriculum Transformation Platform

## Executive Summary

PHACT is an AI-powered curriculum transformation platform that helps faculty across the national network of accredited schools and programs of public health integrate AI into their teaching responsibly and consistently. It addresses the gap between the rising institutional pressure to adopt AI and the reality that most faculty lack the technical confidence, instructional resources, and institutional support to act — a gap that today drives duplicated effort, inconsistent quality, and uneven access across 150+ schools. The expected outcome is a working end-to-end loop in which a faculty member uploads a syllabus and receives AI integration recommendations and competency insights that cite ASPPH sources, pass through safety guardrails, and can be reviewed, approved, and exported or shared — proving that a single grounded, human-in-the-loop workflow can raise the quality and consistency of AI integration while reducing the burden on individual faculty.

---

## Business Context

### Problem Statement

Faculty across 150+ accredited schools of public health face increasing pressure to integrate AI into their curricula, but most lack the technical confidence, instructional resources, and institutional support to do so. Schools are attempting to solve this independently, which leads to duplication of effort, inconsistent quality, and uneven access to resources. Meanwhile AI technologies advance faster than traditional curriculum development cycles can absorb, so individual, school-by-school effort cannot keep pace. The problem lives inside the curriculum design experience itself, where a faculty member needs grounded, trustworthy, accreditation-aligned guidance at the moment they are revising a course.

### Business Drivers

- A large, fragmented network. 150+ accredited schools and programs of public health are each solving AI integration on their own, with no shared, authoritative baseline — the duplicated effort and inconsistent quality are a direct cost of that fragmentation.
- AI outpacing curriculum cycles. AI capability advances faster than traditional multi-year curriculum development, so static, manually authored guidance is stale on arrival; faculty need help that is grounded in current, curated sources.
- A confidence and resources gap. Most faculty lack the technical confidence and instructional resources to integrate AI responsibly, and institutional support is uneven, leaving willing educators without a credible starting point.
- Accreditation alignment as a shared need. Every school answers to the same accreditation and competency frameworks (CEPH), so a shared capability that maps curriculum to those frameworks serves the whole network rather than one institution.

### Target Users and Stakeholders

| User Type | Description | Primary Need |
|-----------|-------------|--------------|
| Faculty | Educators at member schools revising courses and assignments | Grounded, accreditation-aligned AI integration recommendations they can trust and act on, without deep technical expertise |
| ASPPH administrators | Stewards of the shared knowledge base and community repository | Control over the approved source inventory and moderation of shared content, with auditability |
| Member schools and programs | The 150+ institutions in the network | A consistent, shared baseline for AI integration that avoids per-school duplication |
| Workforce and accreditation stakeholders | Employers and accreditors (CEPH) whose expectations shape competencies | Curriculum that demonstrably maps to current competencies and workforce expectations |

### Business Constraints

- Student and faculty privacy are non-negotiable. PII must be removed before text reaches the model, and content filtering must run on inputs, with model invocation logs encrypted and access-restricted so no raw PII is retained.
- All AI-generated content must be reviewed and approved by a human before it is exported or shared.
- Only public or synthetic content may be used in the hackathon build — no proprietary member data and no ARIE production data — loaded into the AWS-provided Workshop Studio account.
- The build must be defined as infrastructure-as-code so it can be redeployed into ASPPH's own AWS account after the event.
- The hackathon build is standalone: demo users are provisioned directly in Cognito, with no MyASPPH single sign-on.

### Success Metrics

| Metric | Current State | Target State | Measurement Method |
|--------|--------------|--------------|-------------------|
| End-to-end demo loop completes | 0 (not yet built) | A faculty member completes sign-in → upload → grounded recommendations → guardrails → competency mapping → review → approve → export/share | Live demo walkthrough |
| Recommendations grounded in ASPPH sources | No grounded recommendations in place | Every recommendation cites at least one ASPPH source with a visible title and snippet | Citation inspection against the knowledge base |
| Analysis latency | No baseline | Results return in under ~60 seconds without API Gateway timeouts | Async job timing |
| PII protection | No protection in place | PII in an uploaded syllabus is redacted before reaching the model and absent from logs | Redaction check + log inspection |
| Human-approved outputs only | No review gate | 100% of exported/shared outputs are human-approved | Status audit (Draft → Approved) |

---

## MVP Scope

### MVP Objective

Prove that a faculty member can upload a syllabus and receive AI integration recommendations and competency insights that are grounded in cited ASPPH sources and filtered through safety guardrails, then review, approve, and export or share the result — demonstrating a single trustworthy, human-in-the-loop curriculum transformation loop end to end.

### MVP Success Criteria

- [ ] A faculty member can sign in, upload (or paste) a syllabus, and run an analysis that returns in under ~60 seconds without being cut off by API Gateway's timeout.
- [ ] Recommendations name specific modules, assignments, or objectives and each cites at least one ASPPH source, with grounded evidence visibly distinguished from AI-generated synthesis.
- [ ] Competency intelligence returns an objective → matched competency → gap table that cites the CEPH framework and reflects sample workforce expectations.
- [ ] An uploaded syllabus containing a student name or email shows that PII redacted in the output, and an off-topic prompt is blocked with a friendly message.
- [ ] Output can be edited, moved from Draft to Approved or Rejected (stamped with user and timestamp), and only approved items can be exported (DOCX/PDF) or shared, retaining source attribution.

### Features In Scope (MVP)

| Feature | Description | Priority | Rationale for Inclusion |
|---------|-------------|----------|------------------------|
| Access, identity & roles | Cognito sign-in with faculty and ASPPH-admin groups; admin screens/APIs 403 to non-admins | MUST | Every downstream feature depends on an authenticated user and role-appropriate access |
| ASPPH knowledge & grounding | Bedrock Knowledge Base over an S3 Vectors store, loaded with ≥3 synthetic source types, returning cited chunks | MUST | Grounding in cited ASPPH sources is what makes recommendations trustworthy |
| Curriculum Transformation Assistant | Async analysis of a syllabus producing cited, specific AI integration recommendations | MUST | This is the core value proposition of the platform |
| Competency Intelligence | Objective → competency → gap mapping citing CEPH, with workforce expectations | MUST | Reusable capability that ties curriculum to accreditation and workforce needs |
| Responsible AI & governance | Bedrock Guardrail (content filters, denied topics) + Comprehend PII pre-scrub | MUST | Safety and privacy are non-negotiable constraints |
| Human review & export | Edit, approve/reject with audit stamp; export approved items to DOCX/PDF | MUST | No AI output reaches others without human approval |
| Syllabus upload | Presigned per-user S3 upload of PDF plus text extraction, kept private to the user | SHOULD | Convenient entry point; private uploads stay separate from the shared KB |
| Faculty resources & community | Surface related approved resources; share approved outputs to a shared repository (opt-in) | SHOULD/COULD | Extends single-faculty value into network-wide sharing |
| Platform operations & security | CloudWatch logs, CloudTrail, encrypted model-invocation logging, IaC redeploy | MUST | Required for a credible, redeployable, auditable build |

### Features Explicitly Out of Scope (MVP)

| Feature | Reason for Deferral | Target Phase |
|---------|-------------------|--------------|
| Generate adapted draft course materials from an approved recommendation (US-14) | The core loop (analyze → recommend → review → export) proves the hypothesis first; material generation builds on it | Phase 2 |
| AI sandbox / experimentation environment (US-17) | Containerized experimentation is valuable but not required to prove grounded, governed recommendations | Phase 2 / Stretch |
| MyASPPH single sign-on | Hackathon build is standalone with pre-provisioned Cognito users | Post-hackathon |
| Fully functional community discussion forums | Forums stay in MyASPPH; community sharing can appear in the UI without being fully wired | Post-hackathon |
| Additional user groups (member school/program roles) | MVP uses two roles (faculty, ASPPH admin); the design can add others later | Post-hackathon |
| Backup, network isolation, secrets management | Cross-cutting hardening beyond the demo path | Post-hackathon (Phase 8) |

### MVP User Journeys

#### Journey 1: Faculty transforms a syllabus
1. Faculty member signs in through Cognito.
2. They upload a PDF syllabus (or paste text), and the extracted text is shown back for confirmation.
3. The input is PII-scrubbed and guardrail-checked, then an asynchronous analysis job runs.
4. The Curriculum Transformation Assistant returns recommendations that name specific modules/assignments and cite ASPPH sources.
5. Competency Intelligence returns an objective → competency → gap table citing CEPH plus workforce expectations.
6. The faculty member reviews and edits the result, approves it, and exports it to DOCX/PDF or shares it to the community repository.
**Outcome**: The faculty member gets grounded, accreditation-aligned, human-approved AI integration guidance from their own syllabus.
**Limitation vs Full Vision**: One syllabus at a time, a small synthetic knowledge base, two roles, and no generated draft materials or sandbox yet.

#### Journey 2: ASPPH admin curates the knowledge base
1. Admin signs in and opens the admin-only source inventory (faculty are 403'd and the nav is hidden from them).
2. They view approved sources with metadata (type, owner, effective/update date, status).
3. Retired or superseded sources are excluded from new retrieval results, and changes are auditable via CloudTrail.
**Outcome**: The grounding the whole network relies on stays curated, current, and auditable.
**Limitation vs Full Vision**: Source management is lightweight and operates over synthetic content only.

### MVP Constraints and Assumptions

- **Assumption**: A small set of synthetic/public source documents (competency frameworks, accreditation guidance, curated AI resources) is sufficient to demonstrate credible grounding. **Risk if wrong**: Recommendations may appear thin or under-cited and need a larger corpus.
- **Assumption**: Comprehend PII detection on short syllabus-style text reliably removes names/emails before the model sees them. **Risk if wrong**: PII could reach the model or logs, violating a non-negotiable constraint.
- **Accepted Limitation**: The MVP covers the single demo path (upload → recommend → map → review → export/share), not generated materials or a sandbox.
- **Accepted Limitation**: The build uses only Workshop Studio synthetic content and is standalone (no MyASPPH SSO), so it is a faithful but non-production demonstration.

### MVP Definition of Done

- [ ] All "MUST" features implemented and demonstrated end to end for a demo faculty user.
- [ ] The full demo path runs live: sign in → upload → grounded recommendations → guardrails → competency mapping → review → approve → export/share.
- [ ] Every recommendation shows at least one ASPPH citation (title + snippet) and distinguishes evidence from synthesis.
- [ ] PII redaction verified on an input containing a name/email; off-topic prompt blocked with a friendly message.
- [ ] CloudTrail, CloudWatch, and encrypted Bedrock model-invocation logging verified, with no raw PII in logs.
- [ ] Infrastructure defined as code and confirmed redeployable into ASPPH's AWS account.

---

## Risks and Dependencies

### Key Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Long analysis exceeds API Gateway's 29s timeout | High | High | Run analysis as an asynchronous job (agent on AgentCore via a worker Lambda) and poll from the UI; tune the agent to stay under ~60s |
| Guardrail over-blocks legitimate curriculum questions | Medium | High | Define denied topics as concrete off-topic domains (not "anything unrelated to X"); apply the guardrail at input only, not on agent output |
| PII reaches the model or logs | Medium | High | Comprehend PII pre-scrub before any model call, encrypted + access-restricted model-invocation logs |
| Grounding returns partial/orphaned results | Medium | Medium | Clean KB reset discipline (delete data source → recreate index → re-ingest) and verify retrieval coverage across all source docs, not just ingestion stats |
| Newer Claude models reject bare on-demand model IDs | Medium | Medium | Use cross-region inference-profile IDs via the Converse API for all Bedrock calls |

### External Dependencies

- Amazon Bedrock model access (Claude via inference profiles, Titan embeddings) — AWS — confirmed available in the Workshop Studio account/Region.
- ASPPH Teaching & Learning / governance review for the source inventory and community moderation — ASPPH — required for curated grounding and sharing.
- Sample workforce data ASPPH is preparing — ASPPH — needed for the competency workforce-expectations view.
- AWS platform services (Cognito, API Gateway, Lambda, S3, S3 Vectors, Bedrock Knowledge Bases, AgentCore, DynamoDB, KMS, CloudWatch, CloudTrail, Amplify) — AWS — available in the target account.

### Open Questions

- [ ] Which synthetic source documents best represent the competency, accreditation, and curated-AI-resource source types for the demo?
- [ ] What is the acceptable p95 latency ceiling for the analysis and competency jobs at request time?
- [ ] How much community-sharing functionality should be real versus mocked in the UI for the hackathon?
- [ ] What governance workflow should moderate shared community content before broader publication?
