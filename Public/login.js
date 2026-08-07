/* ==========================================
   ADEQUA LOGIN — 2-Step Authentication
========================================== */

let loginUsername = '';
let loginRole = '';

/* =========================
   STEP 1: USERNAME + PASSWORD
========================= */
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const errorContainer = document.getElementById('error-message');
    const errorText = document.getElementById('error-text');
    const btn = document.getElementById('btnLogin');

    errorContainer.style.display = 'none';
    toggleBtnLoading(btn, true);

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            loginUsername = data.username;
            loginRole = data.role;

            // Simpan sementara di sessionStorage (belum full login)
            sessionStorage.setItem('pendingUser', loginUsername);
            sessionStorage.setItem('pendingRole', loginRole);

            if (data.hasPin) {
                // User sudah punya PIN → masuk ke Step 2 (Verifikasi PIN)
                showStep('step2');
                document.getElementById('pinUserDisplay').innerText = loginUsername;
                focusFirstPinBox('pinInputContainer');
            } else {
                // User belum punya PIN → masuk ke Step 3 (Set PIN Baru)
                showStep('step3');
                document.getElementById('setPinUserDisplay').innerText = loginUsername;
                focusFirstPinBox('setPinInputContainer');
            }
        } else {
            errorText.innerText = data.message || 'Username atau Password salah!';
            errorContainer.style.display = 'flex';
        }
    } catch (err) {
        errorText.innerText = 'Gagal terhubung ke server.';
        errorContainer.style.display = 'flex';
    } finally {
        toggleBtnLoading(btn, false);
    }
});

/* =========================
   STEP 2: VERIFY PIN
========================= */
async function verifyPin() {
    const pin = collectPinValue('pinInputContainer');
    const errorContainer = document.getElementById('pin-error');
    const errorText = document.getElementById('pin-error-text');
    const btn = document.getElementById('btnVerifyPin');

    errorContainer.style.display = 'none';

    if (pin.length !== 6) {
        errorText.innerText = 'Masukkan 6 digit PIN lengkap!';
        errorContainer.style.display = 'flex';
        return;
    }

    toggleBtnLoading(btn, true);

    try {
        const response = await fetch('/api/verify-pin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: loginUsername, pin })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            // PIN valid → Full login!
            localStorage.setItem('username', loginUsername);
            localStorage.setItem('role', loginRole);
            localStorage.setItem('token', data.token);
            sessionStorage.removeItem('pendingUser');
            sessionStorage.removeItem('pendingRole');
            window.location.href = '/dashboard.html';
        } else {
            errorText.innerText = data.message || 'PIN salah!';
            errorContainer.style.display = 'flex';
            clearPinBoxes('pinInputContainer');
            focusFirstPinBox('pinInputContainer');
        }
    } catch (err) {
        errorText.innerText = 'Gagal terhubung ke server.';
        errorContainer.style.display = 'flex';
    } finally {
        toggleBtnLoading(btn, false);
    }
}

/* =========================
   STEP 3: SET NEW PIN
========================= */
async function setNewPin() {
    const pin = collectPinValue('setPinInputContainer');
    const errorContainer = document.getElementById('setpin-error');
    const errorText = document.getElementById('setpin-error-text');
    const btn = document.getElementById('btnSetPin');

    errorContainer.style.display = 'none';

    if (pin.length !== 6 || !/^\d{6}$/.test(pin)) {
        errorText.innerText = 'PIN harus tepat 6 digit angka!';
        errorContainer.style.display = 'flex';
        return;
    }

    toggleBtnLoading(btn, true);

    try {
        const response = await fetch('/api/set-pin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: loginUsername, pin })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            // PIN berhasil diatur → Full login!
            localStorage.setItem('username', loginUsername);
            localStorage.setItem('role', loginRole);
            localStorage.setItem('token', data.token);
            sessionStorage.removeItem('pendingUser');
            sessionStorage.removeItem('pendingRole');
            window.location.href = '/dashboard.html';
        } else {
            errorText.innerText = data.message || 'Gagal mengatur PIN!';
            errorContainer.style.display = 'flex';
        }
    } catch (err) {
        errorText.innerText = 'Gagal terhubung ke server.';
        errorContainer.style.display = 'flex';
    } finally {
        toggleBtnLoading(btn, false);
    }
}

/* =========================
   STEP NAVIGATION
========================= */
function showStep(stepId) {
    document.querySelectorAll('.login-step').forEach(step => {
        step.classList.remove('active');
    });
    const target = document.getElementById(stepId);
    if (target) {
        target.classList.add('active');
    }
}

function goBackToStep1() {
    showStep('step1');
    clearPinBoxes('pinInputContainer');
    clearPinBoxes('setPinInputContainer');
    document.getElementById('pin-error').style.display = 'none';
    document.getElementById('setpin-error').style.display = 'none';
}

/* =========================
   PIN BOX UTILITIES
========================= */
function collectPinValue(containerId) {
    const boxes = document.querySelectorAll(`#${containerId} .pin-box`);
    let pin = '';
    boxes.forEach(box => { pin += box.value; });
    return pin;
}

function clearPinBoxes(containerId) {
    const boxes = document.querySelectorAll(`#${containerId} .pin-box`);
    boxes.forEach(box => {
        box.value = '';
        box.classList.remove('filled');
    });
}

function focusFirstPinBox(containerId) {
    const firstBox = document.querySelector(`#${containerId} .pin-box[data-index="0"]`);
    if (firstBox) setTimeout(() => firstBox.focus(), 100);
}

/* =========================
   PIN AUTO-FOCUS SYSTEM
========================= */
function initPinAutoFocus(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const boxes = container.querySelectorAll('.pin-box');

    boxes.forEach((box, index) => {
        // Only allow digits
        box.addEventListener('input', (e) => {
            const val = e.target.value.replace(/\D/g, '');
            e.target.value = val.slice(0, 1);

            if (val) {
                box.classList.add('filled');
                // Auto-focus next box
                if (index < boxes.length - 1) {
                    boxes[index + 1].focus();
                }
            } else {
                box.classList.remove('filled');
            }
        });

        // Handle backspace
        box.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !box.value && index > 0) {
                boxes[index - 1].focus();
                boxes[index - 1].value = '';
                boxes[index - 1].classList.remove('filled');
            }

            // Handle Enter on last box
            if (e.key === 'Enter') {
                if (containerId === 'pinInputContainer') {
                    verifyPin();
                } else if (containerId === 'setPinInputContainer') {
                    setNewPin();
                }
            }
        });

        // Handle paste
        box.addEventListener('paste', (e) => {
            e.preventDefault();
            const paste = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
            if (paste.length >= 6) {
                boxes.forEach((b, i) => {
                    if (i < 6) {
                        b.value = paste[i] || '';
                        if (b.value) b.classList.add('filled');
                    }
                });
                boxes[Math.min(5, boxes.length - 1)].focus();
            }
        });
    });
}

/* =========================
   BUTTON LOADING STATE
========================= */
function toggleBtnLoading(btn, isLoading) {
    if (!btn) return;
    const text = btn.querySelector('.btn-text');
    const loader = btn.querySelector('.btn-loader');
    if (isLoading) {
        if (text) text.style.display = 'none';
        if (loader) loader.style.display = 'flex';
        btn.disabled = true;
        btn.style.opacity = '0.7';
    } else {
        if (text) text.style.display = 'flex';
        if (loader) loader.style.display = 'none';
        btn.disabled = false;
        btn.style.opacity = '1';
    }
}

/* =========================
   INIT ON LOAD
========================= */
document.addEventListener('DOMContentLoaded', () => {
    initPinAutoFocus('pinInputContainer');
    initPinAutoFocus('setPinInputContainer');
});