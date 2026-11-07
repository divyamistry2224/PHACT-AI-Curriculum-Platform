"""Errors raised inside a review run. The message is shown to the faculty member, so keep it plain and actionable."""


class ReviewFailed(Exception):
    def __init__(self, user_message: str):
        super().__init__(user_message)
        self.user_message = user_message


class ContentBlocked(ReviewFailed):
    """The guardrail blocked the syllabus or the model's output."""
