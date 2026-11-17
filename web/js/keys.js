// Keyboard helpers shared by the entry forms.

// True only for Ctrl+Enter or Cmd+Enter outside an IME composition.
// Plain Enter is never a submit: in a textarea it inserts a newline.
export function isSubmitKey({ key, ctrlKey, metaKey, isComposing }) {
  return key === 'Enter' && (!!ctrlKey || !!metaKey) && !isComposing;
}

// Same check straight from a DOM keydown event. Safari reports the Enter that confirms an IME
// candidate with isComposing false but keyCode 229, so both count as composing.
export function isSubmitEvent(ev) {
  return isSubmitKey({
    key: ev.key,
    ctrlKey: ev.ctrlKey,
    metaKey: ev.metaKey,
    isComposing: !!ev.isComposing || ev.keyCode === 229,
  });
}
