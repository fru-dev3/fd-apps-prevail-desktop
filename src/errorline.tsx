import { AlertTriangle } from "lucide-react";
import { errorSentence } from "./helpers";

// An error as one plain sentence, with the full (ANSI-free) text behind a
// "Details" disclosure. Use it wherever runtime or engine error text shows.
export function ErrorLine({ error, tone = "warn", className = "" }: { error: string; tone?: "warn" | "err"; className?: string }) {
  const { sentence, full } = errorSentence(error);
  const more = full && full !== sentence && full.replace(/\.$/, "") !== sentence.replace(/\.$/, "");
  return (
    <div data-testid="error-line" className={`flex items-start gap-2 text-[13px] text-text-secondary ${className}`}>
      <AlertTriangle className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${tone === "err" ? "text-err" : "text-warn"}`} />
      <div className="min-w-0 flex-1">
        <span>{sentence}</span>
        {more && (
          <details className="mt-1">
            <summary className="cursor-pointer text-[12px] text-text-muted hover:text-accent">Details</summary>
            <pre className="mt-1 whitespace-pre-wrap break-words rounded-md bg-surface-warm px-2 py-1.5 text-[12px] leading-relaxed text-text-secondary">{full}</pre>
          </details>
        )}
      </div>
    </div>
  );
}
