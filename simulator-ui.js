// Presentation controls only. Quotes, validity and lead submission stay in simulator-core.js.
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const type = byId('tipoViatura');
  const term = byId('prazo');
  const quoteCard = byId('summaryCard');
  const payment = byId('prestacaoResumo');
  const status = byId('quoteStatus');
  const sendButton = byId('leadBtn');
  const contactButton = byId('contactOpen');
  const dockButton = byId('dockContact');
  const dock = byId('mobileDock');
  const sheet = byId('contactSheet');
  const mobile = window.matchMedia('(max-width: 819px)');
  const vehicleButtons = [...document.querySelectorAll('[data-vehicle]')];
  const termButtons = [...document.querySelectorAll('[data-months]')];
  let quoteVisible = false;
  let opener = contactButton;

  function quoteIsValid() {
    return typeof isQuoteCurrent === 'function' && isQuoteCurrent();
  }

  function syncView() {
    const valid = quoteIsValid();
    const available = valid && !sendButton.disabled;
    contactButton.disabled = !available;
    dockButton.disabled = !available;
    vehicleButtons.forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.vehicle === type.value));
    });
    const min = Number(term.min);
    const max = Number(term.max);
    const step = Number(term.step);
    const months = Number(term.value);
    termButtons.forEach(button => {
      const value = Number(button.dataset.months);
      button.disabled = term.disabled || value < min || value > max || !step || (value - min) % step !== 0;
      button.setAttribute('aria-pressed', String(value === months));
    });
    const progress = max > min ? Math.max(0, Math.min(100, (months - min) / (max - min) * 100)) : 0;
    term.style.setProperty('--range-progress', `${progress}%`);
    quoteCard.dataset.quoteState = status.dataset.state || 'idle';
    quoteCard.classList.toggle('long-payment', payment.textContent.trim().length > 8);
    byId('contactPayment').textContent = valid ? payment.textContent : '—';
    byId('contactQuoteHint').textContent = valid ? '' : 'Atualize a simulação para confirmar os valores antes de enviar o pedido.';
    byId('dockLabel').textContent = status.dataset.state === 'loading' ? 'A consultar…' : valid ? 'Por mês' : 'Confirme os valores';
    dock.hidden = !mobile.matches || !byId('pvp').value.trim() || quoteVisible || sheet.open;
  }

  function openContact(event) {
    syncView();
    if (!quoteIsValid() || sendButton.disabled || sheet.open) return;
    opener = event.currentTarget;
    sheet.showModal();
    document.body.classList.add('sheet-open');
    syncView();
  }

  vehicleButtons.forEach(button => button.addEventListener('click', () => {
    if (type.value === button.dataset.vehicle) return;
    type.value = button.dataset.vehicle;
    type.dispatchEvent(new Event('change', { bubbles: true }));
    syncView();
  }));

  termButtons.forEach(button => button.addEventListener('click', () => {
    if (button.disabled) return;
    term.value = button.dataset.months;
    term.dispatchEvent(new Event('input', { bubbles: true }));
    syncView();
  }));

  [byId('pvp'), byId('entrada'), term].forEach(input => input.addEventListener('input', syncView));
  type.addEventListener('change', syncView);
  contactButton.addEventListener('click', openContact);
  dockButton.addEventListener('click', openContact);
  byId('contactClose').addEventListener('click', () => sheet.close());
  sheet.addEventListener('close', () => {
    document.body.classList.remove('sheet-open');
    syncView();
    if (!opener.disabled && !opener.closest('[hidden]')) opener.focus({ preventScroll: true });
    else byId('refreshBtn').focus({ preventScroll: true });
  });
  sheet.addEventListener('click', event => {
    if (event.target !== sheet) return;
    const rect = sheet.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) sheet.close();
  });

  // Observe only core-owned nodes/attributes. syncView does not write back to them.
  const updates = new MutationObserver(syncView);
  updates.observe(sendButton, { attributes: true, attributeFilter: ['disabled'] });
  updates.observe(payment, { childList: true, subtree: true, characterData: true });
  updates.observe(status, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-state'] });
  updates.observe(term, { attributes: true, attributeFilter: ['min', 'max', 'step', 'disabled'] });
  updates.observe(byId('prazoLabel'), { childList: true, subtree: true });
  if ('IntersectionObserver' in window) {
    const visibility = new IntersectionObserver(entries => {
      quoteVisible = entries[0].intersectionRatio >= 0.55;
      syncView();
    }, { threshold: [0, 0.55, 1] });
    visibility.observe(quoteCard);
  }
  mobile.addEventListener('change', syncView);
  window.addEventListener('pageshow', syncView);
  syncView();
})();
