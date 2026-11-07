"""Bedrock AgentCore entrypoint for the PHACT analysis runtime.

Deploy with the starter toolkit (direct code deploy, no Docker):
    agentcore configure -e agentcore_app.py
    agentcore launch --env COMPETENCY_KB_ID=... --env SYLLABUS_KB_ID=... --env MODEL_ID=...
"""

import logging

from bedrock_agentcore.runtime import BedrockAgentCoreApp

from phact_agents.config import Settings
from phact_agents.service import PayloadError, handle

logging.basicConfig(level=logging.INFO)

app = BedrockAgentCoreApp()
settings = Settings.from_env()


@app.entrypoint
async def invoke(payload: dict) -> dict:
    try:
        return await handle(payload or {}, settings)
    except PayloadError as error:
        return {"status": "FAILED", "error": str(error)}


if __name__ == "__main__":
    app.run()
