"""How one agent is run. `StrandsRunner` is the real one; tests pass a scripted runner."""

from __future__ import annotations

from typing import Callable, Protocol, TypeVar

from pydantic import BaseModel

from .config import Settings

T = TypeVar("T", bound=BaseModel)


class AgentOutputError(RuntimeError):
    pass


class AgentRunner(Protocol):
    async def run(
        self,
        *,
        name: str,
        system_prompt: str,
        prompt: str,
        tools: list[Callable[[str], str]],
        output_model: type[T],
        max_tokens: int,
        model_id: str | None = None,
    ) -> T: ...


class StrandsRunner:
    """Runs a Strands agent on Bedrock (Converse) with structured output."""

    def __init__(self, settings: Settings):
        self.settings = settings

    async def run(self, *, name, system_prompt, prompt, tools, output_model, max_tokens, model_id=None):
        from botocore.config import Config
        from strands import Agent, tool
        from strands.models import BedrockModel

        model = BedrockModel(
            model_id=model_id or self.settings.model_id,
            region_name=self.settings.region,
            max_tokens=max_tokens,
            temperature=0.2,
            boto_client_config=Config(read_timeout=300, retries={"max_attempts": 3, "mode": "adaptive"}),
        )
        agent = Agent(
            name=name,
            model=model,
            system_prompt=system_prompt,
            tools=[tool(name=fn.__name__, description=fn.__doc__)(fn) for fn in tools],
            callback_handler=None,
        )
        result = await agent.invoke_async(prompt, structured_output_model=output_model)
        if result.structured_output is None:
            raise AgentOutputError(f"{name} returned no structured output (stop reason: {result.stop_reason})")
        return result.structured_output
