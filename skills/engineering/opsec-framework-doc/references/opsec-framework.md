# OpSec framework primer

Operational Security is the discipline of identifying what an adversary can observe, deciding which
observations would harm the operation, and applying countermeasures that reduce that exposure.

For internal red-team and threat-emulation work, the observing adversary is usually the blue team,
its tooling, and any third-party monitoring pipeline in scope for the exercise.

## Five-step process

### 1. Identify critical information

Determine what must remain protected for the operation to remain realistic and useful:

- indicators from tools, payloads, infrastructure, and timing;
- C2 domains, IPs, certificates, redirectors, and profiles;
- operator identities, locations, and communication channels;
- target selection and sequencing;
- tool configuration, payload hashes, and encryption keys;
- artifacts created during execution.

### 2. Analyze threats

Identify who can observe the activity and what they want to learn:

- SOC analysts and incident responders;
- endpoint, network, identity, cloud, and email detections;
- SIEM, EDR, NDR, UEBA, DLP, and case-management pipelines;
- third-party monitoring, managed detection, and logging providers.

### 3. Analyze vulnerabilities

Find where critical information can leak:

- default tool configurations and known signatures;
- predictable timing and volume;
- reused infrastructure;
- direct operator connections;
- high-noise enumeration;
- weak cleanup or poor OPLOG discipline;
- insecure team communications.

### 4. Assess risk

For each vulnerability, evaluate likelihood and impact:

- detection and eviction;
- blocked infrastructure or payloads;
- defender attribution to the team;
- premature loss of access;
- learned defensive countermeasures before objectives are complete;
- reduced value of the exercise.

### 5. Apply countermeasures

Choose proportional controls:

- customize tooling and profiles;
- use approved redirectors and tiered infrastructure;
- operate within the engagement's timing and deconfliction rules;
- obfuscate or encrypt where authorized;
- throttle noisy activity;
- maintain backup channels;
- clean up artifacts;
- document every action in the OPLOG.

## Lifecycle coverage

Apply OpSec throughout:

- pre-engagement setup;
- initial access;
- execution and persistence;
- lateral movement;
- collection and exfiltration simulation;
- closeout, cleanup, and reporting.

## Documentation standard

Each procedure should answer:

- what the technique does;
- prerequisites and scope boundaries;
- how to execute it safely in an authorized setting;
- what telemetry it may generate;
- how to reduce or explain that telemetry;
- how to validate success;
- how to clean up;
- what evidence should be recorded in the OPLOG.
