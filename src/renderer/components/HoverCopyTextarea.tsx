export function HoverCopyTextarea(props: {
  value: string;
  rows: number;
  onChange: (value: string) => void;
  onCopy: () => void;
  placeholder?: string;
  readOnly?: boolean;
}) {
  return (
    <div className="textarea-copy-wrap">
      <textarea
        rows={props.rows}
        value={props.value}
        readOnly={props.readOnly}
        onChange={(event) => {
          if (props.readOnly) return;
          props.onChange(event.target.value);
        }}
        placeholder={props.placeholder}
      />
      <button
        type="button"
        className="copy-icon-btn"
        onClick={props.onCopy}
        aria-label="copy"
        title="copy"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 9h11v11H9z" />
          <path d="M4 4h11v2H6v9H4z" />
        </svg>
      </button>
    </div>
  );
}
