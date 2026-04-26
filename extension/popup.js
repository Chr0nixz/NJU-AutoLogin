// Page navigation
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

document.getElementById('openSettings').addEventListener('click', () => {
  showPage('settingsPage');
});
document.getElementById('backMain').addEventListener('click', () => {
  showPage('mainPage');
});

// Load saved settings
chrome.storage.local.get(['username', 'password', 'autoLogin'], (data) => {
  if (data.username) document.getElementById('username').value = data.username;
  if (data.password) document.getElementById('password').value = data.password;
  document.getElementById('autoLogin').checked = !!data.autoLogin;
});

// Auto-save settings on change
document.getElementById('autoLogin').addEventListener('change', () => {
  chrome.storage.local.set({ autoLogin: document.getElementById('autoLogin').checked });
});
document.getElementById('username').addEventListener('change', () => {
  chrome.storage.local.set({ username: document.getElementById('username').value.trim() });
});
document.getElementById('password').addEventListener('change', () => {
  chrome.storage.local.set({ password: document.getElementById('password').value });
});

// Password visibility toggle
document.getElementById('togglePwd').addEventListener('click', () => {
  const input = document.getElementById('password');
  const btn = document.getElementById('togglePwd');
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '🔒';
  } else {
    input.type = 'password';
    btn.textContent = '👁';
  }
});

// One-click login (main page, no cooldown)
document.getElementById('loginBtn').addEventListener('click', async () => {
  const btn = document.getElementById('loginBtn');
  const status = document.getElementById('status');
  const errorEl = document.getElementById('error');
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  if (!username || !password) {
    errorEl.textContent = '请输入用户名和密码';
    return;
  }

  // Auto-save credentials
  chrome.storage.local.set({ username, password });

  btn.disabled = true;
  errorEl.textContent = '';
  status.textContent = '正在自动登录...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const response = await chrome.runtime.sendMessage({
      type: 'autoLogin',
      tabId: tab.id
    });

    if (response.error) {
      errorEl.textContent = response.error + '，请检查用户名和密码';
      status.textContent = '登录失败';
    } else {
      status.textContent = '登录完成！';
    }
  } catch (e) {
    errorEl.textContent = '请先打开南大认证页面';
    status.textContent = '登录失败';
  }

  btn.disabled = false;
});

// Test recognition (settings page)
document.getElementById('testBtn').addEventListener('click', async () => {
  const btn = document.getElementById('testBtn');
  const status = document.getElementById('testStatus');
  const resultEl = document.getElementById('testResult');
  const imgEl = document.getElementById('captchaImg');

  btn.disabled = true;
  status.textContent = '正在识别...（首次加载模型较慢）';
  resultEl.textContent = '...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const response = await chrome.runtime.sendMessage({
      type: 'solveCaptcha',
      tabId: tab.id
    });

    if (response.error) {
      status.textContent = '识别失败: ' + response.error;
      resultEl.textContent = '--';
    } else {
      resultEl.textContent = response.text;
      status.textContent = '识别成功！已填入页面';
      if (response.imageUrl) {
        imgEl.src = response.imageUrl;
        imgEl.style.display = 'block';
      }
    }
  } catch (e) {
    status.textContent = '请先打开南大认证页面';
    resultEl.textContent = '--';
  }

  btn.disabled = false;
});
