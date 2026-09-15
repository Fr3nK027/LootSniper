'use strict';
(() => {
  const guide = $('welcome-dialog'), settings = $('settings-dialog');
  const facetKeys = ['price', ...Object.keys(FACET_DEFINITIONS).filter(key => key !== 'usage')];
  let step = 0, facetIndex = 0;

  function selectedIntent() {
    return guide.querySelector('input[name="guide-intent"]:checked')?.value || 'gaming';
  }
  function setChoice(name, value) {
    const input = guide.querySelector('input[name="' + name + '"][value="' + value + '"]');
    if (input) input.checked = true;
  }
  function renderFacet() {
    const key = facetKeys[facetIndex], container = $('wizard-facet-options');
    $('wizard-facet-progress').textContent = (facetIndex + 1) + ' di ' + facetKeys.length;
    if (key === 'price') {
      $('wizard-facet-name').textContent = 'Prezzo';
      container.innerHTML = '<div class="wizard-price"><label>Minimo (€)<input id="wizard-min-price" type="number" min="0" max="100000" step="50" value="' + escapeHtml($('min-price').value) + '" placeholder="0"></label><label>Massimo (€)<input id="wizard-max-price" type="number" min="0" max="100000" step="50" value="' + escapeHtml($('max-price').value) + '" placeholder="Nessun limite"></label></div>';
      $('wizard-facet-help').textContent = 'Lascia vuoto un campo se non vuoi impostare quel limite.';
    } else {
      const definition = FACET_DEFINITIONS[key], chosen = guidedFilters[key] || [];
      $('wizard-facet-name').textContent = definition.label;
      container.innerHTML = Object.entries(definition.options)
        .filter(([value]) => !(selectedIntent() === 'gaming' && key === 'storageType' && value === 'hdd'))
        .map(([value, label]) => '<label><input type="checkbox" data-wizard-facet="' + key + '" value="' + value + '" ' + (chosen.includes(value) ? 'checked' : '') + '><span>' + escapeHtml(label) + '</span></label>').join('');
      $('wizard-facet-help').textContent = key === 'storageType' && selectedIntent() === 'gaming'
        ? 'Per il gaming HDD viene escluso; gli annunci senza storage dichiarato restano ammessi.'
        : 'Puoi selezionare più valori. Nessuna scelta significa “qualsiasi”.';
    }
    $('guide-next').textContent = facetIndex === facetKeys.length - 1 ? 'Continua' : 'Filtro successivo';
  }
  function showStep() {
    guide.querySelectorAll('[data-step]').forEach(panel => { panel.hidden = Number(panel.dataset.step) !== step; });
    $('guide-progress').textContent = 'Passaggio ' + (step + 1) + ' di 4';
    $('guide-title').textContent = ['Cosa vuoi cercare?', 'Come vuoi cercare?', 'Affina senza complicazioni', 'Browser, account e condizioni d’uso'][step];
    $('guide-back').hidden = step === 0;
    $('guide-skip').hidden = step !== 2;
    if (step === 2) renderFacet();
    else $('guide-next').textContent = step === 3 ? 'Accetta e prepara la ricerca' : 'Continua';
    $('wizard-dots').innerHTML = [0, 1, 2, 3].map(index => '<i class="' + (index <= step ? 'active' : '') + '"></i>').join('');
    $('guide-title').focus();
  }
  function openGuide() {
    step = 0; facetIndex = 0;
    $('guide-query').value = $('market-query').value;
    setChoice('guide-intent', primaryIntent);
    setChoice('wizard-mode', linkMode);
    for (const platform of Object.keys(MARKET_HOSTS)) $('wizard-link-' + platform.toLowerCase()).value = $('link-' + platform.toLowerCase()).value;
    guide.querySelectorAll('[data-wizard-marketplace]').forEach(input => { input.checked = automaticPlatforms.has(input.value); });
    $('wizard-auto-marketplaces').hidden = linkMode !== 'auto';
    $('wizard-manual-links').hidden = linkMode !== 'manual';
    $('guide-policy').checked = false;
    if (!guide.open) guide.showModal();
    showStep();
  }
  function saveCurrentFacet() {
    const key = facetKeys[facetIndex];
    if (key === 'price') {
      const minimum = $('wizard-min-price'), maximum = $('wizard-max-price');
      if (!minimum.reportValidity() || !maximum.reportValidity()) return false;
      if (minimum.value && maximum.value && Number(minimum.value) > Number(maximum.value)) {
        maximum.setCustomValidity('Il massimo deve essere maggiore del minimo.'); maximum.reportValidity(); return false;
      }
      maximum.setCustomValidity(''); $('min-price').value = minimum.value; $('max-price').value = maximum.value;
    }
    return true;
  }
  function advanceFacet(skip = false) {
    const key = facetKeys[facetIndex];
    if (!skip && !saveCurrentFacet()) return;
    if (skip) {
      if (key === 'price') { $('min-price').value = ''; $('max-price').value = ''; }
      else if (key === 'storageType' && selectedIntent() === 'gaming') guidedFilters.storageType = ['nvme', 'ssd', 'unknown'];
      else delete guidedFilters[key];
    }
    if (facetIndex < facetKeys.length - 1) { facetIndex++; renderFacet(); $('guide-title').focus(); }
    else { step = 3; showStep(); }
  }
  function finishGuide() {
    if (!$('guide-policy').checked) { $('guide-policy').reportValidity(); return; }
    primaryIntent = selectedIntent();
    $('market-query').value = $('guide-query').value.trim();
    if (linkMode === 'auto') {
      const query = automaticQuery();
      Object.keys(MARKET_HOSTS).forEach(platform => { $('link-' + platform.toLowerCase()).value = automaticPlatforms.has(platform) ? marketplaceSearchUrl(platform, query) : ''; });
    }
    updateSourceLinks(); persistFilters(); renderGuidedFilters(); renderAllCards();
    document.body.classList.add('flow-ready');
    guide.close(); $('btn-scan').focus();
    setScanState('Ricerca pronta', 'Premi Esegui ricerca. I filtri scelti restano modificabili nella colonna laterale.');
  }

  $('btn-help').addEventListener('click', openGuide);
  $('btn-new-search').addEventListener('click', openGuide);
  guide.addEventListener('cancel', event => event.preventDefault());
  $('wizard-mode-auto').addEventListener('change', () => {
    if (!$('wizard-mode-auto').checked) return;
    $('wizard-auto-marketplaces').hidden = false; $('wizard-manual-links').hidden = true;
  });
  $('wizard-mode-manual').addEventListener('change', () => {
    if (!$('wizard-mode-manual').checked) return;
    $('wizard-auto-marketplaces').hidden = true; $('wizard-manual-links').hidden = false;
  });
  $('wizard-facet-options').addEventListener('change', event => {
    const input = event.target.closest('[data-wizard-facet]'); if (!input) return;
    const selected = new Set(guidedFilters[input.dataset.wizardFacet] || []);
    if (input.checked) selected.add(input.value); else selected.delete(input.value);
    if (selected.size) guidedFilters[input.dataset.wizardFacet] = [...selected]; else delete guidedFilters[input.dataset.wizardFacet];
  });
  $('wizard-clear-facet').addEventListener('click', () => {
    const key = facetKeys[facetIndex];
    if (key === 'price') { $('min-price').value = ''; $('max-price').value = ''; }
    else delete guidedFilters[key];
    renderFacet();
  });
  $('guide-skip').addEventListener('click', () => advanceFacet(true));
  $('guide-back').addEventListener('click', () => {
    if (step === 2 && facetIndex > 0) { facetIndex--; renderFacet(); return; }
    step = Math.max(0, step - 1); showStep();
  });
  $('guide-next').addEventListener('click', () => {
    if (step === 0) {
      if (!$('guide-query').reportValidity()) return;
      primaryIntent = selectedIntent(); guidedFilters.usage = [primaryIntent];
      if (primaryIntent === 'gaming' && !guidedFilters.storageType) guidedFilters.storageType = ['nvme', 'ssd', 'unknown'];
      step = 1; showStep(); return;
    }
    if (step === 1) {
      const mode = $('wizard-mode-manual').checked ? 'manual' : 'auto';
      if (mode === 'auto') {
        const firstChoice = guide.querySelector('[data-wizard-marketplace]');
        automaticPlatforms = new Set([...guide.querySelectorAll('[data-wizard-marketplace]:checked')].map(input => input.value));
        firstChoice.setCustomValidity(automaticPlatforms.size ? '' : 'Seleziona almeno un marketplace.');
        if (!automaticPlatforms.size) { firstChoice.reportValidity(); return; }
      } else {
        const links = Object.keys(MARKET_HOSTS).map(platform => ({ platform, value: $('wizard-link-' + platform.toLowerCase()).value.trim() }));
        if (!links.some(item => item.value)) { $('wizard-link-ebay').setCustomValidity('Inserisci almeno un link.'); $('wizard-link-ebay').reportValidity(); return; }
        for (const item of links) {
          const input = $('wizard-link-' + item.platform.toLowerCase()); input.setCustomValidity('');
          if (item.value && !safeUrl(item.value, item.platform)) { input.setCustomValidity('Link HTTPS non valido per questo marketplace.'); input.reportValidity(); return; }
          $('link-' + item.platform.toLowerCase()).value = item.value;
        }
      }
      setLinkMode(mode); step = 2; facetIndex = 0; showStep(); return;
    }
    if (step === 2) { advanceFacet(false); return; }
    finishGuide();
  });
  $('btn-settings').addEventListener('click', () => settings.showModal());
  $('btn-close-settings').addEventListener('click', () => settings.close());
  $('btn-scan-help').addEventListener('click', () => {
    settings.showModal(); $('extension-guide').open = true; $('extension-guide').scrollIntoView({ block: 'nearest' });
  });
  $('results-grid').addEventListener('click', event => {
    const action = event.target.closest('[data-empty-action]')?.dataset.emptyAction;
    if (action === 'reset') $('btn-reset-filters').click();
    if (action === 'guide') openGuide();
  });
  Promise.resolve(initialSync).then(openGuide);
})();
