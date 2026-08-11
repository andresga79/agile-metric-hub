export type TimeWindow = "1m" | "3m" | "2s" | "6s";

const KANBAN_OPTIONS: { value: TimeWindow; label: string }[] = [
  { value: "1m", label: "1M" },
  { value: "3m", label: "3M" },
];

const SCRUM_OPTIONS: { value: TimeWindow; label: string }[] = [
  { value: "2s", label: "Últimos 2" },
  { value: "6s", label: "Últimos 6" },
];

export function TimeWindowFilter({
  boardType,
  value,
  onChange,
}: {
  boardType: "scrum" | "kanban" | "simple";
  value: TimeWindow;
  onChange: (value: TimeWindow) => void;
}) {
  const options = boardType === "scrum" ? SCRUM_OPTIONS : KANBAN_OPTIONS;

  return (
    <div className="flex bg-background border border-border rounded-md p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors ${
            value === opt.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
