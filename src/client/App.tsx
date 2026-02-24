import { useEffect, useMemo, useState } from "react";
import type { Background, FontChoice, Quote, QuoteHistoryItem } from "../types";

type View = "generate" | "settings" | "history";

type AppSettings = {
  quoteSuggestionCount: number;
  backgroundSuggestionCount: number;
  defaultFontId: string;
};

type QuoteGenerateResponse = {
  quotes: Quote[];
  exhausted: boolean;
  source: "zenquotes" | "fallback" | "cache";
  notice?: string;
};

type BackgroundResponse = {
  backgrounds: Background[];
  source: "pexels" | "fallback" | "cache";
  notice?: string;
};

type HiddenQuoteEntry = {
  quote: string;
  normalizedQuote: string;
  createdOn: string;
};

type QuoteControlsResponse = {
  hiddenQuotes: HiddenQuoteEntry[];
  allowlistQuotes: Quote[];
};

type FontResponse = {
  fonts: FontChoice[];
};

function pathToView(pathname: string): View {
  if (pathname === "/settings") {
    return "settings";
  }
  if (pathname === "/history") {
    return "history";
  }
  return "generate";
}

function navigate(path: string): void {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    const message = (data as { error?: string }).error ?? "Unexpected API error";
    throw new Error(message);
  }
  return data;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

const panelClass = "rounded-2xl border border-[#d5cab6] bg-[#fffef9]/95 p-4 shadow-[0_10px_26px_rgba(73,48,26,0.1)]";
const uiButtonClass =
  "rounded-xl border border-[#d5cab6] bg-[#fffef9] text-[#2a2017] transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60";
const primaryButtonClass =
  "rounded-xl border border-[#9a5217] bg-[#ba6a24] text-white transition-all duration-200 hover:bg-[#9a5217] disabled:cursor-not-allowed disabled:opacity-60";
const FALLBACK_BACKGROUND_URL = "/backgrounds/sunrise-grid.svg";

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) {
      current = next;
      continue;
    }

    if (current) {
      lines.push(current);
    }
    current = word;
  }

  if (current) {
    lines.push(current);
  }

  return lines.length > 0 ? lines : [text];
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load image: ${src}`));
    image.src = src;
  });
}

function QuotePreview({
  quote,
  background,
  font,
  fullscreen,
}: {
  quote: Quote;
  background: Background;
  font: FontChoice;
  fullscreen: boolean;
}) {
  const [imageUrl, setImageUrl] = useState(background.imageUrl || FALLBACK_BACKGROUND_URL);

  useEffect(() => {
    setImageUrl(background.imageUrl || FALLBACK_BACKGROUND_URL);
  }, [background.imageUrl]);

  return (
    <div className="relative grid w-full place-items-center overflow-hidden" style={{ height: fullscreen ? "100vh" : undefined, aspectRatio: fullscreen ? "auto" : "16 / 9" }}>
      <img
        src={imageUrl}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        onError={() => {
          if (imageUrl !== FALLBACK_BACKGROUND_URL) {
            setImageUrl(FALLBACK_BACKGROUND_URL);
          }
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-[rgba(9,14,28,0.34)] to-[rgba(9,14,28,0.5)]" />
      <div className="relative z-10 w-[min(82%,760px)] rounded-2xl border border-white/25 bg-[rgba(17,14,10,0.27)] p-[clamp(1.3rem,2.7vw,2.2rem)] text-center text-[#fffaf2] backdrop-blur-[1.3px]">
        <blockquote className="m-0 text-[clamp(1.25rem,2.7vw,2.15rem)] leading-[1.3] text-balance" style={{ fontFamily: font.family }}>
          {quote.text}
        </blockquote>
        <p className="mb-[0.15rem] mt-4 text-[clamp(1rem,2vw,1.2rem)] font-semibold">{quote.author}</p>
        <p className="m-0 text-[clamp(0.82rem,1.6vw,1rem)] opacity-85">{quote.attribution}</p>
      </div>
    </div>
  );
}

function PresentationOverlay({
  isOpen,
  quote,
  background,
  font,
  onClose,
}: {
  isOpen: boolean;
  quote: Quote | null;
  background: Background | null;
  font: FontChoice | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !quote || !background || !font) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 bg-[rgba(8,11,19,0.88)] p-4 md:p-6" role="dialog" aria-modal="true" aria-label="Presentation overlay">
      <div className="mb-3 flex justify-end">
        <button type="button" className={cx(uiButtonClass, "px-4 py-2 font-semibold text-[#f8ead6] bg-transparent border-[#f8ead6]/70")} onClick={onClose}>
          Close
        </button>
      </div>
      <div className="h-[calc(100vh-5rem)] overflow-hidden rounded-2xl border border-white/25">
        <QuotePreview quote={quote} background={background} font={font} fullscreen={true} />
      </div>
    </div>
  );
}

function GeneratePage({
  quoteSuggestionCount,
  backgroundSuggestionCount,
  defaultFontId,
  backgrounds,
  fonts,
  backgroundNotice,
  onRefreshBackgrounds,
}: {
  quoteSuggestionCount: number;
  backgroundSuggestionCount: number;
  defaultFontId: string;
  backgrounds: Background[];
  fonts: FontChoice[];
  backgroundNotice: string | null;
  onRefreshBackgrounds: () => Promise<void>;
}) {
  const [suggestions, setSuggestions] = useState<Quote[]>([]);
  const [selectedQuoteIndex, setSelectedQuoteIndex] = useState<number | null>(null);
  const [selectedBackgroundId, setSelectedBackgroundId] = useState<string>("");
  const [selectedFontId, setSelectedFontId] = useState<string>(defaultFontId);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [refreshingBackgrounds, setRefreshingBackgrounds] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedRecord, setSavedRecord] = useState<QuoteHistoryItem | null>(null);
  const [localQuoteNotice, setLocalQuoteNotice] = useState<string | null>(null);
  const [isExhausted, setIsExhausted] = useState(false);
  const [isPresentationOpen, setIsPresentationOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [roundLockedAfterSave, setRoundLockedAfterSave] = useState(false);

  useEffect(() => {
    if (!fonts.some((font) => font.id === selectedFontId)) {
      setSelectedFontId(defaultFontId);
    }
  }, [fonts, selectedFontId, defaultFontId]);

  const selectedQuote = selectedQuoteIndex === null ? null : suggestions[selectedQuoteIndex] ?? null;

  const selectedBackground = useMemo(
    () => backgrounds.find((item) => item.id === selectedBackgroundId) ?? null,
    [backgrounds, selectedBackgroundId],
  );

  const selectedFont = useMemo(() => {
    return fonts.find((font) => font.id === selectedFontId) ?? fonts[0] ?? null;
  }, [fonts, selectedFontId]);

  async function generateQuotes(): Promise<void> {
    setGenerating(true);
    setError(null);
    setSavedRecord(null);
    try {
      const data = await fetchJson<QuoteGenerateResponse>("/api/quotes/generate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ count: quoteSuggestionCount }),
      });
      setSuggestions(data.quotes);
      setSelectedQuoteIndex(null);
      setSelectedBackgroundId("");
      setSelectedFontId(defaultFontId);
      setIsExhausted(data.exhausted);
      setLocalQuoteNotice(data.notice ?? null);
      setRoundLockedAfterSave(false);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to generate quotes");
    } finally {
      setGenerating(false);
    }
  }

  async function saveSelection(): Promise<void> {
    if (!selectedQuote || !selectedBackground || !selectedFont || roundLockedAfterSave) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const data = await fetchJson<{ saved: QuoteHistoryItem }>("/api/quotes/choose", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          quote: selectedQuote,
          background: selectedBackground,
          font: selectedFont,
        }),
      });
      setSavedRecord(data.saved);
      setRoundLockedAfterSave(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not save quote");
    } finally {
      setSaving(false);
    }
  }

  async function openFullscreenPreview(): Promise<void> {
    setIsPresentationOpen(true);
  }

  async function exportSelectionAsPng(): Promise<void> {
    if (!selectedQuote || !selectedBackground || !selectedFont) {
      return;
    }

    setExporting(true);
    setError(null);

    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1600;
      canvas.height = 900;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("Canvas rendering not available.");
      }

      const image = await loadImage(selectedBackground.imageUrl || FALLBACK_BACKGROUND_URL);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

      const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
      gradient.addColorStop(0, "rgba(9, 14, 28, 0.34)");
      gradient.addColorStop(1, "rgba(9, 14, 28, 0.5)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const panelWidth = Math.round(canvas.width * 0.72);
      const panelX = Math.round((canvas.width - panelWidth) / 2);
      const panelY = 180;
      const panelHeight = 540;

      ctx.fillStyle = "rgba(17,14,10,0.27)";
      ctx.fillRect(panelX, panelY, panelWidth, panelHeight);

      ctx.fillStyle = "#fffaf2";
      ctx.textAlign = "center";

      ctx.font = `700 64px ${selectedFont.family}`;
      const textLines = wrapText(ctx, selectedQuote.text, panelWidth - 160);
      const lineHeight = 78;
      let y = panelY + 130;
      for (const line of textLines.slice(0, 5)) {
        ctx.fillText(line, canvas.width / 2, y);
        y += lineHeight;
      }

      ctx.font = "700 42px sans-serif";
      ctx.fillText(selectedQuote.author, canvas.width / 2, panelY + panelHeight - 95);

      ctx.font = "400 30px sans-serif";
      ctx.fillText(selectedQuote.attribution, canvas.width / 2, panelY + panelHeight - 48);

      const link = document.createElement("a");
      const datePart = new Date().toISOString().slice(0, 10);
      link.download = `daily-quoter-${datePart}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not export PNG");
    } finally {
      setExporting(false);
    }
  }

  async function refreshBackgrounds(): Promise<void> {
    setRefreshingBackgrounds(true);
    setError(null);
    try {
      await onRefreshBackgrounds();
      setSelectedBackgroundId("");
      setSavedRecord(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to refresh backgrounds");
    } finally {
      setRefreshingBackgrounds(false);
    }
  }

  return (
    <section className="grid gap-4">
      <header className={panelClass}>
        <h2 className="mb-3 mt-0 text-xl" style={{ fontFamily: '"Palatino Linotype", "Book Antiqua", Palatino, serif' }}>
          Generate Daily Quote
        </h2>
        <p className="mt-0">
          Generate <strong>{quoteSuggestionCount}</strong> quote suggestions and choose from <strong>{backgroundSuggestionCount}</strong> background options.
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="button" className={cx(primaryButtonClass, "px-4 py-2.5 font-semibold")} onClick={generateQuotes} disabled={generating}>
            {generating ? "Generating..." : `Generate ${quoteSuggestionCount} Quotes`}
          </button>
          <button type="button" className={cx(uiButtonClass, "px-4 py-2.5 font-semibold")} onClick={refreshBackgrounds} disabled={refreshingBackgrounds}>
            {refreshingBackgrounds ? "Refreshing..." : "Refresh Backgrounds"}
          </button>
        </div>
      </header>

      {error ? <p className="m-0 rounded-xl border border-[#cb6c60] bg-[#fff0ed] px-3.5 py-2.5 text-[#a1372a]">{error}</p> : null}
      {savedRecord ? (
        <p className="m-0 rounded-xl border border-[#72a283] bg-[#f1fff6] px-3.5 py-2.5 text-[#2f6a45]">
          Saved quote #{savedRecord.id} on {formatDate(savedRecord.selectedOn)}.
        </p>
      ) : null}
      {roundLockedAfterSave ? (
        <p className="m-0 rounded-xl border border-[#82add2] bg-[#edf6ff] px-3.5 py-2.5 text-[#1f4f7e]">
          Selection locked for this round. Generate a new set of quotes to save again.
        </p>
      ) : null}
      {localQuoteNotice ? <p className="m-0 rounded-xl border border-[#82add2] bg-[#edf6ff] px-3.5 py-2.5 text-[#1f4f7e]">{localQuoteNotice}</p> : null}
      {backgroundNotice ? <p className="m-0 rounded-xl border border-[#82add2] bg-[#edf6ff] px-3.5 py-2.5 text-[#1f4f7e]">{backgroundNotice}</p> : null}
      {isExhausted ? (
        <p className="m-0 rounded-xl border border-[#b8964a] bg-[#fff7df] px-3.5 py-2.5 text-[#865c00]">No unused quote suggestions are currently available.</p>
      ) : null}

      {suggestions.length > 0 ? (
        <section className={panelClass}>
          <h3 className="mb-3 mt-0 text-lg" style={{ fontFamily: '"Palatino Linotype", "Book Antiqua", Palatino, serif' }}>
            1. Choose a Quote
          </h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
            {suggestions.map((quote, index) => (
              <button
                type="button"
                key={`${quote.text}-${index}`}
                aria-pressed={index === selectedQuoteIndex}
                className={cx(
                  uiButtonClass,
                  "w-full p-3.5 text-left",
                  index === selectedQuoteIndex && "border-[#d89a5a] bg-[#fff2e2]",
                )}
                onClick={() => {
                  setSelectedQuoteIndex(index);
                  setSavedRecord(null);
                }}
              >
                <p className="mb-2.5 mt-0">{quote.text}</p>
                <span className="text-sm text-[#6f6256]">
                  {quote.author} · {quote.attribution}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {selectedQuote ? (
        <section className={panelClass}>
          <h3 className="mb-3 mt-0 text-lg" style={{ fontFamily: '"Palatino Linotype", "Book Antiqua", Palatino, serif' }}>
            2. Choose Background
          </h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
            {backgrounds.map((background) => (
              <button
                type="button"
                key={background.id}
                aria-label={background.name}
                aria-pressed={selectedBackgroundId === background.id}
                className={cx(
                  uiButtonClass,
                  "relative min-h-[90px] overflow-hidden bg-cover bg-center",
                  selectedBackgroundId === background.id && "-translate-y-px border-[#d89a5a]",
                )}
                onClick={() => {
                  setSelectedBackgroundId(background.id);
                  setSavedRecord(null);
                }}
              >
                <img
                  src={background.imageUrl || FALLBACK_BACKGROUND_URL}
                  alt=""
                  className="h-full w-full object-cover"
                  onError={(event) => {
                    if (event.currentTarget.dataset.fallbackApplied === "1") {
                      return;
                    }
                    event.currentTarget.dataset.fallbackApplied = "1";
                    event.currentTarget.src = FALLBACK_BACKGROUND_URL;
                  }}
                />
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {selectedQuote && selectedBackground ? (
        <section className={panelClass}>
          <h3 className="mb-3 mt-0 text-lg" style={{ fontFamily: '"Palatino Linotype", "Book Antiqua", Palatino, serif' }}>
            3. Choose Font
          </h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
            {fonts.map((font) => (
              <button
                type="button"
                key={font.id}
                aria-pressed={selectedFont?.id === font.id}
                className={cx(
                  uiButtonClass,
                  "w-full p-3 text-left",
                  selectedFont?.id === font.id && "border-[#d89a5a] bg-[#fff2e2]",
                )}
                onClick={() => setSelectedFontId(font.id)}
              >
                <p className="m-0 text-lg" style={{ fontFamily: font.family }}>
                  {font.name}
                </p>
                <p className="m-0 text-xs uppercase tracking-wide text-[#6f6256]">{font.category}</p>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {selectedQuote && selectedBackground && selectedFont ? (
        <section className={panelClass}>
          <h3 className="mb-3 mt-0 text-lg" style={{ fontFamily: '"Palatino Linotype", "Book Antiqua", Palatino, serif' }}>
            4. Preview and Present
          </h3>
          <div
            className={cx(
              "mx-auto mb-4 w-full max-w-[780px] overflow-hidden rounded-2xl border border-[#d5cab6]",
            )}
          >
            <QuotePreview quote={selectedQuote} background={selectedBackground} font={selectedFont} fullscreen={false} />
          </div>
          <p className="mb-4 mt-0 text-sm text-[#6f6256]">
            Font: <strong>{selectedFont.name}</strong> · Background: {selectedBackground.name} ·{" "}
            {selectedBackground.creditUrl ? (
              <a className="underline-offset-2 hover:underline" href={selectedBackground.creditUrl} target="_blank" rel="noreferrer">
                {selectedBackground.credit}
              </a>
            ) : (
              <span>{selectedBackground.credit}</span>
            )}
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={cx(primaryButtonClass, "px-4 py-2.5 font-semibold")}
              onClick={saveSelection}
              disabled={saving || roundLockedAfterSave}
            >
              {saving ? "Saving..." : roundLockedAfterSave ? "Saved For This Round" : "Save Selection"}
            </button>
            <button type="button" className={cx(uiButtonClass, "px-4 py-2.5 font-semibold")} onClick={openFullscreenPreview}>
              Full Screen
            </button>
            <button type="button" className={cx(uiButtonClass, "px-4 py-2.5 font-semibold")} onClick={exportSelectionAsPng} disabled={exporting}>
              {exporting ? "Exporting..." : "Download PNG"}
            </button>
          </div>
        </section>
      ) : null}

      <PresentationOverlay
        isOpen={isPresentationOpen}
        quote={selectedQuote}
        background={selectedBackground}
        font={selectedFont}
        onClose={() => setIsPresentationOpen(false)}
      />
    </section>
  );
}

function SettingsPage({
  quoteSuggestionCount,
  backgroundSuggestionCount,
  defaultFontId,
  fonts,
  onSave,
}: {
  quoteSuggestionCount: number;
  backgroundSuggestionCount: number;
  defaultFontId: string;
  fonts: FontChoice[];
  onSave: (settings: AppSettings) => Promise<void>;
}) {
  const [quoteValue, setQuoteValue] = useState<number>(quoteSuggestionCount);
  const [backgroundValue, setBackgroundValue] = useState<number>(backgroundSuggestionCount);
  const [fontValue, setFontValue] = useState<string>(defaultFontId);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [controls, setControls] = useState<QuoteControlsResponse | null>(null);
  const [controlsLoading, setControlsLoading] = useState(true);
  const [controlsError, setControlsError] = useState<string | null>(null);
  const [allowText, setAllowText] = useState("");
  const [allowAuthor, setAllowAuthor] = useState("");
  const [allowAttribution, setAllowAttribution] = useState("");
  const [savingAllowlist, setSavingAllowlist] = useState(false);

  useEffect(() => {
    setQuoteValue(quoteSuggestionCount);
  }, [quoteSuggestionCount]);

  useEffect(() => {
    setBackgroundValue(backgroundSuggestionCount);
  }, [backgroundSuggestionCount]);

  useEffect(() => {
    setFontValue(defaultFontId);
  }, [defaultFontId]);

  useEffect(() => {
    let isMounted = true;

    async function loadControls(): Promise<void> {
      setControlsLoading(true);
      setControlsError(null);
      try {
        const data = await fetchJson<QuoteControlsResponse>("/api/quotes/controls");
        if (isMounted) {
          setControls(data);
        }
      } catch (requestError) {
        if (isMounted) {
          setControlsError(requestError instanceof Error ? requestError.message : "Could not load quote controls");
        }
      } finally {
        if (isMounted) {
          setControlsLoading(false);
        }
      }
    }

    void loadControls();

    return () => {
      isMounted = false;
    };
  }, []);

  async function saveSettings(): Promise<void> {
    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      const payload = await fetchJson<AppSettings>("/api/settings", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          quoteSuggestionCount: quoteValue,
          backgroundSuggestionCount: backgroundValue,
          defaultFontId: fontValue,
        }),
      });
      await onSave(payload);
      setQuoteValue(payload.quoteSuggestionCount);
      setBackgroundValue(payload.backgroundSuggestionCount);
      setFontValue(payload.defaultFontId);
      setMessage("Settings updated.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not save settings");
    } finally {
      setSaving(false);
    }
  }

  async function refreshControls(): Promise<void> {
    const data = await fetchJson<QuoteControlsResponse>("/api/quotes/controls");
    setControls(data);
  }

  async function addAllowlistEntry(): Promise<void> {
    setSavingAllowlist(true);
    setControlsError(null);
    try {
      await fetchJson<{ saved: boolean }>("/api/quotes/allow", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          quote: {
            text: allowText,
            author: allowAuthor || "Unknown",
            attribution: allowAttribution || "Allowlist",
          },
        }),
      });
      await refreshControls();
      setAllowText("");
      setAllowAuthor("");
      setAllowAttribution("");
    } catch (requestError) {
      setControlsError(requestError instanceof Error ? requestError.message : "Could not add allowlist quote");
    } finally {
      setSavingAllowlist(false);
    }
  }

  async function removeAllowlistEntry(quoteText: string): Promise<void> {
    setControlsError(null);
    try {
      await fetchJson<{ removed: boolean }>(`/api/quotes/allow?quote=${encodeURIComponent(quoteText)}`, {
        method: "DELETE",
      });
      await refreshControls();
    } catch (requestError) {
      setControlsError(requestError instanceof Error ? requestError.message : "Could not remove allowlist quote");
    }
  }

  async function unhideQuote(quoteText: string): Promise<void> {
    setControlsError(null);
    try {
      await fetchJson<{ removed: boolean }>(`/api/quotes/hide?quote=${encodeURIComponent(quoteText)}`, {
        method: "DELETE",
      });
      await refreshControls();
    } catch (requestError) {
      setControlsError(requestError instanceof Error ? requestError.message : "Could not unhide quote");
    }
  }

  return (
    <section className="grid gap-4">
      <section className={panelClass}>
        <h2 className="mb-3 mt-0 text-xl" style={{ fontFamily: '"Palatino Linotype", "Book Antiqua", Palatino, serif' }}>
          Settings
        </h2>
        <p className="mt-0">Control quote count, background count, and the default presentation font.</p>

        <label className="mb-2 inline-block font-semibold" htmlFor="quote-count">
          Quote suggestions per run
        </label>
        <input
          id="quote-count"
          type="number"
          min={1}
          max={20}
          className="mb-3 block w-[140px] rounded-lg border border-[#d5cab6] px-2.5 py-2"
          value={quoteValue}
          onChange={(event) => setQuoteValue(Number(event.target.value))}
        />

        <label className="mb-2 inline-block font-semibold" htmlFor="background-count">
          Background suggestions per run
        </label>
        <input
          id="background-count"
          type="number"
          min={1}
          max={24}
          className="mb-3 block w-[140px] rounded-lg border border-[#d5cab6] px-2.5 py-2"
          value={backgroundValue}
          onChange={(event) => setBackgroundValue(Number(event.target.value))}
        />

        <label className="mb-2 inline-block font-semibold" htmlFor="default-font">
          Default font
        </label>
        <select
          id="default-font"
          className="mb-3 block w-[240px] rounded-lg border border-[#d5cab6] bg-white px-2.5 py-2"
          value={fontValue}
          onChange={(event) => setFontValue(event.target.value)}
        >
          {fonts.map((font) => (
            <option key={font.id} value={font.id}>
              {font.name} ({font.category})
            </option>
          ))}
        </select>

        <div className="flex flex-wrap gap-3">
          <button type="button" className={cx(primaryButtonClass, "px-4 py-2.5 font-semibold")} onClick={saveSettings} disabled={saving}>
            {saving ? "Saving..." : "Save Settings"}
          </button>
        </div>
        {message ? <p className="mt-3 rounded-xl border border-[#72a283] bg-[#f1fff6] px-3.5 py-2.5 text-[#2f6a45]">{message}</p> : null}
        {error ? <p className="mt-3 rounded-xl border border-[#cb6c60] bg-[#fff0ed] px-3.5 py-2.5 text-[#a1372a]">{error}</p> : null}
      </section>

      <section className={panelClass}>
        <h3 className="mb-3 mt-0 text-lg" style={{ fontFamily: '"Palatino Linotype", "Book Antiqua", Palatino, serif' }}>
          Quote Quality Controls
        </h3>
        <p className="mt-0 text-sm text-[#6f6256]">
          Allowlist entries are prioritized in generation. Hidden quotes are excluded from future suggestions.
        </p>

        {controlsLoading ? <p>Loading controls...</p> : null}
        {controlsError ? <p className="rounded-xl border border-[#cb6c60] bg-[#fff0ed] px-3.5 py-2.5 text-[#a1372a]">{controlsError}</p> : null}

        <div className="mb-3 grid gap-2 md:grid-cols-3">
          <input
            type="text"
            value={allowText}
            onChange={(event) => setAllowText(event.target.value)}
            placeholder="Allowlist quote text"
            className="rounded-lg border border-[#d5cab6] px-2.5 py-2"
          />
          <input
            type="text"
            value={allowAuthor}
            onChange={(event) => setAllowAuthor(event.target.value)}
            placeholder="Author"
            className="rounded-lg border border-[#d5cab6] px-2.5 py-2"
          />
          <input
            type="text"
            value={allowAttribution}
            onChange={(event) => setAllowAttribution(event.target.value)}
            placeholder="Attribution"
            className="rounded-lg border border-[#d5cab6] px-2.5 py-2"
          />
        </div>
        <button
          type="button"
          className={cx(uiButtonClass, "mb-4 px-3 py-2 text-sm font-semibold")}
          disabled={savingAllowlist || !allowText.trim()}
          onClick={addAllowlistEntry}
        >
          {savingAllowlist ? "Adding..." : "Add To Allowlist"}
        </button>

        <h4 className="mb-2 mt-0 text-base">Allowlist</h4>
        <div className="mb-4 grid gap-2">
          {(controls?.allowlistQuotes ?? []).map((quote) => (
            <div key={quote.text} className="rounded-lg border border-[#d5cab6] bg-[#fffcf5] p-2.5">
              <p className="m-0">{quote.text}</p>
              <p className="m-0 text-sm text-[#6f6256]">
                {quote.author} · {quote.attribution}
              </p>
              <button
                type="button"
                className={cx(uiButtonClass, "mt-2 px-2.5 py-1.5 text-xs font-semibold")}
                onClick={() => {
                  void removeAllowlistEntry(quote.text);
                }}
              >
                Remove
              </button>
            </div>
          ))}
          {!controlsLoading && (controls?.allowlistQuotes.length ?? 0) === 0 ? <p className="m-0 text-sm text-[#6f6256]">No allowlist quotes yet.</p> : null}
        </div>

        <h4 className="mb-2 mt-0 text-base">Hidden Quotes</h4>
        <div className="grid gap-2">
          {(controls?.hiddenQuotes ?? []).map((entry) => (
            <div key={entry.normalizedQuote} className="rounded-lg border border-[#d5cab6] bg-[#fffcf5] p-2.5">
              <p className="m-0">{entry.quote}</p>
              <p className="m-0 text-sm text-[#6f6256]">Hidden on {formatDate(entry.createdOn)}</p>
              <button
                type="button"
                className={cx(uiButtonClass, "mt-2 px-2.5 py-1.5 text-xs font-semibold")}
                onClick={() => {
                  void unhideQuote(entry.quote);
                }}
              >
                Unhide
              </button>
            </div>
          ))}
          {!controlsLoading && (controls?.hiddenQuotes.length ?? 0) === 0 ? <p className="m-0 text-sm text-[#6f6256]">No hidden quotes.</p> : null}
        </div>
      </section>
    </section>
  );
}

function resolveHistoryBackground(item: QuoteHistoryItem, backgrounds: Background[]): Background {
  const fallbackBackground = backgrounds.find((entry) => entry.id === item.backgroundId);
  return {
    id: item.backgroundId || fallbackBackground?.id || `history-bg-${item.id}`,
    name: item.backgroundName || fallbackBackground?.name || "Saved background",
    imageUrl: item.backgroundImageUrl || fallbackBackground?.imageUrl || "",
    credit: item.backgroundCredit || fallbackBackground?.credit || "",
    creditUrl: item.backgroundCreditUrl || fallbackBackground?.creditUrl || "",
  };
}

function HistoryPage({ backgrounds }: { backgrounds: Background[] }) {
  const [items, setItems] = useState<QuoteHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [hidingQuote, setHidingQuote] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);
  const [presentationItem, setPresentationItem] = useState<QuoteHistoryItem | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadHistory(): Promise<void> {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchJson<{ items: QuoteHistoryItem[] }>("/api/quotes/history?limit=50");
        if (isMounted) {
          setItems(data.items);
        }
      } catch (requestError) {
        if (isMounted) {
          setError(requestError instanceof Error ? requestError.message : "Could not load history");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    void loadHistory();

    return () => {
      isMounted = false;
    };
  }, []);

  function openHistoryFullscreen(item: QuoteHistoryItem): void {
    setActionMessage(null);
    setError(null);
    setPresentationItem(item);
  }

  async function deleteEntry(item: QuoteHistoryItem): Promise<void> {
    if (!window.confirm(`Delete saved quote #${item.id}?`)) {
      return;
    }

    setDeletingId(item.id);
    setActionMessage(null);
    setError(null);

    try {
      await fetchJson<{ deleted: true }>(`/api/quotes/history/${item.id}`, { method: "DELETE" });
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      setActionMessage(`Deleted quote #${item.id}.`);
      if (presentationItem?.id === item.id) {
        setPresentationItem(null);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not delete history entry");
    } finally {
      setDeletingId(null);
    }
  }

  async function deleteAllEntries(): Promise<void> {
    if (items.length === 0) {
      return;
    }
    if (!window.confirm(`Delete all ${items.length} saved history entries?`)) {
      return;
    }

    setClearingAll(true);
    setActionMessage(null);
    setError(null);

    try {
      const data = await fetchJson<{ deleted: number }>("/api/quotes/history", { method: "DELETE" });
      setItems([]);
      setActionMessage(`Deleted ${data.deleted} history entr${data.deleted === 1 ? "y" : "ies"}.`);
      setPresentationItem(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not clear history");
    } finally {
      setClearingAll(false);
    }
  }

  async function hideQuoteFromSuggestions(quoteText: string): Promise<void> {
    if (!window.confirm("Hide this quote from future suggestions?")) {
      return;
    }

    setHidingQuote(quoteText);
    setActionMessage(null);
    setError(null);

    try {
      await fetchJson<{ added: boolean }>("/api/quotes/hide", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ quoteText }),
      });
      setItems((current) => current.filter((entry) => entry.quote !== quoteText));
      setActionMessage("Quote hidden from future suggestions.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not hide quote");
    } finally {
      setHidingQuote(null);
    }
  }

  return (
    <section className="grid gap-4">
      <section className={panelClass}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="mb-3 mt-0 text-xl" style={{ fontFamily: '"Palatino Linotype", "Book Antiqua", Palatino, serif' }}>
              Past Quotes
            </h2>
            <p className="mb-0 mt-0">Previously selected and saved standup quote slides.</p>
          </div>
          <button
            type="button"
            className={cx(uiButtonClass, "px-4 py-2.5 font-semibold")}
            disabled={loading || clearingAll || items.length === 0}
            onClick={deleteAllEntries}
          >
            {clearingAll ? "Deleting..." : "Delete All History"}
          </button>
        </div>

        {loading ? <p>Loading history...</p> : null}
        {error ? <p className="rounded-xl border border-[#cb6c60] bg-[#fff0ed] px-3.5 py-2.5 text-[#a1372a]">{error}</p> : null}
        {actionMessage ? <p className="rounded-xl border border-[#72a283] bg-[#f1fff6] px-3.5 py-2.5 text-[#2f6a45]">{actionMessage}</p> : null}
        {!loading && !error && items.length === 0 ? <p>No quotes saved yet.</p> : null}
        <div className="grid gap-3">
          {items.map((item) => {
            const background = resolveHistoryBackground(item, backgrounds);
            const historyQuote: Quote = {
              text: item.quote,
              author: item.author,
              attribution: item.attribution,
            };
            const historyFont: FontChoice = {
              id: item.fontId || `history-font-${item.id}`,
              name: item.fontName || "Saved Font",
              family: item.fontFamily || '"Palatino Linotype", "Book Antiqua", Palatino, serif',
              category: "serif",
            };

            return (
              <article
                className="grid overflow-hidden rounded-xl border border-[#d5cab6] bg-[#fffcf5] md:grid-cols-[minmax(260px,34%)_1fr]"
                key={item.id}
                data-history-entry={item.id}
              >
                <div className="overflow-hidden border-b border-[#e7decb] md:border-b-0 md:border-r">
                  <QuotePreview quote={historyQuote} background={background} font={historyFont} fullscreen={false} />
                </div>
                <div className="p-3">
                  <p className="mb-2.5 mt-0" style={{ fontFamily: historyFont.family }}>
                    {item.quote}
                  </p>
                  <p className="m-0 text-sm text-[#6f6256]">
                    {item.author} · {item.attribution}
                  </p>
                  <p className="m-0 text-sm text-[#6f6256]">Font: {historyFont.name}</p>
                  {background.credit ? (
                    <p className="m-0 text-sm text-[#6f6256]">
                      Background:{" "}
                      {background.creditUrl ? (
                        <a className="underline-offset-2 hover:underline" href={background.creditUrl} target="_blank" rel="noreferrer">
                          {background.credit}
                        </a>
                      ) : (
                        background.credit
                      )}
                    </p>
                  ) : null}
                  <p className="m-0 text-sm text-[#6f6256]">{formatDate(item.selectedOn)}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={cx(primaryButtonClass, "px-3 py-2 text-sm font-semibold")}
                      aria-label={`Full Screen entry #${item.id}`}
                      onClick={() => {
                        openHistoryFullscreen(item);
                      }}
                    >
                      Full Screen
                    </button>
                    <button
                      type="button"
                      className={cx(uiButtonClass, "px-3 py-2 text-sm font-semibold")}
                      aria-label={`Delete entry #${item.id}`}
                      disabled={deletingId === item.id || clearingAll || hidingQuote === item.quote}
                      onClick={() => {
                        void deleteEntry(item);
                      }}
                    >
                      {deletingId === item.id ? "Deleting..." : "Delete Entry"}
                    </button>
                    <button
                      type="button"
                      className={cx(uiButtonClass, "px-3 py-2 text-sm font-semibold")}
                      disabled={hidingQuote === item.quote || deletingId === item.id || clearingAll}
                      onClick={() => {
                        void hideQuoteFromSuggestions(item.quote);
                      }}
                    >
                      {hidingQuote === item.quote ? "Hiding..." : "Hide Quote"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <PresentationOverlay
        isOpen={presentationItem !== null}
        quote={
          presentationItem
            ? {
                text: presentationItem.quote,
                author: presentationItem.author,
                attribution: presentationItem.attribution,
              }
            : null
        }
        background={presentationItem ? resolveHistoryBackground(presentationItem, backgrounds) : null}
        font={
          presentationItem
            ? {
                id: presentationItem.fontId || `history-font-${presentationItem.id}`,
                name: presentationItem.fontName || "Saved Font",
                family: presentationItem.fontFamily || '"Palatino Linotype", "Book Antiqua", Palatino, serif',
                category: "serif",
              }
            : null
        }
        onClose={() => setPresentationItem(null)}
      />
    </section>
  );
}

export function App() {
  const [view, setView] = useState<View>(() => pathToView(window.location.pathname));
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [quoteSuggestionCount, setQuoteSuggestionCount] = useState(5);
  const [backgroundSuggestionCount, setBackgroundSuggestionCount] = useState(8);
  const [defaultFontId, setDefaultFontId] = useState("");
  const [fonts, setFonts] = useState<FontChoice[]>([]);
  const [backgrounds, setBackgrounds] = useState<Background[]>([]);
  const [backgroundNotice, setBackgroundNotice] = useState<string | null>(null);

  useEffect(() => {
    function handleRouteChange(): void {
      setView(pathToView(window.location.pathname));
    }

    window.addEventListener("popstate", handleRouteChange);
    return () => {
      window.removeEventListener("popstate", handleRouteChange);
    };
  }, []);

  async function loadBackgrounds(count: number): Promise<void> {
    const data = await fetchJson<BackgroundResponse>(`/api/backgrounds?count=${count}`);
    setBackgrounds(data.backgrounds);
    setBackgroundNotice(data.notice ?? null);
  }

  useEffect(() => {
    let isMounted = true;

    async function boot(): Promise<void> {
      setSettingsLoading(true);
      setSettingsError(null);
      try {
        const [settings, fontsData] = await Promise.all([
          fetchJson<AppSettings>("/api/settings"),
          fetchJson<FontResponse>("/api/fonts"),
        ]);

        if (!isMounted) {
          return;
        }

        setQuoteSuggestionCount(settings.quoteSuggestionCount);
        setBackgroundSuggestionCount(settings.backgroundSuggestionCount);
        setDefaultFontId(settings.defaultFontId);
        setFonts(fontsData.fonts);
        await loadBackgrounds(settings.backgroundSuggestionCount);
      } catch (requestError) {
        if (!isMounted) {
          return;
        }
        setSettingsError(requestError instanceof Error ? requestError.message : "Failed to load app data");
      } finally {
        if (isMounted) {
          setSettingsLoading(false);
        }
      }
    }

    void boot();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div
      className="min-h-screen text-[#2a2017]"
      style={{
        background:
          "radial-gradient(circle at 15% -10%, #f7cf9f 0, transparent 34%), radial-gradient(circle at 90% 0%, #f2d8bb 0, transparent 30%), linear-gradient(160deg, #f6f1e6, #ece7db)",
      }}
    >
      <div className="mx-auto min-h-screen max-w-[1120px] p-5">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="m-0 text-[clamp(1.7rem,4.2vw,2.4rem)]" style={{ fontFamily: '"Palatino Linotype", "Book Antiqua", Palatino, serif' }}>
              Daily Quoter
            </h1>
            <p className="mb-0 mt-1 text-[#6f6256]">Standup quote generator and presenter</p>
          </div>
          <nav className="flex gap-2" aria-label="Main navigation">
            <button
              type="button"
              className={cx(uiButtonClass, "cursor-pointer px-3 py-2 font-semibold", view === "generate" && "border-[#d9a46f] bg-[#fff3e0]")}
              onClick={() => navigate("/")}
            >
              Generate
            </button>
            <button
              type="button"
              className={cx(uiButtonClass, "cursor-pointer px-3 py-2 font-semibold", view === "history" && "border-[#d9a46f] bg-[#fff3e0]")}
              onClick={() => navigate("/history")}
            >
              History
            </button>
            <button
              type="button"
              className={cx(uiButtonClass, "cursor-pointer px-3 py-2 font-semibold", view === "settings" && "border-[#d9a46f] bg-[#fff3e0]")}
              onClick={() => navigate("/settings")}
            >
              Settings
            </button>
          </nav>
        </header>

        <main className="grid gap-4">
          {settingsLoading ? <p>Loading app...</p> : null}
          {settingsError ? <p className="rounded-xl border border-[#cb6c60] bg-[#fff0ed] px-3.5 py-2.5 text-[#a1372a]">{settingsError}</p> : null}

          {!settingsLoading && !settingsError && view === "generate" ? (
            <GeneratePage
              quoteSuggestionCount={quoteSuggestionCount}
              backgroundSuggestionCount={backgroundSuggestionCount}
              defaultFontId={defaultFontId}
              backgrounds={backgrounds}
              fonts={fonts}
              backgroundNotice={backgroundNotice}
              onRefreshBackgrounds={async () => {
                await loadBackgrounds(backgroundSuggestionCount);
              }}
            />
          ) : null}

          {!settingsLoading && !settingsError && view === "settings" ? (
            <SettingsPage
              quoteSuggestionCount={quoteSuggestionCount}
              backgroundSuggestionCount={backgroundSuggestionCount}
              defaultFontId={defaultFontId}
              fonts={fonts}
              onSave={async (settings) => {
                setQuoteSuggestionCount(settings.quoteSuggestionCount);
                setBackgroundSuggestionCount(settings.backgroundSuggestionCount);
                setDefaultFontId(settings.defaultFontId);
                await loadBackgrounds(settings.backgroundSuggestionCount);
              }}
            />
          ) : null}

          {!settingsLoading && !settingsError && view === "history" ? <HistoryPage backgrounds={backgrounds} /> : null}
        </main>
      </div>
    </div>
  );
}
