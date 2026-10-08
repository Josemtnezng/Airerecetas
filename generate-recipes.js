import fs from 'node:fs';
import path from 'node:path';

const recipesDir = path.join(process.cwd(), 'src', 'content', 'recipes');

if (!fs.existsSync(recipesDir)) {
  fs.mkdirSync(recipesDir, { recursive: true });
}

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

async function generateCleanRecipes() {
  console.log("⚡ Generando 200 recetas directamente desde la API (sin bloqueos)...");

  const fetchedRecipes = new Map();
  const alphabet = "abcdefghijklmnopqrstuvwxyz".split("");

  for (const letter of alphabet) {
    if (fetchedRecipes.size >= 200) break;

    try {
      const response = await fetch(`https://www.themealdb.com/api/json/v1/1/search.php?f=${letter}`);
      const data = await response.json();

      if (data.meals) {
        for (const meal of data.meals) {
          if (fetchedRecipes.size >= 200) break;
          if (fetchedRecipes.has(meal.idMeal)) continue;
          if (!meal.strMealThumb) continue;

          // Extraer ingredientes con sus medidas
          const ingredients = [];
          for (let i = 1; i <= 20; i++) {
            const ing = meal[`strIngredient${i}`];
            const measure = meal[`strMeasure${i}`];

            if (ing && ing.trim() !== '') {
              const fullIng = `${measure ? measure.trim() : ''} ${ing.trim()}`.trim();
              ingredients.push(fullIng);
            }
          }

          // Extraer pasos limpios
          let steps = [];
          if (meal.strInstructions) {
            steps = meal.strInstructions
              .split(/\r?\n|\./)
              .map(s => s.trim())
              .filter(s => s.length > 10);
          }

          const catInfo = categoryMap[meal.strCategory] || { category: "Carnes", temp: 185, time: 15 };

          if (steps.length === 0) {
            steps = [
              `Prepare all ingredients for ${meal.strMeal}.`,
              `Season to taste and lightly coat with olive oil.`,
              `Place in the air fryer basket preheated to ${catInfo.temp}°C.`,
              `Cook for ${catInfo.time} minutes, shaking basket halfway through.`,
              `Serve hot and enjoy.`
            ];
          }

          const slug = meal.strMeal
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)+/g, "") + `-${meal.idMeal}`;

          const recipe = {
            id: meal.idMeal,
            slug: slug,
            title: meal.strMeal,
            description: `Delicious air fryer ${meal.strMeal.toLowerCase()} recipe. Quick, easy and healthy.`,
            category: catInfo.category,
            imageUrl: meal.strMealThumb,
            prepTimeMinutes: 10,
            cookTimeMinutes: catInfo.time,
            temperatureCelsius: catInfo.temp,
            servings: 4,
            ingredients: ingredients,
            steps: steps
          };

          fetchedRecipes.set(meal.idMeal, recipe);
        }
      }
    } catch (err) {
      console.error(`Error con la letra ${letter}:`, err.message);
    }
  }

  // Limpiar directorio anterior
  const files = fs.readdirSync(recipesDir);
  for (const file of files) {
    fs.unlinkSync(path.join(recipesDir, file));
  }

  // Guardar JSONs
  Array.from(fetchedRecipes.values()).forEach(recipe => {
    fs.writeFileSync(
      path.join(recipesDir, `${recipe.slug}.json`),
      JSON.stringify(recipe, null, 2),
      'utf-8'
    );
  });

  console.log(`\n🎉 ¡Hecho! ${fetchedRecipes.size} recetas guardadas en formato limpio en src/content/recipes/`);
}

generateCleanRecipes();