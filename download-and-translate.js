import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const recipesDir = path.join(process.cwd(), 'src', 'content', 'recipes');
const imagesDir = path.join(process.cwd(), 'public', 'images', 'recipes');

// 1. LIMPIEZA COMPLETA DEL DIRECTORIO DE RECETAS (Elimina duplicados anteriores)
if (fs.existsSync(recipesDir)) {
  fs.rmSync(recipesDir, { recursive: true, force: true });
}
fs.mkdirSync(recipesDir, { recursive: true });

if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir, { recursive: true });
}

// Diccionario culinario para garantía de traducción local
const culinaryDict = {
  chicken: "pollo", beef: "ternera", pork: "cerdo", lamb: "cordero", turkey: "pavo",
  steak: "filete", minced: "picada", bacon: "panceta", sausage: "salchicha", ham: "jamón",
  breast: "pechuga", wings: "alitas", thighs: "muslos", meatballs: "albóndigas",
  fish: "pescado", salmon: "salmón", cod: "bacalao", tuna: "atún", shrimp: "gambas",
  potato: "patata", potatoes: "patatas", tomato: "tomate", onion: "cebolla", garlic: "ajo",
  spinach: "espinacas", mushroom: "champiñón", pepper: "pimiento", carrot: "zanahoria",
  rice: "arroz", beans: "alubias", peas: "guisantes", corn: "maíz", avocado: "aguacate",
  roast: "asado", roasted: "asado", fried: "frito", crispy: "crujiente", baked: "al horno",
  grilled: "a la parrilla", spicy: "picante", sweet: "dulce", sauce: "salsa",
  soup: "sopa", stew: "estofado", curry: "curri", pie: "pastel", cake: "tarta", salad: "ensalada"
};

const categoryMap = {
  Beef: { category: "Carnes", temp: 190, time: 18 },
  Chicken: { category: "Carnes", temp: 190, time: 22 },
  Lamb: { category: "Carnes", temp: 195, time: 20 },
  Pork: { category: "Carnes", temp: 190, time: 18 },
  Seafood: { category: "Pescados", temp: 185, time: 12 },
  Vegetarian: { category: "Verduras", temp: 180, time: 15 },
  Side: { category: "Snacks", temp: 190, time: 12 },
  Starter: { category: "Snacks", temp: 200, time: 10 },
  Dessert: { category: "Postres", temp: 160, time: 20 },
  Pasta: { category: "Carnes", temp: 180, time: 15 },
  Miscellaneous: { category: "Snacks", temp: 185, time: 15 }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function translateToSpanish(text) {
  if (!text || text.trim() === '') return '';

  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|es`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.responseData && data.responseData.translatedText) {
      const translated = data.responseData.translatedText;
      if (!translated.includes("QUERY LENGTH LIMIT EXCEEDED")) {
        return translated;
      }
    }
  } catch (e) {
    // Si falla la API externa, pasa al diccionario local
  }

  // Traducción fallback por palabras
  const words = text.toLowerCase().split(/\s+/);
  const translatedWords = words.map((w) => {
    const clean = w.replace(/[^a-z]/g, '');
    const found = culinaryDict[clean];
    return found ? w.replace(clean, found) : w;
  });
  const res = translatedWords.join(' ');
  return res.charAt(0).toUpperCase() + res.slice(1);
}

async function downloadImage(imageUrl, imageFileName) {
  const localImagePath = path.join(imagesDir, imageFileName);
  if (fs.existsSync(localImagePath)) {
    return `/images/recipes/${imageFileName}`;
  }

  try {
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const fileStream = fs.createWriteStream(localImagePath);
    await pipeline(Readable.fromWeb(res.body), fileStream);
    return `/images/recipes/${imageFileName}`;
  } catch (err) {
    return imageUrl;
  }
}

async function processCleanRecipes() {
  console.log("🧹 Directorio anterior limpiado.");
  console.log("🚀 Iniciando descarga única de recetas e imágenes en castellano...\n");

  const fetchedRecipes = new Map(); // Llave = idMeal (evita duplicados)
  const alphabet = "abcdefghijklmnopqrstuvwxyz".split("");

  for (const letter of alphabet) {
    if (fetchedRecipes.size >= 200) break;

    try {
      const response = await fetch(`https://www.themealdb.com/api/json/v1/1/search.php?f=${letter}`);
      const data = await response.json();

      if (data.meals) {
        for (const meal of data.meals) {
          if (fetchedRecipes.size >= 200) break;
          // Si la receta ya fue procesada por su ID único, saltar para evitar duplicados
          if (fetchedRecipes.has(meal.idMeal)) continue;
          if (!meal.strMealThumb) continue;

          const recipeIndex = fetchedRecipes.size + 1;
          console.log(`[${recipeIndex}/200] Traduciendo e importando: ${meal.strMeal}`);

          // Traducir título
          const titleEs = await translateToSpanish(meal.strMeal);
          await sleep(80);

          // Descargar imagen
          const imageExtension = path.extname(meal.strMealThumb) || '.jpg';
          const imageFileName = `${meal.idMeal}${imageExtension}`;
          const localImageUrl = await downloadImage(meal.strMealThumb, imageFileName);

          // Traducir ingredientes
          const ingredientsEs = [];
          for (let i = 1; i <= 20; i++) {
            const ing = meal[`strIngredient${i}`];
            const measure = meal[`strMeasure${i}`];
            if (ing && ing.trim() !== '') {
              const fullIng = `${measure ? measure.trim() : ''} ${ing.trim()}`.trim();
              const ingTranslated = await translateToSpanish(fullIng);
              ingredientsEs.push(ingTranslated);
              await sleep(30);
            }
          }

          const catInfo = categoryMap[meal.strCategory] || { category: "Carnes", temp: 185, time: 15 };

          const stepsEs = [
            `Prepara y limpia todos los ingredientes para ${titleEs}.`,
            `Sazona al gusto y añade una cucharadita de aceite de oliva.`,
            `Precalienta la freidora de aire a ${catInfo.temp}°C durante 3 minutos.`,
            `Coloca los ingredientes en la cesta sin amontonar y programa ${catInfo.time} minutos.`,
            `Mueve la cesta a mitad del tiempo de cocción y sirve caliente cuando esté dorado.`
          ];

          // Slug limpio derivado del título traducido + idMeal para garantíz de unicidad
          const slug = titleEs
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)+/g, "") + `-${meal.idMeal}`;

          const recipe = {
            id: meal.idMeal,
            slug: slug,
            title: titleEs,
            description: `Receta fácil y saludable de ${titleEs.toLowerCase()} preparada en freidora de aire.`,
            category: catInfo.category,
            imageUrl: localImageUrl,
            prepTimeMinutes: 10,
            cookTimeMinutes: catInfo.time,
            temperatureCelsius: catInfo.temp,
            servings: 4,
            ingredients: ingredientsEs.length > 0 ? ingredientsEs : ["Ingredientes al gusto"],
            steps: stepsEs
          };

          // Guardar por idMeal único
          fetchedRecipes.set(meal.idMeal, recipe);
        }
      }
    } catch (err) {
      console.error(`Error en letra ${letter}:`, err.message);
    }
  }

  // Guardar ficheros JSON únicos
  Array.from(fetchedRecipes.values()).forEach((recipe) => {
    fs.writeFileSync(
      path.join(recipesDir, `${recipe.slug}.json`),
      JSON.stringify(recipe, null, 2),
      'utf-8'
    );
  });

  console.log(`\n✨ ¡Completado sin duplicados! ${fetchedRecipes.size} recetas únicas guardadas en castellano.`);
}

processCleanRecipes();