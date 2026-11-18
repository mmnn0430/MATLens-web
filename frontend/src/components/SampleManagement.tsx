import React, { useEffect, useState } from "react";
import {
  CheckCircle2,
  Clock,
  Edit3,
  FlaskConical,
  FolderPlus,
  Layers,
  Plus,
  Save,
  X,
} from "lucide-react";
import { api } from "../api";
import type { ProjectDetail, ProjectListItem, SampleInstrumentRecord } from "../types";
import { PeriodicTablePicker } from "./PeriodicTablePicker";
import { Button, SourceTag } from "./ui/primitives";

export interface SampleFormPayload {
  sample_name: string;
  expected_formula: string;
  sample_code: string;
  processing_method: string;
  experiment_memo: string;
  description: string;
  expected_elements: string[];
  is_same_sample: boolean;
}

interface SampleRegistrationModalProps {
  open: boolean;
  initialSample?: ProjectDetail | ProjectListItem | null;
  isBusy?: boolean;
  onClose: () => void;
  onSubmit: (payload: SampleFormPayload, editingSampleId?: string) => Promise<void> | void;
}

export function SampleRegistrationModal({
  open,
  initialSample,
  isBusy = false,
  onClose,
  onSubmit,
}: SampleRegistrationModalProps) {
  const isEditing = Boolean(initialSample?.id);
  const [sampleName, setSampleName] = useState("");
  const [chemicalComposition, setChemicalComposition] = useState("");
  const [sampleCode, setSampleCode] = useState("");
  const [processingMethod, setProcessingMethod] = useState("");
  const [experimentMemo, setExperimentMemo] = useState("");
  const [description, setDescription] = useState("");
  const [selectedElems, setSelectedElems] = useState<string[]>([]);
  const [isSameSample, setIsSameSample] = useState(true);
  const [showPeriodicTable, setShowPeriodicTable] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initialSample) {
      setSampleName(initialSample.sample_name || "");
      setChemicalComposition(initialSample.expected_formula || "");
      setSampleCode(initialSample.sample_code || "");
      setProcessingMethod(initialSample.processing_method || "");
      setExperimentMemo(initialSample.experiment_memo || "");
      setDescription(initialSample.description || "");
      setSelectedElems(initialSample.expected_elements || []);
      setIsSameSample(initialSample.is_same_sample ?? true);
    } else {
      setSampleName("");
      setChemicalComposition("");
      setSampleCode("");
      setProcessingMethod("");
      setExperimentMemo("");
      setDescription("");
      setSelectedElems([]);
      setIsSameSample(true);
    }
  }, [open, initialSample]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sampleName.trim()) return;
    await onSubmit(
      {
        sample_name: sampleName.trim(),
        expected_formula: chemicalComposition.trim(),
        sample_code: sampleCode.trim(),
        processing_method: processingMethod.trim(),
        experiment_memo: experimentMemo.trim(),
        description: description.trim(),
        expected_elements: selectedElems,
        is_same_sample: isSameSample,
      },
      initialSample?.id
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-xs p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sample-modal-title"
    >
      <div className="w-full max-w-2xl rounded-[22px] bg-white border border-[#E5E8EB] shadow-xl overflow-hidden my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E8EB] bg-[#F8FAFC]">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-[10px] bg-[#3182F6] text-white flex items-center justify-center">
              <FlaskConical className="w-4 h-4" />
            </span>
            <div>
              <h2 id="sample-modal-title" className="text-[18px] font-bold text-[#191F28]">
                {isEditing ? "시료 정보 수정" : "새 시료 등록하기"}
              </h2>
              <p className="text-[12px] text-[#6B7684]">
                등록된 시료는 XRD, SEM, UTM, Hall, LFA, FT-IR, DSC, TGA 등 모든 분석기기에서 공통으로 선택하여 데이터를 연결할 수 있습니다.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="p-2 rounded-[10px] text-[#6B7684] hover:text-[#191F28] hover:bg-[#E5E8EB]/60 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[13px] font-semibold text-[#191F28] mb-1.5">
                시료명 (Sample Name) <span className="text-[#DC2626]">*</span>
              </label>
              <input
                type="text"
                required
                value={sampleName}
                onChange={(e) => setSampleName(e.target.value)}
                placeholder="예: Nb0.8Ti0.2FeSb 또는 TiO2-500C"
                className="w-full min-h-[42px] px-3.5 rounded-[12px] border border-[#E5E8EB] text-[14px] focus:outline-none focus:border-[#3182F6]"
              />
            </div>

            <div>
              <label className="block text-[13px] font-semibold text-[#191F28] mb-1.5">
                재료 조성 (Chemical Composition · 선택)
              </label>
              <input
                type="text"
                value={chemicalComposition}
                onChange={(e) => setChemicalComposition(e.target.value)}
                placeholder="예: Nb0.8Ti0.2FeSb, TiO2, Al2O3"
                className="w-full min-h-[42px] px-3.5 rounded-[12px] border border-[#E5E8EB] text-[14px] focus:outline-none focus:border-[#3182F6]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[13px] font-semibold text-[#191F28] mb-1.5">
                시료 코드 (Sample ID · 선택)
              </label>
              <input
                type="text"
                value={sampleCode}
                onChange={(e) => setSampleCode(e.target.value)}
                placeholder="미입력 시 고유 식별자 자동 부여 (예: SMP-2026-01)"
                className="w-full min-h-[42px] px-3.5 rounded-[12px] border border-[#E5E8EB] text-[14px] font-mono focus:outline-none focus:border-[#3182F6]"
              />
            </div>

            <div>
              <label className="block text-[13px] font-semibold text-[#191F28] mb-1.5">
                제조 및 공정 방법 (Processing Method · 선택)
              </label>
              <input
                type="text"
                value={processingMethod}
                onChange={(e) => setProcessingMethod(e.target.value)}
                placeholder="예: 아크 멜팅 후 SPS 950°C 10분 소결"
                className="w-full min-h-[42px] px-3.5 rounded-[12px] border border-[#E5E8EB] text-[14px] focus:outline-none focus:border-[#3182F6]"
              />
            </div>
          </div>

          <div>
            <label className="block text-[13px] font-semibold text-[#191F28] mb-1.5">
              측정 또는 실험 메모 (Experiment Memo · 선택)
            </label>
            <input
              type="text"
              value={experimentMemo}
              onChange={(e) => setExperimentMemo(e.target.value)}
              placeholder="예: Cu Kα XRD(10~80°), FE-SEM 1k×/5k×/10k×, 상온 Hall/LFA 측정"
              className="w-full min-h-[42px] px-3.5 rounded-[12px] border border-[#E5E8EB] text-[14px] focus:outline-none focus:border-[#3182F6]"
            />
          </div>

          <div>
            <label className="block text-[13px] font-semibold text-[#191F28] mb-1.5">
              시료에 대한 추가 설명 (Additional Description · 선택)
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="합성 조건, 열처리 이력, 외관 상태 등 AI 해석 및 보고서에 참고할 시료 설명을 입력하세요."
              className="w-full p-3.5 rounded-[12px] border border-[#E5E8EB] text-[13px] focus:outline-none focus:border-[#3182F6]"
            />
          </div>

          <div className="pt-1">
            <button
              type="button"
              onClick={() => setShowPeriodicTable((v) => !v)}
              className="text-[12px] font-semibold text-[#3182F6] hover:underline cursor-pointer"
            >
              {showPeriodicTable
                ? "▲ 구성 원소 주기율표 접기"
                : `▼ 예상 구성 원소 선택 (${selectedElems.length ? selectedElems.join(", ") : "선택 안 됨"})`}
            </button>
            {showPeriodicTable && (
              <div className="mt-2">
                <PeriodicTablePicker
                  selectedElements={selectedElems}
                  onChange={setSelectedElems}
                  defaultExpanded={true}
                  compact={true}
                />
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-[#E5E8EB]">
            <Button type="button" variant="outline" size="md" onClick={onClose}>
              취소
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={isBusy || !sampleName.trim()}
            >
              <FolderPlus className="w-4 h-4" />
              <span>{isEditing ? "시료 정보 저장" : "시료 등록 완료"}</span>
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface SampleSelectorBarProps {
  projects: ProjectListItem[];
  activeProject: ProjectDetail | null;
  currentInstrument: "xrd" | "sem" | "utm" | "hall" | "lfa" | "ftir" | "dsc" | "tga" | "integrated";
  onSelectSample: (projectId: string) => void;
  onOpenRegisterModal: () => void;
  onOpenEditModal: () => void;
  onProjectUpdated?: () => void;
}

export function SampleSelectorBar({
  projects,
  activeProject,
  currentInstrument,
  onSelectSample,
  onOpenRegisterModal,
  onOpenEditModal,
  onProjectUpdated,
}: SampleSelectorBarProps) {
  const [savedRecords, setSavedRecords] = useState<SampleInstrumentRecord[]>([]);
  const [savingCurrentToSample, setSavingCurrentToSample] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  const supportsExternalRecordSave = ["utm", "hall", "lfa"].includes(currentInstrument);

  useEffect(() => {
    setSaveNotice(null);
    if (!activeProject?.id || ["xrd", "sem", "integrated"].includes(currentInstrument)) {
      setSavedRecords([]);
      return;
    }
    api
      .listSampleRecords(activeProject.id, currentInstrument)
      .then((res) => setSavedRecords(res.records || []))
      .catch(() => setSavedRecords([]));
  }, [activeProject?.id, currentInstrument]);

  const handleSaveCurrentTabResultToSample = async () => {
    if (!activeProject?.id) return;
    setSavingCurrentToSample(true);
    setSaveNotice(null);
    try {
      const storageKey = `matlens_shared_${currentInstrument}_data`;
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        setSaveNotice("먼저 현재 화면에서 데이터 분석을 실행해주세요.");
        setSavingCurrentToSample(false);
        return;
      }
      const parsed = JSON.parse(raw);
      let summaryText = `${currentInstrument.toUpperCase()} 분석 결과`;
      if (currentInstrument === "utm") {
        summaryText = `UTS ${parsed.tensile_strength_MPa ?? "-"} MPa · E ${parsed.elastic_modulus_GPa ?? "-"} GPa`;
      } else if (currentInstrument === "hall") {
        summaryText = `${parsed.carrier_type || ""} · σ ${parsed.electrical_conductivity_S_cm ?? "-"} S/cm`;
      } else if (currentInstrument === "lfa") {
        summaryText = `α ${parsed.thermal_diffusivity_mm2_s ?? "-"} mm²/s · κ ${parsed.thermal_conductivity_W_mK ?? "-"} W/m·K`;
      }

      await api.saveSampleRecord(activeProject.id, {
        instrument_type: currentInstrument,
        original_filename: parsed.source_file || parsed.sample_id || `${currentInstrument}_measurement.csv`,
        metadata: { saved_from: currentInstrument },
        raw_payload: parsed,
        parameters: {},
        results: parsed,
        summary_text: summaryText,
      });

      const updated = await api.listSampleRecords(activeProject.id, currentInstrument);
      setSavedRecords(updated.records || []);
      onProjectUpdated?.();
      setSaveNotice("현재 시료에 분석 결과가 연결·저장되었습니다.");
    } catch {
      setSaveNotice("시료 연결 저장 중 오류가 발생했습니다.");
    } finally {
      setSavingCurrentToSample(false);
    }
  };

  const counts = activeProject?.instrument_counts || {};
  const nonZeroCounts = Object.entries(counts).filter(([, c]) => Number(c) > 0);

  return (
    <div className="mb-5 rounded-[18px] bg-white border border-[#E5E8EB] p-4 shadow-[0_1px_3px_rgba(25,31,40,0.03)] space-y-3">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        {/* Left: Sample Dropdown Selector */}
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-0">
          <div className="inline-flex items-center gap-1.5 text-[13px] font-bold text-[#191F28] shrink-0">
            <Layers className="w-4 h-4 text-[#3182F6]" />
            <span>현재 분석 시료:</span>
          </div>

          <select
            aria-label="현재 분석 시료 선택"
            value={activeProject?.id || ""}
            onChange={(e) => {
              const nextId = e.target.value;
              if (nextId) onSelectSample(nextId);
            }}
            className="min-h-[40px] px-3.5 py-1.5 rounded-[12px] border border-[#BFDBFE] bg-[#EFF6FF]/50 text-[14px] font-bold text-[#191F28] focus:outline-none focus:border-[#3182F6] max-w-full sm:max-w-[380px] cursor-pointer"
          >
            <option value="">-- 분석할 시료를 선택하거나 새로 등록하세요 --</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.sample_name}
                {p.expected_formula ? ` (${p.expected_formula})` : ""}
                {p.sample_code && p.sample_code !== p.id ? ` [${p.sample_code}]` : ""}
              </option>
            ))}
          </select>

          {activeProject && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {activeProject.expected_formula && (
                <span className="px-2.5 py-0.5 rounded-full text-[12px] font-semibold bg-[#F2F4F6] text-[#4E5968]">
                  조성: {activeProject.expected_formula}
                </span>
              )}
              {activeProject.processing_method && (
                <span className="px-2.5 py-0.5 rounded-full text-[12px] font-medium bg-[#F8FAFC] text-[#6B7684] border border-[#E5E8EB]">
                  공정: {activeProject.processing_method}
                </span>
              )}
              {activeProject.is_sample_demo && <SourceTag kind="샘플" />}
            </div>
          )}
        </div>

        {/* Right: Sample Actions & Instrument Data Badges */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {nonZeroCounts.length > 0 && (
            <div className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-[10px] bg-[#F7F8FA] border border-[#E5E8EB] text-[11px] font-semibold text-[#4E5968]">
              <span>시료 보유 데이터:</span>
              {nonZeroCounts.map(([inst, cnt]) => (
                <span
                  key={inst}
                  className="px-1.5 py-0.5 rounded bg-white border border-[#E5E8EB] text-[#191F28] tabular-nums"
                >
                  {inst} {cnt}개
                </span>
              ))}
            </div>
          )}

          {activeProject && supportsExternalRecordSave && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={savingCurrentToSample}
              onClick={handleSaveCurrentTabResultToSample}
              className="min-h-[38px] text-[12px] border-[#3182F6] text-[#3182F6] hover:bg-[#EFF6FF]"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{savingCurrentToSample ? "저장 중..." : "현재 결과를 이 시료에 저장"}</span>
            </Button>
          )}

          {activeProject && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onOpenEditModal}
              className="min-h-[38px] text-[12px]"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>시료 정보</span>
            </Button>
          )}

          <Button
            type="button"
            size="sm"
            variant="primary"
            onClick={onOpenRegisterModal}
            className="min-h-[38px] text-[12px]"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>시료 등록하기</span>
          </Button>
        </div>
      </div>

      {saveNotice && (
        <div className="text-[12px] font-medium text-[#1D4ED8] bg-[#EFF6FF] px-3 py-1.5 rounded-[10px] flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>{saveNotice}</span>
        </div>
      )}

      {/* Per-sample saved history for UTM / Hall / LFA */}
      {activeProject && supportsExternalRecordSave && savedRecords.length > 0 && (
        <div className="pt-2 border-t border-[#F2F4F6] flex flex-wrap items-center gap-2 text-[12px]">
          <span className="inline-flex items-center gap-1 font-semibold text-[#6B7684]">
            <Clock className="w-3.5 h-3.5 text-[#3182F6]" />
            이 시료의 {currentInstrument.toUpperCase()} 측정·분석 이력 ({savedRecords.length}건):
          </span>
          {savedRecords.map((rec) => {
            const latest = rec.analyses?.[0];
            return (
              <span
                key={rec.id}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] bg-[#F8FAFC] border border-[#E5E8EB] text-[#191F28]"
              >
                <strong>{rec.original_filename}</strong>
                {latest?.summary_text && (
                  <span className="text-[#4E5968]">({latest.summary_text})</span>
                )}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
