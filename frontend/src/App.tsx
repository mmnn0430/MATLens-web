import React from "react";
import { UniversalBatchPlatformView } from "./components/batch/UniversalBatchPlatformView";

export default function App() {
  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <header className="flex items-center justify-between p-4 bg-[#F2F4F6] border-b border-[#E5E8EB]">
        <h1 className="text-xl font-bold text-[#191F28]">
          MatLens – Universal Batch Analyzer
        </h1>
      </header>

      {/* Main Content – 단일 업로드·다중 비교 UI */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-8 py-6 sm:py-8">
        <UniversalBatchPlatformView />
      </main>
    </div>
  );
}
