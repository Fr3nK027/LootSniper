'use strict';
(() => {
  const guide = $('welcome-dialog'), settings = $('settings-dialog');
  let step = 0;
  const showStep = () => {
    guide.querySelectorAll('[data-step]').forEach(panel => { panel.hidden = Number(panel.dataset.step) !== step; });
    $('guide-progress').textContent = `Passaggio ${step + 1} di 3`;
    $('guide-back').hidden = step === 0;
    $('guide-next').textContent = step === 2 ? 'Prepara la mia ricerca' : 'Continua';
    $('guide-title').textContent = ['Benvenuto in LootSniper', 'Trova quello che cerchi', 'Sei pronto a cercare'][step];
    $('guide-title').focus();
  };
  const openGuide = () => {
    step = 0;
    $('guide-query').value = $('market-query').value;
    $('guide-budget').value = $('max-price').value;
    guide.showModal(); showStep();
  };
  $('btn-help').addEventListener('click', openGuide);
  $('guide-close').addEventListener('click', () => guide.close());
  guide.addEventListener('close', () => persist('lootsniper-welcome', true));
  $('guide-back').addEventListener('click', () => { step = Math.max(0, step - 1); showStep(); });
  $('guide-next').addEventListener('click', () => {
    if (step === 1 && (!$('guide-query').reportValidity() || !$('guide-budget').reportValidity())) return;
    if (step < 2) { step++; showStep(); return; }
    $('market-query').value = $('guide-query').value.trim();
    $('btn-generate-links').click();
    $('max-price').value = $('guide-budget').value;
    persistFilters(); renderAllCards(); guide.close(); $('btn-scan').focus();
    setScanState('Ricerca pronta', 'Premi Esegui ricerca. Con Salva crei anche un file modificabile da riutilizzare in futuro.');
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
  Promise.resolve(initialSync).then(() => {
    if (!readStorage('lootsniper-welcome', false) && !bombsArray.length && !savedSearches.length) openGuide();
  });
})();
