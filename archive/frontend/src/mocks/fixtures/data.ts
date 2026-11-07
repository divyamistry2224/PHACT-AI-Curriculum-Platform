import type {
  AnalysisJob,
  Citation,
  CompetencyMapping,
  FacultyUser,
  KnowledgeSource,
  Recommendation,
  SharedContribution,
  Syllabus,
} from "../../types"

// All people, institutions, and citations below are demonstration records.
export const demoUsers: FacultyUser[] = [
  {
    id: "u-faculty",
    displayName: "Dr. Maya Chen",
    email: "maya.chen@demo.phact.edu",
    role: "faculty",
    institution: "North Coast School of Public Health",
    title: "Associate Professor of Epidemiology",
  },
  {
    id: "u-admin",
    displayName: "Jordan Ellis",
    email: "admin@demo.phact.edu",
    role: "admin",
    institution: "ASPPH",
    title: "Knowledge Administrator",
  },
]

const CEPH: Citation = {
  id: "cite-ceph",
  title: "Accreditation Criteria: Schools of Public Health",
  publisher: "Council on Education for Public Health",
  kind: "Authoritative",
  version: "2024.1",
  excerpt:
    "Foundational competencies include selecting quantitative and qualitative methods appropriate for a public health context.",
  illustrative: true,
}
const ASPPH: Citation = {
  id: "cite-aspph",
  title: "AI in Public Health Education: Faculty Guidance",
  publisher: "ASPPH",
  kind: "Authoritative",
  version: "Draft 0.9",
  excerpt:
    "Learners should verify AI-assisted output, disclose use, and protect sensitive health information.",
  illustrative: true,
}
const EXAMPLE: Citation = {
  id: "cite-example",
  title: "Epidemiology Dataset Verification Activity",
  publisher: "Faculty contributor, moderated by ASPPH",
  kind: "Faculty Example",
  version: "1.2",
  excerpt:
    "Students compared tool-generated summaries with an instructor-verified analysis and documented discrepancies.",
  illustrative: true,
}

type RecTemplate = Omit<
  Recommendation,
  "id" | "jobId" | "syllabusId" | "status" | "updatedAt" | "history"
>

export function recommendationTemplates(courseName: string): RecTemplate[] {
  return [
    {
      title: "Verify AI-Assisted Data Interpretation",
      module: "Data analysis and interpretation",
      activityType: "Guided analysis",
      description: `Students in ${courseName} compare an AI-generated interpretation of a de-identified dataset with an instructor-verified analysis, then document every discrepancy.`,
      rationale:
        "Verification practice builds the evidence-based reasoning expected in public health work and shows where fluent output can be wrong.",
      implementationSteps: [
        "Prepare a de-identified dataset and an instructor-verified analysis.",
        "Have students record prompts, outputs, and independent checks.",
        "Discuss which errors changed the public health conclusion.",
      ],
      learningOutcomes: [
        "Evaluate AI-assisted analysis for accuracy, bias, and missing context.",
      ],
      responsibleAI:
        "Use only de-identified data. Students remain accountable for every conclusion they submit.",
      citations: [CEPH, EXAMPLE],
    },
    {
      title: "Add an AI Use and Verification Disclosure",
      module: "Assessment practice",
      activityType: "Assessment",
      description:
        "Add a short disclosure to major assignments describing where AI supported the work, what output was retained, and how it was verified.",
      rationale:
        "Clear disclosure makes AI use visible to instructors and lets assessment reward judgment instead of volume of tool use.",
      implementationSteps: [
        "Add a disclosure template to assignment instructions.",
        "Provide one complete and one incomplete example.",
        "Assess the quality of verification during feedback.",
      ],
      learningOutcomes: [
        "Document AI-assisted work transparently and responsibly.",
      ],
      responsibleAI:
        "Disclosure should not penalize permitted use. Align expectations with institutional academic integrity policy.",
      citations: [ASPPH],
    },
    {
      title: "Examine Bias in a Simulated Prediction Tool",
      module: "Health equity and ethics",
      activityType: "Case study",
      description:
        "Students audit a simulated risk tool across population groups and write a recommendation on appropriate limits for its use.",
      rationale:
        "Auditing a tool connects equity principles to concrete decisions that public health practitioners will face.",
      implementationSteps: [
        "Share a clearly labeled simulated dataset and model summary.",
        "Compare performance across groups.",
        "Write a brief for a public health decision-maker.",
      ],
      learningOutcomes: [
        "Identify unequal model performance and communicate its limits.",
      ],
      responsibleAI:
        "Simulated results must be labeled and not generalized to real populations.",
      citations: [CEPH, ASPPH],
    },
  ]
}

export const seedSyllabi: Syllabus[] = [
  {
    id: "syl-1",
    facultyId: "u-faculty",
    courseName: "Introduction to Epidemiology",
    subject: "Epidemiology",
    description:
      "Principles and methods used to study the distribution and determinants of health in populations.",
    s3Key: "private/u-faculty/syl-1/epi-syllabus.pdf",
    fileName: "epi-syllabus.pdf",
    source: "pdf",
    extractedText:
      "Module 3: Disease Surveillance. Students will describe surveillance systems and calculate measures of disease frequency.",
    extractedIsIllustrative: true,
    uploadedAt: "2025-02-18T14:02:00Z",
    status: "ANALYZED",
  },
  {
    id: "syl-2",
    facultyId: "u-faculty",
    courseName: "Biostatistics",
    subject: "Biostatistics",
    description: "Statistical reasoning for public health research.",
    s3Key: "private/u-faculty/syl-2/biostat.pdf",
    fileName: "biostat.pdf",
    source: "pdf",
    extractedText:
      "Week 5: Regression. Students will interpret model output and communicate uncertainty.",
    extractedIsIllustrative: true,
    uploadedAt: "2025-02-04T16:20:00Z",
    status: "ANALYZED",
  },
  {
    id: "syl-3",
    facultyId: "u-faculty",
    courseName: "Public Health Ethics",
    subject: "Ethics",
    description: "Ethical frameworks for public health practice and policy.",
    s3Key: "private/u-faculty/syl-3/pasted-syllabus.txt",
    source: "text",
    extractedText:
      "Unit 2: Justice and equity. Students will analyze allocation decisions using ethical frameworks.",
    extractedIsIllustrative: false,
    uploadedAt: "2025-01-22T10:05:00Z",
    status: "ANALYZED",
  },
  {
    id: "syl-4",
    facultyId: "u-faculty",
    courseName: "Environmental Health",
    subject: "Environmental Health",
    description: "Environmental determinants of population health.",
    s3Key: "private/u-faculty/syl-4/env-health.pdf",
    fileName: "env-health.pdf",
    source: "pdf",
    extractedText: "Extraction did not complete.",
    extractedIsIllustrative: true,
    uploadedAt: "2025-01-08T09:40:00Z",
    status: "FAILED",
  },
]

export const seedJobs: AnalysisJob[] = [
  { id: "job-1", syllabusId: "syl-1", facultyId: "u-faculty", status: "COMPLETED", progressStep: 8, createdAt: "2025-02-18T14:02:30Z", startedAt: "2025-02-18T14:02:31Z", completedAt: "2025-02-18T14:05:10Z", updatedAt: "2025-02-18T14:05:10Z" },
  { id: "job-2", syllabusId: "syl-2", facultyId: "u-faculty", status: "COMPLETED", progressStep: 8, createdAt: "2025-02-04T16:21:00Z", startedAt: "2025-02-04T16:21:01Z", completedAt: "2025-02-04T16:24:00Z", updatedAt: "2025-02-04T16:24:00Z" },
  { id: "job-3", syllabusId: "syl-3", facultyId: "u-faculty", status: "COMPLETED", progressStep: 8, createdAt: "2025-01-22T10:06:00Z", startedAt: "2025-01-22T10:06:01Z", completedAt: "2025-01-22T10:08:40Z", updatedAt: "2025-01-22T10:08:40Z" },
  { id: "job-4", syllabusId: "syl-4", facultyId: "u-faculty", status: "FAILED", progressStep: 1, createdAt: "2025-01-08T09:41:00Z", startedAt: "2025-01-08T09:41:01Z", updatedAt: "2025-01-08T09:41:40Z", error: "Content extraction failed because the PDF appears to contain scanned images only. Retry, or paste the syllabus text instead." },
]

function fromTemplate(
  t: RecTemplate,
  id: string,
  jobId: string,
  syllabusId: string,
  at: string,
): Recommendation {
  return {
    ...t,
    id,
    jobId,
    syllabusId,
    status: "DRAFT",
    updatedAt: at,
    history: [{ id: `${id}-h1`, action: "GENERATED", actor: "PHACT analysis", at, note: "Draft created from retrieved sources." }],
  }
}

const epi = recommendationTemplates("Introduction to Epidemiology")
const biostat = recommendationTemplates("Biostatistics")
const ethics = recommendationTemplates("Public Health Ethics")

export const seedRecommendations: Recommendation[] = [
  {
    ...fromTemplate(epi[0], "rec-1", "job-1", "syl-1", "2025-02-18T14:05:10Z"),
    title: "Evaluate AI-Assisted Epidemiological Analysis",
    module: "Disease Surveillance",
    description:
      "Introduce a guided activity where students compare AI-generated interpretations of epidemiological datasets against independently verified statistical findings.",
    learningOutcomes: [
      "Critically evaluate AI-generated public health analysis for accuracy and bias.",
      "Explain when human review changes an analytical conclusion.",
    ],
  },
  fromTemplate(epi[1], "rec-2", "job-1", "syl-1", "2025-02-18T14:05:10Z"),
  {
    ...fromTemplate(epi[2], "rec-3", "job-1", "syl-1", "2025-02-18T14:05:10Z"),
    status: "APPROVED",
    reviewedBy: "Dr. Maya Chen",
    reviewedAt: "2025-02-20T15:30:00Z",
    updatedAt: "2025-02-20T15:30:00Z",
    history: [
      { id: "rec-3-h1", action: "GENERATED", actor: "PHACT analysis", at: "2025-02-18T14:05:10Z", note: "Draft created from retrieved sources." },
      { id: "rec-3-h2", action: "EDITED", actor: "Dr. Maya Chen", at: "2025-02-20T15:12:00Z", note: "Clarified simulated data labeling." },
      { id: "rec-3-h3", action: "APPROVED", actor: "Dr. Maya Chen", at: "2025-02-20T15:30:00Z" },
    ],
  },
  {
    ...fromTemplate(biostat[0], "rec-4", "job-2", "syl-2", "2025-02-04T16:24:00Z"),
    status: "APPROVED",
    reviewedBy: "Dr. Maya Chen",
    reviewedAt: "2025-02-06T11:00:00Z",
    updatedAt: "2025-02-06T11:00:00Z",
  },
  {
    ...fromTemplate(biostat[1], "rec-5", "job-2", "syl-2", "2025-02-04T16:24:00Z"),
    status: "APPROVED",
    reviewedBy: "Dr. Maya Chen",
    reviewedAt: "2025-02-06T11:04:00Z",
    updatedAt: "2025-02-06T11:04:00Z",
  },
  fromTemplate(ethics[1], "rec-6", "job-3", "syl-3", "2025-01-22T10:08:40Z"),
  {
    ...fromTemplate(ethics[2], "rec-7", "job-3", "syl-3", "2025-01-22T10:08:40Z"),
    status: "REJECTED",
    reviewedBy: "Dr. Maya Chen",
    reviewedAt: "2025-01-24T09:15:00Z",
    updatedAt: "2025-01-24T09:15:00Z",
  },
]

export const competencyMappings: CompetencyMapping[] = [
  { id: "c1", objective: "Calculate and interpret measures of disease frequency.", competency: "Apply quantitative methods appropriate to a public health context", alignment: "Strong Alignment", gap: "None identified", improvement: "Add an explicit check of any tool-generated calculations.", source: "CEPH Accreditation Criteria 2024.1 (illustrative citation)", reasoning: "The objective names a quantitative method and interpretation, which matches the competency language directly." },
  { id: "c2", objective: "Describe public health surveillance systems.", competency: "Interpret results of data analysis for public health practice", alignment: "Partial Alignment", gap: "No critique of data quality or limitations", improvement: "Describe and critique the data quality limitations of two surveillance systems.", source: "CEPH Accreditation Criteria 2024.1 (illustrative citation)", reasoning: "Describing systems is related, but the competency expects interpretation and critique, which the objective does not yet require." },
  { id: "c3", objective: "Use statistical software to analyze epidemiologic data.", competency: "Select data collection and analysis methods for a public health context", alignment: "Gap Identified", gap: "Verification of AI-assisted output is not assessed", improvement: "Use software, including AI-assisted tools, and independently verify the resulting analysis.", source: "ASPPH Faculty Guidance Draft 0.9 (illustrative citation)", reasoning: "Retrieved guidance emphasizes verification of AI-assisted analysis. No objective or assessment in the syllabus addresses it." },
  { id: "c4", objective: "Communicate epidemiologic findings to diverse audiences.", competency: "Communicate public health content to diverse audiences", alignment: "Strong Alignment", gap: "None identified", improvement: "Keep the objective and add audience-specific evidence notes.", source: "CEPH Accreditation Criteria 2024.1 (illustrative citation)", reasoning: "The objective and competency describe the same communication outcome." },
]

export const seedSources: KnowledgeSource[] = [
  { id: "k1", title: "Accreditation Criteria: Schools of Public Health", sourceType: "Authoritative", category: "Accreditation", s3Key: "s3://phact-data/ceph/criteria-2024.pdf", version: "2024.1", approvalStatus: "ACTIVE", ingestionStatus: "INDEXED", updatedAt: "2025-01-12", publisher: "Council on Education for Public Health", summary: "Accreditation criteria and foundational competency expectations.", competencies: ["Evidence-based approaches", "Communication", "Leadership"], body: "Demonstration record representing the official accreditation criteria. Always confirm language against the current published document." },
  { id: "k2", title: "AI in Public Health Education: Faculty Guidance", sourceType: "Authoritative", category: "Educational guidance", s3Key: "s3://phact-data/aspph/ai-guidance.pdf", version: "Draft 0.9", approvalStatus: "ACTIVE", ingestionStatus: "INDEXED", updatedAt: "2025-02-03", publisher: "ASPPH", summary: "Guidance for transparent, responsible use of AI in public health curricula.", competencies: ["Ethics", "Data literacy"], body: "Demonstration record representing curated guidance on disclosure, verification, and privacy for AI use in coursework." },
  { id: "k3", title: "Public Health Workforce Competency Expectations", sourceType: "Authoritative", category: "Workforce", s3Key: "s3://phact-data/workforce/expectations.pdf", version: "2023.2", approvalStatus: "ACTIVE", ingestionStatus: "INDEXED", updatedAt: "2024-11-30", publisher: "Workforce resource (demonstration)", summary: "Expectations for data, communication, and equity skills in the workforce.", competencies: ["Data analysis", "Health equity"], body: "Demonstration record representing workforce expectations used to ground recommendations." },
  { id: "k4", title: "Epidemiology Dataset Verification Activity", sourceType: "Faculty Example", category: "Teaching activity", s3Key: "s3://phact-context/examples/epi-verification.pdf", version: "1.2", approvalStatus: "PUBLISHED", ingestionStatus: "INDEXED", updatedAt: "2025-02-17", publisher: "Faculty contributor, moderated by ASPPH", summary: "A reviewed activity comparing AI output with verified statistical analysis.", competencies: ["Evidence-based approaches"], body: "Students compare a tool-generated summary with an instructor-verified analysis, document discrepancies, and reflect on accountability." },
  { id: "k5", title: "AI Disclosure Template for Ethics Courses", sourceType: "Faculty Example", category: "Assessment resource", s3Key: "s3://phact-context/examples/disclosure-template.docx", version: "1.0", approvalStatus: "PUBLISHED", ingestionStatus: "INDEXED", updatedAt: "2025-01-29", publisher: "Faculty contributor, moderated by ASPPH", summary: "A reusable disclosure form with facilitation notes.", competencies: ["Ethics", "Communication"], body: "A one-page disclosure form asking where AI was used, what was retained, and how it was verified." },
  { id: "k6", title: "Curriculum Standards Archive 2016", sourceType: "Authoritative", category: "Accreditation", s3Key: "s3://phact-data/ceph/criteria-2016.pdf", version: "2016", approvalStatus: "SUPERSEDED", ingestionStatus: "INDEXED", updatedAt: "2021-06-01", publisher: "Council on Education for Public Health", summary: "Superseded criteria retained for reference only.", competencies: [], body: "Superseded record. Not eligible for retrieval." },
  { id: "k7", title: "Curated AI Teaching Reference List", sourceType: "Authoritative", category: "Educational reference", s3Key: "s3://phact-data/curated/ai-references.pdf", version: "0.3", approvalStatus: "ACTIVE", ingestionStatus: "FAILED", updatedAt: "2025-02-22", publisher: "ASPPH", summary: "A curated reading list for faculty development.", competencies: ["Data literacy"], body: "Ingestion failed because the document could not be parsed." },
]

export const seedContributions: SharedContribution[] = [
  { id: "sh-1", recommendationId: "rec-3", submittedBy: "Dr. Maya Chen", submittedById: "u-faculty", title: "Bias Audit for a Simulated Risk Tool", description: "Sanitized classroom activity for examining model performance across population groups.", courseSubject: "Epidemiology", consentGiven: true, consentAt: "2025-02-21T10:00:00Z", submittedAt: "2025-02-21T10:00:00Z", moderationStatus: "PENDING_MODERATION", sanitization: "PASSED" },
  { id: "sh-2", recommendationId: "rec-5", submittedBy: "Dr. Maya Chen", submittedById: "u-faculty", title: "AI Use Disclosure for Statistics Assignments", description: "A disclosure template adapted for regression assignments.", courseSubject: "Biostatistics", consentGiven: true, consentAt: "2025-02-07T09:00:00Z", submittedAt: "2025-02-07T09:00:00Z", moderationStatus: "INDEX_FAILED", sanitization: "PASSED", reviewedBy: "Jordan Ellis" },
]
