/* apply the saved theme before first paint (tiny preference, localStorage only) */
(function () { try { var t = localStorage.getItem('mfs.theme'); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); } catch (e) {} })();
