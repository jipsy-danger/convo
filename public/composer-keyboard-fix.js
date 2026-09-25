(() => {
  const input = document.getElementById('msgInput');
  if (!input) return;

  input.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (event.key !== 'Enter' || event.shiftKey) return;

    event.preventDefault();
    event.stopPropagation();
    window.handlePostMessage?.();
  });
})();
