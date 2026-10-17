# Golden Minute — AI Emergency Response System

## Hackathon Product Specification

## 1. Purpose

Golden Minute reduces emergency-response delays by using AI to:

1. Dispatch the most suitable ambulance immediately.
2. Select the safest, fastest viable route and hospital.
3. Predict emergencies and bottlenecks before official reports arrive.

The system is designed as **decision support**: AI recommends and explains; an authorized dispatcher confirms high-impact actions.

## 2. Core User Roles

| User | Need |
| --- | --- |
| Dispatcher | Make the correct dispatch decision in seconds. |
| Ambulance crew | Receive clear route, patient, and hospital instructions. |
| Hospital coordinator | Prepare for incoming patients and manage capacity. |
| Emergency command center | See demand hotspots, risk alerts, and resource gaps. |

## 3. Feature 1 — AI Smart Dispatch

### Problem

Dispatchers lose time comparing ambulances manually. The nearest unit may not have the correct equipment, crew qualification, fuel, or availability.

### AI capability

For every emergency, score and rank available units based on:

- Severity and medical requirements
- Estimated arrival time
- Required equipment: BLS, ALS, ICU, Neonatal
- Crew capability and certifications
- Current unit status and workload
- Fuel level
- Distance and live traffic
- Whether assigning the unit would leave another zone uncovered

### AI recommendation

```text
Recommended unit: AMB-07
ETA: 4.2 minutes
Capability: ALS-equipped, cardiac-trained crew
Fuel: 82%
Reason: Fastest qualified unit; 2.8 minutes faster than the next ALS option.
```

### Dispatcher actions

- Accept AI plan
- View alternatives
- Override recommendation
- Request additional units
- Escalate to multi-agency response

### Example: Cardiac emergency

```text
Incident: Chest pain, shortness of breath, possible cardiac arrest
Severity: Critical
Required capability: ALS + defibrillator

AI action:
1. Excludes nearby BLS-only ambulance.
2. Selects nearest ALS unit with cardiac-qualified crew.
3. Dispatches AMB-07.
4. Pre-alerts the receiving hospital's cardiac team.
```

### Success metrics

- Dispatch-decision time under 30 seconds.
- Percentage of critical cases assigned to a correctly equipped unit.
- Critical-case response-target compliance.

## 4. Feature 2 — AI Hospital & Route Optimizer

### Problem

The geographically closest hospital may be congested, lack ICU/trauma capability, or have no ambulance bays. A route can also become unsafe or blocked after dispatch.

### AI capability

Recommend the best complete care path:

```text
Patient → Ambulance → Route → Appropriate hospital
```

Factors include:

- Real-time traffic and road closures
- Hospital ED occupancy
- ICU, trauma, stroke, cardiac, and neonatal capability
- Ambulance-bay availability
- Predicted arrival queue
- Patient condition and treatment requirements
- Weather and flood-risk areas

### AI recommendation

```text
Recommended destination: HCTM UKM
Total travel time: 8 minutes
Capability: Trauma and ICU available
ED capacity: 76%
Alternative avoided: Hospital Kuala Lumpur
Reason: HKL ED congestion would add an estimated 6 minutes to handover.
```

### Dynamic re-routing

```text
Alert: Flooding reported on Jalan Tun Razak.
Impact: Current route delay +9 minutes.

AI recommendation:
Reroute AMB-07 through Jalan Damansara.
New ETA: 11 minutes.
Alternate hospital: HCTM UKM remains optimal.
```

### Example: Major road accident

```text
Incident: Multi-vehicle collision; possible trauma patients
Severity: Critical

AI action:
1. Identifies trauma-capable hospitals.
2. Checks ED and ambulance-bay capacity.
3. Splits patients across hospitals if one ED becomes overloaded.
4. Gives each ambulance its best route and destination.
5. Sends hospital pre-arrival alerts with patient details and ETA.
```

### Success metrics

- Ambulance-to-hospital handover time.
- Percentage of patients routed to an appropriate facility on first choice.
- Avoided ED congestion delays.
- Route ETA accuracy.

## 5. Feature 3 — AI Risk Prediction & Early Warning

### Problem

Emergency teams react only after a call arrives. By then, ambulances may be in the wrong place, roads may already be blocked, and hospitals may be overwhelmed.

### AI capability

Predict risk over the next 30–60 minutes using:

- Historical emergency-call patterns
- Live weather and rainfall intensity
- Flood and drainage risk zones
- Traffic speed and unusual congestion
- Road closures
- Public events and crowd density
- Current incident clusters
- Available ambulances, crews, and hospital capacity

### Risk levels

| Risk level | Meaning | System action |
| --- | --- | --- |
| Low | Normal operating conditions | Monitor. |
| Medium | Emerging risk signal | Notify dispatcher; prepare resources. |
| High | Strong likelihood of incidents or disruption | Pre-position unit; alert hospital. |
| Critical | Active or likely major incident | Activate multi-unit or multi-agency protocol. |

## 6. Prediction Use Cases

### A. Unusual rainfall → flash-flood prediction

```text
Signal:
- Rainfall intensity rises sharply for 20 minutes.
- Low-lying flood-prone zone detected.
- Traffic speed falls across multiple nearby roads.

AI prediction:
High flash-flood risk in Zone D within 30 minutes.

Recommended response:
1. Pre-position 2 ambulances at safe elevated access points.
2. Alert fire and rescue / civil defense team.
3. Recommend route restrictions around likely flooded roads.
4. Notify nearby hospitals to prepare for trauma, hypothermia, and evacuation cases.
5. Show evacuation-priority locations: schools, hospitals, elderly-care facilities.
```

### B. Unusual traffic jam → possible unreported accident

The system must not claim an accident as fact. It should label this as an **unverified incident-risk signal**.

```text
Signal:
- Sudden zero-speed traffic on a normally flowing road.
- Abrupt stop pattern across several vehicles.
- No planned event or road closure recorded.

AI prediction:
Possible road incident near Jalan Ampang.
Confidence: 78%

Recommended response:
1. Request CCTV or traffic-control verification.
2. Send a nearby rapid-response or patrol unit to assess.
3. Alert one ambulance to stand by, not automatically commit.
4. Offer alternate routes to nearby ambulances.
5. Escalate to full dispatch only after verification or an emergency call.
```

### C. Event/crowd surge → medical-demand prediction

```text
Signal:
- Stadium concert ends in 25 minutes.
- Heat index is high.
- Previous events show frequent dehydration, collapse, and traffic incidents.

AI prediction:
High chance of medical calls around event exit routes.

Recommended response:
1. Pre-position BLS and ALS ambulances near exits.
2. Set a temporary medical post.
3. Reserve hospital ambulance-bay capacity.
4. Assign traffic routes for emergency access.
```

### D. Clustered calls → mass-casualty warning

```text
Signal:
- Five emergency calls within 500 metres in six minutes.
- Similar symptoms or location descriptions.
- Traffic disruption detected.

AI prediction:
Possible mass-casualty incident.

Recommended response:
1. Group calls into one incident cluster.
2. Dispatch an incident commander and multiple units.
3. Activate hospital surge alerts.
4. Request police and fire support.
5. Start patient distribution planning across hospitals.
```

## 7. Severity Prioritization and Immediate AI Response

| Severity | Example | AI priority | Immediate recommended response |
| --- | --- | --- | --- |
| Critical | Cardiac arrest, stroke signs, severe trauma, major fire | P1 | Dispatch nearest qualified ALS/ICU unit; identify trauma/ICU hospital; pre-alert hospital; monitor SLA every minute. |
| High | Serious accident, breathing difficulty, severe bleeding | P2 | Dispatch nearest suitable unit; route around delays; reserve suitable ED capacity; escalate if ETA is at risk. |
| Medium | Fracture, moderate injury, non-life-threatening illness | P3 | Dispatch BLS/available unit; optimize to avoid affecting P1/P2 coverage; recommend appropriate hospital or clinic. |
| Low | Minor injury, non-urgent assistance | P4 | Offer tele-triage, scheduled transport, or lower-priority dispatch; preserve ambulances for urgent cases. |

### AI escalation rule

```text
If a Critical incident has no qualified ambulance within the target ETA:
1. Alert dispatcher immediately.
2. Recommend closest alternate ALS/ICU unit.
3. Consider reassigning a lower-priority active unit.
4. Request mutual aid from a neighbouring zone.
5. Notify hospital before ambulance arrival.
```

## 8. Main Dashboard Components

- Live incident and ambulance map
- AI recommendation card with explanation
- Risk-prediction heatmap for the next 30–60 minutes
- Hospital-capacity panel
- SLA breach countdown
- Route disruption alerts
- Accept AI Plan and Dispatcher Override controls
- Incident timeline and audit log

## 9. Hackathon Demo Flow

```text
1. Heavy rainfall begins in a flood-prone zone.
2. AI predicts flash-flood risk and pre-positions ambulances.
3. A traffic anomaly appears; AI flags a possible unreported crash.
4. A critical road-accident call is received.
5. AI selects the correct ALS ambulance, safe route, and trauma-capable hospital.
6. A hospital becomes congested mid-route.
7. AI re-routes to a better hospital and shows minutes saved.
```

Final dashboard message:

```text
Critical response plan accepted.
AMB-07 dispatched with ALS capability.
HCTM UKM selected: trauma capacity available.
Estimated time saved: 4.6 minutes.
Critical-response target: on track.
```

## 10. Core Pitch

> Golden Minute does not merely show where ambulances are. It predicts where emergencies and bottlenecks are likely to happen, recommends the fastest safe response chain, and helps emergency teams act before delays cost lives.