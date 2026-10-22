import type { ComponentChildren } from 'preact';

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ComponentChildren;
}) {
  return (
    <label class={`field${error ? ' has-error' : ''}`}>
      <span class="field-label">{label}</span>
      {children}
      {hint && !error && <span class="field-hint">{hint}</span>}
      {error && (
        <span class="field-error" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}

/** Text input for decimals; keeps the raw text so partial input like "1." survives re-renders. */
export function NumberInput({
  value,
  onInput,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onInput: (text: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onInput={(e) => onInput(e.currentTarget.value)}
    />
  );
}

/** Free-text input with suggestions (units etc.). */
export function SuggestInput({
  id,
  value,
  options,
  onInput,
  ariaLabel,
  placeholder,
}: {
  id: string;
  value: string;
  options: readonly string[];
  onInput: (text: string) => void;
  ariaLabel?: string;
  placeholder?: string;
}) {
  return (
    <>
      <input
        list={id}
        value={value}
        aria-label={ariaLabel}
        placeholder={placeholder}
        autoComplete="off"
        onInput={(e) => onInput(e.currentTarget.value)}
      />
      <datalist id={id}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div class="segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          class={o.value === value ? 'selected' : undefined}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({
  selected,
  onClick,
  children,
  ariaLabel,
}: {
  selected: boolean;
  onClick: () => void;
  children: ComponentChildren;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      class={`chip${selected ? ' selected' : ''}`}
      aria-pressed={selected}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label class="switch-row">
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
    </label>
  );
}
