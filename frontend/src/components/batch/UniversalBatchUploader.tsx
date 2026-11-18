import React, { useCallback, useRef, useState } from "react";
import {
  UploadCloud,
  Trash2,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Sparkles,
  Edit3,
  Layers,
} from "lucide-react";
import type { InstrumentType, UniversalDataset } from "../../core/batch/types";
import {
  formatFileSize,
  getInstrumentAdapter,
} from "../../core/batch/adapters";
import { getPaletteColor, SCIENTIFIC_PALETTE } from "../../core/batch/palette";
import { Button } from "../ui/primitives";

interface UniversalBatchUploaderProps {
  instrumentType: InstrumentType;
  datasets: UniversalDataset[];
  onDatasetsChange: (next: UniversalDataset[]) => void;
  onSelectDataset?: (id: string) => void;
  selectedId?: string | null;
  className?: string;
}

export function UniversalBatchUploader({
  instrumentType,
  datasets,
  onDatasetsChange,
  onSelectDataset,
  selectedId,
  className = "",
}: UniversalBatchUploaderProps) {
  const adapter = getInstrumentAdapter(instrumentType);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchSampleName, setBatchSampleName] = useState("");
  const [batchConditionPrefix, setBatchConditionPrefix] = useState("#");
  const [activeColorPickerId, setActiveColorPickerId] = useState<string | null>(null);

  // File drop handler
  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArr = Array.from(files);
      if (fileArr.length === 0) return;

      const allowedExts = adapter.acceptedExtensions.map((e) => e.toLowerCase());
      const validFiles = fileArr.filter((f) => {
        const ext = `.${f.name.split(".").pop()?.toLowerCase() || ""}`;
        return allowedExts.includes(ext);
      });

      if (validFiles.length === 0) {
        alert(
          `선택한 파일 중 ${adapter.displayName}에 지원되는 확장자(${allowedExts.join(", ")})를 가진 파일이 없습니다.`
        );
        return;
      }

      const existingCount = datasets.length;
      const newItems: UniversalDataset[] = validFiles.map((f, idx) => {
        const meta = adapter.extractMetadata
          ? adapter.extractMetadata(f.name)
          : { sampleName: f.name.replace(/\.[^/.]+$/, ""), specimenOrCondition: `#${existingCount + idx + 1}` };

        return {
          id: `dataset-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
          file: f,
          fileName: f.name,
          fileSize: f.size,
          sampleName: meta.sampleName,
          specimenOrCondition: meta.specimenOrCondition,
          color: getPaletteColor(existingCount + idx),
          visible: true,
          status: "pending",
          progress: 10,
          instrumentType,
          createdAt: Date.now(),
        };
      });

      let currentList = [...datasets, ...newItems];
      onDatasetsChange(currentList);

      // Trigger asynchronous parsing and analysis for all new files
      for (const item of newItems) {
        try {
          // 1. Parsing status
          currentList = currentList.map((d) =>
            d.id === item.id ? { ...d, status: "parsing", progress: 40 } : d
          );
          onDatasetsChange([...currentList]);

          const raw = await adapter.parseData(item.file!);

          // 2. Analyzing status
          currentList = currentList.map((d) =>
            d.id === item.id ? { ...d, rawData: raw, status: "analyzing", progress: 75 } : d
          );
          onDatasetsChange([...currentList]);

          const analysis = await adapter.analyzeData(raw, undefined, item.file);

          // 3. Success status with results
          currentList = currentList.map((d) =>
            d.id === item.id
              ? {
                  ...d,
                  rawData: raw,
                  analysisResult: analysis,
                  status: "success",
                  progress: 100,
                }
              : d
          );
          onDatasetsChange([...currentList]);
        } catch (err: any) {
          currentList = currentList.map((d) =>
            d.id === item.id
              ? {
                  ...d,
                  status: "error",
                  errorMessage: err?.message || "파싱/분석 실패",
                }
              : d
          );
          onDatasetsChange([...currentList]);
        }
      }
    },
    [adapter, datasets, instrumentType, onDatasetsChange]
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      handleFiles(e.dataTransfer.files);
    }
  };

  // Delete item
  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onDatasetsChange(datasets.filter((d) => d.id !== id));
  };

  // Toggle visibility
  const handleToggleVisible = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onDatasetsChange(
      datasets.map((d) => (d.id === id ? { ...d, visible: !d.visible } : d))
    );
  };

  // Inline edit sampleName
  const handleUpdateSampleName = (id: string, val: string) => {
    onDatasetsChange(
      datasets.map((d) => (d.id === id ? { ...d, sampleName: val } : d))
    );
  };

  // Inline edit condition
  const handleUpdateCondition = (id: string, val: string) => {
    onDatasetsChange(
      datasets.map((d) => (d.id === id ? { ...d, specimenOrCondition: val } : d))
    );
  };

  // Update color
  const handleUpdateColor = (id: string, color: string) => {
    onDatasetsChange(
      datasets.map((d) => (d.id === id ? { ...d, color } : d))
    );
    setActiveColorPickerId(null);
  };

  // Batch Apply common metadata
  const handleApplyBatchMetadata = () => {
    if (!batchSampleName.trim() && !batchConditionPrefix.trim()) {
      setShowBatchModal(false);
      return;
    }
    const updated = datasets.map((d, idx) => ({
      ...d,
      sampleName: batchSampleName.trim() || d.sampleName,
      specimenOrCondition: batchConditionPrefix.trim()
        ? `${batchConditionPrefix.trim()}${idx + 1}`
        : d.specimenOrCondition,
    }));
    onDatasetsChange(updated);
    setShowBatchModal(false);
  };

  // Load Preset sample datasets
  const handleLoadSamples = async () => {
    if (adapter.createSampleDatasets) {
      const samples = await adapter.createSampleDatasets();
      onDatasetsChange(samples);
      if (samples.length > 0 && onSelectDataset) {
        onSelectDataset(samples[0].id);
      }
    }
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Drag & Drop Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-[18px] p-6 text-center cursor-pointer transition-all ${
          isDragging
            ? "border-[#3182F6] bg-[#3182F6]/5 scale-[0.995]"
            : "border-[#D1D6DB] bg-white hover:border-[#3182F6] hover:bg-[#F9FAFB]"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={adapter.acceptedExtensions.join(",")}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />

        <div className="flex flex-col items-center justify-center space-y-2">
          <div className="w-12 h-12 rounded-full bg-[#EBF4FF] text-[#3182F6] flex items-center justify-center">
            <UploadCloud className="w-6 h-6" />
          </div>
          <div>
            <div className="text-[15px] font-bold text-[#191F28]">
              {adapter.displayName} 파일 드래그 앤 드롭 또는 클릭하여 선택
            </div>
            <p className="text-[13px] text-[#6B7684] mt-0.5">
              복수 파일 일괄 업로드 지원 (지원 확장자: {adapter.acceptedExtensions.join(", ")})
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-[#F2F4F6] text-[#4E5968]">
              멀티 파일 다중 선택 가능 (Ctrl/Shift + 클릭)
            </span>
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-[#EFF6FF] text-[#2563EB]">
              자동 메타데이터 추출 & 고유 색상 할당
            </span>
          </div>
        </div>
      </div>

      {/* Dataset Management Bar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-bold text-[#191F28] flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-[#3182F6]" />
            업로드된 시편 목록
            <span className="ml-1 text-[12px] font-bold px-2 py-0.5 rounded-full bg-[#E5E8EB] text-[#333D4B]">
              {datasets.length}개
            </span>
          </span>
          {datasets.length > 0 && (
            <span className="text-[12px] text-[#6B7684]">
              (표시: {datasets.filter((d) => d.visible).length}개)
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {datasets.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowBatchModal(true)}
              className="text-[12px] h-8 px-2.5"
            >
              <Edit3 className="w-3.5 h-3.5" />
              메타데이터 일괄 적용
            </Button>
          )}

          {adapter.createSampleDatasets && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleLoadSamples}
              className="text-[12px] h-8 px-2.5 text-[#2563EB] bg-[#EFF6FF] hover:bg-[#DBEAFE]"
            >
              <Sparkles className="w-3.5 h-3.5" />
              샘플 데이터셋 불러오기
            </Button>
          )}

          {datasets.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onDatasetsChange([])}
              className="text-[12px] h-8 px-2 text-[#E11D48] hover:bg-[#FEE2E2]"
            >
              전체 비우기
            </Button>
          )}
        </div>
      </div>

      {/* File Table */}
      {datasets.length > 0 && (
        <div className="overflow-hidden border border-[#E5E8EB] rounded-[14px] bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-[#F8F9FA] border-b border-[#E5E8EB] text-[#4E5968] font-semibold">
                <tr>
                  <th className="py-2.5 px-3 w-10 text-center">표시</th>
                  <th className="py-2.5 px-3 w-12 text-center">색상</th>
                  <th className="py-2.5 px-3">파일명 / 크기</th>
                  <th className="py-2.5 px-3">시료명 (Sample)</th>
                  <th className="py-2.5 px-3">조건/시편 (Condition)</th>
                  <th className="py-2.5 px-3 w-24 text-center">분석 상태</th>
                  <th className="py-2.5 px-3 w-12 text-center">삭제</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E8EB]">
                {datasets.map((item) => {
                  const isSelected = selectedId === item.id;
                  return (
                    <tr
                      key={item.id}
                      onClick={() => onSelectDataset && onSelectDataset(item.id)}
                      className={`transition-colors cursor-pointer ${
                        isSelected ? "bg-[#F0F7FF]" : "hover:bg-[#F9FAFB]"
                      }`}
                    >
                      {/* Visible Toggle */}
                      <td className="py-2 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={(e) => handleToggleVisible(item.id, e)}
                          title={item.visible ? "그래프에서 숨기기" : "그래프에 표시하기"}
                          className={`p-1 rounded-md transition-colors ${
                            item.visible
                              ? "text-[#3182F6] hover:bg-[#EBF4FF]"
                              : "text-[#D1D6DB] hover:bg-[#F2F4F6]"
                          }`}
                        >
                          {item.visible ? (
                            <Eye className="w-4 h-4" />
                          ) : (
                            <EyeOff className="w-4 h-4" />
                          )}
                        </button>
                      </td>

                      {/* Color Picker Swatch */}
                      <td className="py-2 px-3 text-center relative" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() =>
                            setActiveColorPickerId(
                              activeColorPickerId === item.id ? null : item.id
                            )
                          }
                          className="w-5 h-5 rounded-full border border-black/15 shadow-sm inline-block align-middle transition-transform hover:scale-110"
                          style={{ backgroundColor: item.color }}
                          title="차트 색상 변경"
                        />
                        {/* Swatch Popup */}
                        {activeColorPickerId === item.id && (
                          <div className="absolute left-8 top-0 z-30 p-2 bg-white rounded-[12px] shadow-lg border border-[#E5E8EB] grid grid-cols-4 gap-1.5 w-36">
                            {SCIENTIFIC_PALETTE.map((c) => (
                              <button
                                key={c}
                                type="button"
                                onClick={() => handleUpdateColor(item.id, c)}
                                className="w-6 h-6 rounded-full border border-black/10 hover:scale-115 transition-transform"
                                style={{ backgroundColor: c }}
                              />
                            ))}
                          </div>
                        )}
                      </td>

                      {/* Filename & size */}
                      <td className="py-2 px-3">
                        <div className="font-medium text-[#191F28] truncate max-w-[200px]" title={item.fileName}>
                          {item.fileName}
                        </div>
                        <div className="text-[11px] text-[#8B95A1]">
                          {formatFileSize(item.fileSize)}
                        </div>
                      </td>

                      {/* Sample Name Inline Edit */}
                      <td className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          value={item.sampleName}
                          onChange={(e) => handleUpdateSampleName(item.id, e.target.value)}
                          className="w-full text-[13px] px-2 py-1 rounded-md border border-[#E5E8EB] bg-white focus:outline-none focus:border-[#3182F6]"
                          placeholder="시료명 입력"
                        />
                      </td>

                      {/* Specimen / Condition Inline Edit */}
                      <td className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          value={item.specimenOrCondition}
                          onChange={(e) => handleUpdateCondition(item.id, e.target.value)}
                          className="w-full text-[13px] px-2 py-1 rounded-md border border-[#E5E8EB] bg-white focus:outline-none focus:border-[#3182F6]"
                          placeholder="시편/조건 입력"
                        />
                      </td>

                      {/* Status */}
                      <td className="py-2 px-3 text-center">
                        {item.status === "success" && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#16A34A] bg-[#DCFCE7] px-2 py-0.5 rounded-full">
                            <CheckCircle2 className="w-3 h-3" /> 완료
                          </span>
                        )}
                        {(item.status === "parsing" || item.status === "analyzing") && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#2563EB] bg-[#EFF6FF] px-2 py-0.5 rounded-full">
                            <Loader2 className="w-3 h-3 animate-spin" /> 연산 중
                          </span>
                        )}
                        {item.status === "pending" && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#6B7684] bg-[#F2F4F6] px-2 py-0.5 rounded-full">
                            대기
                          </span>
                        )}
                        {item.status === "error" && (
                          <span
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#DC2626] bg-[#FEE2E2] px-2 py-0.5 rounded-full"
                            title={item.errorMessage}
                          >
                            <AlertCircle className="w-3 h-3" /> 오류
                          </span>
                        )}
                      </td>

                      {/* Delete */}
                      <td className="py-2 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={(e) => handleDelete(item.id, e)}
                          title="삭제"
                          className="p-1 rounded-md text-[#9CA3AF] hover:text-[#DC2626] hover:bg-[#FEE2E2] transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Batch Metadata Modal */}
      {showBatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white rounded-[20px] p-6 shadow-2xl space-y-4 border border-[#E5E8EB]">
            <div className="flex items-center justify-between">
              <h3 className="text-[17px] font-bold text-[#191F28] flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-[#3182F6]" />
                전체 시료 공통 메타데이터 일괄 적용
              </h3>
              <button
                type="button"
                onClick={() => setShowBatchModal(false)}
                className="text-[#8B95A1] hover:text-[#191F28]"
              >
                ✕
              </button>
            </div>
            <p className="text-[13px] text-[#6B7684]">
              업로드된 모든 시편({datasets.length}개)에 일관된 시료명 및 시편 접두사를 일괄 지정합니다.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-[13px] font-bold text-[#333D4B] block mb-1">
                  공통 시료명 (Sample Name)
                </label>
                <input
                  type="text"
                  value={batchSampleName}
                  onChange={(e) => setBatchSampleName(e.target.value)}
                  placeholder="예: ABS100, TiO2-annealed, Silicon-SRM"
                  className="w-full px-3 py-2 text-[14px] rounded-[10px] border border-[#D1D6DB] focus:outline-none focus:border-[#3182F6]"
                />
              </div>

              <div>
                <label className="text-[13px] font-bold text-[#333D4B] block mb-1">
                  시편/조건 접두사 (Specimen Prefix)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={batchConditionPrefix}
                    onChange={(e) => setBatchConditionPrefix(e.target.value)}
                    placeholder="예: #, 시편, Run-, FOV-"
                    className="w-full px-3 py-2 text-[14px] rounded-[10px] border border-[#D1D6DB] focus:outline-none focus:border-[#3182F6]"
                  />
                  <span className="text-[12px] text-[#6B7684] shrink-0">
                    → 자동 #1, #2, #3...
                  </span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowBatchModal(false)}
              >
                취소
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleApplyBatchMetadata}
              >
                전체 일괄 적용
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
