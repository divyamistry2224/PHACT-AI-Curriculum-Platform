import { PageHeader } from "../components/ui"

export function Legal({ type }: { type: "privacy" | "terms" }) {
  const privacy = type === "privacy"
  return (
    <div className="legal-page">
      <PageHeader
        eyebrow="Draft for review"
        title={privacy ? "Privacy Policy" : "Terms of Service"}
        description="This prototype document identifies known product behavior. Legal counsel must review and complete it before production use."
      />
      <div className="panel legal-copy">
        <p className="draft-banner">
          <b>Draft:</b> Organization contact details, retention periods,
          jurisdiction, and production subprocessors are not yet confirmed.
        </p>
        <h2>
          {privacy
            ? "How the prototype handles information"
            : "Prototype terms"}
        </h2>
        {privacy ? (
          <>
            <h3>Information you provide</h3>
            <p>
              The prototype accepts faculty profile details, syllabus content, recommendation edits, approvals, and
              optional sharing consent. Prototype actions are stored locally in
              your browser.
            </p>
            <h3>Planned production processing</h3>
            <p>
              The proposed AWS architecture includes Amazon Cognito for
              authentication, private Amazon S3 storage, DynamoDB for
              application records, Amazon Comprehend for PII pre-screening, and
              Amazon Bedrock services for grounded analysis. Final
              configurations and retention policies remain to be approved.
            </p>
            <h3>Sharing</h3>
            <p>
              Course materials and approved recommendations are not shared
              automatically. A faculty member must separately opt in, review a
              sanitized contribution, and consent to moderation.
            </p>
            <h3>Your choices</h3>
            <p>
              You can avoid community submission and clear prototype data from
              browser storage. Production access, correction, and deletion
              procedures are pending policy review.
            </p>
          </>
        ) : (
          <>
            <h3>Prototype availability</h3>
            <p>
              PHACT is currently a demonstration product. Analysis outputs are
              simulated and must be reviewed by qualified faculty before
              academic use.
            </p>
            <h3>Faculty responsibility</h3>
            <p>
              Faculty are responsible for checking generated content, source
              metadata, accessibility, and alignment with institutional policy.
              Demonstration citations are labeled and are not verified
              authoritative references.
            </p>
            <h3>Community contributions</h3>
            <p>
              Submitting a resource starts a moderation review. It does not
              guarantee publication. Rejected resources remain private and do
              not enter the shared knowledge repository.
            </p>
            <h3>Items requiring review</h3>
            <p>
              Acceptable use, warranties, limitation of liability, intellectual
              property licensing, governing law, and dispute terms have not been
              finalized.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
