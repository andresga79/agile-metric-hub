import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Info } from "lucide-react";

export function MetricTooltip({ description }: { description: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="inline-flex items-center ml-1 text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-help" tabIndex={-1}>
          <Info size={13} />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[260px]" side="top">
        <p className="text-xs leading-relaxed">{description}</p>
      </TooltipContent>
    </Tooltip>
  );
}
