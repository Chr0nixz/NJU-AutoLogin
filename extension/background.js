/**
 * Background service worker: manages offscreen document and routes messages
 */

let creating; // A global promise to avoid concurrency issues

// Cooldown for auto-login (page load triggered only)
const AUTO_COOLDOWN_WINDOW = 10000; // 10s
const AUTO_COOLDOWN_DURATION = 30000; // 30s
const AUTO_COOLDOWN_MAX_ATTEMPTS = 2;
let autoAttemptTimestamps = [];
let autoCooldownUntil = 0;

function checkAutoCooldown() {
  const now = Date.now();
  autoAttemptTimestamps = autoAttemptTimestamps.filter(t => now - t < AUTO_COOLDOWN_WINDOW);
  if (now < autoCooldownUntil) {
    return Math.ceil((autoCooldownUntil - now) / 1000);
  }
  autoCooldownUntil = 0;
  return 0;
}

function recordAutoAttempt() {
  const now = Date.now();
  autoAttemptTimestamps.push(now);
  autoAttemptTimestamps = autoAttemptTimestamps.filter(t => now - t < AUTO_COOLDOWN_WINDOW);
  if (autoAttemptTimestamps.length >= AUTO_COOLDOWN_MAX_ATTEMPTS) {
    autoCooldownUntil = now + AUTO_COOLDOWN_DURATION;
    autoAttemptTimestamps = [];
    return true;
  }
  return false;
}

async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL('offscreen.html')]
  });

  if (existingContexts.length > 0) {
    return;
  }

  if (creating) {
    await creating;
  } else {
    creating = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Need to run ONNX Runtime WASM for captcha OCR'
    });
    await creating;
    creating = null;
  }
}

async function recognizeCaptcha(imageDataURL) {
  await ensureOffscreenDocument();

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'recognize', imageDataURL },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response.error) {
          reject(new Error(response.error));
          return;
        }
        resolve(response.text);
      }
    );
  });
}

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'solveCaptcha') {
    // Forward to content script to get captcha image
    const tabId = msg.tabId || (sender.tab && sender.tab.id);
    if (!tabId) {
      sendResponse({ error: 'No active tab' });
      return;
    }

    chrome.tabs.sendMessage(tabId, { action: 'getCaptchaImage' }, (resp) => {
      if (chrome.runtime.lastError || !resp) {
        sendResponse({ error: '无法获取验证码图片，请确认在南大认证页面' });
        return;
      }
      if (resp.error) {
        sendResponse({ error: resp.error });
        return;
      }

      recognizeCaptcha(resp.imageDataURL)
        .then(text => {
          // Send result back to content script to fill input
          chrome.tabs.sendMessage(tabId, { action: 'fillCaptcha', text });
          sendResponse({ text, imageUrl: resp.imageDataURL });
        })
        .catch(err => sendResponse({ error: err.message }));
    });

    return true; // async
  } else if (msg.type === 'autoLogin') {
    // Full auto-login flow: fill credentials → recognize captcha → fill captcha → click login
    const isAutoPageLoad = !msg.tabId; // triggered from content script (page load)
    const tabId = msg.tabId || (sender.tab && sender.tab.id);

    // If triggered from content script (auto-login on page load), use sender tab
    const targetTab = tabId || (sender.tab && sender.tab.id);
    if (!targetTab) {
      sendResponse({ error: 'No active tab' });
      return;
    }

    // Cooldown only for auto page-load login
    if (isAutoPageLoad) {
      const cooldownRemaining = checkAutoCooldown();
      if (cooldownRemaining > 0) {
        // Auto-disable autoLogin setting when cooldown triggered
        chrome.storage.local.set({ autoLogin: false });
        chrome.tabs.sendMessage(targetTab, { action: 'autoLoginDisabled', reason: '冷却' });
        sendResponse({ error: `自动登录冷却中，请等待 ${cooldownRemaining} 秒，已自动关闭自动登录` });
        return;
      }
    }

    // Get stored credentials
    chrome.storage.local.get(['username', 'password'], (data) => {
      if (isAutoPageLoad) recordAutoAttempt();
      if (!data.username || !data.password) {
        sendResponse({ error: '请先在扩展设置中填写用户名和密码' });
        return;
      }

      // Step 1: Fill credentials
      chrome.tabs.sendMessage(targetTab, {
        action: 'fillCredentials',
        username: data.username,
        password: data.password
      }, (resp) => {
        if (chrome.runtime.lastError || !resp || !resp.ok) {
          sendResponse({ error: '填写用户名密码失败，请确认在南大认证页面' });
          return;
        }

        // Step 2: Get captcha image
        chrome.tabs.sendMessage(targetTab, { action: 'getCaptchaImage' }, (captchaResp) => {
          if (chrome.runtime.lastError || !captchaResp || captchaResp.error) {
            sendResponse({ error: captchaResp?.error || '无法获取验证码图片' });
            return;
          }

          // Step 3: Recognize captcha
          recognizeCaptcha(captchaResp.imageDataURL)
            .then(captchaText => {
              // Step 4: Fill captcha
              chrome.tabs.sendMessage(targetTab, { action: 'fillCaptcha', text: captchaText });

              // Step 5: Click login button (small delay to ensure captcha is filled)
              setTimeout(() => {
                chrome.tabs.sendMessage(targetTab, { action: 'clickLogin' });
              }, 300);

              sendResponse({ captchaText });
            })
            .catch(err => sendResponse({ error: err.message }));
        });
      });
    });

    return true; // async
  }
});
