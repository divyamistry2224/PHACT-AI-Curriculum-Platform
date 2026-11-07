"""Shared AWS clients, created once per Lambda container. Tests replace them through these module globals."""

import boto3
import os
from botocore.config import Config

_clients = {}

# Model calls can run for minutes. The read timeout stays below the worker's 10-minute Lambda timeout,
# and adaptive retries back off when Bedrock throttles.
_BEDROCK_CONFIG = Config(read_timeout=540, connect_timeout=10, retries={"max_attempts": 4, "mode": "adaptive"})
_AGENTCORE_CONFIG = Config(read_timeout=540, connect_timeout=10, retries={"total_max_attempts": 1})
_DEFAULT_CONFIG = Config(retries={"max_attempts": 5, "mode": "standard"})


def client(name: str):
    if name not in _clients:
        config = (_AGENTCORE_CONFIG if name == "bedrock-agentcore" else
                  _BEDROCK_CONFIG if name == "bedrock-runtime" else _DEFAULT_CONFIG)
        options = {}
        if name == "bedrock-agentcore":
            arn = os.environ.get("AGENTCORE_RUNTIME_ARN", "").split(":")
            if len(arn) >= 6 and arn[0] == "arn":
                options["region_name"] = arn[3]
        _clients[name] = boto3.client(name, config=config, **options)
    return _clients[name]


def set_client(name: str, value) -> None:
    """Install a replacement client (used by tests)."""
    _clients[name] = value


def reset() -> None:
    _clients.clear()
