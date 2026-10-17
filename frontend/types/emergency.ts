export type Coordinate = [number, number];

export type Severity = "Critical" | "High" | "Medium" | "Low";
export type IncidentStatus =
  | "New"
  | "Assigned"
  | "En route"
  | "On scene"
  | "Transporting"
  | "Completed";
export type UnitStatus =
  | "Available"
  | "En route"
  | "On scene"
  | "Transporting"
  | "At hospital"
  | "Offline";
export type EquipmentType = "ALS" | "BLS" | "ICU" | "Neonatal";
export type TargetStatus = "On target" | "At risk" | "Breached";

export type Hospital = {
  id: string;
  name: string;
  area: string;
  coordinate: Coordinate;
  edCapacity: number;
  ambulanceBays: number;
  traumaAvailable: boolean;
  icuAvailable: boolean;
  availableUnits: number;
  nearbyIncidents: number;
};

export type Incident = {
  id: string;
  type: string;
  severity: Severity;
  status: IncidentStatus;
  area: string;
  zone: string;
  coordinate: Coordinate;
  minutesOpen: number;
  assignedUnitId?: string;
  etaMinutes: number;
  etaAvailable?: boolean;
  allocationStatus?: "assigned" | "recommended" | "unassigned";
  targetStatus: TargetStatus;
  receivingHospitalId: string;
};

export type AmbulanceUnit = {
  id: string;
  crew: string;
  status: UnitStatus;
  baseHospitalId: string;
  coordinate: Coordinate;
  assignedIncidentId?: string;
  etaMinutes?: number;
  distanceKm?: number;
  equipment: EquipmentType;
  fuelLevel: number;
  lastUpdate: string;
};

export type ResponseRoute = {
  id: string;
  unitId: string;
  incidentId: string;
  hospitalId: string;
  color: string;
  coordinates: Coordinate[];
  etaMinutes: number;
  distanceKm: number;
  leg?: "to_scene" | "to_hospital";
};

export type CrewShift = {
  id: string;
  crew: string;
  initials: string;
  baseHospitalId: string;
  certifications: EquipmentType[];
  unitId: string;
  startHour: number;
  endHour: number;
  label: string;
};
