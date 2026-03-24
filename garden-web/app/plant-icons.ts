// Per-plant emoji icon mapping
// Falls back to category emoji, then generic seedling

const plantIconMap: Record<string, string> = {
  // ── Vegetables ──────────────────────────────────────────────
  'tomato': '🍅',
  'tomatillo': '🍅',
  'ground cherry': '🍅',
  'pepper': '🌶️',
  'bell pepper': '🫑',
  'jalapeño': '🌶️',
  'jalapeno': '🌶️',
  'habanero': '🌶️',
  'serrano': '🌶️',
  'hot pepper': '🌶️',
  'chile pepper': '🌶️',
  'cucumber': '🥒',
  'armenian cucumber': '🥒',
  'squash': '🟡',
  'squash (summer)': '🟡',
  'zucchini': '🥒',
  'winter squash': '🟠',
  'butternut squash': '🟠',
  'butternut': '🟠',
  'lettuce': '🥬',
  'spinach': '🥬',
  'malabar spinach': '🥬',
  'kale': '🥬',
  'bok choy': '🥬',
  'cabbage': '🥬',
  'swiss chard': '🥬',
  'collard greens': '🥬',
  'collards': '🥬',
  'arugula': '🥬',
  'carrot': '🥕',
  'radish': '🔴',
  'beet': '🟣',
  'turnip': '🟣',
  'parsnip': '🥕',
  'onion': '🧅',
  'green onion': '🧅',
  'leek': '🧅',
  'garlic': '🧄',
  'pea': '🟩',
  'bean': '🫘',
  'bean (bush)': '🫘',
  'green bean': '🫘',
  'tepary bean': '🫘',
  'black-eyed pea': '🫘',
  'corn': '🌽',
  'eggplant': '🍆',
  'melon': '🍈',
  'watermelon': '🍉',
  'cantaloupe': '🍈',
  'broccoli': '🥦',
  'cauliflower': '🥦',
  'brussels sprouts': '🥦',
  'sweet potato': '🍠',
  'potato': '🥔',
  'okra': '🟢',
  'artichoke': '🟢',
  'asparagus': '🟢',
  'celery': '🟢',
  'pumpkin': '🎃',
  'prickly pear': '🌵',

  // ── Fruits ──────────────────────────────────────────────────
  'strawberry': '🍓',
  'fig': '🟤',
  'pomegranate': '🔴',
  'grape': '🍇',
  'grapes': '🍇',
  'lemon': '🍋',
  'orange': '🍊',
  'grapefruit': '🍊',
  'blackberry': '🫐',
  'raspberry': '🫐',
  'jujube': '🌳',
  'date palm': '🌴',
  'barbados cherry': '🍒',
  'desert gold peach': '🍑',
  'indian laurel': '🌳',
  'moringa': '🌳',

  // ── Vines ───────────────────────────────────────────────────
  'star jasmine': '🤍',
  'tangerine crossvine': '🧡',

  // ── Herbs ───────────────────────────────────────────────────
  'basil': '🌿',
  'cilantro': '🌿',
  'mint': '🌿',
  'oregano': '🌿',
  'thyme': '🌿',
  'dill': '🌿',
  'chive': '🌿',
  'chives': '🌿',
  'parsley': '🌿',
  'mexican tarragon': '🌿',
  'rosemary': '🪴',
  'sage': '🪴',
  'lavender': '💜',
  'lemongrass': '🌾',
  'roselle': '🌺',

  // ── Flowers ─────────────────────────────────────────────────
  'marigold': '🌼',
  'calendula': '🌼',
  'nasturtium': '🟠',
  'sunflower': '🌻',
  'zinnia': '💐',
  'cosmos': '🌸',
  'borage': '💙',
  'sweet alyssum': '⚪',

  // ── Desert / Native Plants ─────────────────────────────────
  'baja fairy duster': '🌸',
  "parry's penstemon": '💗',
  'sparky tecoma': '🧡',
  'blackfoot daisy': '⚪',
  'moss verbena': '💜',
  'purple trailing lantana': '💜',

  // ── Yucca ───────────────────────────────────────────────────
  'soaptree yucca': '🌿',
  'banana yucca': '🌿',
  'mojave yucca': '🌿',
  'red yucca': '🌺',

  // ── Milkweed (monarch butterfly plants) ─────────────────────
  'desert milkweed': '🦋',
  'pine-leaf milkweed': '🦋',
  'butterfly weed': '🦋',
  'showy milkweed': '🦋',
  'arizona milkweed': '🦋',
};

const categoryFallback: Record<string, string> = {
  vegetable: '🥬',
  herb: '🌿',
  flower: '🌸',
  fruit: '🌳',
};

/**
 * Get the best emoji icon for a plant by name, falling back to category emoji, then a generic seedling.
 */
export function getPlantIcon(name: string, category?: string): string {
  const lower = name.toLowerCase().trim();

  // Exact match
  if (plantIconMap[lower]) return plantIconMap[lower];

  // Partial match: check if any key is contained in the name, or name contains the key
  for (const [key, emoji] of Object.entries(plantIconMap)) {
    if (lower.includes(key) || key.includes(lower)) return emoji;
  }

  // Category fallback
  if (category && categoryFallback[category]) return categoryFallback[category];

  // Generic fallback
  return '🌱';
}
