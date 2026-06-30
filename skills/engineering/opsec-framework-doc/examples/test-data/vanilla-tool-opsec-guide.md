# Ditching Vanilla: Tool Signatures and OpSec

**Classification:** Internal Use Only  
**Framework:** OpSec Procedures  
**Last Updated:** 2026-02-15  
**Author:** Red Team Operations

---

## Description

Running unmodified tools is a liability. If you're using "vanilla" configurations, you're handing the blue team easy Indicators of Compromise (IoCs) and getting the engagement burned early. This doesn't just end the operation; it provides low-quality data for the client.

Default tools leak identity through user agents, network handshakes, syntax, and timing. To stay effective, we have to customize everything to blend with legitimate traffic and bypass signature-based detection.

---

## Technical Details

### The fingerprints we leave behind

Public tools have distinct markers that security teams use for easy wins:

**1. User-agent strings**
Most tools scream their identity in HTTP headers:

- **curl**: `curl/7.68.0`
- **wget**: `Wget/1.20.3 (linux-gnu)`
- **Python requests**: `python-requests/2.28.1`
- **Kali Linux**: Standardized user agents across the distro
- **Nmap**: Specific NSE probe strings
- **WPScan**: `WPScan v3.8.12`

These headers trigger instant alerts in SIEMs and WAFs. If it doesn't look like a browser, it's a target.

**2. Network behavior**

Traffic patterns often reveal the tool behind them:
- **Cobalt Strike**: Default Malleable C2 profiles have well-documented JA3/TLS fingerprints.
- **Metasploit**: Known payload encoding and stager sequences.
- **Mythic**: Characteristic agent communication flows.
- **Empire**: Static HTTP POST body structures.

**3. Binary artifacts**

Compiled payloads are full of metadata:
- PE headers with hardcoded compiler timestamps.
- PDB (Program Database) paths revealing your local build environment.
- Resource sections and version info.
- Import tables showing specific DLL/function calls.
- Standard section names like `.text`, `.rsrc`, and `.reloc`.

**4. Timing and cadence**

Automation usually looks robotic:
- Rapid-fire requests without human-like pauses.
- Perfect intervals between beacons or actions.
- Responses that are too fast for a human operator.

### Prerequisites

- Solid grasp of HTTP headers and network protocols.
- Access to tool source or config files.
- Awareness of the target's baseline traffic.
- Ability to test modifications in a lab before going live.

### Customization Procedures

#### Phase 1: User-Agent modification

**Curl:**
```bash
# Default behavior - detectable
curl http://target.com

# Customized - blends with legitimate browser traffic
curl -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" http://target.com

# Rotation via script
#!/bin/bash
USER_AGENTS=(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"
)
UA=${USER_AGENTS[$RANDOM % ${#USER_AGENTS[@]}]}
curl -A "$UA" http://target.com
```

**Wget:**
```bash
# Modify ~/.wgetrc or use command-line
wget --user-agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64)" http://target.com
```

**Python Requests:**
```python
import requests

# Default - easily detected
# requests.get('http://target.com')

# Customized headers
headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate',
    'Connection': 'keep-alive',
}
response = requests.get('http://target.com', headers=headers)
```

**PowerShell:**
```powershell
# Default Invoke-WebRequest with signatured patterns
# Invoke-WebRequest -Uri "http://target.com"

# Customized with legitimate browser profile
$headers = @{
    "User-Agent" = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    "Accept" = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    "Accept-Language" = "en-US,en;q=0.5"
}
Invoke-WebRequest -Uri "http://target.com" -Headers $headers
```

#### Phase 2: Network behavior modification

**Nmap Evasion:**
```bash
# Default scan - easily fingerprinted
# nmap -sV target.com

# Customized scan with timing adjustments
nmap -sV --randomize-hosts --max-retries 1 --max-rtt-timeout 500ms \
     --initial-rtt-timeout 200ms --max-scan-delay 10s target.com

# Decoy scanning to obscure source
nmap -sS -D RND:10 target.com

# Custom MTU to fragment packets
nmap --mtu 24 target.com
```

**WPScan Stealth:**
```bash
# Default - announces WPScan version
# wpscan --url http://target.com

# Modified with custom user agent and throttling
wpscan --url http://target.com \
       --user-agent "Mozilla/5.0 (compatible; Googlebot/2.1)" \
       --throttle 1000 \
       --random-user-agent
```

#### Phase 3: C2 infrastructure customization

**Cobalt Strike Malleable C2 Profile:**
```
# Custom profile to blend with legitimate traffic
# Reference: https://github.com/RedSiege/C2concealer

http-get {
    set uri "/api/v1/updates/check";
    
    client {
        header "Accept" "application/json, text/plain, */*";
        header "Accept-Language" "en-US,en;q=0.9";
        header "Accept-Encoding" "gzip, deflate, br";
        header "Connection" "keep-alive";
        
        metadata {
            base64url;
            prepend "session_id=";
            header "Cookie";
        }
    }
    
    server {
        header "Content-Type" "application/json";
        header "Server" "nginx/1.18.0";
        
        output {
            base64;
            prepend "{\"status\":\"ok\",\"data\":\"";
            append "\"}";
            print;
        }
    }
}
```

**Mythic Agent Customization:**
```python
# Customizing Mythic Apollo agent
# Reference: https://docs.mythic-c2.net/customizing/payload-type-development

class CustomAgent:
    def __init__(self):
        # Modify default sleep intervals with jitter
        self.sleep = 60  # Base sleep
        self.jitter = 0.3  # 30% variance
        
        # Custom User-Agent
        self.user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        
        # Randomized URI paths
        self.uris = [
            "/api/status",
            "/api/check",
            "/updates/version"
        ]
    
    def get_sleep_time(self):
        # Implement jitter to avoid predictable patterns
        import random
        jitter_amount = self.sleep * self.jitter
        return self.sleep + random.uniform(-jitter_amount, jitter_amount)
```

#### Phase 4: Binary artifact modification

**Removing PDB paths:**
```c
// In Visual Studio project settings
// C/C++ -> Output Files -> Program Database File Name
// Set to: $(IntDir)vc$(PlatformToolsetVersion).pdb

// Or use strip utility on Linux
strip --strip-debug ./payload
strip --strip-all ./payload
```

**Modifying PE headers:**
```python
# Using pefile library to modify binary metadata
import pefile
import datetime

pe = pefile.PE('payload.exe')

# Modify compile timestamp
pe.FILE_HEADER.TimeDateStamp = int(datetime.datetime(2020, 1, 1).timestamp())

# Modify version info (if present)
if hasattr(pe, 'VS_VERSIONINFO'):
    for entry in pe.VS_VERSIONINFO:
        if hasattr(entry, 'StringTable'):
            for st in entry.StringTable:
                # Modify company name, product name, etc.
                st.entries[b'CompanyName'] = b'Legitimate Software Corp'
                st.entries[b'ProductName'] = b'Productivity Suite'

pe.write('payload_modified.exe')
```

#### Phase 5: Behavior customization

**Adding human-like delays:**
```python
import random
import time

def human_delay():
    """Add random delays to simulate human behavior"""
    # Random delay between 0.5 and 3 seconds
    delay = random.uniform(0.5, 3.0)
    time.sleep(delay)

def variable_sleep(base_seconds, jitter_percent=0.3):
    """Implement jitter in sleep intervals"""
    jitter = base_seconds * jitter_percent
    sleep_time = base_seconds + random.uniform(-jitter, jitter)
    time.sleep(max(0, sleep_time))

# Usage in operations
for target in targets:
    scan_target(target)
    human_delay()  # Random delay between operations
```

**Randomizing command order:**
```python
import random

def randomize_execution(commands):
    """Randomize the order of non-dependent commands"""
    shuffled = commands.copy()
    random.shuffle(shuffled)
    return shuffled

# Example: Reconnaissance commands
recon_commands = [
    lambda: enumerate_users(),
    lambda: check_shares(),
    lambda: query_dns(),
    lambda: scan_ports(),
]

for cmd in randomize_execution(recon_commands):
    cmd()
    human_delay()
```

---

## Detection and OpSec

### Common detection vectors

1. **Signatures**
   - AV/EDR flags on known tool strings.
   - IDS/IPS matches for standard tool traffic.
   - WAF blocks on generic user agents.

2. **Behavioral**
   - Spikes in request rates or robotic timing.
   - Inconsistent or missing HTTP headers.
   - Traffic patterns (unusual sizes or destinations).

3. **Heuristics**
   - Too many rapid network connections.
   - Payload entropy checks.
   - Process behavior that doesn't match the binary's name.

4. **Canaries**
   - Honeytokens in tools.
   - Flagged IPs or domains.
   - Fake credentials designed to trigger alerts.

### Evasion strategies

| Detection Type | Evasion Method |
|----------------|----------------|
| User-Agent Filtering | Rotate legitimate browser strings |
| Signature Matching | Encrypt payloads, strip binary metadata |
| Timing Analysis | Use jitter and random delays |
| Behavioral Analysis | Mimic real application traffic |
| Network Monitoring | Use redirectors or domain fronting |
| File Hash Detection | Recompile often, use custom packers |

### Timing and cleanup

- **Don't**: Send rapid-fire requests that no human could type.
- **Do**: Use random delays (0.5 to 5 seconds) between actions.
- **Match**: Work during the target's business hours.
- **Vary**: Never use static sleep intervals (e.g., exactly 60 seconds).

**Cleanup commands:**

```bash
# Wipe shell history
history -c && rm ~/.bash_history

# Wipe PowerShell history
Clear-History
Remove-Item (Get-PSReadlineOption).HistorySavePath

# Shred temporary payloads
shred -vfz -n 3 /tmp/payload* 2>/dev/null
```

---

## Best Practices

1. **Test first**: Lab everything before you touch the target.
2. **Baseline**: Compare your traffic to the target's normal application logs.
3. **Small steps**: Change one thing at a time so you know what works.
4. **Log everything**: Keep internal records of what you modified.
5. **Rotate**: Change user agents and infra regularly.
6. **Watch for traps**: Be paranoid about honeytokens and canary files.

---

## Risk Assessment

| Tool State | Detection Risk | Mitigation |
|------------|----------------|------------|
| Vanilla | High | Never use on an engagement |
| Basic Mods | Medium | Combine multiple techniques |
| Customized | Low | Stay disciplined with timing |
| Custom Dev | Very Low | High dev cost, but highest success |

---

## References

### Internal
- Tool notes: `/Users/dave/Documents/tradecraft_opsec_framework/writing/attack_tooling_opsec_considerations/attack_tooling_notes.txt`
- Tmux OpSec: `/Users/dave/Documents/tradecraft_opsec_framework/writing/tmux-attack-host-logging-opsec.md`
- Kerberoasting: `/Users/dave/Documents/tradecraft_opsec_framework/writing/kerberoasting-opsec-guide.md`

### External
- Michael Allen (BHIS) - "OPSEC Fundamentals for Remote Red Teams"
- Red Canary - "Disable or Modify Tools" report
- Cody Thomas (SpecterOps) - "Agent Customization in Mythic"

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-15 | Red Team Operations | Initial doc: signature OpSec, UA modification, and customization. |

---

## Notes

**Warning:** This is for authorized red team use only. All techniques must be:
- Part of a signed engagement.
- Within the defined Rules of Engagement (ROE).
- Properly authorized by the client.

**Checklist:**
- [ ] Signed ROE in hand.
- [ ] Scope clearly defined.
- [ ] Emergency contacts ready.
- [ ] Mods tested in the lab.
- [ ] Team sync'd on the plan.
