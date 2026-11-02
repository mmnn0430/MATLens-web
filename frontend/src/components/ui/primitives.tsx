import React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  ChevronDown,
  FlaskConical,
} from "lucide-react";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[20px] bg-white border border-[#E5E8EB] p-5 sm:p-6 shadow-[0_1px_3px_rgba(25,31,40,0.03)]",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
}

export function Button({
  className,
  variant = "primary",
  size = "md",
  children,
  ...props
}: ButtonProps) {
  const variants = {
    primary:
      "bg-[#3182F6] text-white hover:bg-[#1B64DA] active:bg-[#1957C2] disabled:bg-[#90B8F8]",
    secondary:
      "bg-[#F2F4F6] text-[#191F28] hover:bg-[#E5E8EB] active:bg-[#D1D6DB] disabled:opacity-50",
    outline:
      "bg-white text-[#191F28] border border-[#E5E8EB] hover:bg-[#F7F8FA] disabled:opacity-50",
    danger:
      "bg-[#FEE2E2] text-[#DC2626] hover:bg-[#FECACA] disabled:opacity-50",
    ghost:
      "bg-transparent text-[#6B7684] hover:bg-[#F2F4F6] hover:text-[#191F28] disabled:opacity-50",
  };
  const sizes = {
    sm: "min-h-[44px] px-3.5 text-[13px] rounded-[12px]",
    md: "min-h-[44px] px-4 text-[14px] rounded-[13px]",
    lg: "min-h-[48px] px-6 text-[15px] rounded-[14px]",
  };
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function StatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  // Never distinguish status by color alone: always pair an explicit icon + Korean status label
  const normalized = status || "확인 필요";
  if (normalized === "분석 완료" || normalized === "보정 추정값") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-semibold bg-[#DCFCE7] text-[#16A34A]",
          className
        )}
      >
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        <span>{normalized}</span>
      </span>
    );
  }
  if (normalized === "계산 불가" || normalized === "오류" || normalized === "failed") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-semibold bg-[#FEE2E2] text-[#DC2626]",
          className
        )}
      >
        <XCircle className="w-3.5 h-3.5 shrink-0" />
        <span>{normalized === "failed" ? "오류" : normalized}</span>
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-semibold bg-[#FEF3C7] text-[#D97706]",
        className
      )}
    >
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
      <span>{normalized}</span>
    </span>
  );
}

export type SourceKind = "측정값" | "계산값" | "사용자 입력" | "규칙 요약" | "AI 해석" | "샘플";

export function SourceTag({ kind }: { kind: SourceKind }) {
  const styles: Record<SourceKind, string> = {
    "측정값": "bg-[#F2F4F6] text-[#4E5968] border-[#E5E8EB]",
    "계산값": "bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]",
    "사용자 입력": "bg-[#F5F3FF] text-[#6D28D9] border-[#DDD6FE]",
    "규칙 요약": "bg-[#F0FDF4] text-[#15803D] border-[#BBF7D0]",
    "AI 해석": "bg-[#FFFBEB] text-[#B45309] border-[#FDE68A]",
    "샘플": "bg-[#E0F2FE] text-[#0369A1] border-[#BAE6FD]",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-[8px] text-[11px] font-medium border",
        styles[kind]
      )}
    >
      {kind === "샘플" && <FlaskConical className="w-3 h-3" />}
      {kind}
    </span>
  );
}

export function TermTooltip({ term, description }: { term: string; description: string }) {
  return (
    <TooltipPrimitive.Provider delayDuration={150}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          <button
            type="button"
            aria-label={`${term} 설명 보기`}
            className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[#6B7684] hover:text-[#191F28] hover:bg-[#F2F4F6] align-middle ml-1 cursor-help"
          >
            <HelpCircle className="w-3.5 h-3.5" />
          </button>
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            sideOffset={6}
            className="z-50 max-w-[280px] rounded-[12px] bg-[#191F28] px-3.5 py-2.5 text-[12px] leading-relaxed text-white shadow-lg"
          >
            <div className="font-semibold mb-0.5 text-[#90B8F8]">{term}</div>
            <div>{description}</div>
            <TooltipPrimitive.Arrow className="fill-[#191F28]" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

export function CollapsiblePanel({
  title,
  subtitle,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <CollapsiblePrimitive.Root open={open} onOpenChange={setOpen} className="rounded-[20px] bg-white border border-[#E5E8EB]">
      <CollapsiblePrimitive.Trigger asChild>
        <button
          type="button"
          className="w-full min-h-[56px] px-5 py-4 flex items-center justify-between text-left hover:bg-[#F7F8FA] rounded-[20px] transition-colors cursor-pointer"
        >
          <div>
            <div className="text-[15px] font-semibold text-[#191F28]">{title}</div>
            {subtitle && <div className="text-[13px] text-[#6B7684] mt-0.5">{subtitle}</div>}
          </div>
          <ChevronDown
            className={cn(
              "w-5 h-5 text-[#6B7684] transition-transform duration-200",
              open && "rotate-180"
            )}
          />
        </button>
      </CollapsiblePrimitive.Trigger>
      <CollapsiblePrimitive.Content className="px-5 pb-5 pt-2 border-t border-[#E5E8EB]">
        {children}
      </CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  );
}

export function SwitchControl({
  checked,
  onCheckedChange,
  label,
  description,
}: {
  checked: boolean;
  onCheckedChange: (val: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex items-start justify-between gap-4 py-2 cursor-pointer min-h-[44px]">
      <div className="flex-1">
        <div className="text-[14px] font-medium text-[#191F28]">{label}</div>
        {description && <div className="text-[12px] text-[#6B7684] mt-0.5 leading-relaxed">{description}</div>}
      </div>
      <SwitchPrimitive.Root
        checked={checked}
        onCheckedChange={onCheckedChange}
        className={cn(
          "w-11 h-6 rounded-full relative transition-colors shrink-0 mt-0.5 cursor-pointer",
          checked ? "bg-[#3182F6]" : "bg-[#D1D6DB]"
        )}
      >
        <SwitchPrimitive.Thumb
          className={cn(
            "block w-5 h-5 bg-white rounded-full shadow transition-transform translate-x-0.5",
            checked && "translate-x-[22px]"
          )}
        />
      </SwitchPrimitive.Root>
    </label>
  );
}

export function MetricCard({
  label,
  value,
  unit,
  subtext,
  status,
  sourceKind,
  tooltipTerm,
  tooltipDesc,
}: {
  label: string;
  value: string | number | null;
  unit?: string;
  subtext?: string;
  status?: string;
  sourceKind: SourceKind;
  tooltipTerm?: string;
  tooltipDesc?: string;
}) {
  return (
    <Card className="p-5 flex flex-col justify-between gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[13px] font-medium text-[#6B7684] flex items-center flex-wrap">
          <span>{label}</span>
          {tooltipTerm && tooltipDesc && (
            <TermTooltip term={tooltipTerm} description={tooltipDesc} />
          )}
        </div>
        <SourceTag kind={sourceKind} />
      </div>
      <div>
        {value !== null && value !== undefined && value !== "" ? (
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="text-[26px] leading-tight font-bold text-[#191F28] tabular-nums">
              {value}
            </span>
            {unit && (
              <span className="text-[15px] font-semibold text-[#6B7684]">{unit}</span>
            )}
          </div>
        ) : (
          <div className="text-[18px] font-bold text-[#6B7684]">계산 불가</div>
        )}
        {subtext && (
          <div className="text-[12px] text-[#6B7684] mt-1.5 leading-snug">{subtext}</div>
        )}
      </div>
      {status && (
        <div>
          <StatusBadge status={status} />
        </div>
      )}
    </Card>
  );
}
