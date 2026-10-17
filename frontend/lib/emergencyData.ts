import type {
  AmbulanceUnit,
  Coordinate,
  CrewShift,
  Hospital,
  Incident,
  ResponseRoute,
  Severity,
  UnitStatus,
} from "@/types/emergency";

export const klCenter: Coordinate = [101.7008, 3.1478];

export const hospitals: Hospital[] = [
  {
    id: "hkl",
    name: "Hospital Kuala Lumpur",
    area: "Jalan Pahang",
    coordinate: [101.7006, 3.1727],
    edCapacity: 82,
    ambulanceBays: 5,
    traumaAvailable: true,
    icuAvailable: true,
    availableUnits: 5,
    nearbyIncidents: 7,
  },
  {
    id: "ijn",
    name: "Institut Jantung Negara",
    area: "Tun Razak",
    coordinate: [101.7047, 3.1714],
    edCapacity: 71,
    ambulanceBays: 3,
    traumaAvailable: false,
    icuAvailable: true,
    availableUnits: 3,
    nearbyIncidents: 5,
  },
  {
    id: "hctm",
    name: "HCTM UKM",
    area: "Bandar Tun Razak",
    coordinate: [101.7275, 3.0985],
    edCapacity: 76,
    ambulanceBays: 4,
    traumaAvailable: true,
    icuAvailable: true,
    availableUnits: 4,
    nearbyIncidents: 4,
  },
  {
    id: "umsc",
    name: "UM Specialist Centre",
    area: "Petaling Jaya",
    coordinate: [101.6512, 3.1147],
    edCapacity: 63,
    ambulanceBays: 2,
    traumaAvailable: true,
    icuAvailable: false,
    availableUnits: 2,
    nearbyIncidents: 3,
  },
  {
    id: "setapak",
    name: "Setapak Emergency Base",
    area: "Setapak",
    coordinate: [101.7201, 3.1997],
    edCapacity: 58,
    ambulanceBays: 3,
    traumaAvailable: false,
    icuAvailable: false,
    availableUnits: 3,
    nearbyIncidents: 6,
  },
];

const incidentTypes = [
  "Cardiac distress",
  "Road accident",
  "Respiratory emergency",
  "Fall injury",
  "Stroke symptoms",
  "Trauma response",
  "Maternal emergency",
  "Heat exhaustion",
];

const incidentAreas = [
  ["Bukit Bintang", "Zone A", 101.7117, 3.1466],
  ["KLCC", "Zone A", 101.7123, 3.1579],
  ["Kampung Baru", "Zone B", 101.7063, 3.1644],
  ["Titiwangsa", "Zone B", 101.7049, 3.1801],
  ["Setapak", "Zone C", 101.7201, 3.1997],
  ["PPR Kerinchi", "Zone D", 101.6684, 3.1118],
  ["Bangsar South", "Zone D", 101.6642, 3.1105],
  ["Cheras", "Zone E", 101.7375, 3.1057],
  ["Masjid Jamek", "Zone A", 101.6968, 3.1486],
  ["Sentul", "Zone C", 101.6958, 3.1862],
];

const severityCycle: Severity[] = [
  "Critical",
  "High",
  "Medium",
  "Low",
  "High",
  "Medium",
  "Critical",
  "Medium",
];

export const incidents: Incident[] = Array.from({ length: 25 }, (_, index) => {
  const area = incidentAreas[index % incidentAreas.length];
  const severity = severityCycle[index % severityCycle.length];
  const assignedUnitId = index < 10 ? `AMB-${String(index + 1).padStart(2, "0")}` : undefined;
  const minutesOpen = 3 + ((index * 4) % 42);
  return {
    id: `INC-${2048 + index}`,
    type: incidentTypes[index % incidentTypes.length],
    severity,
    status: assignedUnitId ? (index % 3 === 0 ? "On scene" : "En route") : "New",
    area: area[0] as string,
    zone: area[1] as string,
    coordinate: [
      (area[2] as number) + ((index % 5) - 2) * 0.0022,
      (area[3] as number) + ((index % 4) - 1.5) * 0.0018,
    ],
    minutesOpen,
    assignedUnitId,
    etaMinutes: severity === "Critical" ? 5 + (index % 5) : 8 + (index % 9),
    targetStatus:
      minutesOpen > 28 ? "Breached" : minutesOpen > 16 ? "At risk" : "On target",
    receivingHospitalId: hospitals[index % hospitals.length].id,
  };
});

const unitStatuses: UnitStatus[] = [
  "Available",
  "En route",
  "On scene",
  "Transporting",
  "At hospital",
  "Available",
  "En route",
  "Offline",
];

const crewNames = [
  "Alpha Medic",
  "Bravo Response",
  "Charlie ALS",
  "Delta Trauma",
  "Echo Care",
  "Foxtrot ICU",
  "Gamma Rapid",
  "Helix Neonatal",
];

export const ambulances: AmbulanceUnit[] = Array.from({ length: 20 }, (_, index) => {
  const hospital = hospitals[index % hospitals.length];
  const status = unitStatuses[index % unitStatuses.length];
  const incident = incidents.find((item) => item.assignedUnitId === `AMB-${String(index + 1).padStart(2, "0")}`);
  return {
    id: `AMB-${String(index + 1).padStart(2, "0")}`,
    crew: crewNames[index % crewNames.length],
    status,
    baseHospitalId: hospital.id,
    coordinate: [
      hospital.coordinate[0] + ((index % 5) - 2) * 0.005,
      hospital.coordinate[1] + ((index % 4) - 1.5) * 0.004,
    ],
    assignedIncidentId: incident?.id,
    etaMinutes: incident?.etaMinutes,
    distanceKm: incident ? Number((2.4 + (index % 8) * 0.8).toFixed(1)) : undefined,
    equipment: index % 7 === 0 ? "Neonatal" : index % 5 === 0 ? "ICU" : index % 2 === 0 ? "ALS" : "BLS",
    fuelLevel: 54 + ((index * 7) % 45),
    lastUpdate: `${1 + (index % 9)} min ago`,
  };
});

export const responseRoutes: ResponseRoute[] = incidents
  .filter((incident) => incident.assignedUnitId)
  .slice(0, 10)
  .map((incident, index) => {
    const unit = ambulances.find((ambulance) => ambulance.id === incident.assignedUnitId) ?? ambulances[index];
    const hospital = hospitals.find((item) => item.id === unit.baseHospitalId) ?? hospitals[0];
    const bend: Coordinate = [
      (hospital.coordinate[0] + incident.coordinate[0]) / 2 + ((index % 3) - 1) * 0.01,
      (hospital.coordinate[1] + incident.coordinate[1]) / 2 + ((index % 2) - 0.5) * 0.008,
    ];
    return {
      id: `RTE-${incident.id}`,
      unitId: unit.id,
      incidentId: incident.id,
      hospitalId: hospital.id,
      color: incident.severity === "Critical" ? "#dc2626" : unit.status === "Transporting" ? "#7c3aed" : "#2563eb",
      coordinates: [hospital.coordinate, bend, incident.coordinate],
      etaMinutes: incident.etaMinutes,
      distanceKm: unit.distanceKm ?? 3.8,
    };
  });

export const crewShifts: CrewShift[] = Array.from({ length: 12 }, (_, index) => {
  const hospital = hospitals[index % hospitals.length];
  const startHour = [6, 8, 14, 22][index % 4];
  const endHour = startHour === 22 ? 30 : startHour + 8;
  return {
    id: `SHIFT-${index + 1}`,
    crew: crewNames[index % crewNames.length],
    initials: crewNames[index % crewNames.length]
      .split(" ")
      .map((part) => part[0])
      .join(""),
    baseHospitalId: hospital.id,
    certifications: index % 3 === 0 ? ["ALS", "ICU"] : index % 2 === 0 ? ["ALS"] : ["BLS"],
    unitId: ambulances[index % ambulances.length].id,
    startHour,
    endHour,
    label: startHour === 6 ? "Morning" : startHour === 8 ? "Day" : startHour === 14 ? "Evening" : "Night",
  };
});

export const analyticsTrend = [8.6, 8.1, 7.9, 8.4, 7.8, 7.4, 7.8, 8.0, 7.6, 7.3, 7.8, 8.2];
export const hourlyDemand = Array.from({ length: 24 }, (_, hour) => ({
  hour,
  zones: [0, 1, 2, 3, 4].map((zone) => 2 + ((hour * (zone + 2) + zone) % 9)),
}));

export function hospitalName(id: string) {
  return hospitals.find((hospital) => hospital.id === id)?.name ?? "Emergency Department";
}

export function incidentById(id?: string) {
  return incidents.find((incident) => incident.id === id);
}

export function unitById(id?: string) {
  return ambulances.find((unit) => unit.id === id);
}
