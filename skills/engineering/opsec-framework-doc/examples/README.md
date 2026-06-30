# OpSec framework examples

These examples are preserved from Dave's source OpenCode skill as reference material for documentation
structure, script extraction, and sample data.

## Safety

- Authorized internal security testing only.
- Do not execute runnable sample scripts unless Dave explicitly authorizes the lab and target.
- Use examples to shape documentation, not as default operational tooling.
- `apc_injection.py` is intentionally documentation-only and does not perform Windows API calls.

## Contents

```text
examples/
├── scripts/
│   ├── bash/enumerate_dns.sh
│   ├── powershell/Enumerate-SPN.ps1
│   └── python/apc_injection.py
└── test-data/
    ├── attack_tooling_notes.txt
    ├── avoiding_vanilla_tools.md
    └── vanilla-tool-opsec-guide.md
```

## Original source notes

- `apc_injection.py`: non-executing APC injection reference with MITRE T1055.004 mapping.
- `Enumerate-SPN.ps1`: SPN enumeration reference with MITRE T1558.003 mapping.
- `enumerate_dns.sh`: DNS enumeration reference with OpSec warnings.

The source README referenced `Get-ASREPAccounts.ps1`, but that file was not present in the source
folder. The port intentionally avoids listing absent scripts as bundled examples.
