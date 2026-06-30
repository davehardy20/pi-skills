<!-- markdownlint-disable-file -->

# Avoiding vanilla tools: Eliminating known identifiers and canaries in red team operations

## Description
This framework explains how to find and remove default signatures, user agents, and behavioral indicators in common red team tools. Using default configurations is one of the quickest ways to get caught. This document provides practical steps to modify, hide, and replace these identifiers to blend in during an engagement.

## Subject Matter Details

### Prerequisites
- Written authorization for the engagement.
- Familiarity with Nmap, Metasploit, and similar tools.
- Understanding of HTTP headers and packet structure.
- A lab environment for testing modified tools before use.

### Procedures

#### Checking for tool leaks
You have to know what your tools are saying before you use them.
1. **Capture local traffic**: Run your tool against a local listener or a proxy.
2. **Analyze headers**: Look for default `User-Agent`, `Server`, or custom headers that shouldn't be there.
3. **Inspect payloads**: Check the sent data for unique strings or byte patterns.

#### Hardening network scanners (Nmap, Masscan)
Scanners are often detected by timing and packet structure.
1. **Change User-Agent in Nmap scripts**:
   - Many Nmap NSE scripts use the default: `Mozilla/5.0 (compatible; Nmap Scripting Engine; https://nmap.org/book/nse.html)`.
   - Use `--script-args http.useragent="[CUSTOM_UA]"` to change it.
2. **Randomize packets**:
   - Add random data with `--data-length`.
   - Use `--randomize-hosts` and `--top-ports` to break up sequential patterns.
3. **Spoof source ports**:
   - Use `-g 53` or `--source-port 443` to make traffic look like DNS or HTTPS.

#### Obfuscating web scanners (Nikto, SQLMap, WPScan)
Web scanners are loud.
1. **Nikto evasion**: Use `-evasion` flags like `-evasion 1` for random URI encoding.
2. **SQLMap custom settings**:
   - Use `--user-agent="[VALID_UA]"` or `--random-agent`.
   - Use `--tamper` scripts like `base64encode` or `space2comment` to change payloads.
3. **WPScan cleanup**: Always use `--user-agent` to strip the default `WPScan v[version]` string.

#### Customizing command-line tools (curl, wget, python)
Utilities often have obvious default headers.
1. **Curl and Wget**: Always set a browser-like User-Agent. For example: `curl -A "Mozilla/5.0..."`.
2. **Python Requests**: By default, this library sends `User-Agent: python-requests/2.x.x`. Set a custom header in your session.

#### Remote access and C2 (Cobalt Strike, Metasploit)
C2 traffic is the most sensitive part of an operation.
1. **Cobalt Strike malleable C2**: Use custom profiles to define headers, URIs, and timing.
2. **Metasploit Meterpreter**: Set the `HttpUserAgent` option in listeners and payloads.
3. **Encryption**: Use real SSL/TLS certificates. Default self-signed ones are an immediate red flag.

### Code examples

#### Overriding default user agents
```bash
# Nmap with a custom User-Agent for NSE scripts
nmap -p80 --script http-enum --script-args http.useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" <target>

# SQLMap using a random browser agent and tamper script
sqlmap -u "http://target.com/id=1" --random-agent --tamper=space2comment

# Curl mimicking Microsoft Edge
curl -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0" http://target.com
```

#### Checking for leaks with a Python listener
```python
from http.server import BaseHTTPRequestHandler, HTTPServer

class RequestHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        print(f"\n--- Request from {self.client_address} ---")
        print(self.headers)
        self.send_response(200)
        self.end_headers()

def run(port=8080):
    server_address = ('', port)
    httpd = HTTPServer(server_address, RequestHandler)
    print(f"Starting listener on port {port}...")
    httpd.serve_forever()

if __name__ == "__main__":
    run()
```

## Detection avoidance / OpSec considerations
- **Detection vectors**: Default User-Agent strings, predictable timing (Nmap T4/T5), known NSE script signatures, and default SSL certificates.
- **Evasion techniques**: Header manipulation, packet fragmentation, timing jitter, and traffic redirection through services like CDNs (Domain Fronting).
- **Alternative approaches**: Use Living off the Land Binaries (LOLBAS) like `bitsadmin` or `certutil` instead of `wget` or `curl`.
- **Timing**: Run heavy scans during maintenance windows or off-hours. Use slower timing profiles for initial recon.
- **Artifact cleanup**: Clear your command history and delete temporary scripts. If you have access, check target logs to make sure no tool names were recorded.

## OpSec execution checklist
### Pre-execution verification
- [ ] Tool signature checked against local listener
- [ ] User-Agent updated to match a common browser in the target environment
- [ ] Timing profile selected (avoid T4/T5 for stealth)
- [ ] SSL certificates verified (no default Metasploit/Cobalt Strike certs)

### During execution
- [ ] Traffic monitored for unexpected headers
- [ ] Scan rate adjusted based on WAF/IDS response
- [ ] Proxies or redirectors confirmed

### OpSec verification
- [ ] Tool version strings removed from headers
- [ ] Custom URI paths used in C2 traffic
- [ ] Behavioral jitter applied to periodic callbacks

### Post-execution
- [ ] Artifacts cleaned up
- [ ] Logs reviewed for detection indicators
- [ ] Timeline documented in OPLOG
- [ ] Effectiveness assessed
- [ ] OPLOG updated
- [ ] Document history updated

## References
### Internal sources
- Tradecraft Wiki: C2 Infrastructure Hardening
- Previous Engagement Report: "Detection of default Nikto signatures"

### External sources
- [Nmap Documentation: Evasion and Spoofing](https://nmap.org/book/man-bypass-firewalls-ids.html)
- [Cobalt Strike Malleable C2 Profiles](https://www.cobaltstrike.com/blog/malleable-c2-profiles/)
- [YouTube: Avoiding Vanilla Tool Detection](https://www.youtube.com/watch?v=AHwfV3NFlno)

### Tools used
- Nmap, SQLMap, Nikto, Cobalt Strike, Burp Suite

### Script references
- `scripts/python/leak_check.py` (referenced by source sample; not bundled)
- `scripts/bash/stealth_scan.sh` (referenced by source sample; not bundled)

## Document history
| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-20 | Antigravity | Initial creation |
