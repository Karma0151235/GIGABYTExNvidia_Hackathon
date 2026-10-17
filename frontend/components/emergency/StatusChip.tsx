"use client";

type Props = {
  label: string;
};

export default function StatusChip({ label }: Props) {
  const classes =
    label === "Critical" || label === "Breached"
      ? "border-[color:color-mix(in_srgb,var(--anwar-red)_45%,transparent)] text-[var(--anwar-red)]"
      : label === "High" || label === "At risk" || label === "On scene"
        ? "border-[color:color-mix(in_srgb,var(--anwar-gold)_45%,transparent)] text-[var(--anwar-gold)]"
        : label === "Available" || label === "On target"
          ? "border-[color:color-mix(in_srgb,var(--anwar-green)_45%,transparent)] text-[var(--anwar-green)]"
          : label === "Transporting"
            ? "border-[var(--anwar-divider)] text-[var(--anwar-text)]"
            : label === "Offline"
              ? "border-[var(--anwar-divider)] text-[var(--anwar-muted)]"
              : "border-[color:color-mix(in_srgb,var(--anwar-gold)_45%,transparent)] text-[var(--anwar-gold)]";

  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] uppercase tracking-[.08em] ${classes}`}>
      {label}
    </span>
  );
}
