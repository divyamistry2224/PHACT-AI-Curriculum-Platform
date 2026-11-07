"""DecisionNotifier function: emails the faculty member when an admin approves or denies their submission.

Triggered by the Syllabi table's DynamoDB Stream. An event filter (in template.yaml) passes only records
where approvalStatus changes from PENDING to APPROVED or DENIED, so ordinary updates never invoke it; the
handler checks the transition again in case the filter is ever loosened.

Email goes through Amazon SES from SENDER_EMAIL, which must be a verified SES identity. If none is
configured, or SES rejects the message (for example, an unverified recipient while the account's SES is in
sandbox), the email is built but not sent, and the reason is recorded. Each decision's email status is
saved on the syllabus record as `notification`, which the admin's submission view shows. Being stream
driven, a failed send never affects the approval itself, and transient errors are retried.
"""

import logging
import os
from datetime import datetime, timezone
from html import escape

from boto3.dynamodb.types import TypeDeserializer
from botocore.exceptions import ClientError

from phact import aws, db

logger = logging.getLogger()
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))

DECISIONS = {"APPROVED", "DENIED"}
# SES errors that retrying won't fix: record them and move on.
NOT_RETRYABLE = {"MessageRejected", "MailFromDomainNotVerifiedException", "ConfigurationSetDoesNotExistException", "AccountSendingPausedException"}
_deserialize = TypeDeserializer().deserialize


def _image(record: dict, key: str) -> dict:
    return {k: _deserialize(v) for k, v in (record.get("dynamodb", {}).get(key) or {}).items()}


def build_email(item: dict) -> dict:
    """Subject, plain text, and HTML for a decision. Plain sentences, no em dashes."""
    title = item.get("title") or "your syllabus"
    version = item.get("submittedVersion")
    url = os.environ.get("APP_URL", "")
    if item["approvalStatus"] == "APPROVED":
        subject = f"Approved: {title}"
        lines = [
            f"Your syllabus {title} (version {version}) was approved by ASPPH.",
            f"Note from the administrator: {item['approvalNote']}" if item.get("approvalNote") else "",
            "A copy with personal details removed is now in the shared library, where it can help other faculty as a peer example.",
        ]
    else:
        subject = f"Revisions requested: {title}"
        lines = [
            f"An ASPPH administrator asked for revisions to your syllabus {title} (version {version}).",
            f"Feedback: {item['denyReason']}" if item.get("denyReason") else "",
            "You can revise it in PHACT and submit it again.",
        ]
    lines = [line for line in lines if line]
    if url:
        lines.append(f"Open PHACT: {url}")
    text = "Hello,\n\n" + "\n\n".join(lines) + "\n\nThis message was sent automatically by PHACT."
    html = "<p>Hello,</p>" + "".join(f"<p>{escape(line)}</p>" for line in lines if not line.startswith("Open PHACT"))
    if url:
        html += f'<p><a href="{escape(url)}">Open PHACT</a></p>'
    html += "<p style=\"color:#617079;font-size:12px\">This message was sent automatically by PHACT.</p>"
    return {"subject": subject, "text": text, "html": html}


def send(item: dict) -> dict:
    """Send the email if a sender is configured. Returns the notification record to store."""
    recipient = item.get("ownerEmail")
    record = {
        "channel": "EMAIL",
        "to": recipient or "",
        "decision": item["approvalStatus"],
        "version": item.get("submittedVersion"),
        "at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
    }
    sender = os.environ.get("SENDER_EMAIL", "")
    if not recipient:
        return {**record, "status": "NOT_SENT", "detail": "The faculty member has no email address on file."}
    if not sender:
        return {**record, "status": "NOT_SENT", "detail": "No verified SES sender address is configured, so the email was built but not sent."}
    email = build_email(item)
    try:
        response = aws.client("ses").send_email(
            Source=sender,
            Destination={"ToAddresses": [recipient]},
            Message={
                "Subject": {"Data": email["subject"], "Charset": "UTF-8"},
                "Body": {"Text": {"Data": email["text"], "Charset": "UTF-8"}, "Html": {"Data": email["html"], "Charset": "UTF-8"}},
            },
        )
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code")
        if code not in NOT_RETRYABLE:
            raise
        message = exc.response.get("Error", {}).get("Message", "")
        logger.info("SES didn't accept the decision email (%s)", code)
        return {**record, "status": "NOT_SENT", "detail": f"SES rejected the email: {message or code}"}
    return {**record, "status": "SENT", "messageId": response.get("MessageId", "")}


def _save(item: dict, notification: dict) -> None:
    """Store the result, but only if the decision it describes is still the current one."""
    try:
        db.syllabi_table().update_item(
            Key={"syllabusId": item["syllabusId"]},
            UpdateExpression="SET notification = :n",
            ConditionExpression="approvalStatus = :status AND decidedAt = :decided",
            ExpressionAttributeValues={":n": notification, ":status": item["approvalStatus"], ":decided": item.get("decidedAt")},
        )
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
            raise


def handler(event, context):
    failures = []
    for record in event.get("Records", []):
        try:
            old, new = _image(record, "OldImage"), _image(record, "NewImage")
            if record.get("eventName") != "MODIFY" or old.get("approvalStatus") != "PENDING" or new.get("approvalStatus") not in DECISIONS:
                continue
            notification = send(new)
            _save(new, notification)
            logger.info("Decision email for syllabus %s: %s", new.get("syllabusId"), notification["status"])
        except Exception:
            logger.exception("Couldn't process stream record %s", record.get("eventID"))
            failures.append({"itemIdentifier": record.get("dynamodb", {}).get("SequenceNumber")})
    return {"batchItemFailures": failures}
