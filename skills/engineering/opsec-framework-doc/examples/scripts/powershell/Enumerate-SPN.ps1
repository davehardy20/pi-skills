<#
.SYNOPSIS
    Enumerates Service Principal Names (SPNs) for Kerberoasting attacks.

.DESCRIPTION
    This script queries Active Directory for user accounts that have Service
    Principal Names configured, making them potential targets for Kerberoasting
    attacks. The script identifies accounts using weak encryption (RC4) versus
    stronger encryption (AES).

    MITRE ATT&CK: T1558.003 (Steal or Forge Kerberos Tickets: Kerberoasting)

.PARAMETER Domain
    The target Active Directory domain to query.

.PARAMETER OutputFile
    File path to save the enumeration results.

.PARAMETER LDAPServer
    Specific domain controller to query (optional).

.PARAMETER IncludeAES
    Include accounts with AES encryption (default is RC4 only).

.EXAMPLE
    .\Enumerate-SPN.ps1 -Domain "corp.local" -OutputFile "spn_accounts.txt"
    
    Enumerates all SPN accounts in corp.local domain and saves to file.

.EXAMPLE
    .\Enumerate-SPN.ps1 -Domain "corp.local" -IncludeAES | Export-Csv spn_all.csv
    
    Enumerates all SPN accounts including AES-encrypted ones and exports to CSV.

.NOTES
    File Name      : Enumerate-SPN.ps1
    Author         : OpSec Documentation Team
    Prerequisite   : PowerShell 5.1 or PowerShell 7+
                     Active Directory module (optional, for Get-ADUser)
    Version        : 1.0
    Date           : 2026-02-15

    OpSec Considerations:
    --------------------
    - Generates Windows Event ID 4662 (An operation was performed on an object)
    - LDAP queries are logged on domain controllers
    - High query frequency may trigger behavioral analytics
    - Use from non-egress controlled host when possible
    - Consider using LDAPS (port 636) for encrypted queries
    - Clear PowerShell history after execution: Clear-History
    - May trigger SIEM rules for "LDAP Reconnaissance"
    
    WARNING: For authorized security testing only.
             Use only on systems you have explicit permission to test.

.LINK
    https://attack.mitre.org/techniques/T1558/003/
    https://docs.microsoft.com/en-us/windows/win32/ad/schema/attribute-serviceprincipalname
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory=$false)]
    [string]$Domain,
    
    [Parameter(Mandatory=$false)]
    [string]$OutputFile,
    
    [Parameter(Mandatory=$false)]
    [string]$LDAPServer,
    
    [Parameter(Mandatory=$false)]
    [switch]$IncludeAES
)

#Requires -Version 5.1

# OpSec: Suppress error messages to avoid verbose output
$ErrorActionPreference = "SilentlyContinue"
$ProgressPreference = "SilentlyContinue"

function Get-SPNSecurityInfo {
    param([string]$encryptionTypes)
    
    # Parse msDS-SupportedEncryptionTypes attribute
    # Values from MS-KILE specification
    $etypes = @{
        1 = "DES-CBC-CRC"
        2 = "DES-CBC-MD5"
        4 = "RC4-HMAC"
        8 = "AES128-CTS-HMAC-SHA1-96"
        16 = "AES256-CTS-HMAC-SHA1-96"
    }
    
    $supported = @()
    $etypeValue = [int]$encryptionTypes
    
    foreach ($etype in $etypes.Keys | Sort-Object) {
        if ($etypeValue -band $etype) {
            $supported += $etypes[$etype]
        }
    }
    
    # Check for weak encryption
    $hasRC4 = $supported -contains "RC4-HMAC"
    $hasDES = ($supported -contains "DES-CBC-CRC") -or ($supported -contains "DES-CBC-MD5")
    $hasAES = ($supported -contains "AES128-CTS-HMAC-SHA1-96") -or ($supported -contains "AES256-CTS-HMAC-SHA1-96")
    
    $risk = "Unknown"
    if ($hasDES -or $hasRC4) {
        $risk = "High"
    } elseif ($hasAES) {
        $risk = "Medium"
    }
    
    return @{
        Supported = $supported -join ", "
        RiskLevel = $risk
        Kerberoastable = $hasRC4 -or $hasDES
    }
}

function Invoke-SPNEnumeration {
    param(
        [string]$TargetDomain,
        [string]$Server,
        [switch]$IncludeAllEncryption
    )
    
    Write-Host "[*] Starting SPN enumeration" -ForegroundColor Cyan
    Write-Host "[*] Target Domain: $TargetDomain" -ForegroundColor Gray
    
    if ($Server) {
        Write-Host "[*] LDAP Server: $Server" -ForegroundColor Gray
    }
    
    # Determine domain if not specified
    if (-not $TargetDomain) {
        try {
            # OpSec: Use current domain context
            $TargetDomain = (Get-WmiObject -Class Win32_ComputerSystem).Domain
            Write-Host "[*] Using current domain: $TargetDomain" -ForegroundColor Gray
        }
        catch {
            Write-Error "Unable to determine domain. Please specify -Domain parameter."
            return
        }
    }
    
    # Build LDAP query
    # OpSec: This query targets specific attributes to minimize noise
    $ldapFilter = "(&(objectCategory=person)(objectClass=user)(servicePrincipalName=*))"
    
    # Attributes to retrieve - minimal set for OpSec
    $properties = @(
        "samAccountName",
        "servicePrincipalName",
        "memberOf",
        "userAccountControl",
        "msDS-SupportedEncryptionTypes",
        "pwdLastSet",
        "lastLogon"
    )
    
    try {
        # Method 1: Using ADSI (works without ActiveDirectory module)
        # OpSec: ADSI generates less logging than Get-ADUser in some environments
        $domainDN = "DC=" + ($TargetDomain -replace "\.", ",DC=")
        
        if ($Server) {
            $ldapPath = "LDAP://$Server/$domainDN"
        } else {
            $ldapPath = "LDAP://$domainDN"
        }
        
        Write-Host "[*] Querying LDAP: $ldapPath" -ForegroundColor Gray
        
        $directoryEntry = New-Object System.DirectoryServices.DirectoryEntry($ldapPath)
        $searcher = New-Object System.DirectoryServices.DirectorySearcher($directoryEntry)
        $searcher.Filter = $ldapFilter
        $searcher.PageSize = 1000  # Pagination for large environments
        $searcher.PropertiesToLoad.AddRange($properties)
        
        # OpSec: Set reasonable timeout
        $searcher.ServerTimeLimit = New-TimeSpan -Seconds 30
        
        $results = $searcher.FindAll()
        
        Write-Host "[*] Found $($results.Count) accounts with SPNs" -ForegroundColor Green
        
        $spnAccounts = @()
        
        foreach ($result in $results) {
            $props = $result.Properties
            
            $samAccountName = $props["samaccountname"][0]
            $spns = $props["serviceprincipalname"]
            $encryptionTypes = $props["msds-supportedencryptiontypes"][0]
            $uac = $props["useraccountcontrol"][0]
            
            # Check account status
            $isDisabled = ($uac -band 0x2) -eq 0x2
            $isServiceAccount = ($uac -band 0x10000) -eq 0x10000  # UF_TRUSTED_FOR_DELEGATION
            
            # Get encryption info
            $encInfo = Get-SPNSecurityInfo -encryptionTypes $encryptionTypes
            
            # Skip AES-only accounts unless IncludeAES specified
            if (-not $IncludeAllEncryption -and -not $encInfo.Kerberoastable) {
                continue
            }
            
            foreach ($spn in $spns) {
                $account = [PSCustomObject]@{
                    SamAccountName = $samAccountName
                    SPN = $spn
                    EncryptionTypes = $encInfo.Supported
                    RiskLevel = $encInfo.RiskLevel
                    Kerberoastable = $encInfo.Kerberoastable
                    IsDisabled = $isDisabled
                    IsServiceAccount = $isServiceAccount
                    Domain = $TargetDomain
                }
                
                $spnAccounts += $account
            }
        }
        
        return $spnAccounts
    }
    catch {
        Write-Error "LDAP query failed: $_"
        Write-Host "[*] Trying alternative method with Get-ADUser..." -ForegroundColor Yellow
        
        # Method 2: Using ActiveDirectory module (requires RSAT)
        try {
            Import-Module ActiveDirectory -ErrorAction Stop
            
            $adUsers = Get-ADUser -Filter {servicePrincipalName -like "*"} `
                                  -Properties servicePrincipalName, msDS-SupportedEncryptionTypes, userAccountControl `
                                  -Server $TargetDomain
            
            $spnAccounts = @()
            foreach ($user in $adUsers) {
                $encInfo = Get-SPNSecurityInfo -encryptionTypes $user."msDS-SupportedEncryptionTypes"
                
                if (-not $IncludeAllEncryption -and -not $encInfo.Kerberoastable) {
                    continue
                }
                
                foreach ($spn in $user.servicePrincipalName) {
                    $account = [PSCustomObject]@{
                        SamAccountName = $user.SamAccountName
                        SPN = $spn
                        EncryptionTypes = $encInfo.Supported
                        RiskLevel = $encInfo.RiskLevel
                        Kerberoastable = $encInfo.Kerberoastable
                        IsDisabled = -not $user.Enabled
                        IsServiceAccount = ($user.userAccountControl -band 0x10000) -eq 0x10000
                        Domain = $TargetDomain
                    }
                    
                    $spnAccounts += $account
                }
            }
            
            return $spnAccounts
        }
        catch {
            Write-Error "ActiveDirectory module method also failed: $_"
        }
    }
}

# Main execution
Write-Host @"
========================================
SPN Enumeration Tool
FOR AUTHORIZED TESTING ONLY
========================================
"@ -ForegroundColor Cyan

# OpSec: Confirm authorization
$confirmation = Read-Host "Have you obtained authorization to test this domain? [yes/no]"
if ($confirmation -ne "yes") {
    Write-Host "[!] Aborting - authorization not confirmed" -ForegroundColor Red
    exit 1
}

# Execute enumeration
$results = Invoke-SPNEnumeration -TargetDomain $Domain -Server $LDAPServer -IncludeAllEncryption:$IncludeAES

if ($results) {
    # Display results
    Write-Host "`n[*] Enumeration Results:" -ForegroundColor Cyan
    Write-Host "=========================" -ForegroundColor Cyan
    
    $results | Format-Table -AutoSize
    
    # Summary statistics
    $total = $results.Count
    $kerberoastable = ($results | Where-Object { $_.Kerberoastable }).Count
    $highRisk = ($results | Where-Object { $_.RiskLevel -eq "High" }).Count
    
    Write-Host "`n[*] Summary:" -ForegroundColor Cyan
    Write-Host "    Total SPN entries: $total"
    Write-Host "    Kerberoastable (RC4/DES): $kerberoastable" -ForegroundColor $(if ($kerberoastable -gt 0) { "Red" } else { "Green" })
    Write-Host "    High Risk accounts: $highRisk" -ForegroundColor $(if ($highRisk -gt 0) { "Red" } else { "Green" })
    
    # Save to file if specified
    if ($OutputFile) {
        $results | Export-Csv -Path $OutputFile -NoTypeInformation
        Write-Host "`n[*] Results saved to: $OutputFile" -ForegroundColor Green
    }
    
    # OpSec: Provide cleanup guidance
    Write-Host "`n[*] OpSec Reminders:" -ForegroundColor Yellow
    Write-Host "    - Clear PowerShell history: Clear-History"
    Write-Host "    - Remove output files when no longer needed"
    Write-Host "    - Monitor for detection alerts"
    Write-Host "    - Consider using Rubeus or other tools for actual ticket extraction"
} else {
    Write-Host "[!] No SPN accounts found or enumeration failed" -ForegroundColor Yellow
}

Write-Host "`n[*] Enumeration complete" -ForegroundColor Green
