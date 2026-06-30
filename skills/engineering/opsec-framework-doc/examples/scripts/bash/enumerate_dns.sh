#!/bin/bash

# Script Name: enumerate_dns.sh
# Purpose: DNS enumeration for subdomain discovery
# Author: OpSec Documentation Team
# Date: 2026-02-15
# Version: 1.0
#
# OpSec Considerations:
# - High volume DNS queries may trigger monitoring
# - Use DNS resolvers that support rotation
# - Consider timing delays between queries
# - Use legitimate DNS servers to blend in
# - DNS logs may reveal reconnaissance activity
#
# WARNING: For authorized security testing only.
#          Use only on domains you have permission to test.

set -euo pipefail

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default values
THREADS=10
TIMEOUT=2
WORDLIST=""
DOMAIN=""
OUTPUT=""
RESOLVERS=("8.8.8.8" "1.1.1.1" "9.9.9.9")

# Function to display usage
usage() {
    echo "DNS Enumeration Tool - FOR AUTHORIZED TESTING ONLY"
    echo ""
    echo "Usage: $0 -d <domain> -w <wordlist> [options]"
    echo ""
    echo "Required:"
    echo "  -d, --domain      Target domain to enumerate"
    echo "  -w, --wordlist    Path to subdomain wordlist"
    echo ""
    echo "Options:"
    echo "  -t, --threads     Number of parallel threads (default: 10)"
    echo "  -o, --output      Output file for results"
    echo "  --timeout         DNS query timeout in seconds (default: 2)"
    echo "  --resolver        Specific DNS resolver to use"
    echo "  -h, --help        Display this help message"
    echo ""
    echo "Examples:"
    echo "  $0 -d example.com -w /usr/share/wordlists/dns.txt"
    echo "  $0 -d example.com -w wordlist.txt -t 20 -o results.txt"
    echo ""
    echo "OpSec Notes:"
    echo "  - High query rates may trigger rate limiting or alerts"
    echo "  - Consider using delays between batches"
    echo "  - Use legitimate DNS servers to blend in"
}

# Function to check dependencies
check_dependencies() {
    local deps=("dig" "host" "parallel")
    local missing=()
    
    for dep in "${deps[@]}"; do
        if ! command -v "$dep" &> /dev/null; then
            missing+=("$dep")
        fi
    done
    
    if [ ${#missing[@]} -ne 0 ]; then
        echo -e "${RED}[!] Missing dependencies: ${missing[*]}${NC}"
        echo "[*] Install with: sudo apt-get install dnsutils parallel"
        exit 1
    fi
}

# Function to validate domain
validate_domain() {
    local domain="$1"
    if [[ ! "$domain" =~ ^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$ ]]; then
        echo -e "${RED}[!] Invalid domain format: $domain${NC}"
        exit 1
    fi
}

# Function to test single subdomain
test_subdomain() {
    local subdomain="$1"
    local domain="$2"
    local resolver="$3"
    local full_domain="${subdomain}.${domain}"
    
    # Try DNS resolution
    if host -W 2 "$full_domain" "$resolver" > /dev/null 2>&1; then
        # Get IP address
        local ip
        ip=$(host -W 2 "$full_domain" "$resolver" 2>/dev/null | awk '/has address/ {print $4}' | head -1)
        
        if [ -n "$ip" ]; then
            echo -e "${GREEN}[FOUND]${NC} $full_domain - $ip"
            echo "$full_domain,$ip" >> "$TMPFILE"
        fi
    fi
}

# Function to rotate resolver
get_resolver() {
    local index=$((RANDOM % ${#RESOLVERS[@]}))
    echo "${RESOLVERS[$index]}"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -d|--domain)
            DOMAIN="$2"
            shift 2
            ;;
        -w|--wordlist)
            WORDLIST="$2"
            shift 2
            ;;
        -t|--threads)
            THREADS="$2"
            shift 2
            ;;
        -o|--output)
            OUTPUT="$2"
            shift 2
            ;;
        --timeout)
            TIMEOUT="$2"
            shift 2
            ;;
        --resolver)
            RESOLVERS=("$2")
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo -e "${RED}[!] Unknown option: $1${NC}"
            usage
            exit 1
            ;;
    esac
done

# Validate inputs
if [ -z "$DOMAIN" ] || [ -z "$WORDLIST" ]; then
    echo -e "${RED}[!] Domain and wordlist are required${NC}"
    usage
    exit 1
fi

if [ ! -f "$WORDLIST" ]; then
    echo -e "${RED}[!] Wordlist not found: $WORDLIST${NC}"
    exit 1
fi

# Check dependencies
check_dependencies
validate_domain "$DOMAIN"

# Display banner
echo "========================================"
echo "DNS Enumeration Tool"
echo "FOR AUTHORIZED TESTING ONLY"
echo "========================================"
echo ""

# OpSec: Confirm authorization
echo -n "Have you obtained authorization to test this domain? [yes/no]: "
read -r confirmation
if [ "$confirmation" != "yes" ]; then
    echo -e "${RED}[!] Aborting - authorization not confirmed${NC}"
    exit 1
fi

# Create temporary file for results
TMPFILE=$(mktemp)
trap "rm -f $TMPFILE" EXIT

echo "[*] Target Domain: $DOMAIN"
echo "[*] Wordlist: $WORDLIST"
echo "[*] Threads: $THREADS"
echo "[*] Timeout: ${TIMEOUT}s"
echo "[*] Resolvers: ${RESOLVERS[*]}"
echo ""

# Count total subdomains to test
TOTAL=$(wc -l < "$WORDLIST")
echo "[*] Total subdomains to test: $TOTAL"
echo "[*] Starting enumeration..."
echo ""

# Export function for parallel execution
export -f test_subdomain
export DOMAIN
export TMPFILE
export RED GREEN NC

# OpSec: Add delay between batches to avoid rate limiting
BATCH_SIZE=100
DELAY=1

counter=0
while IFS= read -r subdomain; do
    # Skip empty lines and comments
    [[ -z "$subdomain" || "$subdomain" =~ ^# ]] && continue
    
    # Rotate resolver for each query
    RESOLVER=$(get_resolver)
    
    # Add to parallel job queue
    test_subdomain "$subdomain" "$DOMAIN" "$RESOLVER" &
    
    ((counter++))
    
    # Control parallelism
    if ((counter % THREADS == 0)); then
        wait
    fi
    
    # OpSec: Delay between batches to avoid detection
    if ((counter % BATCH_SIZE == 0)); then
        echo -e "${YELLOW}[*] Progress: $counter/$TOTAL - Pausing to avoid rate limiting...${NC}"
        sleep "$DELAY"
    fi
done < "$WORDLIST"

# Wait for remaining background jobs
wait

# Display results
echo ""
echo "========================================"
echo "Enumeration Complete"
echo "========================================"

if [ -s "$TMPFILE" ]; then
    FOUND=$(wc -l < "$TMPFILE")
    echo -e "${GREEN}[*] Found $FOUND subdomains${NC}"
    echo ""
    echo "Results:"
    echo "--------"
    column -t -s',' "$TMPFILE"
    
    # Save to output file if specified
    if [ -n "$OUTPUT" ]; then
        cp "$TMPFILE" "$OUTPUT"
        echo ""
        echo -e "${GREEN}[*] Results saved to: $OUTPUT${NC}"
    fi
else
    echo -e "${YELLOW}[!] No subdomains found${NC}"
fi

# OpSec: Reminders
echo ""
echo -e "${YELLOW}[*] OpSec Reminders:${NC}"
echo "    - DNS queries may be logged by resolvers"
echo "    - Target domain may have monitoring in place"
echo "    - Clean up any temporary files created"
echo "    - Consider using VPN or proxy for additional anonymity"
echo ""
echo "[*] Enumeration complete"
