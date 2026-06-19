let deferredPrompt = null;

const installBtn = document.getElementById("installBtn");
const installHint = document.getElementById("installHint");

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredPrompt = event;
  installBtn.hidden = false;
  if (installHint) {
    installHint.textContent =
      "Натисніть «Встановити застосунок» або додайте ярлик через меню Chrome.";
  }
});

installBtn?.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.hidden = true;
});

window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  installBtn.hidden = true;
  if (installHint) {
    installHint.textContent =
      "Застосунок встановлено. Відкрийте «ENVER Оператор» з головного екрана.";
  }
});
