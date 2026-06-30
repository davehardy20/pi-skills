# Script management

When a document contains code blocks, decide whether each block is illustrative, a command snippet,
or a reusable script. Reusable scripts should be extracted into standalone files.

## Non-execution default

Validation defaults to syntax and static review. Do not execute offensive or environment-changing
scripts unless Dave explicitly authorizes the lab, target, and expected effect.

## Extraction process

For each reusable code block:

1. Identify language, purpose, dependencies, parameters, output, and OpSec considerations.
2. Name the file descriptively, for example `enumerate-spn.ps1` or `enumerate_dns.sh`.
3. Place it under `scripts/{language}/` in the deliverable documentation repository.
4. Add a header with purpose, author/team, date, version, MITRE mapping when relevant, OpSec notes,
   and an authorized-use warning.
5. Keep comments that explain non-obvious operations and detection trade-offs.
6. Create or update `scripts/README.md`.
7. Create dependency files such as `requirements.txt`, `package.json`, or `Gemfile` only when needed.
8. Validate syntax and record results.

## Script README contents

A script collection README should include:

- overview and authorization warning;
- table of scripts;
- purpose, language, usage, parameters, output, and OpSec notes for each script;
- installation and dependency notes;
- safe testing environments;
- validation commands;
- version history.

## Header standard

Python example:

```python
#!/usr/bin/env python3
"""
Script Name: descriptive_name.py
Purpose: Brief description of functionality
Author: OpSec Documentation Team
Date: YYYY-MM-DD
Version: 1.0
MITRE ATT&CK: T0000.000

OpSec Considerations:
- Detection vectors to be aware of
- Safe usage guidelines
- Cleanup requirements

WARNING: For authorized security testing only.
"""
```

## OpSec comments

Use inline comments for detection-relevant operations:

```python
# OpSec: This query can generate Windows Event ID 4662.
# OpSec: Use from a host approved for this assessment.
# OpSec: Remove temporary artifacts after execution.
```

## Validation commands

Use the narrowest safe check:

```bash
python -m py_compile scripts/python/*.py
bash -n scripts/bash/*.sh
```

PowerShell parse check:

```powershell
$null = [System.Management.Automation.PSParser]::Tokenize(
  (Get-Content .\script.ps1),
  [ref]$null
)
```

## Dependency guidance

- Prefer standard libraries for portability and lower operational noise.
- Document optional dependencies separately from required dependencies.
- Avoid hardcoded credentials, tenant IDs, keys, domains, and target-specific values.
- Include cleanup and artifact notes for every script that writes files or changes state.

## Bundled examples

The examples under `../examples/scripts/` are preserved from the source OpenCode skill for reference.
They are not invoked by this skill and should be copied into a target deliverable only when relevant.
