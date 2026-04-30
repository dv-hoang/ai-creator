import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

const MAX_VISIBLE = 400;

function narrowModelChoices(optionList: string[], text: string): string[] {
  if (optionList.length === 0) {
    return [];
  }
  const q = text.trim().toLowerCase();
  if (!q) {
    return optionList.slice(0, MAX_VISIBLE);
  }
  return optionList
    .filter((o) => o.toLowerCase().includes(q))
    .slice(0, MAX_VISIBLE);
}

type SearchableModelSelectProps = {
  options: string[];
  value: string;
  onChange: (model: string) => void;
  disabled?: boolean;
  /** Shown when the input is empty and options exist */
  searchPlaceholder: string;
  /** Shown when `options` is empty */
  emptyPlaceholder: string;
  /** When the typed filter matches nothing */
  noMatchesHint: string;
  ariaLabel: string;
};

export function SearchableModelSelect({
  options,
  value,
  onChange,
  disabled = false,
  searchPlaceholder,
  emptyPlaceholder,
  noMatchesHint,
  ariaLabel,
}: SearchableModelSelectProps) {
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef(value);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [highlight, setHighlight] = useState(0);

  draftRef.current = draft;

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const filtered = useMemo(
    () => narrowModelChoices(options, draft),
    [draft, options],
  );

  useEffect(() => {
    setHighlight((h) =>
      filtered.length === 0 ? 0 : Math.min(h, filtered.length - 1),
    );
  }, [filtered.length]);

  function commitSelection(next: string) {
    onChange(next);
    setDraft(next);
    setOpen(false);
  }

  function resolveDraftToModel(): string | null {
    const raw = draftRef.current.trim();
    if (!raw) {
      return null;
    }
    const exact = options.find((o) => o === raw);
    if (exact) {
      return exact;
    }
    const ci = options.find((o) => o.toLowerCase() === raw.toLowerCase());
    if (ci) {
      return ci;
    }
    const narrowed = narrowModelChoices(options, raw);
    if (narrowed.length === 1) {
      return narrowed[0] ?? null;
    }
    return null;
  }

  function closeIfFocusLeft() {
    requestAnimationFrame(() => {
      if (wrapRef.current?.contains(document.activeElement)) {
        return;
      }
      setOpen(false);
      const resolved = resolveDraftToModel();
      if (resolved) {
        if (resolved !== value) {
          onChange(resolved);
        }
        setDraft(resolved);
      } else {
        setDraft(value);
      }
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (disabled) {
      return;
    }
    if (options.length === 0) {
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) =>
        filtered.length === 0 ? 0 : Math.min(h + 1, filtered.length - 1),
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && filtered[highlight]) {
        commitSelection(filtered[highlight]!);
      } else {
        const resolved = resolveDraftToModel();
        if (resolved) {
          commitSelection(resolved);
        }
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setDraft(value);
    }
  }

  const noOptions = options.length === 0;

  return (
    <div className="searchable-model-select" ref={wrapRef}>
      <input
        type="text"
        role="combobox"
        aria-expanded={open && !noOptions}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        aria-activedescendant={
          open && filtered[highlight] ? `${listId}-opt-${highlight}` : undefined
        }
        disabled={disabled || noOptions}
        value={noOptions ? value : draft}
        readOnly={noOptions}
        placeholder={noOptions ? emptyPlaceholder : searchPlaceholder}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          setOpen(true);
          setHighlight(0);
        }}
        onFocus={() => {
          if (!noOptions && !disabled) {
            setOpen(true);
          }
        }}
        onBlur={closeIfFocusLeft}
        onKeyDown={onKeyDown}
      />
      {open && !noOptions && !disabled && (
        <ul
          id={listId}
          className="searchable-model-select__list"
          role="listbox"
        >
          {filtered.length === 0 ? (
            <li className="searchable-model-select__hint" role="presentation">
              {noMatchesHint}
            </li>
          ) : (
            filtered.map((opt, i) => (
              <li key={opt} role="presentation">
                <div
                  id={`${listId}-opt-${i}`}
                  role="option"
                  aria-selected={opt === value}
                  className={`searchable-model-select__option${i === highlight ? " searchable-model-select__option--active" : ""}`}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(ev) => {
                    ev.preventDefault();
                    commitSelection(opt);
                  }}
                >
                  {opt}
                </div>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
