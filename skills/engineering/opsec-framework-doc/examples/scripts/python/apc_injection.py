# OPSEC_WARNING: This reference is for authorized testing documentation only
# AUTHORIZATION_REQUIRED: Use only with explicit written permission
# TARGET_SCOPE: Isolated lab documentation only - never production
# CLEANUP: No system changes are performed by this reference module
# VERSION: 1.1
# TECHNIQUE: T1055.004 Process Injection: Asynchronous Procedure Call
# CREATED: 2026-02-15
# AUTHOR: OpSec Documentation Team
"""
Non-executing APC injection documentation reference.

This file is intentionally de-executableized: it does not import ctypes, call
Windows APIs, allocate memory, write process memory, queue APCs, or resume
threads. It exists so the Pi skill has a realistic script-reference artifact
for documentation extraction without bundling runnable process-injection code.

WARNING: For authorized security testing documentation only.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass
from typing import Literal

TECHNIQUE_ID = "T1055.004"
TECHNIQUE_NAME = "Process Injection: Asynchronous Procedure Call"
DEFAULT_TARGET = r"C:\Windows\System32\notepad.exe"


@dataclass(frozen=True)
class TechniqueStep:
    """One documentation-only APC injection phase."""

    order: int
    api_or_action: str
    purpose: str
    opsec_note: str


@dataclass(frozen=True)
class TechniqueReference:
    """Safe, non-executing technique summary for documentation."""

    technique_id: str
    technique_name: str
    target_example: str
    safety_model: str
    steps: list[TechniqueStep]
    detection_notes: list[str]
    cleanup_notes: list[str]


def build_reference(target_example: str = DEFAULT_TARGET) -> TechniqueReference:
    """Build a static APC-injection reference without performing system calls."""

    return TechniqueReference(
        technique_id=TECHNIQUE_ID,
        technique_name=TECHNIQUE_NAME,
        target_example=target_example,
        safety_model=(
            "documentation-only reference; no Windows API calls, no payload handling, "
            "and no process mutation"
        ),
        steps=[
            TechniqueStep(
                1,
                "CreateProcessW with CREATE_SUSPENDED",
                "Describe creation of a suspended lab process for technique sequencing.",
                "Suspended process creation can be logged as Windows Event ID 4688.",
            ),
            TechniqueStep(
                2,
                "VirtualAllocEx",
                "Describe remote allocation in the target process address space.",
                "RWX memory allocation is high-signal and should be avoided in production systems.",
            ),
            TechniqueStep(
                3,
                "WriteProcessMemory",
                "Describe writing benign test bytes into the allocated region.",
                "Cross-process memory writes are commonly monitored by EDR products.",
            ),
            TechniqueStep(
                4,
                "QueueUserAPC",
                "Describe queuing an APC callback for a suspended thread.",
                "APC routines pointing to private memory are suspicious.",
            ),
            TechniqueStep(
                5,
                "ResumeThread",
                "Describe resuming the suspended thread to complete the sequence.",
                "Thread resumption after injection-style setup can trigger behavioral alerts.",
            ),
        ],
        detection_notes=[
            "Windows process creation telemetry may show unusual parent/child relationships.",
            "Sysmon Event ID 8 or 10 may appear depending on configuration.",
            "ETW providers and EDR memory scanners may flag the API sequence.",
        ],
        cleanup_notes=[
            "Terminate lab-only spawned processes after testing.",
            "Record timestamps, target host, and operator in the OPLOG.",
            "Preserve detections and telemetry for purple-team review.",
        ],
    )


def render_markdown(reference: TechniqueReference) -> str:
    """Render the reference as Markdown for inclusion in an OpSec guide."""

    lines = [
        f"# {reference.technique_id} {reference.technique_name}",
        "",
        f"**Target example:** `{reference.target_example}`",
        f"**Safety model:** {reference.safety_model}",
        "",
        "## Technique sequence",
        "",
    ]

    for step in reference.steps:
        lines.extend(
            [
                f"{step.order}. **{step.api_or_action}**",
                f"   - Purpose: {step.purpose}",
                f"   - OpSec note: {step.opsec_note}",
            ],
        )

    lines.extend(["", "## Detection notes", ""])
    lines.extend(f"- {note}" for note in reference.detection_notes)
    lines.extend(["", "## Cleanup notes", ""])
    lines.extend(f"- {note}" for note in reference.cleanup_notes)
    return "\n".join(lines) + "\n"


def parse_args(argv: list[str]) -> argparse.Namespace:
    """Parse documentation-rendering options."""

    parser = argparse.ArgumentParser(
        description="Render a non-executing APC injection documentation reference.",
        epilog="No process injection or Windows API calls are performed.",
    )
    parser.add_argument(
        "--target-example",
        default=DEFAULT_TARGET,
        help="Lab process path to show in documentation examples.",
    )
    parser.add_argument(
        "--format",
        choices=("markdown", "json"),
        default="markdown",
        help="Output format for the documentation reference.",
    )
    parser.add_argument(
        "--confirm-authorized-lab",
        action="store_true",
        help="Acknowledge the reference is for an authorized lab documentation context.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """Render the documentation reference and return a process exit code."""

    args = parse_args(sys.argv[1:] if argv is None else argv)
    if not args.confirm_authorized_lab:
        print(
            "Refusing to render until --confirm-authorized-lab is supplied.",
            file=sys.stderr,
        )
        return 2

    reference = build_reference(args.target_example)
    output_format: Literal["markdown", "json"] = args.format
    if output_format == "json":
        print(json.dumps(asdict(reference), indent=2))
    else:
        print(render_markdown(reference), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
