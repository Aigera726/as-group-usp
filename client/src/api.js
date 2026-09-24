import axios from 'axios';
import translations from './lang/index';

function getSessionExpiredMsg() {
  const lang = localStorage.getItem('uspLang') || 'ru';
  const t = translations[lang] || translations.ru;
  return t.sessionExpiredMsg;
}

const api = axios.create({
  baseURL: `http://${window.location.hostname}:9002/api`, // Наш бэкенд сметы динамически
});

// Модуль открывается в <iframe> с другого порта (другой origin) — у него свой localStorage,
// не связанный с localStorage главного ERP. Берём стартовый token из URL (его передаёт
// Dashboard при открытии модуля) один раз при загрузке.
(function seedTokenFromUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  const urlToken = urlParams.get('token');
  if (urlToken && urlToken !== 'null' && urlToken !== 'undefined' && urlToken.trim() !== '') {
    localStorage.setItem('token', urlToken);
  }
})();

// Перехватчик для добавления токена — берём из localStorage (актуальный после обновления),
// а не из URL: URL остаётся тем же на весь срок жизни iframe и после первого обновления
// содержал бы уже протухший токен, если бы мы продолжали читать оттуда.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');

  if (token && token !== 'null' && token !== 'undefined' && token.trim() !== '') {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Обновление access_token НЕ делаем здесь напрямую через refresh_token: у Supabase включена
// ротация refresh-токенов с отзывом при повторном использовании. Если это окно (внутри iframe)
// и родительское окно ERP независимо друг от друга дёргают один и тот же refresh_token —
// тот, кто обновит вторым, попадёт уже устаревшим токеном в окно повторного использования,
// и Supabase отзовёт всю сессию целиком (разлогинит и здесь, и в ERP). Поэтому refresh_token
// живёт только в родительском окне — здесь лишь просим у него свежий access_token.
let refreshPromise = null;

function requestTokenFromParent(timeoutMs = 5000) {
  return new Promise((resolve) => {
    if (window.parent === window) {
      resolve(null); // открыто не внутри iframe ERP — просить не у кого
      return;
    }
    const handler = (event) => {
      if (!event.data || event.data.type !== 'ERP_TOKEN_RESPONSE') return;
      window.removeEventListener('message', handler);
      clearTimeout(timer);
      resolve(event.data.token || null);
    };
    const timer = setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve(null);
    }, timeoutMs);
    window.addEventListener('message', handler);
    window.parent.postMessage({ type: 'ERP_REQUEST_TOKEN' }, '*');
  });
}

async function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = requestTokenFromParent()
      .then((token) => {
        if (token) localStorage.setItem('token', token);
        return token;
      })
      .finally(() => { refreshPromise = null; });
  }

  return refreshPromise;
}

// Перехватчик для обработки ошибок (например, 401)
let sessionExpiredAlertShown = false;

// Не удалось получить рабочий токен от родителя — либо у родителя самого сессия мертва
// (в этом случае родительское окно ERP само перезагрузится на экран входа и заодно снесёт
// этот iframe — см. Dashboard.jsx), либо просто не дождались ответа за 5 секунд (вкладка ERP
// подвисла/не успела). Раньше здесь просто показывали алерт и всё замирало — пока родитель
// не среагирует (а он может и не среагировать, если тайм-аут). Теперь после алерта
// перезагружаем и сам модуль — это самолечит случай тайм-аута (новая попытка запросить
// токен с нуля) и ничего не портит, если родитель и так уже уводит на логин.
function forceLogoutToLogin() {
  localStorage.removeItem('token');
  if (!sessionExpiredAlertShown) {
    sessionExpiredAlertShown = true;
    alert(getSessionExpiredMsg());
  }
  window.location.reload();
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response && error.response.status === 401 && originalRequest && !originalRequest._retriedAfterRefresh) {
      originalRequest._retriedAfterRefresh = true;
      const newToken = await refreshAccessToken();
      if (newToken) {
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      }
      forceLogoutToLogin();
    }
    return Promise.reject(error);
  }
);

export default api;
