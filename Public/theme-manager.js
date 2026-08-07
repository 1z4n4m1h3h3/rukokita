/**
 * THEME & FONT MANAGER
 * Handles saving and switching themes and fonts globally.
 */

(function() {
    // Determine initial theme & font
    const savedTheme = localStorage.getItem('app_theme') || 'light';
    const savedFont = localStorage.getItem('app_font') || 'Inter';
    
    // Apply on load
    document.documentElement.setAttribute('data-theme', savedTheme);
    document.documentElement.style.setProperty('--app-font', `'${savedFont}', sans-serif`);

    window.saveConfig = function(themeName, fontName) {
        const validThemes = ['light', 'dark', 'ocean', 'emerald', 'midnight'];
        if (!validThemes.includes(themeName)) {
            console.error(`Invalid theme: ${themeName}`);
            return;
        }

        // Apply dynamically
        document.documentElement.setAttribute('data-theme', themeName);
        document.documentElement.style.setProperty('--app-font', `'${fontName}', sans-serif`);
        
        // Save to storage
        localStorage.setItem('app_theme', themeName);
        localStorage.setItem('app_font', fontName);
        
        console.log(`%c Config Saved -> Theme: ${themeName} | Font: ${fontName} `, 'background: #222; color: #bada55; font-size: 14px; font-weight: bold;');
    };

    window.applyUniversalConfig = function() {
        const themeSelect = document.getElementById('configThemeSelect');
        const fontSelect = document.getElementById('configFontSelect');
        
        if (themeSelect && fontSelect) {
            saveConfig(themeSelect.value, fontSelect.value);
            if (typeof showToast === 'function') {
                showToast('Pengaturan Tampilan berhasil disimpan!', 'success');
            } else {
                alert('Pengaturan Tampilan berhasil disimpan!');
            }
        }
    };

    // Auto-populate inputs on DOMContentLoaded if they exist
    window.addEventListener('DOMContentLoaded', () => {
        const themeSelect = document.getElementById('configThemeSelect');
        const fontSelect = document.getElementById('configFontSelect');
        if (themeSelect) themeSelect.value = localStorage.getItem('app_theme') || 'light';
        if (fontSelect) fontSelect.value = localStorage.getItem('app_font') || 'Inter';
    });

    console.log("🎨 Theme & Font Manager Loaded.");
})();
