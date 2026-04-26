/**
 * Content script for NJU auth server
 * Handles: capturing captcha image, filling credentials, clicking login
 */

function findCaptchaImage() {
  return document.querySelector('#captchaImg') ||
         document.querySelector('img[src*="getCaptcha"]') ||
         document.querySelector('img[src*="captcha"]');
}

function findCaptchaInput() {
  return document.querySelector('#captcha') ||
         document.querySelector('#captcha_input') ||
         document.querySelector('#captcha_response') ||
         document.querySelector('input[name*="captcha"]') ||
         document.querySelector('input[placeholder*="验证码"]') ||
         document.querySelector('input[placeholder*="captcha"]');
}

function findUsernameInput() {
  return document.querySelector('#username') ||
         document.querySelector('input[name="username"]') ||
         document.querySelector('input[name="userId"]') ||
         document.querySelector('input[placeholder*="用户名"]') ||
         document.querySelector('input[placeholder*="学号"]') ||
         document.querySelector('input[id*="username"]');
}

function findPasswordInput() {
  return document.querySelector('#password') ||
         document.querySelector('input[name="passwordText"]') ||
         document.querySelector('input[name="password"]') ||
         document.querySelector('input[type="password"]');
}

function findLoginButton() {
  // NJU auth uses <a id="login_submit" class="login-btn"> for login
  // Prefer the one inside pwdLoginDiv (username/password login)
  return document.querySelector('#pwdLoginDiv #login_submit') ||
         document.querySelector('#login_submit') ||
         document.querySelector('a.login-btn') ||
         document.querySelector('button[type="submit"]') ||
         document.querySelector('input[type="submit"]');
}

function setInputValue(input, value) {
  if (!input) return false;
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  ).set;
  nativeInputValueSetter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

async function getCaptchaImageDataURL() {
  const img = findCaptchaImage();
  if (!img) return null;

  if (!img.complete || !img.naturalWidth) {
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      setTimeout(reject, 5000);
    }).catch(() => null);
  }

  if (!img.naturalWidth) return null;

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL('image/png');
}

function fillCaptchaInput(text) {
  setInputValue(findCaptchaInput(), text);
}

function switchToPasswordLogin() {
  // NJU auth page defaults to QR code login; need to click "账号登录" tab
  const tab = document.querySelector('#userNameLogin_a');
  if (tab && !document.querySelector('#pwdLoginDiv[style*="block"]')) {
    tab.click();
  }
}

async function fillCredentials(username, password) {
  switchToPasswordLogin();
  // Wait for tab switch animation / DOM update
  await new Promise(r => setTimeout(r, 200));
  const u = findUsernameInput();
  const p = findPasswordInput();
  if (!u || !p) return false;
  setInputValue(u, username);
  setInputValue(p, password);
  return true;
}

function clickLoginButton() {
  const btn = findLoginButton();
  if (btn) {
    btn.click();
    return true;
  }
  return false;
}

// Listen for messages from background/popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getCaptchaImage') {
    getCaptchaImageDataURL().then(dataURL => {
      if (dataURL) {
        sendResponse({ imageDataURL: dataURL });
      } else {
        sendResponse({ error: '未找到验证码图片' });
      }
    });
    return true; // async
  } else if (request.action === 'fillCaptcha') {
    fillCaptchaInput(request.text);
    sendResponse({ ok: true });
  } else if (request.action === 'fillCredentials') {
    fillCredentials(request.username, request.password).then(ok => {
      sendResponse({ ok });
    });
    return true; // async
  } else if (request.action === 'clickLogin') {
    const ok = clickLoginButton();
    sendResponse({ ok });
  } else if (request.action === 'autoLoginDisabled') {
    console.log(`[NJU AutoLogin] 自动登录已被系统关闭（原因：${request.reason}）`);
  }
});

// Auto-login on page load (if enabled)
chrome.storage.local.get(['autoLogin', 'username', 'password'], (data) => {
  if (data.autoLogin && data.username && data.password) {
    console.log('[NJU AutoLogin] Auto-login enabled, starting...');
    chrome.runtime.sendMessage({ type: 'autoLogin', tabId: null });
  }
});

console.log('[NJU AutoLogin] Content script loaded.');
