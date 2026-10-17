// ponytail: demo-only patient data keyed by voice sample. Replace with a patient/EMR lookup when one exists.
// All names, IC numbers and phone numbers are fictional.

export type Vitals = { hr: number; bpSys: number; bpDia: number; spo2: number; rr: number; gcs: number; tempC?: number };

export type PatientSeed = {
  identity: { name: string; ic: string; age: number; sex: "M" | "F"; phone: string; nextOfKin?: string; allergies: string[]; conditions: string[] };
  responder: { symptoms: string[]; treatment: { at: string; action: string }[]; vitals: Vitals; notes: string };
  hospital: { facilityName: string; ward: string; bed?: string; admittedDiagnosis: string; treatment: string[]; status: string };
};

const SEEDS: Record<string, PatientSeed> = {
  "01_p1_bm_klcc_cardiac": {
    identity: { name: "Ahmad Faizal bin Rahman", ic: "680412-14-5531", age: 58, sex: "M", phone: "012-345 6781", nextOfKin: "Noraini (wife)", allergies: ["Aspirin intolerance (GI)"], conditions: ["Hypertension", "Type 2 diabetes"] },
    responder: { symptoms: ["Crushing chest pain", "Diaphoresis", "Left arm radiation", "Nausea"], treatment: [{ at: "+2m", action: "12-lead ECG: ST elevation V2-V4" }, { at: "+4m", action: "GTN 0.4 mg SL" }, { at: "+5m", action: "O2 via nasal cannula 2 L/min" }, { at: "+6m", action: "IV access 18G right antecubital" }], vitals: { hr: 112, bpSys: 92, bpDia: 58, spo2: 91, rr: 24, gcs: 15, tempC: 36.8 }, notes: "Collapsed at KLCC concourse, bystander CPR not needed. STEMI suspected, cath lab pre-alert advised." },
    hospital: { facilityName: "Institut Jantung Negara", ward: "CCU", bed: "4", admittedDiagnosis: "Anterior STEMI", treatment: ["Primary PCI to LAD", "Dual antiplatelet (clopidogrel + ticagrelor)", "Heparin infusion"], status: "Stable post-PCI" },
  },
  "02_p1_manglish_jalan_tun_razak_collision": {
    identity: { name: "Kavin a/l Suresh", ic: "990723-10-6127", age: 26, sex: "M", phone: "016-223 9087", nextOfKin: "Suresh (father)", allergies: [], conditions: [] },
    responder: { symptoms: ["Open left tibia fracture", "Scalp laceration", "Brief LOC reported"], treatment: [{ at: "+1m", action: "C-spine immobilisation" }, { at: "+3m", action: "Pressure dressing to scalp" }, { at: "+5m", action: "Splint left leg, sterile cover to wound" }, { at: "+7m", action: "IV fentanyl 50 mcg" }], vitals: { hr: 124, bpSys: 104, bpDia: 66, spo2: 96, rr: 22, gcs: 14 }, notes: "Motorcyclist vs car. Helmet cracked. Trauma team activation suggested." },
    hospital: { facilityName: "Hospital Kuala Lumpur", ward: "Trauma ICU", bed: "T2", admittedDiagnosis: "Open tibial fracture, mild TBI", treatment: ["CT head and C-spine", "IV cefazolin", "Orthopaedic washout and ex-fix"], status: "Awaiting theatre" },
  },
  "03_p1_english_kl_sentral_collapse": {
    identity: { name: "Margaret Tan Siew Lan", ic: "570305-08-2244", age: 67, sex: "F", phone: "013-781 2290", nextOfKin: "Daniel Tan (son)", allergies: ["Penicillin"], conditions: ["Atrial fibrillation"] },
    responder: { symptoms: ["Sudden collapse", "Unresponsive initially", "Irregular pulse"], treatment: [{ at: "+1m", action: "AED attached: no shock advised" }, { at: "+3m", action: "Recovery position, airway clear" }, { at: "+4m", action: "Capillary glucose 6.1 mmol/L" }, { at: "+6m", action: "IV access, cardiac monitoring" }], vitals: { hr: 46, bpSys: 88, bpDia: 50, spo2: 94, rr: 16, gcs: 13 }, notes: "Syncope at platform 4. Bradycardic AF on monitor." },
    hospital: { facilityName: "Hospital Kuala Lumpur", ward: "CCU", bed: "9", admittedDiagnosis: "Symptomatic bradycardia, AF with slow ventricular response", treatment: ["Atropine 0.5 mg IV", "Hold rate-control meds", "Temporary pacing on standby"], status: "Monitoring" },
  },
  "04_p2_bm_cheras_fall": {
    identity: { name: "Siti Aminah binti Yusof", ic: "480918-10-3302", age: 77, sex: "F", phone: "019-552 1043", nextOfKin: "Azlan (son)", allergies: [], conditions: ["Osteoporosis", "Hypertension"] },
    responder: { symptoms: ["Right hip pain", "Shortened, externally rotated right leg", "Unable to bear weight"], treatment: [{ at: "+2m", action: "Paracetamol 1 g IV" }, { at: "+4m", action: "Vacuum mattress, leg supported" }], vitals: { hr: 96, bpSys: 148, bpDia: 84, spo2: 97, rr: 18, gcs: 15 }, notes: "Slipped in bathroom, lying ~1 hour. No head strike." },
    hospital: { facilityName: "Hospital Canselor Tuanku Muhriz", ward: "Orthopaedic 5B", bed: "12", admittedDiagnosis: "Right neck of femur fracture", treatment: ["Fascia iliaca block", "Hemiarthroplasty planned", "VTE prophylaxis"], status: "Pre-op" },
  },
  "05_p2_manglish_bukit_bintang_gas_leak": {
    identity: { name: "Lee Chun Hao", ic: "850214-14-7719", age: 41, sex: "M", phone: "017-330 4410", allergies: [], conditions: ["Asthma"] },
    responder: { symptoms: ["Headache", "Dizziness", "Cough", "Mild wheeze"], treatment: [{ at: "+1m", action: "Removed from exposure area" }, { at: "+2m", action: "High-flow O2 15 L/min NRB" }, { at: "+5m", action: "Salbutamol 5 mg nebulised" }], vitals: { hr: 104, bpSys: 132, bpDia: 82, spo2: 93, rr: 22, gcs: 15 }, notes: "Restaurant kitchen LPG leak. Bomba on site. 2 others walking wounded." },
    hospital: { facilityName: "Hospital Kuala Lumpur", ward: "Emergency Observation", bed: "O3", admittedDiagnosis: "Inhalational exposure, asthma exacerbation", treatment: ["Carboxyhaemoglobin level", "Nebulised bronchodilators", "Observation 6 h"], status: "Improving" },
  },
  "06_p2_mandarin_kl_sentral_fall": {
    identity: { name: "Wong Mei Fong", ic: "620830-07-5568", age: 63, sex: "F", phone: "012-908 3356", nextOfKin: "Wong Kok Leong (husband)", allergies: ["Sulfa drugs"], conditions: ["Type 2 diabetes"] },
    responder: { symptoms: ["Fall down escalator", "Left wrist deformity", "Forehead bruise"], treatment: [{ at: "+2m", action: "Wrist splinted" }, { at: "+3m", action: "Glucose 4.2 mmol/L, oral glucose gel" }, { at: "+5m", action: "Neuro obs every 5 min" }], vitals: { hr: 92, bpSys: 138, bpDia: 80, spo2: 98, rr: 16, gcs: 15 }, notes: "Mandarin speaker, family interpreter on phone." },
    hospital: { facilityName: "Hospital Kuala Lumpur", ward: "Orthopaedic 7A", bed: "3", admittedDiagnosis: "Distal radius fracture, minor head injury", treatment: ["Closed reduction under haematoma block", "Backslab", "Head injury observation"], status: "Stable" },
  },
  "07_p1_tamil_sunway_breathing": {
    identity: { name: "Lakshmi a/p Muthu", ic: "550101-10-8826", age: 69, sex: "F", phone: "014-662 7731", nextOfKin: "Ganesh (son)", allergies: [], conditions: ["COPD", "Heart failure"] },
    responder: { symptoms: ["Severe breathlessness", "Tripod position", "Bilateral crackles", "Ankle oedema"], treatment: [{ at: "+1m", action: "Sitting upright, O2 titrated to SpO2 88-92%" }, { at: "+3m", action: "GTN 0.4 mg SL" }, { at: "+6m", action: "CPAP 5 cmH2O" }], vitals: { hr: 118, bpSys: 168, bpDia: 96, spo2: 84, rr: 32, gcs: 15 }, notes: "Acute pulmonary oedema likely. Tamil-speaking, daughter translating." },
    hospital: { facilityName: "Sunway Medical Centre", ward: "HDU", bed: "6", admittedDiagnosis: "Acute decompensated heart failure", treatment: ["IV furosemide 80 mg", "Non-invasive ventilation", "Echo"], status: "On NIV, improving" },
  },
  "08_p2_bm_masjid_jamek_flood": {
    identity: { name: "Mohd Hafiz bin Ismail", ic: "910507-14-6643", age: 34, sex: "M", phone: "011-2345 8890", allergies: [], conditions: [] },
    responder: { symptoms: ["Near-drowning", "Coughing water", "Hypothermic shivering", "Calf laceration"], treatment: [{ at: "+1m", action: "Wet clothes removed, thermal blanket" }, { at: "+3m", action: "O2 via mask 10 L/min" }, { at: "+5m", action: "Wound irrigated and dressed" }], vitals: { hr: 108, bpSys: 118, bpDia: 74, spo2: 92, rr: 24, gcs: 15, tempC: 35.1 }, notes: "Swept by flash flood near river confluence. Pulled out by public." },
    hospital: { facilityName: "Hospital Kuala Lumpur", ward: "Medical 4", bed: "18", admittedDiagnosis: "Non-fatal drowning, mild hypothermia", treatment: ["Chest X-ray", "Active rewarming", "Tetanus booster, wound care"], status: "Stable" },
  },
  "09_p3_manglish_bangsar_bicycle_fall": {
    identity: { name: "Jason Ng Kar Wai", ic: "020911-14-0057", age: 24, sex: "M", phone: "018-774 1209", allergies: [], conditions: [] },
    responder: { symptoms: ["Grazes both palms", "Right shoulder pain", "Helmet intact"], treatment: [{ at: "+2m", action: "Wounds cleaned and dressed" }, { at: "+3m", action: "Broad arm sling" }], vitals: { hr: 84, bpSys: 126, bpDia: 78, spo2: 99, rr: 14, gcs: 15 }, notes: "Low-speed fall. Ambulatory." },
    hospital: { facilityName: "Pantai Hospital Kuala Lumpur", ward: "ED Minor", admittedDiagnosis: "Right clavicle fracture (undisplaced)", treatment: ["X-ray", "Sling", "Ortho clinic follow-up"], status: "Discharge planned" },
  },
  "10_p1_bm_jalan_tun_razak_duplicate": {
    identity: { name: "Nur Aqilah binti Zainal", ic: "970228-14-4410", age: 28, sex: "F", phone: "012-660 3381", nextOfKin: "Zainal (father)", allergies: [], conditions: [] },
    responder: { symptoms: ["Passenger in collision", "Chest wall pain", "Seatbelt sign"], treatment: [{ at: "+2m", action: "Spinal precautions" }, { at: "+4m", action: "O2 via mask" }, { at: "+6m", action: "IV access, fluids 250 mL" }], vitals: { hr: 116, bpSys: 100, bpDia: 64, spo2: 95, rr: 24, gcs: 15 }, notes: "Same collision as earlier Jalan Tun Razak call (second caller)." },
    hospital: { facilityName: "Hospital Kuala Lumpur", ward: "Surgical HDU", bed: "2", admittedDiagnosis: "Blunt chest trauma, rib fractures", treatment: ["CT chest/abdomen", "Analgesia", "Incentive spirometry"], status: "Observation" },
  },
  "11_p1_manglish_petaling_jaya_stroke": {
    identity: { name: "Gurdev Singh a/l Harbans", ic: "600615-10-7301", age: 66, sex: "M", phone: "019-330 6624", nextOfKin: "Manjit Kaur (wife)", allergies: [], conditions: ["Hypertension", "Hyperlipidaemia"] },
    responder: { symptoms: ["Right facial droop", "Right arm weakness", "Slurred speech", "Onset 25 min ago"], treatment: [{ at: "+1m", action: "FAST positive, onset time confirmed" }, { at: "+2m", action: "Glucose 7.4 mmol/L" }, { at: "+4m", action: "Stroke pre-alert recommended" }], vitals: { hr: 88, bpSys: 182, bpDia: 102, spo2: 96, rr: 18, gcs: 14 }, notes: "Within thrombolysis window. Keep NBM." },
    hospital: { facilityName: "University Malaya Medical Centre", ward: "Acute Stroke Unit", bed: "S5", admittedDiagnosis: "Acute left MCA ischaemic stroke", treatment: ["CT/CTA brain", "IV tenecteplase", "Neuro obs hourly"], status: "Post-thrombolysis" },
  },
  "12_p2_tamil_titiwangsa_collision": {
    identity: { name: "Arun a/l Ramasamy", ic: "880119-14-5237", age: 37, sex: "M", phone: "016-448 2273", allergies: ["NSAIDs"], conditions: [] },
    responder: { symptoms: ["Neck pain", "Right knee abrasion", "Ambulatory at scene"], treatment: [{ at: "+2m", action: "C-collar applied" }, { at: "+4m", action: "Knee wound dressed" }], vitals: { hr: 90, bpSys: 134, bpDia: 86, spo2: 98, rr: 16, gcs: 15 }, notes: "Rear-end collision, low speed. Avoid NSAIDs." },
    hospital: { facilityName: "Hospital Kuala Lumpur", ward: "ED Observation", bed: "O7", admittedDiagnosis: "Whiplash injury, knee abrasion", treatment: ["C-spine X-ray", "Paracetamol", "Wound care"], status: "Stable" },
  },
};

const FALLBACK: Record<string, PatientSeed> = {
  P1: { identity: { name: "Unidentified adult", ic: "000000-00-0000", age: 50, sex: "M", phone: "unknown", allergies: [], conditions: [] }, responder: { symptoms: ["Altered consciousness", "Tachycardia"], treatment: [{ at: "+1m", action: "Airway assessment, O2 applied" }, { at: "+3m", action: "IV access, cardiac monitoring" }], vitals: { hr: 118, bpSys: 96, bpDia: 60, spo2: 92, rr: 24, gcs: 12 }, notes: "Identity not yet confirmed." }, hospital: { facilityName: "Hospital Kuala Lumpur", ward: "Resus", bed: "R1", admittedDiagnosis: "Under evaluation", treatment: ["Primary survey", "Bloods, ECG"], status: "Resuscitation" } },
  P2: { identity: { name: "Unidentified adult", ic: "000000-00-0000", age: 45, sex: "F", phone: "unknown", allergies: [], conditions: [] }, responder: { symptoms: ["Pain", "Minor injury"], treatment: [{ at: "+2m", action: "Analgesia" }, { at: "+4m", action: "Wound care" }], vitals: { hr: 98, bpSys: 128, bpDia: 80, spo2: 97, rr: 18, gcs: 15 }, notes: "Identity not yet confirmed." }, hospital: { facilityName: "Hospital Kuala Lumpur", ward: "ED Observation", admittedDiagnosis: "Under evaluation", treatment: ["Assessment", "Imaging as required"], status: "Stable" } },
  P3: { identity: { name: "Unidentified adult", ic: "000000-00-0000", age: 30, sex: "M", phone: "unknown", allergies: [], conditions: [] }, responder: { symptoms: ["Minor injury"], treatment: [{ at: "+2m", action: "First aid" }], vitals: { hr: 82, bpSys: 122, bpDia: 76, spo2: 99, rr: 14, gcs: 15 }, notes: "Identity not yet confirmed." }, hospital: { facilityName: "Hospital Kuala Lumpur", ward: "ED Minor", admittedDiagnosis: "Minor injury", treatment: ["Assessment"], status: "Stable" } },
};

export function seedFor(sampleName: string | undefined, priority: string | null | undefined): PatientSeed {
  const key = sampleName?.replace(/\.mp3$/, "");
  return (key && SEEDS[key]) || FALLBACK[priority ?? "P3"] || FALLBACK.P3;
}
