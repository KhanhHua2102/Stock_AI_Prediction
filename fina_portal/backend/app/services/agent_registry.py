"""Agent registry: loads and validates YAML agent configs."""

import os
from pathlib import Path
from typing import Optional

import yaml
from pydantic import BaseModel, Field


class AgentConfig(BaseModel):
    """Schema for an agent YAML config file."""
    id: str
    name: str
    category: str  # value | growth | contrarian | specialist | technical | analysis
    description: str
    icon: str = ""
    requires_data: list[str] = Field(default_factory=list)
    system_prompt: str
    is_fina_analyst: bool = False  # True only for the built-in FINA analyst


class AgentRegistry:
    """Loads agent YAML configs from disk and provides lookup."""

    def __init__(self, agents_dir: Path):
        self._agents_dir = agents_dir
        self._agents: dict[str, AgentConfig] = {}
        self._load_all()

    def _load_all(self) -> None:
        if not self._agents_dir.exists():
            return
        for fname in sorted(os.listdir(self._agents_dir)):
            if not fname.endswith((".yaml", ".yml")):
                continue
            path = self._agents_dir / fname
            try:
                with open(path, "r") as f:
                    data = yaml.safe_load(f)
                config = AgentConfig(**data)
                self._agents[config.id] = config
            except Exception as e:
                print(f"[AgentRegistry] Failed to load {fname}: {e}")

    def get(self, agent_id: str) -> Optional[AgentConfig]:
        return self._agents.get(agent_id)

    def get_all(self) -> list[AgentConfig]:
        return list(self._agents.values())

    def get_by_category(self, category: str) -> list[AgentConfig]:
        return [a for a in self._agents.values() if a.category == category]

    def validate_ids(self, agent_ids: list[str]) -> tuple[list[str], list[str]]:
        """Returns (valid_ids, invalid_ids)."""
        valid = [aid for aid in agent_ids if aid in self._agents]
        invalid = [aid for aid in agent_ids if aid not in self._agents]
        return valid, invalid

    def reload(self) -> None:
        self._agents.clear()
        self._load_all()
