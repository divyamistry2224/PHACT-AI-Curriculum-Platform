"""The review lifecycle shared by both review types: start (with the one-review-at-a-time lock), the worker
pipeline, the faculty member's decisions on its suggestions, and undo.

A review produces a proposal: suggestions, each with its own changes to the text (see proposals.py). The
faculty member accepts, declines, or edits each one; saving composes the accepted changes into the next
version. Declining everything creates no version.

Every state change is a conditional write:
  start    takes the lock only if no review is running (or the lock is older than 15 minutes) and no
           proposal is waiting for decisions
  worker   claims a review only if it is still QUEUED, so a redelivered SQS message never runs it twice
  worker   marks its proposal pending only if the working copy is still at the version it read
  decide   once per review, and only if the working copy is still at the version the proposal was made from
  undo     only if the working copy is still at the version this review created, and that version isn't
           pending approval or approved
"""

import json
import logging
import os
import time
import uuid
from datetime import datetime, timezone

from botocore.exceptions import ClientError

from . import auth, aws, db, guardrails, pii, proposals, storage, style
from .diff import line_diff, stats
from .errors import ContentBlocked, ReviewFailed
from .http import BadRequest, Conflict, Gone, NotFound, optional_str, parse_json_body, path_param, respond

logger = logging.getLogger()

LOCK_STALE_SECONDS = 15 * 60
MIN_REVISION_RATIO = 0.4

STAGE_RETRIEVING = "RETRIEVING_SOURCES"
STAGE_ANALYZING = "ANALYZING"
STAGE_REWRITING = "REWRITING"
STAGE_SAVING = "SAVING"


def _conditional_failed(exc: ClientError) -> bool:
    return exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException"


def _age_seconds(iso: str) -> float:
    return time.time() - datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


# ---------------------------------------------------------------- start

MAX_GUIDANCE_CHARS = 1000
MAX_DECLINED_CONTEXT = 12


def _guidance(event) -> str:
    """Optional instructions for this run. Screened by the guardrail (including its prompt-attack filter) and
    purged of personal details. It reaches the model as marked faculty guidance, never as system prompt."""
    guidance = optional_str(parse_json_body(event), "guidance", MAX_GUIDANCE_CHARS)
    if not guidance:
        return ""
    if guardrails.input_blocked(guidance):
        raise BadRequest("Those instructions can't be used. Describe what you'd like this review to focus on and try again.", code="GUIDANCE_BLOCKED")
    return pii.purge(guidance)


def _declined_before(syllabus_id: str, review_type: str) -> list:
    """Titles of suggestions the faculty member declined in earlier reviews of this type, newest first."""
    titles = []
    for review in db.list_reviews_for_syllabus(syllabus_id):
        if review.get("reviewType") == review_type and review.get("decidedAt") and not review.get("undoneAt"):
            for title in review.get("declinedSuggestions") or []:
                if title not in titles:
                    titles.append(title)
    return titles[:MAX_DECLINED_CONTEXT]


def start(event, review_type: str):
    owner_id = auth.user_id(event)
    syllabus_id = path_param(event, "id")
    syllabus = db.get_owned_syllabus(syllabus_id, owner_id)
    if syllabus.get("pendingReviewId"):
        raise Conflict("Accept or decline the open suggestions on this syllabus before running another review.", code="DECISION_PENDING")
    guidance = _guidance(event)
    declined = _declined_before(syllabus_id, review_type)
    review_id = str(uuid.uuid4())
    now, epoch = db.now_iso(), int(time.time())

    try:
        locked = db.syllabi_table().update_item(
            Key={"syllabusId": syllabus_id},
            UpdateExpression="SET activeReviewId = :review, activeReviewAt = :epoch, updatedAt = :now",
            ConditionExpression="ownerId = :owner AND attribute_not_exists(pendingReviewId) AND (attribute_not_exists(activeReviewId) OR activeReviewAt < :stale)",
            ExpressionAttributeValues={":review": review_id, ":epoch": epoch, ":now": now, ":owner": owner_id, ":stale": epoch - LOCK_STALE_SECONDS},
            ReturnValues="ALL_NEW",
        )["Attributes"]
    except ClientError as exc:
        if _conditional_failed(exc):
            if (db.get_syllabus(syllabus_id) or {}).get("pendingReviewId"):
                raise Conflict("Accept or decline the open suggestions on this syllabus before running another review.", code="DECISION_PENDING") from exc
            raise Conflict("A review is already running on this syllabus. Wait for it to finish, then try again.", code="REVIEW_RUNNING") from exc
        raise

    review = db.without_none({
        "reviewId": review_id,
        "syllabusId": syllabus_id,
        "ownerId": owner_id,
        "reviewType": review_type,
        "jobStatus": "QUEUED",
        "inputVersion": int(locked["currentVersion"]),
        "guidance": guidance or None,
        "declinedContext": declined or None,
        "createdAt": now,
        "expiresAt": syllabus.get("expiresAt"),
    })
    try:
        db.reviews_table().put_item(Item=review)
        aws.client("sqs").send_message(QueueUrl=os.environ["REVIEW_QUEUE_URL"], MessageBody=json.dumps({"reviewId": review_id}))
    except Exception:
        logger.exception("Couldn't queue review %s", review_id)
        fail(review, "The review couldn't be started. Please try again.")
        raise
    return respond(202, db.review_summary(review))


# ---------------------------------------------------------------- worker

def release_lock(syllabus_id: str, review_id: str) -> None:
    try:
        db.syllabi_table().update_item(
            Key={"syllabusId": syllabus_id},
            UpdateExpression="REMOVE activeReviewId, activeReviewAt",
            ConditionExpression="activeReviewId = :review",
            ExpressionAttributeValues={":review": review_id},
        )
    except ClientError as exc:
        if not _conditional_failed(exc):
            raise


def fail(review: dict, message: str) -> None:
    db.reviews_table().update_item(
        Key={"reviewId": review["reviewId"]},
        UpdateExpression="SET jobStatus = :failed, errorMessage = :message, completedAt = :now",
        ExpressionAttributeValues={":failed": "FAILED", ":message": message, ":now": db.now_iso()},
    )
    release_lock(review["syllabusId"], review["reviewId"])


def _set_stage(review_id: str, stage: str) -> None:
    db.reviews_table().update_item(
        Key={"reviewId": review_id},
        UpdateExpression="SET stage = :stage",
        ExpressionAttributeValues={":stage": stage},
    )


def _claim(review_id: str) -> bool:
    try:
        db.reviews_table().update_item(
            Key={"reviewId": review_id},
            UpdateExpression="SET jobStatus = :running, startedAt = :now, stage = :stage",
            ConditionExpression="jobStatus = :queued",
            ExpressionAttributeValues={":running": "RUNNING", ":queued": "QUEUED", ":now": db.now_iso(), ":stage": STAGE_RETRIEVING},
        )
        return True
    except ClientError as exc:
        if _conditional_failed(exc):
            return False
        raise


def _collect_strings(value, out: list) -> None:
    if isinstance(value, str):
        out.append(value)
    elif isinstance(value, list):
        for item in value:
            _collect_strings(item, out)
    elif isinstance(value, dict):
        for item in value.values():
            _collect_strings(item, out)


def _replace_strings(value, replacements: iter):
    if isinstance(value, str):
        return next(replacements)
    if isinstance(value, list):
        return [_replace_strings(item, replacements) for item in value]
    if isinstance(value, dict):
        return {key: _replace_strings(item, replacements) for key, item in value.items()}
    return value


def _mask_output(model_strings: dict) -> dict:
    """Run the output guardrail over every model-written string (masks contact details, blocks harmful content)."""
    strings = []
    _collect_strings(model_strings, strings)
    masked = guardrails.mask_output_strings(strings)
    if masked is None:
        raise ContentBlocked("The revised syllabus was blocked by our content safety filters. Please review the syllabus and try again.")
    return _replace_strings(model_strings, iter(masked))


def process(review_id: str, spec) -> None:
    """Run one review. `spec` supplies retrieve(syllabus, text) -> sources and
    analyze(redacted_text, sources, syllabus) -> (model_output: dict, revised_text: str), plus
    build_results(model_output, sources) -> (results, summary)."""
    review = db.get_review(review_id)
    if not review or review.get("jobStatus") != "QUEUED" or not _claim(review_id):
        logger.info("Review %s is not queued; skipping (likely a duplicate delivery)", review_id)
        return

    try:
        syllabus = db.get_syllabus(review["syllabusId"])
        if not syllabus or db.is_expired(syllabus):
            raise ReviewFailed("This syllabus is no longer available.")
        entry = db.find_version(syllabus, review["inputVersion"])
        text = storage.get_text_or_none(entry["textKey"]) if entry else None
        if text is None:
            raise ReviewFailed("The version this review was based on is no longer available.")

        sources = spec.retrieve(syllabus, text)

        _set_stage(review_id, STAGE_ANALYZING)
        if guardrails.input_blocked(text):
            raise ContentBlocked("This syllabus contains content our safety filters block, so it can't be reviewed.")
        # The text was purged of personal details at upload, so the model only ever sees purged text.
        context = {"guidance": review.get("guidance") or "", "declined": review.get("declinedContext") or []}
        model_output = spec.analyze(text, sources, syllabus, context)

        _set_stage(review_id, STAGE_REWRITING)
        model_output = _mask_output(model_output)
        # Remove formatting the original never uses (em dashes, bold) from everything the model wrote.
        rules = style.rules_for(text)
        strings = []
        _collect_strings(model_output, strings)
        model_output = _replace_strings(model_output, iter([style.tidy(value, rules) for value in strings]))
        revised = (model_output.get("revisedSyllabus") or "").strip()
        if len(revised) < len(text) * MIN_REVISION_RATIO:
            raise ReviewFailed("The revised syllabus came back incomplete. Please run the review again.")
        results, summary = spec.build_results(model_output, sources)
        diff = line_diff(text, revised)
        pieces, all_hunks = proposals.build(diff)
        items = results[spec.SUGGESTIONS]
        per_item, unclaimed = proposals.assign(all_hunks, model_output.get(spec.SUGGESTIONS) or [], lambda item: item.get("excerpts"))
        for item, hunk_ids in zip(items, per_item):
            item["hunkIds"] = hunk_ids
        results.update({"diff": diff, "pieces": pieces, "hunks": all_hunks, "otherHunkIds": unclaimed})
        summary = {**summary, **stats(diff), "suggestions": len(items) + (1 if unclaimed else 0), "changes": len(all_hunks)}

        _set_stage(review_id, STAGE_SAVING)
        result_key = storage.results_key(syllabus["ownerId"], syllabus["syllabusId"], review_id)
        storage.put_text(result_key, json.dumps(results), content_type="application/json")

        now = db.now_iso()
        try:
            # The proposal waits for the faculty member's decisions; the working copy doesn't change yet.
            # A proposal with no changes needs no decisions.
            pending = "SET pendingReviewId = :review, updatedAt = :now" if all_hunks else "SET updatedAt = :now"
            db.syllabi_table().update_item(
                Key={"syllabusId": syllabus["syllabusId"]},
                UpdateExpression=f"{pending} REMOVE activeReviewId, activeReviewAt",
                ConditionExpression="currentVersion = :in AND activeReviewId = :review",
                ExpressionAttributeValues={":in": int(review["inputVersion"]), ":review": review_id, ":now": now},
            )
        except ClientError as exc:
            if _conditional_failed(exc):
                raise ReviewFailed("The syllabus changed while this review was running. Please run it again.") from exc
            raise

        decided = {} if all_hunks else {":decided": now}
        db.reviews_table().update_item(
            Key={"reviewId": review_id},
            UpdateExpression="SET jobStatus = :done, resultKey = :key, summary = :summary, completedAt = :now"
            + (", decidedAt = :decided" if decided else "") + " REMOVE stage",
            ExpressionAttributeValues={":done": "COMPLETED", ":key": result_key, ":summary": summary, ":now": now, **decided},
        )
        logger.info("Review %s completed with %s suggestions over %s changes", review_id, summary["suggestions"], len(all_hunks))
    except ReviewFailed as exc:
        logger.info("Review %s failed: %s", review_id, exc.user_message)
        fail(review, exc.user_message)
    except Exception:
        logger.exception("Review %s crashed", review_id)
        fail(review, "Something went wrong while reviewing this syllabus. Please run the review again.")


def handle_queue(event, spec) -> None:
    """SQS entry point for a worker (batch size 1). Failures are recorded on the review, never re-raised,
    so SQS only retries when the function itself crashes or times out."""
    for record in event.get("Records", []):
        process(json.loads(record["body"])["reviewId"], spec)


# ---------------------------------------------------------------- read and undo

def get_owned_review(review_id: str, owner_id: str) -> dict:
    review = db.get_review(review_id)
    if not review or review.get("ownerId") != owner_id:
        raise NotFound("Review not found.")
    if db.is_expired(review):
        raise Gone()
    return review


def view(review: dict) -> dict:
    """The review as the front end sees it, with results attached once it has completed."""
    summary = db.review_summary(review)
    if review.get("jobStatus") in ("QUEUED", "RUNNING") and _age_seconds(review["createdAt"]) > LOCK_STALE_SECONDS:
        summary["jobStatus"] = "FAILED"
        summary["errorMessage"] = "This review timed out. Please run it again."
    if review.get("jobStatus") == "COMPLETED" and review.get("resultKey"):
        raw = storage.get_text_or_none(review["resultKey"])
        if raw is None:
            raise Gone()
        summary["results"] = json.loads(raw)
    return summary


def undo(event):
    owner_id = auth.user_id(event)
    review = get_owned_review(path_param(event, "id"), owner_id)
    if review.get("jobStatus") != "COMPLETED" or review.get("undoneAt"):
        raise Conflict("Only a completed review that hasn't already been undone can be undone.", code="NOT_UNDOABLE")
    if review.get("outputVersion") is None:
        raise Conflict("This review didn't create a version, so there's nothing to undo.", code="NOT_UNDOABLE")
    syllabus = db.get_owned_syllabus(review["syllabusId"], owner_id)
    output_version = int(review["outputVersion"])
    if int(syllabus["currentVersion"]) != output_version:
        raise Conflict("Only the most recent review can be undone.", code="NOT_LATEST")
    if syllabus.get("approvalStatus") == "PENDING" and int(syllabus.get("submittedVersion", 0)) == output_version:
        raise Conflict("This version is waiting for admin approval, so it can't be undone.", code="SUBMITTED")
    if syllabus.get("approvedVersion") is not None and int(syllabus["approvedVersion"]) == output_version:
        # Undo would free this version number for the next review, which would then look already approved.
        raise Conflict("This version was approved into the shared library, so it can't be undone.", code="APPROVED")

    versions = syllabus["versions"]
    index = len(versions) - 1
    if int(versions[index]["n"]) != output_version:
        raise Conflict("Only the most recent review can be undone.", code="NOT_LATEST")
    try:
        db.syllabi_table().update_item(
            Key={"syllabusId": syllabus["syllabusId"]},
            UpdateExpression=f"SET currentVersion = :in, updatedAt = :now REMOVE versions[{index}]",
            ConditionExpression="currentVersion = :out AND size(versions) = :count AND attribute_not_exists(activeReviewId)",
            ExpressionAttributeValues={":in": int(review["inputVersion"]), ":out": output_version, ":count": len(versions), ":now": db.now_iso()},
        )
    except ClientError as exc:
        if _conditional_failed(exc):
            raise Conflict("The syllabus changed or a review is running. Refresh and try again.", code="NOT_LATEST") from exc
        raise
    db.reviews_table().update_item(
        Key={"reviewId": review["reviewId"]},
        UpdateExpression="SET undoneAt = :now",
        ExpressionAttributeValues={":now": db.now_iso()},
    )
    storage.delete(versions[index]["textKey"])
    return respond(200, db.syllabus_summary(db.get_syllabus(syllabus["syllabusId"])))


# ---------------------------------------------------------------- decisions

MAX_EDIT_CHARS = 20_000
SUGGESTION_LIST = {"COMPETENCY": "changes", "MODERNIZATION": "recommendations"}


def _suggestion_title(review_type: str, item: dict) -> str:
    return item.get("title") if review_type == "MODERNIZATION" else (item.get("change") or item.get("section") or "Change")


def _parse_decisions(body: dict, hunks_by_id: dict) -> dict:
    """{hunkId: text} for accepted hunks; a hunk that isn't listed, or is listed with accept false, is declined."""
    decisions = body.get("decisions")
    if not isinstance(decisions, list):
        raise BadRequest("decisions must be a list.")
    accepted, seen = {}, set()
    for decision in decisions:
        if not isinstance(decision, dict) or decision.get("hunkId") not in hunks_by_id:
            raise BadRequest("Each decision needs a hunkId from this review.")
        hunk_id = decision["hunkId"]
        if hunk_id in seen:
            raise BadRequest(f"{hunk_id} appears more than once.")
        seen.add(hunk_id)
        if not isinstance(decision.get("accept"), bool):
            raise BadRequest("accept must be true or false.")
        if not decision["accept"]:
            continue
        text = decision.get("text", hunks_by_id[hunk_id]["after"])
        if not isinstance(text, str) or len(text) > MAX_EDIT_CHARS:
            raise BadRequest(f"Edited text must be {MAX_EDIT_CHARS:,} characters or fewer.")
        accepted[hunk_id] = text.replace("\r\n", "\n").strip("\n") if text != hunks_by_id[hunk_id]["after"] else text
    return accepted


def decide(event):
    """POST /reviews/{id}/decisions  Body {decisions: [{hunkId, accept, text?}]}. Saves the accepted (and
    edited) changes as the next version, or, if none are accepted, closes the proposal with no new version."""
    owner_id = auth.user_id(event)
    review = get_owned_review(path_param(event, "id"), owner_id)
    if review.get("jobStatus") != "COMPLETED" or review.get("decidedAt") or review.get("undoneAt"):
        raise Conflict("These suggestions were already decided.", code="NOT_PENDING")
    syllabus = db.get_owned_syllabus(review["syllabusId"], owner_id)
    input_version = int(review["inputVersion"])
    if syllabus.get("pendingReviewId") != review["reviewId"] or int(syllabus["currentVersion"]) != input_version:
        raise Conflict("The syllabus changed since these suggestions were made. Run the review again.", code="STALE")

    results = json.loads(storage.get_text(review["resultKey"]))
    hunks_by_id = {h["id"]: h for h in results.get("hunks", [])}
    accepted = _parse_decisions(parse_json_body(event), hunks_by_id)

    edited = {hunk_id for hunk_id, text in accepted.items() if text != hunks_by_id[hunk_id]["after"]}
    for hunk_id in edited:
        if accepted[hunk_id].strip() and guardrails.input_blocked(accepted[hunk_id]):
            raise BadRequest("One of your edits contains content our safety filters block. Change it and save again.", code="CONTENT_BLOCKED")
        accepted[hunk_id] = pii.purge(accepted[hunk_id])

    items = results.get(SUGGESTION_LIST[review["reviewType"]], [])
    groups = [(_suggestion_title(review["reviewType"], item), item.get("reason") or item.get("rationale") or "", item.get("hunkIds", [])) for item in items]
    if results.get("otherHunkIds"):
        groups.append(("Other edits", "Edits not tied to a specific suggestion", results["otherHunkIds"]))
    accepted_groups = [{"title": title, "reason": reason, "edited": any(h in edited for h in ids)} for title, reason, ids in groups if ids and any(h in accepted for h in ids)]
    declined_titles = [title for title, _, ids in groups if ids and not any(h in accepted for h in ids) and title != "Other edits"]
    decision = {
        "changesAccepted": len(accepted),
        "changesDeclined": len(hunks_by_id) - len(accepted),
        "changesEdited": len(edited),
        "suggestionsAccepted": len(accepted_groups),
        "suggestionsDeclined": sum(1 for _, _, ids in groups if ids) - len(accepted_groups),
    }

    now = db.now_iso()
    output_version = None
    try:
        if accepted:
            output_version = input_version + 1
            text_key = storage.version_key(owner_id, syllabus["syllabusId"], review["reviewId"])
            storage.put_text(text_key, proposals.compose(results["pieces"], hunks_by_id, accepted))
            source = "COMPETENCY" if review["reviewType"] == "COMPETENCY" else "MODERNIZATION"
            db.syllabi_table().update_item(
                Key={"syllabusId": syllabus["syllabusId"]},
                UpdateExpression="SET currentVersion = :out, versions = list_append(versions, :entry), updatedAt = :now REMOVE pendingReviewId",
                ConditionExpression="currentVersion = :in AND pendingReviewId = :review",
                ExpressionAttributeValues={
                    ":out": output_version, ":in": input_version, ":review": review["reviewId"], ":now": now,
                    ":entry": [{"n": output_version, "textKey": text_key, "source": source, "reviewId": review["reviewId"], "createdAt": now}],
                },
            )
        else:
            db.syllabi_table().update_item(
                Key={"syllabusId": syllabus["syllabusId"]},
                UpdateExpression="SET updatedAt = :now REMOVE pendingReviewId",
                ConditionExpression="pendingReviewId = :review",
                ExpressionAttributeValues={":review": review["reviewId"], ":now": now},
            )
    except ClientError as exc:
        if _conditional_failed(exc):
            raise Conflict("The syllabus changed since these suggestions were made. Refresh and try again.", code="STALE") from exc
        raise

    values = {":now": now, ":decision": decision, ":groups": accepted_groups, ":decisions": [{"hunkId": h, "edited": h in edited} for h in accepted], ":declined": declined_titles}
    expression = "SET decidedAt = :now, decision = :decision, acceptedSuggestions = :groups, acceptedHunks = :decisions, declinedSuggestions = :declined"
    if output_version:
        expression += ", outputVersion = :out"
        values[":out"] = output_version
    updated = db.reviews_table().update_item(
        Key={"reviewId": review["reviewId"]}, UpdateExpression=expression, ExpressionAttributeValues=values, ReturnValues="ALL_NEW",
    )["Attributes"]
    logger.info("Review %s decided: %s", review["reviewId"], decision)
    return respond(200, {"syllabus": db.syllabus_summary(db.get_syllabus(syllabus["syllabusId"])), "review": db.review_summary(updated)})
