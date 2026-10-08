import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';
import { GoogleGenAI, Type } from '@google/genai';

// ==========================================
// CONFIGURACIÓN Y CONSTANTES
// ==========================================

const CONFIG = {
  OUTPUT_DIR: path.join(process.cwd(), 'src', 'content', 'recipes'),
  EXTERNAL_API_URL: 'https://www.themealdb.com/api/json/v1/1/random.php',
  // Modelos vigentes recomendados por la API
  AI_MODELS: ['gemini-3.8-flash', 'gemini-3.8-flash-lite'],
  MAX_RETRIES: 4,
  RETRY_BASE_DELAY_MS: 3000
};

// Esquema de validación para la respuesta de la IA
const RECIPE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: 'Título en español adaptado a Airfryer' },
    slug: { type: Type.STRING, description: 'Slug limpio para la URL (ej: alitas-de-pollo-crujientes)' },
    description: { type: Type.STRING, description: 'Resumen breve y apetitoso (1-2 frases)' },
    prepTimeMinutes: { type: Type.INTEGER, description: 'Tiempo de preparación previa en minutos' },
    cookTimeMinutes: { type: Type.INTEGER, description: 'Tiempo de cocción en Airfryer en minutos' },
    temperatureCelsius: { type: Type.INTEGER, description: 'Temperatura en grados Celsius (°C)' },
    servings: { type: Type.INTEGER, description: 'Número de raciones' },
    category: { type: Type.STRING, description: 'Categoría (Aperitivos, Carnes, Pescados, Verduras, Postres)' },
    ingredients: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Lista de ingredientes con sus cantidades en español'
    },
    steps: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Pasos detallados paso a paso para cocinar en la cesta'
    },
    tips: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Consejos de chef (ej: rociar con spray de aceite, agitar la cesta)'
    }
  },
  required: ['title', 'slug', 'description', 'cookTimeMinutes', 'temperatureCelsius', 'ingredients', 'steps']
};

// ==========================================
// SERVICIOS AUXILIARES
// ==========================================

/**
 * Pausa la ejecución por el número de milisegundos indicado.
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Inicializa el cliente de Google Gen AI validando la clave de API.
 */
function initializeAiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Debes configurar GEMINI_API_KEY en tu archivo .env');
  }
  return new GoogleGenAI({ apiKey });
}

/**
 * Garantiza que exista el directorio de destino antes de guardar archivos.
 */
function ensureDirectoryExists(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { recursive: true });
  }
}

// ==========================================
// LÓGICA DE DOMINIO Y LLAMADAS A APIS
// ==========================================

/**
 * Obtiene y limpia una receta proveniente de TheMealDB.
 */
async function fetchExternalRecipe() {
  console.log('📡 Obteniendo receta desde la API externa...');
  const response = await fetch(CONFIG.EXTERNAL_API_URL);

  if (!response.ok) {
    throw new Error(`Error en la petición HTTP externa: ${response.statusText}`);
  }

  const data = await response.json();
  const rawMeal = data.meals?.[0];

  if (!rawMeal) {
    throw new Error('No se encontraron datos de receta en la respuesta recibida.');
  }

  return formatRawMealData(rawMeal);
}

/**
 * Mapea los ingredientes y campos del formato de TheMealDB a un objeto limpio.
 */
function formatRawMealData(meal) {
  const ingredients = [];

  for (let i = 1; i <= 20; i++) {
    const ingredient = meal[`strIngredient${i}`]?.trim();
    const measure = meal[`strMeasure${i}`]?.trim();

    if (ingredient) {
      ingredients.push(measure ? `${measure} ${ingredient}` : ingredient);
    }
  }

  return {
    title: meal.strMeal,
    category: meal.strCategory,
    instructions: meal.strInstructions,
    imageUrl: meal.strMealThumb,
    ingredients
  };
}

/**
 * Genera el prompt estructurado para la IA a partir de la receta base.
 */
function buildPrompt(rawRecipe) {
  return `
  Eres un chef experto en cocina con freidora de aire (Airfryer).
  Tengo la siguiente receta tradicional:
  
  Título: ${rawRecipe.title}
  Categoría: ${rawRecipe.category}
  Ingredientes principales: ${rawRecipe.ingredients.join(', ')}
  Instrucciones originales: ${rawRecipe.instructions}

  Por favor:
  1. Adapta esta receta para que se cocine EXCLUSIVAMENTE en una Freidora de Aire (Airfryer).
  2. Ajusta las temperaturas y tiempos típicos de Airfryer.
  3. Traduce y redacta todo en un español claro, cercano y apetitoso.
  4. Organiza los pasos de forma clara (incluye si hay que precalentar o agitar la cesta).
  `;
}

/**
 * Adapta la receta llamando a Gemini AI con reintentos y prueba entre modelos oficiales.
 */
async function adaptRecipeWithAI(aiClient, rawRecipe) {
  console.log(`🤖 Adaptando "${rawRecipe.title}" a formato Airfryer...`);
  const prompt = buildPrompt(rawRecipe);

  for (const modelName of CONFIG.AI_MODELS) {
    const adaptedRecipe = await tryGenerateWithModel(aiClient, modelName, prompt);
    if (adaptedRecipe) {
      return {
        ...adaptedRecipe,
        imageUrl: rawRecipe.imageUrl,
        createdAt: new Date().toISOString()
      };
    }
  }

  throw new Error('Todos los modelos fallaron tras completar los reintentos.');
}

/**
 * Intenta generar la receta probando un modelo concreto con pausa progresiva si hay saturación.
 */
async function tryGenerateWithModel(aiClient, modelName, prompt) {
  for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
    try {
      console.log(`⏳ Consultando modelo ${modelName} (Intento ${attempt}/${CONFIG.MAX_RETRIES})...`);

      const response = await aiClient.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: RECIPE_SCHEMA,
          temperature: 0.3
        }
      });

      if (response && response.text) {
        return JSON.parse(response.text);
      }
    } catch (error) {
      const errorMessage = error?.message || String(error);
      const isTransient = error?.status === 503 || error?.status === 429 || errorMessage.includes('503') || errorMessage.includes('demand');

      if (isTransient && attempt < CONFIG.MAX_RETRIES) {
        const delay = attempt * CONFIG.RETRY_BASE_DELAY_MS;
        console.warn(`⚠️ Alta demanda puntual en ${modelName}. Esperando ${delay / 1000}s para reintentar...`);
        await sleep(delay);
      } else {
        console.warn(`⚠️ El modelo ${modelName} no se pudo completar (${errorMessage}). Probando siguiente opción...`);
        break; // Cambia al siguiente modelo de la lista
      }
    }
  }
  return null;
}

/**
 * Guarda el objeto JSON en el sistema de archivos.
 */
function saveRecipeToFile(recipeData) {
  ensureDirectoryExists(CONFIG.OUTPUT_DIR);
  const filePath = path.join(CONFIG.OUTPUT_DIR, `${recipeData.slug}.json`);
  fs.writeFileSync(filePath, JSON.stringify(recipeData, null, 2), 'utf-8');
  console.log(`✅ ¡Receta generada con éxito! Guardada en: ${filePath}`);
}

// ==========================================
// FLUJO PRINCIPAL
// ==========================================

async function main() {
  try {
    const aiClient = initializeAiClient();
    const rawRecipe = await fetchExternalRecipe();
    const adaptedRecipe = await adaptRecipeWithAI(aiClient, rawRecipe);

    saveRecipeToFile(adaptedRecipe);
  } catch (error) {
    console.error('❌ Error en el proceso de ingesta:', error.message || error);
    process.exit(1);
  }
}

main();