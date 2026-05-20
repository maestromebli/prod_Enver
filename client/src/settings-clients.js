import { api } from "./api.js";
import { escapeHtml } from "./utils.js";

let clientsInfo = null;

export async function loadClientsInfo() {
  clientsInfo = await api.getClientsInfo();
}

export function clientsSectionHtml() {
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "";
  const operatorUrl = clientsInfo?.operatorUrl || `${origin}/operator.html`;
  const ipadUrl =
    clientsInfo?.ipadDownloadUrl || `${origin}/downloads/enver-operator-ipad.mobileconfig`;
  const ipadReady = clientsInfo?.ipadDownloadAvailable !== false;
  const windowsUrl =
    clientsInfo?.windowsDownloadUrl || `${origin}/downloads/enver-operator-windows.zip`;
  const windowsReady = Boolean(clientsInfo?.windowsDownloadAvailable);

  return `
    <div class="settings-section">
      <h2>Клієнти для цеху</h2>
      <p class="settings-hint">
        Окремі клієнти для операторів станків: установка на планшет Apple та повноекранний клієнт Windows біля станка.
      </p>

      <article class="clients-card">
        <h3>iPad / iPhone (Apple)</h3>
        <p class="settings-hint">
          Профіль установки (.mobileconfig) додає іконку «ENVER Оператор» на головний екран.
          Повноекранний режим як на Windows: після входу — на весь екран; вихід лише кнопкою
          «Вийти з повноекранного» і паролем <code>1111</code>.
        </p>
        ${
          ipadReady
            ? `<a class="btn btn-primary" href="${escapeHtml(ipadUrl)}" download="enver-operator-ipad.mobileconfig">
                Завантажити програму установки для iPad
              </a>`
            : `<p class="form-error">Профіль установки тимчасово недоступний.</p>`
        }
        <ol class="clients-steps">
          <li>Переконайтесь, що планшет у тій самій мережі, що сервер ENVER.</li>
          <li>На iPad завантажте профіль (кнопка вище в Safari) або передайте файл з ПК (AirDrop, пошта).</li>
          <li>Відкрийте файл → «Налаштування» → «Профіль завантажено» → «Встановити» → підтвердіть.</li>
          <li>На головному екрані з’явиться «ENVER Оператор» — запускайте лише з іконки, не з Safari.</li>
          <li>Увійдіть (наприклад <code>porizka</code> / <code>1234</code>).</li>
          <li>Після входу панель займе весь екран; для виходу — «Вийти з повноекранного» + пароль <code>1111</code>.</li>
        </ol>
      </article>

      <article class="clients-card">
        <h3>Windows (станок / ПК)</h3>
        <p class="settings-hint">
          Повноекранний режим, автозапуск при ввімкненні Windows. Вихід з повноекранного режиму — кнопка
          «Вийти з повноекранного» та пароль <code>1111</code>.
        </p>
        ${
          windowsReady
            ? `<a class="btn btn-primary" href="${escapeHtml(windowsUrl)}" download="enver-operator-windows.zip">
                Завантажити клієнт для Windows
              </a>`
            : `<p class="form-error">Архів ще не зібрано. На сервері виконайте: <code>npm run build:windows-client</code></p>
               <a class="btn" href="${escapeHtml(windowsUrl)}">Спробувати завантажити</a>`
        }
        <ol class="clients-steps">
          <li>Розпакуйте ZIP і запустіть <code>ENVER Operator.exe</code>.</li>
          <li>У файлі <code>config.json</code> поруч із exe вкажіть URL сервера (наприклад <code>http://192.168.1.10:3001</code>).</li>
          <li>Клієнт додасть себе в автозапуск Windows.</li>
          <li>Для виходу з повноекранного — кнопка в шапці та пароль <code>1111</code>.</li>
        </ol>
      </article>
    </div>
  `;
}

let clientsActionsBound = false;

export function bindClientsActions() {
  if (clientsActionsBound) return;
  clientsActionsBound = true;

  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-copy-client-url]");
    if (!btn) return;
    const id = btn.dataset.copyClientUrl;
    const input = document.getElementById(id);
    if (!input) return;
    try {
      await navigator.clipboard.writeText(input.value);
      btn.textContent = "Скопійовано";
      setTimeout(() => {
        btn.textContent = "Копіювати";
      }, 2000);
    } catch {
      input.select();
      document.execCommand("copy");
    }
  });
}
