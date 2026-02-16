// ===== Auth (Login/Register) =====

document.addEventListener('DOMContentLoaded', () => {
  // Redirect if already logged in
  const token = localStorage.getItem('chatverse_token');
  if (token) {
    window.location.href = '/';
    return;
  }

  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');

  if (loginForm) {
    loginForm.addEventListener('submit', handleLogin);
  }

  if (registerForm) {
    registerForm.addEventListener('submit', handleRegister);
  }
});

function showAlert(message, type = 'error') {
  const container = document.getElementById('alert-container');
  container.innerHTML = `
    <div class="alert alert-${type}">
      <span>${type === 'error' ? '❌' : '✅'}</span>
      <span>${message}</span>
    </div>
  `;
  
  if (type === 'error') {
    const card = document.querySelector('.auth-card');
    card.style.animation = 'shake 0.5s ease';
    setTimeout(() => card.style.animation = '', 500);
  }
}

async function handleLogin(e) {
  e.preventDefault();
  
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const btn = document.getElementById('login-btn');
  
  if (!username || !password) {
    showAlert('Заполните все поля');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:20px;height:20px;border-width:2px;"></div>';

  try {
    const response = await fetch(window.location.origin + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error);
    }

    localStorage.setItem('chatverse_token', data.token);
    localStorage.setItem('chatverse_user', JSON.stringify(data.user));

    showAlert('Успешный вход! Перенаправление...', 'success');
    
    setTimeout(() => {
      window.location.href = '/';
    }, 500);

  } catch (error) {
    showAlert(error.message || 'Ошибка входа');
    btn.disabled = false;
    btn.innerHTML = '<span>Войти</span><span>→</span>';
  }
}

async function handleRegister(e) {
  e.preventDefault();

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const passwordConfirm = document.getElementById('password-confirm').value;
  const btn = document.getElementById('register-btn');

  if (!username || !password || !passwordConfirm) {
    showAlert('Заполните все поля');
    return;
  }

  if (password !== passwordConfirm) {
    showAlert('Пароли не совпадают');
    return;
  }

  if (password.length < 6) {
    showAlert('Пароль должен быть минимум 6 символов');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:20px;height:20px;border-width:2px;"></div>';

  try {
    const response = await fetch(window.location.origin + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error);
    }

    localStorage.setItem('chatverse_token', data.token);
    localStorage.setItem('chatverse_user', JSON.stringify(data.user));

    showAlert('Аккаунт создан! Перенаправление...', 'success');

    setTimeout(() => {
      window.location.href = '/';
    }, 500);

  } catch (error) {
    showAlert(error.message || 'Ошибка регистрации');
    btn.disabled = false;
    btn.innerHTML = '<span>Создать аккаунт</span><span>🚀</span>';
  }
}