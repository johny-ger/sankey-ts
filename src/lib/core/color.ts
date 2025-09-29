/** Нативный color-picker. Вызывает onPick при изменении/закрытии. */
export function pickColor(initial: string, onPick: (color: string) => void) {
  const input = document.createElement('input');
  input.type = 'color';
  input.value = initial;
  input.style.position = 'fixed';
  input.style.left = '-9999px';
  document.body.appendChild(input);
  input.click();

  input.oninput  = () => onPick(input.value);
  input.onchange = () => { onPick(input.value); cleanup(); };
  input.onblur   = () => cleanup();

  function cleanup() {
    if (document.body.contains(input)) document.body.removeChild(input);
  }
}
