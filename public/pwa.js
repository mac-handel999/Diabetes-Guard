let deferredInstallPrompt = null;

// Detect whether Chrome or another browser is already running the installed app.
function isStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function showInstallButton() {
  if (isStandaloneMode()) {
    document.getElementById('installAppButton')?.remove();
    return;
  }

  let button = document.getElementById('installAppButton');
  if (!button) {
    button = document.createElement('button');
    button.id = 'installAppButton';
    button.className = 'install-app-button';
    button.type = 'button';
    button.setAttribute('aria-label', 'Install Dia Shield app');
    button.innerHTML = '<i class="fas fa-download" aria-hidden="true"></i> Install app';
    button.addEventListener('click', async () => {
      if (!deferredInstallPrompt) {
        alert('To install Dia Shield, open the Chrome menu and choose “Install Dia Shield” or “Add to home screen”.');
        return;
      }
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    if (choice.outcome !== 'accepted') button.classList.remove('is-visible');
    deferredInstallPrompt = null;
    });
    const host = document.querySelector('#cohortWorkspace .dashboard-header .header-top-row') ||
      document.querySelector('#cohortWorkspace .dashboard-header');
    (host || document.body).prepend(button);
  }
  button.classList.add('is-visible');
}

// Capture Chrome's native install event so the app can provide its own install button.
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  showInstallButton();
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  document.getElementById('installAppButton')?.remove();
});

function updateOfflineBanner() {
  let banner = document.getElementById('offlineBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'offlineBanner';
    banner.className = 'offline-banner';
    banner.setAttribute('role', 'status');
    document.body.appendChild(banner);
  }
  banner.textContent = navigator.onLine
    ? 'Back online. Pending activity will sync automatically.'
    : 'You are offline. Cached lessons remain available; activity will sync when connection returns.';
  banner.classList.toggle('is-visible', !navigator.onLine);
}

// Keep the user informed about connectivity and register the offline app shell.
window.addEventListener('online', updateOfflineBanner);
window.addEventListener('offline', updateOfflineBanner);
window.addEventListener('DOMContentLoaded', updateOfflineBanner);
window.addEventListener('DOMContentLoaded', showInstallButton);

// Register Service Worker for PWA Capability
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js')
      .then((reg) => console.log('Service Worker Registered Successfully! Scope:', reg.scope))
      .catch((err) => console.error('Service Worker Registration Failed:', err));
  });
}
