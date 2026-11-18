import { getPaletteColor } from "../palette";
import type { InstrumentAdapter, UniversalDataset } from "../types";

export interface GenericXYResult {
  xLabel: string;
  yLabel: string;
  xUnit: string;
  yUnit: string;
  xValues: number[];
  yValues: number[];
  peakX?: number;
  peakY?: number;
  areaUnderCurve?: number;
}

export function createGenericInstrumentAdapter(
  type: "DSC" | "TGA" | "LFA" | "FTIR" | "GENERIC",
  displayName: string,
  category: "Thermal" | "Spectroscopy" | "Generic",
  xLabel: string,
  yLabel: string,
  xUnit: string,
  yUnit: string
): InstrumentAdapter<any, GenericXYResult> {
  return {
    instrumentType: type,
    displayName,
    category,
    acceptedExtensions: [".csv", ".txt", ".dat", ".xy"],
    mimeAccept: ".csv,.txt,.dat,.xy,text/plain,text/csv",
    description: `${displayName} 복수 시험 데이터셋의 다중 곡선 중첩 및 피크/전이점 비교 분석.`,

    extractMetadata: (fileName: string) => {
      const stem = fileName.replace(/\.[^/.]+$/, "");
      return {
        sampleName: stem,
        specimenOrCondition: "시편 1",
      };
    },

    parseData: async (file: File) => {
      const text = await file.text();
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
      const xVals: number[] = [];
      const yVals: number[] = [];

      for (const line of lines) {
        if (/^[a-zA-Z#/*]/.test(line)) continue;
        const parts = line.split(/[,;\t\s]+/).map(Number);
        if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          xVals.push(parts[0]);
          yVals.push(parts[1]);
        }
      }

      return { xVals, yVals, fileName: file.name };
    },

    analyzeData: async (raw: any): Promise<GenericXYResult> => {
      const xValues = raw.xVals || [];
      const yValues = raw.yVals || [];
      let maxIdx = 0;
      let maxY = -Infinity;
      for (let i = 0; i < yValues.length; i++) {
        if (yValues[i] > maxY) {
          maxY = yValues[i];
          maxIdx = i;
        }
      }
      return {
        xLabel,
        yLabel,
        xUnit,
        yUnit,
        xValues,
        yValues,
        peakX: xValues[maxIdx],
        peakY: maxY,
      };
    },

    createSampleDatasets: async (): Promise<UniversalDataset<any, GenericXYResult>[]> => {
      const sampleNames = ["Run #1 (10℃/min)", "Run #2 (20℃/min)"];
      return sampleNames.map((cond, idx) => {
        const xValues: number[] = [];
        const yValues: number[] = [];
        for (let x = 50; x <= 350; x += 1) {
          xValues.push(x);
          const peakCenter = 180 + idx * 12;
          const peak = 15 * Math.exp(-Math.pow(x - peakCenter, 2) / 250);
          const baseline = 0.5 + 0.005 * x;
          yValues.push(+(baseline + peak).toFixed(3));
        }

        return {
          id: `sample-${type.toLowerCase()}-${idx + 1}`,
          fileName: `${type}_Sample_${idx + 1}.csv`,
          fileSize: 12400,
          sampleName: `${type} Polymer Blend`,
          specimenOrCondition: cond,
          color: getPaletteColor(idx),
          visible: true,
          status: "success",
          progress: 100,
          rawData: { xVals: xValues, yVals: yValues },
          analysisResult: {
            xLabel,
            yLabel,
            xUnit,
            yUnit,
            xValues,
            yValues,
            peakX: 180 + idx * 12,
            peakY: +(15 + 0.5).toFixed(2),
          },
          instrumentType: type,
          createdAt: Date.now() - (2 - idx) * 60000,
        };
      });
    },
  };
}

export const dscAdapter = createGenericInstrumentAdapter(
  "DSC",
  "DSC 시차주사열량계 (열전이/유리전이온도)",
  "Thermal",
  "온도 (Temperature)",
  "열류 (Heat Flow)",
  "℃",
  "mW/mg"
);

export const tgaAdapter = createGenericInstrumentAdapter(
  "TGA",
  "TGA 열중량분석기 (중량감소/열분해)",
  "Thermal",
  "온도 (Temperature)",
  "질량 잔존율 (Weight %)",
  "℃",
  "%"
);

export const ftirAdapter = createGenericInstrumentAdapter(
  "FTIR",
  "FTIR 적외선분광기 (흡수/투과 스펙트럼)",
  "Spectroscopy",
  "파수 (Wavenumber)",
  "투과율 (Transmittance)",
  "cm⁻¹",
  "%"
);
