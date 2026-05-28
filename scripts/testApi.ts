// scripts/testApi.ts
import { HfInference } from "@huggingface/inference";
import { DataAPIClient } from "@datastax/astra-db-ts";
import "dotenv/config";

const {
  ASTRA_DB_NAMESPACE,
  ASTRA_DB_COLLECTION,
  ASTRA_DB_ENDPOINT,
  ASTRA_DB_APPLICATION_TOKEN,
  HF_TOKEN,
} = process.env;

const GENERATION_MODEL =
  process.env.HF_GENERATION_MODEL ?? "HuggingFaceH4/zephyr-7b-beta";

async function testAllComponents() {
  console.log("Testing all components...\n");

  console.log("1. Testing Hugging Face connection...");
  try {
    const hf = new HfInference(HF_TOKEN);
    const embedding = await hf.featureExtraction({
      model: "sentence-transformers/all-MiniLM-L6-v2",
      provider: "hf-inference",
      inputs: "test query",
    });

    console.log(
      `Hugging Face embedding works. Response type: ${
        Array.isArray(embedding) ? "array" : typeof embedding
      }`
    );

    const textGen = await hf.textGeneration({
      model: GENERATION_MODEL,
      inputs: "Hello, how are you?",
      parameters: { max_new_tokens: 20 },
    });

    console.log("Hugging Face text generation works!");
    console.log(`   Response: ${textGen.generated_text}`);
  } catch (error) {
    console.log("Hugging Face error:", error instanceof Error ? error.message : error);
  }

  console.log("\n2. Testing Astra DB connection...");
  try {
    const client = new DataAPIClient(ASTRA_DB_APPLICATION_TOKEN!);
    const db = client.db(ASTRA_DB_ENDPOINT!, { namespace: ASTRA_DB_NAMESPACE });

    const collections = await db.listCollections({ nameOnly: true });
    console.log(`Astra DB connection works. Collections: ${collections.join(", ")}`);

    if (collections.includes(ASTRA_DB_COLLECTION!)) {
      const collection = db.collection(ASTRA_DB_COLLECTION!);
      const count = await collection.countDocuments({}, 1000, { maxTimeMS: 10000 });
      console.log(`Collection '${ASTRA_DB_COLLECTION}' exists with ${count} documents`);
    } else {
      console.log(`Collection '${ASTRA_DB_COLLECTION}' does not exist`);
    }
  } catch (error) {
    console.log("Astra DB error:", error instanceof Error ? error.message : error);
  }

  console.log("\nTesting complete!");
}

testAllComponents().catch(console.error);
