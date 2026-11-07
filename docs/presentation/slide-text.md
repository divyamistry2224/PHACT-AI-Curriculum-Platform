# Presentation text

Extracted from the supplied v13 deck; claims are presentation content, not independently verified results.

## Slide 1











PHACT

Public Health AI Curriculum Transformation Platform

01

ASPPH  /  AWS BREAKING BARRIERS 2026

Better curriculum. 
Grounded in evidence.

Public Health AI Curriculum Transformation Platform

Faculty-led

Source-grounded

Human-approved











TEAM 34  /  HEALTH PHACTORY

David Clary

10+ years of development experience

Claire Kao

EdTech founder • 8+ years of experience

Niko Ajani

Junior Solutions Architect

Divya Mistry

George Washington University • M.S. in Data Science

Saumit Guduguntla

George Mason University • B.S. in Computer Science

Presenter notes:

[~6s] Hi, I'm Claire. We're Health Phactory, Team 34, and this is PHACT.

(Pause briefly before "and this is PHACT" so the name pun lands.)

(Claire presents slides 1-5, about 2 minutes. David is named at the single handoff and presents the architecture slide and the live demo, inside his 3 minutes.)

## Slide 2

PHACT  /  AWS BREAKING BARRIERS 2026  /  WHY

BEHIND EVERY CRISIS IS PUBLIC HEALTH

Recent crises tested how well we prepare, respond and protect the most vulnerable.



2001

September 11

Tested emergency preparedness and response.



2005

Hurricane Katrina

Exposed gaps in disaster response and health equity.



2020

COVID-19

A pandemic that separated families worldwide.



TODAY

Fires, floods, water

Climate threats and communities without clean water.



The people who will respond to the next crisis are sitting in classrooms today.

We cannot prevent or respond to these crises without trained public health professionals.



Examples suggested by ASPPH leadership.

02

Presenter notes:

[~25s] Think about the public health crises of the last 25 years: September 11, Hurricane Katrina, COVID-19, and now wildfires and floods. Behind each one are families and communities whose lives were at stake. We cannot prevent or respond to these crises without trained public health professionals. And the people who will face the next crisis are sitting in classrooms today.

## Slide 3













Initial insights from organizational leadership; direct faculty validation is pending. | No evidence established a relationship between age and AI acceptance.

03

PHACT  /  AWS BREAKING BARRIERS 2026  /  CHALLENGE

THE FACULTY CHALLENGE

How do we prepare students for AI-enabled work?

Time, technical expertise and resources are limited. Leadership interviews point to three needs.

01 ADOPTION

Different starting points

Faculty differ in confidence, expectations and willingness to use AI.

02 LEARNING

Protect critical thinking

AI-supported activities should preserve students' independent reasoning.

03 TRUST

Credible sources

Fabricated citations and out-of-context guidance undermine confidence.

Presenter notes:

[~20s] But AI is changing education, research and public health practice. Faculty face a hard question: how do we prepare students for an AI-enabled workforce, when time, technical expertise and resources are limited?

## Slide 4

PHACT  /  AWS BREAKING BARRIERS 2026  /  PHACT

WHY NOT JUST ASK A CHATBOT?



Upload a syllabus. Within minutes, see where AI fits.

A chatbot gives fluent ideas. PHACT gives ideas a professor can check, map and approve.



01 GROUNDED

Sources you can check

Every suggestion cites ASPPH and CEPH sources the professor can open.



02 MAPPED

Gaps made visible

Shows which CEPH competencies the course does not yet cover.



03 BALANCED

Knows when not to use AI

Suggests keeping some work independent, such as oral exams.



04 FACULTY-LED

Nothing without approval

Every result stays a draft until the professor approves it.



Human-in-the-lead: PHACT supports academic judgment; it does not replace it or certify accreditation.

04

Presenter notes:

[~35s] That's why we built PHACT. A professor uploads an existing syllabus and, within minutes, gets evidence-informed ways to bring AI into the course. How is this different from asking a chatbot? Every suggestion cites trusted ASPPH and CEPH sources the professor can open and check. PHACT shows which competencies the course does not yet cover. It also knows when not to use AI. And nothing is used until the professor approves it.

(Only say what the demo shows. Check with David that citations open to a real source passage.)

## Slide 5

PHACT  /  AWS BREAKING BARRIERS 2026  /  IMPACT

THE MULTIPLIER EFFECT

Helping one professor reaches every student in the course, and every community they will serve.



150+

schools and programs of public health in ASPPH



103,000+

faculty, staff, students and academic leaders



18,000+

undergraduate public health graduates each year



239,000

professionals in U.S. state and local public health agencies



One educator. Many students. Countless communities.

Pilot targets: results within minutes, a citation for every recommendation, approval before sharing.



Figures provided by ASPPH.

05

Presenter notes:

[~20s] And the impact goes beyond one classroom. ASPPH connects more than 150 schools and programs and over 103,000 faculty, staff and students. More than 18,000 undergraduates earn public health degrees every year, and about 239,000 people work in U.S. state and local public health agencies. One educator. Many students. Countless communities.

[~10s] We're not replacing educators. We're helping them prepare the next generation. Now David will show you how it works.

(If short on time, drop the 239,000 sentence.)

## Slide 6

PHACT  /  AWS BREAKING BARRIERS 2026  /  ARCHITECTURE

FROM UPLOAD TO RECOMMENDATION

PII is scrubbed before storage. Analysis runs in the background. Only approved syllabi return to the knowledge base.

Faculty / admin
Upload, review, approve

CloudFront + Cognito
React app, sign-in

API Gateway
Authorized requests

Lambda functions
Start job, get review

PII scrub
Comprehend, before S3

S3 + DynamoDB
Syllabus versions, metadata

Analysis Lambda
Bedrock analysis

SQS
Queued jobs, retries

Admin approval
Approve or reject

SQS + Lambda
Copy to KB, re-sync

Approved syllabi KB
Reviewed examples

Competency KB
CEPH guidelines



APPROVAL LOOP

Approved syllabi are added to the KB, so the next analysis draws on reviewed examples.



Blue outline = Bedrock analysis + RAG   /   Dashed arrow = knowledge base retrieval

06

Presenter notes:

(David. The architecture counts inside the 3-minute demo; keep it to about 35 seconds.)

[~35s] Thanks, Claire. For the front end, we have a CloudFront-hosted web page with Amazon Cognito for authentication. Actions on the front end go through API Gateway to different Lambda functions. Syllabi are stored in S3, with a DynamoDB table holding all the metadata. Those Lambda functions are triggered through SQS and run the analysis, comparing each syllabus against the competency guidelines and against summaries that have already been approved, to recommend improvements. And personally identifiable information is scrubbed before it ever lands in S3, so it doesn't exist anywhere. Let me show you.

--- LIVE DEMO (about 2:25 left of David's 3 minutes) ---

(Diagram is a placeholder until David updates it.)

## Slide 7





ASPPH  /  AWS BREAKING BARRIERS 2026

Thank You.

Empowering educators. Advancing responsible AI. Shaping the future of public health.

Better curriculum. Grounded in evidence.

PUBLIC HEALTH AI CURRICULUM TRANSFORMATION PLATFORM

Questions & Discussion

TEAM 34  /  HEALTH PHACTORY

07

Presenter notes:

(After the demo) Thank you from Health Phactory. We're happy to take your questions.

## Slide 8



































ENCRYPTION + IAM + AUDIT

KMS  /  scoped backend permissions  /  CloudWatch  /  CloudTrail

08

PHACT  /  AWS BREAKING BARRIERS 2026  /  BACKUP: SECURITY

CURRENT AWS INFRASTRUCTURE

Built around an asynchronous AWS workflow. Fast user requests. Background AI jobs. An explicit approval gate before shared publication.

EXPERIENCE

API + DATA

ASYNC AI

TRUST + KNOWLEDGE

CloudFront + S3

React / Vite frontend

Amazon Cognito

OIDC • faculty / admin

API Gateway + Lambda

Authorized API requests

S3 + DynamoDB

Versions, jobs, review state

SQS + Lambda

Queued work and retries

Analysis worker

Curriculum + competency logic

Comprehend

Pre-model PII scrubbing

Amazon Bedrock

Curated sources in S3

Presenter notes:

BACKUP (hidden). Show only if asked in Q&A.

## Slide 9



















Faculty confirm or revise the match; the tool does not certify accreditation compliance.

09

PHACT  /  AWS BREAKING BARRIERS 2026  /  BACKUP: MAPPING

HOW MAPPING WORKS  /  ILLUSTRATIVE EXAMPLE

Competency mapping: objective → evidence → gap. Mapping compares what a course teaches with what a named competency framework expects.

INPUT

Learning objective

"Interpret study findings and explain uncertainty."

REFERENCE

Framework requirement

Select the applicable framework and version; inspect its exact competency wording.

OUTPUT

Faculty-reviewed match

Show the suggested match, course evidence, rationale and any missing coverage.

Possible gap: interpretation is taught, but appraisal of AI-generated claims is not explicit.

Presenter notes:

BACKUP (hidden). Show only if asked in Q&A.

## Slide 10









HYPOTHESIS TO TEST: Source inspection helps faculty judge trustworthiness and applicability.

10

PHACT  /  AWS BREAKING BARRIERS 2026  /  BACKUP: SOURCES

PROPOSED FEATURE  /  SOURCE INSPECTION

Let faculty inspect the evidence.

A citation is a starting point. Faculty need to see what it supports and whether it applies.

01

OPEN

See the original

Open the cited passage and its original reference document.

02

CHECK

Verify the context

Check issuing organization, document version and applicable framework.

03

COMPARE

Judge the support

Separate quoted evidence from AI interpretation and the proposed change.

Presenter notes:

BACKUP (hidden). Show only if asked in Q&A.

## Slide 11









PILOT TARGETS

<60s analysis  •  cited recommendations  •  approval before export/share

11

PHACT  /  AWS BREAKING BARRIERS 2026  /  BACKUP: PILOT

IMPACT + SCALABILITY

Start with one faculty pilot. Scale shared value. The opportunity is less duplicated work, more consistent guidance, and a stronger shared curriculum resource.

FACULTY

More confidence

A specific, cited starting point for course revision.

PROGRAMS

Less duplication

Reuse approved examples and a curated source library.

PLATFORM

Elastic capacity

Queue-based AI processing and independent worker scaling.

Presenter notes:

BACKUP (hidden). Show only if asked in Q&A.
