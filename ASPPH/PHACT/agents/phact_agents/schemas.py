"""Pydantic models: what each agent must return, and the final analysis result.

Agent outputs use snake_case and cite `evidence_ids` only. The final result uses
the camelCase field names of the frontend types in `frontend/src/types.ts`, with
citations resolved from the evidence store by code.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from .doc_check import DocCheckResult

Alignment = Literal["Strong Alignment", "Partial Alignment", "Gap Identified"]
IntegrationType = Literal["AI_ASSISTED", "AI_RESISTANT", "AI_LITERACY", "NO_CHANGE"]


# ---------- Agent 1: competency guidelines KB ----------


class ObjectiveMapping(BaseModel):
    objective: str = Field(description="Learning objective, quoted or closely paraphrased from the syllabus")
    competency: str = Field(
        description="Competency number and wording exactly as it appears in the cited evidence, "
        "e.g. 'CEPH MPH Foundational Competency 4: Interpret results of data analysis ...'. "
        "Use 'None identified' when no retrieved competency fits."
    )
    alignment: Alignment
    gap: str = Field(description="What the competency requires that the course does not yet show")
    improvement: str = Field(description="Concrete change to close the gap")
    reasoning: str = Field(description="Why this mapping holds; this is your synthesis, not a quote")
    evidence_ids: list[str] = Field(description="IDs returned by search_competency_guidelines, e.g. ['C1']")


class CompetencyFindings(BaseModel):
    mappings: list[ObjectiveMapping]
    workforce_notes: list[str] = Field(
        default_factory=list,
        description="Workforce or AI-readiness expectations from the evidence, each ending with its evidence ID in brackets",
    )


# ---------- Agent 2: approved / modified syllabus KB ----------


class SyllabusPattern(BaseModel):
    pattern: str = Field(description="What a peer approved syllabus does (AI policy, AI-supported assignment, AI-resistant assessment, data privacy rule, ...)")
    applies_to: str = Field(description="Specific week, module, assignment or policy in the faculty syllabus where this pattern fits")
    adaptation: str = Field(description="How the faculty member could adapt the pattern")
    evidence_ids: list[str] = Field(description="IDs returned by search_approved_syllabi, e.g. ['S2']")


class SyllabusExampleFindings(BaseModel):
    patterns: list[SyllabusPattern]


# ---------- Agent 3: synthesis ----------


class RecommendationDraft(BaseModel):
    title: str
    module: str = Field(description="Exact week/module/assignment/policy name from the faculty syllabus")
    activity_type: str = Field(description="Short label, e.g. 'Assignment redesign', 'Course policy', 'In-class activity'")
    integration_type: IntegrationType
    description: str
    rationale: str = Field(description="Your synthesis of why; keep it separate from quoted evidence")
    implementation_steps: list[str]
    learning_outcomes: list[str]
    responsible_ai: str = Field(description="Privacy, disclosure, verification or bias safeguards for this change")
    evidence_ids: list[str] = Field(description="Evidence IDs from the catalogue (C* and/or S*) that support this recommendation")


class RevisedSyllabusDraft(BaseModel):
    title: str
    change_summary: list[str] = Field(description="One line per change, naming the section changed")
    markdown: str = Field(description="Full revised syllabus in Markdown; changed or added text marked with '[PHACT]'")


class SynthesisOutput(BaseModel):
    recommendations: list[RecommendationDraft]
    revised_syllabus: RevisedSyllabusDraft


# ---------- Final result (frontend-facing, camelCase) ----------


class Citation(BaseModel):
    id: str
    sourceId: str
    title: str
    publisher: str
    kind: Literal["Authoritative", "Faculty Example"]
    version: str
    page: int | None = None
    excerpt: str
    illustrative: bool = False


class Recommendation(BaseModel):
    id: str
    jobId: str
    syllabusId: str
    title: str
    module: str
    activityType: str
    integrationType: IntegrationType
    description: str
    rationale: str
    implementationSteps: list[str]
    learningOutcomes: list[str]
    responsibleAI: str
    citations: list[Citation]
    grounded: bool = Field(description="False when no valid citation survived validation")
    status: Literal["DRAFT"] = "DRAFT"


class CompetencyMapping(BaseModel):
    id: str
    objective: str
    competency: str
    alignment: Alignment
    gap: str
    improvement: str
    source: str
    reasoning: str
    citations: list[Citation]


class RevisedSyllabus(BaseModel):
    title: str
    changeSummary: list[str]
    markdown: str
    status: Literal["DRAFT"] = "DRAFT"


class AnalysisResult(BaseModel):
    schemaVersion: str
    jobId: str
    syllabusId: str
    status: Literal["SUCCEEDED", "BLOCKED", "REJECTED", "FAILED"] = Field(
        description="BLOCKED = guardrail; REJECTED = wrong document (see documentCheck); nothing reaches the agents in either case")
    generatedAt: str
    modelId: str
    corpusVersion: str | None
    recommendations: list[Recommendation] = Field(default_factory=list)
    competencyMappings: list[CompetencyMapping] = Field(default_factory=list)
    workforceNotes: list[str] = Field(default_factory=list)
    revisedSyllabus: RevisedSyllabus | None = None
    evidence: list[Citation] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    message: str | None = Field(default=None, description="User-facing message when status is BLOCKED, REJECTED or FAILED")
    documentCheck: DocCheckResult | None = None
    piiRedactions: int = 0
    timingsMs: dict[str, int] = Field(default_factory=dict)
