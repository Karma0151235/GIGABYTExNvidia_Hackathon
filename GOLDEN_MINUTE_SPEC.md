# Golden Minute Module Plan

## Product Direction

Golden Minute is an AI emergency response system that helps emergency teams detect risk earlier, dispatch the right response faster, route patients to the right hospital, and keep operators aligned under pressure.

The system is decision support: AI recommends, explains, and prioritizes; authorized operators confirm high-impact actions.

## Core Modules

### 1. Command Center

**Purpose:** Manage the incident.

Main operational workspace for managing active incidents, tracking status, coordinating teams, and keeping one shared view of what is happening right now.

**Problem solved:**
- Operators need one trusted view of active incidents, status, teams, severity, SLA risk, and audit history.
- During high-pressure response, scattered information causes missed updates and unclear ownership.

**Frontend scope:**
- Active incident dashboard
- Incident detail workspace
- Severity and SLA status indicators
- Team coordination panel
- Incident timeline and audit log
- Hospital capacity and route status summary

**Backend scope:**
- Incident records and status transitions
- Timeline events and audit logging
- Incident severity and SLA tracking
- Team assignment state
- Hospital and route summary data exposed to the command view

**Demo moment:**
- A critical incident appears, Command Center shows status, assigned units, SLA countdown, hospital readiness, and the latest decision trail in one view.

### 2. Live Dispatch

**Purpose:** Send the response.

Real-time dispatch flow for assigning responders, routing units, updating ETAs, and monitoring active deployments as situations change.

**Problem solved:**
- Dispatchers lose time manually comparing units.
- The nearest ambulance may not be the safest or most suitable option due to equipment, crew capability, fuel, workload, traffic, or zone coverage impact.

**Frontend scope:**
- Ambulance and responder map
- Ranked unit recommendation cards
- Unit capability and availability view
- Accept, override, request backup, and escalate actions
- ETA, route, and deployment status display

**Backend scope:**
- Unit scoring and ranking
- ETA and distance calculations
- Capability matching: BLS, ALS, ICU, neonatal, cardiac, trauma
- Fuel, workload, and availability checks
- Zone coverage impact calculation
- Dispatch assignment and reassignment APIs

**Demo moment:**
- For a cardiac emergency, the system excludes a nearby BLS-only ambulance and recommends an ALS-equipped unit with a cardiac-trained crew.

### 3. Signal Fusion

**Purpose:** Detect the bigger pattern.

Intelligence layer that groups scattered reports, alerts, traffic anomalies, weather signals, and field updates into one emerging incident so operators can spot patterns early and reduce duplicates.

**Problem solved:**
- Emergency teams often react after official calls arrive.
- Multiple weak signals may point to one larger event, but operators can miss the pattern when information arrives separately.

**Frontend scope:**
- Incoming signal stream
- Clustered signal map
- Emerging event cards
- Confidence score and severity trend
- Linked reports timeline
- Merge, split, verify, and promote-to-incident controls
- Risk heatmap for the next 30-60 minutes

**Backend scope:**
- Raw signal ingestion
- Signal similarity scoring using location, time, category, and text
- Cluster creation and updating
- Confidence scoring
- Risk level classification: Low, Medium, High, Critical
- Manual merge, split, verify, and promote-to-incident APIs

**Demo moment:**
- Heavy rainfall, slowing traffic, and nearby reports are fused into a high flash-flood risk cluster before a full emergency call arrives.

### 4. Dispatch Assistant

**Purpose:** Support the operator decision-making.

AI support layer that helps operators with fast summaries, recommended next actions, SOP guidance, and quick data lookup during high-pressure dispatch work.

**Problem solved:**
- Operators need fast, explainable support without leaving the workflow.
- During critical cases, they need summaries, next steps, policies, and justification for AI recommendations.

**Frontend scope:**
- Assistant panel inside dispatch and command workflows
- Incident summary generation
- Recommended next actions
- SOP lookup
- Explanation view for AI recommendations
- Quick questions about units, hospitals, routes, and incident history

**Backend scope:**
- Incident context retrieval
- Recommendation explanation generation
- SOP and policy lookup
- Chat/session history
- Guardrails for decision support versus automated action

**Demo moment:**
- The assistant explains why AMB-07 was selected, summarizes patient risk, and suggests hospital pre-alert steps.

### 5. Care Route Optimizer

**Purpose:** Complete the response chain.

Selects the safest viable route and most appropriate hospital based on patient needs, traffic, road risk, hospital capability, and current capacity.

This consolidates the teammate outline's AI Hospital & Route Optimizer into the fifth core module.

**Problem solved:**
- The closest hospital may be congested, lack the needed specialty, or have no ambulance bay.
- A selected route can become unsafe or blocked after dispatch.

**Frontend scope:**
- Route comparison view
- Recommended hospital card
- Hospital capacity panel
- Specialty capability indicators: ICU, trauma, stroke, cardiac, neonatal
- Dynamic reroute alerts
- Handover ETA and congestion risk display

**Backend scope:**
- Hospital capability and capacity data model
- Route scoring based on ETA, safety, traffic, flood risk, and closures
- Patient-to-hospital matching
- Dynamic rerouting logic
- Hospital pre-alert creation
- Patient distribution logic for multi-casualty incidents

**Demo moment:**
- A road accident patient is routed away from a congested hospital to a trauma-capable hospital with capacity, saving several minutes of handover delay.

## Role Coverage

| Role | Main Modules Used |
| --- | --- |
| Dispatcher | Command Center, Live Dispatch, Dispatch Assistant |
| Ambulance crew | Live Dispatch, Care Route Optimizer |
| Hospital coordinator | Care Route Optimizer, Command Center |
| Emergency command center | Command Center, Signal Fusion |

## Severity Model

| Severity | Example | Priority | Recommended response |
| --- | --- | --- | --- |
| Critical | Cardiac arrest, stroke signs, severe trauma, major fire | P1 | Dispatch nearest qualified ALS/ICU unit, identify specialist hospital, pre-alert hospital, monitor SLA every minute. |
| High | Serious accident, breathing difficulty, severe bleeding | P2 | Dispatch nearest suitable unit, route around delays, reserve suitable ED capacity, escalate if ETA is at risk. |
| Medium | Fracture, moderate injury, non-life-threatening illness | P3 | Dispatch BLS or available unit, preserve P1/P2 coverage, recommend appropriate hospital or clinic. |
| Low | Minor injury, non-urgent assistance | P4 | Offer tele-triage, scheduled transport, or lower-priority dispatch. |

## Integrated Demo Flow

1. Signal Fusion detects heavy rainfall, slowing traffic, and clustered reports in a flood-prone zone.
2. Command Center shows the emerging risk and active operational status.
3. A critical road-accident call is received.
4. Live Dispatch recommends the best qualified ambulance, not just the nearest one.
5. Care Route Optimizer selects the safest route and trauma-capable hospital with available capacity.
6. Dispatch Assistant explains the plan and summarizes the recommended next actions.
7. Operator accepts the plan and the dashboard shows the response target is on track.

## Final Pitch

Golden Minute does not merely show where ambulances are. It detects emerging emergency patterns, recommends the fastest safe response chain, routes patients to the right facility, and supports operators with explainable AI during the moments where delay costs lives.