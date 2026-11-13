// Native panel pixels, normalized to portrait width × height.
// Logical DPI is a uniTerm scaling preset, not physical PPI or an OEM default.
// Apple: 3× phone / 2× tablet scaling maps to Android 160×scale DPI.
// Samsung: 560 DPI phone / 320 DPI tablet are suggested layouts, user-adjustable.
export const androidDevicePresets = [
  { id: 'iphone-17', group: 'phone', name: 'iPhone 17', width: 1206, height: 2622, dpi: 480,
    source: 'https://www.apple.com/iphone-17/specs/' },
  { id: 'iphone-17-pro-max', group: 'phone', name: 'iPhone 17 Pro Max', width: 1320, height: 2868, dpi: 480,
    source: 'https://support.apple.com/en-us/125091' },
  { id: 'galaxy-s26-ultra', group: 'phone', name: 'Samsung Galaxy S26 Ultra', width: 1440, height: 3120, dpi: 560,
    source: 'https://www.samsung.com/ca/business/smartphones/galaxy-s/galaxy-s26-ultra-sm-s948wzsaxac/' },
  { id: 'ipad-pro-11-m5', group: 'tablet', name: 'iPad Pro 11″ (M5)', width: 1668, height: 2420, dpi: 320,
    source: 'https://support.apple.com/en-euro/125406' },
  { id: 'ipad-pro-13-m5', group: 'tablet', name: 'iPad Pro 13″ (M5)', width: 2064, height: 2752, dpi: 320,
    source: 'https://www.apple.com/ipad-pro/specs/' },
  { id: 'galaxy-tab-s11-ultra', group: 'tablet', name: 'Samsung Galaxy Tab S11 Ultra', width: 1848, height: 2960, dpi: 320,
    source: 'https://www.samsung.com/sec/tablets/galaxy-tab-s11-ultra/specs/' },
] as const
