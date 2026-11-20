(() => {
  'use strict';

  const form = document.getElementById('simulation-form');
  const priceInput = document.getElementById('price');
  const entryInput = document.getElementById('down-payment');
  const monthsInput = document.getElementById('months');
  const updateButton = document.getElementById('update-button');
  const minusButton = document.getElementById('term-minus');
  const plusButton = document.getElementById('term-plus');
  const alternativeButton = document.getElementById('alternative-button');
  const card = document.getElementById('result-card');
  const feedback = document.getElementById('form-feedback');
  const currency = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' });
  const timestamp = new Intl.DateTimeFormat('pt-PT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Lisbon' });
  const clock = new Intl.DateTimeFormat('pt-PT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Lisbon' });

  let products = null;
  let timer;
  let controller;
  let requestVersion = 0;
  let alternativeAction = null;
  let configLoading = false;

  const text = (id, value) => { document.getElementById(id).textContent = value; };
  const vehicleType = () => form.elements.vehicleType.value;
  const limits = () => products?.[vehicleType()];
  const isCentValue = value => Number.isFinite(value) && Math.abs(value * 100 - Math.round(value * 100)) < 0.00001;

  function clearQuote() {
    ['payment', 'tan', 'taeg', 'mtic', 'source-name', 'retrieved-at', 'quote-vehicle', 'quote-inputs'].forEach(id => text(id, '—'));
    const sourceLink = document.getElementById('source-link');
    sourceLink.hidden = true;
    sourceLink.removeAttribute('href');
    text('result-summary', 'Ainda sem resultado para estes dados.');
  }

  function setState(state, message) {
    card.dataset.state = state;
    card.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
    text('status-message', message);
  }

  function clearAlternative() {
    alternativeAction = null;
    alternativeButton.hidden = true;
    alternativeButton.textContent = '';
  }

  function suggest(label, action) {
    alternativeButton.textContent = label;
    alternativeButton.hidden = false;
    alternativeAction = action;
  }

  function updateDerivedFields() {
    const price = priceInput.value === '' ? NaN : Number(priceInput.value);
    const entry = entryInput.value === '' ? NaN : Number(entryInput.value);
    const amount = price - entry;
    text('amount', Number.isFinite(amount) && amount >= 0 ? currency.format(amount) : '—');
    const months = Number(monthsInput.value);
    const monthLabel = document.getElementById('months-label');
    monthLabel.replaceChildren(document.createTextNode(`${months} `));
    const unit = document.createElement('span');
    unit.textContent = 'meses';
    monthLabel.appendChild(unit);
    const years = Math.floor(months / 12);
    const rest = months % 12;
    text('years-label', [years ? `${years} ${years === 1 ? 'ano' : 'anos'}` : '', rest ? `${rest} meses` : ''].filter(Boolean).join(' e '));
    minusButton.disabled = !products || months <= Number(monthsInput.min);
    plusButton.disabled = !products || months >= Number(monthsInput.max);
    monthsInput.setAttribute('aria-valuetext', `${months} meses`);
  }

  function updateLimits() {
    const current = limits();
    if (!current) return;
    monthsInput.min = current.minMonths;
    monthsInput.max = current.maxMonths;
    monthsInput.step = current.monthStep;
    text('months-min', `${current.minMonths} meses`);
    text('months-max', `${current.maxMonths} meses`);
    text('term-guidance', `Prazo em intervalos de ${current.monthStep} meses.`);
    minusButton.setAttribute('aria-label', `Reduzir o prazo em ${current.monthStep} meses`);
    plusButton.setAttribute('aria-label', `Aumentar o prazo em ${current.monthStep} meses`);
    text('amount-guidance', `De ${currency.format(current.minAmount)} a ${currency.format(current.maxAmount)}. Neste modo, o montante a financiar varia de ${currency.format(current.amountStep)} em ${currency.format(current.amountStep)}.`);
    updateDerivedFields();
  }

  function validate() {
    const current = limits();
    if (!current) return { message: 'As condições de simulação ainda não estão disponíveis.' };
    const price = priceInput.value.trim() === '' ? NaN : Number(priceInput.value);
    const entry = entryInput.value.trim() === '' ? NaN : Number(entryInput.value);
    if (!isCentValue(price) || price <= 0 || price > 10000000) return { message: 'Indica um preço válido para a viatura, com um máximo de duas casas decimais.' };
    if (!isCentValue(entry) || entry < 0) return { message: 'A entrada inicial deve ser igual ou superior a zero, com um máximo de duas casas decimais.' };
    if (entry > price) return { message: 'A entrada inicial não pode ser superior ao preço da viatura.' };
    const amount = Math.round((price - entry) * 100) / 100;
    if (amount < current.minAmount || amount > current.maxAmount) return { message: `O montante a financiar deve estar entre ${currency.format(current.minAmount)} e ${currency.format(current.maxAmount)}.` };
    const amountCents = Math.round(amount * 100);
    const stepCents = Math.round(current.amountStep * 100);
    if (amountCents % stepCents !== 0) {
      const adjustedAmount = Math.floor(amountCents / stepCents) * current.amountStep;
      const adjustedEntry = Math.round((price - adjustedAmount) * 100) / 100;
      return {
        message: `Para esta consulta, o montante a financiar tem de ser um múltiplo de ${currency.format(current.amountStep)}. Os teus valores não foram arredondados.`,
        suggestion: adjustedAmount >= current.minAmount ? {
          label: `Usar entrada de ${currency.format(adjustedEntry)} · financiar ${currency.format(adjustedAmount)}`,
          action: () => { entryInput.value = adjustedEntry.toFixed(2); onChange(); }
        } : null
      };
    }
    const months = Number(monthsInput.value);
    if (!Number.isInteger(months) || months < current.minMonths || months > current.maxMonths || (months - current.minMonths) % current.monthStep !== 0) {
      return { message: `Escolhe um prazo entre ${current.minMonths} e ${current.maxMonths} meses, em intervalos de ${current.monthStep} meses.` };
    }
    return { input: { amount, months, vehicleType: vehicleType() } };
  }

  function applyValidation(validation) {
    clearAlternative();
    feedback.textContent = validation.message || '';
    if (validation.suggestion) suggest(validation.suggestion.label, validation.suggestion.action);
    return Boolean(validation.input);
  }

  function cancelPending() {
    clearTimeout(timer);
    controller?.abort();
    controller = null;
    requestVersion += 1;
  }

  function onChange() {
    cancelPending();
    clearQuote();
    updateDerivedFields();
    if (!products) return;
    const validation = validate();
    updateButton.disabled = !applyValidation(validation);
    if (!validation.input) {
      setState('idle', 'Revê os dados para obter uma simulação.');
      return;
    }
    setState('idle', 'Dados atualizados. A preparar a consulta…');
    timer = setTimeout(requestQuote, 650);
  }

  function isValidQuote(quote, input) {
    if (!quote || quote.amount !== input.amount || quote.months !== input.months || quote.vehicleType !== input.vehicleType) return false;
    if (![quote.payment, quote.tan, quote.taeg, quote.mtic].every(Number.isFinite)) return false;
    if (quote.payment <= 0 || quote.tan < 0 || quote.taeg < 0 || quote.mtic < input.amount) return false;
    if (!['payment', 'tan', 'taeg', 'mtic'].every(key => typeof quote.display?.[key] === 'string' && quote.display[key].length > 0 && quote.display[key].length < 70)) return false;
    if (!Number.isFinite(Date.parse(quote.retrievedAt)) || typeof quote.source?.name !== 'string' || !quote.source.name.trim()) return false;
    return true;
  }

  function showQuote(quote) {
    const fetched = new Date(quote.retrievedAt);
    ['payment', 'tan', 'taeg', 'mtic'].forEach(key => text(key, quote.display[key]));
    text('result-summary', `${currency.format(quote.amount)} a ${quote.months} meses`);
    text('source-name', `${quote.source.name} · simulador público`);
    text('retrieved-at', `${timestamp.format(fetched)} · hora de Lisboa`);
    text('quote-vehicle', quote.vehicleType === 'used' ? 'Usada' : 'Nova (1.º registo)');
    text('quote-inputs', `${currency.format(quote.amount)} · ${quote.months} meses`);
    const sourceLink = document.getElementById('source-link');
    try {
      const sourceUrl = new URL(quote.source.url);
      if (sourceUrl.protocol === 'https:' && sourceUrl.hostname === 'www.credibom.pt') {
        sourceLink.href = sourceUrl.href;
        sourceLink.hidden = false;
      }
    } catch { /* The numeric result remains useful without an external link. */ }
    setState('success', `Consulta confirmada às ${clock.format(fetched)} · hora de Lisboa`);
  }

  async function requestQuote() {
    cancelPending();
    clearQuote();
    const validation = validate();
    if (!applyValidation(validation)) {
      updateButton.disabled = true;
      setState('idle', 'Revê os dados para obter uma simulação.');
      return;
    }
    const input = validation.input;
    const version = requestVersion;
    const currentController = new AbortController();
    controller = currentController;
    updateButton.disabled = true;
    setState('loading', 'A consultar a simulação…');
    text('result-summary', `${currency.format(input.amount)} a ${input.months} meses`);
    let timeout;
    try {
      timeout = setTimeout(() => currentController.abort('timeout'), 30000);
      const response = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(input),
        signal: currentController.signal,
        cache: 'no-store'
      });
      const data = await response.json();
      if (version !== requestVersion) return;
      if (!response.ok) {
        const message = typeof data.error?.message === 'string' ? data.error.message : 'Não foi possível confirmar estes valores. Tenta novamente dentro de momentos.';
        const error = new Error(message);
        error.limits = data.error?.limits;
        throw error;
      }
      if (!isValidQuote(data.quote, input)) throw new Error('A resposta recebida não corresponde aos dados escolhidos. Atualiza a simulação para tentar novamente.');
      showQuote(data.quote);
    } catch (error) {
      if (version !== requestVersion) return;
      clearQuote();
      const message = currentController.signal.aborted
        ? 'A consulta demorou mais do que o esperado. Tenta atualizar a simulação.'
        : error instanceof TypeError || error instanceof SyntaxError
          ? 'Não foi possível obter uma simulação confirmada. Verifica a ligação e tenta novamente.'
          : error.message || 'A simulação está temporariamente indisponível.';
      setState('error', message);
      const maxMonths = error.limits?.maxMonths;
      if (Number.isInteger(maxMonths) && input.months > maxMonths && maxMonths >= Number(monthsInput.min) && maxMonths <= Number(monthsInput.max)) {
        suggest(`Consultar o prazo de ${maxMonths} meses`, () => { monthsInput.value = maxMonths; onChange(); });
      }
    } finally {
      clearTimeout(timeout);
      if (version === requestVersion) {
        controller = null;
        updateButton.disabled = !validate().input;
      }
    }
  }

  function validProduct(product) {
    return product && ['minAmount', 'maxAmount', 'minMonths', 'maxMonths', 'monthStep', 'amountStep'].every(key => Number.isFinite(product[key]) && product[key] > 0)
      && product.minAmount <= product.maxAmount && product.minMonths <= product.maxMonths
      && product.maxMonths <= 360 && Number.isInteger(product.minMonths) && Number.isInteger(product.maxMonths) && Number.isInteger(product.monthStep);
  }

  async function loadConfig() {
    if (configLoading) return;
    configLoading = true;
    updateButton.disabled = true;
    setState('loading', 'A carregar as condições…');
    const configController = new AbortController();
    const configTimeout = setTimeout(() => configController.abort(), 30000);
    try {
      const response = await fetch('/api/config', { headers: { 'Accept': 'application/json' }, cache: 'no-store', signal: configController.signal });
      const data = await response.json();
      if (!response.ok || !validProduct(data.products?.used) || !validProduct(data.products?.new)) throw new Error('As condições de simulação estão temporariamente indisponíveis. Tenta novamente.');
      products = data.products;
      updateLimits();
      await requestQuote();
    } catch {
      clearQuote();
      products = null;
      setState('error', 'Não foi possível carregar as condições. Tenta atualizar a simulação.');
      text('amount-guidance', 'Os montantes disponíveis serão apresentados após confirmar as condições.');
      updateButton.disabled = false;
    } finally {
      clearTimeout(configTimeout);
      configLoading = false;
    }
  }

  priceInput.addEventListener('input', onChange);
  entryInput.addEventListener('input', onChange);
  monthsInput.addEventListener('input', onChange);
  form.querySelectorAll('input[name="vehicleType"]').forEach(input => input.addEventListener('change', () => { updateLimits(); onChange(); }));
  minusButton.addEventListener('click', () => { monthsInput.stepDown(); onChange(); });
  plusButton.addEventListener('click', () => { monthsInput.stepUp(); onChange(); });
  alternativeButton.addEventListener('click', () => alternativeAction?.());
  form.addEventListener('submit', event => { event.preventDefault(); products ? requestQuote() : loadConfig(); });
  window.addEventListener('pagehide', cancelPending);
  updateDerivedFields();
  loadConfig();
})();
