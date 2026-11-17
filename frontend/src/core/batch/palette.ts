/**
 * Curated high-contrast accessible color palette for scientific multi-curve plotting.
 */
export const SCIENTIFIC_PALETTE: string[] = [
  "#2563EB", // Blue / Indigo
  "#10B981", // Emerald
  "#F59E0B", // Amber
  "#EF4444", // Rose / Red
  "#8B5CF6", // Violet
  "#06B6D4", // Cyan
  "#F97316", // Orange
  "#14B8A6", // Teal
  "#EC4899", // Pink
  "#84CC16", // Lime
  "#6366F1", // Slate Indigo
  "#D97706", // Dark Amber
];

export function getPaletteColor(index: number): string {
  return SCIENTIFIC_PALETTE[index % SCIENTIFIC_PALETTE.length];
}

/**
 * Convert hex color to rgba string with transparency
 */
export function hexToRgba(hex: string, alpha: number): string {
  let c = hex.replace("#", "");
  if (c.length === 3) {
    c = c.split("").map((ch) => ch + ch).join("");
  }
  const num = parseInt(c, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
