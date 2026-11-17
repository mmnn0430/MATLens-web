import type { InstrumentAdapter, InstrumentType } from "../types";
import { utmAdapter } from "./utmAdapter";
import { xrdAdapter } from "./xrdAdapter";
import { semAdapter } from "./semAdapter";
import { dscAdapter, tgaAdapter, ftirAdapter } from "./genericAdapter";

export const ADAPTER_REGISTRY: Record<InstrumentType, InstrumentAdapter> = {
  UTM: utmAdapter,
  XRD: xrdAdapter,
  SEM: semAdapter,
  DSC: dscAdapter,
  TGA: tgaAdapter,
  FTIR: ftirAdapter,
  LFA: dscAdapter, // Extensible alias
  GENERIC: dscAdapter,
};

export const ALL_ADAPTERS: InstrumentAdapter[] = [
  utmAdapter,
  xrdAdapter,
  semAdapter,
  dscAdapter,
  tgaAdapter,
  ftirAdapter,
];

export function getInstrumentAdapter(type: InstrumentType): InstrumentAdapter {
  return ADAPTER_REGISTRY[type] || utmAdapter;
}

export function getAllowedExtensions(type: InstrumentType): string[] {
  return getInstrumentAdapter(type).acceptedExtensions;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
