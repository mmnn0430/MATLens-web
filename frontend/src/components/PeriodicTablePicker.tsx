import { useState } from "react";
import { X, RotateCcw, Grid, ChevronDown, ChevronUp } from "lucide-react";

export interface ElementDef {
  z: number;
  symbol: string;
  nameKo: string;
  row: number; // 1..7 main table, 8 = Lanthanides, 9 = Actinides
  col: number; // 1..18
  cat: "nonmetal" | "alkali" | "alkaline" | "transition" | "post" | "metalloid" | "halogen" | "noble" | "lanth" | "act";
}

export const PERIODIC_ELEMENTS: ElementDef[] = [
  // Period 1
  { z: 1, symbol: "H", nameKo: "수소", row: 1, col: 1, cat: "nonmetal" },
  { z: 2, symbol: "He", nameKo: "헬륨", row: 1, col: 18, cat: "noble" },
  // Period 2
  { z: 3, symbol: "Li", nameKo: "리튬", row: 2, col: 1, cat: "alkali" },
  { z: 4, symbol: "Be", nameKo: "베릴륨", row: 2, col: 2, cat: "alkaline" },
  { z: 5, symbol: "B", nameKo: "붕소", row: 2, col: 13, cat: "metalloid" },
  { z: 6, symbol: "C", nameKo: "탄소", row: 2, col: 14, cat: "nonmetal" },
  { z: 7, symbol: "N", nameKo: "질소", row: 2, col: 15, cat: "nonmetal" },
  { z: 8, symbol: "O", nameKo: "산소", row: 2, col: 16, cat: "nonmetal" },
  { z: 9, symbol: "F", nameKo: "플루오린", row: 2, col: 17, cat: "halogen" },
  { z: 10, symbol: "Ne", nameKo: "네온", row: 2, col: 18, cat: "noble" },
  // Period 3
  { z: 11, symbol: "Na", nameKo: "나트륨", row: 3, col: 1, cat: "alkali" },
  { z: 12, symbol: "Mg", nameKo: "마그네슘", row: 3, col: 2, cat: "alkaline" },
  { z: 13, symbol: "Al", nameKo: "알루미늄", row: 3, col: 13, cat: "post" },
  { z: 14, symbol: "Si", nameKo: "규소", row: 3, col: 14, cat: "metalloid" },
  { z: 15, symbol: "P", nameKo: "인", row: 3, col: 15, cat: "nonmetal" },
  { z: 16, symbol: "S", nameKo: "황", row: 3, col: 16, cat: "nonmetal" },
  { z: 17, symbol: "Cl", nameKo: "염소", row: 3, col: 17, cat: "halogen" },
  { z: 18, symbol: "Ar", nameKo: "아르곤", row: 3, col: 18, cat: "noble" },
  // Period 4
  { z: 19, symbol: "K", nameKo: "칼륨", row: 4, col: 1, cat: "alkali" },
  { z: 20, symbol: "Ca", nameKo: "칼슘", row: 4, col: 2, cat: "alkaline" },
  { z: 21, symbol: "Sc", nameKo: "스칸듐", row: 4, col: 3, cat: "transition" },
  { z: 22, symbol: "Ti", nameKo: "티타늄", row: 4, col: 4, cat: "transition" },
  { z: 23, symbol: "V", nameKo: "바나듐", row: 4, col: 5, cat: "transition" },
  { z: 24, symbol: "Cr", nameKo: "크로뮴", row: 4, col: 6, cat: "transition" },
  { z: 25, symbol: "Mn", nameKo: "망가니즈", row: 4, col: 7, cat: "transition" },
  { z: 26, symbol: "Fe", nameKo: "철", row: 4, col: 8, cat: "transition" },
  { z: 27, symbol: "Co", nameKo: "코발트", row: 4, col: 9, cat: "transition" },
  { z: 28, symbol: "Ni", nameKo: "니켈", row: 4, col: 10, cat: "transition" },
  { z: 29, symbol: "Cu", nameKo: "구리", row: 4, col: 11, cat: "transition" },
  { z: 30, symbol: "Zn", nameKo: "아연", row: 4, col: 12, cat: "transition" },
  { z: 31, symbol: "Ga", nameKo: "갈륨", row: 4, col: 13, cat: "post" },
  { z: 32, symbol: "Ge", nameKo: "저마늄", row: 4, col: 14, cat: "metalloid" },
  { z: 33, symbol: "As", nameKo: "비소", row: 4, col: 15, cat: "metalloid" },
  { z: 34, symbol: "Se", nameKo: "셀레늄", row: 4, col: 16, cat: "nonmetal" },
  { z: 35, symbol: "Br", nameKo: "브로민", row: 4, col: 17, cat: "halogen" },
  { z: 36, symbol: "Kr", nameKo: "크립톤", row: 4, col: 18, cat: "noble" },
  // Period 5
  { z: 37, symbol: "Rb", nameKo: "루비듐", row: 5, col: 1, cat: "alkali" },
  { z: 38, symbol: "Sr", nameKo: "스트론튬", row: 5, col: 2, cat: "alkaline" },
  { z: 39, symbol: "Y", nameKo: "이트륨", row: 5, col: 3, cat: "transition" },
  { z: 40, symbol: "Zr", nameKo: "지르코늄", row: 5, col: 4, cat: "transition" },
  { z: 41, symbol: "Nb", nameKo: "니오븀", row: 5, col: 5, cat: "transition" },
  { z: 42, symbol: "Mo", nameKo: "몰리브데넘", row: 5, col: 6, cat: "transition" },
  { z: 43, symbol: "Tc", nameKo: "테크네튬", row: 5, col: 7, cat: "transition" },
  { z: 44, symbol: "Ru", nameKo: "루테늄", row: 5, col: 8, cat: "transition" },
  { z: 45, symbol: "Rh", nameKo: "로듐", row: 5, col: 9, cat: "transition" },
  { z: 46, symbol: "Pd", nameKo: "팔라듐", row: 5, col: 10, cat: "transition" },
  { z: 47, symbol: "Ag", nameKo: "은", row: 5, col: 11, cat: "transition" },
  { z: 48, symbol: "Cd", nameKo: "카드뮴", row: 5, col: 12, cat: "transition" },
  { z: 49, symbol: "In", nameKo: "인듐", row: 5, col: 13, cat: "post" },
  { z: 50, symbol: "Sn", nameKo: "주석", row: 5, col: 14, cat: "post" },
  { z: 51, symbol: "Sb", nameKo: "안티모니", row: 5, col: 15, cat: "metalloid" },
  { z: 52, symbol: "Te", nameKo: "텔루륨", row: 5, col: 16, cat: "metalloid" },
  { z: 53, symbol: "I", nameKo: "아이오딘", row: 5, col: 17, cat: "halogen" },
  { z: 54, symbol: "Xe", nameKo: "제논", row: 5, col: 18, cat: "noble" },
  // Period 6
  { z: 55, symbol: "Cs", nameKo: "세슘", row: 6, col: 1, cat: "alkali" },
  { z: 56, symbol: "Ba", nameKo: "바륨", row: 6, col: 2, cat: "alkaline" },
  { z: 72, symbol: "Hf", nameKo: "하프늄", row: 6, col: 4, cat: "transition" },
  { z: 73, symbol: "Ta", nameKo: "탄탈럼", row: 6, col: 5, cat: "transition" },
  { z: 74, symbol: "W", nameKo: "텅스텐", row: 6, col: 6, cat: "transition" },
  { z: 75, symbol: "Re", nameKo: "레늄", row: 6, col: 7, cat: "transition" },
  { z: 76, symbol: "Os", nameKo: "오스뮴", row: 6, col: 8, cat: "transition" },
  { z: 77, symbol: "Ir", nameKo: "이리듐", row: 6, col: 9, cat: "transition" },
  { z: 78, symbol: "Pt", nameKo: "백금", row: 6, col: 10, cat: "transition" },
  { z: 79, symbol: "Au", nameKo: "금", row: 6, col: 11, cat: "transition" },
  { z: 80, symbol: "Hg", nameKo: "수은", row: 6, col: 12, cat: "transition" },
  { z: 81, symbol: "Tl", nameKo: "탈륨", row: 6, col: 13, cat: "post" },
  { z: 82, symbol: "Pb", nameKo: "납", row: 6, col: 14, cat: "post" },
  { z: 83, symbol: "Bi", nameKo: "비스무트", row: 6, col: 15, cat: "post" },
  { z: 84, symbol: "Po", nameKo: "폴로늄", row: 6, col: 16, cat: "post" },
  { z: 85, symbol: "At", nameKo: "아스타틴", row: 6, col: 17, cat: "halogen" },
  { z: 86, symbol: "Rn", nameKo: "라돈", row: 6, col: 18, cat: "noble" },
  // Period 7
  { z: 87, symbol: "Fr", nameKo: "프랑슘", row: 7, col: 1, cat: "alkali" },
  { z: 88, symbol: "Ra", nameKo: "라듐", row: 7, col: 2, cat: "alkaline" },
  // Lanthanides (row 8, cols 4..18)
  { z: 57, symbol: "La", nameKo: "란타넘", row: 8, col: 4, cat: "lanth" },
  { z: 58, symbol: "Ce", nameKo: "세륨", row: 8, col: 5, cat: "lanth" },
  { z: 59, symbol: "Pr", nameKo: "프라세오디뮴", row: 8, col: 6, cat: "lanth" },
  { z: 60, symbol: "Nd", nameKo: "네오디뮴", row: 8, col: 7, cat: "lanth" },
  { z: 61, symbol: "Pm", nameKo: "프로메튬", row: 8, col: 8, cat: "lanth" },
  { z: 62, symbol: "Sm", nameKo: "사마륨", row: 8, col: 9, cat: "lanth" },
  { z: 63, symbol: "Eu", nameKo: "유로퓸", row: 8, col: 10, cat: "lanth" },
  { z: 64, symbol: "Gd", nameKo: "가돌리늄", row: 8, col: 11, cat: "lanth" },
  { z: 65, symbol: "Tb", nameKo: "터븀", row: 8, col: 12, cat: "lanth" },
  { z: 66, symbol: "Dy", nameKo: "디스프로슘", row: 8, col: 13, cat: "lanth" },
  { z: 67, symbol: "Ho", nameKo: "홀뮴", row: 8, col: 14, cat: "lanth" },
  { z: 68, symbol: "Er", nameKo: "어븀", row: 8, col: 15, cat: "lanth" },
  { z: 69, symbol: "Tm", nameKo: "툴륨", row: 8, col: 16, cat: "lanth" },
  { z: 70, symbol: "Yb", nameKo: "이터븀", row: 8, col: 17, cat: "lanth" },
  { z: 71, symbol: "Lu", nameKo: "루테튬", row: 8, col: 18, cat: "lanth" },
  // Actinides (row 9, cols 4..18)
  { z: 89, symbol: "Ac", nameKo: "악티늄", row: 9, col: 4, cat: "act" },
  { z: 90, symbol: "Th", nameKo: "토륨", row: 9, col: 5, cat: "act" },
  { z: 91, symbol: "Pa", nameKo: "프로트악티늄", row: 9, col: 6, cat: "act" },
  { z: 92, symbol: "U", nameKo: "우라늄", row: 9, col: 7, cat: "act" },
];

const CAT_STYLES: Record<ElementDef["cat"], string> = {
  nonmetal: "bg-[#ECFDF5] text-[#065F46] border-[#A7F3D0] hover:border-[#10B981]",
  alkali: "bg-[#FEF2F2] text-[#991B1B] border-[#FECACA] hover:border-[#EF4444]",
  alkaline: "bg-[#FFF7ED] text-[#9A3412] border-[#FED7AA] hover:border-[#F97316]",
  transition: "bg-[#F8FAFC] text-[#1E293B] border-[#E2E8F0] hover:border-[#3182F6]",
  post: "bg-[#F0F9FF] text-[#075985] border-[#BAE6FD] hover:border-[#0284C7]",
  metalloid: "bg-[#FEFCE8] text-[#854D0E] border-[#FEF08A] hover:border-[#EAB308]",
  halogen: "bg-[#F0FDFA] text-[#115E59] border-[#99F6E4] hover:border-[#14B8A6]",
  noble: "bg-[#FAF5FF] text-[#6B21A8] border-[#E9D5FF] hover:border-[#A855F7]",
  lanth: "bg-[#FDF4FF] text-[#86198F] border-[#F5D0FE] hover:border-[#D946EF]",
  act: "bg-[#FFF1F2] text-[#9F1239] border-[#FECDD3] hover:border-[#F43F5E]",
};

interface PeriodicTablePickerProps {
  selectedElements: string[];
  onChange: (nextElements: string[]) => void;
  defaultExpanded?: boolean;
  compact?: boolean;
}

export function PeriodicTablePicker({
  selectedElements,
  onChange,
  defaultExpanded = true,
}: PeriodicTablePickerProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [hoveredEl, setHoveredEl] = useState<ElementDef | null>(null);

  const toggleElement = (sym: string) => {
    if (selectedElements.includes(sym)) {
      onChange(selectedElements.filter((e) => e !== sym));
    } else {
      onChange([...selectedElements, sym]);
    }
  };

  const byCoord = new Map<string, ElementDef>();
  for (const el of PERIODIC_ELEMENTS) {
    byCoord.set(`${el.row}-${el.col}`, el);
  }

  return (
    <div className="rounded-[14px] border border-[#E5E8EB] bg-[#F7F8FA]/70 p-3.5 space-y-3">
      {/* Top Bar: Selected Element Chips & Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-bold text-[#191F28] flex items-center gap-1.5">
            <Grid className="w-4 h-4 text-[#3182F6]" />
            주기율표에서 예상 원소 클릭 선택
          </span>
          {selectedElements.length === 0 ? (
            <span className="text-[12px] text-[#6B7684] bg-white px-2.5 py-1 rounded-full border border-[#E5E8EB]">
              선택 없음 (전체 기준 라이브러리 검색)
            </span>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              {selectedElements.map((sym) => {
                const info = PERIODIC_ELEMENTS.find((e) => e.symbol === sym);
                return (
                  <button
                    key={sym}
                    type="button"
                    onClick={() => toggleElement(sym)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#3182F6] text-white text-[12px] font-bold shadow-xs hover:bg-[#1B64DA] cursor-pointer transition-colors"
                    title={`${sym} (${info?.nameKo || ""}) 선택 해제`}
                  >
                    <span>{sym}</span>
                    {info && <span className="text-[10px] font-normal opacity-90">{info.nameKo}</span>}
                    <X className="w-3 h-3 ml-0.5" />
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => onChange([])}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold text-[#6B7684] hover:text-[#DC2626] bg-white border border-[#E5E8EB] cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                초기화
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#3182F6] bg-white px-2.5 py-1.5 rounded-[10px] border border-[#E5E8EB] hover:border-[#3182F6] cursor-pointer shrink-0"
        >
          {expanded ? (
            <>
              주기율표 접기 <ChevronUp className="w-3.5 h-3.5" />
            </>
          ) : (
            <>
              주기율표 펼치기 <ChevronDown className="w-3.5 h-3.5" />
            </>
          )}
        </button>
      </div>

      {/* Hovered Element Info */}
      {expanded && (
        <>
          <div className="flex flex-wrap items-center justify-end gap-2 pt-0.5">
            <div className="text-[12px] text-[#6B7684] min-h-[20px]">
              {hoveredEl ? (
                <span>
                  원자번호 <strong className="text-[#191F28] tabular-nums">{hoveredEl.z}</strong> ·{" "}
                  <strong className="text-[#3182F6]">{hoveredEl.symbol}</strong> ({hoveredEl.nameKo})
                </span>
              ) : (
                <span>원소 칸을 클릭하면 선택·해제됩니다</span>
              )}
            </div>
          </div>

          {/* 18-Column Full-Width Periodic Table Grid */}
          <div className="w-full pb-1">
            <div
              className="grid gap-1 w-full"
              style={{ gridTemplateColumns: "repeat(18, minmax(0, 1fr))" }}
            >
              {[1, 2, 3, 4, 5, 6, 7].map((row) =>
                Array.from({ length: 18 }, (_, i) => i + 1).map((col) => {
                  const el = byCoord.get(`${row}-${col}`);
                  if (!el) {
                    if (row === 6 && col === 3) {
                      return (
                        <div
                          key={`${row}-${col}`}
                          className="h-11 rounded-[6px] border border-dashed border-[#E9D5FF] bg-[#FDF4FF]/50 flex items-center justify-center text-[9px] text-[#86198F] font-semibold select-none"
                        >
                          57-71
                        </div>
                      );
                    }
                    if (row === 7 && col === 3) {
                      return (
                        <div
                          key={`${row}-${col}`}
                          className="h-11 rounded-[6px] border border-dashed border-[#FECDD3] bg-[#FFF1F2]/50 flex items-center justify-center text-[9px] text-[#9F1239] font-semibold select-none"
                        >
                          89-92
                        </div>
                      );
                    }
                    return <div key={`${row}-${col}`} className="h-11" />;
                  }

                  const isSelected = selectedElements.includes(el.symbol);
                  return (
                    <button
                      key={el.symbol}
                      type="button"
                      onMouseEnter={() => setHoveredEl(el)}
                      onMouseLeave={() => setHoveredEl(null)}
                      onClick={() => toggleElement(el.symbol)}
                      title={`${el.z}. ${el.symbol} (${el.nameKo})`}
                      className={`h-11 rounded-[7px] border flex flex-col items-center justify-center leading-none transition-all cursor-pointer select-none px-0.5 ${
                        isSelected
                          ? "bg-[#3182F6] text-white border-[#1B64DA] shadow-sm scale-[1.04] z-10 font-bold"
                          : CAT_STYLES[el.cat]
                      }`}
                    >
                      <span
                        className={`text-[8px] tabular-nums ${
                          isSelected ? "text-white/85" : "opacity-65"
                        }`}
                      >
                        {el.z}
                      </span>
                      <span className="text-[12px] font-bold tracking-tight mt-0.5">{el.symbol}</span>
                      <span
                        className={`text-[8px] truncate max-w-full mt-0.5 ${
                          isSelected ? "text-white/90" : "opacity-75"
                        }`}
                      >
                        {el.nameKo}
                      </span>
                    </button>
                  );
                })
              )}

              {/* Spacer before Lanthanides / Actinides */}
              <div className="col-span-18 h-1.5" />

              {[8, 9].map((row) =>
                Array.from({ length: 18 }, (_, i) => i + 1).map((col) => {
                  if (col === 2) {
                    return (
                      <div
                        key={`label-${row}-${col}`}
                        className="col-span-2 h-10 flex items-center justify-end pr-1.5 text-[10px] font-semibold text-[#6B7684] select-none"
                      >
                        {row === 8 ? "란타넘족" : "악티늄족"}
                      </div>
                    );
                  }
                  if (col === 3) return null;
                  const el = byCoord.get(`${row}-${col}`);
                  if (!el) return <div key={`${row}-${col}`} className="h-10" />;
                  const isSelected = selectedElements.includes(el.symbol);
                  return (
                    <button
                      key={el.symbol}
                      type="button"
                      onMouseEnter={() => setHoveredEl(el)}
                      onMouseLeave={() => setHoveredEl(null)}
                      onClick={() => toggleElement(el.symbol)}
                      title={`${el.z}. ${el.symbol} (${el.nameKo})`}
                      className={`h-10 rounded-[7px] border flex flex-col items-center justify-center leading-none transition-all cursor-pointer select-none px-0.5 ${
                        isSelected
                          ? "bg-[#3182F6] text-white border-[#1B64DA] shadow-sm scale-[1.04] z-10 font-bold"
                          : CAT_STYLES[el.cat]
                      }`}
                    >
                      <span
                        className={`text-[8px] tabular-nums ${
                          isSelected ? "text-white/85" : "opacity-65"
                        }`}
                      >
                        {el.z}
                      </span>
                      <span className="text-[11px] font-bold tracking-tight mt-0.5">{el.symbol}</span>
                      <span
                        className={`text-[8px] truncate max-w-full mt-0.5 ${
                          isSelected ? "text-white/90" : "opacity-75"
                        }`}
                      >
                        {el.nameKo}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
