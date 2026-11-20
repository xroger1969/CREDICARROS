// Financial source and lead flow retained from the verified public-source integration.
const API_BASE = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
      ? '' : 'https://credicarros.vercel.app';
    const ANO_ATUAL = new Date().getFullYear();
    const QUOTE_MAX_AGE_MS = 5 * 60 * 1000;
    const MAKE_WEBHOOK_URL = 'https://hook.eu2.make.com/h9v6hcszc1qu2cfq5uskxqnn4ebfqyhf';
    const WHATSAPP_PHONE = '351918404101';

    const montanteLabel = document.getElementById('montanteLabel');
    const prestacaoLabel = document.getElementById('prestacaoLabel');
    const prestacaoResumo = document.getElementById('prestacaoResumo');
    const tanResumo = document.getElementById('tanResumo');
    const taegResumo = document.getElementById('taegResumo');
    const mticResumo = document.getElementById('mticResumo');
    const prazo = document.getElementById('prazo');
    const prazoLabel = document.getElementById('prazoLabel');
    const prazoSub = document.getElementById('prazoSub');
    const pvp = document.getElementById('pvp');
    const entrada = document.getElementById('entrada');
    const anoViatura = document.getElementById('anoViatura');
    const tipoViatura = document.getElementById('tipoViatura');
    const leadBtn = document.getElementById('leadBtn');
    const clienteNome = document.getElementById('clienteNome');
    const clienteTelefone = document.getElementById('clienteTelefone');
    const consentimentoWhatsApp = document.getElementById('consentimentoWhatsApp');
    const refreshBtn = document.getElementById('refreshBtn');
    const quoteStatus = document.getElementById('quoteStatus');
    const feedback = document.getElementById('inputFeedback');
    const suggestionBtn = document.getElementById('suggestionBtn');
    const summaryCard = document.getElementById('summaryCard');
    const formatEUR = value => value.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' });
    const dateFormatter = new Intl.DateTimeFormat('pt-PT', {
      dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Lisbon'
    });

    let products = null;
    let currentQuote = null;
    let pendingController = null;
    let debounceTimer;
    let expiryTimer;
    let requestVersion = 0;
    let loadingConfig = false;
    let quotePending = false;
    let leadSending = false;
    let suggestionAction = null;

    function normalizePhone(value) {
      const digits = String(value || '').replace(/\D/g, '');
      if (digits.length === 9) return '351' + digits;
      if (digits.startsWith('00351')) return digits.slice(2);
      if (digits.startsWith('351')) return digits;
      return digits;
    }

    function getMontante() {
      if (pvp.value.trim() === '') return NaN;
      return Math.round((Number(pvp.value) - Number(entrada.value || 0)) * 100) / 100;
    }

    function getAnoViatura() {
      if (anoViatura.value.trim() === '') return null;
      const ano = Number(anoViatura.value);
      return Number.isInteger(ano) && ano >= 1900 && ano <= ANO_ATUAL ? ano : null;
    }

    function getLimits() {
      return products && products[tipoViatura.value];
    }

    function validMoney(value) {
      return Number.isFinite(value) && Math.abs(value * 100 - Math.round(value * 100)) < 0.00001;
    }

    function validateInputs() {
      const limits = getLimits();
      if (!limits) return { error: 'A aguardar as condições de simulação.' };
      if (pvp.value.trim() === '') return { error: 'Indique o preço da viatura para começar.' };
      const price = Number(pvp.value);
      const initial = Number(entrada.value || 0);
      if (!validMoney(price) || price <= 0 || price > 10000000) return { error: 'Indique um PVP válido, com um máximo de duas casas decimais.' };
      if (!validMoney(initial) || initial < 0) return { error: 'A entrada deve ser igual ou superior a zero, com um máximo de duas casas decimais.' };
      if (initial > price) return { error: 'A entrada não pode ser superior ao preço da viatura.' };
      const amount = getMontante();
      if (amount < limits.minAmount || amount > limits.maxAmount) {
        return { error: 'O montante a financiar deve estar entre ' + formatEUR(limits.minAmount) + ' e ' + formatEUR(limits.maxAmount) + '.' };
      }
      if (Math.round(amount * 100) % Math.round(limits.amountStep * 100) !== 0) {
        const targetAmount = Math.floor(Math.round(amount * 100) / Math.round(limits.amountStep * 100)) * limits.amountStep;
        const suggestedEntry = Math.round((price - targetAmount) * 100) / 100;
        return {
          error: 'O montante a financiar deve ser múltiplo de ' + formatEUR(limits.amountStep) + '. Os valores introduzidos não foram arredondados.',
          suggestion: targetAmount >= limits.minAmount ? {
            label: 'Usar entrada de ' + formatEUR(suggestedEntry) + ' · financiar ' + formatEUR(targetAmount),
            action: () => { entrada.value = suggestedEntry.toFixed(2); updateMontante(); }
          } : null
        };
      }
      const months = Number(prazo.value);
      if (!Number.isInteger(months) || months < limits.minMonths || months > limits.maxMonths || (months - limits.minMonths) % limits.monthStep !== 0) {
        return { error: 'Escolha um prazo entre ' + limits.minMonths + ' e ' + limits.maxMonths + ' meses, em intervalos de ' + limits.monthStep + ' meses.' };
      }
      return { input: { amount, months, vehicleType: tipoViatura.value } };
    }

    function setSuggestion(suggestion) {
      suggestionAction = suggestion ? suggestion.action : null;
      suggestionBtn.hidden = !suggestion;
      suggestionBtn.textContent = suggestion ? suggestion.label : '';
    }

    function showInputValidation(validation) {
      feedback.textContent = validation.error || '';
      setSuggestion(validation.suggestion);
    }

    function isQuoteCurrent() {
      const input = validateInputs().input;
      if (!currentQuote || !input || quotePending) return false;
      const age = Date.now() - Date.parse(currentQuote.retrievedAt);
      return currentQuote.amount === input.amount && currentQuote.months === input.months
        && currentQuote.vehicleType === input.vehicleType && age >= -60000 && age < QUOTE_MAX_AGE_MS;
    }

    function syncLeadButton() {
      leadBtn.disabled = leadSending || !isQuoteCurrent();
    }

    function clearQuote() {
      clearTimeout(expiryTimer);
      currentQuote = null;
      [prestacaoLabel, prestacaoResumo, tanResumo, taegResumo, mticResumo].forEach(node => { node.textContent = '—'; });
      syncLeadButton();
    }

    function setStatus(state, message) {
      quoteStatus.textContent = message;
      quoteStatus.dataset.state = state;
      summaryCard.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
    }

    function cancelPending() {
      clearTimeout(debounceTimer);
      pendingController?.abort();
      pendingController = null;
      quotePending = false;
      requestVersion += 1;
    }

    function renderInputs() {
      const amount = getMontante();
      montanteLabel.textContent = Number.isFinite(amount) && amount >= 0 ? amount.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 }) : '—';
      const months = Number(prazo.value);
      const years = Math.floor(months / 12);
      const remainingMonths = months % 12;
      const yearsText = [years ? years + ' ' + (years === 1 ? 'ano' : 'anos') : '', remainingMonths ? remainingMonths + ' meses' : ''].filter(Boolean).join(' e ');
      prazoLabel.replaceChildren(document.createTextNode(months + ' MESES'));
      const small = document.createElement('small');
      small.textContent = yearsText;
      prazoLabel.appendChild(small);
      const limits = getLimits();
      prazo.disabled = !limits;
      document.getElementById('prazoMinus').disabled = !limits || months <= limits.minMonths;
      document.getElementById('prazoPlus').disabled = !limits || months >= limits.maxMonths;
      document.getElementById('montanteMinus').disabled = !limits || !Number.isFinite(amount) || amount <= limits.minAmount;
      document.getElementById('montantePlus').disabled = !limits || (Number.isFinite(amount) && amount >= limits.maxAmount);
      prazo.setAttribute('aria-valuetext', months + ' meses');
    }

    function applyLimits() {
      const limits = getLimits();
      if (!limits) return;
      prazo.min = limits.minMonths;
      prazo.max = limits.maxMonths;
      prazo.step = limits.monthStep;
      prazoSub.textContent = 'De ' + limits.minMonths + ' a ' + limits.maxMonths + ' meses · intervalos de ' + limits.monthStep + ' meses';
      document.getElementById('montanteRules').textContent = 'De ' + formatEUR(limits.minAmount) + ' até ' + formatEUR(limits.maxAmount) + ' · intervalos de ' + formatEUR(limits.amountStep);
      renderInputs();
    }

    function inputsChanged() {
      cancelPending();
      clearQuote();
      renderInputs();
      if (!products) return;
      const validation = validateInputs();
      showInputValidation(validation);
      refreshBtn.disabled = !validation.input;
      if (!validation.input) {
        setStatus('idle', 'Preencha os dados para obter a simulação.');
        return;
      }
      setStatus('idle', 'Dados alterados. A preparar a consulta…');
      debounceTimer = setTimeout(requestSimulation, 650);
    }

    function updateMontante() { inputsChanged(); }
    function updateAnoViatura() { syncLeadButton(); }
    function updatePrazo() { inputsChanged(); }

    function quoteMatches(quote, input) {
      return quote && quote.amount === input.amount && quote.months === input.months && quote.vehicleType === input.vehicleType
        && [quote.payment, quote.tan, quote.taeg, quote.mtic].every(Number.isFinite)
        && quote.payment > 0 && quote.tan >= 0 && quote.taeg >= 0 && quote.mtic >= input.amount
        && ['payment', 'tan', 'taeg', 'mtic'].every(key => typeof quote.display?.[key] === 'string' && quote.display[key].length > 0 && quote.display[key].length < 70)
        && Number.isFinite(Date.parse(quote.retrievedAt)) && typeof quote.source?.name === 'string';
    }

    function showQuote(quote) {
      currentQuote = quote;
      prestacaoLabel.textContent = quote.display.payment;
      prestacaoResumo.textContent = quote.display.payment;
      tanResumo.textContent = quote.display.tan;
      taegResumo.textContent = quote.display.taeg;
      mticResumo.textContent = quote.display.mtic;
      setStatus('success', 'Simulação atualizada em ' + dateFormatter.format(new Date(quote.retrievedAt)) + '.');
      const lifetime = QUOTE_MAX_AGE_MS - (Date.now() - Date.parse(quote.retrievedAt));
      expiryTimer = setTimeout(() => {
        clearQuote();
        setStatus('idle', 'Esta consulta expirou. Atualize os valores para continuar.');
        refreshBtn.disabled = !validateInputs().input;
      }, Math.max(0, lifetime));
    }

    async function requestSimulation() {
      cancelPending();
      clearQuote();
      const validation = validateInputs();
      showInputValidation(validation);
      if (!validation.input) {
        setStatus('idle', 'Preencha os dados para obter a simulação.');
        refreshBtn.disabled = true;
        return;
      }
      const input = validation.input;
      const version = requestVersion;
      const controller = new AbortController();
      pendingController = controller;
      quotePending = true;
      refreshBtn.disabled = true;
      syncLeadButton();
      setStatus('loading', 'A consultar os valores para esta simulação…');
      const timeout = setTimeout(() => controller.abort('timeout'), 30000);
      try {
        const response = await fetch(API_BASE + '/api/credit-simulation', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(input), cache: 'no-store', signal: controller.signal
        });
        const body = await response.json();
        if (version !== requestVersion) return;
        if (!response.ok) {
          const error = new Error(typeof body.error?.message === 'string' ? body.error.message : 'A consulta está temporariamente indisponível. Tente atualizar os valores.');
          error.limits = body.error?.limits;
          throw error;
        }
        if (!quoteMatches(body.quote, input)) throw new Error('Não foi possível confirmar um resultado para os dados selecionados. Atualize os valores para tentar novamente.');
        showQuote(body.quote);
      } catch (error) {
        if (version !== requestVersion) return;
        clearQuote();
        const message = controller.signal.aborted
          ? 'A consulta demorou mais do que o esperado. Tente atualizar os valores.'
          : error instanceof TypeError || error instanceof SyntaxError
            ? 'Não foi possível consultar os valores. Verifique a ligação e tente novamente.'
            : error.message || 'A simulação está temporariamente indisponível.';
        setStatus('error', message);
        if (Number.isInteger(error.limits?.maxMonths) && input.months > error.limits.maxMonths && error.limits.maxMonths >= Number(prazo.min)) {
          const max = error.limits.maxMonths;
          setSuggestion({ label: 'Consultar o prazo de ' + max + ' meses', action: () => { prazo.value = max; updatePrazo(); } });
        }
      } finally {
        clearTimeout(timeout);
        if (version === requestVersion) {
          quotePending = false;
          pendingController = null;
          refreshBtn.disabled = !validateInputs().input;
          syncLeadButton();
        }
      }
    }

    function validProduct(product) {
      return product && ['minAmount', 'maxAmount', 'amountStep', 'minMonths', 'maxMonths', 'monthStep'].every(key => Number.isFinite(product[key]) && product[key] > 0)
        && product.minAmount <= product.maxAmount && product.minMonths <= product.maxMonths && product.maxMonths <= 360
        && Number.isInteger(product.minMonths) && Number.isInteger(product.maxMonths) && Number.isInteger(product.monthStep);
    }

    async function loadConfiguration() {
      if (loadingConfig) return;
      loadingConfig = true;
      refreshBtn.disabled = true;
      setStatus('loading', 'A carregar as condições de simulação…');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      try {
        const response = await fetch(API_BASE + '/api/credit-config', { headers: { 'Accept': 'application/json' }, cache: 'no-store', signal: controller.signal });
        const body = await response.json();
        if (!response.ok || !validProduct(body.products?.used) || !validProduct(body.products?.new)) throw new Error('Invalid configuration');
        products = body.products;
        applyLimits();
        inputsChanged();
      } catch {
        products = null;
        clearQuote();
        setStatus('error', 'As condições de simulação estão temporariamente indisponíveis. Tente atualizar os valores.');
        refreshBtn.disabled = false;
      } finally {
        clearTimeout(timeout);
        loadingConfig = false;
      }
    }

    function calcSimulacao() {
      const valid = isQuoteCurrent();
      const quote = valid ? currentQuote : null;
      return {
        valida: valid,
        motivoInvalido: valid ? '' : (validateInputs().error || 'Atualize os valores e aguarde a confirmação da simulação antes de pedir contacto.'),
        montante: getMontante(), ano: getAnoViatura(), meses: Number(prazo.value),
        prazoMaximo: quote?.limits?.maxMonths || getLimits()?.maxMonths || null,
        prestacao: quote?.payment || 0, tan: quote?.tan ?? null, taeg: quote?.taeg ?? null, mtic: quote?.mtic || 0,
        quote
      };
    }

    function displayPercent(value) {
      const parsed = Number(String(value).replace(/\s/g, '').replace('%', '').replace(',', '.'));
      return Number.isFinite(parsed) ? parsed : null;
    }

    function getLeadPayload() {
      const simulacao = calcSimulacao();
      const quote = simulacao.quote;
      const params = new URLSearchParams(window.location.search);
      const telefoneOriginal = clienteTelefone ? clienteTelefone.value.trim() : '';
      const telefoneNormalizado = normalizePhone(telefoneOriginal);
      return {
        origem: 'CREDICARROS', pagina: window.location.href,
        utm_source: params.get('utm_source') || '', utm_medium: params.get('utm_medium') || '', utm_content: params.get('utm_content') || '',
        fbclid: params.get('fbclid') || '', brid: params.get('brid') || '',
        cliente_nome: clienteNome ? clienteNome.value.trim() : '', cliente_telemovel: telefoneOriginal,
        cliente_telemovel_normalizado: telefoneNormalizado,
        consentimento_whatsapp: Boolean(consentimentoWhatsApp && consentimentoWhatsApp.checked),
        canal_preferido: 'WhatsApp', whatsapp_api_pronto: true,
        simulacao_valida: simulacao.valida, motivo_invalido: simulacao.motivoInvalido,
        pvp: Number(pvp.value || 0), entrada: Number(entrada.value || 0), montante: simulacao.montante,
        ano_viatura: simulacao.ano, prazo_meses: simulacao.meses, prazo_maximo_meses: simulacao.prazoMaximo,
        prestacao_estimada: simulacao.prestacao,
        tan_percentagem: quote ? displayPercent(quote.display.tan) : null,
        taeg_percentagem: quote ? displayPercent(quote.display.taeg) : null,
        tan_valor_fonte: quote?.tan ?? null, taeg_valor_fonte: quote?.taeg ?? null,
        mtic: simulacao.mtic,
        taxas_atualizadas_em: null,
        condicoes_consultadas_em: quote?.retrievedAt || null,
        fonte_simulacao: quote ? { ...quote.source } : null,
        tipo_viatura: quote?.vehicleType || tipoViatura.value,
        criado_em: new Date().toISOString()
      };
    }

    function validateLead(payload) {
      if (!payload.simulacao_valida) {
        alert(payload.motivo_invalido || 'Revise os dados da simulação antes de avançar.');
        return false;
      }

      if (!payload.cliente_nome) {
        alert('Por favor, indique o seu nome para podermos fazer o contacto.');
        if (clienteNome) clienteNome.focus();
        return false;
      }

      if (!payload.cliente_telemovel_normalizado || payload.cliente_telemovel_normalizado.length < 9) {
        alert('Por favor, indique um número de telemóvel válido.');
        if (clienteTelefone) clienteTelefone.focus();
        return false;
      }

      if (!payload.consentimento_whatsapp) {
        alert('Para avançar, confirme que autoriza o contacto por WhatsApp ou telefone.');
        if (consentimentoWhatsApp) consentimentoWhatsApp.focus();
        return false;
      }

      return true;
    }
    function openWhatsApp(payload) {
      const mensagem = [
        'Olá Carlos, gostava de receber mais informações sobre esta simulação de crédito automóvel.',
        '',
        'Nome: ' + payload.cliente_nome,
        'Telemóvel: ' + payload.cliente_telemovel,
        '',
        'PVP: ' + formatEUR(payload.pvp),
        'Entrada inicial: ' + formatEUR(payload.entrada),
        'Montante a financiar: ' + formatEUR(payload.montante),
        'Ano da viatura: ' + (payload.ano_viatura || 'Não indicado'),
        'Prazo: ' + payload.prazo_meses + ' meses',
        'Prestação estimada: ' + formatEUR(payload.prestacao_estimada),
        'TAN: ' + payload.tan_percentagem.toFixed(2).replace('.', ',') + '%',
        'TAEG: ' + (payload.taeg_percentagem !== null
          ? payload.taeg_percentagem.toFixed(2).replace('.', ',') + '%'
          : '—'),
        '',
        'Obrigado.'
      ].join('\n');

      window.open('https://wa.me/' + WHATSAPP_PHONE + '?text=' + encodeURIComponent(mensagem), '_blank');
    }
    async function sendLeadToMake(payload) {
      if (!MAKE_WEBHOOK_URL) return false;

      try {
        await fetch(MAKE_WEBHOOK_URL, {
          method: 'POST',
          mode: 'no-cors',
          keepalive: true,
          headers: {
            'Content-Type': 'text/plain;charset=utf-8'
          },
          body: JSON.stringify(payload)
        });
        return true;
      } catch (error) {
        console.warn('Não foi possível enviar a simulação para o Make.', error);
        return false;
      }
    }

    async function handleLeadRequest() {
      if (leadSending) return;
      const payload = getLeadPayload();
      if (!validateLead(payload)) return;
      const textoOriginal = leadBtn.textContent;
      leadSending = true;
      syncLeadButton();
      leadBtn.textContent = 'A enviar pedido...';
      try {
        await sendLeadToMake(payload);
        openWhatsApp(payload);
      } finally {
        leadSending = false;
        leadBtn.textContent = textoOriginal;
        syncLeadButton();
      }
    }

    function stepMontante(direction) {
      const limits = getLimits();
      if (!limits) return;
      const previous = getMontante();
      const next = Number.isFinite(previous) ? previous + direction * limits.amountStep : limits.minAmount;
      if (next < limits.minAmount || next > limits.maxAmount) return;
      pvp.value = (next + Number(entrada.value || 0)).toFixed(2);
      updateMontante();
    }

    function stepPrazo(direction) {
      if (prazo.disabled) return;
      direction < 0 ? prazo.stepDown() : prazo.stepUp();
      updatePrazo();
    }

    anoViatura.min = 1900;
    anoViatura.max = ANO_ATUAL;
    pvp.addEventListener('input', updateMontante);
    entrada.addEventListener('input', updateMontante);
    anoViatura.addEventListener('input', updateAnoViatura);
    tipoViatura.addEventListener('change', () => { applyLimits(); inputsChanged(); });
    prazo.addEventListener('input', updatePrazo);
    leadBtn.addEventListener('click', handleLeadRequest);
    refreshBtn.addEventListener('click', () => { products ? requestSimulation() : loadConfiguration(); });
    suggestionBtn.addEventListener('click', () => suggestionAction?.());
    document.getElementById('montanteMinus').addEventListener('click', () => stepMontante(-1));
    document.getElementById('montantePlus').addEventListener('click', () => stepMontante(1));
    document.getElementById('prazoMinus').addEventListener('click', () => stepPrazo(-1));
    document.getElementById('prazoPlus').addEventListener('click', () => stepPrazo(1));
    window.addEventListener('pagehide', cancelPending);
    renderInputs();
    syncLeadButton();
    loadConfiguration();
