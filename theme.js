'use strict';
(() => {
  const key = 'lootsniper-theme';
  const root = document.documentElement;
  const system = matchMedia('(prefers-color-scheme: dark)');
  let saved = '';
  try { saved = localStorage.getItem(key) || ''; } catch {}
  let theme = ['light', 'dark'].includes(saved) ? saved : (system.matches ? 'dark' : 'light');

  function apply(next, persistChoice = false) {
    theme = next;
    root.dataset.theme = next;
    root.style.colorScheme = next;
    const button = document.getElementById('btn-theme');
    if (button) {
      const dark = next === 'dark';
      button.setAttribute('aria-pressed', String(dark));
      button.setAttribute('aria-label', dark ? 'Passa alla modalità giorno' : 'Passa alla modalità notte');
      button.title = dark ? 'Passa alla modalità giorno' : 'Passa alla modalità notte';
      document.getElementById('theme-icon').textContent = dark ? '☾' : '☀';
      document.getElementById('theme-label').textContent = dark ? 'Notte' : 'Giorno';
    }
    if (persistChoice) {
      saved = next;
      try { localStorage.setItem(key, next); } catch {}
    }
  }

  apply(theme);
  const bind = () => {
    apply(theme);
    document.getElementById('btn-theme').addEventListener('click', () => apply(theme === 'dark' ? 'light' : 'dark', true));
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
  system.addEventListener?.('change', event => { if (!saved) apply(event.matches ? 'dark' : 'light'); });
})();
