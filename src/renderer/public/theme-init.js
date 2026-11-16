// Runs before CSS and before the module graph, including when the SDK/UI fails to load.
try {
  const saved = localStorage.getItem('qwen-desktop-theme')
  document.documentElement.dataset.theme = saved === 'dark' || saved === 'light' ? saved :
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
} catch { document.documentElement.dataset.theme = 'dark' }
