/** Inline degraded-mode strip: rendered when a polling hook has an error,
 * so a dead server never freezes a card silently. */
export function StaleNotice(props: { error?: string; label?: string }) {
  if (!props.error) return null;
  return (
    <div className="stale-strip" role="status">
      ⚠️ Couldn't refresh{props.label ? ` (${props.label})` : ""} — showing the last loaded data. Check that the Cortex server is running.
    </div>
  );
}
